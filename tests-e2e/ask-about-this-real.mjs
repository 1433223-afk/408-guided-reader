import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the prepared 29/348-page real-material library");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-ask-deeper-real-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
let running = await startService({ GUIDED_READER_ASSISTANT_PROVIDER: "deepseek" });
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  const status = await json(page, "/api/assistant/status");
  const deepseek = status.providers.find((provider) => provider.provider === "deepseek");
  assert.equal(deepseek?.configured, true, "DeepSeek Windows Credential Manager target is unavailable");
  assert.equal(deepseek.model, "deepseek-flash");

  await openBook(page, 348);
  const bigEndian = await selectExactText(page, {
    id: "big_endian", page: 73, line: 37, needle: "大端方式",
  });
  const rootOneResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 180_000 },
  );
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  await page.locator("#assistant-start").click();
  const rootOneHttp = await rootOneResponse;
  assert.equal(rootOneHttp.status(), 200);
  const rootOneRequest = rootOneHttp.request().postDataJSON();
  let state = (await rootOneHttp.json()).assistant;
  const rootOneId = state.current.root_id;
  const rootOneAnswer = state.current.turns[0].answer;
  assert.equal(state.current.depth, 1);
  assert.equal(state.current.turns[0].question, bigEndian.text);
  assertChineseExplanation(rootOneAnswer, "大端首答");
  assert.match(rootOneAnswer, /大端|字节|地址/);

  const firstConcept = await selectConcept(page, [
    "高位字节", "低地址", "字节序", "多字节数据", "内存地址", "最高有效字节",
  ]);
  const childOneResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  const childOneHttp = await childOneResponse;
  assert.equal(childOneHttp.status(), 200);
  state = (await childOneHttp.json()).assistant;
  const childOneAnswer = state.current.turns[0].answer;
  assert.equal(state.current.depth, 2);
  assert.equal(state.current.turns[0].question, firstConcept);
  assertChineseExplanation(childOneAnswer, "第二层回答");

  const secondConcept = await selectConcept(page, [
    "内存地址", "地址递增", "最高有效字节", "最低有效字节", "字节", "二进制",
  ]);
  const childTwoResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  const childTwoHttp = await childTwoResponse;
  assert.equal(childTwoHttp.status(), 200);
  state = (await childTwoHttp.json()).assistant;
  const childTwoId = state.current.node_id;
  const childTwoAnswer = state.current.turns[0].answer;
  assert.equal(state.current.depth, 3);
  assert.equal(state.current.turns[0].question, secondConcept);
  assertChineseExplanation(childTwoAnswer, "第三层回答");
  assert.equal(await page.locator("#assistant-depth").textContent(), "3/5");

  await page.locator("#assistant-close").click();
  await page.locator("#assistant-panel").waitFor({ state: "hidden" });
  const littleEndian = await selectExactText(page, {
    id: "little_endian", page: 73, line: 38, needle: "小端方式",
  });
  const rootTwoResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 180_000 },
  );
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  await page.locator("#assistant-start").click();
  const rootTwoHttp = await rootTwoResponse;
  assert.equal(rootTwoHttp.status(), 200);
  state = (await rootTwoHttp.json()).assistant;
  const rootTwoId = state.current.root_id;
  const rootTwoAnswer = state.current.turns[0].answer;
  assert.equal(state.roots.length, 2);
  assert.equal(state.current.depth, 1);
  assert.equal(state.current.turns[0].question, littleEndian.text);
  assertChineseExplanation(rootTwoAnswer, "小端新主题首答");
  assert.match(rootTwoAnswer, /小端|字节|地址/);

  const switchResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-root-switcher").selectOption(rootOneId);
  state = (await (await switchResponse).json()).assistant;
  assert.equal(state.current.node_id, childTwoId);
  assert.equal(state.current.depth, 3);
  assert.equal(state.roots.length, 2);
  assert.equal(state.current.turns[0].answer, childTwoAnswer);

  const sameLevelResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/follow-up"), { timeout: 180_000 },
  );
  await page.locator("#assistant-question").fill("请用一个具体的 32 位数再说明。");
  await page.locator("#assistant-send").click();
  const sameLevelHttp = await sameLevelResponse;
  assert.equal(sameLevelHttp.status(), 200);
  state = (await sameLevelHttp.json()).assistant;
  const sameLevelAnswer = state.current.turns.at(-1).answer;
  assert.equal(state.current.depth, 3);
  assert.equal(state.current.turns.length, 2);
  assertChineseExplanation(sameLevelAnswer, "第三层同层追问");

  const inspection = await json(page, "/api/assistant/inspection");
  assert.equal(inspection.calls.length, 5);
  assert.ok(inspection.calls.every((call) => call.provider === "deepseek"));
  assert.ok(inspection.calls.every((call) => call.endpoint === "https://api.deepseek.com/chat/completions"));
  const firstChildMessages = inspection.calls[1].request_body.messages;
  assert.deepEqual(firstChildMessages.map((message) => message.role), ["system", "user"]);
  assert.ok(firstChildMessages[1].content.includes(rootOneAnswer));
  assert.ok(firstChildMessages[1].content.includes(firstConcept));
  assert.ok(!firstChildMessages[1].content.includes(rootTwoAnswer));
  const afterSwitchMessages = inspection.calls[4].request_body.messages;
  assert.ok(!JSON.stringify(afterSwitchMessages).includes(rootTwoAnswer),
    "the first Root was polluted by the second Root answer after switching back");
  const inspectionText = JSON.stringify(inspection);
  assert.ok(!inspectionText.includes("Authorization"));
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(inspectionText));

  const backResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-back").click();
  state = (await (await backResponse).json()).assistant;
  assert.equal(state.current.depth, 2);
  const closeResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-root"));
  await page.locator("#assistant-close-root").click();
  state = (await (await closeResponse).json()).assistant;
  assert.equal(state.roots.length, 1);
  assert.equal(state.current.root_id, rootTwoId);
  assert.equal(state.current.turns[0].answer, rootTwoAnswer);

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 348);
  const staleStatus = await page.evaluate(async (payload) => {
    const response = await fetch("/api/assistant/follow-up", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return response.status;
  }, {
    reader_session_id: rootOneRequest.reader_session_id,
    root_id: rootTwoId,
    node_id: null,
    question: "不应继续",
  });
  assert.equal(staleStatus, 404);
  await page.locator("#assistant-toggle").click();
  assert.equal(await page.locator("#assistant-root-switcher option").count(), 0);

  console.log(JSON.stringify({
    status: "PASS",
    provider: "deepseek",
    model: "deepseek-flash",
    realBook: { pages: 348, sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd" },
    rootOne: { selection: bigEndian.text, firstConcept, secondConcept, deepestDepth: 3 },
    rootTwo: { selection: littleEndian.text, retainedAfterRootOneClose: true },
    sameLevelDepthStable: true,
    switchedBackWithoutCrossRootPollution: true,
    parentBackClear: true,
    readerReopenClearedAllRoots: true,
    answerCharacters: {
      rootOne: rootOneAnswer.length,
      childOne: childOneAnswer.length,
      childTwo: childTwoAnswer.length,
      sameLevel: sameLevelAnswer.length,
      rootTwo: rootTwoAnswer.length,
    },
    answerPreviews: {
      rootOne: rootOneAnswer.slice(0, 120),
      childOne: childOneAnswer.slice(0, 120),
      childTwo: childTwoAnswer.slice(0, 120),
      sameLevel: sameLevelAnswer.slice(0, 120),
      rootTwo: rootTwoAnswer.slice(0, 120),
    },
  }));
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  if (running?.errors?.trim()) process.stderr.write(running.errors);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

function assertChineseExplanation(answer, label) {
  assert.ok(typeof answer === "string" && answer.length >= 20, `${label}过短`);
  assert.ok(/[\u4e00-\u9fff]/.test(answer), `${label}不是中文解释`);
}

async function selectConcept(page, candidates) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const selected = await bubble
    .evaluate((bubble, values) => {
      const answer = bubble.textContent;
      let text = values.find((candidate) => answer.includes(candidate));
      if (!text) {
        const fragments = answer.match(/[\u4e00-\u9fffA-Za-z0-9]{3,10}/g) || [];
        text = fragments.find((fragment) => !/^(这个|一种|就是|可以|因为|例如|所以)/.test(fragment));
      }
      if (!text) throw new Error(`No meaningful Child selection in: ${answer}`);
      const offset = answer.indexOf(text);
      const range = document.createRange();
      range.setStart(bubble.firstChild, offset);
      range.setEnd(bubble.firstChild, offset + text.length);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      bubble.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      const rect = range.getClientRects()[0];
      return { text, point: { x: rect.left + 1, y: rect.top + rect.height / 2 } };
    }, candidates);
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  await bubble.evaluate((element, point) => {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: point.x, clientY: point.y,
    }));
  }, selected.point);
  await page.locator("#assistant-answer-actions").waitFor({ state: "visible" });
  return selected.text;
}

