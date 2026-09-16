from concurrent.futures import ThreadPoolExecutor
from reader_service.learning import reading
from reader_service.library.database import Database
from test_knowledge_map import build_fixture
import pytest


def test_end_observation_before_kp_is_idempotent_and_never_writes_mastery(service):
    f = build_fixture(service)
    rev = f['revision']['id']
    f['outline'].resolve_chapter_physical(rev, f['chapter']['outline_node_id'])
    initial = reading.snapshot(service.database, rev)
    target = initial['sections'][0]
    with service.database.connect() as c:
        tables = ('kp_status','learning_events','master_threads','master_topics','master_messages','section_learning_states','chapter_preparations')
        before = {t: [tuple(r) for r in c.execute('select * from '+t)] for t in tables}
    # A jump past the boundary does not backfill earlier sections.
    assert all(not s['reading_reached_end_at'] for s in reading.observe(service.database,rev,5,0,1)['sections'])
    with ThreadPoolExecutor(max_workers=4) as pool:
        values = list(pool.map(lambda _: reading.observe(service.database,rev,target['pdf_page_index'],target['y'],target['y']), range(6)))
    stamps = [next(s for s in value['sections'] if s['outline_node_id']==target['outline_node_id'])['reading_reached_end_at'] for value in values]
    assert stamps[0] and len(set(stamps)) == 1
    restarted = Database(service.database.path)
    assert reading.snapshot(restarted,rev) == values[0]
    with service.database.connect() as c:
        assert before == {t:[tuple(r) for r in c.execute('select * from '+t)] for t in tables}
    for page, top, bottom in [(-1,0,1),(999,0,1),(0,.9,.1),(0,float('nan'),1)]:
        with pytest.raises(ValueError): reading.observe(service.database,rev,page,top,bottom)
    service.delete_book(f['book']['id'])
    with service.database.connect() as c:
        assert c.execute('select count(*) from section_reading_progress').fetchone()[0] == 0
