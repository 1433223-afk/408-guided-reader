import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || "", "408 Guided Reader");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-ask-"));
const dataDir = path.join(acceptanceRoot, "data");
const artifacts = path.resolve("test-results");
await mkdir(artifacts, { recursive: true });
await cp(sourceDataDir, dataDir, { recursive: true });
const providerCalls = [];
const mockProvider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerCalls.push({ method: request.method, url: request.url, headers: request.headers, body });
  const latest = body.messages.at(-1)?.content || "";
  const answer = latest.includes("为什么")
    ? "因为总线事务需要让多个部件按约定完成一次可靠的数据交换。"
    : "一次总线事务，就是多个部件按约定完成地址、数据与控制的一次完整交换。";
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
  }));
});
await new Promise((resolve) => mockProvider.listen(0, "127.0.0.1", resolve));
const providerEndpoint = `http://127.0.0.1:${mockProvider.address().port}/chat/completions`;

let running = await startService({
  GUIDED_READER_DEEPSEEK_API_KEY: "mock-secret-never-inspect",
  GUIDED_READER_DEEPSEEK_ENDPOINT: providerEndpoint,
  GUIDED_READER_ZHIPU_API_KEY: "mock-zhipu-secret-never-inspect",
  GUIDED_READER_ZHIPU_ENDPOINT: providerEndpoint,
  GUIDED_READER_OPENROUTER_API_KEY: "mock-openrouter-secret-never-inspect",
  GUIDED_READER_OPENROUTER_ENDPOINT: providerEndpoint,
  GUIDED_READER_PROVIDER_BAKEOFF: "1",
});
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  const servedAsset = await page.evaluate(async () => {
    const response = await fetch("/app.js", { cache: "reload" });
    return { cacheControl: response.headers.get("cache-control"), body: await response.text() };
  });
  assert.equal(servedAsset.cacheControl, "no-store");
  assert.ok(servedAsset.body.includes("function stageAssistantSelection()"),
    "running service served stale Assistant JavaScript");

  await openBook(page, 348);
  const readyStatus = await json(page, "/api/assistant/status");
  assert.equal(readyStatus.configured, true);
  assert.equal(readyStatus.credential_available, true);
  assert.equal(readyStatus.configuration_valid, true);
  assert.equal(readyStatus.endpoint_valid, true);
  assert.equal(readyStatus.model_valid, true);
  assert.equal(readyStatus.cooling, false);
  assert.equal(readyStatus.ai_off_reason, null);
  assert.equal(readyStatus.bakeoff_enabled, true);
  assert.deepEqual(readyStatus.providers.map((provider) => provider.model), [
    "deepseek-v4-pro", "GLM-5.3-Flash", "google/gemini-3.8-flash",
  ]);
  assert.ok(!JSON.stringify(readyStatus).includes("mock-secret-never-inspect"));
  assert.equal(await page.locator("#compare-selection").count(), 0,
    "dev bake-off control must not occupy the Reader selection menu");
  assert.equal(await page.locator(".bakeoff-card").count(), 0,
    "dev bake-off cards must not exist in the normal Assistant UI");
  assert.equal(await page.locator("#ask-selection").isDisabled(), true,
    "Ask must remain unavailable without a selection");
  const selected = await selectLine(page, 302);
  const selectionMenuBox = await page.locator("#selection-actions").boundingBox();
  assert.ok(selectionMenuBox.width < 390,
    `selection actions expanded into a Reader-blocking overlay (${selectionMenuBox.width}px)`);
  assert.ok((await page.evaluate(() => window.getSelection()?.toString().trim().length || 0)) > 0,
    "right-click did not preserve the Reader text selection");
  assert.equal(await page.locator("#ask-selection").isEnabled(), true,
    "configured Ask was not enabled for a valid selection");
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-panel").waitFor({ state: "visible" });
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  assert.equal(providerCalls.length, 0,
    "opening Ask sent the first provider request before model selection");
  assert.equal(await page.locator("#assistant-model").isEnabled(), true,
    "model selector was locked before the first request");
  await page.locator("#assistant-model").selectOption("openrouter");
  await page.locator("#assistant-model").selectOption("deepseek");
  await page.locator("#assistant-model").selectOption("zhipu");
  assert.equal(providerCalls.length, 0, "changing the draft model caused provider egress");
  await page.screenshot({ path: path.join(artifacts, "ask-about-this-draft.png"), fullPage: false });
  const askResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  const askedHttp = await askResponse;
  assert.equal(askedHttp.status(), 200);
  const asked = await askedHttp.json();
  const askRequest = askedHttp.request().postDataJSON();
  await page.locator(".assistant-answer-bubble").getByText("一次总线事务", { exact: false }).waitFor();
  assert.equal(asked.conversation.scope.kind, "PAGE");
  assert.equal(asked.conversation.scope.key, "PAGE:302");
  assert.equal(asked.conversation.scope.section_title, null);
  assert.equal(asked.conversation.scope.chapter_title, "第6章 总线");
  assert.equal(asked.conversation.provider, "zhipu");
  assert.equal(asked.conversation.model, "GLM-5.3-Flash");
  assert.equal(askRequest.provider, "zhipu");
  assert.equal(asked.conversation.turns[0].question, selected.text);
  assert.equal(await page.locator(".assistant-question-bubble").first().textContent(), selected.text);
  assert.equal(Object.hasOwn(askRequest, "question"), false,
    "selection ask fabricated a user question in the UI request");
  assert.ok(selected.text.length > 0);

  const followResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/follow-up"));
  await page.locator("#assistant-question").fill("为什么？");
  await page.locator("#assistant-send").click();
  const followed = await (await followResponse).json();
  assert.equal(followed.conversation.conversation_id, asked.conversation.conversation_id);
  assert.equal(followed.conversation.provider, "zhipu");
  assert.equal(followed.conversation.model, "GLM-5.3-Flash");
  assert.equal(followed.conversation.turns.length, 2);
  assert.equal(await page.locator("#assistant-model").isDisabled(), true,
    "an active conversation must keep its original model");
  assert.equal(await page.locator("#assistant-model-lock").isVisible(), true,
    "locked conversation did not explain why its model cannot change");
  await page.locator(".assistant-answer-bubble").getByText("可靠的数据交换", { exact: false }).waitFor();
  assert.equal(await page.locator("#assistant-panel #ask-selection").count(), 0,
    "Assistant answer text exposed a new-Ask affordance");
  assert.equal(await page.locator("#assistant-panel #assistant-follow-up").count(), 1,
    "same-level panel input is not the sole continuation path");
  await page.screenshot({ path: path.join(artifacts, "ask-about-this-panel.png"), fullPage: false });

  const inspection = await json(page, "/api/assistant/inspection");
  assert.equal(inspection.calls.length, 2);
  assert.deepEqual(inspection.calls.map((call) => call.request_body), providerCalls.map((call) => call.body));
  const inspectedText = JSON.stringify(inspection);
  const initialUserContent = inspection.calls[0].request_body.messages.at(-1).content;
  assert.ok(initialUserContent.endsWith(`【当前解释焦点（用户所选）】\n${selected.text}`));
  assert.ok(initialUserContent.indexOf("【同一 PDF 页的有界 OCR 语境（辅助）】")
    < initialUserContent.lastIndexOf(selected.text));
  assert.ok(!initialUserContent.includes("请只依据"));
  assert.equal(inspection.calls[1].request_body.messages.at(-1).content, "为什么？");
  assert.ok(!inspectedText.includes("已安全确定的节标题"));
  assert.ok(inspectedText.includes("291"));
  assert.ok(!inspectedText.includes("mock-secret-never-inspect"));
  assert.ok(!inspectedText.includes("Authorization"));
  assert.ok(providerCalls.every((call) => call.method === "POST" && call.url === "/chat/completions"));
  assert.deepEqual(inspection.calls.map((call) => call.provider), ["zhipu", "zhipu"]);
  assert.deepEqual(providerCalls.map((call) => call.body.model), ["GLM-5.3-Flash", "GLM-5.3-Flash"]);

  const newRootClose = page.waitForResponse((response) => response.url().endsWith("/assistant/close"));
  await page.locator("#assistant-new-root").click();
  assert.equal((await newRootClose).status(), 204);
  assert.equal(await page.locator("#assistant-model").isEnabled(), true,
    "new Assistant Root did not unlock model selection");
  assert.equal(await page.locator("#assistant-model-lock").isHidden(), true);
  await page.locator("#assistant-model").selectOption("openrouter");
  await page.locator("#assistant-model").selectOption("zhipu");
  assert.equal(providerCalls.length, 2, "new-root model selection caused provider egress");

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 348);
  const staleFollowStatus = await page.evaluate(async (payload) => {
    const response = await fetch("/api/assistant/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.status;
  }, {
    reader_session_id: askRequest.reader_session_id,
    conversation_id: asked.conversation.conversation_id,
    question: "不应继续",
  });
  assert.equal(staleFollowStatus, 404, "Reader close did not clear the server-memory conversation");

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 29);
  await page.locator("#assistant-toggle").click();
  assert.equal(await page.locator("#assistant-model").inputValue(), "zhipu",
    "a new Reader conversation should inherit the current in-page model selection");
  await page.locator("#assistant-toggle").click();
  await selectLine(page, 0);
  const fallbackResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  await page.locator("#assistant-start").click();
  const fallbackHttp = await fallbackResponse;
  const fallback = await fallbackHttp.json();
  const fallbackRequest = fallbackHttp.request().postDataJSON();
  assert.equal(fallback.conversation.scope.kind, "PAGE");
  assert.equal(fallback.conversation.scope.key, "PAGE:0");
  assert.equal(fallback.conversation.scope.section_title, null);
  assert.equal(fallback.conversation.provider, "zhipu");
  assert.equal(fallback.conversation.model, "GLM-5.3-Flash");
  assert.match(await page.locator("#assistant-scope").textContent(), /^PDF 第 1 页范围/);
  const fallbackPayload = JSON.stringify(providerCalls.at(-1).body);
  assert.ok(!fallbackPayload.includes("已安全确定的节标题"));
  const explicitClose = page.waitForResponse((response) => response.url().endsWith("/assistant/close"));
  await page.locator("#assistant-close").click();
  assert.equal((await explicitClose).status(), 204);
  await page.locator("#assistant-panel").waitFor({ state: "hidden" });
  const closedFollowStatus = await page.evaluate(async (payload) => {
    const response = await fetch("/api/assistant/follow-up", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return response.status;
  }, {
    reader_session_id: fallbackRequest.reader_session_id,
    conversation_id: fallback.conversation.conversation_id,
    question: "不应继续",
  });
  assert.equal(closedFollowStatus, 404, "explicit panel close did not clear the conversation");

  await stopService(running.child);
  running = await startService({
    GUIDED_READER_DEEPSEEK_DISABLED: "1",
    GUIDED_READER_ZHIPU_DISABLED: "1",
    GUIDED_READER_OPENROUTER_DISABLED: "1",
  });
  await page.goto(running.url);
  await openBook(page, 29);
  await selectLine(page, 0);
  assert.equal(await page.locator("#ask-selection").isDisabled(), true);
  const offStatus = await json(page, "/api/assistant/status");
  assert.equal(offStatus.configured, false);
  assert.equal(offStatus.credential_available, false);
  assert.equal(offStatus.ai_off_reason, "DEVELOPMENT_DISABLED");
  assert.equal(await page.locator("#copy-selection").isEnabled(), true);
  await page.keyboard.press("Escape");
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await page.locator("#search-toggle").click();
  await page.locator("#search-panel").waitFor({ state: "visible" });
  assert.equal(providerCalls.length, 3, "AI-off attempted an implicit provider call");
  assert.equal(await page.locator("#compare-selection").count(), 0,
    "bake-off control leaked into the product path with the gate off");

  console.log(JSON.stringify({
    status: "PASS",
    selectionAskReachedPanel: true,
    sameLevelFollowUpTurns: 2,
    realBookHonestScope: asked.conversation.scope.key,
    pageFallback: fallback.conversation.scope.key,
    readerCloseClearedConversation: true,
    explicitPanelCloseClearedConversation: true,
    inspectedProviderCalls: inspection.calls.length,
    configuredEndpointOnly: providerEndpoint,
    selectedProviderOnly: "zhipu",
    selectorEnabledBeforeFirstRequest: true,
    selectorLockedOnlyAfterSuccessfulFirstTurn: true,
    newRootUnlocksSelector: true,
    servedCurrentNoStoreAsset: true,
    selectionContextMenuUnobstructed: true,
    bakeoffUiAbsent: true,
    aiOffPreservedReaderSelectionOutlineSearch: true,
    screenshots: [
      path.join(artifacts, "ask-about-this-draft.png"),
      path.join(artifacts, "ask-about-this-panel.png"),
    ],
  }));
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  await new Promise((resolve) => mockProvider.close(resolve));
  if (running?.errors?.trim()) process.stderr.write(running.errors);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function selectLine(page, pageIndex) {
  await goToPage(page, pageIndex);
  const revisionId = await page.evaluate(async () => (
    await (await fetch("/api/books")).json()
  ).books.find((book) => book.active_revision.page_count === Number(document.querySelector("#page-total").textContent.match(/\d+/)[0])).active_revision.id);
  const overlay = await page.evaluate(async ({ revisionId: id, pageIndex: index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { revisionId, pageIndex });
  const line = overlay.lines.find((candidate) => candidate.cells.length >= 8
    && centerY(candidate.quad) > 0.08 && centerY(candidate.quad) < 0.92);
  assert.ok(line, `PDF page ${pageIndex + 1} has no representative selectable line`);
  const chosen = line.cells.slice(0, Math.min(14, line.cells.length));
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const lineBounds = bounds(line.quad);
  const y = pageBox.y + ((lineBounds.y0 + lineBounds.y1) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return { text: line.text.slice(chosen[0][2], chosen.at(-1)[3]), line };
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached", timeout: 15_000 });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
}

async function startService(extraEnv) {
  const child = spawn(
    "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, ...extraEnv },
    },
  );
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  return { child, url: await readyUrl(child, () => errors), get errors() { return errors; } };
}

async function stopService(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

function readyUrl(child, errors) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Core Service did not start. ${errors()}`)), 20_000);
    child.once("exit", (code) => reject(new Error(`Core Service exited ${code}. ${errors()}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
}

function bounds(quad) {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function centerY(quad) {
  const value = bounds(quad);
  return (value.y0 + value.y1) / 2;
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
