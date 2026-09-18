from __future__ import annotations

import hashlib
import json
import re
import unicodedata


MAX_EVIDENCE_UNIT_CHARACTERS = 900
SOFT_EVIDENCE_UNIT_CHARACTERS = 160
MAX_SHORT_HEADING_CHARACTERS = 48
# Invocation capacity, not a semantic splitting threshold. Real Chapter 4 subsection
# 4.3.1 contains 6,485 characters; retain one complete judgment for that subsection.
MAX_SEMANTIC_WINDOW_CHARACTERS = 9_600
MAX_REVIEW_EXCERPT_CHARACTERS = 60
MAX_PAGE_TOP_FURNITURE_Y = 0.10
MIN_PAGE_BOTTOM_CONTINUATION_Y = 0.84
MAX_PAGE_TOP_CONTINUATION_Y = 0.20

_TERMINAL_PUNCTUATION = re.compile(r"[。！？!?；;]$\Z")
_HEADING_OR_ITEM = re.compile(
    r"^(?:第[一二三四五六七八九十百\d]+[章节篇]|"
    r"(?:\d+\.)+\d*\s*|[（(]?\d+[）)、.]\s*|"
    r"[一二三四五六七八九十]+[、.]\s*)"
)
_NON_MINTING_SECTION_MARKERS = (
    "本章小结",
    "本节小结",
    "章节小结",
    "常见问题",
    "易混淆",
    "faq",
    "试题精选",
)
_PAGE_LABEL_TOKEN = re.compile(r"(?:\d{1,5}|[ivxlcdm]{1,8})", re.IGNORECASE)


class SemanticOutputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _semantic_error(code: str, message: str) -> SemanticOutputError:
    return SemanticOutputError(code, message)


def _source_subsection(subsections: list[dict], line: dict) -> dict | None:
    position = (line["pdf_page_index"], line["y_start"])
    return next(
        (
            subsection
            for subsection in subsections
            if tuple(subsection["start"]) <= position < tuple(subsection["end"])
        ),
        None,
    )


