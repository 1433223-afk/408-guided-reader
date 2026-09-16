import test from "node:test";
import assert from "node:assert/strict";

import { streamAssistantResponse } from "../src/reader_service/static/assistant-stream.js";

function fragmentedResponse(parts, status = 200, contentType = "text/event-stream") {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), { status, headers: { "Content-Type": contentType } });
}

test("Assistant SSE parser preserves fragmented UTF-8 deltas and completion metrics", async () => {
  const events = [];
  const response = fragmentedResponse([
    'data: {"type":"stage","stage":"preparing"}\n\n',
    'data: {"type":"stage","stage":"answering"}\n\n',
    'data: {"type":"delta","content":"地',
    '址"}\n\ndata: {"type":"delta","content":"码"}\n\n',
    'data: {"type":"complete","assistant":{"roots":[]},',
    '"metrics":{"ttft_ms":321,"total_latency_ms":654,"output_tokens":12}}\n\n',
  ]);
  await streamAssistantResponse("/assistant", {}, (event) => events.push(event), async () => response);
  assert.deepEqual(events.map((event) => event.type), ["stage", "stage", "delta", "delta", "complete"]);
  assert.equal(events.filter((event) => event.type === "delta").map((event) => event.content).join(""), "地址码");
  assert.deepEqual(events.at(-1).metrics, { ttft_ms: 321, total_latency_ms: 654, output_tokens: 12 });
});

test("Assistant SSE error remains explicit after visible partial content", async () => {
  const events = [];
  const response = fragmentedResponse([
    'data: {"type":"delta","content":"已收到"}\n\n',
    'data: {"type":"error","code":"AI_TRANSIENT","error":"连接中断",',
    '"metrics":{"ttft_ms":100,"latency_ms":240}}\n\n',
  ]);
  await assert.rejects(
    streamAssistantResponse("/assistant", {}, (event) => events.push(event), async () => response),
    (error) => error.code === "AI_TRANSIENT" && error.message === "连接中断",
  );
  assert.equal(events[0].content, "已收到");
});

test("Assistant SSE EOF without a terminal event is a recoverable interruption", async () => {
  const response = fragmentedResponse(['data: {"type":"delta","content":"部分"}\n\n']);
  await assert.rejects(
    streamAssistantResponse("/assistant", {}, () => {}, async () => response),
    (error) => error.code === "ASSISTANT_STREAM_INTERRUPTED",
  );
});
