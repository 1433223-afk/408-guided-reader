"""Validation launcher: audit the final model route without recording source or credentials."""
import json
import os
import time
from pathlib import Path

from reader_service.agent_runtime import ProviderRuntimeSet
from reader_service.__main__ import main

original = ProviderRuntimeSet.complete_for_with_metadata
audit = Path(os.environ['PRACTICE_KNOWLEDGE_CALL_AUDIT'])


def monitored(self, provider, messages, **kwargs):
    identity = self.provider_identity(provider)
    interaction = kwargs.get('interaction_id', '')
    assert identity == ('deepseek', 'deepseek-flash'), identity
    assert interaction.startswith('practice-knowledge:'), interaction.split(':')[0]
    payload = json.loads(messages[-1]['content'])
    assert 'official_answer' not in payload and 'official_explanation' not in payload
    row = {'event': 'request', 'provider': identity[0], 'model': identity[1],
           'question_count': len(payload['exercises']), 'candidate_count': len(payload['candidates'])}
    with audit.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(row) + '\n')
    def observe(event):
        # Whitelist small diagnostics; never persist provider payloads or error bodies.
        safe = {key: event[key] for key in ('status', 'transport_attempt', 'latency_ms',
                                            'failure_kind', 'failure_code') if key in event}
        with audit.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'event': 'transport', **safe}) + '\n')
    kwargs['attempt_observer'] = observe
    start = time.monotonic()
    try:
        result = original(self, provider, messages, **kwargs)
    except Exception as exc:
        with audit.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'event': 'failure', 'type': type(exc).__name__,
                                     'code': getattr(exc, 'code', None),
                                     'seconds': round(time.monotonic() - start, 2)}) + '\n')
        raise
    with audit.open('a', encoding='utf-8') as stream:
        stream.write(json.dumps({'event': 'complete', 'seconds': round(time.monotonic() - start, 2)}) + '\n')
    return result


ProviderRuntimeSet.complete_for_with_metadata = monitored
main()