def build_evidence_units(source_payload: dict) -> list[dict]:
    """Build small deterministic evidence units from one resolved Chapter projection."""
    units: list[dict] = []
    global_order = 0
    page_top_furniture = _repeated_page_top_furniture_refs(source_payload)
    for section_order, section in enumerate(source_payload["source_sections"]):
        section_units: list[list[dict]] = []
        current: list[dict] = []
        current_characters = 0
        for line in section["lines"]:
            text = _normalize_text(line.get("text"))
            if not text:
                continue
            if line.get("line_ref") in page_top_furniture:
                continue
            subsection = _source_subsection(section.get("subsections", []), line)
            line = {
                **line,
                "outline_subsection_id": (
                    subsection["outline_node_id"] if subsection is not None else None
                ),
                "outline_subsection_title": (
                    subsection["title"] if subsection is not None else None
                ),
            }
            if _is_page_top_furniture_during_continuation(current, line):
                continue
            is_heading_or_item = bool(_HEADING_OR_ITEM.match(text))
            is_short_heading = _is_short_heading(text)
            page_changed = bool(
                current
                and current[-1]["pdf_page_index"] != line["pdf_page_index"]
            )
            continues_across_page = bool(
                page_changed
                and _is_high_confidence_page_continuation(current, line, text)
            )
            starts_new_item = bool(current and is_heading_or_item)
            starts_new_subsection = bool(
                current
                and current[-1].get("outline_subsection_id")
                != line.get("outline_subsection_id")
            )
            exceeds_hard_limit = bool(
                current
                and current_characters + len(text) > MAX_EVIDENCE_UNIT_CHARACTERS
            )
            if (
                (page_changed and not continues_across_page)
                or starts_new_subsection
                or starts_new_item
                or exceeds_hard_limit
            ):
                section_units.append(current)
                current = []
                current_characters = 0
            current.append({**line, "text": text})
            current_characters += len(text)
            if (is_heading_or_item and not is_short_heading) or (
                current_characters >= SOFT_EVIDENCE_UNIT_CHARACTERS
                and (
                    _TERMINAL_PUNCTUATION.search(text)
                    or current_characters >= SOFT_EVIDENCE_UNIT_CHARACTERS * 2
                )
            ):
                section_units.append(current)
                current = []
                current_characters = 0
        if current:
            section_units.append(current)
        if not section_units:
            raise ValueError("Resolved Section produced no deterministic evidence units")

        previous_subsection_id = None
        for section_unit_order, lines in enumerate(section_units):
            text = _join_lines(lines)
            start = lines[0]
            end = lines[-1]
            subsection_id = start.get("outline_subsection_id")
            starts_outline_subsection = bool(
                subsection_id is not None and subsection_id != previous_subsection_id
            )
            fingerprint = hashlib.sha256(text.encode("utf-8")).hexdigest()
            unit_id = f"u{global_order + 1:04d}"
            units.append(
                {
                    "unit_id": unit_id,
                    "source_revision_id": source_payload["chapter"][
                        "book_source_revision_id"
                    ],
                    "primary_section_id": section["section_id"],
                    "primary_section_title": section["title"],
                    "outline_subsection_id": subsection_id,
                    "outline_subsection_title": start.get("outline_subsection_title"),
                    "starts_outline_subsection": starts_outline_subsection,
                    "section_order": section_order,
                    "section_unit_order": section_unit_order,
                    "order_index": global_order,
                    "start_ref": start["line_ref"],
                    "end_ref": end["line_ref"],
                    "start_page": start["pdf_page_index"],
                    "start_y": start["y_start"],
                    "end_page": end["pdf_page_index"],
                    "end_y": end["y_end"],
                    "text": text,
                    "fingerprint": fingerprint,
                }
            )
            previous_subsection_id = subsection_id
            global_order += 1
    if not units:
        raise ValueError("Chapter produced no deterministic evidence units")
    return units


def build_semantic_windows(units: list[dict]) -> list[dict]:
    first_subsection_by_section: dict[str, str] = {}
    for unit in units:
        subsection_id = unit.get("outline_subsection_id")
        if subsection_id is not None:
            first_subsection_by_section.setdefault(
                unit["primary_section_id"], subsection_id
            )

    grouped: list[tuple[tuple[str, str], list[dict]]] = []
    current_key: tuple[str, str] | None = None
    current_units: list[dict] = []
    seen_keys: set[tuple[str, str]] = set()

    def flush() -> None:
        nonlocal current_key, current_units
        if current_key is None:
            return
        if current_key in seen_keys:
            raise ValueError("Semantic window boundary is non-contiguous")
        grouped.append((current_key, current_units))
        seen_keys.add(current_key)
        current_key = None
        current_units = []

    for unit in units:
        section_id = unit["primary_section_id"]
        subsection_id = unit.get("outline_subsection_id")
        if subsection_id is not None:
            key = ("SUBSECTION", subsection_id)
        elif section_id in first_subsection_by_section:
            key = ("SUBSECTION", first_subsection_by_section[section_id])
        else:
            key = ("SECTION", section_id)
        if current_key is not None and key != current_key:
            flush()
        if current_key is None:
            current_key = key
        current_units.append(unit)
    flush()

    windows = []
    for window_order, (key, window_units) in enumerate(grouped):
        character_count = sum(len(unit["text"]) for unit in window_units)
        if character_count > MAX_SEMANTIC_WINDOW_CHARACTERS:
            raise SemanticOutputError("semantic_window_source_limit", "Semantic window exceeds configured source bound")
        first = window_units[0]
        subsection = next(
            (
                unit
                for unit in window_units
                if unit.get("outline_subsection_id") == key[1]
            ),
            None,
        ) if key[0] == "SUBSECTION" else None
        windows.append(
            {
                "window_id": f"w{window_order + 1:03d}",
                "window_order": window_order,
                "window_kind": key[0],
                "primary_section_id": first["primary_section_id"],
                "primary_section_title": first["primary_section_title"],
                "outline_subsection_id": (
                    subsection.get("outline_subsection_id")
                    if subsection is not None
                    else None
                ),
                "outline_subsection_title": (
                    subsection.get("outline_subsection_title")
                    if subsection is not None
                    else None
                ),
                "units": window_units,
                "character_count": character_count,
            }
        )
    _validate_window_coverage(units, windows)
    return windows


