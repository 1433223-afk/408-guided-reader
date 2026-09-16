export async function streamAssistantResponse(
  path, options, onEvent, fetchImpl = fetch,
  { label = "Assistant", codePrefix = "ASSISTANT" } = {},
) {
  const response = await fetchImpl(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: `请求失败（${response.status}）` }));
    throw streamError(payload.error || `请求失败（${response.status}）`, payload.code, response.status);
  }
  if (!String(response.headers.get("Content-Type") || "").toLowerCase().includes("text/event-stream")) {
    throw streamError(`${label} 没有返回真实流式响应，请重试。`, `${codePrefix}_STREAM_PROTOCOL`);
  }
  if (!response.body) {
    throw streamError(`${label} 流式响应不可读取，请重试。`, `${codePrefix}_STREAM_UNREADABLE`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines = [];
  let terminal = false;

  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    let event;
    try {
      event = JSON.parse(raw);
    } catch (_error) {
      throw streamError(`${label} 返回了无法读取的流式事件，请重试。`, `${codePrefix}_STREAM_PROTOCOL`);
    }
    onEvent(event);
    if (event.type === "complete") terminal = true;
    if (event.type === "error") {
      terminal = true;
      const error = streamError(event.error || "AI 解释失败，请稍后再试。", event.code);
      error.metrics = event.metrics || null;
      throw error;
    }
  };

  const consumeLine = (line) => {
    line = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") dataLines.push(value);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      consumeLine(line);
    }
    if (done) break;
  }
  if (buffer) consumeLine(buffer);
  dispatch();
  if (!terminal) {
    throw streamError("流式回答意外中断；已保留问题，可以重试。", `${codePrefix}_STREAM_INTERRUPTED`);
  }
}

function streamError(message, code = "ASSISTANT_STREAM_FAILED", status = 0) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
