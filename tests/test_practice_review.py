"""Practice Review shares Master runtime without touching learning state."""

from types import SimpleNamespace

import pytest

from reader_service.library.database import Database
from reader_service.practice_prototype import PracticePrototype, SOURCE_SHA256
from reader_service.practice_review import PracticeReviewService


def _line(y, text):
    return {"quad": [[.2, y], [.8, y], [.8, y], [.2, y]], "text": text}


class FakeFoundation:
    def overlay(self, _revision, page):
        lines = {
            19: [
                _line(.755, "01. 完整的计算机系统应包括（）。"),
                _line(.774, "A. 运算器、存储器、控制器"),
                _line(.775, "B. 外部设备和主机"),
                _line(.795, "C. 主机和应用程序"),
                _line(.795, "D. 配套的硬件设备和软件系统"),
            ],
            21: [_line(.735, "01. D"), _line(.755, "只有 D 同时包括硬件和软件。"),
                 _line(.775, "02. A")],
            22: [],
        }
        return {"status": "READY", "lines": lines[page]}


class FakeRuntime:
    def __init__(self):
        self.calls = []
        self.fail = False

    def provider_identity(self, provider):
        if provider == "zhipu":
            return provider, "GLM-5.3-Flash"
        if provider != "deepseek":
            raise ValueError("模型未经许可。")
        return provider, "deepseek-flash"

    def complete_for_with_metadata(self, provider, messages, **_options):
        self.calls.append((provider, messages))
        if self.fail:
            raise ValueError("模拟暂时失败")
        return SimpleNamespace(answer="依据原题和官方解析，D 同时包括硬件与软件。")

    def stream_for_with_metadata(self, provider, messages, on_delta, _on_reasoning, **options):
        result = self.complete_for_with_metadata(provider, messages, **options)
        on_delta(result.answer)
        return result


def test_review_requires_submission_and_reuses_question_thread(tmp_path):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    with database.connect() as connection:
        connection.execute("INSERT INTO books(id, title, status, created_at) VALUES ('book', '王道', 'ACTIVE', 'now')")
        connection.execute(
            """INSERT INTO book_source_revisions
               (id, book_id, blob_sha256, byte_size, page_count, page_geometry_json, label, status, created_at)
               VALUES ('revision', 'book', ?, 1, 23, '[]', 'sample', 'ACTIVE', 'now')""",
            (SOURCE_SHA256,),
        )
    practice = PracticePrototype(database)
    runtime = FakeRuntime()
    master = SimpleNamespace(runtime=runtime, foundation=FakeFoundation(), provider="deepseek")
    review = PracticeReviewService(practice, master)

    with pytest.raises(ValueError, match="先提交"):
        review.open("revision", 1)
    assert runtime.calls == []
    practice.attempt("revision", 1, "A")
    first = review.open("revision", 1)
    assert first["thread_id"]
    assert review.open("revision", 1)["thread_id"] == first["thread_id"]
    events = []
    a = review.send("revision", 1, {"intent_id": "a", "target": "A", "provider": "deepseek"}, events.append)
    assert a["messages"][-1]["role"] == "assistant"
    assert events[-1]["type"] == "complete" and any(event["type"] == "delta" for event in events)
    source = __import__("json").loads(runtime.calls[0][1][1]["content"])["source"]
    assert source["last_choice"] == "A" and source["last_correct"] is False
    assert source["official_answer"] == "D" and "硬件和软件" in source["official_explanation"]
    assert source["options"]["A"].startswith("运算器")

    review.send("revision", 1, {"intent_id": "b", "target": "B", "provider": "deepseek"})
    follow_up = review.send("revision", 1, {"intent_id": "follow", "question": "为什么 A 不完整？", "provider": "deepseek"})
    assert follow_up["thread_id"] == first["thread_id"] and len(follow_up["messages"]) == 6
    assert "A 选项" in runtime.calls[1][1][1]["content"]
    with pytest.raises(ValueError, match="发送标识"):
        review.send("revision", 1, {"intent_id": "a", "target": "C", "provider": "deepseek"})
    with pytest.raises(ValueError, match="只可使用已获准"):
        review.send("revision", 1, {"intent_id": "unauthorized", "target": "C", "provider": "zhipu"})
    with pytest.raises(ValueError, match="先提交"):
        review.open("revision", 2)
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM learning_events").fetchone()[0] == 0
        assert connection.execute("SELECT count(*) FROM master_threads").fetchone()[0] == 0

    runtime.fail = True
    failed = review.send("revision", 1, {"intent_id": "failure", "target": "整题", "provider": "deepseek"})
    pending = failed["messages"][-1]
    assert pending["state"] == "FAILED"
    runtime.fail = False
    repaired = review.retry("revision", 1, pending["id"])
    assert repaired["messages"][-2]["state"] == "COMPLETE"
    with database.connect() as connection:
        connection.execute(
            """INSERT INTO practice_review_messages
               (id, thread_id, intent_id, role, content, state)
               VALUES ('interrupted', ?, 'interrupted', 'user', '继续解释', 'PENDING')""",
            (first["thread_id"],),
        )
    reopened = PracticeReviewService(practice, master)
    assert reopened.snapshot("revision", 1)["messages"][-1]["state"] == "FAILED"
