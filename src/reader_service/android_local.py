"""Android adapters around the shared Reader Core, with no desktop fallback.

Java classes are supplied by the APK entry point. Importing this module does not
start a server, access an Android device, or initialize an OCR/model runtime.
"""

from __future__ import annotations

import json
import math
import secrets
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

from reader_service.agent_runtime import ProviderRuntimeSet
from reader_service.agent_runtime.credentials import CredentialRead
from reader_service.agent_runtime.deepseek import OpenAICompatibleAdapter
from reader_service.agent_runtime.runtime import (
    AgentRuntime, PayloadInspector, ProviderConfig, ProviderFailure,
    ProviderFailureKind, PROVIDER_NAMES,
)
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.assistant import AssistantContextBuilder, AssistantService
from reader_service.foundation import FoundationRepository, FoundationService, PageLabelRepository, PageLabelService
from reader_service.foundation.contracts import DetectedLine, PagePreparationError
from reader_service.jobs import JobRepository, PreparationCoordinator
from reader_service.knowledge import KnowledgeRepository, KnowledgeService
from reader_service.learning.service import LearningService
from reader_service.library import LibraryService
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.saved_explanations import SavedExplanationService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
from reader_service.tablet_page_images import PageImage, PageImageUnavailable, _render_dimensions
from reader_service.png_page import inspect_png
from reader_service.teaching.service import TeachingService
from reader_service.visual_region import MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE


def _native_json(value) -> dict:
    result = json.loads(str(value))
    if not isinstance(result, dict):
        raise ValueError("本机 PDF 引擎返回了无效结果。")
    return result


class AndroidDocuments:
    """Normalize native PDF/OCR output at existing Foundation/render boundaries."""

    def __init__(self, paths: ManagedPaths, bridge):
        self.paths = paths
        self.bridge = bridge
        self.temporary = paths.resolve("tmp/android-native")
        self.temporary.mkdir(parents=True, exist_ok=True)

    def _output(self) -> Path:
        descriptor, name = tempfile.mkstemp(prefix="page-", suffix=".png", dir=self.temporary)
        import os
        os.close(descriptor)
        return Path(name)

    def render_page(self, source, page_index, width, _page_count):
        output = self._output()
        try:
            result = _native_json(self.bridge.renderPage(str(source), page_index, width, str(output)))
            pdf_width, pdf_height = float(result["pdf_width"]), float(result["pdf_height"])
            _, height = _render_dimensions(pdf_width, pdf_height, width)
            body = output.read_bytes()
            actual_width, actual_height, _ = inspect_png(body)
            if ((actual_width, actual_height) != (width, height)
                    or result.get("width") != width or result.get("height") != height):
                raise ValueError("本机 PDF 页图尺寸与原页不一致。")
            return PageImage(body, pdf_width, pdf_height, width, height, False)
        except Exception as exc:
            raise PageImageUnavailable("无法在本机显示 PDF 页图，请重新打开教材。") from exc
        finally:
            output.unlink(missing_ok=True)

    def extract(self, source, page_index, dpi):
        try:
            result = _native_json(self.bridge.extractPage(str(source), page_index, dpi))
            if result.get("route") not in ("OCR", "EMBEDDED"):
                raise ValueError("Unknown native text route")
            profile = result.get("engine_profile")
            if not isinstance(profile, str) or not profile.strip() or len(profile) > 160:
                raise ValueError("Unknown native text profile")
            raw_lines = result.get("lines")
            if not isinstance(raw_lines, list):
                raise ValueError("Invalid native text lines")
            lines = [self._line(line) for line in raw_lines]
            if not lines and result.get("visible"):
                raise PagePreparationError("OCR_EMPTY_ON_NONBLANK_PAGE", "本页有内容，但本机未识别到文字，可稍后重试。")
            return result["route"], profile, lines
        except PagePreparationError:
            raise
        except Exception as exc:
            if "OCR_EMPTY_ON_NONBLANK_PAGE" in str(exc):
                raise PagePreparationError("OCR_EMPTY_ON_NONBLANK_PAGE", "本页有内容，但本机未识别到文字，可稍后重试。") from exc
            raise PagePreparationError("ANDROID_PAGE_PREPARE_FAILED", "本机文字准备失败，请重试本页。") from exc

    @staticmethod
    def _line(line):
        if not isinstance(line, dict) or not isinstance(line.get("text"), str) or not line["text"]:
            raise ValueError("Invalid native text line")
        text = line["text"]
        quad = line.get("quad")
        if not isinstance(quad, list) or len(quad) != 4:
            raise ValueError("Invalid native text quad")
        normalized = []
        for point in quad:
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError("Invalid native text point")
            if any(type(v) not in (int, float) or not math.isfinite(v) or not 0 <= v <= 1 for v in point):
                raise ValueError("Invalid native text coordinate")
            normalized.append(tuple(point))
        confidence = line.get("confidence", 1.0)
        if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("Invalid native text confidence")
        cells = []
        for cell in line.get("cells", []):
            if (not isinstance(cell, list) or len(cell) != 4
                    or any(type(v) not in (int, float) or not math.isfinite(v) for v in cell[:2])
                    or not 0 <= cell[0] < cell[1] <= 1
                    or any(type(v) is not int for v in cell[2:])
                    or not 0 <= cell[2] < cell[3] <= len(text)):
                raise ValueError("Invalid native character geometry")
            cells.append(tuple(cell))
        if not cells:
            raise ValueError("Native text is missing selectable character geometry")
        return DetectedLine(tuple(normalized), text, float(confidence), tuple(cells))

    def has_visible_content(self, source, page_index):
        output = self._output()
        try:
            result = _native_json(self.bridge.renderPage(str(source), page_index, 128, str(output)))
            return bool(result.get("visible", True))
        except Exception:
            return True
        finally:
            output.unlink(missing_ok=True)

    def render_region(self, source, page_index, rect, _page_count):
        output = self._output()
        try:
            # The native implementation enforces both side and area budgets.
            result = _native_json(self.bridge.cropPage(str(source), page_index, json.dumps(rect), MAX_IMAGE_SIDE, str(output)))
            body = output.read_bytes()
            width, height, _ = inspect_png(body)
            if (min(width, height) < MIN_IMAGE_SIDE
                    or max(width, height) > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS
                    or result.get("width") != width or result.get("height") != height):
                raise ValueError("本机 PDF 选区图像超过图像预算。")
            return body, width, height
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("无法在本机读取教材选区，请重新打开教材后再试。") from exc
        finally:
            output.unlink(missing_ok=True)


