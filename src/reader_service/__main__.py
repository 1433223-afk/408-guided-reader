from __future__ import annotations

import argparse
import os
import secrets
import threading
import webbrowser
from pathlib import Path

from reader_service.agent_runtime import ProviderRuntimeSet
from reader_service.annotation import AnnotationRepository, AnnotationService
from reader_service.assistant import AssistantContextBuilder, AssistantService
from reader_service.library import LibraryService
from reader_service.foundation import (
    FoundationRepository,
    FoundationService,
    PageLabelRepository,
    PageLabelService,
)
from reader_service.foundation.rapidocr_adapter import RapidOcrEngine
from reader_service.jobs import JobRepository, PreparationCoordinator
from reader_service.knowledge import KnowledgeRepository, KnowledgeService
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.server import ReaderServer, handler_factory
from reader_service.saved_explanations import SavedExplanationService
from reader_service.storage import ManagedPaths
from reader_service.learning.service import LearningService
from reader_service.teaching.service import TeachingService


def default_data_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data, "408 Guided Reader")
    return Path.cwd().joinpath("var", "reader-data")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the 408 Guided Reader")
    parser.add_argument("--host", default="127.0.0.1", choices=("127.0.0.1", "localhost"))
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--no-open", action="store_true", help="Do not launch the browser")
    parser.add_argument("--token", help=argparse.SUPPRESS)
    parser.add_argument("--prepare-workers", type=int, default=1)
    parser.add_argument("--render-dpi", type=int, default=200)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    token = args.token or secrets.token_urlsafe(32)
    service = LibraryService(ManagedPaths(args.data_dir))
    foundation = FoundationService(
        service,
        FoundationRepository(service.database),
        RapidOcrEngine,
        render_dpi=args.render_dpi,
    )
    page_labels = PageLabelService(service, PageLabelRepository(service.database))
    outline = OutlineService(service, OutlineRepository(service.database), page_labels)
    annotations = AnnotationService(foundation, AnnotationRepository(service.database))
    agent_runtime = ProviderRuntimeSet.from_environment()
    knowledge = KnowledgeService(
        service,
        foundation,
        outline,
        KnowledgeRepository(service.database),
        agent_runtime,
    )
    teaching = TeachingService(service.database, agent_runtime)
    preparation = PreparationCoordinator(
        service,
        foundation,
        JobRepository(service.database),
        worker_count=args.prepare_workers,
        outline=outline,
        knowledge=knowledge,
        teaching=teaching,
    )
    assistant = AssistantService(
        AssistantContextBuilder(foundation, outline),
        agent_runtime,
    )
    saved_explanations = SavedExplanationService(
        assistant,
        annotations,
        agent_runtime,
    )
    preparation.start()
    learning = LearningService(service.database, foundation, agent_runtime)
    server = ReaderServer(
        (args.host, args.port),
        handler_factory(
            service,
            token,
            preparation=preparation,
            annotations=annotations,
            outline=outline,
            knowledge=knowledge,
            assistant=assistant,
            saved_explanations=saved_explanations,
            learning=learning,
            teaching=teaching,
        ),
    )
    host, port = server.server_address[:2]
    url = f"http://{host}:{port}/"
    print(f"READY {url}", flush=True)
    print(
        "Keep this terminal open while reading. Copy the READY URL into Chrome or Edge if no browser opens.",
        flush=True,
    )
    if not args.no_open:
        threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        preparation.stop()


if __name__ == "__main__":
    main()
