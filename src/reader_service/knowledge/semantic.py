from __future__ import annotations

import hashlib
import json
import re


MAX_EVIDENCE_UNIT_CHARACTERS = 900
SOFT_EVIDENCE_UNIT_CHARACTERS = 160
MAX_SHORT_HEADING_CHARACTERS = 48
MAX_SEMANTIC_PACKET_CHARACTERS = 4_800
MAX_SEMANTIC_PACKET_UNITS = 24
MAX_REVIEW_EXCERPT_CHARACTERS = 60
MAX_REPAIR_PACKETS = 4
MAX_REPAIR_UNITS = 24
MAX_PRIOR_SECTION_CANDIDATES = 40
MAX_PRIOR_SECTION_MEANING_CHARACTERS = 80

_TERMINAL_PUNCTUATION = re.compile(r"[。！？!?；;]$\Z")
_HEADING_OR_ITEM = re.compile(
    r"^(?:第[一二三四五六七八九十百\d]+[章节篇]|"
    r"(?:\d+\.)+\d*\s*|[（(]?\d+[）)、.]\s*|"
    r"[一二三四五六七八九十]+[、.]\s*)"
)
_REFERENCE_ONLY = re.compile(
    r"^(?:[（(]?\d+[）)、.．]?\s*)?(?:见|参见|详见|请参阅)"
    r"(?:本章|本节|上文|下文|前文|后文|教材)?[^。！？!?；;]{0,80}"
    r"[。！？!?；;]?$"
)
_HEADING_PLUS_REFERENCE_ONLY = re.compile(
    r"^[^。！？!?；;]{1,48}(?:见|参见|详见|请参阅)"
    r"[^。！？!?；;]{0,80}[。！？!?；;]?$"
)


class SemanticOutputError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _semantic_error(code: str, message: str) -> SemanticOutputError:
    return SemanticOutputError(code, message)


def build_evidence_units(source_payload: dict) -> list[dict]:
    """Build small deterministic evidence units from one resolved Chapter projection."""
    units: list[dict] = []
    global_order = 0
    for section_order, section in enumerate(source_payload["source_sections"]):
        section_units: list[list[dict]] = []
        current: list[dict] = []
        current_characters = 0
        for line in section["lines"]:
            text = _normalize_text(line.get("text"))
            if not text:
                continue
            is_heading_or_item = bool(_HEADING_OR_ITEM.match(text))
            is_short_heading = _is_short_heading(text)
            page_changed = bool(
                current
                and current[-1]["pdf_page_index"] != line["pdf_page_index"]
            )
            starts_new_item = bool(current and is_heading_or_item)
            exceeds_hard_limit = bool(
                current
                and current_characters + len(text) > MAX_EVIDENCE_UNIT_CHARACTERS
            )
            if page_changed or starts_new_item or exceeds_hard_limit:
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

        for section_unit_order, lines in enumerate(section_units):
            text = _join_lines(lines)
            start = lines[0]
            end = lines[-1]
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
            global_order += 1
    if not units:
        raise ValueError("Chapter produced no deterministic evidence units")
    return units


def packetize_evidence_units(units: list[dict]) -> list[dict]:
    packets: list[dict] = []
    by_section: dict[str, list[dict]] = {}
    section_order: list[str] = []
    for unit in units:
        section_id = unit["primary_section_id"]
        if section_id not in by_section:
            by_section[section_id] = []
            section_order.append(section_id)
        by_section[section_id].append(unit)

    packet_order = 0
    for section_id in section_order:
        section_units = by_section[section_id]
        groups: list[list[dict]] = []
        current: list[dict] = []
        current_characters = 0
        for unit in section_units:
            unit_characters = len(unit["text"])
            if unit_characters > MAX_EVIDENCE_UNIT_CHARACTERS:
                raise ValueError("Evidence unit exceeds semantic packet safety bound")
            if current and (
                len(current) >= MAX_SEMANTIC_PACKET_UNITS
                or current_characters + unit_characters > MAX_SEMANTIC_PACKET_CHARACTERS
            ):
                groups.append(current)
                current = []
                current_characters = 0
            current.append(unit)
            current_characters += unit_characters
        if current:
            groups.append(current)

        for section_packet_index, group in enumerate(groups):
            packet_id = f"p{packet_order + 1:03d}"
            packets.append(
                {
                    "packet_id": packet_id,
                    "packet_order": packet_order,
                    "section_packet_index": section_packet_index,
                    "section_packet_count": len(groups),
                    "primary_section_id": section_id,
                    "primary_section_title": group[0]["primary_section_title"],
                    "units": group,
                    "character_count": sum(len(unit["text"]) for unit in group),
                }
            )
            packet_order += 1
    _validate_packet_coverage(units, packets)
    return packets