def semantic_window_payload(chapter: dict, window: dict) -> dict:
    return {
        "chapter": {
            "chapter_outline_node_id": chapter["chapter_outline_node_id"],
            "title": chapter["title"],
        },
        "section": {
            "section_id": window["primary_section_id"],
            "title": window["primary_section_title"],
        },
        "window": {
            "window_id": window["window_id"],
            "kind": window["window_kind"],
            "outline_subsection_id": window["outline_subsection_id"],
            "title": (
                window["outline_subsection_title"]
                or window["primary_section_title"]
            ),
            "kp_creation": (
                "FORBIDDEN_REVIEW_MATERIAL"
                if _is_non_minting_review_window(window)
                else "ALLOWED"
            ),
        },
        "units": [
            {"unit_id": unit["unit_id"], "text": unit["text"]}
            for unit in window["units"]
        ],
    }


def validate_semantic_output(answer: str, window: dict) -> dict:
    try:
        value = json.loads(answer)
    except (TypeError, ValueError):
        raise _semantic_error("not_json", "Semantic output is not JSON") from None
    if not isinstance(value, dict) or set(value) != {
        "learning_targets", "non_kp_units"
    }:
        raise _semantic_error("top_level_fields", "Semantic output fields are invalid")

    learning_targets = value["learning_targets"]
    non_kp_units = value["non_kp_units"]
    supplied = [unit["unit_id"] for unit in window["units"]]
    position = {unit_id: index for index, unit_id in enumerate(supplied)}
    if (
        not isinstance(learning_targets, list)
        or len(learning_targets) > len(supplied)
        or not isinstance(non_kp_units, list)
    ):
        raise _semantic_error("partition_shape", "Semantic partition shape is invalid")

    normalized_targets = []
    consumed: list[str] = []
    previous_end = -1
    for target in learning_targets:
        if not isinstance(target, dict) or set(target) != {
            "unit_ids", "title", "one_sentence_meaning"
        }:
            raise _semantic_error("target_fields", "Learning-target fields are invalid")
        unit_ids = target["unit_ids"]
        if (
            not isinstance(unit_ids, list)
            or not unit_ids
            or any(
                not isinstance(unit_id, str) or unit_id not in position
                for unit_id in unit_ids
            )
            or len(unit_ids) != len(set(unit_ids))
        ):
            raise _semantic_error("unit_ids", "Learning-target unit IDs are invalid")
        positions = [position[unit_id] for unit_id in unit_ids]
        if positions != list(range(positions[0], positions[0] + len(positions))):
            raise _semantic_error(
                "noncontiguous_units",
                "Learning-target unit IDs are not an ordered contiguous run",
            )
        if positions[0] <= previous_end:
            raise _semantic_error(
                "reordered_or_reused_units",
                "Learning targets are reordered or consume a unit twice",
            )
        previous_end = positions[-1]
        title = target["title"]
        meaning = target["one_sentence_meaning"]
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
            raise _semantic_error("title", "Semantic title is invalid")
        if not isinstance(meaning, str) or not 1 <= len(meaning.strip()) <= 300:
            raise _semantic_error("meaning", "Semantic meaning is invalid")
        normalized_targets.append(
            {
                "unit_ids": list(unit_ids),
                "title": title.strip(),
                "one_sentence_meaning": meaning.strip(),
            }
        )
        consumed.extend(unit_ids)

    if (
        any(
            not isinstance(unit_id, str) or unit_id not in position
            for unit_id in non_kp_units
        )
        or len(non_kp_units) != len(set(non_kp_units))
        or [position[unit_id] for unit_id in non_kp_units]
        != sorted(position[unit_id] for unit_id in non_kp_units)
    ):
        raise _semantic_error("non_kp_units", "Non-KP unit IDs are invalid")
    consumed.extend(non_kp_units)
    if len(consumed) != len(supplied) or set(consumed) != set(supplied):
        raise _semantic_error(
            "incomplete_accounting",
            "Semantic partition does not account for every supplied unit exactly once",
        )
    if _is_non_minting_review_window(window) and normalized_targets:
        raise _semantic_error(
            "non_minting_review_material",
            "Summary, FAQ, and misconception windows cannot mint KnowledgePoints",
        )
    return {
        "learning_targets": normalized_targets,
        "non_kp_units": list(non_kp_units),
    }


