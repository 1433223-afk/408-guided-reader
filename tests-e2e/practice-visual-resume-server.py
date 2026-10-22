"""Audit Practice model inputs during the real-book smoke, without storing prompts or pixels."""

import base64
import hashlib
import json
import os
from pathlib import Path

from reader_service.agent_runtime import AgentRuntime, ProviderCompletion
from reader_service.__main__ import main


original = AgentRuntime.complete_with_metadata
audit = Path(os.environ["PRACTICE_VISUAL_AUDIT"])


def monitored(self, messages, **kwargs):
    interaction = kwargs.get("interaction_id", "")
    if interaction.startswith(("practice-hint:", "master-practice:")):
        identity = (self.config.provider, kwargs.get("model", self.config.model))
        assert identity in {("deepseek", "deepseek-flash"), ("zhipu", "GLM-5.3-Flash")}
        assert kwargs.get("retain_request_body") is False
        content = messages[-1]["content"]
        assert isinstance(content, list) and content[0]["type"] == "text"
        source = json.loads(content[0]["text"])["source"]
        images = []
        for block in content[1:]:
            assert block["type"] == "image_url"
            data = base64.b64decode(block["image_url"]["url"].split(",", 1)[1], validate=True)
            assert data.startswith(b"\x89PNG\r\n\x1a\n")
            images.append({"sha256": hashlib.sha256(data).hexdigest(),
                           "width": int.from_bytes(data[16:20], "big"),
                           "height": int.from_bytes(data[20:24], "big")})
        with audit.open("a", encoding="utf-8") as output:
            output.write(json.dumps({"kind": "hint" if interaction.startswith("practice-hint:") else "review",
                                     "provider": identity[0], "model": identity[1],
                                     "question": source["question_number"],
                                     "pages": [page["pdf_page_number"] for page in source["pages"]],
                                     "has_answer": "official_answer" in source,
                                     "has_explanation": "official_explanation" in source,
                                     "has_correctness": "last_correct" in source,
                                     "images": images}, ensure_ascii=False) + "\n")
    if os.environ.get('PRACTICE_VISUAL_OFFLINE') == '1':
        assert interaction.startswith(('practice-hint:', 'master-practice:')), 'Unexpected AI call in offline smoke'
        payload = json.loads(messages[-1]['content'][0]['text'])
        step = len(payload.get('previous_hints', []))
        answer = ('先想清题目涉及的基本概念。', '再对照各条件，区分操作的作用。',
                  '最后沿题目给出的数据路径逐步核对。')[min(step, 2)]
        if kwargs.get('stream_callback'):
            kwargs['stream_callback'](answer)
        return ProviderCompletion(answer, 1, None, {'provider': self.config.provider, 'model': self.config.model})
    return original(self, messages, **kwargs)


AgentRuntime.complete_with_metadata = monitored
main()
