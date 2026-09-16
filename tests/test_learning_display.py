import json
import sqlite3

from reader_service.learning.display import add_display_ends


def test_display_ends_exclude_furniture_but_keep_body_and_source():
    c = sqlite3.connect(':memory:')
    c.row_factory = sqlite3.Row
    c.executescript('''
        CREATE TABLE ocr_pages(book_source_revision_id, pdf_page_index, status);
        CREATE TABLE ocr_lines(book_source_revision_id, pdf_page_index, text, quad_json);
        CREATE TABLE page_labels(book_source_revision_id, pdf_page_index, printed_label);
    ''')
    for page in range(4):
        c.execute('INSERT INTO ocr_pages VALUES (?, ?, ?)', ('book', page, 'READY'))
        c.execute('INSERT INTO page_labels VALUES (?, ?, ?)', ('book', page, str(page + 1)))
    def line(page, low, high, text, revision='book'):
        c.execute('INSERT INTO ocr_lines VALUES (?, ?, ?, ?)',
                  (revision, page, text, json.dumps([[.1, low], [.8, low], [.8, high], [.1, high]])))
    for page in (0, 1):
        line(page, .06, .08, '教材页眉')
        line(page, .06, .08, str(page + 1))
        line(page, .94, .96, '重复页脚')
        line(page, .4, .45, '重复正文仍是正文')
    line(0, .8, .85, '前页实际正文末尾')
    line(1, .12, .15, '真正的跨页续文')
    line(2, .02, .04, '唯一的页顶正文')
    # Furniture from another Book must not classify this unique body as repeated.
    c.execute('INSERT INTO ocr_pages VALUES (?, ?, ?)', ('other', 0, 'READY'))
    line(0, .02, .04, '唯一的页顶正文', revision='other')
    points = [dict(start_page=a, start_y=b, end_page=d, end_y=e)
              for a, b, d, e in [(0, .5, 1, .08), (0, .5, 1, .2),
                                (1, .3, 1, .97), (2, 0, 2, .05), (3, .2, 3, .4)]]
    original = [dict(point) for point in points]
    writes = c.total_changes
    add_display_ends(c, 'book', points)
    assert [(p['display_end_page'], p['display_end_y']) for p in points] == [
        (0, .85), (1, .15), (1, .45), (2, .04), (3, .4)]
    assert [{k: p[k] for k in old} for p, old in zip(points, original)] == original
    assert c.total_changes == writes
    add_display_ends(c, 'book', [])
