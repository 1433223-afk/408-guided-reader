from __future__ import annotations

from dataclasses import dataclass

from reader_service.foundation import FoundationService
from reader_service.outline import OutlineService


MAX_SELECTED_CHARS = 2_000
MAX_CONTEXT_CHARS = 1_600
CONTEXT_LINES_EACH_SIDE = 3


@dataclass(frozen=True, slots=True)
class ScopeResolution:
    key: str
    kind: str
    pdf_page_index: int
    section_id: str | None = None
    section_title: str | None = None
    chapter_title: str | None = None

    def public(self) -> dict:
        return {
            "key": self.key,
            "kind": self.kind,
            "pdf_page_index": self.pdf_page_index,
            "section_id": self.section_id,
            "section_title": self.section_title,
            "chapter_title": self.chapter_title,
        }


@dataclass(frozen=True, slots=True)
class ModelVisibleReaderGrounding:
    """Allowlisted Reader evidence that may cross the provider boundary."""

    pdf_page_number: int
    chapter_title: str | None
    section_title: str | None
    printed_page_label: str | None
    bounded_same_page_ocr: str
    pdf_page_numbers: tuple[int, ...] = ()
    source_notice: str | None = None


@dataclass(frozen=True, slots=True)
class ModelVisibleContext:
    """Semantic-only Child projection; it deliberately cannot hold tree state."""

    current_focus: str
    direct_previous_focus: str
    direct_previous_answer: str
    concept_path: tuple[str, ...]
    reader_grounding: ModelVisibleReaderGrounding

    def __post_init__(self) -> None:
        if not self.current_focus or not self.current_focus.strip():
            raise ValueError("Current focus cannot be empty")
        if not self.direct_previous_focus or not self.direct_previous_focus.strip():
            raise ValueError("Direct previous focus cannot be empty")
        if not self.direct_previous_answer or not self.direct_previous_answer.strip():
            raise ValueError("Direct previous answer cannot be empty")
        if not 2 <= len(self.concept_path) <= 5:
            raise ValueError("Concept path must contain 2 to 5 semantic labels")
        if self.concept_path[-1] != self.current_focus:
            raise ValueError("Concept path must end at the current focus")


class ScopeResolver:
    """Pure read over the stored Pass-1 Outline; it never resolves or mints nodes."""

    def __init__(self, outline: OutlineService):
        self.outline = outline

    def resolve(self, revision_id: str, page_index: int) -> ScopeResolution:
        nodes = self.outline.repository.list(revision_id)
        section = self._unique_containing(nodes, page_index, {"SECTION", "SUBSECTION"})
        chapter = self._unique_containing(nodes, page_index, {"CHAPTER"})
        chapter_title = chapter["title"] if chapter else None
        if section is None:
            return ScopeResolution(
                key=f"PAGE:{page_index}",
                kind="PAGE",
                pdf_page_index=page_index,
                chapter_title=chapter_title,
            )
        return ScopeResolution(
            key=f"SECTION:{section['outline_node_id']}",
            kind="SECTION",
            pdf_page_index=page_index,
            section_id=section["outline_node_id"],
            section_title=section["title"],
            chapter_title=chapter_title,
        )

    @classmethod
    def _unique_containing(
        cls, nodes: list[dict], page_index: int, allowed_kinds: set[str]
    ) -> dict | None:
        ordered = cls._topological(nodes)
        candidates = []
        for index, node in enumerate(ordered):
            start = node.get("start_page")
            if node.get("kind") not in allowed_kinds or not isinstance(start, int):
                continue
            end = None
            for later in ordered[index + 1:]:
                later_start = later.get("start_page")
                if not isinstance(later_start, int) or later.get("depth", 0) > node.get("depth", 0):
                    continue
                end = later_start
                break
            if start <= page_index and (end is None or page_index < end):
                candidates.append(node)

        # Several incomparable Section starts on this exact page are physically
        # indistinguishable without Pass 2. Never let an empty first interval turn
        # into the forbidden "latest starting" guess.
        starters = [
            node for node in ordered
            if node.get("kind") in allowed_kinds and node.get("start_page") == page_index
        ]
        if starters and not cls._forms_one_ancestry_chain(starters, ordered):
            return None
        if not candidates or not cls._forms_one_ancestry_chain(candidates, ordered):
            return None
        return max(candidates, key=lambda node: int(node.get("depth", 0)))

    @staticmethod
    def _topological(nodes: list[dict]) -> list[dict]:
        children: dict[str | None, list[dict]] = {}
        for node in nodes:
            children.setdefault(node.get("parent_id"), []).append(node)
        for values in children.values():
            values.sort(key=lambda node: (node["order_index"], node["outline_node_id"]))
        ordered = []

        def visit(parent_id: str | None) -> None:
            for node in children.get(parent_id, []):
                ordered.append(node)
                visit(node["outline_node_id"])

        visit(None)
        return ordered

    @staticmethod
    def _forms_one_ancestry_chain(values: list[dict], nodes: list[dict]) -> bool:
        parents = {node["outline_node_id"]: node.get("parent_id") for node in nodes}

        def ancestor(left: str, right: str) -> bool:
            current = right
            while current is not None:
                if current == left:
                    return True
                current = parents.get(current)
            return False

        ids = [node["outline_node_id"] for node in values]
        return all(ancestor(left, right) or ancestor(right, left) for i, left in enumerate(ids) for right in ids[i + 1:])


