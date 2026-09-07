import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const expectedHash = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd";
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-knowledge-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
resetCopiedKnowledgeState();

const transports = [];
const generationCallsBySection = new Map();
let failingSectionId = null;
let repairTargetSectionId = null;
let reviewCallCount = 0;
const reasoningCanary = "PRIVATE_PROVIDER_REASONING_MUST_NOT_BE_STORED";
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  transports.push(body);
  const system = body.messages[0]?.content || "";
  let answer;
  let finishReason = "stop";
  let reasoningContent = "";
  if (system.includes("内部 KP 生成器")) {
    const payload = JSON.parse(body.messages[1].content);
    const semanticRepair = Object.hasOwn(payload, "repair_context");
    assert.deepEqual(
      Object.keys(payload).sort(),
      semanticRepair
        ? ["chapter", "outline", "repair_context", "source_section"]
        : ["chapter", "outline", "source_section"],
    );
    const section = payload.source_section;
    failingSectionId ??= section.section_id;
    if (section.section_id !== failingSectionId) repairTargetSectionId ??= section.section_id;
    const callCount = (generationCallsBySection.get(section.section_id) || 0) + 1;
    generationCallsBySection.set(section.section_id, callCount);
    if (section.section_id === failingSectionId && callCount <= 3) {
      answer = "";
      finishReason = "length";
      reasoningContent = reasoningCanary;
      await delay(700);
    } else {
      const genericCandidate = section.section_id === repairTargetSectionId && !semanticRepair;
      answer = JSON.stringify({ knowledge_points: [{
        draft_key: `chapter6-${section.section_id}${semanticRepair ? "-repaired" : ""}`,
        primary_section_id: section.section_id,
        title: genericCandidate ? "问题解决" : `${section.title}的核心内容`,
        one_sentence_definition: genericCandidate
          ? "这是泛化的认知动作，不是可独立追踪的学科知识。"
          : `概括 ${section.title} 中需要独立理解的核心内容。`,
        start_ref: section.lines[0].line_ref,
        end_ref: section.lines.at(-1).line_ref,
      }] });
      await delay(semanticRepair ? 1600 : 250);
    }
  } else if (system.includes("Chapter Knowledge Map 结构审查者")) {
    const payload = JSON.parse(body.messages[1].content);
    reviewCallCount += 1;
    const genericIndex = payload.candidate_knowledge_points.findIndex(
      (candidate) => candidate.title === "问题解决",
    );
    answer = reviewCallCount === 1
      ? JSON.stringify({
        verdict: "FAIL",
        summary: "一个候选是泛化认知动作，须定点修复对应小节。",
        findings: [{
          dimension: "instructional_specificity",
          severity: "BLOCKING",
          candidate_indices: [genericIndex],
          evidence_section_ids: [repairTargetSectionId],
          repair_section_ids: [repairTargetSectionId],
          detail: "“问题解决”不是教材中的学科知识；重新生成该小节的具体学习单元。",
        }],
      })
      : JSON.stringify({
        verdict: "PASS",
        summary: "定点修复后，整章候选的颗粒度、重复、教学特异性、拆分合并、覆盖和均衡均通过。",
        findings: [],
      });
    if (reviewCallCount === 1) assert.ok(genericIndex >= 0);
    await delay(500);
  } else {
    answer = "学习地图准备失败不会影响这条临时解释。";
    await delay(120);
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { content: answer, reasoning_content: reasoningContent }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: answer.length, total_tokens: 100 + answer.length },
  }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

const serviceEnv = {
  GUIDED_READER_ASSISTANT_PROVIDER: "deepseek",
  GUIDED_READER_KP_GENERATOR_PROVIDER: "deepseek",
  GUIDED_READER_KP_REVIEW_PROVIDER: "zhipu",
  GUIDED_READER_DEEPSEEK_API_KEY: "knowledge-generator-loopback-secret",
  GUIDED_READER_ZHIPU_API_KEY: "knowledge-review-loopback-secret",
  GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  GUIDED_READER_ZHIPU_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
};