def semantic_packet_payload(
    chapter: dict,
    packet: dict,
    *,
    repair_context: dict | None = None,
    prior_section_candidates: list[dict] | None = None,
) -> dict:
    payload = {
        "chapter": {
            "chapter_outline_node_id": chapter["chapter_outline_node_id"],
            "title": chapter["title"],
        },
        "section": {
            "section_id": packet["primary_section_id"],
            "title": packet["primary_section_title"],
        },
        "packet": {
            "packet_id": packet["packet_id"],
            "packet_index": packet["section_packet_index"],
            "packet_count": packet["section_packet_count"],
        },
        "units": [
            {"unit_id": unit["unit_id"], "text": unit["text"]}
            for unit in packet["units"]
        ],
    }
    if prior_section_candidates:
        payload["prior_section_candidates"] = [
            {
                "title": candidate["title"],
                "one_sentence_meaning": candidate["one_sentence_meaning"][
                    :MAX_PRIOR_SECTION_MEANING_CHARACTERS
                ],
            }
            for candidate in prior_section_candidates[-MAX_PRIOR_SECTION_CANDIDATES:]
        ]
    if repair_context is not None:
        payload["repair_context"] = repair_context
    return payload


def validate_semantic_output(answer: str, packet: dict) -> list[dict]:
    try:
        value = json.loads(answer)
    except (TypeError, ValueError):
        raise _semantic_error("not_json", "Semantic output is not JSON") from None
    if not isinstance(value, dict) or set(value) != {"decisions"}:
        raise _semantic_error("top_level_fields", "Semantic output fields are invalid")
    decisions = value["decisions"]
    if not isinstance(decisions, list) or not 1 <= len(decisions) <= len(packet["units"]):
        raise _semantic_error("decision_count", "Semantic decision count is invalid")

    supplied = [unit["unit_id"] for unit in packet["units"]]
    position = {unit_id: index for index, unit_id in enumerate(supplied)}
    consumed: list[str] = []
    normalized: list[dict] = []
    previous_end = -1
    for decision in decisions:
        if not isinstance(decision, dict) or "action" not in decision:
            raise _semantic_error("decision_shape", "Semantic decision is invalid")
        action = decision["action"]
        expected = {"action", "unit_ids"} if action == "DROP" else {
            "action", "unit_ids", "title", "one_sentence_meaning"
        }
        if action not in {"KEEP", "MERGE", "DROP"} or set(decision) != expected:
            raise _semantic_error("decision_fields", "Semantic decision fields are invalid")
        unit_ids = decision["unit_ids"]
        if not isinstance(unit_ids, list) or not unit_ids or any(
            not isinstance(unit_id, str) or unit_id not in position
            for unit_id in unit_ids
        ) or len(unit_ids) != len(set(unit_ids)):
            raise _semantic_error("unit_ids", "Semantic decision unit IDs are invalid")
        positions = [position[unit_id] for unit_id in unit_ids]
        if positions != list(range(positions[0], positions[0] + len(positions))):
            raise _semantic_error(
                "noncontiguous_units",
                "Semantic decision unit IDs are not an ordered contiguous run",
            )
        if positions[0] <= previous_end:
            raise _semantic_error(
                "reordered_or_reused_units",
                "Semantic decisions are reordered or consume a unit twice",
            )
        previous_end = positions[-1]
        if action == "KEEP" and len(unit_ids) != 1:
            raise _semantic_error("keep_arity", "KEEP must reference exactly one evidence unit")
        if action == "MERGE" and len(unit_ids) < 2:
            raise _semantic_error(
                "merge_arity", "MERGE must reference at least two adjacent evidence units"
            )
        item = {"action": action, "unit_ids": list(unit_ids)}
        if action != "DROP":
            title = decision["title"]
            meaning = decision["one_sentence_meaning"]
            if not isinstance(title, str) or not 1 <= len(title.strip()) <= 80:
                raise _semantic_error("title", "Semantic title is invalid")
            if not isinstance(meaning, str) or not 1 <= len(meaning.strip()) <= 300:
                raise _semantic_error("meaning", "Semantic meaning is invalid")
            selected_texts = [
                packet["units"][position[unit_id]]["text"] for unit_id in unit_ids
            ]
            if all(_is_non_teaching_prompt(text) for text in selected_texts):
                raise _semantic_error(
                    "nonteaching_evidence",
                    "A published candidate cannot be grounded only in questions or references",
                )
            item["title"] = title.strip()
            item["one_sentence_meaning"] = meaning.strip()
        normalized.append(item)
        consumed.extend(unit_ids)
    if consumed != supplied:
        raise _semantic_error(
            "incomplete_accounting",
            "Semantic output does not account for every supplied unit exactly once",
        )
    return normalized


