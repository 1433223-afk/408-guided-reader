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
            revision_id, page_index, start=start, end=end, context_length=0
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
            "same_page_ocr_context": surrounding,
            "printed_page_label": printed_label,
            "foundation_version": selection["foundation_version"],
        }


def provider_user_message(context: dict, question: str | None = None) -> str:
    scope: ScopeResolution = context["scope"]
    lines = [
        "【教材定位（仅用于定位和消歧）】",
        f"范围类型：{scope.kind}",
    ]
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
            "",
            "【当前解释焦点（用户所选）】",
            context["selected_text"],
        ]
    )
    if question:
        lines.extend(["", "【用户问题】", question])
    return "\n".join(lines)


def provider_child_message(
    *,
    selected_text: str,
    selected_range: dict,
    triggering_question: str,
    triggering_answer: str,
    source_lineage: dict,
    scope: ScopeResolution,
    reference_context: dict,
    parent_label: str,
    depth: int,
    max_depth: int,
) -> str:
    """Assemble only the frozen minimal Child context; never walk conversation state."""
    lines = [
        "【父子关系】",
        f"当前解释深度：{depth}/{max_depth}",
        f"直接父层主题：{parent_label}",
        "",
        "【来源脉络】",
        f"最初来源类型：{source_lineage['kind']}",
        f"最初教材选区：{source_lineage['selected_text']}",
        f"原始 PDF 页：{source_lineage['pdf_page_index'] + 1}",
        "",
        "【当前相关 Reader 范围】",
        f"范围类型：{scope.kind}",
    ]
    if scope.chapter_title:
        lines.append(f"已安全确定的章标题：{scope.chapter_title}")
    if scope.section_title:
        lines.append(f"已安全确定的节标题：{scope.section_title}")
    printed_label = reference_context.get("printed_page_label")
    if printed_label:
        lines.append(f"已知印刷页码：{printed_label}")
    lines.extend([
        "",
        "【最小必要引用语境：同一 PDF 页的有界 OCR】",
        reference_context.get("same_page_ocr_context", ""),
        "",
        "【触发再问一层的完整父回合】",
        f"用户：{triggering_question}",
        f"助手：{triggering_answer}",
        "",
        "【当前回答选区】",
        f"字符范围：{selected_range['start']}..{selected_range['end']}",
        selected_text,
    ])
    return "\n".join(lines)