def _is_non_minting_review_window(window: dict) -> bool:
    titles = (
        window.get("primary_section_title"),
        window.get("outline_subsection_title"),
    )
    return any(
        marker in title.casefold()
        for title in titles
        if isinstance(title, str)
        for marker in _NON_MINTING_SECTION_MARKERS
    )


def materialize_candidates(
    windows: list[dict], partitions_by_window: dict[str, dict]
) -> list[dict]:
    if set(partitions_by_window) != {window["window_id"] for window in windows}:
        raise ValueError("Semantic partition ledger is incomplete")
    candidates: list[dict] = []
    for window in windows:
        unit_index = {unit["unit_id"]: unit for unit in window["units"]}
        for target in partitions_by_window[window["window_id"]]["learning_targets"]:
            selected = [unit_index[unit_id] for unit_id in target["unit_ids"]]
            first = selected[0]
            last = selected[-1]
            candidates.append(
                {
                    "candidate_id": f"c{len(candidates) + 1:04d}",
                    "window_id": window["window_id"],
                    "unit_ids": list(target["unit_ids"]),
                    "source_revision_id": first["source_revision_id"],
                    "primary_section_id": first["primary_section_id"],
                    "title": target["title"],
                    "one_sentence_definition": target["one_sentence_meaning"],
                    "order_index": first["order_index"],
                    "start_page": first["start_page"],
                    "start_y": first["start_y"],
                    "end_page": last["end_page"],
                    "end_y": last["end_y"],
                }
            )
    candidates.sort(key=lambda candidate: candidate["order_index"])
    maximum_candidate_count = sum(len(window["units"]) for window in windows)
    if not 1 <= len(candidates) <= maximum_candidate_count:
        raise ValueError("Materialized candidate count exceeds evidence-unit authority")
    return candidates


def publication_points(candidates: list[dict]) -> list[dict]:
    return [
        {
            "primary_section_id": candidate["primary_section_id"],
            "title": candidate["title"],
            "one_sentence_definition": candidate["one_sentence_definition"],
            "start_page": candidate["start_page"],
            "start_y": candidate["start_y"],
            "end_page": candidate["end_page"],
            "end_y": candidate["end_y"],
        }
        for candidate in candidates
    ]


