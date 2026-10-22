"""Small PNG integrity/metadata boundary for already encoded native page images.

This never decodes or re-encodes image pixels. Desktop image conversion remains
in Pillow; Android's renderer has already produced its PNG at this boundary.
"""

from __future__ import annotations

import struct
import zlib


SIGNATURE = b"\x89PNG\r\n\x1a\n"
PDF_WIDTH = "reader_pdf_width"
PDF_HEIGHT = "reader_pdf_height"
MAX_PNG_BYTES = 256 * 1024 * 1024


def _chunks(body):
    if not isinstance(body, bytes) or not SIGNATURE == body[:8] or len(body) > MAX_PNG_BYTES:
        raise ValueError("Invalid PNG image")
    position = 8
    while position < len(body):
        if position + 12 > len(body):
            raise ValueError("Incomplete PNG chunk")
        length = struct.unpack_from(">I", body, position)[0]
        end = position + 12 + length
        if end > len(body):
            raise ValueError("Incomplete PNG chunk")
        kind = body[position + 4:position + 8]
        payload = body[position + 8:end - 4]
        expected = struct.unpack_from(">I", body, end - 4)[0]
        if zlib.crc32(body[position + 4:end - 4]) & 0xffffffff != expected:
            raise ValueError("PNG checksum mismatch")
        yield kind, payload, body[position:end]
        position = end


def inspect_png(body):
    width = height = None
    text = {}
    pixels = ended = False
    for ordinal, (kind, payload, _) in enumerate(_chunks(body)):
        if ended or (ordinal == 0 and kind != b"IHDR"):
            raise ValueError("Invalid PNG chunk order")
        if kind == b"IHDR":
            if ordinal != 0 or len(payload) != 13:
                raise ValueError("Invalid PNG dimensions")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            allowed = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
            if (width < 1 or height < 1 or depth not in allowed.get(color, set())
                    or compression or filtering or interlace not in (0, 1)):
                raise ValueError("Invalid PNG image format")
        elif kind == b"IDAT":
            pixels = True
        elif kind == b"IEND":
            if payload:
                raise ValueError("Invalid PNG end")
            ended = True
        elif kind == b"tEXt":
            key, separator, value = payload.partition(b"\0")
            if separator and key in (PDF_WIDTH.encode(), PDF_HEIGHT.encode()):
                decoded = key.decode("ascii")
                if decoded in text or len(value) > 100:
                    raise ValueError("Invalid PNG page metadata")
                text[decoded] = value.decode("ascii")
    if not ended or not pixels or width is None:
        raise ValueError("Incomplete PNG image")
    return width, height, text


def _chunk(kind, payload):
    data = kind + payload
    return struct.pack(">I", len(payload)) + data + struct.pack(">I", zlib.crc32(data) & 0xffffffff)


def with_page_metadata(body, pdf_width, pdf_height):
    inspect_png(body)
    result = [SIGNATURE]
    for kind, payload, original in _chunks(body):
        if kind == b"tEXt" and payload.partition(b"\0")[0] in (PDF_WIDTH.encode(), PDF_HEIGHT.encode()):
            continue
        if kind == b"IEND":
            for key, value in ((PDF_WIDTH, pdf_width), (PDF_HEIGHT, pdf_height)):
                result.append(_chunk(b"tEXt", key.encode() + b"\0" + repr(float(value)).encode("ascii")))
        result.append(original)
    return b"".join(result)
