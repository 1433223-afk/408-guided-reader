from __future__ import annotations

import argparse
import os
import secrets
import signal
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
from reader_service.instance import InstanceLock, InstanceProfile
from reader_service.disk import DiskGuard
from reader_service.agent_runtime.beta import BetaEgress, PrivateCredential


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
    parser.add_argument("--profile", choices=("personal", "beta"), default="personal")
    parser.add_argument("--public-origin")
    parser.add_argument("--credential-dir", type=Path)
    parser.add_argument("--ai-disabled-file", type=Path)
    parser.add_argument("--disk-margin-mib", type=int, default=2048)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    profile = InstanceProfile(args.profile, args.public_origin, args.credential_dir,
                              args.ai_disabled_file, args.disk_margin_mib * 1024**2)
    profile.validate(args.data_dir, args.host, args.prepare_workers)
    if profile.beta:
        if "--data-dir" not in __import__("sys").argv and not any(a.startswith("--data-dir=") for a in __import__("sys").argv):
            raise ValueError("Beta requires an explicit data directory")
        os.umask(0o077)
    with InstanceLock(args.data_dir):
        run(args, profile)


def run(args, profile):
    if profile.beta:
        PrivateCredential._check_private(args.data_dir, directory=True)
    token = args.token or secrets.token_urlsafe(32)
    disk_guard = DiskGuard(args.data_dir, profile.disk_margin) if profile.beta else None
    if disk_guard and not (args.data_dir / "state.sqlite3").exists():
        disk_guard.check()
    service = LibraryService(ManagedPaths(args.data_dir),
                             max_pdf_bytes=512 * 1024**2 if profile.beta else 2 * 1024**3,
                             disk_guard=disk_guard)
    if profile.beta:
        service.database.pending_ai_limit = 8
    foundation = FoundationService(
        service,
        FoundationRepository(service.database),
        (lambda: RapidOcrEngine(offline=True)) if profile.beta else RapidOcrEngine,
        render_dpi=args.render_dpi,
    )
    page_labels = PageLabelService(service, PageLabelRepository(service.database))
    outline = OutlineService(service, OutlineRepository(service.database), page_labels)
    annotations = AnnotationService(foundation, AnnotationRepository(service.database))
    beta_guard = (BetaEgress(PrivateCredential(profile.credential_dir), profile.ai_disabled_file,
                             disk_guard.check) if profile.beta else None)
    agent_runtime = ProviderRuntimeSet.for_beta(beta_guard) if beta_guard else ProviderRuntimeSet.from_environment()
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
            profile=profile,
            beta_guard=beta_guard,
        ),
        profile=profile,
    )
    preparation.start()
    host, port = server.server_address[:2]
    url = f"{profile.public_origin}/" if profile.beta else f"http://{host}:{port}/"
    print(f"READY {url}", flush=True)
    print(
        "Keep this terminal open while reading. Copy the READY URL into Chrome or Edge if no browser opens.",
        flush=True,
    )
    if not args.no_open and not profile.beta:
        threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    def stop(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.stopping.set()
        if beta_guard:
            beta_guard.stopping = True
        server.server_close()
        preparation.stop(timeout=None)
        # Background Master/save reviews may outlive their initiating HTTP request.
        # Keep the data lock until their final durable writes have finished.
        for thread in threading.enumerate():
            if thread.name.startswith(("master-", "saved-explanation-review-")):
                thread.join()


if __name__ == "__main__":
    main()
