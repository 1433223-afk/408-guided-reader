"""One real PDF crop uses the existing temporary Assistant conversation path."""

import json
from dataclasses import replace
from urllib.error import HTTPError

import pytest

from reader_service.agent_runtime import ProviderFailure, ProviderFailureKind
from reader_service.assistant import AssistantService, AssistantStateError
from test_api import request_json, running_server
from test_ask_about_this import (
    MockAdapter, StreamingMockAdapter, assistant_fixture, focused, runtime, selection,
)


REGION = [.1, .12, .8, .4]


def image_url(call):
    images = [block["image_url"]["url"]
              for message in call["body"]["messages"] if isinstance(message["content"], list)
              for block in message["content"] if block["type"] == "image_url"]
    assert len(images) == 1
    assert images[0].startswith("data:image/png;base64,")
    return images[0]


def test_visual_context_uses_existing_nearby_ocr_but_never_requires_or_starts_it(assistant_fixture):
    fixture = assistant_fixture
    with fixture["database"].connect() as connection:
        before = [tuple(row) for row in connection.execute(
            "SELECT pdf_page_index,status FROM ocr_pages ORDER BY pdf_page_index")]
        jobs_before = connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    # Page 1 has never been prepared: rendering and asking can still proceed.
    empty = fixture["contexts"].build_visual(fixture["revision_id"], 1, rect=REGION, question="解释图中关系")
    assert empty["same_page_ocr_context"] == ""
    assert empty["knowledge_context"] == ""
    assert empty["scope"].chapter_title == "第6章 总线"
    assert empty["visual_region"]["rect"] == REGION
    assert empty["image_data_url"].startswith("data:image/png;base64,")
    prepared = fixture["contexts"].build_visual(fixture["revision_id"], 3, rect=REGION, question="解释图中关系")
    assert "总线事务" in prepared["same_page_ocr_context"]
    assert prepared["printed_page_label"] == "291"
    assert prepared["scope"].section_title == "6.2.1 总线事务"
    assert len(prepared["same_page_ocr_context"]) <= 1600
    with fixture["database"].connect() as connection:
        assert [tuple(row) for row in connection.execute(
            "SELECT pdf_page_index,status FROM ocr_pages ORDER BY pdf_page_index")] == before
        assert connection.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == jobs_before


def test_visual_root_followup_and_child_reuse_one_image_without_leaking_it(assistant_fixture):
    fixture = assistant_fixture
    adapter = MockAdapter(["图中总线负责连接。", "同步时钟协调传输。", "时钟用于协调各部件。", "纯文字解释。"])
    assistant = AssistantService(fixture["contexts"], runtime(adapter))
    state = assistant.ask_visual("visual-session", fixture["revision_id"], 3,
                                 rect=REGION, question="这张图表达什么？")
    first = focused(state)
    root_id = first["root_id"]
    created = state["roots"][0]["created_from"]
    assert created["kind"] == "VISUAL_REGION"
    assert created["visual_region"]["rect"] == REGION
    assert first["turns"][0]["question"] == "这张图表达什么？"
    assert "data:image" not in json.dumps(state)
    crop_url = image_url(adapter.calls[0])
    assert "这张图表达什么？" in adapter.calls[0]["body"]["messages"][-1]["content"][0]["text"]
    state = assistant.follow_up("visual-session", root_id, "箭头表示什么？")
    assert image_url(adapter.calls[1]) == crop_url
    state = assistant.create_child(
        "visual-session", root_id, parent_node_id=None,
        turn_id=focused(state)["turns"][-1]["turn_id"], start_offset=0, end_offset=4,
    )
    child = focused(state)
    assert child["depth"] == 2
    assert image_url(adapter.calls[2]) == crop_url
    assert assistant.inspect_payloads() == {"calls": []}
    for node_id, turn_id in ((None, first["turns"][0]["turn_id"]),
                             (child["node_id"], child["turns"][0]["turn_id"])):
        with pytest.raises(AssistantStateError, match="图片区域解释") as error:
            assistant.completed_turn_projection("visual-session", root_id, turn_id, node_id=node_id)
        assert error.value.code == "VISUAL_NOTE_SOURCE_UNAVAILABLE"
    # A later text selection must never inherit the previous root's image.
    assistant.ask_selection("visual-session", fixture["revision_id"], 3, **selection(3))
    assert all(isinstance(message["content"], str) for message in adapter.calls[3]["body"]["messages"])
    assistant.close_root("visual-session", root_id)
    assert all(root["created_from"]["kind"] != "VISUAL_REGION"
               for root in assistant.state("visual-session")["roots"])


