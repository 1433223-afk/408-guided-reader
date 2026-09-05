from __future__ import annotations

import threading
from dataclasses import dataclass, field
from uuid import uuid4

from reader_service.agent_runtime import AgentRuntime, ProviderFailure, ProviderFailureKind

from .context import AssistantContextBuilder, ScopeResolution, provider_user_message
from .skill import load_explanation_skill


MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 8_000
SYSTEM_BOUNDARY = (
    "你是附着在原始教材页面上的临时中文讲解助手。用简体中文清楚、直接地回答。"
    "选区触发的首轮消息中，‘当前解释焦点’就是用户希望解释的对象。"
    "关于教材本身的陈述只能来自本次提供的教材语境；概念解释可以使用可靠的专业或通识知识，"
    "但不得把补充知识伪装成教材原文、教材观点或本页已有内容，也不得编造引文或印刷页码。"
)
SYSTEM_MESSAGE = SYSTEM_BOUNDARY + "\n\n" + load_explanation_skill()


@dataclass(slots=True)
class Turn:
    question: str
    answer: str
    provider_user_content: str


@dataclass(slots=True)
class Conversation:
    conversation_id: str
    scope: ScopeResolution
    turns: list[Turn] = field(default_factory=list)

    def public(self) -> dict:
        return {
            "conversation_id": self.conversation_id,
            "scope": self.scope.public(),
            "turns": [
                {"question": turn.question, "answer": turn.answer} for turn in self.turns
            ],
        }


class AssistantService:
    """Memory-only, per-reader-session Assistant conversations."""

    def __init__(self, contexts: AssistantContextBuilder, runtime: AgentRuntime):
        self.contexts = contexts
        self.runtime = runtime
        self._sessions: dict[str, dict[str, Conversation]] = {}
        self._comparisons: dict[str, dict] = {}
        self._session_locks: dict[str, threading.Lock] = {}
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
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        context = self.contexts.build(
            revision_id, page_index, start=start, end=end
        )
        visible_message = context["selected_text"]
        scope: ScopeResolution = context["scope"]
        lock = self._lock_for(session_id)
        with lock:
            existing = self._sessions.get(session_id, {}).get(scope.key)
            conversation = existing or Conversation(str(uuid4()), scope)
            user_content = provider_user_message(context)
            answer = self.runtime.complete(
                self._messages(conversation, user_content), interaction_id=str(uuid4())
            )
            conversation.turns.append(Turn(visible_message, answer, user_content))
            with self._state_lock:
                self._sessions.setdefault(session_id, {})[scope.key] = conversation
            return conversation.public()

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
        messages = self._messages(Conversation(str(uuid4()), scope), user_content)
        comparison_id = str(uuid4())
        results = compare(messages, interaction_id=comparison_id)
        comparison = {
            "comparison_id": comparison_id,
            "scope": scope.public(),
            "question": visible_message,
            "selected_text": context["selected_text"],
            "results": results,
        }
        lock = self._lock_for(session_id)
        with lock:
            with self._state_lock:
                self._comparisons[session_id] = comparison
        return comparison

    def follow_up(
        self, reader_session_id: str, conversation_id: str, question: str
    ) -> dict:
        session_id = self._validate_session_id(reader_session_id)
        clean_question = self._validate_question(question)
        lock = self._lock_for(session_id)
        with lock:
            conversation = self._conversation(session_id, conversation_id)
            user_content = clean_question
            answer = self.runtime.complete(
                self._messages(conversation, user_content), interaction_id=str(uuid4())
            )
            conversation.turns.append(Turn(clean_question, answer, user_content))
            return conversation.public()

    def close_session(self, reader_session_id: str) -> None:
        session_id = self._validate_session_id(reader_session_id)
        lock = self._lock_for(session_id)
        with lock:
            with self._state_lock:
                self._sessions.pop(session_id, None)
                self._comparisons.pop(session_id, None)

    def conversation_count(self) -> int:
        with self._state_lock:
            return sum(len(values) for values in self._sessions.values())

    def comparison_count(self) -> int:
        with self._state_lock:
            return len(self._comparisons)

    def _messages(self, conversation: Conversation, new_user_content: str) -> list[dict]:
        messages = [{"role": "system", "content": SYSTEM_MESSAGE}]
        history = conversation.turns[-MAX_HISTORY_TURNS:]
        used = 0
        bounded: list[tuple[str, str]] = []
        for turn in reversed(history):
            size = len(turn.provider_user_content) + len(turn.answer)
            remaining = MAX_HISTORY_CHARS - used
            if size > remaining:
                if bounded or remaining < 2:
                    break
                # Keep a bounded slice of the newest turn: source/question from
                # the front, and the most recent conclusion from the answer tail.
                user_budget = min(len(turn.provider_user_content), remaining // 2)
                answer_budget = remaining - user_budget
                bounded.append((
                    turn.provider_user_content[:user_budget],
                    turn.answer[-answer_budget:] if answer_budget else "",
                ))
                used = MAX_HISTORY_CHARS
                break
            bounded.append((turn.provider_user_content, turn.answer))
            used += size
        for user_content, answer in reversed(bounded):
            messages.append({"role": "user", "content": user_content})
            messages.append({"role": "assistant", "content": answer})
        messages.append({"role": "user", "content": new_user_content})
        return messages

    def _conversation(self, session_id: str, conversation_id: str) -> Conversation:
        with self._state_lock:
            values = self._sessions.get(session_id, {})
            found = next(
                (value for value in values.values() if value.conversation_id == conversation_id),
                None,
            )
        if found is None:
            raise LookupError("临时对话不存在或已随 Reader 关闭而清除")
        return found

    def _lock_for(self, session_id: str) -> threading.Lock:
        with self._state_lock:
            return self._session_locks.setdefault(session_id, threading.Lock())

    @staticmethod
    def _validate_session_id(value: str) -> str:
        if not isinstance(value, str) or not 8 <= len(value) <= 128 or any(ch.isspace() for ch in value):
            raise ValueError("Reader session id is invalid")
        return value

    @staticmethod
    def _validate_question(value: str) -> str:
        if not isinstance(value, str):
            raise ValueError("问题必须是文字")
        clean = value.strip()
        if not clean or len(clean) > MAX_QUESTION_CHARS:
            raise ValueError(f"问题需为 1 到 {MAX_QUESTION_CHARS} 个字符")
        return clean
