from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from reader_service.agent_runtime import ProviderFailure, ProviderRuntimeSet
from reader_service.knowledge.semantic import build_evidence_units
from reader_service.library import LibraryService
from reader_service.outline import OutlineRepository, OutlineService
from reader_service.storage import ManagedPaths


CONTRACT_VERSION = "kp-granularity-calibration-v2-group-first"
DEFAULT_LOCAL_ROOT = Path("var", "kp-calibration", "chapter-2")
DEFAULT_DATA_DIR = Path("var", "manual-browser")
DEFAULT_PDF_SHA256 = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"
DEFAULT_CHAPTER_MATCH = "第2章"
DEFAULT_PROVIDER = "deepseek"
DEFAULT_TECHNICAL_ATTEMPTS = 3
MAX_TITLE_CHARACTERS = 80
MAX_MEANING_CHARACTERS = 300

SYSTEM_MESSAGE = """你是教材 KnowledgePoint 粒度校准器，不是 Chapter Reviewer，也不是用户对话助手。
输入是一个由既有 Outline 确定边界的 subsection window，以及其中按教材顺序排列的 deterministic evidence units。
你必须在一次语义判断中直接给出该窗口最终的 learning-identity groups 与 non-KP units；不得先生成临时候选后再吸收、审计、清理或重新分区。

KnowledgePoint 是最小的、值得独立教学、独立检查、独立诊断、独立补救并长期记录掌握状态的学习单元。必须预设吸收：只有当前教材证据能正面证明某个内容需要独立教学、考查、诊断和补救，才建立一个 learning target。若吸收到相邻 learning target 不会实质损失 mastery 信息，就必须吸收。能单独出一道事实题、拥有不同术语、独立名词、段落或编号，都不足以形成 mastery boundary。

通用规则：
1. 单独的标题永远不是 KP。
2. 单独的例子永远不是 KP。
3. 小结中的重复内容不铸造新 KP。
4. FAQ 或 misconception 默认属于既有 learning target，并列入 non_kp_units，而不是新 KP。
5. 同一学习目标的 definition、property 和普通步骤默认属于同一 KP。
6. 只有证据充分支持不同机制、方法或考查目标，并且需要不同诊断与补救时，才分成不同 learning targets。

facet、property、step、example、summary、misconception 仍可能是有价值的教材证据；放入 non_kp_units 只表示“不在本窗口铸造成独立 KP”，不表示内容无价值。
不得追求特定 KP 数量，不得创建掩盖不同教学与补救需求的宽泛伞形 KP。

只返回一个 JSON 对象：{"learning_targets":[{"unit_ids":["一个或多个连续 unit_id"],"title":"标题","one_sentence_meaning":"一句话含义"}],"non_kp_units":["其余 unit_id"]}。
learning_targets 按教材顺序排列，每个 learning target 的 unit_ids 必须连续；non_kp_units 也按教材顺序排列。两者合计必须覆盖输入的每个 unit_id 恰好一次。
不得输出 page、line、ref、range、Section 改写、durable ID、justification、Markdown、推理过程或任何额外字段。"""


