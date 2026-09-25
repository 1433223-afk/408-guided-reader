"""Solve-mode hint context never crosses the official-answer boundary."""

import json
from types import SimpleNamespace

import pytest

from reader_service.library.database import Database
from reader_service.practice_hint import PracticeHintService
from reader_service.practice_prototype import PracticePrototype, SOURCE_SHA256
from reader_service.practice_review import PracticeReviewService


class Foundation:
    def __init__(self):
        self.pages = []

    def overlay(self, _revision, page):
        self.pages.append(page)
        assert page == 19, "Solve mode must never read the answer pages"
        def line(y, content):
            return {"quad": [[.2, y], [.8, y], [.8, y], [.2, y]], "text": content}
        return {"status": "READY", "lines": [
            line(.755, "01. 完整的计算机系统应包括（）。"),
            line(.774, "A. 运算器、存储器、控制器"),
            line(.775, "B. 外部设备和主机"),
            line(.795, "C. 主机和应用程序"),
            line(.795, "D. 配套的硬件设备和软件系统"),
        ]}


class Runtime:
    def __init__(self):
        self.calls = []

    def provider_identity(self, provider):
        return provider, "deepseek-flash" if provider == "deepseek" else "unapproved"

    def complete_for_with_metadata(self, provider, messages, **options):
        self.calls.append((provider, messages, options))
        return SimpleNamespace(answer=f"第 {len(self.calls)} 次：继续比较概念范围。")


def test_progressive_hint_uses_only_question_page_and_prior_hints(tmp_path):
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
    foundation, runtime = Foundation(), Runtime()
    master = SimpleNamespace(foundation=foundation, runtime=runtime, provider="deepseek")
    practice = PracticePrototype(database)
    review = PracticeReviewService(practice, master)
    service = PracticeHintService(review)
    first = service.hint("revision", 1, {"selected": "A", "previous_hints": []})
    practice.attempt("revision", 1, "A")
    second = service.hint("revision", 1, {"selected": "A", "previous_hints": [first["hint"]]})
    assert (first["hint_number"], second["hint_number"]) == (1, 2)
    assert foundation.pages == [19, 19]
    payload = json.loads(runtime.calls[1][1][1]["content"])
    assert payload["previous_hints"] == [first["hint"]]
    assert payload["selected"] == "A"
    assert payload["source"]["options"]["A"].startswith("运算器")
    assert "official_answer" not in payload["source"]
    assert "official_explanation" not in payload["source"]
    assert "last_correct" not in payload["source"]
    assert "硬件和软件" not in runtime.calls[1][1][1]["content"]
    master.provider = "zhipu"
    with pytest.raises(ValueError, match="只可使用已获准"):
        service.hint("revision", 1, {"selected": None, "previous_hints": []})
    assert len(runtime.calls) == 2
