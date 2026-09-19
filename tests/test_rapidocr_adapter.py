from __future__ import annotations

from types import SimpleNamespace

import numpy as np
import pytest

from reader_service.foundation.rapidocr_adapter import RapidOcrEngine


@pytest.mark.parametrize("mode", ["ok", "exception", "bad_geometry", "rotated"])
def test_bounded_leader_retry_preserves_display_geometry_or_baseline(mode):
    baseline = SimpleNamespace(
        boxes=[
            np.array([[10, y], [80, y], [80, y + 8], [10, y + 8]], dtype=float)
            for y in (10, 30, 110, 130, 210, 230, 310, 330)
        ],
        txts=[f"原始标题{i}…………(1)" for i in range(8)],
        scores=[0.99] * 8,
        word_results=[()] * 8,
    )
    calls = []

    def provider(img, **options):
        calls.append(options)
        assert options == dict(
            use_det=True, use_cls=False, use_rec=True, return_word_box=True
        )
        if mode == "exception":
            raise RuntimeError("optional failure")
        band = len(calls) - 1
        if band >= 4:
            return SimpleNamespace(boxes=None)
        y0 = max(0, band * 100 - 10)
        boxes = [baseline.boxes[i] - (0, y0) for i in (band * 2, band * 2 + 1)]
        if mode == "bad_geometry":
            boxes[0][0, 0] = float("nan")
        return SimpleNamespace(
            boxes=boxes,
            txts=baseline.txts[band * 2 : band * 2 + 2]
            if mode != "rotated"
            else ["完全不同", "方向不对"],
            scores=[0.99, 0.99],
            word_results=[(), ()],
        )

    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    result = engine._leader_layout_retry(np.zeros((400, 100, 3)), baseline, (100, 400))
    if mode == "ok":
        assert len(calls) == 8 and len(result.boxes) == 8
        assert all(np.array_equal(a, b) for a, b in zip(result.boxes, baseline.boxes))
    else:
        assert result is baseline


@pytest.mark.parametrize(
    "retry_mode", ["accepted", "rejected", "exception", "malformed"]
)
def test_reused_engine_restores_full_pipeline_after_optional_retry(retry_mode):
    class StatefulProvider(SparseLineProvider):
        def __init__(self):
            super().__init__()
            self.options = {"use_det": True, "use_cls": True, "use_rec": True}

        def __call__(self, image, **options):
            self.options.update(options)
            if not self.options["use_det"]:
                if retry_mode == "exception":
                    raise RuntimeError("recognition failed after updating engine state")
                if retry_mode == "malformed":
                    return SimpleNamespace(txts=("replacement",), scores=("invalid",))
                return SimpleNamespace(
                    txts=("冯·诺依曼是在研究EDVAC机时提出了存储程序的概念",),
                    scores=(0.99 if retry_mode == "accepted" else 0.1,),
                    word_results=(None,),
                )
            assert all(self.options[key] for key in ("use_det", "use_cls", "use_rec"))
            return super().__call__(image, **options)

    provider = StatefulProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)
    for _ in range(3):
        lines = engine.prepare_page(image, (1000, 100))
        assert len(lines) == 1
        assert (
            lines[0].text != "无·"
            if retry_mode == "accepted"
            else lines[0].text == "无·"
        )


@pytest.mark.parametrize("score", [float("nan"), float("inf"), -0.1, 1.1])
def test_optional_retry_rejects_invalid_confidence(score):
    class InvalidScoreProvider(SparseLineProvider):
        def __call__(self, image, **options):
            result = super().__call__(image, **options)
            if options.get("use_det") is False:
                result.scores = (score,)
            return result

    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = InvalidScoreProvider()
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)
    assert engine.prepare_page(image, (1000, 100))[0].text == "无·"


def test_broken_full_page_output_is_not_disguised_as_empty_success():
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = lambda *args, **kwargs: SimpleNamespace(txts=("text",))
    with pytest.raises(AttributeError):
        engine.prepare_page(np.zeros((100, 100, 3)), (100, 100))


def test_direction_retry_restores_text_and_next_page_pipeline():
    class DirectionProvider:
        def __init__(self):
            self.options = {}
            self.full_calls = 0

        def __call__(self, image, **options):
            self.options.update(options)
            assert self.options["use_det"] and self.options["use_rec"]
            if self.options["use_cls"]:
                self.full_calls += 1
                return output(
                    text="()……………………半王第",
                    score=0.73,
                    box=((0, 0), (90, 0), (90, 20), (0, 20)),
                )
            return output(
                text="第五章 保险市场引论……………………(77)",
                score=0.81,
                box=((0, 0), (90, 0), (90, 20), (0, 20)),
            )

    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = DirectionProvider()
    for _ in range(3):
        assert engine.prepare_page(np.zeros((100, 100, 3)), (100, 100))[
            0
        ].text.startswith("第五章")
    assert engine._engine.full_calls == 3


