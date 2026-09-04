from __future__ import annotations

import hashlib
import json
import re
import threading
import unicodedata
from pathlib import Path
from uuid import UUID, uuid5

from pypdf import PdfReader

from reader_service.foundation import PageLabelService
from reader_service.library import LibraryService

from .repository import OutlineRepository


PARSER_VERSION = "toc-geometry-v1"
_NODE_NAMESPACE = UUID("496c8afc-233d-4ccd-a2ce-c86ca4d060ac")
_CHAPTER = re.compile(r"^第\s*(\d+)\s*章\s*(.+)$")
_NUMBERED = re.compile(r"^[*＊]?\s*(\d+(?:\.\d+){1,2})\s+(.+)$")
_WATERMARKS = (
    re.compile(r"(?i)CIWEIYUNYIN"),
    re.compile(r"刺猬云印(?:·在线打印)?"),
    re.compile(r"公众号\s*[:：]?\s*研池悟空"),
    re.compile(r"微信扫一扫.*$"),
)


class OutlineService:
    """Pass-1 logical bootstrap. It never consumes body-heading evidence."""

    def __init__(
        self,
        library: LibraryService,
        repository: OutlineRepository,
        page_labels: PageLabelService,
    ):
        self.library = library
        self.repository = repository
        self.page_labels = page_labels
        self._lock = threading.Lock()
        self._bookmarks: dict[str, list[dict]] = {}

    def bootstrap(self, revision_id: str) -> dict:
        with self._lock:
            self.library.revision(revision_id)
            label_snapshot = self.page_labels.infer(revision_id)
            source, raw = self._bookmark_candidates(
                revision_id, self.library.pdf_path(revision_id)
            )
            waiting = False
            if not raw:
                statuses, pages = self.repository.ready_snapshot(revision_id)
                raw, waiting = self._toc_candidates(statuses, pages)
                source = "TOC"
            if not raw:
                return {
                    "nodes": self.repository.list(revision_id),
                    "evidence_source": None,
                    "waiting_for_toc_completion": waiting,
                    "identity_conflict": False,
                    "page_labels": label_snapshot,
                }

            nodes = self._build_nodes(revision_id, source, raw)
            self._apply_safe_targets(revision_id, nodes)
            evidence_digest = _digest(raw)
            structure_digest = self._structure_digest(nodes)
            record = self.repository.bootstrap_record(revision_id)
            if record is None:
                self.repository.commit(
                    revision_id,
                    nodes,
                    parser_version=PARSER_VERSION,
                    evidence_source=source,
                    evidence_digest=evidence_digest,
                    structure_digest=structure_digest,
                )
            elif record["structure_digest"] != structure_digest:
                conflict_digest = _digest(
                    {"prior": record["structure_digest"], "candidate": structure_digest}
                )
                self.repository.record_conflict(revision_id, conflict_digest)
                return {
                    "nodes": self.repository.list(revision_id),
                    "evidence_source": record["evidence_source"],
                    "waiting_for_toc_completion": False,
                    "identity_conflict": True,
                    "page_labels": label_snapshot,
                }

            stored = self.repository.list(revision_id)
            targets = self._safe_targets(stored)
            self.repository.apply_targets(revision_id, targets)
            return {
                "nodes": self.repository.list(revision_id),
                "evidence_source": source,
                "waiting_for_toc_completion": False,
                "identity_conflict": False,
                "page_labels": label_snapshot,
            }

    def set_manual_page_label(
        self, revision_id: str, page_index: int, printed_label: str
    ) -> dict:
        label = self.page_labels.set_manual(revision_id, page_index, printed_label)
        nodes = self.repository.list(revision_id)
        if nodes:
            self.repository.apply_targets(revision_id, self._safe_targets(nodes))
        return label

    def page_label_snapshot(self, revision_id: str) -> dict:
        values = self.page_labels.infer(revision_id)
        return values

    def _bookmark_candidates(self, revision_id: str, pdf_path: Path) -> tuple[str, list[dict]]:
        cached = self._bookmarks.get(revision_id)
        if cached is not None:
            return "BOOKMARK", [dict(item) for item in cached]
        candidates: list[dict] = []
        # Own and close the stream deterministically: Windows otherwise keeps the
        # source PDF undeletable until a PdfReader happens to be garbage-collected.
        with pdf_path.open("rb") as stream:
            reader = PdfReader(stream, strict=True)
            outline = reader.outline

            def walk(items, depth: int, path: tuple[int, ...]) -> None:
                sibling = 0
                for item in items:
                    if isinstance(item, list):
                        walk(item, depth + 1, path + (max(0, sibling - 1),))
                        continue
                    title = " ".join(str(getattr(item, "title", "")).split()).strip()
                    if not title:
                        sibling += 1
                        continue
                    try:
                        start_page = reader.get_destination_page_number(item)
                    except Exception:
                        start_page = None
                    candidates.append(
                        {
                            "key": "bookmark:" + ".".join(map(str, path + (sibling,))),
                            "title": title,
                            "depth": depth,
                            "printed_label_hint": None,
                            "start_page": (
                                start_page
                                if isinstance(start_page, int) and start_page >= 0
                                else None
                            ),
                            "confidence": 1.0,
                            "evidence": {
                                "source": "BOOKMARK",
                                "path": list(path + (sibling,)),
                            },
                        }
                    )
                    sibling += 1

            walk(outline, 0, ())
        self._bookmarks[revision_id] = [dict(item) for item in candidates]
        return "BOOKMARK", candidates

    def _toc_candidates(
        self, statuses: list[dict], pages: dict[int, list[dict]]
    ) -> tuple[list[dict], bool]:
        ready = {row["pdf_page_index"]: row["status"] == "READY" for row in statuses}
        toc_pages = {
            page_index: self._parse_toc_page(page_index, lines)
            for page_index, lines in pages.items()
        }
        toc_pages = {page: rows for page, rows in toc_pages.items() if len(rows) >= 3}
        if not toc_pages:
            return [], False
        blocks: list[list[int]] = []
        for page_index in sorted(toc_pages):
            if not blocks or page_index != blocks[-1][-1] + 1:
                blocks.append([])
            blocks[-1].append(page_index)
        block = max(blocks, key=lambda value: (len(value), -value[0]))
        after = block[-1] + 1
        complete = after >= len(statuses) or ready.get(after, False) and after not in toc_pages
        if not complete:
            return [], True
        candidates: list[dict] = []
        for page_index in block:
            candidates.extend(toc_pages[page_index])
        return candidates, False

    @classmethod
    def _parse_toc_page(cls, page_index: int, lines: list[dict]) -> list[dict]:
        prepared = []
        numeric_right = 0
        for line in lines:
            quad = line["quad"]
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
            x0, x1 = min(xs), max(xs)
            y = (min(ys) + max(ys)) / 2
            text = cls.classification_text(line["text"])
            if not text:
                continue
            if x0 > 0.72 and re.fullmatch(r"[·.\-— ]*\d{1,4}[·.\-— ]*", text):
                numeric_right += 1
            if x0 < 0.72 and 0.09 < y < 0.93:
                prepared.append({**line, "text": text, "x0": x0, "x1": x1, "y": y})
        if numeric_right < 3:
            return []

        groups: list[list[dict]] = []
        for line in sorted(prepared, key=lambda item: (item["y"], item["x0"])):
            if not groups or abs(line["y"] - sum(x["y"] for x in groups[-1]) / len(groups[-1])) > 0.008:
                groups.append([])
            groups[-1].append(line)
        labels = []
        for line in lines:
            quad = line["quad"]
            xs = [float(point[0]) for point in quad]
            ys = [float(point[1]) for point in quad]
            if min(xs) <= 0.72:
                continue
            match = re.fullmatch(r"[·.\-— ]*(\d{1,4})[·.\-— ]*", line["text"].strip())
            if match:
                labels.append(((min(ys) + max(ys)) / 2, match.group(1), line["line_ordinal"]))

        result = []
        for group in groups:
            text = " ".join(item["text"] for item in sorted(group, key=lambda item: item["x0"]))
            text = " ".join(text.split())
            chapter = _CHAPTER.fullmatch(text)
            numbered = _NUMBERED.fullmatch(text)
            if chapter:
                number = chapter.group(1)
                title = f"第{number}章 {chapter.group(2).strip()}"
                depth = 0
                key = f"chapter:{number}"
            elif numbered:
                number = numbered.group(1)
                title = f"{number} {numbered.group(2).strip()}"
                depth = number.count(".")
                key = f"number:{number}"
            else:
                continue
            center_y = sum(item["y"] for item in group) / len(group)
            close = sorted(labels, key=lambda item: abs(item[0] - center_y))
            printed = close[0][1] if close and abs(close[0][0] - center_y) <= 0.012 else None
            result.append(
                {
                    "key": key,
                    "title": title,
                    "depth": depth,
                    "printed_label_hint": printed,
                    "start_page": None,
                    "confidence": min(float(item["confidence"]) for item in group),
                    "evidence": {
                        "source": "TOC",
                        "pdf_page_index": page_index,
                        "line_ordinals": [item["line_ordinal"] for item in group],
                    },
                }
            )
        return result

    @staticmethod
    def classification_text(value: str) -> str:
        """Normalize a classification copy only; the persisted OCRLine is untouched."""
        text = unicodedata.normalize("NFKC", value)
        for pattern in _WATERMARKS:
            text = pattern.sub(" ", text)
        return " ".join(text.split()).strip(" ·|-")

    @staticmethod
    def _kind(title: str, depth: int) -> str:
        if "习题" in title:
            return "EXERCISES"
        if "答案" in title or "解析" in title:
            return "ANSWERS"
        return ("CHAPTER", "SECTION", "SUBSECTION")[min(depth, 2)]

    @classmethod
    def _build_nodes(cls, revision_id: str, source: str, raw: list[dict]) -> list[dict]:
        nodes: list[dict] = []
        stack: dict[int, str] = {}
        sibling_counts: dict[str | None, int] = {}
        seen_keys: dict[str, int] = {}
        for item in raw:
            depth = min(max(int(item["depth"]), 0), 2)
            parent_id = stack.get(depth - 1) if depth else None
            # An orphan cannot be silently attached to an invented parent.
            if depth and parent_id is None:
                continue
            occurrence = seen_keys.get(item["key"], 0)
            seen_keys[item["key"]] = occurrence + 1
            logical_key = f"{item['key']}#{occurrence}" if occurrence else item["key"]
            node_id = str(uuid5(_NODE_NAMESPACE, f"{revision_id}:{source}:{logical_key}"))
            order_index = sibling_counts.get(parent_id, 0)
            sibling_counts[parent_id] = order_index + 1
            node = {
                **item,
                "book_source_revision_id": revision_id,
                "outline_node_id": node_id,
                "parent_id": parent_id,
                "depth": depth,
                "order_index": order_index,
                "kind": cls._kind(item["title"], depth),
            }
            nodes.append(node)
            stack[depth] = node_id
            for deeper in tuple(level for level in stack if level > depth):
                del stack[deeper]
        return nodes

    def _apply_safe_targets(self, revision_id: str, nodes: list[dict]) -> None:
        label_targets = self.page_labels.repository.resolve_labels(revision_id)
        for node in nodes:
            if node["evidence"]["source"] == "TOC":
                node["start_page"] = label_targets.get(node["printed_label_hint"])
        targets = self._safe_targets(nodes)
        for node in nodes:
            node["start_page"] = targets[node["outline_node_id"]]

    def _safe_targets(self, nodes: list[dict]) -> dict[str, int | None]:
        label_targets = self.page_labels.repository.resolve_labels(
            self._revision_id_from_nodes(nodes)
        ) if nodes and "book_source_revision_id" in nodes[0] else None
        targets: dict[str, int | None] = {}
        previous: dict[str | None, int] = {}
        for node in self._topological(nodes):
            page = node.get("start_page")
            if label_targets is not None and node.get("evidence", {}).get("source") == "TOC":
                page = label_targets.get(node.get("printed_label_hint"))
            parent = node.get("parent_id")
            if page is not None and parent in previous and page < previous[parent]:
                page = None
            if page is not None:
                previous[parent] = page
            targets[node["outline_node_id"]] = page
        return targets

    @staticmethod
    def _revision_id_from_nodes(nodes: list[dict]) -> str:
        return str(nodes[0]["book_source_revision_id"])

    @staticmethod
    def _topological(nodes: list[dict]) -> list[dict]:
        children: dict[str | None, list[dict]] = {}
        for node in nodes:
            children.setdefault(node.get("parent_id"), []).append(node)
        for values in children.values():
            values.sort(key=lambda node: (node["order_index"], node["outline_node_id"]))
        result = []
        def visit(parent: str | None) -> None:
            for node in children.get(parent, []):
                result.append(node)
                visit(node["outline_node_id"])
        visit(None)
        return result

    @staticmethod
    def _structure_digest(nodes: list[dict]) -> str:
        projection = [
            {
                key: node[key]
                for key in (
                    "outline_node_id", "parent_id", "depth", "order_index", "kind", "title",
                    "printed_label_hint",
                )
            }
            for node in OutlineService._topological(nodes)
        ]
        return _digest(projection)


def _digest(value) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()
