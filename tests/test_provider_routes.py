"""Default product roles remain usable with either approved credential."""
import pytest

from reader_service.knowledge import KnowledgeService
from reader_service.learning.service import LearningService
from reader_service.teaching.service import TeachingService
from test_ask_about_this import runtime_set
from test_knowledge_map import build_fixture


ROUTE_ENV = ("GUIDED_READER_MASTER_PROVIDER", "GUIDED_READER_REVIEW_PROVIDER",
             "GUIDED_READER_GUIDE_PROVIDER", "GUIDED_READER_SYSTEM_PROVIDER",
             "GUIDED_READER_KP_GENERATOR_PROVIDER", "GUIDED_READER_KP_REVIEW_PROVIDER")


@pytest.mark.parametrize("configured,generator,reviewer", [
    ((), "deepseek", "deepseek"), (("deepseek",), "deepseek", "deepseek"),
    (("zhipu",), "zhipu", "zhipu"), (("deepseek", "zhipu"), "deepseek", "zhipu"),
])
def test_default_routes_cover_approved_credential_modes(service, monkeypatch, configured, generator, reviewer):
    for key in ROUTE_ENV: monkeypatch.delenv(key, raising=False)
    runtime, adapters = runtime_set(bakeoff_enabled=False, keys={
        name: "fixture-key" if name in configured else None for name in ("deepseek", "zhipu", "openrouter")})
    fixture = build_fixture(service)
    kp = KnowledgeService(service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime)
    master = LearningService(service.database, fixture["foundation"], runtime)
    guide = TeachingService(service.database, runtime)
    assert runtime.status()["active_provider"] == generator
    assert master.status()["answer_provider"] == generator
    assert master.status()["review_provider"] == reviewer
    assert (kp.generator_provider, kp.reviewer_provider) == (generator, generator)
    for owner in (guide, guide.inline):
        assert owner._role_provider(True) == generator
        assert owner._role_provider(False) == reviewer
    assert all(not adapter.calls for adapter in adapters.values())


def test_credential_changes_refresh_defaults_but_preserve_explicit_routes(service, monkeypatch):
    for key in ROUTE_ENV: monkeypatch.delenv(key, raising=False)
    keys = {"deepseek": "fixture", "zhipu": None, "openrouter": None}
    runtime, _ = runtime_set(bakeoff_enabled=False, keys=keys)
    fixture = build_fixture(service)
    kp = KnowledgeService(service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime)
    master = LearningService(service.database, fixture["foundation"], runtime)
    guide = TeachingService(service.database, runtime)
    fixed = KnowledgeService(service, fixture["foundation"], fixture["outline"], fixture["repository"], runtime,
                             generator_provider="deepseek", reviewer_provider="deepseek")
    keys.update(deepseek=None, zhipu="fixture")
    kp.refresh_provider_routes(); fixed.refresh_provider_routes()
    assert master.status()["answer_provider"] == "zhipu"
    assert runtime.status()["active_provider"] == "zhipu"
    assert (kp.generator_provider, kp.reviewer_provider) == ("zhipu", "zhipu")
    assert (fixed.generator_provider, fixed.reviewer_provider) == ("deepseek", "deepseek")
    assert guide._role_provider(True) == guide.inline._role_provider(False) == "zhipu"
