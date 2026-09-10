"""Read-only learning-control positions; never replace published source ranges."""

import json
from collections import defaultdict


def add_display_ends(connection, revision_id, points):
    if not points:
        return
    first = max(0, min(p['start_page'] for p in points) - 1)
    last = max(p['end_page'] for p in points) + 1
    lines = defaultdict(list)
    repeated = defaultdict(set)
    for row in connection.execute('''
        SELECT l.pdf_page_index, l.text, l.quad_json, labels.printed_label
        FROM ocr_lines l JOIN ocr_pages p
          USING(book_source_revision_id, pdf_page_index)
        LEFT JOIN page_labels labels USING(book_source_revision_id, pdf_page_index)
        WHERE l.book_source_revision_id = ? AND p.status = 'READY'
          AND l.pdf_page_index BETWEEN ? AND ?
    ''', (revision_id, first, last)):
        ys = [corner[1] for corner in json.loads(row['quad_json'])]
        low, high = min(ys), max(ys)
        text = ''.join(row['text'].split())
        if not text:
            continue
        # Only repeated text in the narrow margins is treated as running furniture.
        # A unique body line near the top of a page is not discarded by its y alone.
        side = 'top' if high <= .10 else 'bottom' if low >= .90 else None
        key = (side, text)
        if side:
            repeated[key].add(row['pdf_page_index'])
        page_number = bool(side and text == row['printed_label'])
        lines[row['pdf_page_index']].append((low, high, key, page_number))

    for point in points:
        end = (point['end_page'], point['end_y'])
        start = (point['start_page'], point['start_y'])
        found = None
        for page in range(point['end_page'], point['start_page'] - 1, -1):
            candidates = [min(high, point['end_y']) if page == point['end_page'] else high
                          for low, high, key, page_number in lines[page]
                          if start <= (page, (low + high) / 2) < end
                          and not page_number
                          and not (key[0] and len(repeated[key]) > 1)]
            if candidates:
                found = (page, max(candidates))
                break
        # Missing usable OCR is not permission to invent another source position.
        point['display_end_page'], point['display_end_y'] = found or end
