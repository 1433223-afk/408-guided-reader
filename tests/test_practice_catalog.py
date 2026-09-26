"""Automatic Practice source uses OCR geometry and a single answer authority."""

import json
from types import SimpleNamespace

import pytest

from reader_service.library.database import Database
from reader_service.practice_catalog import _separate_options, build_catalog, public_sections
from reader_service.practice_prototype import PracticePrototype, SOURCE_SHA256
from reader_service.practice_review import PracticeReviewService


def _line(connection, page, ordinal, text, y):
    left = .18
    step = .012
    cells = [[left + index * step, left + (index + 1) * step, index, index + 1]
             for index in range(len(text))]
    quad = [[left, y], [left + len(text) * step, y],
            [left + len(text) * step, y + .016], [left, y + .016]]
    connection.execute(
        """INSERT INTO ocr_lines(book_source_revision_id,pdf_page_index,line_ordinal,
           quad_json,text,confidence,cells_json) VALUES ('revision',?,?,?,?,1,?)""",
        (page, ordinal, json.dumps(quad), text, json.dumps(cells)),
    )


def _source(database, *, missing_d=False):
    with database.connect() as connection:
        connection.execute("INSERT INTO books(id,title,status,created_at) VALUES ('book','王道','ACTIVE','now')")
        connection.execute(
            """INSERT INTO book_source_revisions
               (id,book_id,blob_sha256,byte_size,page_count,page_geometry_json,label,status,created_at)
               VALUES ('revision','book',?,1,4,'[]','sample','ACTIVE','now')""",
            (SOURCE_SHA256,),
        )
        for page in range(4):
            connection.execute(
                """INSERT INTO ocr_pages(book_source_revision_id,pdf_page_index,status,
                   route,foundation_version) VALUES ('revision',?,'READY','OCR',1)""", (page,))
        for node_id, parent, kind, title, page, order in (
            ('section', None, 'SECTION', '8.1 示例', 0, 0),
            ('exercise', 'section', 'EXERCISES', '8.1.1 本节习题精选', 0, 0),
            ('answers', 'section', 'ANSWERS', '8.1.2 答案与解析', 2, 1),
            ('next', None, 'SECTION', '8.2 下一节', 3, 1),
        ):
            connection.execute(
                """INSERT INTO outline_nodes(outline_node_id,book_source_revision_id,
                   parent_id,depth,order_index,kind,title,start_page,resolution_state,
                   confidence,evidence_json) VALUES (?,'revision',?,?,?,?,? ,?,'PARTIAL',1,'{}')""",
                (node_id, parent, 1 if parent else 0, order, kind, title, page),
            )
        _line(connection, 0, 0, '8.1.1 本节习题精选 无关水印', .20)
        _line(connection, 0, 1, '01. 哪项正确？', .26)
        _line(connection, 0, 2, 'A. 甲 B. 乙', .30)
        _line(connection, 0, 3, '乙的续行', .33)
        _line(connection, 1, 0, 'C. 丙', .12)
        if not missing_d:
            _line(connection, 1, 1, 'D. 丁', .15)
        _line(connection, 2, 0, '8.1.2 答案与解析', .20)
        _line(connection, 2, 1, '01. A', .26)
        _line(connection, 2, 2, '甲符合条件。', .30)
        _line(connection, 3, 0, '8.2 下一节', .20)


def test_cross_page_catalog_is_generated_and_keeps_answer_out_of_solve_ui(tmp_path):
    database = Database(tmp_path / 'state.sqlite3')
    database.initialize()
    _source(database)
    with database.connect() as connection:
        sections = build_catalog(connection, 'revision', SOURCE_SHA256)
    assert len(sections) == 1 and len(sections[0]['questions']) == 1
    assert sections[0]['entryLeft'] < .4, 'entry must follow the heading, not merged OCR text'
    assert sections[0]['entryBottom'] > sections[0]['entryTop']
    question = sections[0]['questions'][0]
    assert question['answer'] == 'A'
    assert [region['page'] for region in question['regions']] == [0, 1]
    assert [[option['choice'] for option in region['options']] for region in question['regions']] == [
        ['A', 'B'], ['C', 'D']]
    a, b = question['regions'][0]['options']
    assert a['rect'][2] < b['rect'][0], 'merged OCR line must yield separate hit areas'
    assert question['options_text']['B'] == '乙 乙的续行'
    public_question = public_sections(sections)[0]['questions'][0]
    assert 'answer' not in public_question and 'explanation' not in public_question
    practice = PracticePrototype(database)
    assert practice.attempt('revision', question['number'], 'A')['last_correct'] is True
    practice.set_favorite('revision', question['number'], True)
    favorite = practice.list_favorites()[0]
    assert favorite['source']['label'] == 1 and favorite['source']['pdf_page_index'] == 0
    review = PracticeReviewService(practice, SimpleNamespace())
    solve = review.question_source('revision', question['number'])
    assert [page['pdf_page_number'] for page in solve['pages']] == [1, 2]
    assert 'official_answer' not in solve
    source = review.source('revision', question['number'])
    assert source['official_answer'] == 'A' and source['official_explanation'] == '甲符合条件。'


def test_incomplete_option_group_is_not_published_or_scoreable(tmp_path):
    database = Database(tmp_path / 'state.sqlite3')
    database.initialize()
    _source(database, missing_d=True)
    practice = PracticePrototype(database)
    assert practice.public_catalog('revision') == []
    with pytest.raises(ValueError, match='尚未通过来源核对'):
        practice.attempt('revision', 1000001, 'A')


def test_ocr_row_overlap_does_not_create_ambiguous_choice_hit_areas():
    options = [
        {'choice': 'A', 'rect': [.19, .56, .40, .591]},
        {'choice': 'C', 'rect': [.19, .588, .40, .61]},
    ]
    assert _separate_options(options)
    assert options[0]['rect'][3] < options[1]['rect'][1]
