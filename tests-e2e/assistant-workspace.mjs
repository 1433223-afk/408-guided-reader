import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const VIEWPORT_WIDTH = 1920;
const sourceDataDir = process.env.READER_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || "", "408 Guided Reader");
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-workspace-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });

const providerCalls = [];
let failNextAssistantRequest = false;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerCalls.push(body);
  if (failNextAssistantRequest) {
    failNextAssistantRequest = false;
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "workspace failure fixture" } }));
    return;
  }
  const prompt = body.messages.at(-1).content;
  let answer;
  if (prompt.includes("【当前解释焦点（用户所选）】\n高低电平变化")) {
    answer = "高低电平变化就是数字时钟在两个逻辑状态之间有规律地切换。";
  } else if (prompt.includes("【当前解释焦点（用户所选）】\n像乐队里的节拍器")) {
    answer = Array.from(
      { length: 28 },
      (_, index) => `第 ${index + 1} 段：节拍由高低电平变化表达，解释仍属于像乐队里的节拍器。`,
    ).join("\n\n");
  } else if (prompt.includes("【当前解释焦点（用户所选）】\n时钟周期")) {
    answer = "时钟周期是相邻两个同相位时刻之间的时间。";
  } else if (prompt.includes("识别异常和中断")) {
    answer = "识别异常和中断是处理器响应非正常控制流的基础。";
  } else {
    answer = [
      "## 时钟脉冲信号",
      "",
      "它**像乐队里的节拍器**，让各部件按照共同节奏工作。",
      "",
      "- **时钟周期**决定相邻节拍之间的时间。",
      "- 上升沿和下降沿形成可识别的节拍。",
      "",
      "\\[T=\\frac{1}{f}\\]",
      "",
      "```text",
      `clock_bus = ${"01".repeat(120)}`,
      "```",
      "",
      ...Array.from({ length: 12 }, (_, index) => `补充 ${index + 1}：同步部件只在约定节拍更新状态。`),
    ].join("\n");
  }
  await new Promise((resolve) => setTimeout(resolve, 120));
  sendProviderAnswer(response, body, answer);
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

