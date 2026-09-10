import pytest

from reader_service.learning.service import LearningService


SOURCE = {'pages': [
    {'pdf_page_number': 1, 'ocr_text': '图 1-2 为教材示意图。图 1-3(a) 为细节。'},
    {'pdf_page_number': 2, 'ocr_text': 'Figure 2.1. 正文。'},
]}


@pytest.mark.parametrize('answer', [
    'PDF 第 999 页', 'PDF p. 999', 'PDF page 999', 'PDF 999',
    'PDF pp. 1–999', 'PDF 第 1 至 999 页', 'PDF pages 1, 999',
    '**PDF** p. **999**', 'ＰＤＦ ｐ．９９９',
    'PDF page: 999', '图号：999-9', 'Figure: 999-9',
    '教材PDF p. 999', '见PDF第999页', '见Figure 999-9',
    '教材图 999-9', 'Figure 999-9', 'Fig. 999.9',
    '图 1-2、999-9', 'Figures 1-2 and 999-9',
    '图 1-3(b)', '补充解释：教材图 999-9 说明了这个性质。',
])
def test_reject_unsupported_page_and_figure_references(answer):
    with pytest.raises(ValueError):
        LearningService.grounding(answer, SOURCE)


@pytest.mark.parametrize('answer', [
    'PDF 第 1 页', 'PDF p. 1', 'PDF pages 1–2', 'PDF pp. 1, 2',
    'PDF 第 1 至 2 页', '**PDF** p. **1**',
    '教材PDF p. 1', '见PDF第1页', '见Figure 1-2',
    '图1-2', 'Fig. 1-2', '图 1–2', '图 1-3(a)', 'Figure 2.1',
    '图 1-2 和 1-3(a)', '数值 999 不等于 9；补充解释：可以用一个生活例子理解。',
])
def test_allow_supported_references_and_non_reference_prose(answer):
    LearningService.grounding(answer, SOURCE)


def test_page_interval_checks_interior_and_reversed_range():
    source = {'pages': [{'pdf_page_number': n, 'ocr_text': '正文'} for n in (1, 3)]}
    for answer in ('PDF pp. 1-3', 'PDF pp. 3-1', 'PDF pp. 1-999999999999'):
        with pytest.raises(ValueError):
            LearningService.grounding(answer, source)
