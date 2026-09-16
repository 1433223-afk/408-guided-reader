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

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-ask-deeper-"));
const dataDir = path.join(acceptanceRoot, "data");
const artifacts = path.resolve("test-results");
await mkdir(artifacts, { recursive: true });
await cp(sourceDataDir, dataDir, { recursive: true });
const providerCalls = [];
let controlledChildFailure = false;
let controlledLengthLimit = false;
const mockProvider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerCalls.push({ method: request.method, url: request.url, headers: request.headers, body });
  const latest = body.messages.at(-1)?.content || "";
  const currentFocus = latest.startsWith("【当前解释焦点（用户所选）】\n")
    ? latest.split("\n")[1] : "";
  const isChild = latest.includes("【直接上一轮】");
  const isContinuation = latest.includes("上一条回答因输出长度上限中断");
  if (controlledChildFailure) {
    if (body.stream) {
      response.writeHead(200, {"Content-Type":"text/event-stream; charset=utf-8"});
      response.end(`data: ${JSON.stringify({choices:[{delta:{content:"已收到的部分解释"},finish_reason:null}]})}\n\n`);
    } else {
      response.writeHead(500, {'Content-Type':'application/json'});
      response.end(JSON.stringify({error:{message:'controlled child failure'}}));
    }
    return;
  }
  if (controlledLengthLimit && body.stream && !isContinuation) {
    response.writeHead(200, {"Content-Type":"text/event-stream; charset=utf-8"});
    response.write(`data: ${JSON.stringify({
      choices: [{delta: {content: "前半段尚未结束："}, finish_reason: null}],
    })}\n\n`);
    response.write(`data: ${JSON.stringify({
      choices: [{delta: {content: ""}, finish_reason: "length"}],
      usage: {
        prompt_tokens: 42,
        completion_tokens: body.max_tokens,
        total_tokens: 42 + body.max_tokens,
      },
    })}\n\n`);
    response.end("data: [DONE]\n\n");
    return;
  }
  let answer;
  if (controlledLengthLimit && isContinuation) {
    answer = "后半段已经完整结束。";
  } else if (latest === "延迟回答") {
    await new Promise((resolve) => setTimeout(resolve, 800));
    answer = "这条回答所属的解释已经关闭，因此不应重新出现在界面中。";
  } else if (latest === "为什么？") {
    answer = "因为总线仲裁要在多个请求者中依据优先级决定谁先使用总线。";
  } else if (latest === "再简单一点") {
    answer = "把优先级想成排队号码：号码靠前的请求先使用总线。";
  } else if (isChild && currentFocus === "优先级") {
    await new Promise((resolve) => setTimeout(resolve, 180));
    answer = "优先级是发生竞争时决定先后次序的规则，也可以理解为排队号码。";
  } else if (isChild && currentFocus === "排队号码") {
    await new Promise((resolve) => setTimeout(resolve, 180));
    answer = "排队号码只是帮助理解优先级的比喻；真正执行的是仲裁规则。";
  } else if (isChild && currentFocus === "总线仲裁") {
    await new Promise((resolve) => setTimeout(resolve, 180));
    answer = "总线仲裁负责在多个请求者之间确定本轮由谁使用总线。";
  } else if (isChild && currentFocus) {
    answer = "这个选中概念只结合直接父回答和当前教材范围继续解释。";
  } else {
    answer = "一次总线事务会经过地址、数据与控制阶段；总线仲裁决定多个部件竞争时谁先使用总线。";
  }
  if (body.stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const pieces = answer.match(/.{1,5}/gu) || [];
    for (const piece of pieces) {
      response.write(`data: ${JSON.stringify({choices:[{delta:{content:piece},finish_reason:null}],usage:null})}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
    response.write(`data: ${JSON.stringify({
      choices:[{delta:{content:""},finish_reason:"stop"}],
      usage:{prompt_tokens:42,completion_tokens:18,total_tokens:60},
    })}\n\n`);
    response.end("data: [DONE]\n\n");
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
    }));
  }
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
  assert.ok(servedAsset.body.includes("function captureAssistantAnswerSelection()"),
    "running service served stale Ask Deeper JavaScript");

  const unavailablePage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await unavailablePage.route("**/api/assistant/status", async (route) => {
    const profiles = [
      ["deepseek", "deepseek-flash"],
      ["zhipu", "GLM-5.3-Flash"],
      ["openrouter", "google/gemini-3.8-flash"],
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        active_provider: "deepseek",
        provider: "deepseek",
        configured: true,
        credential_available: true,
        configuration_valid: true,
        endpoint_valid: true,
        model_valid: true,
        cooling: false,
        ai_off_reason: null,
        providers: profiles.map(([provider, model]) => {
          const unavailable = provider === "zhipu";
          return {
            provider,
            model,
            configured: !unavailable,
            credential_available: !unavailable,
            configuration_valid: true,
            endpoint_valid: true,
            model_valid: true,
            cooling: false,
            ai_off_reason: unavailable ? "CREDENTIAL_NOT_FOUND" : null,
            credential_target: `408-guided-reader-${provider}`,
          };
        }),
      }),
    });
  });
  await unavailablePage.goto(running.url);
  await openBook(unavailablePage, 348);
  await selectLine(unavailablePage, 302);
  assert.equal(await unavailablePage.locator("#ask-selection").isEnabled(), true);
  await unavailablePage.locator("#ask-selection").click();
  await unavailablePage.locator("#assistant-first-turn").waitFor({ state: "visible" });
  await unavailablePage.locator("#assistant-model-trigger").click();
  await unavailablePage.locator('#assistant-model-options [data-value="zhipu"]').click();
  assert.equal(providerCalls.length, 0, "opening a draft caused provider egress");
  assert.equal(await unavailablePage.locator("#assistant-start").isDisabled(), true);
  assert.equal(await unavailablePage.locator("#assistant-start").getAttribute("aria-disabled"), "true");
  assert.match(await unavailablePage.locator("#assistant-readiness").textContent(),
    /Zhipu.*408-guided-reader-zhipu.*Windows 用户/);
  assert.equal(await unavailablePage.locator("#assistant-readiness").isVisible(), true);
  await unavailablePage.locator("#assistant-model-trigger").click();
  await unavailablePage.locator('#assistant-model-options [data-value="deepseek"]').click();
  assert.equal(await unavailablePage.locator("#assistant-start").isEnabled(), true);
  assert.equal(await unavailablePage.locator("#assistant-start").getAttribute("aria-disabled"), "false");
  assert.equal(await unavailablePage.locator("#assistant-readiness").isHidden(), true);
  assert.equal(providerCalls.length, 0, "changing draft provider caused provider egress");
  await unavailablePage.close();

  await openBook(page, 348);
  const readyStatus = await json(page, "/api/assistant/status");
  assert.equal(readyStatus.configured, true);
  assert.equal(readyStatus.bakeoff_enabled, true);
  assert.deepEqual(readyStatus.providers.map((provider) => provider.model), [
    "deepseek-flash", "GLM-5.3-Flash", "google/gemini-3.8-flash",
  ]);
  assert.ok(!JSON.stringify(readyStatus).includes("mock-secret-never-inspect"));
  assert.equal(await page.locator("#ask-selection").isDisabled(), true);

  const selected = await selectLine(page, 302);
  if(process.env.READER_SELECTION_CAPTURE) {
    await page.screenshot({path:`test-results/selection-toolbar-${process.env.READER_SELECTION_CAPTURE}.png`});
    await page.locator('#selection-actions').screenshot({path:`test-results/selection-toolbar-${process.env.READER_SELECTION_CAPTURE}-detail.png`});
  }
  if(process.env.READER_SELECTION_CAPTURE === 'after') {
    assert.equal(await page.locator('#highlight-colors').isHidden(),true);
    await page.locator('#save-highlight').click();
    assert.equal(await page.locator('#highlight-colors').isVisible(),true);
    await page.locator('label:has(input[name="highlight-style"][value="GREEN"])').click();
    assert.equal(await page.locator('input[name="highlight-style"][value="GREEN"]').isChecked(),true);
    await page.locator('label:has(input[name="highlight-style"][value="YELLOW"])').click();
    await page.locator('#add-note').click();
    await page.locator('#annotation-note').fill('颜色检查');
    await page.locator('#selection-actions').screenshot({path:'test-results/selection-toolbar-after-note.png'});
    await page.locator('#annotation-note').fill('');
    await page.locator('#add-note').click();
    assert.equal(await page.locator('#note-editor').isHidden(),true);
    await page.locator('#save-highlight').click();
    await page.getByText('高亮已保存。',{exact:true}).waitFor();
    await selectLine(page,302);
    assert.equal(await page.locator('#highlight-colors').isHidden(),true);
  }
  const selectionMenuBox = await page.locator("#selection-actions").boundingBox();
  assert.ok(selectionMenuBox.width < 390);
  assert.equal(await page.locator("#ask-selection").isEnabled(), true);
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  assert.equal(providerCalls.length, 0);
  assert.equal(await page.locator("#assistant-model").isEnabled(), true);
  await page.locator("#assistant-model-trigger").focus();
  await page.locator("#assistant-model-trigger").press('ArrowDown');
  await page.screenshot({path:'test-results/assistant-model-menu.png'});
  await page.locator('#assistant-model-options').screenshot({path:'test-results/assistant-model-menu-detail.png'});
  await page.locator('#assistant-model-options [aria-selected="true"]').press('Escape');
  assert.equal(await page.locator('#assistant-model-options').isHidden(),true);
  await page.locator("#assistant-model-trigger").click();
  await page.locator('#assistant-model-options [data-value="zhipu"]').click();
  await page.evaluate(() => {
    window.__assistantPendingStages = [];
    window.__assistantPendingObserver = new MutationObserver(() => {
      const text = document.querySelector(".assistant-pending")?.textContent;
      if (text && window.__assistantPendingStages.at(-1) !== text) {
        window.__assistantPendingStages.push(text);
      }
    });
    window.__assistantPendingObserver.observe(
      document.querySelector("#assistant-turns"),
      { childList: true, subtree: true, characterData: true },
    );
  });
  const firstResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  const firstHttp = await firstResponse;
  assert.equal(firstHttp.status(), 200);
  const firstRequest = firstHttp.request().postDataJSON();
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const firstState = await focusedAssistantState(page, firstRequest.reader_session_id);
  const firstRoot = firstState.current;
  const pendingStages = await page.evaluate(() => {
    window.__assistantPendingObserver.disconnect();
    return window.__assistantPendingStages;
  });
  assert.ok(pendingStages.includes("准备上下文…"));
  assert.ok(pendingStages.some((stage) => stage.startsWith("正在回答")));
  assert.ok(pendingStages.includes("完成"));
  await page.locator(".assistant-answer-bubble").getByText("总线仲裁", { exact: false }).waitFor();
  await page.screenshot({path:'test-results/assistant-reading-panel.png'});
  await page.locator('#assistant-panel').screenshot({path:'test-results/assistant-reading-panel-detail.png'});
  assert.equal(firstRoot.depth, 1);
  assert.equal(firstState.roots.length, 1);
  assert.equal(firstRoot.scope.key, "PAGE:302");
  assert.equal(firstRoot.provider, "zhipu");
  assert.equal(firstRoot.model, "GLM-5.3-Flash");
  assert.equal(firstRoot.turns[0].question, selected.text);
  assert.equal(firstRequest.source_kind, "ORIGINAL_PDF");
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 1 层，最多 5 层");
  assert.equal(await page.locator("#assistant-model").isDisabled(), true);
  assert.equal(await page.locator("#assistant-model-trigger").isDisabled(), false);

  const followResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/follow-up"));
  await page.locator("#assistant-question").fill("为什么？");
  await page.locator("#assistant-send").click();
  await followResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const followState = await focusedAssistantState(page, firstRequest.reader_session_id);
  assert.equal(followState.current.depth, 1);
  assert.equal(followState.current.turns.length, 2);
  await page.locator(".assistant-answer-bubble").getByText("优先级", { exact: false }).waitFor();

  await page.locator("#assistant-turns").evaluate((element) => {
    element.style.maxHeight = "110px";
    element.scrollTop = Math.min(37, element.scrollHeight - element.clientHeight);
  });
  const rootScroll = await page.locator("#assistant-turns").evaluate((element) => element.scrollTop);
  assert.ok(rootScroll > 0, "Root page was not made scrollable for restoration coverage");

  await selectAssistantAnswerText(page, "优先级");
  const childResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 2 层，最多 5 层");
  assert.equal(await page.locator(".assistant-answer-bubble:not(.assistant-answer-streaming)").count(), 0,
    "Parent answer remained stacked on the pending Child page");
  await childResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const childState = await focusedAssistantState(page, firstRequest.reader_session_id);
  const childAId = childState.current.node_id;
  assert.equal(childState.current.depth, 2);
  assert.equal(childState.current.parent_ref.root_id, firstRoot.root_id);
  assert.equal(childState.current.parent_ref.node_id, null);
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 2 层，最多 5 层");
  assert.match(await page.locator("#assistant-breadcrumb").textContent(), /优先级/);
  assert.equal(await page.locator("#assistant-back").isVisible(), false);

  const childFollowResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/follow-up"));
  await page.locator("#assistant-question").fill("再简单一点");
  await page.locator("#assistant-send").click();
  await childFollowResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const childFollowState = await focusedAssistantState(page, firstRequest.reader_session_id);
  assert.equal(childFollowState.current.depth, 2);
  assert.equal(childFollowState.current.turns.length, 2);
  await page.locator('.assistant-answer-bubble[data-current-answer="true"]')
    .getByText("排队号码", { exact: false }).waitFor();

  await page.locator("#assistant-turns").evaluate((element) => {
    element.scrollTop = Math.min(53, element.scrollHeight - element.clientHeight);
  });
  const childScroll = await page.locator("#assistant-turns").evaluate((element) => element.scrollTop);
  assert.ok(childScroll > 0, "Child page was not scrollable for restoration coverage");

  await selectAssistantAnswerText(page, "排队号码");
  const grandchildResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 3 层，最多 5 层");
  await grandchildResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const grandchildState = await focusedAssistantState(page, firstRequest.reader_session_id);
  const firstDeepNode = grandchildState.current.node_id;
  assert.equal(grandchildState.current.depth, 3);
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 3 层，最多 5 层");
  assert.equal(grandchildState.roots[0].nodes.length, 2);
  await page.screenshot({ path: path.join(artifacts, "ask-deeper-depth-3.png"), fullPage: false });

  const backToChildResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, childAId);
  const backToChild = (await (await backToChildResponse).json()).assistant;
  assert.equal(backToChild.current.node_id, childAId);
  await page.waitForFunction((expected) => (
    document.querySelector("#assistant-turns").scrollTop === expected
  ), childScroll);

  const backToRootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, null);
  const backToRoot = (await (await backToRootResponse).json()).assistant;
  assert.equal(backToRoot.current.depth, 1);
  await page.waitForFunction((expected) => (
    document.querySelector("#assistant-turns").scrollTop === expected
  ), rootScroll);
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), ["优先级"]);

  await selectAssistantAnswerText(page, "总线仲裁");
  const siblingResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await page.locator(".assistant-pending").waitFor({ state: "visible" });
  await siblingResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const siblingState = await focusedAssistantState(page, firstRequest.reader_session_id);
  const childBId = siblingState.current.node_id;
  assert.equal(siblingState.roots[0].nodes.length, 3);

  const siblingBackResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, null);
  await siblingBackResponse;
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), [
    "优先级", "总线仲裁",
  ]);
  const callsBeforeReopen = providerCalls.length;
  const reopenResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, childAId);
  const reopenedState = (await (await reopenResponse).json()).assistant;
  assert.equal(reopenedState.current.node_id, childAId);
  assert.equal(providerCalls.length, callsBeforeReopen);
  assert.ok(reopenedState.roots[0].nodes.some((node) => node.node_id === firstDeepNode));

  const closeChildResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-child"));
  assert.equal(await page.locator("#assistant-close-root").textContent(), "关闭本层解释");
  await page.locator("#assistant-close-root").click();
  const afterChildClose = (await (await closeChildResponse).json()).assistant;
  assert.equal(afterChildClose.current.depth, 1);
  assert.ok(!afterChildClose.roots[0].nodes.some((node) => node.node_id === childAId));
  assert.ok(!afterChildClose.roots[0].nodes.some((node) => node.node_id === firstDeepNode));
  assert.ok(afterChildClose.roots[0].nodes.some((node) => node.node_id === childBId));
  assert.deepEqual(await page.locator("#assistant-child-list button").allTextContents(), ["总线仲裁"]);
  await selectAssistantAnswerText(page, "优先级");
  assert.equal(await page.locator("#assistant-answer-actions").isVisible(), true,
    "Parent answer selection did not recover after closing a Child subtree");
  await page.keyboard.press("Escape");

  const focusSiblingResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, childBId);
  await focusSiblingResponse;

  await page.locator("#assistant-close").click();
  await page.locator("#assistant-panel").waitFor({ state: "hidden" });
  assert.equal(await page.locator('#assistant-toggle').textContent(),'继续解释');
  await page.locator('#assistant-toggle').click();
  await page.locator('#assistant-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('#assistant-root-switcher option').count(),1);
  await page.locator('#assistant-close').click();
  const secondSelected = await selectLine(page, 0);
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assistant-model").isEnabled(), true,
    "a non-Assistant selection must stage a new Root with a fresh model choice");
  await page.locator("#assistant-model-trigger").click();
  await page.locator('#assistant-model-options [data-value="deepseek"]').click();
  const secondResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  await secondResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const secondState = await focusedAssistantState(page, firstRequest.reader_session_id);
  const secondRoot = secondState.current;
  assert.equal(secondState.roots.length, 2);
  assert.equal(secondRoot.depth, 1);
  assert.equal(secondRoot.provider, "deepseek");
  assert.equal(secondRoot.turns[0].question, secondSelected.text);
  assert.equal(await page.locator("#assistant-root-switcher option").count(), 2);

  const switchResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, childBId);
  const switchedState = (await (await switchResponse).json()).assistant;
  assert.equal(switchedState.current.node_id, childBId);
  assert.equal(switchedState.current.depth, 2);
  assert.equal(switchedState.roots.length, 2);
  assert.equal(await page.locator("#assistant-depth").textContent(), "递归深度：第 2 层，最多 5 层");

  const backResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/focus"));
  await chooseTopic(page, firstRoot.root_id, null);
  const backedState = (await (await backResponse).json()).assistant;
  assert.equal(backedState.current.depth, 1);
  assert.equal(backedState.roots.length, 2);

  const delayedFollowResponse = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/follow-up") && response.request().postData()?.includes("延迟回答"),
  );
  const delayedFollowRequest = page.waitForRequest(
    (request) => request.url().endsWith("/assistant/follow-up") && request.postData()?.includes("延迟回答"),
  );
  await page.locator("#assistant-question").fill("延迟回答");
  await page.locator("#assistant-send").click();
  await delayedFollowRequest;
  const closeRootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-root"));
  await page.locator("#assistant-close-root").click();
  const afterClose = (await (await closeRootResponse).json()).assistant;
  assert.equal((await delayedFollowResponse).status(), 200,
    "the SSE request did not start before the Root was closed");
  await page.waitForTimeout(900);
  assert.equal(afterClose.roots.length, 1);
  assert.equal(afterClose.current.root_id, secondRoot.root_id);
  assert.equal(afterClose.roots[0].nodes.length, 0);
  assert.equal(await page.locator("#assistant-root-switcher option").count(), 1);

  const inspection = await json(page, "/api/assistant/inspection");
  assert.equal(inspection.calls.length, providerCalls.length);
  assert.deepEqual(inspection.calls.map((call) => call.request_body), providerCalls.map((call) => call.body));
  const childCall = inspection.calls.find((call) => (
    call.request_body.messages.at(-1).content.includes("【直接上一轮】")
  ));
  assert.ok(childCall);
  assert.deepEqual(childCall.request_body.messages.map((message) => message.role), ["system", "user"]);
  const childContext = childCall.request_body.messages.at(-1).content;
  assert.ok(childContext.startsWith("【当前解释焦点（用户所选）】"));
  assert.ok(childContext.includes("【解释路径（仅用于消歧）】"));
  assert.ok(childContext.includes("【Reader 教材依据（仅用于消歧和 grounding）】"));
  assert.ok(childContext.includes("【同一 PDF 页的有界 OCR 语境】"));
  assert.ok(!childContext.includes("【父子关系】"));
  assert.ok(!childContext.includes("ORIGINAL_PDF"));
  assert.ok(!childContext.includes("字符范围"));
  assert.ok(!JSON.stringify(inspection).includes("mock-secret-never-inspect"));
  assert.ok(!JSON.stringify(inspection).includes("Authorization"));
  assert.deepEqual(providerCalls.slice(0, 6).map((call) => call.body.model), Array(6).fill("GLM-5.3-Flash"));
  assert.equal(providerCalls[6].body.model, "deepseek-flash");
  assert.equal(providerCalls.at(-1).body.model, "GLM-5.3-Flash");

  controlledChildFailure = true;
  await selectAssistantAnswerText(page, "总线仲裁");
  const failedRequest = page.waitForRequest(r=>r.url().endsWith('/assistant/child'));
  const failedResponse = page.waitForResponse(r=>r.url().endsWith('/assistant/child'));
  await page.locator('#assistant-ask-deeper').click();
  const failedPayload = (await failedRequest).postDataJSON();
  assert.equal((await failedResponse).status(),200);
  await failedResponse;
  await page.getByText('已收到的部分解释',{exact:true}).waitFor();
  const retryButton = page.getByRole('button',{name:'重新回答',exact:true});
  await retryButton.waitFor();
  assert.ok(await page.locator('#viewer').isVisible());
  const failedBody=providerCalls.at(-1).body;
  controlledChildFailure = false;
  await page.waitForTimeout(31000); // Existing provider cooldown remains enforced.
  const recoveredResponse=page.waitForResponse(r=>r.url().endsWith('/assistant/retry-child'));
  await retryButton.click();
  await recoveredResponse;
  await page.locator(".assistant-pending").waitFor({state:"detached"});
  const recovered=(await focusedAssistantState(page, firstRequest.reader_session_id)).current;
  assert.equal(recovered.node_id,failedPayload.node_id);
  assert.equal(recovered.root_id,failedPayload.root_id);
  assert.equal(recovered.turns.length,1);
  assert.equal(recovered.error,null);
  assert.deepEqual(providerCalls.at(-1).body,failedBody);
  await page.locator('.assistant-error').waitFor({state:'detached'});

  const antiBypassCalls = providerCalls.length;
  const antiBypass = await page.evaluate(async ({ revisionId, request }) => {
    const response = await fetch(`/api/revisions/${revisionId}/assistant/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, source_kind: "ASSISTANT_ANSWER" }),
    });
    return { status: response.status, body: await response.json() };
  }, { revisionId: await currentRevisionId(page), request: firstRequest });
  assert.equal(antiBypass.status, 409);
  assert.equal(antiBypass.body.code, "ASSISTANT_ASSISTANT_SOURCE_REQUIRES_CHILD");
  assert.equal(providerCalls.length, antiBypassCalls);

  controlledLengthLimit = true;
  const continuedSelection = await selectLine(page, 302);
  await page.locator("#ask-selection").click();
  const limitedRequest = page.waitForRequest(
    (request) => request.url().endsWith("/assistant/ask")
      && !request.postData()?.includes('"continuation"'),
  );
  await page.locator("#assistant-start").click();
  const limitedPayload = (await limitedRequest).postDataJSON();
  await page.getByText("前半段尚未结束：", {exact: true}).waitFor();
  const continueButton = page.getByRole("button", {name: "继续生成", exact: true});
  await continueButton.waitFor();
  assert.equal(await page.getByText("完成", {exact: true}).count(), 0,
    "length-limited response was mislabeled complete");
  const continuationRequest = page.waitForRequest(
    (request) => request.url().endsWith("/assistant/ask")
      && request.postData()?.includes('"continuation"'),
  );
  await continueButton.click();
  const continuationPayload = (await continuationRequest).postDataJSON();
  await page.locator(".assistant-pending").waitFor({state: "detached"});
  controlledLengthLimit = false;
  const continuedState = await focusedAssistantState(page, limitedPayload.reader_session_id);
  assert.equal(continuedState.current.turns[0].question, continuedSelection.text);
  assert.equal(
    continuedState.current.turns[0].answer,
    "前半段尚未结束：后半段已经完整结束。",
  );
  assert.equal(continuationPayload.continuation.partial_answer, "前半段尚未结束：");
  const continuationBody = providerCalls.at(-1).body;
  assert.equal(continuationBody.max_tokens, 8192);
  assert.deepEqual(continuationBody.thinking, {type: "disabled"});
  assert.deepEqual(
    continuationBody.messages.slice(-2).map((message) => message.role),
    ["assistant", "user"],
  );
  assert.equal(continuationBody.messages.at(-2).content, "前半段尚未结束：");
  assert.ok(continuationBody.messages.at(-1).content.includes("从中断处直接继续"));

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  const staleFollowStatus = await page.evaluate(async (payload) => {
    const response = await fetch("/api/assistant/follow-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.status;
  }, {
    reader_session_id: firstRequest.reader_session_id,
    root_id: secondRoot.root_id,
    node_id: null,
    question: "不应继续",
  });
  assert.equal(staleFollowStatus, 404, "Reader close did not clear all temporary roots");
  await openBook(page, 348);
  assert.equal(await page.locator("#assistant-toggle").isVisible(), false,
    "Generic Assistant entry must stay absent without a current temporary context");
  assert.equal(await page.locator("#assistant-root-switcher option").count(), 0,
    "Reader reopen retained stale Root options in the Assistant UI");

  await stopService(running.child);
  running = await startService({
    GUIDED_READER_DEEPSEEK_DISABLED: "1",
    GUIDED_READER_ZHIPU_DISABLED: "1",
    GUIDED_READER_OPENROUTER_DISABLED: "1",
  });
  await page.goto(running.url);
  const siblingBook = (await json(page, "/api/books")).books.find((book) => book.active_revision.page_count !== 348);
  assert.ok(siblingBook, "AI-off cross-book check requires a second real book");
  await openBook(page, siblingBook.active_revision.page_count);
  await selectLine(page, 0);
  assert.equal(await page.locator("#ask-selection").isDisabled(), true);
  assert.equal(await page.locator("#copy-selection").isEnabled(), true);
  await page.keyboard.press("Escape");
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await page.locator("#search-toggle").click();
  await page.locator("#search-panel").waitFor({ state: "visible" });

  console.log(JSON.stringify({
    status: "PASS", failedChildRetrySameIdentityAndGrounding: true,
    depthReached: 3,
    sameLevelDepthStable: true,
    multipleRootsRetained: true,
    rootSwitchRestoredPreviousDepth: true,
    parentBackWorked: true,
    parentScrollRestored: true,
    siblingChildrenRetained: true,
    historicalChildReopenProviderCalls: 0,
    childSubtreeClosePreservedSibling: true,
    closedRootDestroyedOnlyItsSubtree: true,
    inflightClosedRootResponseCancelled: true,
    assistantAnswerAntiBypass: true,
    providerPinnedAcrossTree: "zhipu",
    childPayloadMinimalShape: true,
    readerCloseClearedAllRoots: true,
    aiOffPreservedReaderSelectionOutlineSearch: true,
    screenshot: path.join(artifacts, "ask-deeper-depth-3.png"),
  }));
 } catch(error) {
  for(const [i,p] of (browser?.contexts().flatMap(c=>c.pages()) || []).entries()) { await p.screenshot({path:`test-results/ask-failure-${i}.png`}); console.log(await p.evaluate(()=>({page:document.querySelector('#page-number').value,readerHidden:document.querySelector('#reader').hidden, status:document.querySelector('#status').textContent,canvases:[...document.querySelectorAll('.page canvas')].map(n=>n.parentElement.dataset.index),scroll:document.querySelector('#viewer').scrollTop}))); }
  throw error;
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  await new Promise((resolve) => mockProvider.close(resolve));
  if (running?.errors?.trim()) process.stderr.write(running.errors);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function selectAssistantAnswerText(page, text) {
  const bubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  const point = await bubble.evaluate((element, value) => {
    const nodes = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.parentElement.closest("[data-assistant-unselectable='true']")) {
        nodes.push(walker.currentNode);
      }
    }
    const combined = nodes.map((node) => node.data).join("");
    const offset = combined.indexOf(value);
    if (offset < 0) throw new Error(`answer does not contain ${value}`);
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
    const start = point(offset);
    const end = point(offset + value.length, true);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    const rect = range.getClientRects()[0];
    return { x: rect.left + 1, y: rect.top + rect.height / 2 };
  }, text);
  assert.equal(await page.locator("#assistant-answer-actions").isHidden(), true);
  await bubble.evaluate((element, at) => {
    element.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: at.x, clientY: at.y,
    }));
  }, point);
  await page.locator("#assistant-answer-actions").waitFor({ state: "visible" });
}

