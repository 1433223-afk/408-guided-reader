"""Practice visual evidence and section resume stay on their existing boundaries."""

import json
from types import SimpleNamespace

import pytest

from reader_service.library.database import Database
from reader_service.practice_hint import PracticeHintService
from reader_service.practice_prototype import PracticePrototype
from reader_service.practice_review import PracticeReviewService
from reader_service.practice_visual import needs_question_visual, question_crop_rects
from reader_service.practice_catalog import _question_group
from test_practice_catalog import _source


class Runtime:
    def __init__(self):
        self.calls = []

    def provider_identity(self, provider):
        return provider, "deepseek-flash"

    def supports_images(self, provider, *, model):
        return (provider, model) == ("deepseek", "deepseek-flash")

    def complete_for_with_metadata(self, provider, messages, **options):
        self.calls.append((messages, options))
        return SimpleNamespace(answer="继续比较题干与选项的条件。")


def test_cross_page_hint_and_review_get_question_crops_but_only_review_gets_answer(tmp_path, monkeypatch):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    _source(database)
    practice = PracticePrototype(database)
    question = practice.catalog("revision")[0]["questions"][0]
    assert question_crop_rects(question)[0][0] == 0
    assert question_crop_rects(question)[1][0] == 1
    assert question_crop_rects(question)[0][1][3] == .95
    crops = []

    def fake_render(_library, _revision, page, rect):
        crops.append((page, rect))
        return {"image": {"data_url": f"data:image/png;base64,PAGE{page}"}}

    monkeypatch.setattr("reader_service.practice_visual.render_visual_region", fake_render)
    runtime = Runtime()
    master = SimpleNamespace(runtime=runtime, provider="deepseek")
    review = PracticeReviewService(practice, master, object())
    hint = PracticeHintService(review)
    hint.hint("revision", question["number"], {"selected": "B", "previous_hints": []})
    hint_content = runtime.calls[0][0][1]["content"]
    assert [item["type"] for item in hint_content] == ["text", "image_url", "image_url"]
    hint_source = json.loads(hint_content[0]["text"])["source"]
    assert hint_source["options"]["B"] == "乙 乙的续行"
    assert not {"official_answer", "official_explanation", "last_correct"} & hint_source.keys()
    assert runtime.calls[0][1]["retain_request_body"] is False
    assert [page for page, _ in crops] == [0, 1]

    practice.attempt("revision", question["number"], "B")
    review.open("revision", question["number"])
    review.send("revision", question["number"], {"intent_id": "review", "target": "B", "provider": "deepseek"})
    review_content = runtime.calls[1][0][1]["content"]
    assert [item["type"] for item in review_content] == ["text", "image_url", "image_url"]
    review_source = json.loads(review_content[0]["text"])["source"]
    assert review_source["official_answer"] == "A"
    assert review_source["last_choice"] == "B"
    assert review_source["last_correct"] is False
    assert runtime.calls[1][1]["retain_request_body"] is False


def test_plain_text_question_does_not_request_images():
    question = {"page": 4, "promptY": .2, "question_ocr": "哪项正确？ A. 甲 B. 乙 C. 丙 D. 丁",
                "pages": [{"pdf_page_number": 5}],
                "sourceRegions": [{"page": 4, "top": .2, "bottom": .32}],
                "regions": [{"page": 4, "options": [{"rect": [.2, .3, .4, .32]}]}]}
    assert not needs_question_visual(question)
    assert question_crop_rects(question) == [(4, [.10, .197, .90, .322])]
    question["question_ocr"] = "以下表述正确的是？ A. 甲 B. 乙 C. 丙 D. 丁"
    assert not needs_question_visual(question)
    question["question_ocr"] = "下图所示的数据通路中，哪项正确？"
    assert needs_question_visual(question)


@pytest.mark.parametrize("layout", ["prompt_only", "middle_only", "diagram_after_options", "split_options", "ocr_out_of_order"])
def test_source_geometry_preserves_every_question_page_independently_of_options(layout):
    def line(page, ordinal, text, y):
        return {"page": page, "ordinal": ordinal, "text": text,
                "quad": [[.18, y], [.8, y], [.8, y + .016], [.18, y + .016]],
                "cells": [[.18 + i * .008, .18 + (i + 1) * .008, i, i + 1]
                          for i in range(len(text))]}

    option_page = 2 if layout == "middle_only" else 0 if layout == "diagram_after_options" else 1
    group = [line(0, 0, "01. 下图或条件所示，哪项成立？", .70)]
    if layout == "middle_only":
        group.append(line(1, 0, "续写题干与中间图表内容", .12))
    for i, choice in enumerate("ABCD"):
        page = 0 if layout == "split_options" and i < 2 else option_page
        group.append(line(page, i + 1, f"{choice}. 条件{choice}", .75 + i * .025 if page == 0 else .12 + i * .025))
    if layout == "diagram_after_options":
        group.extend([line(1, 0, "时序图上半部", .12), line(1, 1, "时序图下半部", .40)])
    if layout == "ocr_out_of_order":
        group.append(line(0, 5, "同一行拆分的题干", .699))
        group.append(line(0, 6, "前文表格，不属于本题", .3))
    group.sort(key=lambda item: (item["page"], item["ordinal"]))
    question = _question_group(group, 1, {"title": "8.1.1 本节习题精选", "outline_node_id": "exercise"}, "f" * 64)
    assert question is not None
    assert "前文表格" not in question["question_ocr"]
    assert "前文表格" not in " ".join(question["options_text"].values())
    if layout == "ocr_out_of_order":
        assert "同一行拆分的题干" in question["question_ocr"]
    source_pages = {region["page"] for region in question["sourceRegions"]}
    assert source_pages == {item["page"] for item in group}
    assert source_pages == {page["pdf_page_number"] - 1 for page in question["pages"]}
    assert {page for page, _ in question_crop_rects(question)} == source_pages
    assert needs_question_visual(question)
    for region in question["sourceRegions"]:
        rect = dict(question_crop_rects(question))[region["page"]]
        assert rect[1] <= region["top"] < region["bottom"] <= rect[3]


def test_last_active_question_survives_reopen_without_attempt(tmp_path):
    database = Database(tmp_path / "state.sqlite3")
    database.initialize()
    _source(database)
    practice = PracticePrototype(database)
    section = practice.public_catalog("revision")[0]
    number = section["questions"][0]["number"]
    assert practice.positions("revision") == {}
    assert practice.set_position("revision", section["id"], number)["question_number"] == number
    assert practice.list("revision") == []
    assert PracticePrototype(database).positions("revision") == {section["id"]: number}
    with pytest.raises(ValueError, match="不属于"):
        practice.set_position("revision", "other-section", number)
    with pytest.raises(ValueError, match="不属于"):
        practice.set_position("revision", section["id"], number + 1)
