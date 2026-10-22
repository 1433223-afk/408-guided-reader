"""Bounded, credential-free route descriptions for the opt-in Tablet Demo."""
from __future__ import annotations

from urllib.parse import urlparse


_ROUTE_WORDS = frozenset("""api books revisions ink page-image pdf-index pdf position overlay annotations
preparation events outline page-labels search knowledge learning status health sections points chapters
entries memory favorites practice questions records guide inline teaching assistant master messages
context sessions review hint generate regenerate prepare confirm preferences reading-context section-reading
practice-prototype catalog knowledge-map inline-teaching follow-up child retry-child bake-off save retry
providers history visual-region readiness attempt favorite knowledge-links inspection open send app.js tablet.css
tablet-connection.js tablet-pdf-pages.js tablet-reader-ui.js tablet-tool-rail.js tablet-layout.js tablet-touch.js tablet-pen.js tablet-ink.js tablet-ink-store.js tablet-app.apk tablet-pen-check.html tablet-pen-check.css tablet-pen-check.js""".split())
_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})


def tablet_request_diagnostic(method: str, target: str, status: int | None, elapsed_ms: float) -> dict:
    """Never log a raw URL, identifier, query, header, filename, or response body."""
    try:
        parts = urlparse(target).path.split("/")
        route = "/" + "/".join(part if part in _ROUTE_WORDS else ":id"
                                 for part in [part for part in parts if part][:12])
    except (TypeError, ValueError):
        route = "/:unknown"
    return {
        "method": method if method in _METHODS else "OTHER",
        "route": route,
        "status": status if isinstance(status, int) and 100 <= status <= 599 else None,
        "elapsed_ms": max(0, min(600000, round(elapsed_ms))),
    }
