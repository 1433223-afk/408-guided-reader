"""Real-provider visual smoke launcher; records image facts, never image bytes or prompts."""

import base64
import hashlib
import json
import os
import threading
import time
from pathlib import Path

from reader_service.agent_runtime import AgentRuntime
from reader_service.__main__ import main


original = AgentRuntime.complete_with_metadata
audit = Path(os.environ["VISUAL_REGION_CALL_AUDIT"])
lock = threading.Lock()


def record(value):
    with lock, audit.open("a", encoding="utf-8") as output:
        output.write(json.dumps(value, ensure_ascii=False) + "\n")


def monitored(self, messages, **kwargs):
    identity = (self.config.provider, kwargs.get("model", self.config.model))
    assert identity in {("deepseek", "deepseek-flash"), ("zhipu", "GLM-5.3-Flash")}, identity
    assert kwargs.get("retain_request_body") is False, "visual payload retention must be disabled"
    images = []
    for message in messages:
        if not isinstance(message.get("content"), list):
            continue
        for block in message["content"]:
            if block.get("type") != "image_url":
                continue
            assert message["role"] == "user"
            url = block["image_url"]["url"]
            assert url.startswith("data:image/png;base64,")
            image = base64.b64decode(url.split(",", 1)[1], validate=True)
            assert image[:8] == b"\x89PNG\r\n\x1a\n"
            images.append({"bytes": len(image), "sha256": hashlib.sha256(image).hexdigest(),
                           "width": int.from_bytes(image[16:20], "big"),
                           "height": int.from_bytes(image[20:24], "big")})
    assert len(images) == 1, "one actual crop must reach the model"
    record({"event": "request", "provider": identity[0], "model": identity[1],
            "image_count": len(images), "images": images,
            "stream": bool(kwargs.get("stream_callback"))})
    observer = kwargs.get("attempt_observer")

    def observe(event):
        record({"event": "transport", **{key: event[key] for key in
                ("status", "transport_attempt", "latency_ms", "failure_kind", "failure_code") if key in event}})
        if observer:
            observer(event)

    kwargs["attempt_observer"] = observe
    started = time.monotonic()
    try:
        result = original(self, messages, **kwargs)
    except Exception as exc:
        record({"event": "failure", "type": type(exc).__name__, "code": getattr(exc, "code", None),
                "seconds": round(time.monotonic() - started, 2)})
        raise
    record({"event": "complete", "seconds": round(time.monotonic() - started, 2)})
    return result


AgentRuntime.complete_with_metadata = monitored
main()
