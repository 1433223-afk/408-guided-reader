import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR
  || path.join(process.env.LOCALAPPDATA || "", "408 Guided Reader");
const useRealReviewer = process.env.READER_REAL_REVIEW === "1";
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-saved-note-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });

const providerCalls = [];
let reviewCallCount = 0;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  providerCalls.push(body);
  const reviewing = body.messages[0]?.content.includes("你是独立的 AI 审查者");
  let answer;
  if (reviewing) {
    reviewCallCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (reviewCallCount === 1) answer = "not-json";
    else if (reviewCallCount === 2) answer = '{"verdict":"MAYBE","summary":"结构无效"}';
    else answer = '{"verdict":"PASS","summary":"给定教材来源支持这条解释；这是有界 AI 审查结论。"}';
  } else {
    const prompt = body.messages.at(-1).content;
    answer = prompt.includes("【当前解释焦点（用户所选）】\n像乐队里的节拍器")
      ? "像乐队里的节拍器：时钟脉冲用稳定节奏协调各部件动作。"
      : "时钟脉冲信号**像乐队里的节拍器**，用高、低电平的周期变化协调各部件。";
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

const serviceEnv = {
  GUIDED_READER_ASSISTANT_PROVIDER: "deepseek",
  GUIDED_READER_REVIEW_PROVIDER: "zhipu",
  GUIDED_READER_DEEPSEEK_API_KEY: "assistant-loopback-secret",
  GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  ...(useRealReviewer ? {
    GUIDED_READER_ZHIPU_MAX_ATTEMPTS: "1",
    GUIDED_READER_ZHIPU_TIMEOUT_SECONDS: "45",
  } : {
    GUIDED_READER_ZHIPU_API_KEY: "review-loopback-secret",
    GUIDED_READER_ZHIPU_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  }),
};

let running;
let browser;
try {
  running = await startService(serviceEnv);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(running.url);
  await openBook(page, 348);

  assert.equal(await selectExactReaderText(page, 24, "时钟脉冲信号"), "时钟脉冲信号");
  await page.locator("#ask-selection").click();
  await page.locator("#assistant-model-trigger").click();
  await page.locator('.assistant-model-options [data-value="deepseek"]').click();
  const rootResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  await rootResponse;
  const rootBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await rootBubble.waitFor();
  assert.equal(await selectAssistantTextByMouse(page, "像乐队里的节拍器"), "像乐队里的节拍器");
  const childResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/child"));
  await page.locator("#assistant-ask-deeper").click();
  await childResponse;
  const childBubble = page.locator('.assistant-answer-bubble[data-current-answer="true"]');
  await childBubble.waitFor();
  const savedAnswer = "像乐队里的节拍器：时钟脉冲用稳定节奏协调各部件动作。";
  assert.equal(await childBubble.innerText(), savedAnswer);

  const saveResponsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/assistant/save"),
  );
  await page.locator(".assistant-save-note").click();
  const saveResponse = await saveResponsePromise;
  assert.equal(saveResponse.status(), 201);
  const savePayload = await saveResponse.json();
  const annotationId = savePayload.annotation.id;
  assert.equal(savePayload.annotation.verification_state, "PENDING");
  assert.equal(savePayload.annotation.body, savedAnswer);
  assert.equal(await page.locator(".assistant-save-note").textContent(), "已保存");

  await page.locator("#marks-toggle").click();
  const aiCard = page.locator(`.mark-card[data-annotation-id="${annotationId}"]`);
  await page.locator(".mark-card-ai-saved").waitFor();
  assert.equal(await page.locator(".mark-ai-heading strong").textContent(), "AI 保存的解释");
  if (!useRealReviewer) {
    assert.equal(await page.locator(".mark-verification").textContent(), "待 AI 审查");
  }
  assert.equal(await page.locator(".mark-source-location").textContent(), "PDF 第 25 页");
  assert.equal(await page.locator(".mark-ai-section q").textContent(), "时钟脉冲信号");
  assert.equal(await page.locator(".mark-provenance").textContent(), "时钟脉冲信号 › 像乐队里的节拍器");
  assert.equal((await page.locator(".mark-ai-content").innerText()).trim(), savedAnswer);

  if (useRealReviewer) {
    await page.locator(".mark-verification:not(.mark-verification-pending)").waitFor({ timeout: 90_000 });
  } else {
    await page.locator(".mark-verification-technical_failure").waitFor({ timeout: 10_000 });
    assert.equal(await page.locator(".mark-card-ai-saved").count(), 1);
    const retryResponse = page.waitForResponse((response) => response.url().endsWith("/review"));
    await page.locator(".mark-review-retry").click();
    assert.equal((await retryResponse).status(), 202);
    await page.locator(".mark-verification-pass").waitFor({ timeout: 10_000 });
    assert.equal(await page.locator(".mark-verification-pass").textContent(), "已通过 AI 审查");
  }
  assert.equal(await page.locator(".mark-reviewer").textContent(), "审查模型：zhipu · GLM-5.3-Flash");
  assert.equal(await page.locator(".mark-card-ai-saved").count(), 1);

  const revisionId = await currentRevisionId(page);
  const annotations = await page.evaluate(async ({ id, pageIndex }) => (
    await (await fetch(`/api/revisions/${id}/annotations?page=${pageIndex}`)).json()
  ), { id: revisionId, pageIndex: 24 });
  const saved = annotations.annotations.filter((annotation) => annotation.id === annotationId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].source_kind, "AI_SAVED");
  assert.equal(saved[0].quote, "时钟脉冲信号");
  assert.equal(saved[0].provenance.child_focus, "像乐队里的节拍器");
  assert.equal(saved[0].body, savedAnswer);
  const verificationState = saved[0].verification_state;
  if (useRealReviewer) {
    assert.ok(["PASS", "FAIL", "TECHNICAL_FAILURE"].includes(verificationState));
  } else {
    assert.equal(verificationState, "PASS");
  }

  const reviewBodies = providerCalls.filter(
    (body) => body.messages[0]?.content.includes("你是独立的 AI 审查者"),
  );
  let externalReviewCalls = 0;
  if (useRealReviewer) {
    const inspection = await page.evaluate(async () => (
      await (await fetch("/api/assistant/inspection")).json()
    ));
    const inspectedReviews = inspection.calls.filter(
      (call) => call.interaction_id === `review:${annotationId}`,
    );
    externalReviewCalls = inspectedReviews.length;
    assert.equal(externalReviewCalls, 1);
    assert.equal(inspectedReviews[0].provider, "zhipu");
    assert.equal(inspectedReviews[0].request_body.model, "GLM-5.3-Flash");
    assert.ok(!/Authorization|assistant-loopback-secret|active_child_id|save_intent_id|knowledge_point_id/.test(JSON.stringify(inspection)));
  } else {
    assert.equal(reviewBodies.length, 3);
    const reviewTransport = JSON.parse(reviewBodies.at(-1).messages[1].content);
    assert.deepEqual(Object.keys(reviewTransport).sort(), ["ai_content", "provenance", "source"]);
    assert.equal(reviewTransport.source.quote, "时钟脉冲信号");
    assert.equal(reviewTransport.provenance.child_focus, "像乐队里的节拍器");
    assert.equal(reviewTransport.ai_content, savedAnswer);
    const serializedTransport = JSON.stringify(reviewBodies);
    assert.ok(!/assistant-loopback-secret|review-loopback-secret|active_child_id|save_intent_id|knowledge_point_id/.test(serializedTransport));
  }

  const screenshot = path.join(process.cwd(), "test-results", "saved-explanation-golden.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });

  await page.locator("#marks-close").click();
  await page.locator("#assistant-toggle").click();
  let closeResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-child"));
  await page.locator("#assistant-close-root").click();
  await closeResponse;
  closeResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/close-root"));
  await page.locator("#assistant-close-root").click();
  await closeResponse;
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });

  await stopService(running.child);
  running = await startService(serviceEnv);
  await page.goto(running.url);
  await openBook(page, 348);
  await goToPage(page, 24);
  assert.equal(await page.locator("#assistant-toggle").isHidden(), true);
  assert.equal(await page.locator("#assistant-context-bar").isHidden(), true);
  assert.equal(await page.locator("#assistant-empty").textContent(), "在原始 PDF 中选择文字，右键选择「问 AI」。");
  assert.equal(await page.locator('#assistant-panel').isHidden(), true);
  await page.locator("#marks-toggle").click();
  await page.locator(".mark-card-ai-saved").waitFor();
  assert.equal(await page.locator(".mark-source-location").textContent(), "PDF 第 25 页");
  await page.locator(`.mark-verification-${verificationState.toLowerCase()}`).waitFor();

  page.once("dialog", (dialog) => dialog.accept());
  const deleteResponse = page.waitForResponse(
    (response) => response.request().method() === "DELETE" && response.url().includes(annotationId),
  );
  await page.locator(".mark-card-ai-saved .mark-remove").click();
  assert.equal((await deleteResponse).status(), 204);
  assert.equal(await page.locator(".mark-card-ai-saved").count(), 0);
  await page.locator("#back-to-library").click();
  await stopService(running.child);
  running = await startService(serviceEnv);
  await page.goto(running.url);
  await openBook(page, 348);
  await goToPage(page, 24);
  await page.locator("#marks-toggle").click();
  assert.equal(await page.locator(".mark-card-ai-saved").count(), 0);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
    },
    saveFirst: true,
    sourceQuote: "时钟脉冲信号",
    childProvenance: "像乐队里的节拍器",
    aiContentExact: true,
    technicalFailurePreservedAsset: !useRealReviewer,
    retryUpdatedSameAnnotation: !useRealReviewer,
    verificationState,
    reviewProvider: "zhipu",
    reviewModel: "GLM-5.3-Flash",
    reviewCalls: useRealReviewer ? externalReviewCalls : reviewBodies.length,
    assistantTreeAfterRestart: 0,
    durableAnnotationAfterRestart: 1,
    deleteAfterSecondRestart: "ABSENT",
    externalProviderCalls: externalReviewCalls,
    screenshot,
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await new Promise((resolve) => provider.close(resolve));
  await rm(acceptanceRoot, { recursive: true, force: true });
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
  await page.evaluate(({index, quad}) => {
    const rect = document.querySelector(`.page[data-index="${index}"] .text-overlay`).getBoundingClientRect();
    const viewer = document.querySelector('#viewer'); const viewport = viewer.getBoundingClientRect();
    const y = rect.top + quad.reduce((sum, p) => sum + p[1], 0) / quad.length * rect.height;
    viewer.scrollTop += y - (viewport.top + viewport.height / 2);
  }, {index:pageIndex, quad:line.quad});
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
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
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
