import assert from "node:assert/strict";
import os from "node:os";
import { chromium } from "playwright-core";

const baseUrl = process.env.READER_BASE_URL || "http://127.0.0.1:8765/";
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

let browser;
try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl);
  const status = await json(page, "/api/assistant/status");
  const deepseek = status.providers.find((provider) => provider.provider === "deepseek");
  assert.equal(deepseek?.configured, true);
  assert.equal(deepseek.model, "deepseek-flash");
  await openBook(page, 348);
  const before = await json(page, "/api/assistant/inspection");

  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-model-trigger").click();
  await page.locator('.assistant-model-options [data-value="deepseek"]').click();
  let response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/assistant/ask"), { timeout: 180_000 },
  );
  await page.locator("#assistant-start").click();
  assert.equal((await response).status(), 200);

  const formatPrompt = String.raw`请用 Markdown 格式重新说明：使用二级标题；把“时钟周期”加粗；给出一个两项无序列表；并单独给出块公式 \[T=\frac{1}{f}\]。不要使用代码块或 HTML。`;
  response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/assistant/follow-up"), { timeout: 180_000 },
  );
  await page.locator("#assistant-question").fill(formatPrompt);
  await page.locator("#assistant-send").click();
  const formattedHttp = await response;
  assert.equal(formattedHttp.status(), 200);
  const formattedState = (await formattedHttp.json()).assistant;
  const rawFormattedAnswer = formattedState.current.turns.at(-1).answer;
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await bubble.locator("h2").first().waitFor({ state: "visible" });
  assert.ok(await bubble.locator("strong").count() >= 1);
  assert.ok(await bubble.locator("ul li").count() >= 2);
  assert.equal(await bubble.locator(".assistant-math-block .katex").count(), 1);
  assert.equal(await bubble.locator("script, iframe, object, embed, img").count(), 0);
  const innerText = await bubble.innerText();
  assert.ok(!innerText.includes("**时钟周期**"));
  assert.ok(!innerText.includes("T=\\frac{1}{f}"));
  assert.ok(rawFormattedAnswer.includes("时钟周期"));

  const visibleSelection = await selectAssistantTextByMouse(page, "时钟周期");
  assert.equal(visibleSelection, "时钟周期");
  response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  const childHttp = await response;
  assert.equal(childHttp.status(), 200);
  const childState = (await childHttp.json()).assistant;
  const rawSelectedFocus = childState.current.turns[0].question;
  assert.equal(rawSelectedFocus, visibleSelection);

  const after = await json(page, "/api/assistant/inspection");
  const newCalls = after.calls.slice(before.calls.length);
  const childCall = newCalls.at(-1);
  const content = childCall.request_body.messages.at(-1).content;
  assert.equal(childCall.provider, "deepseek");
  assert.equal(childCall.request_body.model, "deepseek-flash");
  assert.ok(content.startsWith("【当前解释焦点（用户所选）】\n时钟周期\n"));
  assert.ok(!/父子关系|当前解释深度|ORIGINAL_PDF|ASSISTANT_ANSWER|字符范围/.test(content));
  assert.ok(!JSON.stringify(after).includes("Authorization"));
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(JSON.stringify(after)));

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
      pdfPage: 25,
    },
    provider: "deepseek",
    model: "deepseek-flash",
    markdownRendered: true,
    rawMarkdownMarkersVisible: false,
    blockMathRendered: true,
    rawLatexVisible: false,
    sanitizedOutput: "PASS",
    visibleSelection,
    rawSelectedFocus,
    currentFocusTransport: "exact",
    metadataContamination: "NONE",
    providerCalls: newCalls.length,
  }));
} finally {
  if (browser) await browser.close();
}

async function selectAssistantTextByMouse(page, needle) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const points = await bubble.evaluate((element, text) => {
    const spans = Array.from(element.querySelectorAll(".assistant-source-text"));
    const nodes = spans.map((span) => span.firstChild);
    const combined = nodes.map((node) => node.data).join("");
    const start = combined.indexOf(text);
    if (start < 0) throw new Error(`Assistant answer does not contain ${text}`);
    const point = (target, atEnd = false) => {
      let cursor = 0;
      for (const node of nodes) {
        const next = cursor + node.data.length;
        if (target < next || (atEnd && target === next)) return { node, offset: target - cursor };
        cursor = next;
      }
      return { node: nodes.at(-1), offset: nodes.at(-1).data.length };
    };
    const firstPoint = point(start);
    const lastPoint = point(start + text.length, true);
    const full = document.createRange();
    full.setStart(firstPoint.node, firstPoint.offset);
    full.setEnd(lastPoint.node, lastPoint.offset);
    const scroller = element.closest("#assistant-turns");
    const target = full.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    scroller.scrollTop += target.top - viewport.top - viewport.height / 2;
    const first = document.createRange();
    first.setStart(firstPoint.node, firstPoint.offset);
    first.setEnd(firstPoint.node, firstPoint.offset + 1);
    const last = document.createRange();
    last.setStart(lastPoint.node, Math.max(0, lastPoint.offset - 1));
    last.setEnd(lastPoint.node, lastPoint.offset);
    return {
      start: center(first.getBoundingClientRect(), false),
      end: center(last.getBoundingClientRect(), true),
    };
    function center(rect, right) {
      return { x: right ? rect.right - 1 : rect.left + 1, y: rect.top + rect.height / 2 };
    }
  }, needle);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 10 });
  await page.mouse.up();
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  await page.mouse.click(points.start.x, points.start.y, { button: "right" });
  await page.locator("#assistant-answer-actions").waitFor({ state: "visible" });
  return page.evaluate(() => getSelection()?.toString() || "");
}

async function selectExactReaderText(page, pageIndex, needle) {
  await goToPage(page, pageIndex);
  const revisionId = await page.evaluate(async () => (
    (await (await fetch("/api/books")).json()).books
      .find((book) => book.active_revision.page_count === 348).active_revision.id
  ));
  const overlay = await page.evaluate(async ({ id, index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { id: revisionId, index: pageIndex });
  const line = overlay.lines.find((candidate) => candidate.text.includes(needle));
  assert.ok(line);
  const start = line.text.indexOf(needle);
  const end = start + needle.length;
  const firstCell = line.cells.findIndex((cell) => cell[3] > start && cell[2] < end);
  const lastCell = line.cells.findLastIndex((cell) => cell[3] > start && cell[2] < end);
  assert.ok(firstCell >= 0 && lastCell >= firstCell);
  const boundaryX = (index) => {
    if (index === 0) return line.cells[0][0];
    if (index === line.cells.length) return line.cells.at(-1)[1];
    return (line.cells[index - 1][1] + line.cells[index][0]) / 2;
  };
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).boundingBox();
  const xs = line.quad.map(([x]) => x);
  const ys = line.quad.map(([, y]) => y);
  const y = pageBox.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * pageBox.height;
  const startX = pageBox.x + boundaryX(firstCell) * pageBox.width;
  const endX = pageBox.x + boundaryX(lastCell + 1) * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return page.evaluate(() => getSelection()?.toString() || "");
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible" });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached" });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