def build_compact_review_ledger(
    chapter: dict,
    units: list[dict],
    windows: list[dict],
    partitions_by_window: dict[str, dict],
    candidates: list[dict],
    *,
    semantic_provider: str,
    semantic_model: str,
    review_rubric: tuple[str, ...],
    overlap_warnings: list[dict],
) -> dict:
    candidate_by_membership = {
        (candidate["window_id"], tuple(candidate["unit_ids"])): candidate["candidate_id"]
        for candidate in candidates
    }
    sections = []
    section_ids = []
    for unit in units:
        if unit["primary_section_id"] not in section_ids:
            section_ids.append(unit["primary_section_id"])
    for section_id in section_ids:
        section_units = [
            unit for unit in units if unit["primary_section_id"] == section_id
        ]
        sections.append(
            {
                "section_id": section_id,
                "title": section_units[0]["primary_section_title"],
                "units": [
                    {
                        "unit_id": unit["unit_id"],
                        "excerpt": unit["text"][:MAX_REVIEW_EXCERPT_CHARACTERS],
                        "fingerprint": unit["fingerprint"][:8],
                    }
                    for unit in section_units
                ],
            }
        )
    window_ledger = []
    for window in windows:
        targets = []
        partition = partitions_by_window[window["window_id"]]
        for target in partition["learning_targets"]:
            item = {"unit_ids": list(target["unit_ids"])}
            candidate_id = candidate_by_membership.get(
                (window["window_id"], tuple(target["unit_ids"]))
            )
            if candidate_id is None:
                raise ValueError("Learning target lacks a materialized candidate")
            item["candidate_id"] = candidate_id
            targets.append(item)
        window_ledger.append(
            {
                "window_id": window["window_id"],
                "window_kind": window["window_kind"],
                "section_id": window["primary_section_id"],
                "outline_subsection_id": window["outline_subsection_id"],
                "title": (
                    window["outline_subsection_title"]
                    or window["primary_section_title"]
                ),
                "learning_targets": targets,
                "non_kp_units": list(partition["non_kp_units"]),
            }
        )
    ledger = {
        "chapter": {
            "chapter_outline_node_id": chapter["chapter_outline_node_id"],
            "title": chapter["title"],
        },
        "sections": sections,
        "windows": window_ledger,
        "candidates": [
            {
                "candidate_index": index,
                "candidate_id": candidate["candidate_id"],
                "primary_section_id": candidate["primary_section_id"],
                "unit_ids": list(candidate["unit_ids"]),
                "title": candidate["title"],
                "one_sentence_meaning": candidate["one_sentence_definition"],
            }
            for index, candidate in enumerate(candidates)
        ],
        "semantic_provenance": {
            "provider": semantic_provider,
            "model": semantic_model,
            "window_count": len(windows),
        },
        "review_rubric": list(review_rubric),
        "overlap_warnings": overlap_warnings,
    }
    validate_compact_review_ledger(ledger)
    return ledger


def validate_compact_review_ledger(ledger: dict) -> None:
    unit_ids = [
        unit["unit_id"]
        for section in ledger["sections"]
        for unit in section["units"]
    ]
    if len(unit_ids) != len(set(unit_ids)) or not unit_ids:
        raise ValueError("Compact Review ledger unit membership is invalid")
    partition_unit_ids = [
        unit_id
        for window in ledger["windows"]
        for target in window["learning_targets"]
        for unit_id in target["unit_ids"]
    ] + [
        unit_id
        for window in ledger["windows"]
        for unit_id in window["non_kp_units"]
    ]
    if (
        len(partition_unit_ids) != len(unit_ids)
        or set(partition_unit_ids) != set(unit_ids)
    ):
        raise ValueError("Compact Review ledger does not completely account for units")
    candidate_ids = {candidate["candidate_id"] for candidate in ledger["candidates"]}
    target_candidate_ids = {
        target["candidate_id"]
        for window in ledger["windows"]
        for target in window["learning_targets"]
    }
    if not candidate_ids or candidate_ids != target_candidate_ids:
        raise ValueError("Compact Review ledger candidate membership is invalid")
    prohibited = {
        "text", "lines", "line_ref", "start_ref", "end_ref", "pdf_page_index",
        "start_page", "start_y", "end_page", "end_y", "geometry", "quad",
        "source_revision_id", "reasoning", "reasoning_content",
    }
    if _contains_key(ledger, prohibited):
        raise ValueError("Compact Review ledger contains source-authority fields")


