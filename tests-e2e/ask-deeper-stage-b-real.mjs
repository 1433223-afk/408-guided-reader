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
  assert.equal(deepseek?.configured, true, "DeepSeek is not callable for the Stage B smoke");
  assert.equal(deepseek.model, "deepseek-flash");

  await openBook(page, 348);
  const inspectionBefore = await json(page, "/api/assistant/inspection");
  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
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
  let rootState = (await rootHttp.json()).assistant;
  const firstRootId = rootState.current.root_id;
  let rootAnswer = rootState.current.turns.at(-1).answer;
  if (!rootAnswer.includes("像乐队里的节拍器") || !rootAnswer.includes("时钟周期")) {
    rootState = await followUp(
      page,
      "请在同一段回答中使用完整短语“像乐队里的节拍器”和“时钟周期”，说明它们与时钟脉冲信号的关系。",
    );
    rootAnswer = rootState.current.turns.at(-1).answer;
  }
  assert.ok(rootAnswer.includes("像乐队里的节拍器"));
  assert.ok(rootAnswer.includes("时钟周期"));
  assert.equal(await selectAssistantTextByMouse(page, "像乐队里的节拍器"), "像乐队里的节拍器");
  const rootScroll = await makeScrollableAndSet(page, 41);
  const childAResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-title").textContent(), "像乐队里的节拍器");
  assert.equal(await page.locator("#assistant-depth").textContent(), "2/5");
  assert.equal(await page.locator(".assistant-answer-bubble").count(), 0);
  const childAHttp = await childAResponse;
  assert.equal(childAHttp.status(), 200);
  let childAState = (await childAHttp.json()).assistant;
  const childAId = childAState.current.node_id;
  let childAAnswer = childAState.current.turns.at(-1).answer;
  if (!childAAnswer.includes("高低电平变化")) {
    childAState = await followUp(
      page,
      "请用完整短语“高低电平变化”进一步说明这个节拍器比喻。",
    );
    childAAnswer = childAState.current.turns.at(-1).answer;
  }
  assert.ok(childAAnswer.includes("高低电平变化"));
  assert.equal(await selectAssistantTextByMouse(page, "高低电平变化"), "高低电平变化");
  const childAScroll = await makeScrollableAndSet(page, 57);
  const grandchildResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-depth").textContent(), "3/5");
  const grandchildHttp = await grandchildResponse;
  assert.equal(grandchildHttp.status(), 200);
  const grandchildState = (await grandchildHttp.json()).assistant;
  const grandchildId = grandchildState.current.node_id;
  assert.deepEqual(await page.locator("#assistant-breadcrumb button").allTextContents(), [
    "时钟脉冲信号", "像乐队里的节拍器", "高低电平变化",
  ]);

  let focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-back").click();
  assert.equal((await (await focusResponse).json()).assistant.current.node_id, childAId);
  await waitForScroll(page, childAScroll);
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-back").click();
  assert.equal((await (await focusResponse).json()).assistant.current.depth, 1);
  await waitForScroll(page, rootScroll);
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), [
    "像乐队里的节拍器",
  ]);

  assert.equal(await selectAssistantTextByMouse(page, "时钟周期"), "时钟周期");
  const childBResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/child"), { timeout: 180_000 },
  );
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  const childBHttp = await childBResponse;
  assert.equal(childBHttp.status(), 200);
  const childBState = (await childBHttp.json()).assistant;
  const childBId = childBState.current.node_id;
  assert.equal(childBState.current.provider, "deepseek");
  assert.equal(childBState.current.model, "deepseek-flash");

  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-back").click();
  await focusResponse;
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), [
    "像乐队里的节拍器", "时钟周期",
  ]);
  const callsBeforeReopen = (await json(page, "/api/assistant/inspection")).calls.length;
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-child-list button")
    .filter({ hasText: "像乐队里的节拍器" }).click();
  const reopened = (await (await focusResponse).json()).assistant;
  const callsAfterReopen = (await json(page, "/api/assistant/inspection")).calls.length;
  assert.equal(callsAfterReopen - callsBeforeReopen, 0);
  assert.equal(reopened.current.node_id, childAId);
  assert.deepEqual(reopened.current.children.map((child) => child.label), ["高低电平变化"]);

  const closeChildResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/close-child"),
  );
  assert.equal(await page.locator("#assistant-close-root").textContent(), "关闭本层解释");
  await page.locator("#assistant-close-root").click();
  const afterChildClose = (await (await closeChildResponse).json()).assistant;
  assert.equal(afterChildClose.current.depth, 1);
  assert.ok(!afterChildClose.roots[0].nodes.some((node) => node.node_id === childAId));
  assert.ok(!afterChildClose.roots[0].nodes.some((node) => node.node_id === grandchildId));
  assert.ok(afterChildClose.roots[0].nodes.some((node) => node.node_id === childBId));
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), ["时钟周期"]);
  assert.equal(await selectAssistantTextByMouse(page, "时钟周期"), "时钟周期");
  assert.equal(await page.locator("#assistant-answer-actions").isVisible(), true);
  await page.keyboard.press("Escape");

  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-child-list button").filter({ hasText: "时钟周期" }).click();
  await focusResponse;
  await page.locator("#assistant-close").click();

  assert.equal(await selectExactReaderText(page, 262, "识别异常和中断"), "识别异常和中断");
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-model").isEnabled(), true);
  await page.locator("#assistant-model-trigger").click();
  await page.locator('.assistant-model-options [data-value="deepseek"]').click();
  const secondRootResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/ask"), { timeout: 180_000 },
  );
  await page.locator("#assistant-start").click();
  const secondRootHttp = await secondRootResponse;
  assert.equal(secondRootHttp.status(), 200);
  const secondRootState = (await secondRootHttp.json()).assistant;
  const secondRootId = secondRootState.current.root_id;
  assert.equal(secondRootState.roots.length, 2);

  const callsBeforeSwitches = (await json(page, "/api/assistant/inspection")).calls.length;
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-root-switcher").selectOption(firstRootId);
  const firstRootRestored = (await (await focusResponse).json()).assistant;
  assert.equal(firstRootRestored.current.node_id, childBId);
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await page.locator("#assistant-root-switcher").selectOption(secondRootId);
  const secondRootRestored = (await (await focusResponse).json()).assistant;
  assert.equal(secondRootRestored.current.node_id, null);
  assert.equal((await json(page, "/api/assistant/inspection")).calls.length, callsBeforeSwitches);

  const inspectionAfter = await json(page, "/api/assistant/inspection");
  const newCalls = inspectionAfter.calls.slice(inspectionBefore.calls.length);
  assert.ok(newCalls.length >= 5);
  assert.ok(newCalls.every((call) => (
    call.provider === "deepseek" && call.request_body.model === "deepseek-flash"
  )));
  const childCalls = newCalls.filter((call) => (
    call.request_body.messages.at(-1).content.includes("【直接上一轮】")
  ));
  assert.ok(childCalls.length >= 3);
  for (const call of childCalls) {
    const content = call.request_body.messages.at(-1).content;
    assert.ok(content.startsWith("【当前解释焦点（用户所选）】\n"));
    assert.ok(!/父子关系|当前解释深度|深度 \d\/5|ORIGINAL_PDF|ASSISTANT_ANSWER|字符范围/.test(content));
  }
  const siblingCall = childCalls.find((call) => (
    call.request_body.messages.at(-1).content.startsWith(
      "【当前解释焦点（用户所选）】\n时钟周期\n",
    )
  ));
  assert.ok(siblingCall);
  assert.ok(!siblingCall.request_body.messages.at(-1).content.includes(childAAnswer));
  assert.ok(!JSON.stringify(inspectionAfter).includes("Authorization"));
  assert.ok(!/sk-[A-Za-z0-9_-]{8,}/.test(JSON.stringify(inspectionAfter)));

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
      rootPdfPage: 25,
      secondRootPdfPage: 263,
    },
    provider: "deepseek",
    model: "deepseek-flash",
    childPageImmediateFocus: true,
    pendingOwner: "CHILD",
    backParentRestored: true,
    parentScrollRestored: true,
    parentSelectableAfterBack: true,
    historicalChildrenVisible: true,
    siblingChildCreation: "PASS",
    reopenProviderCalls: callsAfterReopen - callsBeforeReopen,
    childSubtreeClose: "PASS",
    siblingSurvivesClose: true,
    rootSwitchStateRestored: true,
    stageAContextRegression: "PASS",
    providerCalls: newCalls.length,
  }));
} finally {
  if (browser) await browser.close();
}

