import assert from "node:assert/strict";
import os from "node:os";
import { chromium } from "playwright-core";

const baseUrl = process.env.READER_BASE_URL || "http://127.0.0.1:8765/";
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

let browser;
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl);
  const status = await json(page, "/api/assistant/status");
  const deepseek = status.providers.find((provider) => provider.provider === "deepseek");
  assert.equal(deepseek?.configured, true, "DeepSeek is not callable for the authorized smoke");
  assert.equal(deepseek.model, "deepseek-flash");

  await openBook(page, 348);
  const before = await json(page, "/api/assistant/inspection");
  const rootSelection = await selectExactReaderText(page, 24, "时钟脉冲信号");
  assert.equal(rootSelection, "时钟脉冲信号");
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  await page.locator("#assistant-model-trigger").click();
  await page.locator('.assistant-model-options [data-value="deepseek"]').click();
  const rootResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 180_000 },
  );
  await page.locator("#assistant-start").click();
  const rootHttp = await rootResponse;
  assert.equal(rootHttp.status(), 200);
  const rootState = (await rootHttp.json()).assistant;
  const rootAnswer = rootState.current.turns[0].answer;
  assert.equal(rootState.current.turns[0].question, "时钟脉冲信号");
  let directPreviousFocus = "时钟脉冲信号";
  let directPreviousAnswer = rootAnswer;
  let expectedCallCount = 2;
  if (!directPreviousAnswer.includes("像乐队里的节拍器")) {
    directPreviousFocus = "请用完整短语“像乐队里的节拍器”说明这个比喻。";
    const followResponse = page.waitForResponse(
      (response) => response.url().endsWith("/assistant/follow-up"), { timeout: 180_000 },
    );
    await page.locator("#assistant-question").fill(directPreviousFocus);
    await page.locator("#assistant-send").click();
    const followHttp = await followResponse;
    assert.equal(followHttp.status(), 200);
    const followedState = (await followHttp.json()).assistant;
    directPreviousAnswer = followedState.current.turns.at(-1).answer;
    expectedCallCount = 3;
  }
  assert.ok(directPreviousAnswer.includes("像乐队里的节拍器"),
    `Direct previous answer lacks the exact golden-path focus: ${directPreviousAnswer}`);

  const childSelection = await selectAssistantTextByMouse(page, "像乐队里的节拍器");
  assert.equal(childSelection, "像乐队里的节拍器");
  const childResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  const childHttp = await childResponse;
  assert.equal(childHttp.status(), 200);
  const childState = (await childHttp.json()).assistant;
  const childTurn = childState.current.turns[0];
  assert.equal(childState.current.depth, 2);
  assert.equal(childTurn.question, "像乐队里的节拍器");

  const inspection = await json(page, "/api/assistant/inspection");
  assert.equal(inspection.calls.length, before.calls.length + expectedCallCount);
  const newCalls = inspection.calls.slice(before.calls.length);
  const rootCall = newCalls[0];
  const childCall = newCalls.at(-1);
  assert.equal(rootCall.provider, "deepseek");
  assert.ok(newCalls.every((call) => call.provider === "deepseek"));
  assert.equal(childCall.provider, "deepseek");
  assert.equal(childCall.endpoint, "https://api.deepseek.com/chat/completions");
  assert.deepEqual(childCall.request_body.messages.map((message) => message.role), [
    "system", "user",
  ]);
  const userContent = childCall.request_body.messages[1].content;
  assert.ok(userContent.startsWith(
    "【当前解释焦点（用户所选）】\n像乐队里的节拍器\n",
  ));
  assert.ok(userContent.includes(`焦点或问题：${directPreviousFocus}`));
  assert.ok(userContent.includes(`完整讲解：${directPreviousAnswer}`));
  assert.ok(userContent.includes("时钟脉冲信号 › 像乐队里的节拍器"));
  assert.ok(userContent.includes("【Reader 教材依据（仅用于消歧和 grounding）】"));
  assert.ok(userContent.includes("【同一 PDF 页的有界 OCR 语境】"));
  const bodyText = JSON.stringify(childCall.request_body);
  for (const forbidden of (
    ["父子关系", "当前解释深度", "深度 2/5", "ORIGINAL_PDF", "ASSISTANT_ANSWER", "字符范围"]
  )) assert.ok(!bodyText.includes(forbidden), `provider body leaked ${forbidden}`);
  assert.ok(!JSON.stringify(inspection).includes("Authorization"));
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(JSON.stringify(inspection)));

  assert.ok(/节拍器/.test(childTurn.answer));
  assert.ok(/节奏|同步|时钟|协调/.test(childTurn.answer));
  assert.ok(!/父子关系|树结构|\bRoot\b|\bChild\b|\bNode\b/.test(childTurn.answer));

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
      pdfPage: 25,
      printedPage: "13",
    },
    provider: childCall.provider,
    model: childCall.request_body.model,
    currentFocusExact: childTurn.question,
    focusFirst: true,
    directPreviousTurn: true,
    conceptPath: true,
    boundedReaderGrounding: true,
    metadataContamination: "NONE",
    siblingOrAncestorContamination: "NONE",
    answerAddressesFocus: true,
    rootAnswerPreview: rootAnswer.slice(0, 180),
    directPreviousAnswerPreview: directPreviousAnswer.slice(0, 180),
    childAnswerPreview: childTurn.answer.slice(0, 220),
  }));
} finally {
  if (browser) await browser.close();
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
  const line = overlay.lines.find((candidate) => candidate.text.startsWith(needle))
    || overlay.lines.find((candidate) => candidate.text.includes(needle));
  assert.ok(line, `${needle} is absent from PDF page ${pageIndex + 1}`);
  const start = line.text.indexOf(needle);
  const end = start + needle.length;
  const chosen = line.cells.filter((cell) => cell[3] > start && cell[2] < end);
  assert.ok(chosen.length, `No selectable cells for ${needle}`);
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"]`).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
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
  return page.evaluate(() => getSelection()?.toString() || "");
}

