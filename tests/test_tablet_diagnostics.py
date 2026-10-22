import json

from reader_service.tablet_diagnostics import tablet_request_diagnostic
from test_tablet_lan import lan_get, lan_request_server


def test_diagnostic_replaces_ids_queries_credentials_and_untrusted_methods():
    record = tablet_request_diagnostic("GET", "/api/revisions/secret-book/overlay?token=secret-token&text=secret-body", 200, 14.4)
    assert record == {"method": "GET", "route": "/api/revisions/:id/overlay", "status": 200, "elapsed_ms": 14}
    assert "secret" not in json.dumps(record)
    assert tablet_request_diagnostic("secret-method", "http://secret:secret@host/api/books/secret?token=secret", 401, 3)["method"] == "OTHER"
    assert tablet_request_diagnostic("GET", "/" + "/".join(["secret"] * 100), None, 999999)["elapsed_ms"] == 600000


def test_tablet_access_log_keeps_only_method_route_status_and_duration(service, capsys):
    with lan_request_server(service) as (port, host):
        status, _, _ = lan_get(port, host, "/api/books?token=secret-query", {"X-Reader-Token": "test-tablet-token"})
        assert status == 200
        assert lan_get(port, host, "/api/revisions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/overlay?text=secret-body")[0] == 401
    output = capsys.readouterr().out
    records = [json.loads(line.removeprefix("TABLET_HTTP ")) for line in output.splitlines() if line.startswith("TABLET_HTTP ")]
    assert [record["status"] for record in records] == [200, 401]
    assert records[1]["route"] == "/api/revisions/:id/overlay"
    assert all(set(record) == {"method", "route", "status", "elapsed_ms"} for record in records)
    assert "secret" not in output and "test-tablet-token" not in output
