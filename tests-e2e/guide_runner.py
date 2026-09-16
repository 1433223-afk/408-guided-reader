"""Opt-in real-provider diagnostics confined to the disposable E2E Library.

Capture the actual allowlisted wire body and returned text, never API keys or headers.
This is test-only; the shipped entry point never retains response bodies.
"""
import json
import sys
import threading
from pathlib import Path

from reader_service.agent_runtime.deepseek import OpenAICompatibleAdapter
from reader_service.__main__ import main

target = Path(sys.argv[sys.argv.index("--data-dir") + 1]) / "guide-calls.jsonl"
original = OpenAICompatibleAdapter.complete
original_stream = OpenAICompatibleAdapter.stream
lock = threading.Lock()


def captured(self, endpoint, api_key, body, timeout):
    response = original(self, endpoint, api_key, body, timeout)
    with lock, target.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"provider": self.provider_name, "body": body,
                                 "answer": response.answer, "diagnostics": response.diagnostics}, ensure_ascii=False) + "\n")
    return response


OpenAICompatibleAdapter.complete = captured


def captured_stream(self, endpoint, api_key, body, timeout, on_delta, on_reasoning_delta=None):
    response = original_stream(self, endpoint, api_key, body, timeout, on_delta, on_reasoning_delta)
    with lock, target.open("a", encoding="utf-8") as output:
        output.write(json.dumps({"provider": self.provider_name, "body": body,
                                 "answer": response.answer, "diagnostics": response.diagnostics}, ensure_ascii=False) + "\n")
    return response


OpenAICompatibleAdapter.stream = captured_stream
main()