@pytest.mark.parametrize(
    "mode", ["exception", "malformed", "bad_cells", "lower", "nan", "different_box"]
)
def test_optional_direction_retry_preserves_baseline_on_untrusted_alternative(mode):
    box = ((0, 0), (90, 0), (90, 20), (0, 20))
    baseline = output(text="标题……………………(3)", score=0.73, box=box)

    def provider(_image, **options):
        if options["use_cls"]:
            return baseline
        if mode == "exception":
            raise RuntimeError("optional comparison failed")
        if mode == "malformed":
            return SimpleNamespace(boxes=(box,), scores=())
        if mode == "bad_cells":
            return output(
                text="正确标题……………………(3)",
                score=0.99,
                box=box,
                word_results=((("字", 0.99, "not-geometry"),),),
            )
        return output(
            text="替代……………………(3)",
            score=float("nan") if mode == "nan" else 0.7 if mode == "lower" else 0.81,
            box=((1, 0), (91, 0), (91, 20), (1, 20))
            if mode == "different_box"
            else box,
        )

    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    for _ in range(3):
        lines = engine.prepare_page(np.zeros((100, 100, 3)), (100, 100))
        assert len(lines) == 1 and lines[0].text == baseline.txts[0]


def output(*, text, score, box, word_results=((),)):
    return SimpleNamespace(
        boxes=(box,),
        txts=(text,),
        scores=(score,),
        word_results=word_results,
    )


class SparseLineProvider:
    def __init__(self):
        self.calls = []

    def __call__(self, image, **options):
        self.calls.append((image.shape, options))
        if options.get("use_det") is False:
            return SimpleNamespace(
                txts=("冯·诺依曼是在研究EDVAC机时提出了存储程序的概念",),
                scores=(0.99,),
                word_results=(None,),
            )
        return output(
            text="无·",
            score=0.54,
            box=((100, 20), (900, 20), (900, 40), (100, 40)),
        )


def test_sparse_low_confidence_long_line_retries_recognition_on_padded_crop():
    provider = SparseLineProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)

    lines = engine.prepare_page(image, (1000, 100))

    assert lines[0].text == "冯·诺依曼是在研究EDVAC机时提出了存储程序的概念"
    assert lines[0].confidence == 0.99
    assert len(lines[0].cells) == len(lines[0].text)
    assert lines[0].cells[0][2:] == (0, 1)
    assert lines[0].cells[-1][2:] == (len(lines[0].text) - 1, len(lines[0].text))
    assert len(provider.calls) == 2
    retry_shape, retry_options = provider.calls[1]
    assert retry_shape[0] > 20
    assert retry_options["use_det"] is False


def test_normal_line_does_not_pay_for_sparse_line_retry():
    text = "计算机的基本结构以存储程序为基础"
    box = ((100, 20), (500, 20), (500, 40), (100, 40))
    units = tuple(
        (
            character,
            0.99,
            (
                (100 + index * 20, 20),
                (120 + index * 20, 20),
                (120 + index * 20, 40),
                (100 + index * 20, 40),
            ),
        )
        for index, character in enumerate(text)
    )

    class NormalProvider:
        def __init__(self):
            self.calls = 0

        def __call__(self, image, **options):
            self.calls += 1
            return output(text=text, score=0.99, box=box, word_results=(units,))

    provider = NormalProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)

    lines = engine.prepare_page(image, (1000, 100))

    assert lines[0].text == text
    assert len(lines[0].cells) == len(text)
    assert provider.calls == 1


def test_failed_quality_retry_keeps_baseline_line_available():
    class FailingRetryProvider(SparseLineProvider):
        def __call__(self, image, **options):
            if options.get("use_det") is False:
                raise RuntimeError("optional recognition retry failed")
            return super().__call__(image, **options)

    provider = FailingRetryProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)

    lines = engine.prepare_page(image, (1000, 100))

    assert lines[0].text == "无·"
    assert lines[0].confidence == 0.54
    assert len(lines[0].cells) == 1


def test_sparse_retry_translates_provider_alignment_to_anonymous_cells():
    retry_text = "冯·诺依曼在研究EDVAC"

    class AlignedRetryProvider(SparseLineProvider):
        def __call__(self, image, **options):
            if options.get("use_det") is False:
                self.calls.append((image.shape, options))
                return SimpleNamespace(
                    txts=(retry_text,),
                    scores=(0.99,),
                    word_results=(
                        SimpleNamespace(
                            words=(retry_text,),
                            word_cols=(
                                tuple(index + 0.5 for index in range(len(retry_text))),
                            ),
                            line_txt_len=len(retry_text),
                        ),
                    ),
                )
            return super().__call__(image, **options)

    provider = AlignedRetryProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)

    lines = engine.prepare_page(image, (1000, 100))

    assert lines[0].text == retry_text
    assert len(lines[0].cells) == len(retry_text)
    assert [cell[2:] for cell in lines[0].cells] == [
        (index, index + 1) for index in range(len(retry_text))
    ]
    assert all(
        current[1] <= following[0]
        for current, following in zip(
            lines[0].cells[:-1], lines[0].cells[1:], strict=True
        )
    )


def test_implausibly_long_quality_retry_is_rejected():
    class ImplausibleRetryProvider(SparseLineProvider):
        def __call__(self, image, **options):
            if options.get("use_det") is False:
                return SimpleNamespace(
                    txts=("存" * 200,),
                    scores=(0.99,),
                    word_results=(None,),
                )
            return super().__call__(image, **options)

    provider = ImplausibleRetryProvider()
    engine = RapidOcrEngine.__new__(RapidOcrEngine)
    engine._engine = provider
    image = np.full((100, 1000, 3), 255, dtype=np.uint8)

    lines = engine.prepare_page(image, (1000, 100))

    assert lines[0].text == "无·"
    assert lines[0].confidence == 0.54