let running;
let browser;
try {
  running = await startService({
    GUIDED_READER_DEEPSEEK_API_KEY: "workspace-test-secret",
    GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  });
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: VIEWPORT_WIDTH, height: 1080 } });
  const pageErrors = [];
  page.on("pageerror", (error) => { pageErrors.push(error.message); console.error(error.message); });
  await page.goto(running.url);
  await openBook(page, 348);

  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
  assert.equal(await page.locator("#selection-actions").isVisible(), true);
  await page.evaluate(() => {
    const canvases = [...document.querySelectorAll(".page canvas")];
    canvases.forEach((canvas, index) => { canvas.dataset.askOpenIdentity = String(index); });
    const metric = window.__assistantAskOpen = {
      destructivePageMutations: 0,
      canvasCount: canvases.length,
      longTasks: [],
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (metric.clickStart != null && entry.startTime >= metric.clickStart
            && entry.startTime <= metric.clickStart + 300) metric.longTasks.push(entry.duration);
      }
    }).observe({ type: "longtask", buffered: true });
    new MutationObserver((records) => {
      metric.destructivePageMutations += records.filter((record) => (
        [...record.removedNodes].some((node) => node instanceof Element
          && (node.matches("canvas,.text-overlay") || node.querySelector?.("canvas,.text-overlay")))
      )).length;
    }).observe(document.querySelector("#pages"), { childList: true, subtree: true });
    const panel = document.querySelector("#assistant-panel");
    new MutationObserver(() => {
      if (!panel.hidden && metric.shellVisible == null) metric.shellVisible = performance.now();
    }).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
    document.querySelector("#ask-selection").addEventListener("click", () => {
      metric.clickStart = performance.now();
      requestAnimationFrame(() => { metric.firstFrame = performance.now(); });
    }, { capture: true, once: true });
  });
  await page.locator("#ask-selection").click();
  await page.waitForFunction(() => window.__assistantAskOpen.shellVisible != null);
  const dismissalTiming = await page.locator("#selection-actions").evaluate((menu) => (
    menu.getAnimations().map((animation) => animation.effect.getTiming())
      .find((timing) => timing.duration === 90)
  ));
  await page.waitForTimeout(320);
  const askOpenTiming = await page.evaluate(() => ({
    shellMs: window.__assistantAskOpen.shellVisible - window.__assistantAskOpen.clickStart,
    firstFrameMs: window.__assistantAskOpen.firstFrame - window.__assistantAskOpen.clickStart,
    maxLongTaskMs: Math.max(0, ...window.__assistantAskOpen.longTasks),
    destructivePageMutations: window.__assistantAskOpen.destructivePageMutations,
    canvasCount: window.__assistantAskOpen.canvasCount,
    canvasIdentityPreserved: [...document.querySelectorAll(".page canvas")].every(
      (canvas, index) => canvas.dataset.askOpenIdentity === String(index)
    ),
  }));
  assert.ok(askOpenTiming.shellMs < 100, `Assistant shell took ${askOpenTiming.shellMs}ms`);
  assert.ok(askOpenTiming.firstFrameMs < 100, `Assistant first frame took ${askOpenTiming.firstFrameMs}ms`);
  assert.ok(askOpenTiming.maxLongTaskMs < 50, `Assistant open long task took ${askOpenTiming.maxLongTaskMs}ms`);
  assert.equal(askOpenTiming.destructivePageMutations, 0);
  assert.equal(askOpenTiming.canvasIdentityPreserved, true);
  assert.ok(dismissalTiming);
  await page.locator("#selection-actions").waitFor({ state: "hidden" });
  await page.locator("#assistant-model-trigger").click();
  await page.locator('#assistant-model-options [data-value="deepseek"]').click();
  assert.equal(providerCalls.length, 0);
  assert.equal(await page.locator("#assistant-start").isEnabled(), true);
  const rootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  const rootBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  assert.equal((await rootResponse).status(), 200);
  await rootBubble.locator("h2").waitFor({ state: "attached" });
  const firstRootId = await rootBubble.getAttribute("data-root-id");
  assert.ok(firstRootId);
  const callsAfterRoot = providerCalls.length;
  assert.equal(await rootBubble.locator("h2").textContent(), "时钟脉冲信号");
  assert.equal(await rootBubble.locator("h2").isVisible(), false);
  assert.equal(await page.locator("#assistant-title").isVisible(), false);
  assert.deepEqual(await rootBubble.locator("strong").allTextContents(), ["像乐队里的节拍器", "时钟周期"]);
  assert.equal(await rootBubble.locator("ul li").count(), 2);
  assert.equal(await rootBubble.locator(".assistant-math-block .katex").count(), 1);
  assert.ok(!(await rootBubble.innerText()).includes("\\frac"));
  await page.locator('.dock-tabs button').nth(1).click();
  assert.equal(await page.locator('#master-workspace').isVisible(), true);
  assert.equal(await rootBubble.isVisible(), false);
  await page.locator('.dock-tabs button').first().click();
  assert.equal(await rootBubble.isVisible(), true);
  assert.equal(providerCalls.length, callsAfterRoot);

  const initial = await panelMetrics(page);
  await dragDockToWidth(page, initial.panelWidth + 150);
  const wider = await panelMetrics(page);
  assert.ok(wider.panelWidth >= initial.panelWidth + 140);
  assert.ok(Math.abs(wider.viewerWidth - initial.viewerWidth) <= 2);
  assert.equal(await page.locator("#assistant-title").textContent(), "时钟脉冲信号");
  assert.equal(providerCalls.length, callsAfterRoot);

  await dragDockToWidth(page, 1200);
  const maximum = Number(await page.locator("#assistant-resize-handle").getAttribute("aria-valuemax"));
  assert.ok(Math.abs((await panelMetrics(page)).panelWidth - maximum) <= 2);
  await dragDockToWidth(page, 120);
  const minimum = Number(await page.locator("#assistant-resize-handle").getAttribute("aria-valuemin"));
  assert.ok(Math.abs((await panelMetrics(page)).panelWidth - minimum) <= 2);
  await dragDockToWidth(page, 520);
  await waitForReaderOverlay(page, 24);

  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
  assert.equal(await page.locator("#selection-actions").isVisible(), true);
  await page.locator("#cancel-selection").click();

  await page.locator('#assistant-question').fill('留在根主题的草稿');
  await page.locator('#assistant-question').evaluate(input => input.setSelectionRange(2, 4));
  assert.equal(await selectAssistantTextByMouse(page, "像乐队里的节拍器"), "像乐队里的节拍器");
  const rootScroll = await makeScrollableAndSet(page, 41);
  const childResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  await page.locator("#assistant-expand").click();
  assert.equal(await page.locator("#assistant-expand").getAttribute("aria-pressed"), "true");
  await page.locator("#assistant-expand").click();
  assert.equal(await page.locator("#assistant-expand").getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#assistant-title").textContent(), "像乐队里的节拍器");
  assert.equal(await page.locator('.assistant-answer-bubble[data-current-answer="true"]').count(), 0);
  assert.equal((await childResponse).status(), 200);
  await page.waitForFunction(() => !document.querySelector('#reader').classList.contains('assistant-workspace-morphing'));
  const childBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await childBubble.waitFor();
  const childId = await childBubble.getAttribute("data-node-id");
  assert.ok(childId);
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 2 层，最多 5 层");
  assert.equal(await page.locator("#assistant-root-switcher option:checked").textContent(), "时钟脉冲信号");
  assert.deepEqual(await page.locator("#assistant-breadcrumb button").allTextContents(), [
    "像乐队里的节拍器",
  ]);

  await page.locator('#assistant-question').fill('留在子主题的草稿');
  assert.equal(await selectAssistantTextByMouse(page, "高低电平变化"), "高低电平变化");
  const childScroll = await makeScrollableAndSet(page, 57);
  const grandchildResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 3 层，最多 5 层");
  assert.equal((await grandchildResponse).status(), 200);
  const grandchildBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await grandchildBubble.waitFor();
  const grandchildId = await grandchildBubble.getAttribute("data-node-id");
  assert.ok(grandchildId);
  assert.deepEqual(await page.locator("#assistant-breadcrumb button").allTextContents(), [
    "像乐队里的节拍器", "高低电平变化",
  ]);

  let focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, childId);
  assert.equal((await (await focusResponse).json()).assistant.current.node_id, childId);
  await waitForScroll(page, childScroll);
  assert.equal(await page.locator('#assistant-question').inputValue(), '留在子主题的草稿');
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, null);
  assert.equal((await (await focusResponse).json()).assistant.current.root_id, firstRootId);
  await waitForScroll(page, rootScroll);
  assert.equal(await page.locator('#assistant-question').inputValue(), '留在根主题的草稿');
  assert.equal(await page.locator('#assistant-question').evaluate(input => input.selectionStart), 2);
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), ["像乐队里的节拍器"]);
  assert.equal(await selectAssistantTextByMouse(page, "时钟周期"), "时钟周期");
  const siblingResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  assert.equal((await siblingResponse).status(), 200);
  const siblingBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await siblingBubble.waitFor();
  const siblingId = await siblingBubble.getAttribute("data-node-id");
  assert.ok(siblingId);

  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, null);
  await focusResponse;
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), [
    "像乐队里的节拍器", "时钟周期",
  ]);
  const callsBeforeReopen = providerCalls.length;
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, childId);
  const reopened = (await (await focusResponse).json()).assistant;
  assert.equal(reopened.current.node_id, childId);
  assert.deepEqual(reopened.current.children.map((child) => child.label), ["高低电平变化"]);
  const reopenProviderCalls = providerCalls.length - callsBeforeReopen;
  assert.equal(reopenProviderCalls, 0);
  await page.locator('#assistant-turns').evaluate(el => { el.style.maxHeight=''; });
  await page.locator('#assistant-expand').click();
  await page.waitForFunction(() => document.querySelector("#reader").dataset.assistantMorphPhase === "expanding");
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);
  assert.equal(await page.locator('#assistant-turns').evaluate(el => Math.round(el.getBoundingClientRect().right)), VIEWPORT_WIDTH);
  const messageRail=page.locator('.assistant-conversation .message-rail');
  assert.equal(await messageRail.locator('button').count(),reopened.current.turns.length);
  await messageRail.locator('button').first().hover();
  await page.locator('#assistant-turns-preview').waitFor({state:'visible'});
  await messageRail.locator('button').first().focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#assistant-turns-preview').isHidden(),true);
  assert.ok(await page.locator('#assistant-turns').evaluate(el => el.scrollHeight>el.clientHeight));
  await page.locator('#assistant-turns').hover(); await page.mouse.wheel(0,350);
  await page.waitForFunction(()=>document.querySelector('#assistant-turns').scrollTop>0);
  await page.screenshot({path:'test-results/assistant-expanded-edge-scroll.png'});
  await page.locator('#assistant-expand').click();
  await page.waitForFunction(() => document.querySelector("#reader").dataset.assistantMorphPhase === "restoring");
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);

  const closeChildResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-child"));
  assert.equal(await page.locator("#assistant-close-root").textContent(), "关闭本层解释");
  await page.locator("#assistant-close-root").click();
  const afterClose = (await (await closeChildResponse).json()).assistant;
  assert.ok(!afterClose.roots[0].nodes.some((node) => node.node_id === childId));
  assert.ok(!afterClose.roots[0].nodes.some((node) => node.node_id === grandchildId));
  assert.ok(afterClose.roots[0].nodes.some((node) => node.node_id === siblingId));
  await page.waitForFunction(() => document.querySelector('#assistant-title').textContent === '时钟脉冲信号');
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), ["时钟周期"]);
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, siblingId);
  await focusResponse;

  assert.equal(await selectExactReaderText(page, 262, "识别异常和中断"), "识别异常和中断");
  await page.locator("#ask-selection").click();
  assert.equal(await page.locator("#assistant-model").isEnabled(), true);
  assert.equal(providerCalls.length, 4);
  const secondRootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  assert.equal((await secondRootResponse).status(), 200);
  const secondRootBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await secondRootBubble.waitFor();
  const secondRootId = await secondRootBubble.getAttribute("data-root-id");
  assert.ok(secondRootId);
  assert.notEqual(secondRootId, firstRootId);

  const callsBeforeSwitch = providerCalls.length;
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, null);
  const restoredFirstRoot = (await (await focusResponse).json()).assistant;
  assert.equal(restoredFirstRoot.current.node_id, null);
  assert.equal(providerCalls.length, callsBeforeSwitch);
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, secondRootId, null);
  assert.equal((await (await focusResponse).json()).assistant.current.root_id, secondRootId);
  assert.equal(providerCalls.length, callsBeforeSwitch);

  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, null);
  assert.equal((await (await focusResponse).json()).assistant.current.node_id, null);
  focusResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRootId, null);
  assert.equal((await (await focusResponse).json()).assistant.current.depth, 1);

  await dragDockToWidth(page, 610);
  const widthBeforeExpanded = (await panelMetrics(page)).panelWidth;
  const scroller = page.locator("#assistant-turns");
  await scroller.evaluate((element) => {
    element.style.maxHeight = "";
    element.scrollTop = Math.min(60, element.scrollHeight - element.clientHeight);
  });
  const scrollBeforeExpanded = await scroller.evaluate((element) => element.scrollTop);
  const callsBeforeExpanded = providerCalls.length;
  const normalLayout = await conversationMetrics(page);
  assert.ok(normalLayout.turnsWidth > 500);
  assert.ok(normalLayout.answerWidth > normalLayout.questionWidth);
  assert.ok(normalLayout.questionWidth <= normalLayout.turnsWidth * 0.82);
  assert.ok(Math.abs(normalLayout.answerLeft - normalLayout.turnsLeft) <= 2);
  assert.ok(Math.abs(normalLayout.questionRight - normalLayout.turnsRight) <= 6);
  assert.equal(normalLayout.answerHasCardChrome, false);
  assert.equal(normalLayout.visibleRepeatedHeadings, 0);
  const normalScreenshot = path.join(process.cwd(), "test-results", "ask-deeper-normal-chat-layout.png");
  await mkdir(path.dirname(normalScreenshot), { recursive: true });
  await page.screenshot({ path: normalScreenshot });
  const assistantContinuity = await page.evaluate(() => {
    const question = document.querySelector("#assistant-question");
    const sidebar = document.querySelector(".assistant-topic-sidebar");
    question.value = "展开连续性草稿";
    question.focus({ preventScroll: true });
    question.setSelectionRange(2, 6);
    question.__assistantMorphIdentity = "same-composer";
    sidebar.scrollTop = Math.min(42, sidebar.scrollHeight - sidebar.clientHeight);
    const selected = sidebar.querySelector('[aria-selected="true"]');
    return {
      value: question.value,
      historyScroll: document.querySelector("#assistant-turns").scrollTop,
      sidebarScroll: sidebar.scrollTop,
      rootId: selected?.dataset.rootId || null,
      nodeId: selected?.dataset.nodeId ?? null,
      model: document.querySelector("#assistant-model").value,
    };
  });
  await page.locator("#assistant-expand").click();
  await page.waitForFunction(() => document.querySelector("#reader").dataset.assistantMorphPhase === "expanding");
  const sidebarMotion = await page.locator(".assistant-topic-sidebar").evaluate((sidebar) => (
    sidebar.getAnimations().map((animation) => animation.effect.getTiming())
      .find((timing) => timing.delay === 96 && timing.duration === 124)
  ));
  assert.ok(sidebarMotion);
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);
  const expanded = await panelMetrics(page);
  assert.equal(await page.locator("#assistant-expand").getAttribute("aria-pressed"), "true");
  assert.ok(expanded.panelWidth >= VIEWPORT_WIDTH - 2);
  assert.equal(providerCalls.length, callsBeforeExpanded);
  const expandedLayout = await conversationMetrics(page);
  assert.ok(expandedLayout.headerWidth > 1800);
  assert.ok(expandedLayout.rootSwitcherWidth <= 220);
  assert.equal(expandedLayout.turnsWidth, 1024);
  assert.equal(await page.locator('#assistant-turns').evaluate(el => Math.round(el.getBoundingClientRect().right)), VIEWPORT_WIDTH);
  assert.equal(await page.locator('#assistant-topic-trigger').isVisible(), false);
  assert.equal(await page.locator('#assistant-depth').isVisible(), false);
  assert.equal(await page.locator('.assistant-heading #assistant-scope').count(), 1);
  assert.equal(await page.locator('.assistant-topic-sidebar').evaluate(el => el.getBoundingClientRect().width), 232);
  assert.ok(expandedLayout.answerWidth > expandedLayout.questionWidth);
  assert.ok(expandedLayout.answerWidth <= expandedLayout.turnsWidth);
  assert.ok(expandedLayout.answerWidth >= expandedLayout.turnsWidth * 0.75);
  assert.ok(expandedLayout.questionWidth <= expandedLayout.turnsWidth * 0.5);
  assert.ok(Math.abs(expandedLayout.answerLeft - expandedLayout.turnsLeft) <= 2);
  assert.ok(Math.abs(expandedLayout.questionRight - expandedLayout.turnsRight) <= 6);
  const conversationCenter = await page.locator('.assistant-conversation').evaluate(el => { const r=el.getBoundingClientRect(); return r.left+r.width/2; });
  assert.ok(Math.abs(expandedLayout.turnsCenter - conversationCenter) <= 2);
  assert.ok(Math.abs(expandedLayout.composerCenter - expandedLayout.turnsCenter) <= 2);
  assert.ok(expandedLayout.composerWidth <= expandedLayout.turnsWidth);
  assert.ok(expandedLayout.composerWidth >= expandedLayout.turnsWidth * 0.75);
  assert.equal(await page.locator(".assistant-math-block .katex").count(), 1);
  assert.equal(expandedLayout.answerHasCardChrome, false);
  assert.equal(expandedLayout.visibleRepeatedHeadings, 0);
  assert.equal(expandedLayout.codeOverflow, "auto");
  assert.ok(expandedLayout.codeScrollWidth > expandedLayout.codeClientWidth);
  const screenshot = path.join(process.cwd(), "test-results", "ask-deeper-expanded-chat-layout.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  assert.equal(await page.locator("#assistant-question").evaluate((question) => question.__assistantMorphIdentity), "same-composer");
  assert.equal(await page.locator("#assistant-question").evaluate((question) => question === document.activeElement), true);
  assert.deepEqual(await page.locator("#assistant-question").evaluate((question) => [question.selectionStart, question.selectionEnd]), [2, 6]);
  assert.equal(await page.locator("#assistant-question").inputValue(), assistantContinuity.value);
  assert.equal(await page.locator("#assistant-model").inputValue(), assistantContinuity.model);
  assert.equal(await page.locator('.assistant-topic-sidebar [aria-selected="true"]').getAttribute("data-root-id"), assistantContinuity.rootId);
  assert.equal(await page.locator('.assistant-topic-sidebar [aria-selected="true"]').getAttribute("data-node-id"), assistantContinuity.nodeId);
  await page.locator("#assistant-expand").click();
  await page.waitForFunction(() => document.querySelector("#reader").dataset.assistantMorphPhase === "restoring");
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);
  assert.ok(Math.abs((await panelMetrics(page)).panelWidth - widthBeforeExpanded) <= 2);
  assert.equal(await scroller.evaluate((element) => element.scrollTop), scrollBeforeExpanded);
  assert.equal(providerCalls.length, callsBeforeExpanded);
  assert.equal(await page.locator("#assistant-question").evaluate((question) => question.__assistantMorphIdentity), "same-composer");
  assert.equal(await page.locator("#assistant-question").evaluate((question) => question === document.activeElement), true);
  assert.equal(await page.locator("#assistant-question").inputValue(), assistantContinuity.value);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#assistant-expand").click();
  assert.equal(await page.locator("#reader").getAttribute("data-assistant-morph-phase"), null);
  assert.ok(Math.abs(await page.locator(".assistant-topic-sidebar").evaluate((sidebar) => sidebar.scrollTop) - assistantContinuity.sidebarScroll) <= 1);
  await page.locator("#assistant-expand").click();
  assert.equal(await page.locator("#reader").getAttribute("data-assistant-morph-phase"), null);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.locator("#assistant-question").fill("故障态展开连续性");
  await page.locator("#assistant-question").evaluate((question) => {
    question.focus({ preventScroll: true });
    question.setSelectionRange(2, 5);
    question.__assistantFailureMorphIdentity = "same-composer";
  });
  const failureRootId = await page.locator('.assistant-topic-sidebar [aria-selected="true"]')
    .getAttribute("data-root-id");
  const callsBeforeFailure = providerCalls.length;
  failNextAssistantRequest = true;
  await page.locator("#assistant-send").click();
  const failure = page.locator(".assistant-stream-error");
  await failure.waitFor({ state: "visible" });
  assert.equal(providerCalls.length, callsBeforeFailure + 1);
  assert.equal(await failure.locator("button").textContent(), "重试");
  assert.equal(await page.locator("#assistant-question").inputValue(), "故障态展开连续性");
  await page.locator("#assistant-question").focus();
  await page.locator("#assistant-expand").click();
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);
  assert.equal(await failure.isVisible(), true);
  assert.equal(await page.locator("#assistant-question").evaluate(
    (question) => question.__assistantFailureMorphIdentity
  ), "same-composer");
  assert.equal(await page.locator("#assistant-question").evaluate(
    (question) => question === document.activeElement
  ), true);
  assert.equal(await page.locator("#assistant-question").inputValue(), "故障态展开连续性");
  assert.equal(await page.locator('.assistant-topic-sidebar [aria-selected="true"]')
    .getAttribute("data-root-id"), failureRootId);
  await page.locator("#assistant-expand").click();
  await page.waitForFunction(() => !document.querySelector("#reader").dataset.assistantMorphPhase);
  assert.equal(await failure.isVisible(), true);
  assert.equal(await page.locator("#assistant-question").evaluate(
    (question) => question.__assistantFailureMorphIdentity
  ), "same-composer");
  assert.equal(await page.locator("#assistant-question").inputValue(), "故障态展开连续性");
  assert.equal(await page.locator('.assistant-topic-sidebar [aria-selected="true"]')
    .getAttribute("data-root-id"), failureRootId);

  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
  assert.equal(await page.locator("#selection-actions").isVisible(), true);
  await page.locator("#cancel-selection").click();

  const serializedPayloads = JSON.stringify(providerCalls);
  assert.ok(!/assistantDockWidth|dock width|expanded mode|focusedNodeId|scroll position|viewport state/i.test(serializedPayloads));
  const childPayloads = providerCalls
    .map((body) => body.messages.at(-1).content)
    .filter((content) => content.includes("【直接上一轮】"));
  assert.equal(childPayloads.length, 3);
  assert.ok(childPayloads.some((content) => content.startsWith(
    "【当前解释焦点（用户所选）】\n像乐队里的节拍器\n",
  )));
  assert.ok(childPayloads.some((content) => content.startsWith(
    "【当前解释焦点（用户所选）】\n高低电平变化\n",
  )));
  const siblingPayload = childPayloads.find((content) => content.startsWith(
    "【当前解释焦点（用户所选）】\n时钟周期\n",
  ));
  assert.ok(siblingPayload);
  assert.ok(!siblingPayload.includes("第 1 段：节拍由高低电平变化表达"));
  assert.ok(childPayloads.every((content) => (
    !/父子关系|当前解释深度|ORIGINAL_PDF|ASSISTANT_ANSWER|字符范围/.test(content)
  )));
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
    },
    dockResize: "PASS",
    minWidth: minimum,
    maxWidth: maximum,
    readerSelectionAfterResize: "PASS",
    contextMenuAfterResize: "PASS",
    expandedEnter: "PASS",
    expandedExit: "PASS",
    widthRestored: true,
    treeStatePreserved: true,
    scrollPreserved: true,
    rootSwitching: "PASS",
    childPageImmediateFocus: true,
    pendingOwner: "CHILD",
    parentScrollRestored: true,
    parentSelectableAfterBack: true,
    historicalChildrenVisible: true,
    siblingChildCreation: "PASS",
    reopenProviderCalls,
    childSubtreeClose: "PASS",
    siblingSurvivesClose: true,
    currentFocusExact: true,
    markdownMathRendered: true,
    viewportStateInProviderPayload: false,
    providerCalls: providerCalls.length,
    externalProviderCalls: 0,
    normalLayout,
    expandedLayout,
    normalScreenshot,
    screenshot,
    childId,
    grandchildId,
    siblingId,
    askOpenTiming,
    failureMorph: "PASS",
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await new Promise((resolve) => provider.close(resolve));
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function panelMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("#assistant-panel").getBoundingClientRect();
    const viewer = document.querySelector("#viewer").getBoundingClientRect();
    return { panelWidth: panel.width, panelLeft: panel.left, viewerWidth: viewer.width };
  });
}