let running;
let browser;
try {
  running = await startService(serviceEnv);
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(running.url);
  const book = await openBook(page, 348);
  assert.equal(book.active_revision.blob_sha256, expectedHash);
  const revisionId = book.active_revision.id;

  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  const outlineBefore = await json(page, `/api/revisions/${revisionId}/outline`);
  const chapter6 = outlineBefore.nodes.find((node) => node.title === "第6章 总线");
  assert.ok(chapter6, "Chapter 6 missing from real Outline");
  const chapter6Ids = subtreeIds(outlineBefore.nodes, chapter6.outline_node_id);
  const logicalBefore = logicalProjection(outlineBefore.nodes);
  const physicalBefore = new Map(outlineBefore.nodes.map((node) => [
    node.outline_node_id,
    [node.start_page, node.start_y, node.end_page, node.end_y, node.resolution_state, node.physical_revision],
  ]));

  await page.locator(`li[data-node-id="${chapter6.outline_node_id}"] > .outline-row .outline-map-action`).click();
  await page.locator("#knowledge-panel").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#knowledge-status")?.textContent.includes("尚未准备"));
  assert.match(await page.locator("#knowledge-status").textContent(), /尚未准备/);
  assert.equal(await page.locator("#knowledge-map").locator("li").count(), 0);

  const prepareResponse = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/prepare"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await prepareResponse).status(), 202);
  const preparing = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(preparing.status, "PREPARING");
  assert.deepEqual(preparing.knowledge_points, []);
  const duplicate = await page.evaluate(async (url) => Promise.all([
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((response) => response.json()),
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((response) => response.json()),
  ]), `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map/prepare`);
  assert.equal(duplicate[0].chapter_map.attempt_id, duplicate[1].chapter_map.attempt_id);

  await page.waitForFunction(() => {
    const status = document.querySelector("#knowledge-status")?.textContent || "";
    return status.includes("正在按小节生成知识点") && /已完成 [1-9]\d*\/\d+ 个小节/.test(status);
  }, null, { timeout: 20_000 });
  assert.equal(await page.locator("#knowledge-map li").count(), 0);
  await page.waitForFunction(() => document.querySelector("#knowledge-status")?.textContent.includes("准备失败"), null, { timeout: 20_000 });
  assert.equal(await page.locator("#knowledge-map li").count(), 0);
  const failed = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failure_stage, "GENERATION");
  assert.equal(failed.failure_code, "empty_response");
  const failedInspection = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map/inspection`);
  const failedTransportAttempts = failedInspection.generation_attempts.filter(
    (attempt) => attempt.preparation_attempt_id === failed.attempt_id,
  );
  const failedSectionAttempts = failedTransportAttempts.filter(
    (attempt) => attempt.primary_section_id === failingSectionId,
  );
  assert.equal(failedSectionAttempts.length, 3);
  assert.ok(failedSectionAttempts.every((attempt) => (
    attempt.status === "FAILED"
      && attempt.failure_code === "empty_response"
      && attempt.finish_reason === "length"
      && attempt.content_present === 0
      && attempt.reasoning_present === 1
      && attempt.reasoning_length === reasoningCanary.length
  )));
  const successfulSibling = failedTransportAttempts.find((attempt) => attempt.status === "SUCCEEDED");
  assert.ok(successfulSibling, "a sibling Section should finish while the delayed Section retries");
  assert.equal(failedTransportAttempts.filter(
    (attempt) => attempt.primary_section_id === successfulSibling.primary_section_id,
  ).length, 1);
  assert.ok(!JSON.stringify(failedInspection.generation_attempts).includes(reasoningCanary));

  await page.locator("#search-toggle").click();
  await page.locator("#search-query").fill("总线事务");
  await page.locator("#search-form").getByRole("button", { name: "搜索" }).click();
  await page.locator(".search-result").first().waitFor();
  await page.locator("#search-close").click();
  const outlineReload = page.waitForResponse((response) => response.url().endsWith("/outline"));
  await page.locator("#outline-toggle").click();
  await outlineReload;
  const section62 = outlineBefore.nodes.find((node) => node.title === "6.2 总线事务和定时");
  await expandAncestors(page, outlineBefore.nodes, section62);
  await page.locator(`li[data-node-id="${section62.outline_node_id}"] > .outline-row .outline-target`).click();
  await page.waitForFunction(() => document.querySelector("#page-number")?.value === "303");

  assert.equal(await selectExactReaderText(page, revisionId, 302, "总线事务"), "总线事务");
  await page.locator("#save-highlight").click();
  await page.locator("#marks-toggle").click();
  await page.locator(".mark-card").first().waitFor();
  await page.locator("#marks-close").click();
  assert.equal(await selectExactReaderText(page, revisionId, 302, "总线事务"), "总线事务");
  await page.locator("#ask-selection").waitFor({ state: "visible" });
  await page.locator("#ask-selection").click();
  const assistantResponse = page.waitForResponse((response) => response.url().endsWith("/assistant/ask"));
  await page.locator("#assistant-start").click();
  assert.equal((await assistantResponse).status(), 200);
  await page.getByText("学习地图准备失败不会影响这条临时解释。", { exact: true }).waitFor();
  await page.locator("#assistant-close").click();

  await openKnowledge(page, chapter6.outline_node_id);
  assert.match(await page.locator("#knowledge-status").textContent(), /准备失败/);
  await page.evaluate(() => {
    window.__knowledgeStatusHistory = [];
    const status = document.querySelector("#knowledge-status");
    new MutationObserver(() => window.__knowledgeStatusHistory.push(status.textContent || ""))
      .observe(status, { childList: true, subtree: true, characterData: true });
  });
  const retryResponse = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/prepare"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await retryResponse).status(), 202);
  await page.waitForFunction(() => document.querySelectorAll("#knowledge-map .knowledge-section").length === 4, null, { timeout: 20_000 });
  const ready = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(ready.status, "READY");
  assert.equal(ready.structure_version, 1);
  assert.equal(ready.knowledge_points.length, 4);
  assert.equal(new Set(ready.knowledge_points.map((point) => point.knowledge_point_id)).size, 4);
  assert.equal(await page.locator("#knowledge-map .knowledge-section").count(), 4);
  assert.equal(await page.locator("#knowledge-map li").count(), 4);
  const statusHistory = await page.evaluate(() => window.__knowledgeStatusHistory);
  assert.ok(statusHistory.some((status) => (
    status.includes("正在按小节生成知识点") && status.includes("已完成 0/1 个小节")
  )), `missing targeted repair progress: ${JSON.stringify(statusHistory)}`);

  const inspection = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map/inspection`);
  assert.equal(inspection.attempts.length, 2);
  assert.deepEqual(inspection.attempts.map((attempt) => attempt.outcome), ["FAILED", "READY"]);
  for (const attempt of inspection.attempts) {
    assert.equal(attempt.source_payload.chapter.chapter_outline_node_id, chapter6.outline_node_id);
    assert.deepEqual(Object.keys(attempt.source_payload).sort(), ["chapter", "outline", "source_sections"]);
    assert.deepEqual(Object.keys(attempt).includes("generation_payloads"), true);
    assert.ok(attempt.generation_payloads.every((payload) => (
      Object.keys(payload).sort().join(",") === "chapter,outline,source_section"
    )));
    if (attempt.review_payload) assert.deepEqual(Object.keys(attempt.review_payload).sort(), [
      "bounded_source", "candidate_knowledge_points", "chapter", "generation_provenance", "outline",
      "overlap_warnings", "review_rubric",
    ]);
    const serialized = JSON.stringify(attempt);
    assert.ok(!/本节习题精选|答案与解析|knowledge-generator-loopback-secret|knowledge-review-loopback-secret/.test(serialized));
    assert.ok(attempt.source_payload.source_sections.every((section) => (
      section.lines.every((line) => line.pdf_page_index >= 292 && line.pdf_page_index <= 308)
    )));
  }
  assert.equal(reviewCallCount, 2);
  const readyAttemptId = inspection.attempts[1].attempt_id;
  const readyGenerationAttempts = inspection.generation_attempts.filter(
    (attempt) => attempt.preparation_attempt_id === readyAttemptId,
  );
  const repairAttempts = readyGenerationAttempts.filter(
    (attempt) => attempt.interaction_id.startsWith("kp-repair:"),
  );
  assert.equal(repairAttempts.length, 1);
  assert.equal(repairAttempts[0].primary_section_id, repairTargetSectionId);
  assert.equal(repairAttempts[0].structured_attempt, 3);
  assert.equal(readyGenerationAttempts.filter(
    (attempt) => attempt.primary_section_id === repairTargetSectionId,
  ).length, 2);
  assert.ok(readyGenerationAttempts.filter(
    (attempt) => attempt.primary_section_id !== repairTargetSectionId,
  ).every((attempt) => attempt.structured_attempt === 1));

  const outlineAfter = await json(page, `/api/revisions/${revisionId}/outline`);
  assert.deepEqual(logicalProjection(outlineAfter.nodes), logicalBefore);
  const physicallyChanged = outlineAfter.nodes.filter((node) => (
    JSON.stringify(physicalBefore.get(node.outline_node_id)) !== JSON.stringify([
      node.start_page, node.start_y, node.end_page, node.end_y, node.resolution_state, node.physical_revision,
    ])
  ));
  assert.ok(physicallyChanged.every((node) => chapter6Ids.has(node.outline_node_id)));
  assert.ok(physicallyChanged.every((node) => ["CHAPTER", "SECTION", "SUBSECTION"].includes(node.kind)));
  if (physicallyChanged.length === 0) {
    const chapterNodes = outlineAfter.nodes.filter((node) => chapter6Ids.has(node.outline_node_id));
    assert.ok(chapterNodes.filter((node) => ["CHAPTER", "SECTION", "SUBSECTION"].includes(node.kind))
      .every((node) => node.resolution_state === "RESOLVED"));
  }

  const firstPoint = ready.knowledge_points[0];
  await page.locator("#knowledge-map .knowledge-section li button").first().click();
  await page.waitForFunction((number) => document.querySelector("#page-number")?.value === String(number), firstPoint.start_page + 1);
  await page.locator(`.page[data-index="${firstPoint.start_page}"] canvas`).waitFor({ state: "visible" });

  const screenshot = path.join(process.cwd(), "test-results", "knowledge-map-golden.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await openKnowledge(page, chapter6.outline_node_id);
  await page.screenshot({ path: screenshot });

  const idsBeforeRestart = ready.knowledge_points.map((point) => point.knowledge_point_id);
  await page.locator("#knowledge-close").click();
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  const reopenedBeforeRestartBook = await openBook(page, 348);
  assert.equal(reopenedBeforeRestartBook.active_revision.id, revisionId);
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor();
  await openKnowledge(page, chapter6.outline_node_id);
  await page.locator("#knowledge-map .knowledge-section").first().waitFor();
  const reopenedBeforeRestart = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(reopenedBeforeRestart.structure_version, 1);
  assert.deepEqual(reopenedBeforeRestart.knowledge_points.map((point) => point.knowledge_point_id), idsBeforeRestart);

  await stopService(running.child);
  running = await startService(serviceEnv);
  await page.goto(running.url);
  const reopenedBook = await openBook(page, 348);
  assert.equal(reopenedBook.active_revision.id, revisionId);
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor();
  await openKnowledge(page, chapter6.outline_node_id);
  await page.locator("#knowledge-map .knowledge-section").first().waitFor();
  const reopened = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(reopened.structure_version, 1);
  assert.deepEqual(reopened.knowledge_points.map((point) => point.knowledge_point_id), idsBeforeRestart);

  await page.locator("#knowledge-close").click();
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  page.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /学习地图/);
    await dialog.accept();
  });
  const card = page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" });
  const deletion = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().includes("/api/books/"));
  await card.getByRole("button", { name: "删除", exact: true }).click();
  assert.equal((await deletion).status(), 204);
  await page.waitForFunction(() => document.querySelectorAll(".book-card").length === 1);
  const remaining = await json(page, "/api/books");
  assert.equal(remaining.books.length, 1);
  assert.equal(remaining.books[0].active_revision.page_count, 29);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: { pages: 348, sha256: expectedHash, chapter: "第6章 总线" },
    oneChapterOnly: true,
    outlineLogicalIdentityPreserved: true,
    atomicVisibility: true,
    failureRecovery: "GENERATION_EMPTY_RESPONSE -> retry -> REVIEW_FINDING -> targeted Section repair -> READY",
    structureVersion: ready.structure_version,
    knowledgePointCount: ready.knowledge_points.length,
    sectionGroups: await page.locator("#knowledge-map .knowledge-section").count().catch(() => 0),
    generator: `${ready.generator_provider}/${ready.generator_model}`,
    reviewer: `${ready.reviewer_provider}/${ready.reviewer_model}`,
    stableIdsAfterRestart: true,
    bookCascade: "PASS",
    siblingBookPreserved: true,
    screenshot,
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await new Promise((resolve) => provider.close(resolve));
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function openBook(page, pageCount) {
  const books = (await json(page, "/api/books")).books;
  const book = books.find((value) => value.active_revision?.page_count === pageCount);
  assert.ok(book, `missing ${pageCount}-page real book`);
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  return book;
}

