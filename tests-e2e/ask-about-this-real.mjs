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

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-ask-real-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
let running = await startService({});
let browser;
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  const status = await json(page, "/api/assistant/status");
  assert.equal(status.configured, true, "Windows Credential Manager target is unavailable");
  assert.equal(status.provider, "deepseek");

  await openBook(page, 348);
  const selectedText = await selectLine(page, 302, 4);
  const askResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 90_000 },
  );
  await page.locator("#ask-selection").click();
  const askedHttp = await askResponse;
  assert.equal(askedHttp.status(), 200);
  const asked = await askedHttp.json();
  const askRequest = askedHttp.request().postDataJSON();
  const answer = asked.conversation.turns[0].answer;
  assert.equal(asked.conversation.turns[0].question, selectedText);
  assert.equal(Object.hasOwn(askRequest, "question"), false);
  assert.ok(/[\u4e00-\u9fff]/.test(answer), "DeepSeek answer was not Simplified-Chinese explanatory prose");
  assert.ok(/总线/.test(answer), "answer did not reflect the selected bus-transaction context");
  assert.ok(/操作|请求|仲裁|地址|数据|释放|周期|事务/.test(answer), "answer did not use the supplied textbook context");
  assert.equal(asked.conversation.scope.key, "PAGE:302");
  assert.equal(asked.conversation.scope.section_title, null);
  assert.equal(asked.conversation.scope.chapter_title, "第6章 总线");
  await page.locator(".assistant-answer-bubble").waitFor({ state: "visible" });

  const followResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/follow-up"), { timeout: 90_000 },
  );
  await page.locator("#assistant-question").fill("再简单一点");
  await page.locator("#assistant-send").click();
  const followed = await (await followResponse).json();
  assert.equal(followed.conversation.conversation_id, asked.conversation.conversation_id);
  assert.equal(followed.conversation.turns.length, 2);
  assert.ok(/[\u4e00-\u9fff]/.test(followed.conversation.turns[1].answer));

  const inspection = await json(page, "/api/assistant/inspection");
  assert.equal(inspection.calls.length, 2);
  assert.equal(inspection.calls[0].endpoint, "https://api.deepseek.com/chat/completions");
  const inspectionText = JSON.stringify(inspection);
  assert.ok(!inspectionText.includes("Authorization"));
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(inspectionText));

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 348);
  const staleStatus = await page.evaluate(async (payload) => {
    const response = await fetch("/api/assistant/follow-up", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return response.status;
  }, {
    reader_session_id: askRequest.reader_session_id,
    conversation_id: asked.conversation.conversation_id,
    question: "不应继续",
  });
  assert.equal(staleStatus, 404);

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 29);
  await selectLine(page, 0);
  const fallbackResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 90_000 },
  );
  await page.locator("#ask-selection").click();
  const fallback = await (await fallbackResponse).json();
  assert.equal(fallback.conversation.scope.key, "PAGE:0");
  assert.equal(fallback.conversation.scope.section_title, null);

  await stopService(running.child);
  running = await startService({ GUIDED_READER_DEEPSEEK_DISABLED: "1" });
  await page.goto(running.url);
  await openBook(page, 29);
  await selectLine(page, 0);
  assert.equal(await page.locator("#ask-selection").isDisabled(), true);
  assert.equal(await page.locator("#copy-selection").isEnabled(), true);
  await page.keyboard.press("Escape");
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await page.locator("#search-toggle").click();
  await page.locator("#search-panel").waitFor({ state: "visible" });

  console.log(JSON.stringify({
    status: "PASS",
    provider: "deepseek",
    mainBook: { pdfPageIndex: 302, printedPage: "291", honestScope: "PAGE:302" },
    firstAnswerCharacters: answer.length,
    followUpAnswerCharacters: followed.conversation.turns[1].answer.length,
    sameLevelTurns: followed.conversation.turns.length,
    readerCloseClearedConversation: true,
    excerptFallback: "PAGE:0",
    aiOffPreservedReaderSelectionOutlineSearch: true,
  }));
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  if (running?.errors?.trim()) process.stderr.write(running.errors);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function selectLine(page, pageIndex, requiredOrdinal = null) {
  await goToPage(page, pageIndex);
  const revisionId = await page.evaluate(async () => {
    const pageCount = Number(document.querySelector("#page-total").textContent.match(/\d+/)[0]);
    return (await (await fetch("/api/books")).json()).books
      .find((book) => book.active_revision.page_count === pageCount).active_revision.id;
  });
  const overlay = await page.evaluate(async ({ id, index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { id: revisionId, index: pageIndex });
  const line = requiredOrdinal === null
    ? overlay.lines.find((candidate) => candidate.cells.length >= 8 && centerY(candidate.quad) > 0.08 && centerY(candidate.quad) < 0.92)
    : overlay.lines.find((candidate) => candidate.line_ordinal === requiredOrdinal);
  assert.ok(line && line.cells.length, `PDF page ${pageIndex + 1} lacks the required real text line`);
  const chosen = line.cells.slice(0, Math.min(28, line.cells.length));
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const lineBounds = bounds(line.quad);
  const y = pageBox.y + ((lineBounds.y0 + lineBounds.y1) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return line.text.slice(chosen[0][2], chosen.at(-1)[3]);
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

function centerY(quad) {
  const value = bounds(quad);
  return (value.y0 + value.y1) / 2;
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
