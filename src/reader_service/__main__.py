from __future__ import annotations

import argparse
import os
import secrets
import threading
import webbrowser
from pathlib import Path
from urllib.parse import quote

from reader_service.library import LibraryService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths


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
    return parser


def main() -> None:
    args = build_parser().parse_args()
    token = args.token or secrets.token_urlsafe(32)
    service = LibraryService(ManagedPaths(args.data_dir))
    server = ReaderServer((args.host, args.port), handler_factory(service, token))
    host, port = server.server_address[:2]
    url = f"http://{host}:{port}/?token={quote(token)}"
    print(f"READY {url}", flush=True)
    print("Keep this terminal open while reading. Copy the READY URL into Chrome or Edge if no browser opens.", flush=True)
    if not args.no_open:
        threading.Timer(0.2, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
