from __future__ import annotations

import copy
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable
from uuid import uuid4

from reader_service.agent_runtime import (
    AgentRuntime,
    ProviderCompletion,
    ProviderFailure,
    ProviderFailureKind,
)

from .context import (
    AssistantContextBuilder,
    ModelVisibleContext,
    ModelVisibleReaderGrounding,
    ScopeResolution,
    provider_child_message,
    provider_user_message,
)
from .skill import load_explanation_skill


MAX_QUESTION_CHARS = 500
MAX_ANSWER_SELECTION_CHARS = 2_000
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 8_000
MAX_CONTINUATION_CHARS = 16_000
MAX_DEPTH = 5
StreamEmitter = Callable[[dict], None]
SYSTEM_BOUNDARY = (
    "你是附着在原始教材页面上的临时中文讲解助手。用简体中文清楚、直接地回答。"
    "凡由选区触发的解释（首轮或继续再问一层），用户消息第一块"
    "【当前解释焦点（用户所选）】就是 CURRENT FOCUS，也是唯一需要解释的对象；只解释它。"
    "解释路径、直接上一轮、Reader 定位和教材语境只用于消歧与 grounding，不是解释对象。"
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
    teaching_lineage: dict | None = None
    source_provenance: dict | None = None

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
            **({"teaching_lineage": copy.deepcopy(self.teaching_lineage)} if self.teaching_lineage else {}),
            **({"source_provenance": copy.deepcopy(self.source_provenance)} if self.source_provenance else {}),
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
    error: str | None = None
    first_user_content: str | None = None

    def __post_init__(self) -> None:
        if not 2 <= self.depth <= MAX_DEPTH:
            raise ValueError(f"Assistant Child depth must be between 2 and {MAX_DEPTH}")

    @property
    def label(self) -> str:
        return self.selected_text


@dataclass(slots=True)
class AssistantRoot:
    root_id: str
    reader_session_id: str
    scope: ScopeResolution
    created_from: SelectionSource
    provider: str
    model: str
    source_anchor: dict
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
                **({"teaching_lineage": copy.deepcopy(root.created_from.teaching_lineage)} if root.created_from.teaching_lineage else {}),
                **({"source_provenance": copy.deepcopy(root.created_from.source_provenance)} if root.created_from.source_provenance else {}),
            },
            "focused_node_id": root.focused_node_id,
            "active_child_id": root.active_child_id,
            "child_pending": root.pending_child_id is not None,
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
            "child_pending": node.pending_child_id is not None,
            "pending": node.pending_turn_id is not None,
            "error": node.error,
            "can_retry": bool(node.error and not node.turns and node.first_user_content and node.pending_turn_id is None),
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
                "child_pending": root.pending_child_id is not None,
                "pending": root.pending_turn_id is not None,
                "error": None,
                "children": self._children_public(root, None),
                "provider": root.provider,
                "model": root.model,
                "scope": root.scope.public(),
                "turns": [turn.public() for turn in root.turns],
            }
        node = root.nodes[node_id]
        return {
            **self._node_public(root, node),
            "root_id": root.root_id,
            "children": self._children_public(root, node.node_id),
            "provider": root.provider,
            "model": root.model,
            "scope": root.scope.public(),
        }

    def _children_public(self, root: AssistantRoot, parent_node_id: str | None) -> list[dict]:
        return [
            {
                "node_id": node.node_id,
                "label": node.label,
                "pending": node.pending_turn_id is not None,
                "error": node.error,
            }
            for node in root.nodes.values()
            if node.parent_node_id == parent_node_id
        ]

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
    last_seen: float = field(default_factory=time.monotonic)
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
        stream: StreamEmitter | None = None,
        continuation: dict | None = None,
    ) -> dict:
        kind = self._root_source_kind(source_kind)
        context = lambda: self.contexts.build(revision_id, page_index, start=start, end=end)
        return self._ask_context(
            reader_session_id, revision_id, page_index, context, kind, provider, stream,
            continuation,
        )

    def ask_guide(self, reader_session_id, revision_id, context, provider=None, stream=None,
                  continuation=None):
        return self._ask_context(reader_session_id, revision_id, context["scope"].pdf_page_index,
                                 context, SelectionSourceKind.READING_GUIDE, provider, stream,
                                 continuation)

    def ask_inline(self, reader_session_id, revision_id, context, provider=None, stream=None,
                   continuation=None):
        return self._ask_context(reader_session_id, revision_id, context["scope"].pdf_page_index,
                                 context, SelectionSourceKind.INLINE_GUIDANCE, provider, stream,
                                 continuation)

    def ask_master(self, reader_session_id, revision_id, projection, provider=None, stream=None,
                   continuation=None):
        context = self.contexts.build_master(projection)
        return self._ask_context(
            reader_session_id,
            revision_id,
            context["scope"].pdf_page_index,
            context,
            SelectionSourceKind.MASTER_ANSWER,
            provider,
            stream,
            continuation,
        )

    def _ask_context(self, reader_session_id, revision_id, page_index, context, kind, provider,
                     stream=None, continuation=None):
        session_id = self._validate_session_id(reader_session_id)
        slot = self._slot_for(session_id)
        generation, focus_version = self._begin(slot, session_id)
        context_started = time.perf_counter()
        context = context() if callable(context) else context
        selected_provider, selected_model = self._provider_identity(provider)
        turn_id = str(uuid4())
        user_content = provider_user_message(context)
        messages, partial_answer = self._continuation_messages(
            self._messages([], user_content), continuation
        )
        self._emit_stage(stream, context_started)
        completions: list[ProviderCompletion] = []
        answer = self._complete(
            selected_provider,
            messages,
            interaction_id=turn_id,
            stream=stream,
            completions=completions,
        )
        answer = self._join_continuation(partial_answer, answer)
        root_id = str(uuid4())
        source = SelectionSource(
            kind,
            context["selected_text"],
            revision_id,
            page_index,
            int(context["foundation_version"]),
            copy.deepcopy(context.get("teaching_lineage")),
            copy.deepcopy(context.get("source_provenance")),
        )
        root = AssistantRoot(
            root_id,
            session_id,
            context["scope"],
            source,
            selected_provider,
            selected_model,
            copy.deepcopy(context["source_anchor"]),
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
                public = slot.state.public()
        self._emit_complete(stream, public, completions)
        return public

    def create_child(
        self,
        reader_session_id: str,
        root_id: str,
        *,
        parent_node_id: str | None,
        turn_id: str,
        start_offset: int,
        end_offset: int,
        node_id: str | None = None,
        source_spans: list[dict] | None = None,
        stream: StreamEmitter | None = None,
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._optional_id(parent_node_id, "Node id")
        clean_turn_id = self._validate_id(turn_id, "Turn id")
        if not isinstance(start_offset, int) or not isinstance(end_offset, int):
            raise ValueError("回答选区范围无效")
        interaction_id = str(uuid4())
        requested_node_id = (
            str(uuid4()) if node_id is None else self._validate_id(node_id, "Node id")
        )
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                generation = slot.generation
                state = slot.state
                root = self._root(state, clean_root_id)
                parent = self._level(root, clean_node_id)
                if parent.pending_child_id is not None:
                    raise AssistantStateError(
                        "ACTIVE_CHILD_ALREADY_EXISTS",
                        "这一层正在创建新的深入解释，请稍候。",
                    )
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
                if requested_node_id in root.nodes:
                    raise AssistantStateError(
                        "CHILD_ID_ALREADY_EXISTS",
                        "这层解释已经存在，请直接进入。",
                    )
                if not parent.turns or parent.turns[-1].turn_id != clean_turn_id:
                    raise AssistantStateError(
                        "ANSWER_TURN_NOT_CURRENT",
                        "只能从当前层最新一条回答中继续再问一层。",
                    )
                triggering_turn = parent.turns[-1]
                selected_text = (
                    self._answer_selection_spans(triggering_turn.answer, source_spans)
                    if source_spans is not None
                    else self._answer_selection(triggering_turn.answer, start_offset, end_offset)
                )
                child_depth = depth + 1
                parent.pending_child_id = interaction_id
                model_context = self._project_child_context(
                    root,
                    clean_node_id,
                    selected_text,
                    triggering_turn,
                )
                user_content = provider_child_message(model_context)
                provider = root.provider
                child = AssistantNode(
                    requested_node_id,
                    clean_node_id,
                    child_depth,
                    selected_text,
                    pending_turn_id=interaction_id,
                    first_user_content=user_content,
                )
                root.nodes[requested_node_id] = child
                parent.active_child_id = requested_node_id
                root.focused_node_id = requested_node_id
                state.focus_version += 1
                state.state_version += 1
        return self._finish_child(session_id, slot, generation, clean_root_id,
                                  clean_node_id, requested_node_id, interaction_id,
                                  provider, selected_text, user_content, stream)

    def retry_child(
        self,
        reader_session_id: str,
        root_id: str,
        node_id: str,
        *,
        stream: StreamEmitter | None = None,
        continuation: dict | None = None,
    ) -> dict:
        """Retry only the retained failed first turn, with its original private grounding."""
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._validate_id(node_id, "Node id")
        slot = self._existing_slot(session_id)
        interaction_id = str(uuid4())
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                generation = slot.generation
                root = self._root(slot.state, clean_root_id)
                child = self._level(root, clean_node_id)
                parent = self._level(root, child.parent_node_id)
                if child.pending_turn_id or parent.pending_child_id:
                    raise AssistantStateError("TURN_ALREADY_PENDING", "这一层正在生成，请稍候。")
                if child.turns or not child.error or not child.first_user_content:
                    raise AssistantStateError("CHILD_NOT_RETRYABLE", "只有首次生成失败的解释可以重试。")
                child.pending_turn_id = interaction_id
                parent.pending_child_id = interaction_id
                slot.state.state_version += 1
                provider, selected_text, user_content = root.provider, child.selected_text, child.first_user_content
                parent_id = child.parent_node_id
        # Completion never steals focus after the user navigates elsewhere.
        return self._finish_child(session_id, slot, generation, clean_root_id,
                                  parent_id, clean_node_id, interaction_id,
                                  provider, selected_text, user_content, stream,
                                  continuation)

    def _finish_child(self, session_id, slot, generation, clean_root_id,
                      clean_node_id, requested_node_id, interaction_id,
                      provider, selected_text, user_content, stream=None,
                      continuation=None):
        context_started = time.perf_counter()
        messages, partial_answer = self._continuation_messages(
            self._messages([], user_content), continuation
        )
        self._emit_stage(stream, context_started)
        completions: list[ProviderCompletion] = []
        try:
            answer = self._complete(
                provider,
                messages,
                interaction_id=interaction_id,
                stream=stream,
                completions=completions,
            )
            answer = self._join_continuation(partial_answer, answer)
        except Exception as exc:
            failure_recorded = self._fail_pending_child(
                session_id,
                slot,
                generation,
                clean_root_id,
                clean_node_id,
                requested_node_id,
                interaction_id,
                exc,
            )
            if not failure_recorded:
                raise self._request_cancelled() from exc
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
                child = root.nodes.get(requested_node_id)
                if (
                    parent.pending_child_id != interaction_id
                    or child is None
                    or child.pending_turn_id != interaction_id
                ):
                    raise self._request_cancelled()
                parent.pending_child_id = None
                child.pending_turn_id = None
                child.error = None
                child.first_user_content = None
                child.turns.append(Turn(interaction_id, selected_text, answer, user_content))
                slot.state.state_version += 1
                public = slot.state.public()
        self._emit_complete(stream, public, completions)
        return public

    def follow_up(
        self,
        reader_session_id: str,
        root_id: str,
        question: str,
        *,
        node_id: str | None = None,
        stream: StreamEmitter | None = None,
        continuation: dict | None = None,
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
                messages, partial_answer = self._continuation_messages(
                    self._messages(level.turns, clean_question), continuation
                )
                provider = root.provider
        context_started = time.perf_counter()
        self._emit_stage(stream, context_started)
        completions: list[ProviderCompletion] = []
        try:
            answer = self._complete(
                provider,
                messages,
                interaction_id=turn_id,
                stream=stream,
                completions=completions,
            )
            answer = self._join_continuation(partial_answer, answer)
        except Exception as exc:
            failure_recorded = self._clear_pending_turn(
                session_id, slot, generation, clean_root_id, clean_node_id, turn_id
            )
            if not failure_recorded:
                raise self._request_cancelled() from exc
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
                public = slot.state.public()
        self._emit_complete(stream, public, completions)
        return public

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

    def close_child_subtree(
        self, reader_session_id: str, root_id: str, node_id: str
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._validate_id(node_id, "Node id")
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                state = slot.state
                root = self._root(state, clean_root_id)
                target = self._level(root, clean_node_id)
                if not isinstance(target, AssistantNode):
                    raise AssistantStateError(
                        "ROOT_REQUIRES_ROOT_CLOSE", "第一层请使用“关闭此主题”。"
                    )
                if state.focused_root_id != clean_root_id or root.focused_node_id != clean_node_id:
                    raise AssistantStateError(
                        "LEVEL_NOT_FOCUSED", "只能关闭当前正在查看的这层解释。"
                    )
                parent_node_id = target.parent_node_id
                parent = self._level(root, parent_node_id)
                removed_ids = self._subtree_ids(root, clean_node_id)
                if parent.pending_child_id == target.pending_turn_id:
                    parent.pending_child_id = None
                for removed_id in removed_ids:
                    root.nodes.pop(removed_id, None)
                parent.active_child_id = self._latest_child_id(root, parent_node_id)
                root.focused_node_id = parent_node_id
                state.focused_root_id = clean_root_id
                state.focus_version += 1
                state.state_version += 1
                return state.public()

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

    def completed_turn_projection(
        self,
        reader_session_id: str,
        root_id: str,
        turn_id: str,
        *,
        node_id: str | None = None,
    ) -> dict:
        """Project one completed answer without exposing or persisting tree state."""
        session_id = self._validate_session_id(reader_session_id)
        clean_root_id = self._validate_id(root_id, "Root id")
        clean_node_id = self._optional_id(node_id, "Node id")
        clean_turn_id = self._validate_id(turn_id, "Turn id")
        slot = self._existing_slot(session_id)
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                root = self._root(slot.state, clean_root_id)
                level = self._level(root, clean_node_id)
                turn = next(
                    (candidate for candidate in level.turns if candidate.turn_id == clean_turn_id),
                    None,
                )
                if turn is None or not turn.answer.strip():
                    raise AssistantStateError(
                        "ANSWER_NOT_COMPLETED",
                        "只能保存一条已经完成的 Assistant 回答。",
                    )
                if root.created_from.kind in {
                    SelectionSourceKind.READING_GUIDE,
                    SelectionSourceKind.INLINE_GUIDANCE,
                    SelectionSourceKind.MASTER_ANSWER,
                }:
                    raise AssistantStateError(
                        "NON_PDF_NOTE_SOURCE_UNAVAILABLE",
                        "这条解释没有原始 PDF 选区锚点，不能保存为教材笔记。",
                    )
                concept_path = [root.created_from.selected_text]
                child_focus = None
                if clean_node_id is not None:
                    lineage = []
                    current_node_id = clean_node_id
                    while current_node_id is not None:
                        node = root.nodes[current_node_id]
                        lineage.append(node.selected_text)
                        current_node_id = node.parent_node_id
                    concept_path.extend(reversed(lineage))
                    child_focus = level.selected_text
                return {
                    "revision_id": root.created_from.revision_id,
                    "pdf_page_index": root.created_from.pdf_page_index,
                    "source": copy.deepcopy(root.source_anchor),
                    "provenance": {
                        "root_focus": root.created_from.selected_text,
                        "child_focus": child_focus,
                        "concept_path": concept_path,
                        "answer_question": turn.question,
                    },
                    "source_grounding": {
                        "pdf_page_number": root.created_from.pdf_page_index + 1,
                        "printed_page_label": root.reference_context.get("printed_page_label"),
                        "chapter_title": root.scope.chapter_title,
                        "section_title": root.scope.section_title,
                        "bounded_same_page_ocr": root.reference_context.get(
                            "same_page_ocr_context", ""
                        ),
                    },
                    "ai_content": turn.answer,
                }

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

    @staticmethod
    def _continuation_messages(
        messages: list[dict], continuation: dict | None
    ) -> tuple[list[dict], str | None]:
        if continuation is None:
            return messages, None
        if not isinstance(continuation, dict) or set(continuation) != {"partial_answer"}:
            raise ValueError("Assistant continuation payload is invalid")
        partial_answer = continuation.get("partial_answer")
        if (
            not isinstance(partial_answer, str)
            or not partial_answer.strip()
            or len(partial_answer) > MAX_CONTINUATION_CHARS
        ):
            raise ValueError("Assistant continuation content is invalid or too long")
        continued = copy.deepcopy(messages)
        continued.extend([
            {"role": "assistant", "content": partial_answer},
            {
                "role": "user",
                "content": (
                    "上一条回答因输出长度上限中断。请从中断处直接继续，只输出缺失的后续内容，"
                    "不要重复已经给出的部分。"
                ),
            },
        ])
        return continued, partial_answer

    @staticmethod
    def _join_continuation(partial_answer: str | None, answer: str) -> str:
        if partial_answer is None:
            return answer
        separator = (
            " "
            if partial_answer[-1:].isascii()
            and partial_answer[-1:].isalnum()
            and answer[:1].isascii()
            and answer[:1].isalnum()
            else ""
        )
        return partial_answer + separator + answer

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
        self,
        provider: str,
        messages: list[dict],
        *,
        interaction_id: str,
        stream: StreamEmitter | None = None,
        completions: list[ProviderCompletion] | None = None,
    ) -> str:
        provider_options = {
            "deepseek": {"thinking_mode": "disabled", "max_tokens": 8_192},
            "zhipu": {"reasoning_effort": "low", "max_tokens": 16_384},
        }.get(provider, {})
        if stream is not None:
            stream_for_with_metadata = getattr(
                self.runtime, "stream_for_with_metadata", None
            )
            if stream_for_with_metadata is not None:
                completion = stream_for_with_metadata(
                    provider,
                    messages,
                    lambda delta: stream({"type": "delta", "content": delta}),
                    interaction_id=interaction_id,
                    **provider_options,
                )
            else:
                stream_with_metadata = getattr(
                    self.runtime, "stream_with_metadata", None
                )
                if stream_with_metadata is None:
                    raise ProviderFailure(
                        ProviderFailureKind.UNCONFIGURED,
                        "streaming_unavailable",
                        "当前 Assistant provider 不支持真实流式回答。",
                    )
                completion = stream_with_metadata(
                    messages,
                    lambda delta: stream({"type": "delta", "content": delta}),
                    interaction_id=interaction_id,
                    **provider_options,
                )
            if completions is not None:
                completions.append(completion)
            return completion.answer
        complete_for_with_metadata = getattr(
            self.runtime, "complete_for_with_metadata", None
        )
        if complete_for_with_metadata is not None:
            return complete_for_with_metadata(
                provider,
                messages,
                interaction_id=interaction_id,
                **provider_options,
            ).answer
        complete_with_metadata = getattr(self.runtime, "complete_with_metadata", None)
        if complete_with_metadata is not None:
            return complete_with_metadata(
                messages,
                interaction_id=interaction_id,
                **provider_options,
            ).answer
        complete_for = getattr(self.runtime, "complete_for", None)
        if complete_for is not None:
            return complete_for(provider, messages, interaction_id=interaction_id)
        return self.runtime.complete(messages, interaction_id=interaction_id)

    @staticmethod
    def _emit_stage(stream: StreamEmitter | None, started: float) -> None:
        if stream is not None:
            stream({
                "type": "stage",
                "stage": "answering",
                "context_ms": max(0, round((time.perf_counter() - started) * 1000)),
            })

    @staticmethod
    def _emit_complete(
        stream: StreamEmitter | None,
        public: dict,
        completions: list[ProviderCompletion],
    ) -> None:
        if stream is None:
            return
        completion = completions[0]
        usage = completion.usage or {}
        stream({
            "type": "complete",
            "assistant": public,
            "metrics": {
                "ttft_ms": completion.ttft_ms,
                "total_latency_ms": completion.latency_ms,
                "output_tokens": usage.get("completion_tokens"),
            },
        })

    def _slot_for(self, session_id: str) -> _ReaderSessionSlot:
        with self._state_lock:
            if getattr(self.runtime, "beta_guard", None):
                stale = [key for key, slot in self._sessions.items() if time.monotonic() - slot.last_seen > 86400]
                for key in stale:
                    self._sessions.pop(key)
            if getattr(self.runtime, "beta_guard", None) and session_id not in self._sessions and len(self._sessions) >= 32:
                raise AssistantStateError("BUSY", "临时阅读会话已满，请先关闭不用的阅读窗口。")
            slot = self._sessions.setdefault(session_id, _ReaderSessionSlot())
            slot.last_seen = time.monotonic()
            return slot

    def heartbeat(self, session_id):
        session_id = self._validate_session_id(session_id)
        with self._state_lock:
            if session_id in self._sessions:
                self._sessions[session_id].last_seen = time.monotonic()

    def _existing_slot(self, session_id: str) -> _ReaderSessionSlot:
        with self._state_lock:
            slot = self._sessions.get(session_id)
            if slot is not None:
                slot.last_seen = time.monotonic()
        if slot is None:
            raise LookupError("临时解释不存在或已随 Reader 关闭而清除")
        return slot

    def _begin(self, slot: _ReaderSessionSlot, session_id: str) -> tuple[int, int]:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                raise self._request_cancelled()
            with slot.lock:
                return slot.generation, slot.state.focus_version

    def _fail_pending_child(
        self,
        session_id: str,
        slot: _ReaderSessionSlot,
        generation: int,
        root_id: str,
        parent_node_id: str | None,
        child_node_id: str,
        interaction_id: str,
        error: Exception,
    ) -> bool:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                return False
            with slot.lock:
                if slot.generation != generation:
                    return False
                root = slot.state.roots.get(root_id)
                if root is None:
                    return False
                try:
                    parent = self._level(root, parent_node_id)
                except LookupError:
                    return False
                child = root.nodes.get(child_node_id)
                if (
                    parent.pending_child_id != interaction_id
                    or child is None
                    or child.pending_turn_id != interaction_id
                ):
                    return False
                parent.pending_child_id = None
                child.pending_turn_id = None
                child.error = (
                    error.user_message
                    if isinstance(error, (ProviderFailure, AssistantStateError))
                    else "AI 解释失败，请稍后再试。"
                )
                slot.state.state_version += 1
                return True

    def _clear_pending_turn(
        self,
        session_id: str,
        slot: _ReaderSessionSlot,
        generation: int,
        root_id: str,
        node_id: str | None,
        turn_id: str,
    ) -> bool:
        with self._state_lock:
            if self._sessions.get(session_id) is not slot:
                return False
            with slot.lock:
                if slot.generation != generation:
                    return False
                root = slot.state.roots.get(root_id)
                if root is None:
                    return False
                try:
                    level = self._level(root, node_id)
                except LookupError:
                    return False
                if level.pending_turn_id == turn_id:
                    level.pending_turn_id = None
                    return True
                return False

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
    def _subtree_ids(root: AssistantRoot, node_id: str) -> set[str]:
        removed = {node_id}
        changed = True
        while changed:
            changed = False
            for candidate in root.nodes.values():
                if candidate.node_id not in removed and candidate.parent_node_id in removed:
                    removed.add(candidate.node_id)
                    changed = True
        return removed

    @staticmethod
    def _latest_child_id(root: AssistantRoot, parent_node_id: str | None) -> str | None:
        matching = [
            node.node_id
            for node in root.nodes.values()
            if node.parent_node_id == parent_node_id
        ]
        return matching[-1] if matching else None

    @staticmethod
    def _reference_context(context: dict) -> dict:
        return {
            "same_page_ocr_context": context["same_page_ocr_context"],
            "printed_page_label": context["printed_page_label"],
            "pdf_page_numbers": tuple(context.get("pdf_page_numbers", ())),
            "source_notice": context.get("source_notice"),
        }

    @staticmethod
    def _project_child_context(
        root: AssistantRoot,
        parent_node_id: str | None,
        selected_text: str,
        triggering_turn: Turn,
    ) -> ModelVisibleContext:
        """Project tree state field-by-field into the provider-visible allowlist."""
        node_labels = []
        current_node_id = parent_node_id
        while current_node_id is not None:
            node = root.nodes[current_node_id]
            node_labels.append(node.selected_text)
            current_node_id = node.parent_node_id
        concept_path = (
            root.created_from.selected_text,
            *reversed(node_labels),
            selected_text,
        )
        return ModelVisibleContext(
            current_focus=selected_text,
            direct_previous_focus=triggering_turn.question,
            direct_previous_answer=triggering_turn.answer,
            concept_path=concept_path,
            reader_grounding=ModelVisibleReaderGrounding(
                pdf_page_number=root.created_from.pdf_page_index + 1,
                chapter_title=root.scope.chapter_title,
                section_title=root.scope.section_title,
                printed_page_label=root.reference_context.get("printed_page_label"),
                bounded_same_page_ocr=root.reference_context.get(
                    "same_page_ocr_context", ""
                ),
                pdf_page_numbers=tuple(root.reference_context.get("pdf_page_numbers", ())),
                source_notice=root.reference_context.get("source_notice"),
            ),
        )

    @staticmethod
    def _answer_selection(answer: str, start: int, end: int) -> str:
        if start < 0 or end <= start or end > len(answer):
            raise AssistantStateError("INVALID_ANSWER_SELECTION", "回答选区范围无效。")
        selected = answer[start:end]
        if not selected.strip() or len(selected) > MAX_ANSWER_SELECTION_CHARS:
            raise AssistantStateError(
                "INVALID_ANSWER_SELECTION",
                f"请选择 1 到 {MAX_ANSWER_SELECTION_CHARS} 个回答文字。",
            )
        return selected

    @staticmethod
    def _answer_selection_spans(answer: str, spans: list[dict]) -> str:
        if not isinstance(spans, list) or not 1 <= len(spans) <= 128:
            raise AssistantStateError(
                "INVALID_ANSWER_SELECTION", "回答选区的来源映射无效。"
            )
        pieces = []
        previous_end = -1
        total = 0
        for span in spans:
            if not isinstance(span, dict):
                raise AssistantStateError(
                    "INVALID_ANSWER_SELECTION", "回答选区的来源映射无效。"
                )
            start = span.get("start")
            end = span.get("end")
            if (
                not isinstance(start, int)
                or isinstance(start, bool)
                or not isinstance(end, int)
                or isinstance(end, bool)
                or start < 0
                or end <= start
                or end > len(answer)
                or start < previous_end
            ):
                raise AssistantStateError(
                    "INVALID_ANSWER_SELECTION", "回答选区的来源映射无效。"
                )
            piece = answer[start:end]
            pieces.append(piece)
            total += len(piece)
            previous_end = end
        selected = "".join(pieces)
        if not selected.strip() or selected != selected.strip() or total > MAX_ANSWER_SELECTION_CHARS:
            raise AssistantStateError(
                "INVALID_ANSWER_SELECTION",
                f"请选择 1 到 {MAX_ANSWER_SELECTION_CHARS} 个普通正文文字。",
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