class AndroidFoundation(FoundationService):
    def __init__(self, library, repository, documents, *, render_dpi=200):
        super().__init__(library, repository, lambda: None, render_dpi=render_dpi)
        self.documents = documents

    def _extract(self, pdf_path, page_index):
        return self.documents.extract(pdf_path, page_index, self.render_dpi)

    def _page_has_visible_content(self, pdf_path, page_index):
        return self.documents.has_visible_content(pdf_path, page_index)


class AndroidAgentRuntime(AgentRuntime):
    def __init__(self, provider, native_credentials, inspector):
        self.native_credentials = native_credentials
        super().__init__(OpenAICompatibleAdapter(provider),
                         config=ProviderConfig.from_environment(provider),
                         credential_loader=lambda: None, inspector=inspector)

    def _credential_read(self):
        if self.config.provider not in ("deepseek", "zhipu"):
            return CredentialRead(False, "ANDROID_KEYSTORE", "PROVIDER_DISABLED")
        try:
            if not self.native_credentials.isOnline():
                return CredentialRead(False, "ANDROID_KEYSTORE", "OFFLINE")
            raw = self.native_credentials.read(self.config.provider)
            key = str(raw).strip() if raw is not None else ""
        except Exception:
            return CredentialRead(False, "ANDROID_KEYSTORE", "CREDENTIAL_READ_FAILED")
        return CredentialRead(bool(key), "ANDROID_KEYSTORE", None if key else "CREDENTIAL_NOT_FOUND", key or None)

    def complete_with_metadata(self, messages, **kwargs):
        if self.config.provider not in ("deepseek", "zhipu"):
            raise ProviderFailure(ProviderFailureKind.UNCONFIGURED, "provider_disabled", "此平板版仅支持 DeepSeek 和智谱。")
        try:
            online = bool(self.native_credentials.isOnline())
        except Exception:
            online = False
        if not online:
            raise ProviderFailure(ProviderFailureKind.USER_ACTIONABLE, "offline", "当前离线，联网后可继续使用 AI；已有学习内容仍可阅读。")
        return super().complete_with_metadata(messages, **kwargs)


