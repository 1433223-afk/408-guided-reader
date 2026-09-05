from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4

from reader_service.agent_runtime import AgentRuntime, ProviderFailure, ProviderFailureKind

from .context import (
    AssistantContextBuilder,
    ScopeResolution,
    provider_child_message,
    provider_user_message,
)
from .skill import load_explanation_skill


MAX_QUESTION_CHARS = 500
MAX_ANSWER_SELECTION_CHARS = 2_000
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 8_000
MAX_DEPTH = 5
SYSTEM_BOUNDARY = (
    "你是附着在原始教材页面上的临时中文讲解助手。用简体中文清楚、直接地回答。"
    "选区触发的首轮消息中，‘当前解释焦点’就是用户希望解释的对象。"
    "关于教材本身的陈述只能来自本次提供的教材语境；概念解释可以使用可靠的专业或通识知识，"
    "但不得把补充知识伪装成教材原文、教材观点或本页已有内容，也不得编造引文或印刷页码。"
)
SYSTEM_MESSAGE = SYSTEM_BOUNDARY + "\n\n" + load_explanation_skill()


class SelectionSourceKind(str, Enum):
    ORIGINAL_PDF = "ORIGINAL_PDF"
    READING_GUIDE = "READING_GUIDE"
    INLINE_GUIDANCE = "INLINE_GUIDANCE"
    MASTER_ANSWER = "MASTER_ANSWER"
    ASSISTANT_ANSWER = "ASSISTANT_ANSWER"
    READER_VISIBLE = "READER_VISIBLE"


class AssistantStateError(Exception):
    """Typed rejection for an invalid temporary Assistant state transition."""

    def __init__(self, code: str, user_message: str):
        super().__init__(user_message)
        self.code = code
        self.user_message = user_message


@dataclass(frozen=True, slots=True)
class SelectionSource:
    kind: SelectionSourceKind
    selected_text: str
    revision_id: str
    pdf_page_index: int
    foundation_version: int

    @property
    def label(self) -> str:
        return _preview(self.selected_text)

    def lineage(self) -> dict:
        return {
            "kind": self.kind.value,
            "selected_text": self.selected_text,
            "revision_id": self.revision_id,
            "pdf_page_index": self.pdf_page_index,
            "foundation_version": self.foundation_version,
        }


@dataclass(slots=True)
class Turn:
    turn_id: str
    question: str
    answer: str
    provider_user_content: str

    def public(self) -> dict:
        return {
            "turn_id": self.turn_id,
            "question": self.question,
            "answer": self.answer,
        }


@dataclass(slots=True)
class AssistantNode:
    node_id: str
    parent_node_id: str | None
    depth: int
    selected_text: str
    turns: list[Turn] = field(default_factory=list)
    active_child_id: str | None = None
    pending_child_id: str | None = None
    pending_turn_id: str | None = None

    def __post_init__(self) -> None:
        if not 2 <= self.depth <= MAX_DEPTH:
            raise ValueError(f"Assistant Child depth must be between 2 and {MAX_DEPTH}")

    @property
    def label(self) -> str:
        return _preview(self.selected_text)


@dataclass(slots=True)
class AssistantRoot:
    root_id: str
    reader_session_id: str
    scope: ScopeResolution
    created_from: SelectionSource
    provider: str
    model: str
    reference_context: dict
    turns: list[Turn] = field(default_factory=list)
    nodes: dict[str, AssistantNode] = field(default_factory=dict)
    active_child_id: str | None = None
    focused_node_id: str | None = None
    pending_child_id: str | None = None
    pending_turn_id: str | None = None

    @property
    def label(self) -> str:
        return self.created_from.label


