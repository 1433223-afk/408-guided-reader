from __future__ import annotations

import hashlib
import json
import re
import threading
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path
from uuid import UUID, uuid5

from pypdf import PdfReader

from reader_service.foundation import PageLabelService
from reader_service.library import LibraryService

from .evidence import (
    AUXILIARY,
    NAMED,
    ORDINAL,
    named_hierarchy,
    ordinal,
    parse_named_toc,
    usable_bookmarks,
)
from .evidence import chapter_boundary as next_chapter_boundary
from .repository import OutlineRepository

PARSER_VERSION = "bookmark-evidence-v4+toc-named-hierarchy-v3"
_NODE_NAMESPACE = UUID("496c8afc-233d-4ccd-a2ce-c86ca4d060ac")
_CHAPTER = re.compile(r"^第\s*(\d+)\s*章\s*(.+)$")
_NUMBERED = re.compile(r"^[*＊]?\s*(\d+(?:\.\d+){1,2})\s+(.+)$")
_WATERMARKS = (
    re.compile(r"(?i)CIWEIYUNYIN"),
    re.compile(r"刺猬云印(?:·在线打印)?"),
    re.compile(r"公众号\s*[:：]?\s*研池悟空"),
    re.compile(r"公众号\s*[:：]?\s*小兔网盘免费分享无水印PDF"),
    re.compile(r"微信扫一扫.*$"),
)
_HEADING_TITLE_SIMILARITY = 0.70
_HEADING_HINT_PAGE_TOLERANCE = 1
_HEADING_ROW_OVERLAP = 0.65
_HEADING_FRAGMENT_GAP = 0.08


