"""Small, revalidated LAN asset responses; never cache HTML or reader data."""

from functools import lru_cache
import gzip
from pathlib import Path


def accepts_gzip(header: str) -> bool:
    for entry in header.lower().split(","):
        coding, *parameters = entry.strip().split(";")
        if coding != "gzip":
            continue
        for parameter in parameters:
            key, _, value = parameter.strip().partition("=")
            if key == "q":
                try:
                    return float(value) > 0
                except ValueError:
                    return False
        return True
    return False


@lru_cache(maxsize=32)
def asset_body(path: Path, modified_ns: int, size: int, compressed: bool) -> bytes:
    body = path.read_bytes()
    return gzip.compress(body, compresslevel=6, mtime=0) if compressed else body


def asset_response(path: Path, accept_encoding: str) -> tuple[bytes, str, bool]:
    stat = path.stat()
    compressed = accepts_gzip(accept_encoding)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}-{"gzip" if compressed else "raw"}"'
    return asset_body(path, stat.st_mtime_ns, stat.st_size, compressed), etag, compressed