def android_providers(native_credentials):
    inspector = PayloadInspector()
    return ProviderRuntimeSet({
        provider: AndroidAgentRuntime(provider, native_credentials, inspector)
        for provider in PROVIDER_NAMES
    }, active_provider="deepseek", bakeoff_enabled=False, inspector=inspector)


class AndroidReaderServer(ReaderServer):
    """Track in-flight local writes so a library import can truly stop Core."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._requests = threading.Condition()
        self._active_requests = 0
        self.stopping = False

    def process_request(self, request, client_address):
        if self.stopping:
            self.shutdown_request(request)
            return
        request.settimeout(120)
        with self._requests:
            self._active_requests += 1
        try:
            super().process_request(request, client_address)
        except BaseException:
            with self._requests:
                self._active_requests -= 1
                self._requests.notify_all()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self._requests:
                self._active_requests -= 1
                self._requests.notify_all()

    def wait_for_requests(self):
        with self._requests:
            while self._active_requests:
                self._requests.wait(timeout=.5)


@dataclass
class AndroidReader:
    library: LibraryService
    documents: AndroidDocuments
    foundation: AndroidFoundation
    preparation: PreparationCoordinator
    runtime: ProviderRuntimeSet
    server: ReaderServer
    url: str
    background_services: tuple = ()
    thread: threading.Thread | None = None

    def run(self):
        if self.thread is not None:
            return
        self.preparation.start()
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": .2}, name="android-reader-http", daemon=True)
        self.thread.start()

    def stop(self):
        self.server.stopping = True
        if self.thread is not None:
            self.server.shutdown()
            self.thread.join(timeout=3)
            self.thread = None
        self.server.server_close()
        workers = list(self.preparation._threads)
        mapping = self.preparation._map_thread
        self.preparation.stop(timeout=0)
        # A current OCR/AI operation may still own a DB transaction. Waiting in
        # the native worker is necessary before atomically replacing a library.
        for worker in workers:
            worker.join()
        if mapping is not None:
            mapping.join()
        self.server.wait_for_requests()
        for service in self.background_services:
            if hasattr(service, "wait_for_idle"):
                while not service.wait_for_idle(timeout=1):
                    pass
            elif hasattr(service, "_inflight"):
                while True:
                    with service._lock:
                        busy = bool(service._inflight)
                    if not busy:
                        break
                    time.sleep(.05)
        for service in getattr(self.server.RequestHandlerClass, "background_services", ()):
            worker = getattr(service, "_worker", None)
            if worker is not None:
                worker.join()


def create_reader(data_dir, web_root, document_bridge, native_credentials, *, port=18765):
    """Build the existing full Core against APK-local storage and native engines."""
    paths = ManagedPaths(Path(data_dir).resolve())
    web_root = Path(web_root).resolve()
    library = LibraryService(paths)
    documents = AndroidDocuments(paths, document_bridge)
    library.region_renderer = documents.render_region
    foundation = AndroidFoundation(library, FoundationRepository(library.database), documents)
    labels = PageLabelService(library, PageLabelRepository(library.database))
    outline = OutlineService(library, OutlineRepository(library.database), labels)
    annotations = AnnotationService(foundation, AnnotationRepository(library.database))
    runtime = android_providers(native_credentials)
    knowledge = KnowledgeService(library, foundation, outline, KnowledgeRepository(library.database), runtime)
    teaching = TeachingService(library.database, runtime)
    preparation = PreparationCoordinator(library, foundation, JobRepository(library.database),
                                         worker_count=1, outline=outline, knowledge=knowledge, teaching=teaching)
    assistant = AssistantService(AssistantContextBuilder(foundation, outline), runtime)
    saved = SavedExplanationService(assistant, annotations, runtime)
    learning = LearningService(library.database, foundation, runtime)
    token = secrets.token_urlsafe(32)
    static = web_root / "static"
    server = AndroidReaderServer(("127.0.0.1", port), handler_factory(
        library, token, project_root=web_root, preparation=preparation,
        annotations=annotations, outline=outline, knowledge=knowledge,
        assistant=assistant, saved_explanations=saved, learning=learning, teaching=teaching,
        tablet_local=True, page_renderer=documents.render_page,
        static_directory=static if static.is_dir() else None,
    ))
    url = f"http://127.0.0.1:{server.server_port}/?" + urlencode({"tablet": "1", "local": "1", "token": token})
    return AndroidReader(library, documents, foundation, preparation, runtime, server, url,
                         background_services=(learning, saved))
