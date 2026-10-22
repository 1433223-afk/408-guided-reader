from __future__ import annotations

import builtins
from io import BytesIO
from pathlib import Path
import struct
import subprocess
import sys
import zlib

import pytest

from conftest import make_pdf
from reader_service.png_page import inspect_png, with_page_metadata
from reader_service.tablet_page_images import PageImage, PageImageUnavailable, TabletPageImages


def png(width=128, height=256):
    def chunk(kind, payload):
        data = kind + payload
        return struct.pack(">I", len(payload)) + data + struct.pack(">I", zlib.crc32(data) & 0xffffffff)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = zlib.compress((b"\0" + b"\xff\xff\xff" * width) * height)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", pixels) + chunk(b"IEND", b"")


def test_native_png_metadata_preserves_encoded_pixels_and_validates_integrity():
    body = png()
    assert inspect_png(body) == (128, 256, {})
    encoded = with_page_metadata(body, 100, 200)
    assert inspect_png(encoded) == (128, 256, {"reader_pdf_width": "100.0", "reader_pdf_height": "200.0"})
    assert with_page_metadata(encoded, 101, 202).count(b"reader_pdf_width") == 1
    # IDAT bytes remain identical: Android does not decode/re-encode its bitmap.
    assert body[body.index(b"IDAT"):body.index(b"IEND") - 4] in encoded


@pytest.mark.parametrize("corrupt", [lambda body: body[:-1], lambda body: body + b"trailing",
                                      lambda body: body[:40] + bytes([body[40] ^ 1]) + body[41:],
                                      lambda body: b"not PNG"])
def test_native_png_corruption_is_rejected(corrupt):
    with pytest.raises(ValueError):
        inspect_png(corrupt(png()))


def test_encoded_native_page_cache_works_when_pillow_is_unavailable(service, monkeypatch):
    data = make_pdf(((100, 200),))
    revision = service.intake(BytesIO(data), content_length=len(data), filename="native.pdf")["book"]["active_revision"]
    raw = png()
    actual_import = builtins.__import__
    def no_pillow(name, *args, **kwargs):
        if name == "PIL" or name.startswith("PIL."):
            pytest.fail("Native page path tried to initialize Pillow")
        return actual_import(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", no_pillow)
    monkeypatch.setattr("reader_service.tablet_page_images._load_pdfium", lambda: pytest.fail("Native page path initialized PDFium"))
    images = TabletPageImages(service, renderer=lambda *_: PageImage(raw, 100, 200, 128, 256, False), encoded_renderer=True)
    first = images.render(revision["id"], 0, 128)
    assert not first.cache_hit
    def no_render(*_):
        pytest.fail("Native cache reopened its PDF")
    hit = TabletPageImages(service, renderer=no_render, encoded_renderer=True).render(revision["id"], 0, 128)
    assert hit.cache_hit and hit.body == first.body
    next(images._cache_root.glob("*/*.png")).write_bytes(first.body[:-4])
    assert not images.render(revision["id"], 0, 128).cache_hit


def test_shared_android_core_imports_when_pillow_is_absent():
    root = Path(__file__).resolve().parents[1]
    script = """
import builtins,sys
sys.path.insert(0,sys.argv[1])
original=builtins.__import__
def absent(name,*args,**kwargs):
    if name == 'PIL' or name.startswith('PIL.'):
        raise ModuleNotFoundError('Pillow deliberately absent')
    return original(name,*args,**kwargs)
builtins.__import__=absent
import reader_service.android_local
assert not any(name == 'PIL' or name.startswith('PIL.') for name in sys.modules)
"""
    completed = subprocess.run([sys.executable, "-c", script, str(root / "src")], capture_output=True, text=True, timeout=15)
    assert completed.returncode == 0, completed.stderr