class ContractError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest_json(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.write("\n")


def build_windows(units: list[dict]) -> list[dict]:
    section_has_subsections = {
        unit["primary_section_id"]
        for unit in units
        if unit.get("outline_subsection_id") is not None
    }
    windows: list[dict] = []
    seen_closed: set[str] = set()
    for unit in units:
        subsection_id = unit.get("outline_subsection_id")
        section_id = unit["primary_section_id"]
        if subsection_id is not None:
            window_id = f"subsection:{subsection_id}"
            kind = "OUTLINE_SUBSECTION"
            title = unit.get("outline_subsection_title") or ""
        elif section_id in section_has_subsections:
            window_id = f"section-lead-in:{section_id}"
            kind = "SECTION_LEAD_IN"
            title = unit["primary_section_title"]
        else:
            window_id = f"section:{section_id}"
            kind = "SECTION"
            title = unit["primary_section_title"]
        if not windows or windows[-1]["window_id"] != window_id:
            if window_id in seen_closed:
                raise ValueError("Evidence window is not contiguous")
            if windows:
                seen_closed.add(windows[-1]["window_id"])
            windows.append(
                {
                    "window_id": window_id,
                    "kind": kind,
                    "section_id": section_id,
                    "section_title": unit["primary_section_title"],
                    "outline_subsection_id": subsection_id,
                    "title": title,
                    "units": [],
                }
            )
        windows[-1]["units"].append(unit)
    if not windows:
        raise ValueError("Evidence bundle contains no calibration windows")
    return windows


def validate_partition(answer: str, window: dict) -> list[dict]:
    try:
        value = json.loads(answer)
    except (TypeError, ValueError):
        raise ContractError("not_json", "Reducer output is not one JSON object") from None
    if not isinstance(value, dict) or set(value) != {
        "learning_targets", "non_kp_units"
    }:
        raise ContractError("top_level_fields", "Reducer output has invalid top-level fields")
    learning_targets = value["learning_targets"]
    non_kp_units = value["non_kp_units"]
    supplied = [unit["unit_id"] for unit in window["units"]]
    if (
        not isinstance(learning_targets, list)
        or len(learning_targets) > len(supplied)
        or not isinstance(non_kp_units, list)
    ):
        raise ContractError("partition_shape", "Reducer partition shape is invalid")
    position = {unit_id: index for index, unit_id in enumerate(supplied)}
    target_decisions: list[tuple[int, dict]] = []
    consumed: list[str] = []
    previous_end = -1
    for target in learning_targets:
        if not isinstance(target, dict) or set(target) != {
            "unit_ids", "title", "one_sentence_meaning"
        }:
            raise ContractError("target_fields", "Learning-target fields are invalid")
        unit_ids = target["unit_ids"]
        if (
            not isinstance(unit_ids, list)
            or not unit_ids
            or any(not isinstance(unit_id, str) or unit_id not in position for unit_id in unit_ids)
            or len(unit_ids) != len(set(unit_ids))
        ):
            raise ContractError("unit_ids", "Reducer decision references invalid unit IDs")
        positions = [position[unit_id] for unit_id in unit_ids]
        if positions != list(range(positions[0], positions[0] + len(positions))):
            raise ContractError("noncontiguous_units", "Reducer decision crosses a unit boundary")
        if positions[0] <= previous_end:
            raise ContractError("reordered_or_reused_units", "Reducer reordered or reused units")
        previous_end = positions[-1]
        title = target["title"]
        meaning = target["one_sentence_meaning"]
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= MAX_TITLE_CHARACTERS:
            raise ContractError("title", "Reducer title is invalid")
        if (
            not isinstance(meaning, str)
            or not 1 <= len(meaning.strip()) <= MAX_MEANING_CHARACTERS
        ):
            raise ContractError("meaning", "Reducer one-sentence meaning is invalid")
        target_decisions.append(
            (
                positions[0],
                {
                    "action": "KEEP" if len(unit_ids) == 1 else "MERGE",
                    "unit_ids": list(unit_ids),
                    "title": title.strip(),
                    "one_sentence_meaning": meaning.strip(),
                },
            )
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
        raise ContractError("non_kp_units", "non_kp_units are invalid or out of order")
    consumed.extend(non_kp_units)
    if len(consumed) != len(set(consumed)) or set(consumed) != set(supplied):
        raise ContractError(
            "incomplete_accounting",
            "Reducer output does not account for every unit exactly once",
        )

    drop_decisions: list[tuple[int, dict]] = []
    for unit_id in non_kp_units:
        unit_position = position[unit_id]
        if (
            drop_decisions
            and drop_decisions[-1][0]
            + len(drop_decisions[-1][1]["unit_ids"])
            == unit_position
        ):
            drop_decisions[-1][1]["unit_ids"].append(unit_id)
        else:
            drop_decisions.append(
                (unit_position, {"action": "DROP", "unit_ids": [unit_id]})
            )
    normalized = [
        decision
        for _, decision in sorted(target_decisions + drop_decisions, key=lambda item: item[0])
    ]
    return normalized


def _constraint_ids(constraint: dict) -> Iterable[str]:
    if constraint["type"] in {"MUST_SAME", "NON_KP"}:
        yield from constraint["unit_ids"]
    else:
        yield from constraint["left_unit_ids"]
        yield from constraint["right_unit_ids"]


def validate_golden(golden: dict, evidence: dict, windows: list[dict]) -> None:
    if golden.get("schema_version") != 1:
        raise ValueError("Golden schema_version must be 1")
    if golden.get("evidence_units_sha256") != evidence["manifest"]["evidence_units_sha256"]:
        raise ValueError("Golden does not match the frozen evidence-unit bundle")
    golden_windows = golden.get("windows")
    if not isinstance(golden_windows, list):
        raise ValueError("Golden windows must be a list")
    actual_by_id = {window["window_id"]: window for window in windows}
    if {item.get("window_id") for item in golden_windows} != set(actual_by_id):
        raise ValueError("Golden must contain every frozen evidence window exactly once")
    allowed_constraint_types = {
        "MUST_SAME", "MUST_SEPARATE", "NON_KP", "OPTIONAL_BOUNDARY"
    }
    for item in golden_windows:
        window = actual_by_id[item["window_id"]]
        unit_ids = {unit["unit_id"] for unit in window["units"]}
        targets = item.get("expected_grouping")
        constraints = item.get("constraints")
        if not isinstance(targets, list) or not isinstance(constraints, list):
            raise ValueError("Golden window must contain expected_grouping and constraints")
        target_ids: set[str] = set()
        for target in targets:
            required = {
                "target_id", "canonical_title", "canonical_meaning", "unit_ids",
                "core_unit_ids", "necessary_unit_ids",
            }
            if not isinstance(target, dict) or set(target) != required:
                raise ValueError("Golden learning target fields are invalid")
            if target["target_id"] in target_ids:
                raise ValueError("Golden target IDs must be unique within one window")
            target_ids.add(target["target_id"])
            target_units = set(target["unit_ids"])
            if not target_units or not target_units <= unit_ids:
                raise ValueError("Golden target references foreign or empty evidence")
            if not set(target["core_unit_ids"]) <= target_units:
                raise ValueError("Golden core evidence must belong to its target")
            if not set(target["necessary_unit_ids"]) <= target_units:
                raise ValueError("Golden necessary evidence must belong to its target")
            if not target["core_unit_ids"]:
                raise ValueError("Every Golden target requires core evidence")
        for constraint in constraints:
            if not isinstance(constraint, dict) or constraint.get("type") not in allowed_constraint_types:
                raise ValueError("Golden constraint type is invalid")
            relation_ids = list(_constraint_ids(constraint))
            if not relation_ids or len(relation_ids) != len(set(relation_ids)):
                raise ValueError("Golden constraint has empty or repeated unit IDs")
            if not set(relation_ids) <= unit_ids:
                raise ValueError("Golden constraint references a foreign unit")
            if constraint["type"] == "MUST_SAME" and len(relation_ids) < 2:
                raise ValueError("MUST_SAME requires at least two units")
            if constraint["type"] in {"MUST_SEPARATE", "OPTIONAL_BOUNDARY"} and (
                not constraint["left_unit_ids"] or not constraint["right_unit_ids"]
            ):
                raise ValueError("Boundary constraint requires evidence on both sides")


def score_window(window: dict, golden_window: dict, decisions: list[dict]) -> dict:
    group_by_unit: dict[str, str | None] = {}
    predicted = []
    retained_index = 0
    for decision in decisions:
        if decision["action"] == "DROP":
            for unit_id in decision["unit_ids"]:
                group_by_unit[unit_id] = None
            continue
        retained_index += 1
        group_id = f"predicted-{retained_index:02d}"
        for unit_id in decision["unit_ids"]:
            group_by_unit[unit_id] = group_id
        predicted.append({"predicted_group_id": group_id, **decision})

    constraints = golden_window["constraints"]
    non_kp_ids = {
        unit_id
        for constraint in constraints
        if constraint["type"] == "NON_KP"
        for unit_id in constraint["unit_ids"]
    }
    findings: list[dict] = []
    for index, constraint in enumerate(constraints):
        relation_id = constraint.get("relation_id", f"relation-{index + 1:03d}")
        if constraint["type"] == "MUST_SAME":
            retained_groups = {
                group_by_unit[unit_id]
                for unit_id in constraint["unit_ids"]
                if group_by_unit[unit_id] is not None
            }
            if len(retained_groups) > 1:
                findings.append(
                    {
                        "type": "OVER_SPLIT",
                        "relation_id": relation_id,
                        "unit_ids": constraint["unit_ids"],
                        "reason": constraint.get("reason", "MUST_SAME evidence was split"),
                    }
                )
        elif constraint["type"] == "MUST_SEPARATE":
            left_groups = {
                group_by_unit[unit_id]
                for unit_id in constraint["left_unit_ids"]
                if group_by_unit[unit_id] is not None
            }
            right_groups = {
                group_by_unit[unit_id]
                for unit_id in constraint["right_unit_ids"]
                if group_by_unit[unit_id] is not None
            }
            shared = left_groups & right_groups
            if shared:
                findings.append(
                    {
                        "type": "OVER_MERGE",
                        "relation_id": relation_id,
                        "left_unit_ids": constraint["left_unit_ids"],
                        "right_unit_ids": constraint["right_unit_ids"],
                        "predicted_group_ids": sorted(shared),
                        "reason": constraint.get("reason", "MUST_SEPARATE evidence was merged"),
                    }
                )

    for group in predicted:
        if set(group["unit_ids"]) <= non_kp_ids:
            findings.append(
                {
                    "type": "INVALID_NEW_KP",
                    "predicted_group_id": group["predicted_group_id"],
                    "unit_ids": group["unit_ids"],
                    "reason": "A retained KP contains only NON_KP evidence",
                }
            )

    for target in golden_window["expected_grouping"]:
        core_groups = {
            group_by_unit[unit_id]
            for unit_id in target["core_unit_ids"]
            if group_by_unit[unit_id] is not None
        }
        if not core_groups:
            findings.append(
                {
                    "type": "MISSING_KP",
                    "target_id": target["target_id"],
                    "unit_ids": target["core_unit_ids"],
                    "reason": "All core evidence for the learning target was dropped",
                }
            )
        wrongly_dropped = [
            unit_id
            for unit_id in target["necessary_unit_ids"]
            if group_by_unit[unit_id] is None
        ]
        if wrongly_dropped:
            findings.append(
                {
                    "type": "WRONG_DROP",
                    "target_id": target["target_id"],
                    "unit_ids": wrongly_dropped,
                    "reason": "Necessary evidence for the learning target was dropped",
                }
            )

    return {
        "window_id": window["window_id"],
        "findings": findings,
    }


def summarize_attempts(attempts: list[dict]) -> dict:
    latencies = [
        int(attempt["latency_ms"])
        for attempt in attempts
        if attempt.get("latency_ms") is not None
    ]
    usage = {
        key: sum(
            int((attempt.get("usage") or {}).get(key) or 0)
            for attempt in attempts
        )
        for key in ("prompt_tokens", "completion_tokens", "total_tokens")
    }
    return {
        "technical_attempt_count": len(attempts),
        "latency_ms": {
            "total": sum(latencies),
            "min": min(latencies) if latencies else None,
            "max": max(latencies) if latencies else None,
        },
        "token_usage": usage,
    }


def _descendants(nodes: list[dict], chapter_id: str) -> list[dict]:
    accepted = {chapter_id}
    result = []
    while True:
        added = False
        for node in nodes:
            if node["outline_node_id"] in accepted:
                if node not in result:
                    result.append(node)
                continue
            if node.get("parent_id") in accepted:
                accepted.add(node["outline_node_id"])
                result.append(node)
                added = True
        if not added:
            break
    return result


def freeze_evidence(
    *,
    data_dir: Path,
    pdf_sha256: str,
    chapter_match: str,
    output_path: Path,
) -> dict:
    library = LibraryService(ManagedPaths(data_dir))
    books = [
        book
        for book in library.list_books()
        if book["active_revision"]["blob_sha256"] == pdf_sha256
    ]
    if len(books) != 1:
        raise ValueError("Expected exactly one local book matching the requested PDF hash")
    revision = books[0]["active_revision"]
    outline_repository = OutlineRepository(library.database)
    nodes = outline_repository.list(revision["id"])
    chapters = [
        node
        for node in nodes
        if node["kind"] == "CHAPTER"
        and node["parent_id"] is None
        and chapter_match in node["title"]
    ]
    if len(chapters) != 1:
        raise ValueError("Expected exactly one Chapter matching the requested title")
    chapter = chapters[0]
    descendants = _descendants(nodes, chapter["outline_node_id"])
    knowledge_nodes = [
        node
        for node in descendants
        if node["kind"] in {"CHAPTER", "SECTION", "SUBSECTION"}
    ]
    for node in knowledge_nodes:
        if node["resolution_state"] != "RESOLVED" or any(
            node.get(field) is None
            for field in ("start_page", "start_y", "end_page", "end_y")
        ):
            raise ValueError("Freeze requires already-resolved Chapter/Section/Subsection ranges")

    _, ready_pages = outline_repository.ready_snapshot(revision["id"])
    source_sections = []
    for section in sorted(
        (node for node in knowledge_nodes if node["kind"] == "SECTION"),
        key=lambda value: value["order_index"],
    ):
        bounds = (
            (int(section["start_page"]), float(section["start_y"])),
            (int(section["end_page"]), float(section["end_y"])),
        )
        section_lines = [
            line
            for page in range(bounds[0][0], bounds[1][0] + 1)
            for line in ready_pages.get(page, [])
            if bounds[0]
            <= (int(line["pdf_page_index"]), min(float(point[1]) for point in line["quad"]))
            < bounds[1]
        ]
        excluded_start = None
        for special in sorted(
            (
                node
                for node in descendants
                if node.get("parent_id") == section["outline_node_id"]
                and node["kind"] in {"EXERCISES", "ANSWERS"}
            ),
            key=lambda value: value["order_index"],
        ):
            match = OutlineService._match_heading(special, section_lines, bounds[0])
            if match is not None:
                position = (int(match["page"]), float(match["start_y"]))
                if excluded_start is None or position < excluded_start:
                    excluded_start = position
        subsections = [
            {
                "outline_node_id": node["outline_node_id"],
                "title": node["title"],
                "start": (int(node["start_page"]), float(node["start_y"])),
                "end": (int(node["end_page"]), float(node["end_y"])),
            }
            for node in knowledge_nodes
            if node["kind"] == "SUBSECTION"
            and node.get("parent_id") == section["outline_node_id"]
        ]
        subsections.sort(key=lambda value: value["start"])
        projected_lines = []
        for line in section_lines:
            ys = [float(point[1]) for point in line["quad"]]
            position = (int(line["pdf_page_index"]), min(ys))
            if excluded_start is not None and position >= excluded_start:
                continue
            projected_lines.append(
                {
                    "line_ref": f"p{line['pdf_page_index']}:l{line['line_ordinal']}",
                    "pdf_page_index": int(line["pdf_page_index"]),
                    "line_ordinal": int(line["line_ordinal"]),
                    "y_start": min(ys),
                    "y_end": max(ys),
                    "text": line["text"],
                }
            )
        if not projected_lines:
            raise ValueError(f"Resolved Section has no calibration evidence: {section['title']}")
        source_sections.append(
            {
                "section_id": section["outline_node_id"],
                "title": section["title"],
                "subsections": subsections,
                "lines": projected_lines,
            }
        )

    source_payload = {
        "chapter": {
            "book_source_revision_id": revision["id"],
            "chapter_outline_node_id": chapter["outline_node_id"],
            "title": chapter["title"],
        },
        "source_sections": source_sections,
    }
    units = build_evidence_units(source_payload)
    windows = build_windows(units)
    outline_snapshot = [
        {
            key: node.get(key)
            for key in (
                "outline_node_id", "parent_id", "kind", "title", "order_index",
                "identity_revision", "physical_revision", "start_page", "start_y",
                "end_page", "end_y",
            )
        }
        for node in descendants
    ]
    evidence_units_sha256 = digest_json(units)
    evidence = {
        "schema_version": 1,
        "manifest": {
            "pdf_sha256": revision["blob_sha256"],
            "book_source_revision_id": revision["id"],
            "chapter_outline_node_id": chapter["outline_node_id"],
            "chapter_title": chapter["title"],
            "outline_snapshot_sha256": digest_json(outline_snapshot),
            "evidence_builder_sha256": hashlib.sha256(
                inspect.getsource(build_evidence_units).encode("utf-8")
            ).hexdigest(),
            "evidence_units_sha256": evidence_units_sha256,
            "unit_count": len(units),
            "window_count": len(windows),
            "frozen_at": datetime.now(UTC).isoformat(),
        },
        "units": units,
        "windows": [
            {
                key: window[key]
                for key in (
                    "window_id", "kind", "section_id", "section_title",
                    "outline_subsection_id", "title",
                )
            }
            | {"unit_ids": [unit["unit_id"] for unit in window["units"]]}
            for window in windows
        ],
    }
    write_json(output_path, evidence)
    return evidence


def run_calibration(
    *,
    evidence_path: Path,
    golden_path: Path,
    report_path: Path,
    provider: str,
    technical_attempts: int,
) -> dict:
    if technical_attempts < 1 or technical_attempts > 3:
        raise ValueError("technical_attempts must be between 1 and 3")
    evidence = load_json(evidence_path)
    units = evidence.get("units")
    if not isinstance(units, list) or digest_json(units) != evidence["manifest"].get(
        "evidence_units_sha256"
    ):
        raise ValueError("Frozen evidence-unit bundle failed its integrity check")
    windows = build_windows(units)
    frozen_windows = evidence.get("windows")
    actual_window_projection = [
        {
            key: window[key]
            for key in (
                "window_id", "kind", "section_id", "section_title",
                "outline_subsection_id", "title",
            )
        }
        | {"unit_ids": [unit["unit_id"] for unit in window["units"]]}
        for window in windows
    ]
    if frozen_windows != actual_window_projection:
        raise ValueError("Frozen evidence window projection no longer matches its units")
    golden = load_json(golden_path)
    validate_golden(golden, evidence, windows)
    golden_by_window = {item["window_id"]: item for item in golden["windows"]}
    runtime = ProviderRuntimeSet.from_environment()
    provider_name, model_name = runtime.provider_identity(provider)

    results = []
    all_findings = []
    all_attempts = []
    for window in windows:
        payload = {
            "contract_version": CONTRACT_VERSION,
            "chapter": {
                "title": evidence["manifest"]["chapter_title"],
            },
            "window": {
                "window_id": window["window_id"],
                "kind": window["kind"],
                "section_title": window["section_title"],
                "outline_subsection_title": (
                    window["title"] if window["kind"] == "OUTLINE_SUBSECTION" else None
                ),
            },
            "units": [
                {"unit_id": unit["unit_id"], "text": unit["text"]}
                for unit in window["units"]
            ],
        }
        messages = [
            {"role": "system", "content": SYSTEM_MESSAGE},
            {"role": "user", "content": canonical_json(payload)},
        ]
        attempts = []
        decisions = None
        contract_failure = None
        for attempt in range(1, technical_attempts + 1):
            try:
                completion = runtime.complete_for_with_metadata(
                    provider,
                    messages,
                    interaction_id=f"kp-calibration:{uuid4()}:{window['window_id']}:technical-{attempt}",
                    max_tokens=4096,
                    temperature=0.0,
                    retain_request_body=False,
                    thinking_mode="disabled" if provider == "deepseek" else None,
                    reasoning_effort="low" if provider == "zhipu" else None,
                    json_mode=provider == "deepseek",
                )
            except ProviderFailure as failure:
                attempts.append(
                    {
                        "attempt": attempt,
                        "outcome": "PROVIDER_FAILURE",
                        "failure_kind": failure.kind.value,
                        "failure_code": failure.code,
                    }
                )
                contract_failure = {
                    "type": "CONTRACT_INVALID",
                    "code": failure.code,
                    "reason": failure.user_message,
                }
                continue
            try:
                decisions = validate_partition(completion.answer, window)
            except ContractError as failure:
                attempts.append(
                    {
                        "attempt": attempt,
                        "outcome": "CONTRACT_INVALID",
                        "failure_code": failure.code,
                        "latency_ms": completion.latency_ms,
                        "finish_reason": (completion.response_metadata or {}).get(
                            "finish_reason"
                        ),
                        "usage": completion.usage,
                    }
                )
                contract_failure = {
                    "type": "CONTRACT_INVALID",
                    "code": failure.code,
                    "reason": str(failure),
                }
                continue
            attempts.append(
                {
                    "attempt": attempt,
                    "outcome": "VALID",
                    "latency_ms": completion.latency_ms,
                    "finish_reason": (completion.response_metadata or {}).get("finish_reason"),
                    "usage": completion.usage,
                }
            )
            contract_failure = None
            break

        if decisions is None:
            result = {
                "window_id": window["window_id"],
                "section_title": window["section_title"],
                "window_title": window["title"],
                "performance": summarize_attempts(attempts),
                "golden_relation_diff": [contract_failure],
            }
        else:
            scored = score_window(window, golden_by_window[window["window_id"]], decisions)
            result = {
                "window_id": window["window_id"],
                "section_title": window["section_title"],
                "window_title": window["title"],
                "performance": summarize_attempts(attempts),
                "golden_relation_diff": scored["findings"],
            }
        all_attempts.extend(attempts)
        all_findings.extend(result["golden_relation_diff"])
        results.append(result)

    finding_counts = Counter(finding["type"] for finding in all_findings)
    reported_finding_types = (
        "OVER_SPLIT",
        "OVER_MERGE",
        "INVALID_NEW_KP",
        "MISSING_KP",
        "WRONG_DROP",
        "CONTRACT_INVALID",
    )
    report = {
        "schema_version": 1,
        "status": "HUMAN_REVIEW_REQUIRED",
        "generated_at": datetime.now(UTC).isoformat(),
        "contract": {
            "version": CONTRACT_VERSION,
            "system_message_sha256": hashlib.sha256(
                SYSTEM_MESSAGE.encode("utf-8")
            ).hexdigest(),
            "one_semantic_partition_per_window": True,
            "technical_attempt_limit": technical_attempts,
            "semantic_repartition": False,
        },
        "input": {
            **evidence["manifest"],
            "golden_sha256": digest_json(golden),
        },
        "provider": {"provider": provider_name, "model": model_name},
        "finding_counts": {
            finding_type: finding_counts[finding_type]
            for finding_type in reported_finding_types
        },
        "performance": summarize_attempts(all_attempts),
        "windows": results,
    }
    write_json(report_path, report)
    return report


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="Calibrate KP learning-identity granularity")
    subparsers = value.add_subparsers(dest="command", required=True)
    freeze = subparsers.add_parser(
        "freeze", help="Freeze already-resolved local Chapter evidence without OCR or publication"
    )
    freeze.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    freeze.add_argument("--pdf-sha256", default=DEFAULT_PDF_SHA256)
    freeze.add_argument("--chapter-match", default=DEFAULT_CHAPTER_MATCH)
    freeze.add_argument(
        "--output", type=Path, default=DEFAULT_LOCAL_ROOT / "evidence.json"
    )
    run = subparsers.add_parser(
        "run", help="Run one reducer partition per frozen Outline window"
    )
    run.add_argument(
        "--evidence", type=Path, default=DEFAULT_LOCAL_ROOT / "evidence.json"
    )
    run.add_argument(
        "--golden", type=Path, default=DEFAULT_LOCAL_ROOT / "golden.json"
    )
    run.add_argument(
        "--report", type=Path, default=DEFAULT_LOCAL_ROOT / "report.json"
    )
    run.add_argument("--provider", default=DEFAULT_PROVIDER)
    run.add_argument(
        "--technical-attempts", type=int, default=DEFAULT_TECHNICAL_ATTEMPTS
    )
    return value


def main() -> int:
    args = parser().parse_args()
    try:
        if args.command == "freeze":
            evidence = freeze_evidence(
                data_dir=args.data_dir,
                pdf_sha256=args.pdf_sha256,
                chapter_match=args.chapter_match,
                output_path=args.output,
            )
            print(
                json.dumps(
                    {
                        "output": str(args.output.resolve()),
                        "unit_count": evidence["manifest"]["unit_count"],
                        "window_count": evidence["manifest"]["window_count"],
                        "evidence_units_sha256": evidence["manifest"][
                            "evidence_units_sha256"
                        ],
                    },
                    ensure_ascii=False,
                )
            )
        else:
            report = run_calibration(
                evidence_path=args.evidence,
                golden_path=args.golden,
                report_path=args.report,
                provider=args.provider,
                technical_attempts=args.technical_attempts,
            )
            print(
                json.dumps(
                    {
                        "report": str(args.report.resolve()),
                        "provider": report["provider"],
                        "finding_counts": report["finding_counts"],
                        "performance": report["performance"],
                    },
                    ensure_ascii=False,
                )
            )
        return 0
    except Exception as failure:
        print(
            json.dumps(
                {"error": type(failure).__name__, "detail": str(failure)},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