class ChapterResolutionError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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

    def reading_context(self, revision_id: str, page: int, y: float) -> dict:
        """Read-only UI projection of the anchor against resolved physical ranges."""
        nodes = self.repository.list(revision_id)
        containing = [n for n in nodes if n.get('resolution_state') == 'RESOLVED'
                      and all(n.get(k) is not None for k in ('start_page', 'start_y', 'end_page', 'end_y'))
                      and (n['start_page'], n['start_y']) <= (page, y) < (n['end_page'], n['end_y'])]
        def unique(kind):
            found = [n for n in containing if n['kind'] == kind]
            return found[0] if len(found) == 1 else None
        return {'chapter': unique('CHAPTER'), 'section': unique('SECTION'),
                'subsection': unique('SUBSECTION')}

    def stored_snapshot(self, revision_id: str) -> dict:
        """Read the published directory; evidence refresh is a separate operation."""
        self.library.revision(revision_id)
        record = self.repository.bootstrap_record(revision_id)
        labels = self.page_labels.repository.list(revision_id)
        return {
            "nodes": self.repository.list(revision_id),
            "evidence_source": record["evidence_source"] if record else None,
            "waiting_for_toc_completion": record is None,
            "identity_conflict": bool(record and record.get("last_conflict_digest")),
            "page_labels": {
                "labels": labels,
                "inferred_count": sum(r["method"] == "INFERRED" for r in labels),
                "manual_count": sum(r["method"] == "MANUAL" for r in labels),
                "unknown_count": sum(r["method"] == "NONE" for r in labels),
                "conflicts": [],
            },
        }

    def bootstrap(self, revision_id: str) -> dict:
        with self._lock:
            self.library.revision(revision_id)
            label_snapshot = self.page_labels.infer(revision_id)
            source, raw = self._bookmark_candidates(
                revision_id, self.library.pdf_path(revision_id)
            )
            waiting = False
            if not usable_bookmarks(raw):
                auxiliary = [dict(n, depth=0, kind='OTHER') for n in raw
                             if AUXILIARY.fullmatch(n['title']) and n.get('start_page') is not None]
                statuses, pages = self.repository.ready_snapshot(revision_id)
                raw, waiting = self._toc_candidates(statuses, pages)
                if raw:
                    titles = {n['title'] for n in raw}
                    raw = [n for n in auxiliary if n['title'] not in titles] + raw
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

    def resolve_chapter_physical(self, revision_id: str, chapter_id: str) -> dict:
        """Resolve only the requested Chapter and its knowledge-bearing children."""
        revision = self.library.revision(revision_id)
        nodes = self.repository.list(revision_id)
        by_id = {node["outline_node_id"]: node for node in nodes}
        chapter = by_id.get(chapter_id)
        if chapter is None or chapter["kind"] != "CHAPTER":
            raise ChapterResolutionError("INVALID_CHAPTER", "Knowledge Map requires one Chapter")

        ordered = self._topological(nodes)
        descendants = []
        accepted_parents = {chapter_id}
        for node in ordered:
            if node["outline_node_id"] == chapter_id:
                descendants.append(node)
                continue
            if node.get("parent_id") in accepted_parents:
                descendants.append(node)
                accepted_parents.add(node["outline_node_id"])
        required = [
            node for node in descendants
            if node["kind"] in {"CHAPTER", "SECTION", "SUBSECTION"}
        ]
        if not any(node["kind"] == "SECTION" for node in required):
            raise ChapterResolutionError("NO_SECTIONS", "Chapter has no existing Section owner")

        start_page = chapter.get("start_page")
        if start_page is None:
            raise ChapterResolutionError(
                "CHAPTER_START_UNRESOLVED", "Chapter has no safe physical start"
            )
        next_root = next_chapter_boundary(ordered, chapter)
        if next_root is not None and next_root.get('start_page') is None:
            raise ChapterResolutionError('CHAPTER_END_UNRESOLVED', 'Next boundary has no safe page')
        end_page_exclusive = (
            int(next_root["start_page"]) if next_root is not None else revision["page_count"]
        )
        if end_page_exclusive <= start_page:
            raise ChapterResolutionError("INVALID_CHAPTER_RANGE", "Chapter page range is invalid")

        statuses, ready_pages = self.repository.ready_snapshot(revision_id)
        status_by_page = {row["pdf_page_index"]: row["status"] for row in statuses}
        missing = [
            page for page in range(start_page, end_page_exclusive)
            if status_by_page.get(page) != "READY"
        ]
        if missing:
            code = (
                "SOURCE_PAGE_FAILED"
                if any(status_by_page.get(page) == "FAILED" for page in missing)
                else "SOURCE_NOT_READY"
            )
            raise ChapterResolutionError(code, "Chapter OCR evidence is not fully ready")

        lines = [
            line
            for page in range(start_page, end_page_exclusive)
            for line in ready_pages.get(page, [])
        ]
        matched: dict[str, dict] = {}
        previous = (start_page, -1.0)
        for node in descendants:
            if node["kind"] == "CHAPTER":
                same_page_lines = [
                    line for line in lines if line["pdf_page_index"] == start_page
                ]
                match = self._match_heading(node, same_page_lines, previous)
                if match is None:
                    # Embedded bookmarks are authoritative at page granularity.
                    # Page-top is real PDF geometry and avoids mistaking a later
                    # running header for the Chapter's start heading.
                    match = {
                        "page": start_page, "start_y": 0.0, "end_y": 0.0,
                        "line_ordinal": None, "confidence": float(node["confidence"]),
                    }
            else:
                match = self._match_heading(node, lines, previous)
            if match is None:
                if node in required:
                    raise ChapterResolutionError(
                        "HEADING_NOT_RESOLVED", f"Could not resolve heading for {node['title']}"
                    )
                if node.get("start_page") is None:
                    continue
                match = {
                    "page": int(node["start_page"]), "start_y": 0.0, "end_y": 0.0,
                    "line_ordinal": None, "confidence": float(node["confidence"]),
                }
            position = (match["page"], match["start_y"])
            if position < previous:
                if node in required:
                    raise ChapterResolutionError(
                        "HEADING_ORDER_INVALID", "Resolved headings contradict Outline order"
                    )
                continue
            matched[node["outline_node_id"]] = match
            previous = position

        chapter_boundary = (end_page_exclusive, 0.0)
        if next_root is not None:
            boundary_match = self._match_heading(
                next_root,
                ready_pages.get(end_page_exclusive, []),
                (end_page_exclusive, -1.0),
            )
            if boundary_match is not None:
                chapter_boundary = (boundary_match["page"], boundary_match["start_y"])

        resolutions: dict[str, dict] = {}
        for index, node in enumerate(descendants):
            if node not in required:
                continue
            heading = matched[node["outline_node_id"]]
            end = chapter_boundary
            for candidate in descendants[index + 1:]:
                candidate_match = matched.get(candidate["outline_node_id"])
                if candidate_match is not None and candidate["depth"] <= node["depth"]:
                    end = (candidate_match["page"], candidate_match["start_y"])
                    break
            start = (heading["page"], heading["start_y"])
            if end <= start:
                raise ChapterResolutionError(
                    "INVALID_RESOLVED_RANGE", "Resolved Outline range is empty or reversed"
                )
            resolutions[node["outline_node_id"]] = {
                "start_page": start[0], "start_y": start[1],
                "end_page": end[0], "end_y": end[1],
                "confidence": heading["confidence"],
                "heading_ref": {
                    "pdf_page_index": heading["page"],
                    "line_ordinal": heading["line_ordinal"],
                },
            }

        excluded_ranges = []
        for index, node in enumerate(descendants):
            if node["kind"] not in {"EXERCISES", "ANSWERS"}:
                continue
            heading = matched.get(node["outline_node_id"])
            if heading is None:
                continue
            end = chapter_boundary
            for candidate in descendants[index + 1:]:
                candidate_match = matched.get(candidate["outline_node_id"])
                if candidate_match is not None and candidate["depth"] <= node["depth"]:
                    end = (candidate_match["page"], candidate_match["start_y"])
                    break
            start = (heading["page"], heading["start_y"])
            if end > start:
                excluded_ranges.append(
                    {"kind": node["kind"], "title": node["title"], "start": start, "end": end}
                )

        identity_snapshot = tuple(
            (
                node["outline_node_id"], node["parent_id"], node["depth"],
                node["order_index"], node["kind"], node["title"],
                node["identity_revision"],
            )
            for node in sorted(
                descendants,
                key=lambda value: (
                    value["depth"], value["parent_id"] or "",
                    value["order_index"], value["outline_node_id"],
                ),
            )
        )
        updated = self.repository.resolve_chapter_ranges(
            revision_id, chapter_id, resolutions, identity_snapshot
        )
        updated_by_id = {node["outline_node_id"]: node for node in updated}
        return {
            "chapter": updated_by_id[chapter_id],
            "nodes": [updated_by_id[node["outline_node_id"]] for node in required],
            "page_start": start_page,
            "page_end_exclusive": end_page_exclusive,
            "excluded_ranges": excluded_ranges,
        }

    @classmethod
    def _match_heading(
        cls, node: dict, lines: list[dict], after: tuple[int, float]
    ) -> dict | None:
        target = cls._heading_parts(node["title"])
        lines_by_page: dict[int, list[dict]] = {}
        for value in lines:
            lines_by_page.setdefault(int(value["pdf_page_index"]), []).append(value)
        candidates = []
        for line in lines:
            ys = [float(point[1]) for point in line["quad"]]
            position = (int(line["pdf_page_index"]), min(ys))
            if position < after:
                continue
            hint = node.get("start_page")
            page_distance = abs(position[0] - int(hint)) if hint is not None else 0
            if hint is not None and page_distance > _HEADING_HINT_PAGE_TOLERANCE:
                continue
            line_value = cls._heading_parts(cls.classification_text(line["text"]))
            if target[0] is not None and target[0] != line_value[0]:
                continue
            similarity = cls._heading_similarity(
                target, line, lines_by_page[position[0]]
            )
            if similarity is None:
                continue
            candidates.append(
                (
                    page_distance, -similarity, position, int(line["line_ordinal"]),
                    {
                        "page": position[0], "start_y": position[1], "end_y": max(ys),
                        "line_ordinal": int(line["line_ordinal"]),
                        "confidence": float(line["confidence"]),
                    },
                )
            )
        return min(candidates, key=lambda item: item[:-1])[-1] if candidates else None

    @classmethod
    def _heading_similarity(
        cls, target: tuple[str | None, str], line: dict, lines: list[dict]
    ) -> float | None:
        similarities = []
        for value in cls._heading_variants(line, lines):
            if target[0] is None:
                # An unnumbered bookmark/TOC title is safe only when the normalized
                # heading text itself matches.  Page proximity and document order
                # disambiguate repeated structural labels such as “归纳总结”.
                if value[0] is None and target[1] and target[1] == value[1]:
                    similarities.append(1.0)
                continue
            if target[0] != value[0]:
                continue
            similarity = (
                1.0
                if not target[1]
                else SequenceMatcher(None, target[1], value[1]).ratio()
            )
            if similarity >= _HEADING_TITLE_SIMILARITY:
                similarities.append(similarity)
        return max(similarities, default=None)

    @classmethod
    def _heading_variants(
        cls, line: dict, lines: list[dict]
    ) -> list[tuple[str | None, str]]:
        """Return the line plus conservative same-row OCR-fragment joins."""
        text = cls.classification_text(line["text"])
        variants = [cls._heading_parts(text)]
        x0, y0, x1, y1 = cls._line_bounds(line)
        height = y1 - y0
        if height <= 0:
            return variants
        fragments = []
        for other in lines:
            if other is line or int(other["pdf_page_index"]) != int(line["pdf_page_index"]):
                continue
            ox0, oy0, ox1, oy1 = cls._line_bounds(other)
            other_height = oy1 - oy0
            overlap = max(0.0, min(y1, oy1) - max(y0, oy0))
            if other_height <= 0 or overlap / min(height, other_height) < _HEADING_ROW_OVERLAP:
                continue
            if (ox0 + ox1) / 2 <= (x0 + x1) / 2:
                continue
            fragments.append((ox0, ox1, cls.classification_text(other["text"])))
        right_edge = x1
        combined = text
        for fragment_x0, fragment_x1, fragment_text in sorted(fragments):
            if fragment_x0 - right_edge > max(_HEADING_FRAGMENT_GAP, height * 3):
                break
            if fragment_text:
                combined = f"{combined} {fragment_text}"
                variants.append(cls._heading_parts(combined))
            right_edge = max(right_edge, fragment_x1)
        return variants

    @staticmethod
    def _line_bounds(line: dict) -> tuple[float, float, float, float]:
        xs = [float(point[0]) for point in line["quad"]]
        ys = [float(point[1]) for point in line["quad"]]
        return min(xs), min(ys), max(xs), max(ys)

    @staticmethod
    def _heading_parts(value: str) -> tuple[str | None, str]:
        normalized = unicodedata.normalize("NFKC", value)
        compact = re.sub(r"[\s·•:：—_\-]", "", normalized)
        compact = compact.strip('《》<>【】')
        compact = compact.lstrip("*＊")
        named = re.fullmatch(rf'第({ORDINAL})([篇部章节])(.*)', compact)
        if named:
            return f'第{ordinal(named[1])}{named[2]}', named[3]
        chapter = re.match(r"^(第\d+章)(.*)$", compact)
        numbered = re.match(r"^(\d+(?:\.\d+)+)(.*)$", compact)
        match = chapter or numbered
        return (match.group(1), match.group(2)) if match else (None, compact)

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
                    except Exception:  # noqa: BLE001 - malformed PDF destination remains unresolved.
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
        complete = (all(ready.get(page, False) for page in range(block[0]))
                    and (after >= len(statuses) or ready.get(after, False) and after not in toc_pages))
        if not complete:
            return [], True
        candidates: list[dict] = []
        for page_index in block:
            candidates.extend(toc_pages[page_index])
        return named_hierarchy(candidates), False

    @classmethod
    def _parse_toc_page(cls, page_index: int, lines: list[dict]) -> list[dict]:
        named = parse_named_toc(page_index, lines, cls.classification_text)
        if (any(item['named_unit'] in ('篇', '部', '节') or
                item['named_unit'] == '章' and not re.match(r'^第\d+章', item['title']) for item in named)
                or named and not any(_NUMBERED.match(cls.classification_text(line['text'])) for line in lines)):
            return named
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
        if AUXILIARY.fullmatch(title):
            return 'OTHER'
        named = NAMED.fullmatch(title)
        if named:
            return {'篇': 'OTHER', '部': 'OTHER', '章': 'CHAPTER', '节': 'SECTION'}[named[2]]
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
            # Bookmark depth is textbook evidence, not a display limit. Preserve it
            # exactly so fourth-or-deeper body nodes keep their source hierarchy.
            depth = max(int(item["depth"]), 0)
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
                "kind": item.get('kind', cls._kind(item["title"], depth)),
            }
            nodes.append(node)
            stack[depth] = node_id
            for deeper in tuple(level for level in stack if level > depth):
                del stack[deeper]
        return nodes

    def _apply_safe_targets(self, revision_id: str, nodes: list[dict]) -> None:
        targets = self._safe_targets(nodes)
        for node in nodes:
            node["start_page"] = targets[node["outline_node_id"]]

    def _safe_targets(self, nodes: list[dict]) -> dict[str, int | None]:
        toc_end = max((n.get('evidence', {}).get('pdf_page_index', -1)
                       for n in nodes if n.get('evidence', {}).get('source') == 'TOC'), default=-1)
        label_targets = self.page_labels.repository.resolve_labels(
            self._revision_id_from_nodes(nodes), after_page=toc_end
        ) if nodes and "book_source_revision_id" in nodes[0] else None
        ready_pages = None
        targets: dict[str, int | None] = {}
        previous: dict[str | None, int] = {}
        for node in self._topological(nodes):
            page = node.get("start_page")
            if label_targets is not None and node.get("evidence", {}).get("source") == "TOC":
                page = label_targets.get(node.get("printed_label_hint"))
                # Some chapter openers suppress their printed page number. One adjacent
                # measured label plus the actual heading confirms that physical target;
                # never persist an extrapolated PageLabel or invent logical nodes.
                hint = node.get('printed_label_hint') or ''
                if page is None and node['kind'] == 'CHAPTER' and hint.isdecimal():
                    candidates = set()
                    for delta in (-1, 1):
                        neighbour = label_targets.get(str(int(hint) + delta))
                        if neighbour is not None and neighbour - delta > toc_end:
                            candidates.add(neighbour - delta)
                    if len(candidates) == 1:
                        candidate = candidates.pop()
                        if ready_pages is None:
                            _, ready_pages = self.repository.ready_snapshot(self._revision_id_from_nodes(nodes))
                        lines = [line for line in ready_pages.get(candidate, [])
                                 if .08 <= min(point[1] for point in line['quad']) < .5]
                        match = self._match_heading({**node, 'start_page': candidate}, lines, (candidate, 0.))
                        if match is not None:
                            page = candidate
                            label_targets[hint] = candidate
                if page is None and (node['kind'] == 'CHAPTER' or node['kind'] == 'OTHER'
                                     and node.get('parent_id') is None and not NAMED.match(node['title'])):
                    if ready_pages is None:
                        _, ready_pages = self.repository.ready_snapshot(self._revision_id_from_nodes(nodes))
                    target = self._heading_parts(node['title'])
                    exact_pages = []
                    for candidate, page_lines in ready_pages.items():
                        if candidate <= toc_end:
                            continue
                        if any(.08 < min(p[1] for p in line['quad']) < .5
                               and target in self._heading_variants(line, page_lines) for line in page_lines):
                            exact_pages.append(candidate)
                    if len(exact_pages) == 1:
                        page = exact_pages[0]
            parent = node.get("parent_id")
            if page is not None and parent in previous and page < previous[parent]:
                page = None
            if page is not None:
                previous[parent] = page
            targets[node["outline_node_id"]] = page
        # TOC labels are OCR hints, not authority over actual body headings. Search
        # only within the evidenced owner chapter, never a whole-book fuzzy match.
        ordered = self._topological(nodes)
        chapters = [n for n in ordered if n['kind'] == 'CHAPTER']
        if chapters and toc_end >= 0:
            if ready_pages is None:
                _, ready_pages = self.repository.ready_snapshot(self._revision_id_from_nodes(nodes))
            for chapter in chapters:
                start = targets[chapter['outline_node_id']]
                boundary = next_chapter_boundary(ordered, chapter)
                end = targets.get(boundary['outline_node_id']) if boundary else max(ready_pages, default=-1) + 1
                if start is None or end is None or end <= start:
                    continue
                lines = [line for p in range(start, end) for line in ready_pages.get(p, [])
                         if .08 < min(pt[1] for pt in line['quad']) < .93]
                after = (start, 0.)
                for node in ordered:
                    if node.get('parent_id') != chapter['outline_node_id'] or node.get('evidence', {}).get('source') != 'TOC':
                        continue
                    hint = targets[node['outline_node_id']]
                    match = self._match_heading({**node, 'start_page': hint}, lines, after)
                    if match is None:
                        match = self._match_heading({**node, 'start_page': None}, lines, after)
                    if match is not None:
                        targets[node['outline_node_id']] = match['page']
                        after = (match['page'], match['start_y'])
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