class AssistantContextBuilder:
    def __init__(self, foundation: FoundationService, outline: OutlineService):
        self.foundation = foundation
        self.outline = outline
        self.scopes = ScopeResolver(outline)

    def build(
        self,
        revision_id: str,
        page_index: int,
        *,
        start: dict,
        end: dict,
    ) -> dict:
        selection = self.foundation.resolve_text_selection(
            revision_id, page_index, start=start, end=end
        )
        selected_text = selection["quote"].strip()
        if not selected_text:
            raise ValueError("请选择至少一个教材文字")
        if len(selected_text) > MAX_SELECTED_CHARS:
            raise ValueError(f"所选文字过长；一次最多选择 {MAX_SELECTED_CHARS} 个字符")
        overlay = self.foundation.overlay(revision_id, page_index)
        lines = overlay["lines"]
        positions = {line["line_ordinal"]: index for index, line in enumerate(lines)}
        try:
            first = min(positions[int(start["line_ordinal"])], positions[int(end["line_ordinal"])])
            last = max(positions[int(start["line_ordinal"])], positions[int(end["line_ordinal"])])
        except (KeyError, TypeError, ValueError):
            raise ValueError("选区不属于当前已准备页面") from None
        context_start = max(0, first - CONTEXT_LINES_EACH_SIDE)
        context_end = min(len(lines), last + CONTEXT_LINES_EACH_SIDE + 1)
        surrounding = "\n".join(line["text"] for line in lines[context_start:context_end])
        if len(surrounding) > MAX_CONTEXT_CHARS:
            surrounding = surrounding[:MAX_CONTEXT_CHARS]
        scope = self.scopes.resolve(revision_id, page_index)
        try:
            printed_label = self.outline.page_labels.repository.get(
                revision_id, page_index
            ).get("printed_label")
        except LookupError:
            printed_label = None
        return {
            "scope": scope,
            "selected_text": selected_text,
            "source_anchor": {
                "quads": selection["quads"],
                "quote": selection["quote"],
                "context_before": selection["context_before"],
                "context_after": selection["context_after"],
                "foundation_version": selection["foundation_version"],
            },
            "same_page_ocr_context": surrounding,
            "printed_page_label": printed_label,
            "foundation_version": selection["foundation_version"],
        }

    def build_master(self, projection: dict) -> dict:
        """Build a Root context from one verified durable Master answer selection."""
        point = projection["point"]
        reader_source = projection["reader_source"]
        revision_id = projection["revision_id"]
        page_index = int(point["start_page"])
        resolved = self.scopes.resolve(revision_id, page_index)
        if point["scope_kind"] == "SECTION":
            scope = ScopeResolution(
                key=f"SECTION:{point['scope_id']}",
                kind="SECTION",
                pdf_page_index=page_index,
                section_id=point["scope_id"],
                section_title=point["title"],
                chapter_title=resolved.chapter_title,
            )
        else:
            scope = ScopeResolution(
                key=f"SECTION:{point['primary_section_id']}",
                kind="SECTION",
                pdf_page_index=page_index,
                section_id=point["primary_section_id"],
                section_title=point["section_title"],
                chapter_title=resolved.chapter_title,
            )
        overlay = self.foundation.overlay(revision_id, page_index)
        if overlay["status"] != "READY":
            raise ValueError("Master 回答对应的教材文字尚未就绪。")
        try:
            printed_label = self.outline.page_labels.repository.get(
                revision_id, page_index
            ).get("printed_label")
        except LookupError:
            printed_label = None
        pages = tuple(int(page["pdf_page_number"]) for page in reader_source["pages"])
        bounded_reader_context = "\n".join(
            f"PDF {page['pdf_page_number']}\n{page['ocr_text']}"
            for page in reader_source["pages"]
            if page["ocr_text"].strip()
        )[:MAX_CONTEXT_CHARS]
        provenance = projection["source_provenance"]
        return {
            "scope": scope,
            "selected_text": projection["selected_text"],
            "source_kind": "MASTER_ANSWER",
            "source_anchor": {
                "kind": "MASTER_ANSWER",
                "message_id": provenance["answer_message_id"],
                "source_spans": list(projection["source_spans"]),
                "quote": projection["selected_text"],
            },
            "source_provenance": provenance,
            "same_page_ocr_context": bounded_reader_context,
            "pdf_page_numbers": pages,
            "source_notice": "当前焦点来自 Master 回答，不是教材原文。",
            "printed_page_label": printed_label,
            "foundation_version": int(overlay["foundation_version"]),
        }


