"""Local UI fixture: actual Beta application, only provider transport replaced."""
import _thread
import sys
import threading

from reader_service.agent_runtime.runtime import ProviderFailure, ProviderFailureKind, ProviderResponse
import reader_service.agent_runtime.deepseek as transport


class FixtureAdapter:
    provider_name = "deepseek"

    def __init__(self, *args, **kwargs):
        pass

    def complete(self, endpoint, key, body, timeout):
        assert endpoint == "https://api.deepseek.com/chat/completions"
        assert body["model"] == "deepseek-flash"
        if key == "fixture-invalid-key":
            raise ProviderFailure(ProviderFailureKind.USER_ACTIONABLE, "auth", "fixture rejection")
        return ProviderResponse("本地 Beta 测试回答。")

    def stream(self, endpoint, key, body, timeout, on_delta, on_reasoning_delta=None):
        result = self.complete(endpoint, key, body, timeout)
        on_delta(result.answer)
        return result


transport.OpenAICompatibleAdapter = FixtureAdapter
import reader_service.__main__ as app

original_server = app.ReaderServer


def fixture_server(*args, **kwargs):
    server = original_server(*args, **kwargs)
    print(f"FIXTURE_PORT {server.server_port}", flush=True)
    return server


app.ReaderServer = fixture_server


def stop_on_input():
    sys.stdin.readline()
    _thread.interrupt_main()


threading.Thread(target=stop_on_input, daemon=True).start()
app.main()
