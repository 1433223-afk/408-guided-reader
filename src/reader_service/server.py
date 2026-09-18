from __future__ import annotations

import hmac
import json
import mimetypes
import re
import sys
import time
import threading
import logging
from http.cookies import SimpleCookie
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, unquote, urlparse

from reader_service.agent_runtime import ProviderFailure, StreamConsumerDisconnected
from reader_service.annotation import AnnotationService
from reader_service.assistant import AssistantService, AssistantStateError
from reader_service.library import IntakeError, LibraryService
from reader_service.jobs import PreparationCoordinator
from reader_service.knowledge import ChapterRegenerationBlocked, KnowledgeService
from reader_service.outline import OutlineService
from reader_service.saved_explanations import (
    SavedExplanationError,
    SavedExplanationService,
)
from reader_service.memory import LearningMemory
from reader_service.instance import InstanceProfile
from reader_service.disk import DiskSpaceError


_REVISION_PDF = re.compile(r"^/api/revisions/([0-9a-f-]+)/pdf$")
_REVISION_POSITION = re.compile(r"^/api/revisions/([0-9a-f-]+)/position$")
_REVISION_PREPARATION = re.compile(r"^/api/revisions/([0-9a-f-]+)/preparation$")
_REVISION_PREPARATION_EVENTS = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/preparation/events$"
)
_REVISION_PREPARATION_RETRY = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/preparation/retry$"
)
_REVISION_OVERLAY = re.compile(r"^/api/revisions/([0-9a-f-]+)/overlay$")
_REVISION_SEARCH = re.compile(r"^/api/revisions/([0-9a-f-]+)/search$")
_REVISION_OUTLINE = re.compile(r"^/api/revisions/([0-9a-f-]+)/outline$")
_REVISION_PAGE_LABELS = re.compile(r"^/api/revisions/([0-9a-f-]+)/page-labels$")
_REVISION_PAGE_LABEL = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/page-labels/(\d+)$"
)
_CHAPTER_KNOWLEDGE_MAP = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/chapters/([0-9a-f-]+)/knowledge-map$"
)
_CHAPTER_KNOWLEDGE_PREPARE = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/chapters/([0-9a-f-]+)/knowledge-map/prepare$"
)
_CHAPTER_KNOWLEDGE_REGENERATE = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/chapters/([0-9a-f-]+)/knowledge-map/regenerate$"
)
_CHAPTER_KNOWLEDGE_INSPECTION = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/chapters/([0-9a-f-]+)/knowledge-map/inspection$"
)
_REVISION_ANNOTATIONS = re.compile(r"^/api/revisions/([0-9a-f-]+)/annotations$")
_REVISION_ANNOTATION = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/annotations/([0-9a-f-]+)$"
)
_REVISION_ASSISTANT_ASK = re.compile(r"^/api/revisions/([0-9a-f-]+)/assistant/ask$")
_REVISION_ASSISTANT_BAKEOFF = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/assistant/bake-off$"
)
_REVISION_ASSISTANT_SAVE = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/assistant/save$"
)
_REVISION_ANNOTATION_REVIEW = re.compile(
    r"^/api/revisions/([0-9a-f-]+)/annotations/([0-9a-f-]+)/review$"
)
_BOOK = re.compile(r"^/api/books/([0-9a-f-]+)$")
_SESSION_COOKIE = "reader_launch"


class ReaderServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, *args, profile=None, **kwargs):
        self.profile = profile or InstanceProfile()
        if self.profile.beta:
            self.daemon_threads = False
            # Queue browser resource bursts before accept; active handlers stay capped at 32.
            # Set before TCPServer.__init__ activates the listening socket.
            self.request_queue_size = 64
        self.stopping = threading.Event()
        self._requests = threading.BoundedSemaphore(32)
        super().__init__(*args, **kwargs)
        if self.profile.beta and self.server_address[0] != "127.0.0.1":
            self.server_close()
            raise ValueError("Beta Core must bind 127.0.0.1")

    def process_request(self, request, client_address):
        if self.profile.beta and not self._requests.acquire(blocking=False):
            try:
                request.sendall(b"HTTP/1.0 503 Service Unavailable\r\nRetry-After: 2\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            if self.profile.beta:
                self._requests.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            if self.profile.beta:
                request.settimeout(30)
            super().process_request_thread(request, client_address)
        finally:
            if self.profile.beta:
                self._requests.release()

    def handle_error(self, request, client_address) -> None:
        error = sys.exc_info()[1]
        if isinstance(error, (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)):
            return
        if self.profile.beta:
            logging.getLogger(__name__).error("request_failed type=%s", type(error).__name__)
            return
        super().handle_error(request, client_address)


def handler_factory(
    service: LibraryService,
    token: str,
    project_root: Path | None = None,
    preparation: PreparationCoordinator | None = None,
    annotations: AnnotationService | None = None,
    outline: OutlineService | None = None,
    knowledge: KnowledgeService | None = None,
    assistant: AssistantService | None = None,
    saved_explanations: SavedExplanationService | None = None,
    learning=None,
    teaching=None,
    profile: InstanceProfile | None = None,
    beta_guard=None,
) -> Callable[..., BaseHTTPRequestHandler]:
    profile = profile or InstanceProfile()
    cookie_name = "__Host-reader_launch" if profile.beta else _SESSION_COOKIE
    static_root = Path(__file__).with_name("static")
    root = project_root or Path(__file__).resolve().parents[2]
    pdfjs_root = root.joinpath("node_modules", "pdfjs-dist", "build")
    marked_root = root.joinpath("node_modules", "marked", "lib")
    dompurify_root = root.joinpath("node_modules", "dompurify", "dist")
    katex_root = root.joinpath("node_modules", "katex", "dist")
    memory = LearningMemory(service.database)

    class Handler(BaseHTTPRequestHandler):
        server_version = "GuidedReader/0.1"

        def parse_request(self):
            if not super().parse_request():
                return False
            if not profile.beta:
                return True
            path = urlparse(self.path)
            if (len(self.headers.get_all("Host", [])) != 1 or self.headers.get("Host") != profile.host
                    or self.headers.get_all("X-Forwarded-Proto", []) != ["https"]
                    or path.scheme or path.netloc or not self.path.startswith("/")):
                self._json(HTTPStatus.FORBIDDEN, {"error": "访问地址无效。"})
                return False
            origins = self.headers.get_all("Origin", [])
            mutating = self.command not in {"GET", "HEAD", "OPTIONS"}
            if ((origins and origins != [profile.public_origin]) or (mutating and not origins)
                    or self.headers.get("Sec-Fetch-Site") == "cross-site"):
                self._json(HTTPStatus.FORBIDDEN, {"error": "请求来源无效。"})
                return False
            if any(part in {"inspection", "debug", "bake-off"} for part in unquote(path.path).split("/")):
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return False
            lengths = self.headers.get_all("Content-Length", [])
            if self.headers.get("Transfer-Encoding") or len(lengths) > 1:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "请求大小无效。"})
                return False
            if lengths:
                try:
                    length = int(lengths[0])
                except ValueError:
                    length = -1
                limit = service.max_pdf_bytes if path.path == "/api/books" and self.command == "POST" else 64 * 1024
                if length < 0 or length > limit:
                    self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "文件过大，PDF 上限为 512 MiB。"})
                    return False
            if mutating and self.server.stopping.is_set():
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "服务正在停机，请稍后重试。"})
                return False
            return True

        def handle_one_request(self):
            try:
                super().handle_one_request()
            except DiskSpaceError:
                self._json(HTTPStatus.INSUFFICIENT_STORAGE, {"code": "SPACE_LOW", "error": str(DiskSpaceError())})

        def end_headers(self):
            if profile.beta:
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Cross-Origin-Resource-Policy", "same-origin")
                self.send_header("X-Frame-Options", "DENY")
            super().end_headers()

        def _beta_key(self):
            if not self._authorized():
                return
            try:
                if self.command == "POST":
                    payload = self._read_json()
                    if set(payload) != {"key"}:
                        raise ValueError()
                    from reader_service.agent_runtime.deepseek import OpenAICompatibleAdapter
                    beta_guard.replace_key(payload["key"], OpenAICompatibleAdapter("deepseek", beta=True))
                elif self.command == "DELETE":
                    beta_guard.disconnect()
                self._json(HTTPStatus.OK, beta_guard.credentials.status())
            except ProviderFailure as exc:
                self._provider_failure(exc)
            except (ValueError, OSError):
                self._json(HTTPStatus.BAD_REQUEST, {"error": "Key 无法更新，请检查输入或联系管理员。"})

        def do_GET(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if parsed.path == "/api/instance":
                if self._authorized():
                    self._json(HTTPStatus.OK, {"profile": profile.name, "ai_disabled": bool(beta_guard and beta_guard.disabled), "preparation": preparation.health() if preparation else None})
                return
            if profile.beta and parsed.path == "/api/beta/key":
                self._beta_key()
                return
            if self._reading_request(parsed.path, 'GET'):
                return
            if self._memory_request(parsed.path, 'GET'):
                return
            guide_events = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/sections/([0-9a-f-]+)/guide/events", parsed.path)
            if guide_events:
                if not self._authorized():
                    return
                if teaching is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "导读服务不可用。"})
                    return
                started = False
                try:
                    params = parse_qs(parsed.query)
                    asset_id = _first(params, "asset_id") or ""
                    after = int(_first(params, "after") or -1)
                    revision, section = guide_events.groups()
                    self._start_guide_stream()
                    started = True
                    while not self.server.stopping.is_set():
                        event = teaching.draft_event(revision, section, asset_id, after)
                        self._guide_stream_event(event)
                        if event["type"] in {"complete", "error"}:
                            return
                        after = event["sequence"]
                except StreamConsumerDisconnected:
                    return
                except (LookupError, TypeError, ValueError) as exc:
                    if not started:
                        self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    else:
                        try:
                            self._guide_stream_event({"type": "error", "code": "GUIDE_STREAM_FAILED", "error": str(exc)})
                        except StreamConsumerDisconnected:
                            pass
                    return
            guide = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/sections/([0-9a-f-]+)/(guide|inline-teaching)", parsed.path)
            if guide:
                if not self._authorized():
                    return
                if teaching is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "导读服务不可用。"})
                    return
                try:
                    revision, section, kind = guide.groups()
                    target = teaching.inline if kind == "inline-teaching" else teaching
                    result = target.snapshot(revision, section)
                except (LookupError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/learning(?:/([0-9a-f-]+))?", parsed.path)
            if match:
                if not self._authorized():
                    return
                if learning is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "学习服务不可用。"})
                    return
                try:
                    service.revision(match[1])
                    chapter_id = _first(parse_qs(parsed.query), "chapter_id")
                    result = (learning.snapshot(match[1], match[2]) if match[2]
                              else learning.repository.entries(match[1], chapter_id))
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if parsed.path == "/api/health":
                if not self._authorized():
                    return
                self._json(HTTPStatus.OK, {"status": "ok"})
                return
            if parsed.path == "/api/learning/status":
                if not self._authorized():
                    return
                if learning is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "学习服务不可用。"})
                    return
                try:
                    result = learning.status()
                except ProviderFailure as exc:
                    self._provider_failure(exc)
                    return
                self._json(HTTPStatus.OK, result)
                return
            context_match = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/reading-context", parsed.path)
            if context_match:
                if not self._authorized():
                    return
                try:
                    revision = service.revision(context_match[1])
                    params = parse_qs(parsed.query)
                    page = int(_first(params, 'page') or 0)
                    y = float(_first(params, 'y') or 0)
                    if not 0 <= page < revision['page_count'] or not 0 <= y <= 1:
                        raise ValueError('阅读位置无效。')
                    result = outline.reading_context(context_match[1], page, y) if outline else {'chapter': None, 'section': None, 'subsection': None}
                    result['learning_counts'] = None
                    if learning and result.get('chapter'):
                        points = learning.repository.entries(context_match[1])['points']
                        chapter_points = [p for p in points if p['chapter_outline_node_id'] == result['chapter']['outline_node_id']]
                        if chapter_points:
                            result['learning_counts'] = {state: sum(p['status'] == state for p in chapter_points)
                                                         for state in ('UNDERSTOOD', 'NOT_FULLY_CLEAR', 'UNCONFIRMED')}

                except (LookupError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {'error': str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            if parsed.path == "/api/books":
                if not self._authorized():
                    return
                self._json(HTTPStatus.OK, {"books": service.list_books()})
                return
            if parsed.path == "/api/assistant/status":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.OK, {
                        "role": "ASSISTANT", "provider": "deepseek", "model": None,
                        "configured": False, "cooling": False,
                        "credential_target": "408-guided-reader-deepseek",
                        "active_provider": "deepseek", "bakeoff_enabled": False,
                        "providers": [],
                    })
                    return
                self._json(HTTPStatus.OK, assistant.status())
                return
            if parsed.path == "/api/assistant/inspection":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "AI 功能不可用"})
                    return
                self._json(HTTPStatus.OK, assistant.inspect_payloads())
                return
            match = _REVISION_OUTLINE.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if outline is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Outline is unavailable"})
                    return
                try:
                    result = outline.bootstrap(match.group(1))
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = _CHAPTER_KNOWLEDGE_INSPECTION.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if knowledge is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": "章节学习地图不可用。"
                    })
                    return
                try:
                    result = knowledge.inspect_payloads(match.group(1), match.group(2))
                except (ValueError, LookupError) as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = _CHAPTER_KNOWLEDGE_MAP.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if knowledge is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": "章节学习地图不可用。"
                    })
                    return
                try:
                    result = knowledge.snapshot(match.group(1), match.group(2))
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = _REVISION_PAGE_LABELS.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if outline is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Page labels are unavailable"})
                    return
                try:
                    result = outline.page_label_snapshot(match.group(1))
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = _REVISION_SEARCH.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Search is unavailable"})
                    return
                try:
                    query_text = _first(parse_qs(parsed.query, keep_blank_values=True), "q") or ""
                    result = preparation.foundation.search(match.group(1), query_text)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = _REVISION_ANNOTATIONS.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if annotations is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Annotations are unavailable"})
                    return
                try:
                    page_index = int(_first(parse_qs(parsed.query), "page") or "")
                    values = annotations.list_page(match.group(1), page_index)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"annotations": values})
                return
            match = _REVISION_PREPARATION_EVENTS.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Preparation is unavailable"})
                    return
                self._preparation_events(preparation, match.group(1))
                return
            match = _REVISION_PREPARATION.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Preparation is unavailable"})
                    return
                try:
                    statuses = preparation.foundation.statuses(match.group(1))
                    counts = preparation.jobs.counts(match.group(1))
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"pages": statuses, "jobs": counts})
                return
            match = _REVISION_OVERLAY.fullmatch(parsed.path)
            if match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Preparation is unavailable"})
                    return
                try:
                    page_index = int(_first(parse_qs(parsed.query), "page") or "")
                    overlay = preparation.foundation.overlay(match.group(1), page_index)
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"page": overlay})
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
                vendor_target = {
                    "/vendor/pdf.mjs": pdfjs_root.joinpath("pdf.mjs"),
                    "/vendor/pdf.worker.mjs": pdfjs_root.joinpath("pdf.worker.mjs"),
                    "/vendor/marked.esm.js": marked_root.joinpath("marked.esm.js"),
                    "/vendor/purify.es.mjs": dompurify_root.joinpath("purify.es.mjs"),
                    "/vendor/katex.mjs": katex_root.joinpath("katex.mjs"),
                    "/vendor/katex.css": katex_root.joinpath("katex.css"),
                }.get(parsed.path)
                if parsed.path.startswith("/vendor/fonts/"):
                    font_name = parsed.path.removeprefix("/vendor/fonts/")
                    if font_name and Path(font_name).name == font_name:
                        vendor_target = katex_root.joinpath("fonts", font_name)
                if vendor_target is None or not vendor_target.is_file():
                    self._json(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        {"error": "Frontend dependency is unavailable; run npm install"},
                    )
                    return
                content_type = mimetypes.guess_type(vendor_target.name)[0]
                if vendor_target.suffix in (".js", ".mjs"):
                    content_type = "text/javascript; charset=utf-8"
                self._file(vendor_target, content_type or "application/octet-stream")
                return
            self._static(parsed.path, static_root)

        def do_POST(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if profile.beta and parsed.path == "/api/beta/heartbeat":
                if not self._authorized():
                    return
                try:
                    payload = self._read_json()
                    if assistant:
                        assistant.heartbeat(payload.get("reader_session_id"))
                    self._json(HTTPStatus.OK, {"status": "ok"})
                except ValueError:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": "会话无效。"})
                return
            if profile.beta and parsed.path == "/api/beta/key":
                self._beta_key()
                return
            if self._reading_request(parsed.path, 'POST'):
                return
            if self._memory_request(parsed.path, 'POST'):
                return
            guide = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/sections/([0-9a-f-]+)/(guide|inline-teaching)/(generate|regenerate|retry)", parsed.path)
            if guide:
                if not self._authorized():
                    return
                if teaching is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "导读服务不可用。"})
                    return
                try:
                    payload = self._read_json()
                    revision, section, kind, action = guide.groups()
                    target = teaching.inline if kind == "inline-teaching" else teaching
                    result = target.retry(revision, section, payload["asset_id"]) if action == "retry" else target.request(revision, section, payload["intent_id"], regenerate=action == "regenerate")
                except (KeyError, LookupError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, result)
                return
            match = re.fullmatch(r"/api/revisions/([0-9a-f-]+)/learning/([0-9a-f-]+)/(open|send|retry|confirm|understand|confirm-section|check-section)", parsed.path)
            if match:
                if not self._authorized():
                    return
                if learning is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "学习服务不可用。"})
                    return
                streaming = False
                try:
                    payload = self._read_json()
                    revision_id, scope_id, action = match.groups()
                    streaming = action in {"send", "retry"} and self._wants_assistant_stream()
                    if streaming:
                        self._start_assistant_stream()
                    if action == "open":
                        result = learning.repository.open(revision_id, scope_id)
                    elif action == "send":
                        result = learning.send(
                            revision_id,
                            scope_id,
                            payload,
                            self._assistant_stream_event if streaming else None,
                        )
                    elif action == "retry":
                        result = learning.retry(
                            revision_id,
                            scope_id,
                            payload["message_id"],
                            self._assistant_stream_event if streaming else None,
                        )
                    elif action == "confirm":
                        result = learning.repository.confirm(revision_id, scope_id, payload["topic_id"])
                    elif action == "understand":
                        result = learning.repository.understand_without_topic(revision_id, scope_id)
                    elif action == "check-section":
                        result = learning.repository.clear_section(revision_id, scope_id)
                    else:
                        result = learning.repository.confirm_section(revision_id, scope_id)
                except LookupError as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.NOT_FOUND, "MASTER_CONTEXT_NOT_FOUND", str(exc)
                    )
                    return
                except (KeyError, ValueError, TypeError) as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.BAD_REQUEST, "INVALID_MASTER_REQUEST", str(exc)
                    )
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc, streaming=streaming)
                    return
                except StreamConsumerDisconnected:
                    return
                if not streaming:
                    self._json(HTTPStatus.OK, result)
                return
            regenerate_knowledge = _CHAPTER_KNOWLEDGE_REGENERATE.fullmatch(parsed.path)
            if regenerate_knowledge:
                if not self._authorized():
                    return
                if knowledge is None or preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": "章节学习地图不可用。"
                    })
                    return
                try:
                    self._read_json()
                    result, created = preparation.schedule_chapter_regeneration(
                        regenerate_knowledge.group(1), regenerate_knowledge.group(2)
                    )
                except ChapterRegenerationBlocked as exc:
                    self._json(HTTPStatus.CONFLICT, {"code": exc.code, "error": str(exc)})
                    return
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                except RuntimeError as exc:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": str(exc)
                    })
                    return
                self._json(
                    HTTPStatus.ACCEPTED
                    if result["regeneration_state"] == "RUNNING" else HTTPStatus.OK,
                    {"chapter_map": result, "created": created},
                )
                return
            prepare_knowledge = _CHAPTER_KNOWLEDGE_PREPARE.fullmatch(parsed.path)
            if prepare_knowledge:
                if not self._authorized():
                    return
                if knowledge is None or preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": "章节学习地图不可用。"
                    })
                    return
                try:
                    self._read_json()
                    result, created = preparation.schedule_chapter(
                        prepare_knowledge.group(1), prepare_knowledge.group(2)
                    )
                except ValueError as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                except RuntimeError as exc:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "KNOWLEDGE_UNAVAILABLE", "error": str(exc)
                    })
                    return
                self._json(
                    HTTPStatus.ACCEPTED if result["status"] == "PREPARING" else HTTPStatus.OK,
                    {"chapter_map": result, "created": created},
                )
                return
            save_match = _REVISION_ASSISTANT_SAVE.fullmatch(parsed.path)
            if save_match:
                if not self._authorized():
                    return
                if saved_explanations is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "SAVE_EXPLANATION_UNAVAILABLE",
                        "error": "保存 Assistant 解释功能不可用。",
                    })
                    return
                try:
                    payload = self._read_json()
                    result = saved_explanations.save(
                        save_match.group(1),
                        reader_session_id=payload["reader_session_id"],
                        root_id=payload["root_id"],
                        node_id=payload.get("node_id"),
                        turn_id=payload["turn_id"],
                        save_intent_id=payload["save_intent_id"],
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {
                        "code": "INVALID_SAVE_EXPLANATION", "error": str(exc)
                    })
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc)
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {
                        "code": "ASSISTANT_SAVE_TARGET_GONE", "error": str(exc)
                    })
                    return
                self._json(
                    HTTPStatus.CREATED if result["created"] else HTTPStatus.OK,
                    result,
                )
                return
            review_match = _REVISION_ANNOTATION_REVIEW.fullmatch(parsed.path)
            if review_match:
                if not self._authorized():
                    return
                if saved_explanations is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "REVIEW_UNAVAILABLE", "error": "AI 审查功能不可用。"
                    })
                    return
                try:
                    result = saved_explanations.retry_review(
                        review_match.group(1), review_match.group(2)
                    )
                except SavedExplanationError as exc:
                    self._json(HTTPStatus.CONFLICT, {
                        "code": exc.code, "error": exc.user_message
                    })
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.ACCEPTED, result)
                return
            bakeoff_match = _REVISION_ASSISTANT_BAKEOFF.fullmatch(parsed.path)
            if bakeoff_match:
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "尚未配置 AI 功能；Reader 其余能力仍可使用。"
                    })
                    return
                try:
                    payload = self._read_json()
                    comparison = assistant.bake_off_selection(
                        payload["reader_session_id"],
                        bakeoff_match.group(1),
                        int(payload["pdf_page_index"]),
                        start=payload["start"],
                        end=payload["end"],
                        question=payload.get("question"),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"code": "INVALID_BAKEOFF", "error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"code": "ASK_CONTEXT_NOT_FOUND", "error": str(exc)})
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc)
                    return
                self._json(HTTPStatus.OK, {"comparison": comparison})
                return
            ask_match = _REVISION_ASSISTANT_ASK.fullmatch(parsed.path)
            if ask_match:
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "尚未配置 AI 功能；Reader 其余能力仍可使用。"
                    })
                    return
                streaming = False
                try:
                    payload = self._read_json()
                    streaming = self._wants_assistant_stream()
                    if streaming:
                        self._start_assistant_stream()
                    if payload.get("source_kind") == "INLINE_GUIDANCE":
                        if teaching is None:
                            raise ValueError("行间教学服务不可用。")
                        context = teaching.inline.selection_context(ask_match.group(1), payload["section_id"], payload["asset_id"], payload["item_id"], payload["field"], payload["start_offset"], payload["end_offset"])
                        state = assistant.ask_inline(
                            payload["reader_session_id"], ask_match.group(1), context,
                            payload.get("provider"), self._assistant_stream_event if streaming else None,
                            payload.get("continuation"),
                        )
                    elif payload.get("source_kind") == "READING_GUIDE":
                        if teaching is None:
                            raise ValueError("导读服务不可用。")
                        context = teaching.selection_context(ask_match.group(1), payload["section_id"], payload["asset_id"], payload["module_id"], payload["start_offset"], payload["end_offset"])
                        state = assistant.ask_guide(
                            payload["reader_session_id"], ask_match.group(1), context,
                            payload.get("provider"), self._assistant_stream_event if streaming else None,
                            payload.get("continuation"),
                        )
                    elif payload.get("source_kind") == "MASTER_ANSWER":
                        if learning is None:
                            raise ValueError("Master 服务不可用。")
                        projection = learning.assistant_context_for_master_answer(
                            ask_match.group(1),
                            payload["master_message_id"],
                            payload["source_spans"],
                        )
                        state = assistant.ask_master(
                            payload["reader_session_id"],
                            ask_match.group(1),
                            projection,
                            payload.get("provider"),
                            self._assistant_stream_event if streaming else None,
                            payload.get("continuation"),
                        )
                    else:
                        state = assistant.ask_selection(
                            payload["reader_session_id"],
                            ask_match.group(1),
                            int(payload["pdf_page_index"]),
                            start=payload["start"],
                            end=payload["end"],
                            provider=payload.get("provider"),
                            source_kind=payload.get("source_kind", "ORIGINAL_PDF"),
                            stream=self._assistant_stream_event if streaming else None,
                            continuation=payload.get("continuation"),
                        )
                except (KeyError, TypeError, ValueError) as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.BAD_REQUEST, "INVALID_ASK", str(exc)
                    )
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc, streaming=streaming)
                    return
                except LookupError as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.NOT_FOUND, "ASK_CONTEXT_NOT_FOUND", str(exc)
                    )
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc, streaming=streaming)
                    return
                except StreamConsumerDisconnected:
                    return
                if not streaming:
                    self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/child":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "尚未配置 AI 功能；Reader 其余能力仍可使用。"
                    })
                    return
                streaming = False
                try:
                    payload = self._read_json()
                    streaming = self._wants_assistant_stream()
                    if streaming:
                        self._start_assistant_stream()
                    state = assistant.create_child(
                        payload["reader_session_id"],
                        payload["root_id"],
                        parent_node_id=payload.get("parent_node_id"),
                        turn_id=payload["turn_id"],
                        start_offset=int(payload["start_offset"]),
                        end_offset=int(payload["end_offset"]),
                        node_id=payload.get("node_id"),
                        source_spans=payload.get("source_spans"),
                        stream=self._assistant_stream_event if streaming else None,
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.BAD_REQUEST, "INVALID_CHILD", str(exc)
                    )
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc, streaming=streaming)
                    return
                except LookupError as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.NOT_FOUND, "ASSISTANT_LEVEL_GONE", str(exc)
                    )
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc, streaming=streaming)
                    return
                except StreamConsumerDisconnected:
                    return
                if not streaming:
                    self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/retry-child":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "尚未配置 AI 功能；Reader 其余能力仍可使用。"
                    })
                    return
                streaming = False
                try:
                    payload = self._read_json()
                    streaming = self._wants_assistant_stream()
                    if streaming:
                        self._start_assistant_stream()
                    state = assistant.retry_child(
                        payload["reader_session_id"], payload["root_id"], payload["node_id"],
                        stream=self._assistant_stream_event if streaming else None,
                        continuation=payload.get("continuation"),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.BAD_REQUEST, "INVALID_CHILD", str(exc)
                    )
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc, streaming=streaming)
                    return
                except LookupError as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.NOT_FOUND, "ASSISTANT_LEVEL_GONE", str(exc)
                    )
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc, streaming=streaming)
                    return
                except StreamConsumerDisconnected:
                    return
                if not streaming:
                    self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/close-child":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "AI 功能不可用"
                    })
                    return
                try:
                    payload = self._read_json()
                    state = assistant.close_child_subtree(
                        payload["reader_session_id"],
                        payload["root_id"],
                        payload["node_id"],
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {
                        "code": "INVALID_ASSISTANT_CHILD", "error": str(exc)
                    })
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc)
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {
                        "code": "ASSISTANT_LEVEL_GONE", "error": str(exc)
                    })
                    return
                self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/follow-up":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {
                        "code": "AI_UNCONFIGURED", "error": "尚未配置 AI 功能；Reader 其余能力仍可使用。"
                    })
                    return
                streaming = False
                try:
                    payload = self._read_json()
                    streaming = self._wants_assistant_stream()
                    if streaming:
                        self._start_assistant_stream()
                    state = assistant.follow_up(
                        payload["reader_session_id"],
                        payload["root_id"],
                        payload["question"],
                        node_id=payload.get("node_id"),
                        stream=self._assistant_stream_event if streaming else None,
                        continuation=payload.get("continuation"),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.BAD_REQUEST, "INVALID_FOLLOW_UP", str(exc)
                    )
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc, streaming=streaming)
                    return
                except LookupError as exc:
                    self._assistant_failure(
                        streaming, HTTPStatus.NOT_FOUND, "ASSISTANT_LEVEL_GONE", str(exc)
                    )
                    return
                except ProviderFailure as exc:
                    self._provider_failure(exc, streaming=streaming)
                    return
                except StreamConsumerDisconnected:
                    return
                if not streaming:
                    self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/focus":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"code": "AI_UNCONFIGURED", "error": "AI 功能不可用"})
                    return
                try:
                    payload = self._read_json()
                    state = assistant.focus(
                        payload["reader_session_id"],
                        payload["root_id"],
                        node_id=payload.get("node_id"),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"code": "INVALID_ASSISTANT_FOCUS", "error": str(exc)})
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc)
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"code": "ASSISTANT_LEVEL_GONE", "error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/close-root":
                if not self._authorized():
                    return
                if assistant is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"code": "AI_UNCONFIGURED", "error": "AI 功能不可用"})
                    return
                try:
                    payload = self._read_json()
                    state = assistant.close_root(
                        payload["reader_session_id"], payload["root_id"]
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"code": "INVALID_ASSISTANT_ROOT", "error": str(exc)})
                    return
                except AssistantStateError as exc:
                    self._assistant_state_failure(exc)
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"code": "ASSISTANT_ROOT_GONE", "error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"assistant": state})
                return
            if parsed.path == "/api/assistant/close":
                if not self._authorized():
                    return
                try:
                    payload = self._read_json()
                    if assistant is not None:
                        assistant.close_session(payload["reader_session_id"])
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"code": "INVALID_SESSION", "error": str(exc)})
                    return
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return
            annotation_match = _REVISION_ANNOTATIONS.fullmatch(parsed.path)
            if annotation_match:
                if not self._authorized():
                    return
                if annotations is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Annotations are unavailable"})
                    return
                try:
                    payload = self._read_json()
                    annotation = annotations.create_text(
                        annotation_match.group(1),
                        page_index=int(payload["pdf_page_index"]),
                        start=payload["start"],
                        end=payload["end"],
                        body=payload.get("body"),
                        highlight_style=payload.get("highlight_style", "YELLOW"),
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.CREATED, {"annotation": annotation})
                return
            retry_match = _REVISION_PREPARATION_RETRY.fullmatch(parsed.path)
            if retry_match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Preparation is unavailable"})
                    return
                try:
                    payload = self._read_json()
                    requeued = preparation.retry_page(
                        retry_match.group(1), int(payload["pdf_page_index"])
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(
                    HTTPStatus.ACCEPTED if requeued else HTTPStatus.CONFLICT,
                    {"status": "requeued" if requeued else "page is not failed"},
                )
                return
            prepare_match = _REVISION_PREPARATION.fullmatch(parsed.path)
            if prepare_match:
                if not self._authorized():
                    return
                if preparation is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Preparation is unavailable"})
                    return
                try:
                    payload = self._read_json()
                    current_page = int(payload.get("current_page", 0))
                    visible_pages = {int(value) for value in payload.get("visible_pages", [])}
                    preparation.schedule_revision(
                        prepare_match.group(1), visible_pages=visible_pages, current_page=current_page
                    )
                except (TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.ACCEPTED, {"status": "scheduled"})
                return
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
            if preparation is not None:
                preparation.schedule_revision(result["book"]["active_revision"]["id"])
            self._json(HTTPStatus.OK if result["duplicate"] else HTTPStatus.CREATED, result)

        def do_PUT(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            label_match = _REVISION_PAGE_LABEL.fullmatch(parsed.path)
            if label_match:
                if not self._authorized():
                    return
                if outline is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Page labels are unavailable"})
                    return
                try:
                    payload = self._read_json()
                    label = outline.set_manual_page_label(
                        label_match.group(1), int(label_match.group(2)), payload["printed_label"]
                    )
                except (KeyError, TypeError, ValueError) as exc:
                    self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
                    return
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self._json(HTTPStatus.OK, {"page_label": label})
                return
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

        def _reading_request(self, path, method):
            match = re.fullmatch(r'/api/revisions/([0-9a-f-]+)/section-reading', path)
            if not match:
                return False
            if not self._authorized():
                return True
            from reader_service.learning import reading
            try:
                service.revision(match[1])
                if method == 'GET':
                    result = reading.snapshot(service.database, match[1])
                else:
                    payload = self._read_json()
                    result = reading.observe(service.database, match[1], payload['pdf_page_index'],
                                             float(payload['top']), float(payload['bottom']))
            except (LookupError, KeyError, ValueError, TypeError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {'error': str(exc)})
                return True
            self._json(HTTPStatus.OK, result)
            return True

        def do_DELETE(self) -> None:  # noqa: N802
            parsed = urlparse(self.path)
            if profile.beta and parsed.path == "/api/beta/key":
                self._beta_key()
                return
            if self._memory_request(parsed.path, 'DELETE'):
                return
            annotation_match = _REVISION_ANNOTATION.fullmatch(parsed.path)
            if annotation_match:
                if not self._authorized():
                    return
                if annotations is None:
                    self._json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Annotations are unavailable"})
                    return
                try:
                    annotations.delete(annotation_match.group(1), annotation_match.group(2))
                except LookupError as exc:
                    self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                    return
                self.send_response(HTTPStatus.NO_CONTENT)
                self.end_headers()
                return
            match = _BOOK.fullmatch(parsed.path)
            if not match:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            if not self._authorized():
                return
            try:
                if preparation is not None:
                    preparation.cancel_book(match.group(1))
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

        def _memory_request(self, path, method):
            match = re.fullmatch(r'/api/revisions/([0-9a-f-]+)/memory(?:/([0-9a-f-]+))?', path)
            if path != '/api/memory' and not match:
                return False
            if not self._authorized():
                return True
            try:
                if method == 'GET' and path == '/api/memory':
                    result = {'items': memory.list()}
                elif match and method == 'GET' and match[2]:
                    result = {'item': memory.get(match[1], match[2])}
                elif match and method == 'POST' and not match[2]:
                    payload = self._read_json()
                    if not isinstance(payload, dict) or set(payload) != {'source_kind', 'source_id'}:
                        raise ValueError('仅接受持久来源类型与标识。')
                    result = {'item': memory.collect(match[1], payload['source_kind'], payload['source_id'])}
                elif match and method == 'DELETE' and match[2]:
                    memory.remove(match[1], match[2])
                    result = {'removed': True}
                else:
                    self._json(HTTPStatus.METHOD_NOT_ALLOWED, {'error': '不支持此操作。'})
                    return True
                self._json(HTTPStatus.OK, result)
            except (ValueError, TypeError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {'error': str(exc)})
            except LookupError as exc:
                self._json(HTTPStatus.NOT_FOUND, {'error': str(exc)})
            return True

        def _authorized(self) -> bool:
            supplied = "" if profile.beta else self.headers.get("X-Reader-Token", "")
            cookie = SimpleCookie()
            cookie.load(self.headers.get("Cookie", ""))
            cookie_token = cookie.get(cookie_name)
            if hmac.compare_digest(supplied, token) or (
                cookie_token is not None and hmac.compare_digest(cookie_token.value, token)
            ):
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

        def _provider_failure(
            self, failure: ProviderFailure, *, streaming: bool = False
        ) -> None:
            payload = {
                "code": (
                    "AI_RESPONSE_LENGTH_LIMIT"
                    if failure.code == "response_length_limit"
                    else f"AI_{failure.kind.value}"
                ),
                "error": failure.user_message,
                "retryable": failure.code in {"ai_busy", "key_busy", "ai_disabled"},
                "failure_code": failure.code,
            }
            diagnostics = failure.diagnostics or {}
            metrics = {
                key: diagnostics.get(key)
                for key in ("ttft_ms", "latency_ms")
                if isinstance(diagnostics.get(key), int)
            }
            if metrics:
                payload["metrics"] = metrics
            if streaming:
                self._assistant_stream_event({"type": "error", **payload})
            else:
                self._json(HTTPStatus.SERVICE_UNAVAILABLE, payload)

        def _assistant_state_failure(
            self, failure: AssistantStateError, *, streaming: bool = False
        ) -> None:
            self._assistant_failure(
                streaming,
                HTTPStatus.CONFLICT,
                f"ASSISTANT_{failure.code}",
                failure.user_message,
            )

        def _assistant_failure(
            self, streaming: bool, status: HTTPStatus, code: str, message: str
        ) -> None:
            payload = {"code": code, "error": message}
            if streaming:
                self._assistant_stream_event({"type": "error", **payload})
            else:
                self._json(status, payload)

        def _wants_assistant_stream(self) -> bool:
            return "text/event-stream" in self.headers.get("Accept", "").casefold()

        def _start_assistant_stream(self) -> None:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "close")
            self.end_headers()
            self._assistant_stream_event({"type": "stage", "stage": "preparing"})

        def _assistant_stream_event(self, payload: dict) -> None:
            if self.server.stopping.is_set():
                raise StreamConsumerDisconnected()
            self._project_assistant_view(payload)
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            try:
                self.wfile.write(f"data: {encoded}\n\n".encode("utf-8"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError) as exc:
                raise StreamConsumerDisconnected() from exc

        def _start_guide_stream(self) -> None:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("Connection", "close")
            self.end_headers()

        def _guide_stream_event(self, payload: dict) -> None:
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            try:
                self.wfile.write(f"data: {encoded}\n\n".encode("utf-8"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError) as exc:
                raise StreamConsumerDisconnected() from exc

        def _static(self, path: str, directory: Path) -> None:
            filename = {"/": "index.html", "/index.html": "index.html"}.get(path)
            if filename is None and path in (
                "/beta-ui.js", "/pdf-network.js", "/screens.js", "/screens.css", "/app.js", "/assistant-navigator.js", "/assistant-render.js", "/assistant-stream.js", "/master-ui.js", "/memory-ui.js", "/guide-ui.js", "/inline-ui.js", "/inline-placement.js", "/styles.css", "/geometry.js", "/selection.js"
            ):
                filename = path[1:]
            if filename is None:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
                return
            target = directory.joinpath(filename)
            content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix in (".js", ".mjs"):
                content_type = "text/javascript; charset=utf-8"
            headers = None
            if filename == "index.html":
                headers = {
                    "Set-Cookie": (
                        f"{cookie_name}={token}; Path=/; HttpOnly; SameSite=Strict" + ("; Secure" if profile.beta else "")
                    )
                }
                if profile.beta:
                    html = target.read_text(encoding="utf-8").replace('<html lang="zh-CN">', '<html lang="zh-CN" data-profile="beta">')
                    html = re.sub(r'<option value="(?:zhipu|openrouter)"[^>]*>.*?</option>', '', html)
                    html = html.replace('本地保存', '独立实例保存').replace('仅保存在这台电脑上', '保存在你的独立服务器实例中')
                    encoded = html.encode("utf-8")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(encoded)))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Set-Cookie", headers["Set-Cookie"])
                    self.end_headers()
                    self.wfile.write(encoded)
                    return
            self._file(target, content_type, headers=headers)

        def _file(
            self,
            path: Path,
            content_type: str,
            ranged: bool = False,
            headers: dict[str, str] | None = None,
        ) -> None:
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
            for name, value in (headers or {}).items():
                self.send_header(name, value)
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
            # Browser tree navigation needs summaries plus the focused conversation only.
            # Full service state stays in memory; a focus request lazily restores its turns.
            self._project_assistant_view(payload)
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

        def _project_assistant_view(self, payload: dict) -> None:
            if self.headers.get("X-Assistant-View") != "current":
                return
            assistant_view = payload.get("assistant")
            if not isinstance(assistant_view, dict):
                return
            for root in assistant_view.get("roots", []):
                root.pop("turns", None)
                for node in root.get("nodes", []):
                    node.pop("turns", None)

        def _preparation_events(
            self, coordinator: PreparationCoordinator, revision_id: str
        ) -> None:
            try:
                revision = coordinator.foundation.ensure_revision(revision_id)
                coordinator.jobs.enqueue_pages(
                    revision_id, revision["page_count"], revision["foundation_version"]
                )
            except LookupError as exc:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(exc)})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            previous = None
            deadline = time.monotonic() + 25
            while time.monotonic() < deadline and not self.server.stopping.is_set():
                try:
                    pages = coordinator.foundation.statuses(revision_id)
                except LookupError:
                    # The book may be deleted while an already-open SSE stream winds down.
                    return
                signature = tuple(
                    (page["pdf_page_index"], page["status"], page["prepared_at"], page["failure_code"])
                    for page in pages
                )
                if signature != previous:
                    payload = json.dumps({"pages": pages}, ensure_ascii=False, separators=(",", ":"))
                    try:
                        self.wfile.write(f"event: pages\ndata: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                        return
                    previous = signature
                if pages and all(page["status"] in ("READY", "FAILED") for page in pages):
                    return
                time.sleep(0.25)

        def log_message(self, format: str, *args: object) -> None:
            if profile.beta:
                # send_error/log_error also reach this hook with raw request text.
                code = str(args[1]) if format == '"%s" %s %s' and len(args) > 1 else "error"
                print(f"request status={code if re.fullmatch(r'[1-5][0-9]{2}', code) else 'error'}")
                return
            # Deliberately omit URLs so the per-launch token never enters logs.
            print(f"{self.client_address[0]} {args[1] if len(args) > 1 else '-'}")

    return Handler


def _first(parameters: dict[str, list[str]], key: str) -> str | None:
    values = parameters.get(key)
    return values[0] if values else None
