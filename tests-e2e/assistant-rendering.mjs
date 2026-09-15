import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const rawAnswer = [
  "# 时钟信号说明",
  "",
  "中文与**粗体**混排，也有*斜体*。",
  "",
  "- 第一项：时钟周期",
  "- 第二项：同步",
  "",
  "1. 地址阶段",
  "2. 数据阶段",
  "",
  '行内代码 `const window = "[not math]"` 不应成为公式。',
  "",
  "```text",
  "\\[CODE_NOT_MATH\\]",
  "```",
  "",
  "行内数学 $f = 1/T$ 与中文混排。",
  "",
  "\\[",
  "T=\\frac{1}{f}",
  "\\]",
  "",
  "跨节点：起点**高低电平**终点。",
  "",
  "重复短语：时钟周期；再次出现：**时钟周期**。",
  "",
  "<script>window.__assistantPwned = true</script>",
  '<img src=x onerror="window.__assistantPwned = true">',
  "[危险链接](javascript:window.__assistantPwned=true)",
].join("\n");

const sourceDataDir = process.env.READER_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || "", "408 Guided Reader");
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-rendering-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
const providerCalls = [];
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerCalls.push(body);
  const answer = body.messages.at(-1).content.includes("【直接上一轮】")
    ? "这是精确映射后的深入解释。" : rawAnswer;
  sendProviderAnswer(response, body, answer);
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

let running;
let browser;
try {
  const endpoint = `http://127.0.0.1:${provider.address().port}/chat/completions`;
  running = await startService({
    GUIDED_READER_DEEPSEEK_API_KEY: "rendering-test-secret",
    GUIDED_READER_DEEPSEEK_ENDPOINT: endpoint,
  });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(running.url);
  await openBook(page, 348);
  await selectLine(page, 302);
  await page.locator("#ask-selection").click();
  const rootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  assert.equal((await rootResponse).status(), 200);

  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await bubble.locator("h1").waitFor({ state: "visible" });
  assert.equal(await bubble.locator("h1").textContent(), "时钟信号说明");
  assert.ok(await bubble.locator("strong").count() >= 3);
  assert.equal(await bubble.locator("em").textContent(), "斜体");
  assert.deepEqual(await bubble.locator("ul li").allTextContents(), [
    "第一项：时钟周期", "第二项：同步",
  ]);
  assert.deepEqual(await bubble.locator("ol li").allTextContents(), ["地址阶段", "数据阶段"]);
  assert.equal(await bubble.locator("code").first().textContent(), 'const window = "[not math]"');
  assert.match(await bubble.locator("pre code").textContent(), /\\\[CODE_NOT_MATH\\\]/);
  assert.equal(await bubble.locator(".assistant-math").count(), 2);
  assert.equal(await bubble.locator(".assistant-math-block .katex").count(), 1);
  assert.equal(await bubble.locator("script, img, a").count(), 0);
  assert.equal(await page.evaluate(() => window.__assistantPwned), undefined);
  const visibleText = await bubble.textContent();
  assert.ok(!visibleText.includes("**粗体**"));
  assert.ok(!visibleText.includes("T=\\frac{1}{f}"));
  assert.ok(visibleText.includes("中文与粗体混排"));
  assert.ok(visibleText.includes("行内数学"));

  assert.equal(await selectRenderedOccurrence(page, "中文与粗体混排", 0), "中文与粗体混排");
  assert.equal(await page.locator("#assistant-answer-actions.selection-actions").isVisible(), true);
  assert.equal(await page.locator("#assistant-answer-actions .selection-action-row").isVisible(), true);
  const toolbarStyles = await page.evaluate(() => {
    const values = (selector, properties) => {
      const style = getComputedStyle(document.querySelector(selector));
      return Object.fromEntries(properties.map((property) => [property, style[property]]));
    };
    const container = ["padding", "backgroundColor", "borderColor", "borderRadius", "boxShadow"];
    const button = ["minHeight", "padding", "color", "backgroundColor", "borderRadius", "fontSize"];
    const cancel = ["minWidth", "padding", "color", "backgroundColor"];
    return {
      readerContainer: values("#selection-actions", container),
      assistantContainer: values("#assistant-answer-actions", container),
      readerPrimary: values("#save-highlight", button),
      assistantAsk: values("#assistant-ask-deeper", button),
      readerCancel: values("#cancel-selection", cancel),
      assistantCancel: values("#assistant-cancel-selection", cancel),
    };
  });
  assert.deepEqual(toolbarStyles.assistantContainer, toolbarStyles.readerContainer);
  assert.deepEqual(toolbarStyles.assistantAsk, toolbarStyles.readerPrimary);
  assert.deepEqual(toolbarStyles.assistantCancel, toolbarStyles.readerCancel);
  await page.locator("#assistant-cancel-selection").click();
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  assert.equal(await page.evaluate(() => getSelection()?.isCollapsed ?? true), true);

  const ordinary = await createAndCloseChild(page, "中文与粗体混排", 0);
  assert.equal(ordinary.visibleSelection, "中文与粗体混排");
  assert.equal(ordinary.childQuestion, "中文与粗体混排");
  assert.ok(ordinary.request.source_spans.length >= 3);

  const acrossMarkers = await createAndCloseChild(page, "起点高低电平终点", 0);
  assert.equal(acrossMarkers.childQuestion, "起点高低电平终点");
  assert.ok(acrossMarkers.request.source_spans.length >= 3);
  assert.ok(!acrossMarkers.childQuestion.includes("**"));

  const repeated = await createAndCloseChild(page, "时钟周期", 2);
  const expectedSecondStart = Array.from(rawAnswer.slice(0, rawAnswer.lastIndexOf("时钟周期"))).length;
  assert.equal(repeated.request.source_spans[0].start, expectedSecondStart);
  assert.equal(repeated.childQuestion, "时钟周期");

  const formulaPoint = await bubble.locator(".katex").first().evaluate((math) => {
    const text = document.createTreeWalker(math, NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(1, text.data.length));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    math.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    const rect = range.getClientRects()[0];
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  });
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  await bubble.locator(".katex").first().evaluate((element, point) => {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: point.x, clientY: point.y,
    }));
  }, formulaPoint);
  assert.match(await page.locator("#status").textContent(), /不支持直接选择公式或代码/);

  assert.deepEqual(pageErrors, []);
  assert.ok(!JSON.stringify(providerCalls).includes("rendering-test-secret"));
  console.log(JSON.stringify({
    status: "PASS",
    markdownRendered: true,
    blockMathRendered: true,
    rawMarkdownMarkersVisible: false,
    rawLatexVisible: false,
    sanitizedOutput: true,
    ordinarySelectionExact: true,
    markersExcludedFromSelection: true,
    repeatedPhraseMappedByOccurrence: true,
    multiTextNodeSelectionExact: true,
    selectionRequiresContextMenu: true,
    invalidRightClickPreservesNativeMenu: true,
    selectionToolbarMatchesReader: true,
    selectionCancelClearsNativeRange: true,
    codeMathIsolation: true,
    formulaSelectionRestrictedHonestly: true,
  }));
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  await new Promise((resolve) => provider.close(resolve));
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function createAndCloseChild(page, phrase, occurrence) {
  const visibleSelection = await selectRenderedOccurrence(page, phrase, occurrence);
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/assistant/child"));
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  const request = (await requestPromise).postDataJSON();
  const response = await responsePromise;
  assert.equal(response.status(), 200);
  const childBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await childBubble.waitFor();
  const childQuestion = await childBubble.locator("xpath=preceding-sibling::*[1]").innerText();
  const closePromise = page.waitForResponse((candidate) => candidate.url().endsWith("/assistant/close-child"));
  await page.locator("#assistant-close-root").click();
  assert.equal((await closePromise).status(), 200);
  return { visibleSelection, request, childQuestion };
}