async function selectExactText(page, item) {
  await goToPage(page, item.page);
  const revisionId = await page.evaluate(async () => (
    (await (await fetch("/api/books")).json()).books
      .find((book) => book.active_revision.page_count === 348).active_revision.id
  ));
  const overlay = await page.evaluate(async ({ revisionId: id, pageIndex: index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { revisionId, pageIndex: item.page });
  const line = overlay.lines.find((candidate) => candidate.line_ordinal === item.line);
  assert.ok(line, `${item.id}: line ${item.line} is unavailable on PDF page ${item.page + 1}`);
  const start = line.text.indexOf(item.needle);
  assert.ok(start >= 0, `${item.id}: ${item.needle} is absent from ${line.text}`);
  const end = start + item.needle.length;
  const chosen = line.cells.filter((cell) => cell[3] > start && cell[2] < end);
  assert.ok(chosen.length, `${item.id}: no selectable cells for ${item.needle}`);
  const pageBox = await page.locator(`.page[data-index="${item.page}"]`).boundingBox();
  const lineBounds = bounds(line.quad);
  const y = pageBox.y + ((lineBounds.y0 + lineBounds.y1) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  assert.equal(await page.locator("#ask-selection").isEnabled(), true);
  return { text: line.text.slice(chosen[0][2], chosen.at(-1)[3]), revisionId };
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
  const child = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
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

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
