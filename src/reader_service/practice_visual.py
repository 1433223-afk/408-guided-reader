"""Small, bounded original-PDF crops for visually significant Practice questions."""

from __future__ import annotations

import re

from reader_service.visual_region import render_visual_region


VISUAL_CUE = re.compile(r"下图|如图|图中|图所示|图\s*\d|如下表|(?<!以)下表|表\s*\d|表所示|所示|公式|[×÷√∑∫≈≠≤≥²³⁴⁵⁶⁷⁸⁹μ]|\d\s*(?:%|MHz|GHz|ns|ms)")


def needs_question_visual(question: dict) -> bool:
    return (len(question["sourceRegions"]) > 1
            or bool(VISUAL_CUE.search(question["question_ocr"])))


def question_crop_rects(question: dict) -> list[tuple[int, list[float]]]:
    """Cover the complete Exercise, including diagrams after its options."""
    option_regions = {region["page"]: region["options"] for region in question["regions"]}
    first = question["page"]
    regions = sorted(question["sourceRegions"], key=lambda region: region["page"])
    crops = []
    for index, region in enumerate(regions):
        page = region["page"]
        options = option_regions.get(page, ())
        top = min(question["promptY"], region["top"]) if page == first else region["top"]
        # A prompt may begin at the foot of one page while every option starts
        # on the next. Retain that first page's question text.
        bottom = max(region["bottom"], *(option["rect"][3] for option in options)) if options else region["bottom"]
        if index < len(regions) - 1:
            bottom = .95
        crops.append((page, [.10, max(.06, top - .003), .90, min(.95, bottom + .002)]))
    return crops


def question_visuals(library, revision_id: str, question: dict | None) -> list[dict]:
    if question is None:
        return []
    crops = question_crop_rects(question)
    if not needs_question_visual(question):
        return []
    return [render_visual_region(library, revision_id, page, rect) for page, rect in crops]


def with_question_visuals(text: str, visuals: list[dict]) -> str | list[dict]:
    if not visuals:
        return text
    return [{"type": "text", "text": text}, *(
        {"type": "image_url", "image_url": {"url": visual["image"]["data_url"]}}
        for visual in visuals
    )]