function sendProviderAnswer(response, body, answer) {
  if (!body.stream) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  const split = Math.ceil(answer.length / 2);
  for (const content of [answer.slice(0, split), answer.slice(split)]) {
    if (content) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  }
  response.write(`data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { completion_tokens: answer.length },
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function selectRenderedOccurrence(page, phrase, occurrence) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const selected = await bubble.evaluate((element, { value, wanted }) => {
    const nodes = Array.from(element.querySelectorAll(".assistant-source-text"))
      .map((span) => span.firstChild);
    const combined = nodes.map((node) => node.data).join("");
    let start = -1;
    let cursor = 0;
    for (let index = 0; index <= wanted; index += 1) {
      start = combined.indexOf(value, cursor);
      if (start < 0) throw new Error(`Rendered answer lacks occurrence ${wanted} of ${value}`);
      cursor = start + value.length;
    }
    const point = (target, atEnd = false) => {
      let offset = 0;
      for (const node of nodes) {
        const next = offset + node.data.length;
        if (target < next || (atEnd && target === next)) return { node, offset: target - offset };
        offset = next;
      }
      return { node: nodes.at(-1), offset: nodes.at(-1).data.length };
    };
    const first = point(start);
    const last = point(start + value.length, true);
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    const rect = range.getClientRects()[0];
    return {
      text: range.toString(),
      point: { x: rect.left + 1, y: rect.top + rect.height / 2 },
    };
  }, { value: phrase, wanted: occurrence });
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true,
    "Selecting an Assistant answer must not reveal 再问一层 before right-click");
  const outsideIntercepted = await bubble.evaluate((element) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: 0, clientY: 0,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  });
  assert.equal(outsideIntercepted, false,
    "Right-click outside the selected answer must preserve the native context menu");
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  const intercepted = await bubble.evaluate((element, point) => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: point.x, clientY: point.y,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, selected.point);
  assert.equal(intercepted, true, "Right-click inside the Assistant selection must open its action menu");
  await page.locator("#assistant-answer-actions").waitFor({ state: "visible" });
  return selected.text;
}

async function selectLine(page, pageIndex) {
  await goToPage(page, pageIndex);
  const revisionId = await currentRevisionId(page);
  const overlay = await page.evaluate(async ({ id, index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { id: revisionId, index: pageIndex });
  const line = overlay.lines.find((candidate) => candidate.cells.length >= 8);
  const chosen = line.cells.slice(0, Math.min(12, line.cells.length));
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = pageBox.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
}

async function currentRevisionId(page) {
  return page.evaluate(async () => {
    const books = (await (await fetch("/api/books")).json()).books;
    return books.find((book) => book.active_revision.page_count === 348).active_revision.id;
  });
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` })
    .locator(".book-open").click();
  await page.locator("#book-overview").waitFor({ state: "visible" });
  await page.locator("#book-overview .overview-book-heading .primary-action").click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible" });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached" });
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
  return { child, url: await readyUrl(child, () => errors) };
}

async function stopService(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

function readyUrl(child, errors) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(errors())), 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
}

function chromePath() {
  const candidates = [
    process.env.READER_CHROMIUM,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const fs = process.getBuiltinModule("node:fs");
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome or Edge is required");
  return found;
}