@dataclass(slots=True)
class ReaderAssistantState:
    roots: dict[str, AssistantRoot] = field(default_factory=dict)
    focused_root_id: str | None = None
    focus_version: int = 0
    state_version: int = 0

    def public(self) -> dict:
        roots = [self._root_public(root) for root in self.roots.values()]
        focused = None
        current = None
        if self.focused_root_id in self.roots:
            root = self.roots[self.focused_root_id]
            node_id = root.focused_node_id
            focused = {"root_id": root.root_id, "node_id": node_id}
            current = self._level_public(root, node_id)
            current["breadcrumb"] = self._breadcrumb(root, node_id)
        return {
            "version": self.state_version,
            "roots": roots,
            "focused_ref": focused,
            "current": current,
        }

    def _root_public(self, root: AssistantRoot) -> dict:
        return {
            "root_id": root.root_id,
            "label": root.label,
            "provider": root.provider,
            "model": root.model,
            "scope": root.scope.public(),
            "created_from": {
                "kind": root.created_from.kind.value,
                "selected_text_preview": root.label,
            },
            "focused_node_id": root.focused_node_id,
            "active_child_id": root.active_child_id,
            "turns": [turn.public() for turn in root.turns],
            "nodes": [self._node_public(root, node) for node in root.nodes.values()],
        }

    def _node_public(self, root: AssistantRoot, node: AssistantNode) -> dict:
        return {
            "node_id": node.node_id,
            "parent_ref": {
                "root_id": root.root_id,
                "node_id": node.parent_node_id,
            },
            "depth": node.depth,
            "label": node.label,
            "active_child_id": node.active_child_id,
            "turns": [turn.public() for turn in node.turns],
        }

    def _level_public(self, root: AssistantRoot, node_id: str | None) -> dict:
        if node_id is None:
            return {
                "root_id": root.root_id,
                "node_id": None,
                "parent_ref": None,
                "depth": 1,
                "label": root.label,
                "active_child_id": root.active_child_id,
                "provider": root.provider,
                "model": root.model,
                "scope": root.scope.public(),
                "turns": [turn.public() for turn in root.turns],
            }
        node = root.nodes[node_id]
        return {
            **self._node_public(root, node),
            "root_id": root.root_id,
            "provider": root.provider,
            "model": root.model,
            "scope": root.scope.public(),
        }

    def _breadcrumb(self, root: AssistantRoot, node_id: str | None) -> list[dict]:
        chain = [{"root_id": root.root_id, "node_id": None, "depth": 1, "label": root.label}]
        lineage = []
        current = node_id
        while current is not None:
            node = root.nodes[current]
            lineage.append(node)
            current = node.parent_node_id
        for node in reversed(lineage):
            chain.append({
                "root_id": root.root_id,
                "node_id": node.node_id,
                "depth": node.depth,
                "label": node.label,
            })
        return chain