async function conversationMetrics(page) {
  return page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
    const header = rect(".assistant-heading");
    const turns = document.querySelector('#reader').classList.contains('assistant-expanded') ? rect('#assistant-turns > .assistant-turn') : rect("#assistant-turns");
    const answer = rect('.assistant-answer-bubble[data-current-answer="true"]');
    const question = rect(".assistant-question-bubble");
    const composer = rect("#assistant-follow-up");
    const rootSwitcher = rect("#assistant-topic-trigger");
    const answerElement = document.querySelector('.assistant-answer-bubble[data-current-answer="true"]');
    const answerStyle = getComputedStyle(answerElement);
    const code = answerElement.querySelector("pre");
    return {
      headerWidth: header.width,
      rootSwitcherWidth: rootSwitcher.width,
      turnsWidth: turns.width,
      turnsLeft: turns.left,
      turnsRight: turns.right,
      turnsCenter: turns.left + turns.width / 2,
      answerWidth: answer.width,
      answerLeft: answer.left,
      questionWidth: question.width,
      questionRight: question.right,
      composerWidth: composer.width,
      composerCenter: composer.left + composer.width / 2,
      answerHasCardChrome: answerStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
        || answerStyle.borderTopWidth !== "0px",
      visibleRepeatedHeadings: Array.from(answerElement.querySelectorAll(".assistant-repeated-heading"))
        .filter((element) => element.getClientRects().length > 0).length,
      codeOverflow: getComputedStyle(code).overflowX,
      codeClientWidth: code.clientWidth,
      codeScrollWidth: code.scrollWidth,
    };
  });
}