async function selectLine(page, pageIndex) {
  await goToPage(page, pageIndex);
  const revisionId = await currentRevisionId(page);
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

async function currentRevisionId(page) {
  return page.evaluate(async () => {
    const pageCount = Number(document.querySelector("#page-total").textContent.match(/\d+/)[0]);
    const books = (await (await fetch("/api/books")).json()).books;
    return books.find((book) => book.active_revision.page_count === pageCount).active_revision.id;
  });
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).getByRole("button", {name:"打开",exact:true}).click();
  await page.locator(".overview-book-heading .primary-action").click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached", timeout: 15_000 });
}

async function focusedAssistantState(page, readerSessionId) {
  const current = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await current.waitFor();
  const target = await current.evaluate((element) => ({
    root_id: element.dataset.rootId,
    node_id: element.dataset.nodeId || null,
  }));
  return page.evaluate(async ({payload, readerSessionId}) => {
    const response = await fetch("/api/assistant/focus", {
      method: "POST",
      headers: {"Content-Type":"application/json", "X-Assistant-View":"current"},
      body: JSON.stringify({reader_session_id: readerSessionId, ...payload}),
    });
    if (!response.ok) throw new Error(`focus state ${response.status}`);
    return (await response.json()).assistant;
  }, {payload: target, readerSessionId});
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


async function chooseTopic(page, rootId, nodeId) {
  if (!(await page.locator(".assistant-topic-sidebar").isVisible())) await page.locator("#assistant-topic-trigger").click();
  await page.locator(`.assistant-topic-sidebar [role="treeitem"][data-root-id="${rootId}"][data-node-id="${nodeId || ""}"] span:last-child`).click();
}