async function selectAssistantTextByMouse(page, needle) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const points = await bubble.evaluate((element, text) => {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest("[data-assistant-unselectable='true']")) {
        nodes.push(walker.currentNode);
      }
    }
    const combined = nodes.map((node) => node.data).join("");
    const start = combined.indexOf(text);
    if (start < 0) throw new Error(`Assistant answer does not contain ${text}`);
    const point = (target, atEnd = false) => {
      let cursor = 0;
      for (const node of nodes) {
        const next = cursor + node.data.length;
        if (target < next || (atEnd && target === next)) {
          return { node, offset: target - cursor };
        }
        cursor = next;
      }
      return { node: nodes.at(-1), offset: nodes.at(-1).data.length };
    };
    const startPoint = point(start);
    const endPoint = point(start + text.length, true);
    const startRange = document.createRange();
    startRange.setStart(startPoint.node, startPoint.offset);
    startRange.setEnd(startPoint.node, startPoint.offset + 1);
    const endRange = document.createRange();
    endRange.setStart(endPoint.node, Math.max(0, endPoint.offset - 1));
    endRange.setEnd(endPoint.node, endPoint.offset);
    const first = startRange.getBoundingClientRect();
    const last = endRange.getBoundingClientRect();
    return {
      start: { x: first.left + 1, y: first.top + first.height / 2 },
      end: { x: last.right - 1, y: last.top + last.height / 2 },
    };
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

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({
    state: "visible", timeout: 30_000,
  });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({
    state: "attached", timeout: 15_000,
  });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
}

function bounds(quad) {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  return {
    x0: Math.min(...xs), y0: Math.min(...ys),
    x1: Math.max(...xs), y1: Math.max(...ys),
  };
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