async function dragDockToWidth(page, width) {
  const handle = page.locator("#assistant-resize-handle");
  const box = await handle.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(VIEWPORT_WIDTH - width, box.y + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(180);
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

async function selectAssistantTextByMouse(page, needle) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const points = await bubble.evaluate((element, text) => {
    const nodes = Array.from(element.querySelectorAll(".assistant-source-text"), (span) => span.firstChild);
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
    const center = (rect, right) => ({
      x: right ? rect.right - 1 : rect.left + 1,
      y: rect.top + rect.height / 2,
    });
    return { start: center(first.getBoundingClientRect(), false), end: center(last.getBoundingClientRect(), true) };
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
  const revisionId = await currentRevisionId(page);
  const overlay = await page.evaluate(async ({ id, index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { id: revisionId, index: pageIndex });
  const line = overlay.lines.find((candidate) => candidate.text.includes(needle));
  assert.ok(line, `OCR line missing: ${needle}`);
  const start = line.text.indexOf(needle);
  const end = start + needle.length;
  const firstCell = line.cells.findIndex((cell) => cell[3] > start && cell[2] < end);
  const lastCell = line.cells.findLastIndex((cell) => cell[3] > start && cell[2] < end);
  const boundaryX = (index) => {
    if (index === 0) return line.cells[0][0];
    if (index === line.cells.length) return line.cells.at(-1)[1];
    return (line.cells[index - 1][1] + line.cells[index][0]) / 2;
  };
  const overlayBox = await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = overlayBox.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * overlayBox.height;
  const startX = overlayBox.x + boundaryX(firstCell) * overlayBox.width;
  const endX = overlayBox.x + boundaryX(lastCell + 1) * overlayBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return page.evaluate(() => getSelection()?.toString() || "");
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
  await waitForReaderOverlay(page, pageIndex);
}

async function waitForReaderOverlay(page, pageIndex) {
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached" });
}

async function startService(extraEnv) {
  const child = spawn(
    process.env.READER_PYTHON || "python",
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

function sendProviderAnswer(response, body, answer) {
  if (!body.stream) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const content of [answer.slice(0, Math.ceil(answer.length / 2)), answer.slice(Math.ceil(answer.length / 2))]) {
    if (content) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  }
  response.write(`data: ${JSON.stringify({
    choices: [{ delta: {}, finish_reason: "stop" }],
    usage: { completion_tokens: answer.length },
  })}\n\n`);
  response.end("data: [DONE]\n\n");
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


async function chooseTopic(page, rootId, nodeId) {
  if (!(await page.locator(".assistant-topic-sidebar").isVisible())) await page.locator("#assistant-topic-trigger").click();
  await page.locator(`.assistant-topic-sidebar [role="treeitem"][data-root-id="${rootId}"][data-node-id="${nodeId || ""}"] span:last-child`).click();
}