async function openKnowledge(page, chapterId) {
  const panel = page.locator("#knowledge-panel");
  if (await panel.isVisible()) await page.locator("#knowledge-close").click();
  const outlinePanel = page.locator("#outline-panel");
  if (await outlinePanel.isHidden()) {
    const reloaded = page.waitForResponse((response) => response.url().endsWith("/outline"));
    await page.locator("#outline-toggle").click();
    await reloaded;
  }
  await outlinePanel.waitFor({ state: "visible" });
  await page.locator(`li[data-node-id="${chapterId}"] > .outline-row .outline-map-action`).click();
  await panel.waitFor({ state: "visible" });
}

async function expandAncestors(page, nodes, target) {
  const byId = new Map(nodes.map((node) => [node.outline_node_id, node]));
  const ancestors = [];
  let parent = byId.get(target.parent_id);
  while (parent) {
    ancestors.unshift(parent);
    parent = byId.get(parent.parent_id);
  }
  for (const node of ancestors) {
    const targetButton = page.locator(`li[data-node-id="${node.outline_node_id}"] > .outline-row .outline-target`);
    if (await targetButton.getAttribute("aria-expanded") === "false") await targetButton.click();
  }
}

async function selectExactReaderText(page, revisionId, pageIndex, needle) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  const pageNode = page.locator(`.page[data-index="${pageIndex}"]`);
  await pageNode.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await pageNode.locator(".text-overlay").waitFor({ state: "attached" });
  const overlay = (await json(page, `/api/revisions/${revisionId}/overlay?page=${pageIndex}`)).page;
  const line = overlay.lines.find((candidate) => candidate.text.includes(needle));
  assert.ok(line, `OCR line missing ${needle}`);
  const start = line.text.indexOf(needle);
  const end = start + needle.length;
  const firstCell = line.cells.findIndex((cell) => cell[3] > start && cell[2] < end);
  const lastCell = line.cells.findLastIndex((cell) => cell[3] > start && cell[2] < end);
  const boundaryX = (index) => index === 0 ? line.cells[0][0]
    : index === line.cells.length ? line.cells.at(-1)[1]
      : (line.cells[index - 1][1] + line.cells[index][0]) / 2;
  const box = await pageNode.locator(".text-overlay").boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = box.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * box.height;
  const x0 = box.x + boundaryX(firstCell) * box.width;
  const x1 = box.x + boundaryX(lastCell + 1) * box.width;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x1, y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.click((x0 + x1) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return page.evaluate(() => getSelection()?.toString() || "");
}