def provider_user_message(context: dict, question: str | None = None) -> str:
    if context.get("source_kind") == "MASTER_ANSWER":
        return provider_master_user_message(context, question)
    scope: ScopeResolution = context["scope"]
    lines = [
        "【当前解释焦点（用户所选）】",
        context["selected_text"],
    ]
    if question:
        lines.extend(["", "【用户问题】", question])
    lines.extend([
        "",
        "【教材定位（仅用于定位和消歧）】",
        f"范围类型：{scope.kind}",
    ])
    if scope.chapter_title:
        lines.append(f"已安全确定的章标题：{scope.chapter_title}")
    if scope.section_title:
        lines.append(f"已安全确定的节标题：{scope.section_title}")
    if context["printed_page_label"]:
        lines.append(f"已知印刷页码：{context['printed_page_label']}")
    lines.extend(
        [
            "【同一 PDF 页的有界 OCR 语境（辅助）】",
            context["same_page_ocr_context"],
        ]
    )
    return "\n".join(lines)


def provider_master_user_message(context: dict, question: str | None = None) -> str:
    """Serialize the semantic Master selection without leaking durable app metadata."""
    scope: ScopeResolution = context["scope"]
    lines = [
        "【当前解释焦点（用户所选）】",
        context["selected_text"],
    ]
    if question:
        lines.extend(["", "【用户问题】", question])
    lines.extend([
        "",
        "【来源说明】",
        "这段文字来自 Master 回答，不是教材原文。只解释当前焦点；Reader 教材信息仅用于消歧和 grounding。",
        "",
        "【Reader 教材依据（仅用于消歧和 grounding）】",
    ])
    readable_scope = " › ".join(filter(None, (scope.chapter_title, scope.section_title)))
    if readable_scope:
        lines.append(f"Reader 范围：{readable_scope}")
    pages = context.get("pdf_page_numbers") or (scope.pdf_page_index + 1,)
    lines.append("PDF 页码：" + "、".join(str(page) for page in pages))
    if context["printed_page_label"]:
        lines.append(f"起始印刷页码：{context['printed_page_label']}")
    lines.extend([
        "",
        "【原 Master 学习范围的有界教材语境】",
        context["same_page_ocr_context"],
    ])
    return "\n".join(lines)


def provider_child_message(
    context: ModelVisibleContext,
) -> str:
    """Serialize only the explicit semantic allowlist into the provider user message."""
    grounding = context.reader_grounding
    lines = [
        "【当前解释焦点（用户所选）】",
        context.current_focus,
        "",
        "【直接上一轮】",
        f"焦点或问题：{context.direct_previous_focus}",
        f"完整讲解：{context.direct_previous_answer}",
        "",
        "【解释路径（仅用于消歧）】",
        " › ".join(context.concept_path),
        f"这是对上一轮回答中『{context.current_focus}』的进一步解释。",
        "",
        "【Reader 教材依据（仅用于消歧和 grounding）】",
    ]
    if grounding.source_notice:
        lines.extend([grounding.source_notice, ""])
    readable_scope = " › ".join(filter(None, (
        grounding.chapter_title,
        grounding.section_title,
    )))
    if readable_scope:
        lines.append(f"Reader 范围：{readable_scope}")
    pages = grounding.pdf_page_numbers or (grounding.pdf_page_number,)
    lines.append("PDF 页码：" + "、".join(str(page) for page in pages))
    if grounding.printed_page_label:
        lines.append(f"印刷页码：{grounding.printed_page_label}")
    lines.extend([
        "",
        "【有界 Reader 教材语境】" if grounding.source_notice
        else "【同一 PDF 页的有界 OCR 语境】",
        grounding.bounded_same_page_ocr,
    ])
    return "\n".join(lines)