async function followUp(page, question) {
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/assistant/follow-up"), { timeout: 180_000 },
  );
  await page.locator("#assistant-question").fill(question);
  await page.locator("#assistant-send").click();
  const http = await response;
  assert.equal(http.status(), 200);
  return (await http.json()).assistant;
}

async function makeScrollableAndSet(page, desired) {
  const value = await page.locator("#assistant-turns").evaluate((element, target) => {
    element.style.maxHeight = "112px";
    element.scrollTop = Math.min(target, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  }, desired);
  assert.ok(value > 0, "Focused explanation page was not scrollable");
  return value;
}

async function waitForScroll(page, expected) {
  await page.waitForFunction((value) => (
    document.querySelector("#assistant-turns").scrollTop === value
  ), expected);
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
  await bubble.evaluate((element, text) => {
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
        if (target < next || (atEnd && target === next)) return { node, offset: target - cursor };
        cursor = next;
      }
      return { node: nodes.at(-1), offset: nodes.at(-1).data.length };
    };
    const startPoint = point(start);
    const endPoint = point(start + text.length, true);
    const range = document.createRange();
    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    const scroller = element.closest("#assistant-turns");
    const target = range.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    scroller.scrollTop += target.top - viewport.top - viewport.height / 2;
  }, needle);
  await page.waitForTimeout(50);
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
        if (target < next || (atEnd && target === next)) return { node, offset: target - cursor };
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