function subtreeIds(nodes, rootId) {
  const result = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (result.has(node.parent_id) && !result.has(node.outline_node_id)) {
        result.add(node.outline_node_id);
        changed = true;
      }
    }
  }
  return result;
}

function logicalProjection(nodes) {
  return nodes.map((node) => [
    node.outline_node_id, node.parent_id, node.depth, node.order_index,
    node.kind, node.title, node.identity_revision,
  ]).sort((a, b) => a[0].localeCompare(b[0]));
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }, url);
}

async function startService(extraEnv) {
  const child = spawn(
    process.env.READER_PYTHON || "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
    const timeout = setTimeout(() => reject(new Error(errors() || output)), 20_000);
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resetCopiedKnowledgeState() {
  const database = path.join(dataDir, "state.sqlite3");
  const script = [
    "import sqlite3, sys",
    "connection = sqlite3.connect(sys.argv[1])",
    "connection.execute(\"PRAGMA foreign_keys = ON\")",
    "connection.execute(\"DELETE FROM jobs WHERE job_type = 'CHAPTER_PREPARE'\")",
    "connection.execute(\"DELETE FROM chapter_preparations\")",
    "connection.commit()",
    "connection.close()",
  ].join("; ");
  const reset = spawnSync(process.env.READER_PYTHON || "python", ["-c", script, database], {
    cwd: process.cwd(), windowsHide: true, encoding: "utf8",
  });
  if (reset.status !== 0) throw new Error(reset.stderr || "failed to reset copied Knowledge state");
}
