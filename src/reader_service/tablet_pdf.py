"""A small, optional PDF update that keeps page dictionaries near the file end.

PDF.js inspects the last page before it resolves a document. A flat page tree
can otherwise require one range fetch for every scattered page dictionary.
The update reuses their original object numbers and leaves the source intact;
the HTTP layer can serve the immutable source followed by this cached tail.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import BinaryIO, TYPE_CHECKING

from pypdf import PdfReader
from pypdf.generic import DictionaryObject, FloatObject, IndirectObject, NameObject, NumberObject, read_object

if TYPE_CHECKING:
    from reader_service.library import LibraryService


_LOGGER = logging.getLogger(__name__)
_MAX_TAIL_BYTES = 8 * 1024 * 1024


def _signature(stat: os.stat_result) -> tuple[int, int]:
    return stat.st_size, stat.st_mtime_ns


def _token_start(stream: BinaryIO) -> None:
    while True:
        token = stream.read(1)
        if not token:
            raise ValueError("Missing PDF header object")
        if token in b"\x00\t\n\x0c\r ":
            continue
        if token == b"%":
            while token and token not in (b"\r", b"\n"):
                token = stream.read(1)
            continue
        stream.seek(-1, 1)
        return


def _is_linearized(reader: PdfReader, source_size: int) -> bool:
    """Check the first object's dictionary, without reading a following stream.

    Appending bytes invalidates a valid linearization dictionary's /L and loses
    its existing fast path. Names inside strings or later objects do not count.
    """
    stream = reader.stream
    position = stream.tell()
    try:
        stream.seek(0)
        for _ in range(2):
            _token_start(stream)
            if not isinstance(read_object(stream, reader), NumberObject):
                return False
        _token_start(stream)
        if stream.read(3) != b"obj":
            return False
        _token_start(stream)
        if stream.read(2) != b"<<":
            return False
        values = {}
        while True:
            _token_start(stream)
            if stream.read(2) == b">>":
                break
            stream.seek(-2, 1)
            key = read_object(stream, reader)
            if not isinstance(key, NameObject):
                raise ValueError("Invalid PDF header dictionary")
            _token_start(stream)
            values[key] = read_object(stream, reader)
        linearized, length = values.get("/Linearized"), values.get("/L")
        numeric = (NumberObject, FloatObject)
        return (isinstance(linearized, numeric) and linearized > 0
                and isinstance(length, numeric) and length == source_size)
    finally:
        stream.seek(position)


def build_page_index(source: Path) -> bytes | None:
    """Build an incremental update without copying streams or changing pages.

    Page enumeration may flatten inherited attributes in pypdf's object cache.
    A second reader therefore serializes the original, unflattened dictionaries.
    Unsupported PDFs return None; parse and IO errors are handled by the caller.
    """
    initial = source.stat()
    with source.open("rb") as enumeration_stream, source.open("rb") as raw_stream:
        if any(
            _signature(os.fstat(stream.fileno())) != _signature(initial)
            for stream in (enumeration_stream, raw_stream)
        ):
            return None
        reader = PdfReader(enumeration_stream, strict=False)
        if reader.is_encrypted or _is_linearized(reader, initial.st_size):
            return None
        references: set[tuple[int, int]] = set()
        for page in reader.pages:
            reference = page.indirect_reference
            if not isinstance(reference, IndirectObject):
                return None
            if reference.idnum <= 0 or not 0 <= reference.generation <= 65535:
                return None
            references.add((reference.idnum, reference.generation))
        if not references or len({number for number, _ in references}) != len(references):
            return None

        raw_reader = PdfReader(raw_stream, strict=False)
        if raw_reader.is_encrypted:
            return None
        tail = io.BytesIO()
        tail.write(b"\n% Guided Reader compact page dictionaries\n")
        entries: list[tuple[int, int, int]] = []
        for number, generation in sorted(references):
            dictionary = raw_reader.get_object(IndirectObject(number, generation, raw_reader))
            if not isinstance(dictionary, DictionaryObject) or dictionary.get("/Type") != "/Page":
                return None
            offset = initial.st_size + tail.tell()
            if offset >= 10**10:
                return None
            entries.append((number, generation, offset))
            tail.write(f"{number} {generation} obj\n".encode("ascii"))
            dictionary.write_to_stream(tail)
            tail.write(b"\nendobj\n")
            if tail.tell() > _MAX_TAIL_BYTES:
                return None

        xref_offset = initial.st_size + tail.tell()
        tail.write(b"xref\n0 1\n0000000000 65535 f \n")
        index = 0
        while index < len(entries):
            end = index + 1
            while end < len(entries) and entries[end][0] == entries[end - 1][0] + 1:
                end += 1
            tail.write(f"{entries[index][0]} {end - index}\n".encode("ascii"))
            for _, generation, offset in entries[index:end]:
                tail.write(f"{offset:010d} {generation:05d} n \n".encode("ascii"))
            index = end

        trailer = DictionaryObject()
        for key in ("/Size", "/Root", "/Info", "/ID"):
            if key in raw_reader.trailer:
                trailer[NameObject(key)] = raw_reader.trailer.raw_get(key)
        if "/Size" not in trailer or "/Root" not in trailer:
            return None
        trailer[NameObject("/Prev")] = NumberObject(raw_reader._startxref)
        tail.write(b"trailer\n")
        trailer.write_to_stream(tail)
        tail.write(f"\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii"))
        if tail.tell() > _MAX_TAIL_BYTES:
            return None
        if any(
            _signature(os.fstat(stream.fileno())) != _signature(initial)
            for stream in (enumeration_stream, raw_stream)
        ) or _signature(source.stat()) != _signature(initial):
            return None
        return tail.getvalue()


def _write_tail(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".page-index-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class TabletPdfIndex:
    """Pin each PDF representation for the lifetime of one running service."""

    def __init__(self, library: LibraryService):
        self.library = library
        self._lock = Lock()
        self._revisions: dict[str, Path | None] = {}
        self._blobs: dict[str, Path | None] = {}

    def tail_for(self, revision_id: str) -> Path | None:
        with self._lock:
            if revision_id in self._revisions:
                return self._revisions[revision_id]
            result = None
            digest = None
            try:
                revision = self.library.revision(revision_id)
                digest = revision["blob_sha256"]
                if digest in self._blobs:
                    result = self._blobs[digest]
                else:
                    source = self.library.pdf_path(revision_id)
                    source_stat = source.stat()
                    if source_stat.st_size != revision["byte_size"]:
                        raise ValueError("PDF source size changed")
                    cache = self.library.paths.resolve(f"tmp/tablet-pdf-index-v1/{digest}.tail")
                    if cache.is_file() and 0 < cache.stat().st_size <= _MAX_TAIL_BYTES:
                        with source.open("rb") as stream:
                            reader = PdfReader(stream, strict=False)
                            if (not reader.is_encrypted and not _is_linearized(reader, source_stat.st_size)
                                    and _signature(source.stat()) == _signature(source_stat)):
                                result = cache
                    else:
                        data = build_page_index(source)
                        if data is not None and _signature(source.stat()) == _signature(source_stat):
                            _write_tail(cache, data)
                            result = cache
                    self._blobs[digest] = result
            except Exception as exc:
                # Exception messages can contain private source paths; retain only
                # the failure type in internal diagnostics and pin source-only.
                _LOGGER.warning("Tablet PDF page index unavailable (%s)", type(exc).__name__)
                if digest is not None:
                    self._blobs[digest] = None
            self._revisions[revision_id] = result
            return result