@dataclass(slots=True)
class _ReaderSessionSlot:
    generation: int = 0
    state: ReaderAssistantState = field(default_factory=ReaderAssistantState)
    comparison: dict | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class AssistantService:
    """Memory-only, per-reader-session Assistant Root/Node workspaces."""

    def __init__(self, contexts: AssistantContextBuilder, runtime: AgentRuntime):
        self.contexts = contexts
        self.runtime = runtime
        self._sessions: dict[str, _ReaderSessionSlot] = {}
        self._state_lock = threading.Lock()

    def status(self) -> dict:
        status = self.runtime.status()
        status.setdefault("bakeoff_enabled", False)
        status.setdefault("active_provider", status.get("provider"))
        status.setdefault("providers", [dict(status)])
        return status

    def inspect_payloads(self) -> dict:
        return {"calls": self.runtime.inspector.snapshot()}

    def ask_selection(
        self,
        reader_session_id: str,
        revision_id: str,
        page_index: int,
        *,
        start: dict,
        end: dict,
        provider: str | None = None,
        source_kind: str | SelectionSourceKind = SelectionSourceKind.ORIGINAL_PDF,
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        kind = self._root_source_kind(source_kind)
        slot = self._slot_for(session_id)
        generation, focus_version = self._begin(slot, session_id)
        context = self.contexts.build(revision_id, page_index, start=start, end=end)
        selected_provider, selected_model = self._provider_identity(provider)
        turn_id = str(uuid4())
        user_content = provider_user_message(context)
        answer = self._complete(
            selected_provider,
            self._messages([], user_content),
            interaction_id=turn_id,
        )
        root_id = str(uuid4())
        source = SelectionSource(
            kind,
            context["selected_text"],
            revision_id,
            page_index,
            int(context["foundation_version"]),
        )
        root = AssistantRoot(
            root_id,
            session_id,
            context["scope"],
            source,
            selected_provider,
            selected_model,
            self._reference_context(context),
            turns=[Turn(turn_id, context["selected_text"], answer, user_content)],
        )
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                if slot.generation != generation:
                    raise self._request_cancelled()
                slot.state.roots[root_id] = root
                slot.state.state_version += 1
                if slot.state.focus_version == focus_version:
                    slot.state.focused_root_id = root_id
                    root.focused_node_id = None
                    slot.state.focus_version += 1
                return slot.state.public()

    def create_child(
        self,
        reader_session_id: str,
        root_id: str,
        *,
        parent_node_id: str | None,
        turn_id: str,
        start_offset: int,
        end_offset: int,
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._optional_id(parent_node_id, "Node id")
        clean_turn_id = self._validate_id(turn_id, "Turn id")
        if not isinstance(start_offset, int) or not isinstance(end_offset, int):
            raise ValueError("回答选区范围无效")
        interaction_id = str(uuid4())
        node_id = str(uuid4())
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                generation = slot.generation
                state = slot.state
                root = self._root(state, clean_root_id)
                parent = self._level(root, clean_node_id)
                if state.focused_root_id != root.root_id or root.focused_node_id != clean_node_id:
                    raise AssistantStateError(
                        "PARENT_NOT_FOCUSED",
                        "这段回答已不是当前解释层；请切回该层后再问。",
                    )
                depth = self._depth(parent)
                if depth >= MAX_DEPTH:
                    raise AssistantStateError(
                        "CHILD_DEPTH_LIMIT_REACHED",
                        f"已经到第 {MAX_DEPTH} 层；仍可在当前层继续追问。",
                    )
                if parent.active_child_id is not None or parent.pending_child_id is not None:
                    raise AssistantStateError(
                        "ACTIVE_CHILD_ALREADY_EXISTS",
                        "这一层已有更深解释；请进入已有层级继续。",
                    )
                if not parent.turns or parent.turns[-1].turn_id != clean_turn_id:
                    raise AssistantStateError(
                        "ANSWER_TURN_NOT_CURRENT",
                        "只能从当前层最新一条回答中继续再问一层。",
                    )
                triggering_turn = parent.turns[-1]
                selected_text = self._answer_selection(
                    triggering_turn.answer, start_offset, end_offset
                )
                child_depth = depth + 1
                parent.pending_child_id = interaction_id
                focus_version = state.focus_version
                parent_label = root.label if clean_node_id is None else root.nodes[clean_node_id].label
                user_content = provider_child_message(
                    selected_text=selected_text,
                    selected_range={"start": start_offset, "end": end_offset},
                    triggering_question=triggering_turn.question,
                    triggering_answer=triggering_turn.answer,
                    source_lineage=root.created_from.lineage(),
                    scope=root.scope,
                    reference_context=root.reference_context,
                    parent_label=parent_label,
                    depth=child_depth,
                    max_depth=MAX_DEPTH,
                )
                provider = root.provider
        try:
            answer = self._complete(
                provider,
                self._messages([], user_content),
                interaction_id=interaction_id,
            )
        except Exception:
            self._clear_pending_child(
                session_id, slot, generation, clean_root_id, clean_node_id, interaction_id
            )
            raise
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                if slot.generation != generation:
                    raise self._request_cancelled()
                root = slot.state.roots.get(clean_root_id)
                if root is None:
                    raise self._request_cancelled()
                try:
                    parent = self._level(root, clean_node_id)
                except LookupError:
                    raise self._request_cancelled() from None
                if parent.pending_child_id != interaction_id or parent.active_child_id is not None:
                    raise self._request_cancelled()
                child = AssistantNode(
                    node_id,
                    clean_node_id,
                    child_depth,
                    selected_text,
                    turns=[Turn(interaction_id, selected_text, answer, user_content)],
                )
                root.nodes[node_id] = child
                parent.pending_child_id = None
                parent.active_child_id = node_id
                slot.state.state_version += 1
                if (
                    slot.state.focus_version == focus_version
                    and slot.state.focused_root_id == root.root_id
                    and root.focused_node_id == clean_node_id
                ):
                    root.focused_node_id = node_id
                    slot.state.focus_version += 1
                return slot.state.public()

    def follow_up(
        self,
        reader_session_id: str,
        root_id: str,
        question: str,
        *,
        node_id: str | None = None,
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._optional_id(node_id, "Node id")
        clean_question = self._validate_question(question)
        turn_id = str(uuid4())
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                generation = slot.generation
                root = slot.state.roots.get(clean_root_id)
                if root is None:
                    raise self._request_cancelled()
                try:
                    level = self._level(root, clean_node_id)
                except LookupError:
                    raise self._request_cancelled() from None
                if level.pending_turn_id is not None:
                    raise AssistantStateError(
                        "TURN_ALREADY_PENDING", "当前层已有一个回答正在生成，请稍候。"
                    )
                level.pending_turn_id = turn_id
                messages = self._messages(level.turns, clean_question)
                provider = root.provider
        try:
            answer = self._complete(provider, messages, interaction_id=turn_id)
        except Exception:
            self._clear_pending_turn(
                session_id, slot, generation, clean_root_id, clean_node_id, turn_id
            )
            raise
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                if slot.generation != generation:
                    raise self._request_cancelled()
                root = slot.state.roots.get(clean_root_id)
                if root is None:
                    raise self._request_cancelled()
                try:
                    level = self._level(root, clean_node_id)
                except LookupError:
                    raise self._request_cancelled() from None
                if level.pending_turn_id != turn_id:
                    raise self._request_cancelled()
                level.pending_turn_id = None
                level.turns.append(Turn(turn_id, clean_question, answer, clean_question))
                slot.state.state_version += 1
                return slot.state.public()

    def focus(
        self, reader_session_id: str, root_id: str, *, node_id: str | None = None
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._optional_id(node_id, "Node id")
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                root = self._root(slot.state, clean_root_id)
                self._level(root, clean_node_id)
                slot.state.focused_root_id = root.root_id
                root.focused_node_id = clean_node_id
                slot.state.focus_version += 1
                slot.state.state_version += 1
                return slot.state.public()

    def close_root(self, reader_session_id: str, root_id: str) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                self._root(slot.state, clean_root_id)
                del slot.state.roots[clean_root_id]
                if slot.state.focused_root_id == clean_root_id:
                    slot.state.focused_root_id = next(reversed(slot.state.roots), None)
                slot.state.focus_version += 1
                slot.state.state_version += 1
                return slot.state.public()

    def close_session(self, reader_session_id: str) -> None:
        session_id = self._validate_session_id(reader_session_id)
        with self._state_lock:
            slot = self._sessions.get(session_id)
            if slot is None:
                return
            with slot.lock:
                slot.generation += 1
                slot.state = ReaderAssistantState()
                slot.comparison = None
                self._sessions.pop(session_id, None)

    def state(self, reader_session_id: str) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                return slot.state.public()

    def bake_off_selection(
        self,
        reader_session_id: str,
        revision_id: str,
        page_index: int,
        *,
        start: dict,
        end: dict,
        question: str | None = None,
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        slot = self._slot_for(session_id)
        generation, _ = self._begin(slot, session_id)
        compare = getattr(self.runtime, "compare", None)
        if compare is None:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "bakeoff_disabled",
                "Provider Bake-off 未启用。",
            )
        context = self.contexts.build(revision_id, page_index, start=start, end=end)
        scope: ScopeResolution = context["scope"]
        visible_message = (
            self._validate_question(question) if question is not None else context["selected_text"]
        )
        user_content = provider_user_message(
            context, visible_message if question is not None else None
        )
        messages = self._messages([], user_content)
        comparison_id = str(uuid4())
        results = compare(messages, interaction_id=comparison_id)
        comparison = {
            "comparison_id": comparison_id,
            "scope": scope.public(),
            "question": visible_message,
            "selected_text": context["selected_text"],
            "results": results,
        }
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                if slot.generation != generation:
                    raise self._request_cancelled()
                slot.comparison = comparison
        return comparison

    def conversation_count(self) -> int:
        with self._state_lock:
            return sum(len(slot.state.roots) for slot in self._sessions.values())

    def comparison_count(self) -> int:
        with self._state_lock:
            return sum(slot.comparison is not None for slot in self._sessions.values())

    def _messages(self, turns: list[Turn], new_user_content: str) -> list[dict]:
        messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
        history = turns[-MAX_HISTORY_TURNS:]
        used = 0
        bounded: list[tuple[str, str]] = []
        for turn in reversed(history):
            size = len(turn.provider_user_content) + len(turn.answer)
            remaining = MAX_HISTORY_CHARS - used
            if size > remaining:
                if bounded or remaining < 2:
                    break
                user_budget = min(len(turn.provider_user_content), remaining // 2)
                answer_budget = remaining - user_budget
                bounded.append((
                    turn.provider_user_content[:user_budget],
                    turn.answer[-answer_budget:] if answer_budget else "",
                ))
                break
            bounded.append((turn.provider_user_content, turn.answer))
            used += size
        for user_content, answer in reversed(bounded):
            messages.append({"role": "user", "content": user_content})
            messages.append({"role": "assistant", "content": answer})
        messages.append({"role": "user", "content": new_user_content})
        return messages

    def _provider_identity(self, provider: str | None) -> tuple[str, str]:
        resolver = getattr(self.runtime, "provider_identity", None)
        if resolver is not None:
            return resolver(provider)
        status = self.runtime.status()
        configured_provider = status.get("provider")
        if provider is not None and provider != configured_provider:
            raise ProviderFailure(
                ProviderFailureKind.UNCONFIGURED,
                "invalid_active_provider",
                "所选 provider 不在允许的命名集合中；Reader 其余能力仍可使用。",
            )
        return configured_provider, status.get("model")

    def _complete(
        self, provider: str, messages: list[dict], *, interaction_id: str
    ) -> str:
        complete_for = getattr(self.runtime, "complete_for", None)
        if complete_for is not None:
            return complete_for(provider, messages, interaction_id=interaction_id)
        return self.runtime.complete(messages, interaction_id=interaction_id)

    def _slot_for(self, session_id: str) -> _ReaderSessionSlot:
        with self._state_lock:
            return self._sessions.setdefault(session_id, _ReaderSessionSlot())

    def _existing_slot(self, session_id: str) -> _ReaderSessionSlot:
        with self._state_lock:
            slot = self._sessions.get(session_id)
        if slot is None:
            raise LookupError("临时解释不存在或已随 Reader 关闭而清除")
        return slot

    def _begin(self, slot: _ReaderSessionSlot, session_id: str) -> tuple[int, int]:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                return slot.generation, slot.state.focus_version

    def _clear_pending_child(
        self,
        session_id: str,
        slot: _ReaderSessionSlot,
        generation: int,
        root_id: str,
        node_id: str | None,
        interaction_id: str,
    ) -> None:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                return
            with slot.lock:
                if slot.generation != generation:
                    return
                root = slot.state.roots.get(root_id)
                if root is None:
                    return
                try:
                    level = self._level(root, node_id)
                except LookupError:
                    return
                if level.pending_child_id == interaction_id:
                    level.pending_child_id = None

    def _clear_pending_turn(
        self,
        session_id: str,
        slot: _ReaderSessionSlot,
        generation: int,
        root_id: str,
        node_id: str | None,
        turn_id: str,
    ) -> None:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                return
            with slot.lock:
                if slot.generation != generation:
                    return
                root = slot.state.roots.get(root_id)
                if root is None:
                    return
                try:
                    level = self._level(root, node_id)
                except LookupError:
                    return
                if level.pending_turn_id == turn_id:
                    level.pending_turn_id = None

    @staticmethod
    def _root(state: ReaderAssistantState, root_id: str) -> AssistantRoot:
        root = state.roots.get(root_id)
        if root is None:
            raise LookupError("这条临时解释已关闭或不存在")
        return root

    @staticmethod
    def _level(root: AssistantRoot, node_id: str | None) -> AssistantRoot | AssistantNode:
        if node_id is None:
            return root
        node = root.nodes.get(node_id)
        if node is None:
            raise LookupError("这层临时解释已关闭或不存在")
        return node

    @staticmethod
    def _depth(level: AssistantRoot | AssistantNode) -> int:
        return 1 if isinstance(level, AssistantRoot) else level.depth

    @staticmethod
    def _reference_context(context: dict) -> dict:
        return {
            "same_page_ocr_context": context["same_page_ocr_context"],
            "printed_page_label": context["printed_page_label"],
        }

    @staticmethod
    def _answer_selection(answer: str, start: int, end: int) -> str:
        if start < 0 or end <= start or end > len(answer):
            raise AssistantStateError("INVALID_ANSWER_SELECTION", "回答选区范围无效。")
        selected = answer[start:end].strip()
        if not selected or len(selected) > MAX_ANSWER_SELECTION_CHARS:
            raise AssistantStateError(
                "INVALID_ANSWER_SELECTION",
                f"请选择 1 到 {MAX_ANSWER_SELECTION_CHARS} 个回答文字。",
            )
        return selected

    @staticmethod
    def _root_source_kind(value: str | SelectionSourceKind) -> SelectionSourceKind:
        try:
            kind = value if isinstance(value, SelectionSourceKind) else SelectionSourceKind(value)
        except (TypeError, ValueError):
            raise AssistantStateError("INVALID_SELECTION_SOURCE", "解释来源类型无效。") from None
        if kind is SelectionSourceKind.ASSISTANT_ANSWER:
            raise AssistantStateError(
                "ASSISTANT_SOURCE_REQUIRES_CHILD",
                "Assistant 回答中的选区只能继续再问一层，不能重新开始第一层。",
            )
        if kind is not SelectionSourceKind.ORIGINAL_PDF:
            raise AssistantStateError(
                "SELECTION_SOURCE_NOT_AVAILABLE",
                "当前 Reader 入口尚不支持这种解释来源。",
            )
        return kind

    @staticmethod
    def _request_cancelled() -> AssistantStateError:
        return AssistantStateError(
            "REQUEST_CANCELLED", "这次回答所属的临时解释已关闭，结果未被保留。"
        )

    @staticmethod
    def _validate_session_id(value: str) -> str:
        if not isinstance(value, str) or not 8 <= len(value) <= 128 or any(ch.isspace() for ch in value):
            raise ValueError("Reader session id is invalid")
        return value

    @staticmethod
    def _validate_id(value: str, label: str) -> str:
        if not isinstance(value, str) or not 8 <= len(value) <= 128 or any(ch.isspace() for ch in value):
            raise ValueError(f"{label} is invalid")
        return value

    @classmethod
    def _optional_id(cls, value: str | None, label: str) -> str | None:
        return None if value is None else cls._validate_id(value, label)

    @staticmethod
    def _validate_question(value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("问题必须是文字")
        clean = value.strip()
        if not clean or len(clean) > MAX_QUESTION_CHARS:
            raise ValueError(f"问题需为 1 到 {MAX_QUESTION_CHARS} 个字符")
        return clean


def _preview(value: str, limit: int = 34) -> str:
    clean = " ".join(value.split())
    return clean if len(clean) <= limit else clean[: limit - 1] + "…"