def test_visual_context_adds_only_existing_published_kp_at_the_selected_location(assistant_fixture):
    fixture = assistant_fixture
    with fixture["database"].connect() as connection:
        connection.execute(
            """INSERT INTO chapter_preparations(book_source_revision_id,chapter_outline_node_id,status,
               foundation_version,chapter_identity_revision,chapter_physical_revision,structure_version,
               attempt_id,generator_provider,generator_model,reviewer_provider,reviewer_model,
               requested_at,updated_at,published_at)
               VALUES (?,'chapter','READY',1,1,1,1,'fixture','deepseek','deepseek-flash',
                       'deepseek','deepseek-flash','now','now','now')""", (fixture["revision_id"],),
        )
        for index, (title, page) in enumerate((("当前图中的总线事务", 3), ("远处的知识点", 7))):
            connection.execute(
                """INSERT INTO knowledge_points(knowledge_point_id,book_source_revision_id,
                   chapter_outline_node_id,chapter_structure_version,primary_section_id,title,
                   one_sentence_definition,order_index,start_page,start_y,end_page,end_y,
                   source_foundation_version,created_at)
                   VALUES (?,?,'chapter',1,'unique',?,'只作辅助资料。',?,? ,0,?,1,1,'now')""",
                (f"visual-kp-{index}", fixture["revision_id"], title, index, page, page),
            )
    context = fixture["contexts"].build_visual(fixture["revision_id"], 3, rect=REGION, question="解释这个区域")
    assert "当前图中的总线事务" in context["knowledge_context"]
    assert "远处的知识点" not in context["knowledge_context"]
    with fixture["database"].connect() as connection:
        connection.execute("UPDATE outline_nodes SET evidence_json=? WHERE outline_node_id='chapter'",
                           (json.dumps({"asset_review": {"structure_version": 1}}),))
    assert fixture["contexts"].build_visual(
        fixture["revision_id"], 3, rect=REGION, question="解释这个区域",
    )["knowledge_context"] == ""


def test_visual_failed_child_retry_retains_its_original_crop(assistant_fixture):
    adapter = MockAdapter(["图中总线负责连接。", ProviderFailure(
        ProviderFailureKind.TRANSIENT, "network", "网络暂时不可用。",
    ), "总线连接处理器与存储器。"])
    provider = runtime(adapter, max_attempts=1)
    clock = [0.0]
    provider.clock = lambda: clock[0]
    assistant = AssistantService(assistant_fixture["contexts"], provider)
    state = assistant.ask_visual("visual-retry", assistant_fixture["revision_id"], 1, rect=REGION)
    current = focused(state)
    with pytest.raises(ProviderFailure):
        assistant.create_child("visual-retry", current["root_id"], parent_node_id=None,
                               turn_id=current["turns"][0]["turn_id"], start_offset=2, end_offset=4)
    failed = focused(assistant.state("visual-retry"))
    assert failed["can_retry"] is True
    clock[0] += 31
    retried = assistant.retry_child("visual-retry", current["root_id"], failed["node_id"])
    assert focused(retried)["turns"][0]["answer"] == "总线连接处理器与存储器。"
    assert image_url(adapter.calls[0]) == image_url(adapter.calls[1]) == image_url(adapter.calls[2])
    assert assistant.inspect_payloads() == {"calls": []}


def test_visual_stream_uses_existing_events_and_does_not_publish_image_bytes(assistant_fixture):
    adapter = StreamingMockAdapter([["区域", "解释"]])
    assistant = AssistantService(assistant_fixture["contexts"], runtime(adapter))
    events = []
    state = assistant.ask_visual("visual-stream", assistant_fixture["revision_id"], 1,
                                 rect=REGION, stream=events.append)
    assert focused(state)["turns"][0]["answer"] == "区域解释"
    assert [event["content"] for event in events if event["type"] == "delta"] == ["区域", "解释"]
    assert image_url(adapter.calls[0])
    assert "data:image" not in json.dumps(events)
    assert assistant.inspect_payloads() == {"calls": []}


def test_visual_unsupported_model_is_rejected_before_egress(assistant_fixture):
    adapter = MockAdapter()
    provider = runtime(adapter)
    provider.config = replace(provider.config, model="deepseek-v4-pro")
    assistant = AssistantService(assistant_fixture["contexts"], provider)
    with pytest.raises(ProviderFailure) as caught:
        assistant.ask_visual("visual-model", assistant_fixture["revision_id"], 1, rect=REGION)
    assert caught.value.code == "visual_model_unavailable"
    assert adapter.calls == []


def test_visual_http_preview_and_ask_resolve_server_pdf_and_require_auth(assistant_fixture):
    fixture = assistant_fixture
    adapter = MockAdapter(["真实区域解释。"])
    assistant = AssistantService(fixture["contexts"], runtime(adapter))
    with running_server(fixture["foundation"].library, assistant=assistant) as (base, token):
        region_url = f"{base}/api/revisions/{fixture['revision_id']}/visual-region"
        body = json.dumps({"pdf_page_index": 1, "rect": REGION}).encode()
        with pytest.raises(HTTPError) as denied:
            request_json(region_url, "", method="POST", data=body)
        assert denied.value.code == 401
        status, preview = request_json(region_url, token, method="POST", data=body)
        assert status == 200 and preview["rect"] == REGION
        assert preview["image"]["mime_type"] == "image/png"
        assert adapter.calls == []
        _, asked = request_json(
            f"{base}/api/revisions/{fixture['revision_id']}/assistant/ask", token,
            method="POST", data=json.dumps({
                "reader_session_id": "visual-http", "source_kind": "VISUAL_REGION",
                "pdf_page_index": 1, "rect": REGION, "question": "",
                "image_data_url": "https://untrusted.invalid/picture.png", "ocr": "客户端伪造资料",
            }).encode(),
        )
        assert asked["assistant"]["current"]["turns"][0]["answer"] == "真实区域解释。"
        assert image_url(adapter.calls[0]) == preview["image"]["data_url"]
        sent = json.dumps(adapter.calls[0]["body"], ensure_ascii=False)
        assert "untrusted.invalid" not in sent and "客户端伪造资料" not in sent
        for invalid in ({"pdf_page_index": True, "rect": REGION},
                        {"pdf_page_index": 1, "rect": [-.1, .1, .5, .5]}):
            with pytest.raises(HTTPError) as bad:
                request_json(region_url, token, method="POST", data=json.dumps(invalid).encode())
            assert bad.value.code == 400
