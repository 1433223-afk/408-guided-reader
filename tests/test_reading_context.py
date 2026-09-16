from types import SimpleNamespace

from reader_service.outline.service import OutlineService


def context(nodes, page, y):
    owner = SimpleNamespace(repository=SimpleNamespace(list=lambda revision: nodes))
    return OutlineService.reading_context(owner, 'revision', page, y)


def section(identity, start, end, state='RESOLVED'):
    return dict(outline_node_id=identity, kind='SECTION', start_page=start[0],
                start_y=start[1], end_page=end[0], end_y=end[1], resolution_state=state)


def test_reading_anchor_distinguishes_same_page_sections_without_writing_state():
    nodes = [section('a', (2, .1), (2, .5)), section('b', (2, .5), (3, .1))]
    assert context(nodes, 2, .49)['section']['outline_node_id'] == 'a'
    assert context(nodes, 2, .5)['section']['outline_node_id'] == 'b'
    assert context(nodes, 3, .1)['section'] is None


def test_unresolved_and_ambiguous_ranges_never_manufacture_a_section():
    assert context([section('a', (2, .1), (2, .8), 'PARTIAL')], 2, .3)['section'] is None
    assert context([section('a', (2, .1), (2, .8)), section('b', (2, .2), (2, .7))], 2, .3)['section'] is None
    assert context([], 2, .3) == dict(chapter=None, section=None, subsection=None)
