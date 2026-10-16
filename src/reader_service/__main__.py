from __future__ import annotations

import argparse
import os
import secrets
import threading
from urllib.parse import urlencode
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
from reader_service.tablet_network import validate_tablet_address


def default_data_dir() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data, "408 Guided Reader")
    return Path.cwd().joinpath("var", "reader-data")


def default_prepare_workers() -> int:
    # Scanned books need every page OCR'd. On larger CPUs, a second page
    # worker reduces the full-book wait while leaving cores for the Reader UI.
    return 2 if (os.cpu_count() or 1) >= 12 else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the 408 Guided Reader")
    parser.add_argument("--host", default="127.0.0.1", choices=("127.0.0.1", "localhost"))
    parser.add_argument("--tablet-lan", metavar="PRIVATE_IPV4", help="Opt in to tablet access on one local RFC1918 IPv4 address")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--no-open", action="store_true", help="Do not launch the browser")
    parser.add_argument("--token", help=argparse.SUPPRESS)
    parser.add_argument("--prepare-workers", type=int, default=default_prepare_workers())
    parser.add_argument("--render-dpi", type=int, default=200)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.tablet_lan:
        try:
            args.host = validate_tablet_address(args.tablet_lan)
            from reader_service.tablet_demo import require_demo_data, configure_demo_providers
            require_demo_data(args.data_dir)
            configure_demo_providers()
        except ValueError as exc:
            parser.error(str(exc))
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
            tablet_lan=bool(args.tablet_lan),
        ),
    )
    host, port = server.server_address[:2]
    query = {"tablet": "1", "token": token} if args.tablet_lan else {"token": token}
    url = f"http://{host}:{port}/?{urlencode(query)}"
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
