from __future__ import annotations

import hmac
import json
import mimetypes
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, unquote, urlparse

from reader_service.library import IntakeError, LibraryService


_REVISION_PDF = re.compile(r"^/api/revisions/([0-9a-f-]+)/pdf$")
_REVISION_POSITION = re.compile(r"^/api/revisions/([0-9a-f-]+)/position$")
_BOOK = re.compile(r"^/api/books/([0-9a-f-]+)$")


class ReaderServer(ThreadingHTTPServer):
    daemon_threads = True


def handler_factory(
    service: LibraryService, token: str, project_root: Path | None = None
) -> Callable[..., BaseHTTPRequestHandler]:
    static_root = Path(__file__).with_name("static")
    root = project_root or Path(__file__).resolve().parents[2]
    pdfjs_root = root.joinpath("node_modules", "pdfjs-dist", "build")

    class Handler(BaseHTTPRequestHandler):
        server_version = "GuidedReader/0.1"

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/health":
                if not self._authorized():
                    return
                self._json(HTTPStatus.OK, {"status": "ok"})
                return
            if parsed.path == "/api/books":
                if not self._authorized():
                    return
                self._json(HTTPStatus.OK, {"books": service.list_books()})
                return
            match = _REVISION_PDF.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                try:
                    self._file(service.pdf_path(match.group(1)), "application/pdf", ranged=True)
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                return
            if parsed.path.startswith("/vendor/"):
                filename = {
                    "/vendor/pdf.mjs": "pdf.mjs",
                    "/vendor/pdf.worker.mjs": "pdf.worker.mjs",
                }.get(parsed.path)
                if not filename or not pdfjs_root.joinpath(filename).is_file():
                    self._json(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        {"error": "PDF.js is unavailable; run npm install"},
                    )
                    return
                self._file(pdfjs_root.joinpath(filename), "text/javascript; charset=utf-8")
                return
            self._static(parsed.path, static_root)

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path != "/api/books":
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            if not self._authorized():
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid Content-Length"})
                return
            parameters = parse_qs(parsed.query)
            try:
                result = service.intake(
                    self.rfile,
                    content_length=length,
                    filename=unquote(self.headers.get("X-File-Name", "book.pdf")),
                    book_id=_first(parameters, "book_id"),
                    title=_first(parameters, "title"),
                    label=_first(parameters, "label"),
                )
            except IntakeError as exc:
                self._json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(exc)})
                return
            except LookupError as exc:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                return
            self._json(HTTPStatus.OK if result["duplicate"] else HTTPStatus.CREATED, result)

        def do_PUT(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            match = _REVISION_POSITION.fullmatch(parsed.path)
            if not match:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            if not self._authorized():
                return
            try:
                payload = self._read_json()
                position = service.save_position(
                    match.group(1),
                    int(payload["pdf_page_index"]),
                    float(payload["normalized_offset"]),
                    float(payload["zoom"]),
                )
            except (KeyError, TypeError, ValueError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                return
            except LookupError as exc:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                return
            self._json(HTTPStatus.OK, {"position": position})

        def do_DELETE(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            match = _BOOK.fullmatch(parsed.path)
            if not match:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            if not self._authorized():
                return
            try:
                service.delete_book(match.group(1))
            except LookupError as exc:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                return
            except OSError as exc:
                self._json(
                    HTTPStatus.CONFLICT,
                    {"error": f"Delete did not complete and can be retried: {exc}"},
                )
                return
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()

        def _authorized(self) -> bool:
            supplied = self.headers.get("X-Reader-Token", "")
            if hmac.compare_digest(supplied, token):
                return True
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Missing or invalid launch token"})
            return False

        def _read_json(self) -> dict:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 64 * 1024:
                raise ValueError("Invalid JSON request size")
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise ValueError("Request body must be a JSON object")
            return value

        def _static(self, path: str, directory: Path) -> None:
            filename = {"/": "index.html", "/index.html": "index.html"}.get(path)
            if filename is None and path in ("/app.js", "/styles.css", "/geometry.js"):
                filename = path[1:]
            if filename is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            target = directory.joinpath(filename)
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix in (".js", ".mjs"):
                content_type = "text/javascript; charset=utf-8"
            self._file(target, content_type)

        def _file(self, path: Path, content_type: str, ranged: bool = False) -> None:
            size = path.stat().st_size
            start, end = 0, size - 1
            status = HTTPStatus.OK
            if ranged and self.headers.get("Range"):
                match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers["Range"])
                if not match:
                    self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    return
                if match.group(1):
                    start = int(match.group(1))
                    end = int(match.group(2)) if match.group(2) else end
                elif match.group(2):
                    count = int(match.group(2))
                    start = max(0, size - count)
                if start > end or start >= size:
                    self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.end_headers()
                    return
                end = min(end, size - 1)
                status = HTTPStatus.PARTIAL_CONTENT
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Cache-Control", "no-store")
            if ranged:
                self.send_header("Accept-Ranges", "bytes")
                if status == HTTPStatus.PARTIAL_CONTENT:
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.end_headers()
            with path.open("rb") as source:
                source.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = source.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                        break
                    remaining -= len(chunk)

        def _json(self, status: HTTPStatus, payload: dict) -> None:
            encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                pass

        def log_message(self, format: str, *args: object) -> None:
            # Deliberately omit URLs so the per-launch token never enters logs.
            print(f"{self.client_address[0]} {args[1] if len(args) > 1 else '-'}")

    return Handler


def _first(parameters: dict[str, list[str]], key: str) -> str | None:
    values = parameters.get(key)
    return values[0] if values else None