def _validate_window_coverage(units: list[dict], windows: list[dict]) -> None:
    expected = [unit["unit_id"] for unit in units]
    actual = [
        unit["unit_id"] for window in windows for unit in window["units"]
    ]
    if expected != actual or len(actual) != len(set(actual)):
        raise ValueError("Semantic windows changed evidence-unit accounting")
    for window in windows:
        if window["character_count"] > MAX_SEMANTIC_WINDOW_CHARACTERS:
            raise SemanticOutputError("semantic_window_source_limit", "Semantic window exceeds configured source bound")
        if any(
            unit["primary_section_id"] != window["primary_section_id"]
            for unit in window["units"]
        ):
            raise ValueError("Semantic window crosses a Section boundary")


def _normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _repeated_page_top_furniture_refs(source_payload: dict) -> set[str]:
    """Identify repeated running headers and their adjacent printed page labels.

    OCR remains untouched.  This is only the bounded semantic projection, where repeated
    top-band furniture would otherwise split one continuous learning target.  A unique top-band
    line is retained because it may be a real heading.
    """
    by_page: dict[int, list[tuple[str, str, str]]] = {}
    pages_by_signature: dict[str, set[int]] = {}
    for section in source_payload["source_sections"]:
        for line in section["lines"]:
            text = _normalize_text(line.get("text"))
            line_ref = line.get("line_ref")
            if (
                not text
                or not isinstance(line_ref, str)
                or int(line.get("line_ordinal", 99)) > 2
                or float(line.get("y_end", 1.0)) > MAX_PAGE_TOP_FURNITURE_Y
            ):
                continue
            page = int(line["pdf_page_index"])
            signature = re.sub(
                r"\s+", "", unicodedata.normalize("NFKC", text)
            ).casefold()
            by_page.setdefault(page, []).append((line_ref, text, signature))
            pages_by_signature.setdefault(signature, set()).add(page)

    repeated = {
        signature for signature, pages in pages_by_signature.items() if len(pages) >= 2
    }
    furniture: set[str] = set()
    for candidates in by_page.values():
        if not any(signature in repeated for _, _, signature in candidates):
            continue
        for line_ref, text, signature in candidates:
            compact = re.sub(r"\s+", "", text)
            if signature in repeated or _PAGE_LABEL_TOKEN.fullmatch(compact):
                furniture.add(line_ref)
    return furniture


def _is_short_heading(text: str) -> bool:
    return bool(
        len(text) <= MAX_SHORT_HEADING_CHARACTERS
        and _HEADING_OR_ITEM.match(text)
        and not _TERMINAL_PUNCTUATION.search(text)
    )


def _is_page_top_furniture_during_continuation(
    current: list[dict], line: dict
) -> bool:
    """Ignore page number/running-header lines between two halves of one sentence."""
    if not current or line["pdf_page_index"] != current[-1]["pdf_page_index"] + 1:
        return False
    previous = current[-1]
    return bool(
        previous["y_end"] >= MIN_PAGE_BOTTOM_CONTINUATION_Y
        and not _TERMINAL_PUNCTUATION.search(previous["text"])
        and int(line.get("line_ordinal", 99)) <= 2
        and float(line["y_end"]) <= MAX_PAGE_TOP_FURNITURE_Y
    )


def _is_high_confidence_page_continuation(
    current: list[dict], line: dict, text: str
) -> bool:
    previous = current[-1]
    return bool(
        line["pdf_page_index"] == previous["pdf_page_index"] + 1
        and previous["y_end"] >= MIN_PAGE_BOTTOM_CONTINUATION_Y
        and float(line["y_start"]) <= MAX_PAGE_TOP_CONTINUATION_Y
        and not _TERMINAL_PUNCTUATION.search(previous["text"])
        and not _HEADING_OR_ITEM.match(text)
    )


def _join_lines(lines: list[dict]) -> str:
    value = ""
    for line in lines:
        text = line["text"]
        separator = " " if value and value[-1:].isascii() and text[:1].isascii() else ""
        value += separator + text
    return value


def _contains_key(value: object, prohibited: set[str]) -> bool:
    if isinstance(value, dict):
        return any(key in prohibited or _contains_key(item, prohibited) for key, item in value.items())
    if isinstance(value, list):
        return any(_contains_key(item, prohibited) for item in value)
    return False
