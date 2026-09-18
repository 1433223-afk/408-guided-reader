from __future__ import annotations

from types import SimpleNamespace

import numpy as np

from reader_service.foundation.rapidocr_adapter import RapidOcrEngine


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
        (character, 0.99, ((100 + index * 20, 20), (120 + index * 20, 20),
                           (120 + index * 20, 40), (100 + index * 20, 40)))
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
                    word_results=(SimpleNamespace(
                        words=(retry_text,),
                        word_cols=(tuple(index + 0.5 for index in range(len(retry_text))),),
                        line_txt_len=len(retry_text),
                    ),),
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
        for current, following in zip(lines[0].cells[:-1], lines[0].cells[1:], strict=True)
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