def materialize_candidates(
    packets: list[dict], decisions_by_packet: dict[str, list[dict]]
) -> list[dict]:
    if set(decisions_by_packet) != {packet["packet_id"] for packet in packets}:
        raise ValueError("Semantic decision ledger is incomplete")
    candidates: list[dict] = []
    for packet in packets:
        unit_index = {unit["unit_id"]: unit for unit in packet["units"]}
        for decision in decisions_by_packet[packet["packet_id"]]:
            if decision["action"] == "DROP":
                continue
            selected = [unit_index[unit_id] for unit_id in decision["unit_ids"]]
            first = selected[0]
            last = selected[-1]
            candidates.append(
                {
                    "candidate_id": f"c{len(candidates) + 1:04d}",
                    "packet_id": packet["packet_id"],
                    "unit_ids": list(decision["unit_ids"]),
                    "decision_action": decision["action"],
                    "source_revision_id": first["source_revision_id"],
                    "primary_section_id": first["primary_section_id"],
                    "title": decision["title"],
                    "one_sentence_definition": decision["one_sentence_meaning"],
                    "order_index": first["order_index"],
                    "start_page": first["start_page"],
                    "start_y": first["start_y"],
                    "end_page": last["end_page"],
                    "end_y": last["end_y"],
                }
            )
    candidates.sort(key=lambda candidate: candidate["order_index"])
    if not 1 <= len(candidates) <= 120:
        raise ValueError("Materialized Chapter KP count is implausible")
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
    packets: list[dict],
    decisions_by_packet: dict[str, list[dict]],
    candidates: list[dict],
    *,
    semantic_provider: str,
    semantic_model: str,
    semantic_repair_round: int,
    review_rubric: tuple[str, ...],
    overlap_warnings: list[dict],
) -> dict:
    candidate_by_membership = {
        (candidate["packet_id"], tuple(candidate["unit_ids"])): candidate["candidate_id"]
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
    packet_ledger = []
    for packet in packets:
        decisions = []
        for decision in decisions_by_packet[packet["packet_id"]]:
            item = {
                "action": decision["action"],
                "unit_ids": list(decision["unit_ids"]),
            }
            candidate_id = candidate_by_membership.get(
                (packet["packet_id"], tuple(decision["unit_ids"]))
            )
            if candidate_id is not None:
                item["candidate_id"] = candidate_id
            decisions.append(item)
        packet_ledger.append(
            {
                "packet_id": packet["packet_id"],
                "section_id": packet["primary_section_id"],
                "decisions": decisions,
            }
        )
    ledger = {
        "chapter": {
            "chapter_outline_node_id": chapter["chapter_outline_node_id"],
            "title": chapter["title"],
        },
        "sections": sections,
        "packets": packet_ledger,
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
            "packet_count": len(packets),
            "semantic_repair_round": semantic_repair_round,
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
    decision_unit_ids = [
        unit_id
        for packet in ledger["packets"]
        for decision in packet["decisions"]
        for unit_id in decision["unit_ids"]
    ]
    if decision_unit_ids != unit_ids:
        raise ValueError("Compact Review ledger does not completely account for units")
    candidate_ids = {candidate["candidate_id"] for candidate in ledger["candidates"]}
    decision_candidate_ids = {
        decision["candidate_id"]
        for packet in ledger["packets"]
        for decision in packet["decisions"]
        if "candidate_id" in decision
    }
    if not candidate_ids or candidate_ids != decision_candidate_ids:
        raise ValueError("Compact Review ledger candidate membership is invalid")
    prohibited = {
        "text", "lines", "line_ref", "start_ref", "end_ref", "pdf_page_index",
        "start_page", "start_y", "end_page", "end_y", "geometry", "quad",
        "source_revision_id", "reasoning", "reasoning_content",
    }
    if _contains_key(ledger, prohibited):
        raise ValueError("Compact Review ledger contains source-authority fields")


def repair_packet_ids(
    findings: tuple[dict, ...], units: list[dict], packets: list[dict]
) -> list[str]:
    unit_index = {unit["unit_id"]: unit for unit in units}
    packet_by_unit = {
        unit["unit_id"]: packet["packet_id"]
        for packet in packets
        for unit in packet["units"]
    }
    target_units = []
    for finding in findings:
        if finding["severity"] != "BLOCKING":
            continue
        for unit_id in finding["unit_ids"]:
            if unit_id not in target_units:
                target_units.append(unit_id)
    if not target_units or len(target_units) > MAX_REPAIR_UNITS:
        raise ValueError("Review repair target is absent or over-broad")
    target_packets = []
    for unit_id in target_units:
        packet_id = packet_by_unit[unit_id]
        if packet_id not in target_packets:
            target_packets.append(packet_id)
    if len(target_packets) > MAX_REPAIR_PACKETS or (
        len(packets) > 1 and len(target_packets) == len(packets)
    ):
        raise ValueError("Review repair target spans too much of the Chapter")
    for section_id in {unit_index[unit_id]["primary_section_id"] for unit_id in target_units}:
        section_packets = {
            packet["packet_id"] for packet in packets
            if packet["primary_section_id"] == section_id
        }
        if len(section_packets) > 1 and section_packets.issubset(target_packets):
            raise ValueError("Review repair target requests complete-Section regeneration")
    return [
        packet["packet_id"] for packet in packets
        if packet["packet_id"] in target_packets
    ]


def _validate_packet_coverage(units: list[dict], packets: list[dict]) -> None:
    expected = [unit["unit_id"] for unit in units]
    actual = [
        unit["unit_id"] for packet in packets for unit in packet["units"]
    ]
    if expected != actual or len(actual) != len(set(actual)):
        raise ValueError("Semantic packetization changed evidence-unit accounting")
    for packet in packets:
        if len(packet["units"]) > MAX_SEMANTIC_PACKET_UNITS \
                or packet["character_count"] > MAX_SEMANTIC_PACKET_CHARACTERS:
            raise ValueError("Semantic packet exceeds configured bounds")
        if any(
            unit["primary_section_id"] != packet["primary_section_id"]
            for unit in packet["units"]
        ):
            raise ValueError("Semantic packet crosses a Section boundary")


def _normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _is_short_heading(text: str) -> bool:
    return bool(
        len(text) <= MAX_SHORT_HEADING_CHARACTERS
        and _HEADING_OR_ITEM.match(text)
        and not _TERMINAL_PUNCTUATION.search(text)
    )


def _is_non_teaching_prompt(text: str) -> bool:
    normalized = _normalize_text(text)
    if _REFERENCE_ONLY.fullmatch(normalized) or _HEADING_PLUS_REFERENCE_ONLY.fullmatch(
        normalized
    ):
        return True
    pieces = [
        piece.strip()
        for piece in re.findall(r"[^。！？!?；;]+[。！？!?；;]?", normalized)
        if piece.strip()
    ]
    return bool(pieces) and all(
        piece.endswith(("？", "?")) or _REFERENCE_ONLY.fullmatch(piece)
        for piece in pieces
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
