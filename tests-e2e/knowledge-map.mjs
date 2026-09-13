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
await mkdir(dataDir);
await cp(path.join(sourceDataDir,'blobs'),path.join(dataDir,'blobs'),{recursive:true});
const backup=spawnSync(process.env.READER_PYTHON || 'python',['-c','import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',path.join(sourceDataDir,'state.sqlite3'),path.join(dataDir,'state.sqlite3')],{windowsHide:true,encoding:'utf8'});
assert.equal(backup.status,0,backup.stderr);
resetCopiedKnowledgeState();

const transports = [];
const generationCallsByWindow = new Map();
let failingWindowId = null;
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
  if (system.includes("内部语义归并器")) {
    assert.deepEqual(body.thinking, { type: "disabled" });
    const payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(payload).sort(), ["chapter", "section", "units", "window"]);
    assert.deepEqual(Object.keys(payload.window).sort(), [
      "kind", "kp_creation", "outline_subsection_id", "title", "window_id",
    ]);
    assert.ok(payload.units.every(
      (unit) => Object.keys(unit).sort().join(",") === "text,unit_id",
    ));
    const windowId = payload.window.window_id;
    failingWindowId ??= windowId;
    const callCount = (generationCallsByWindow.get(windowId) || 0) + 1;
    generationCallsByWindow.set(windowId, callCount);
    if (windowId === failingWindowId && callCount === 1) {
      answer = "";
      finishReason = "length";
      reasoningContent = reasoningCanary;
      await delay(700);
    } else {
      const nonMinting = payload.window.kp_creation === "FORBIDDEN_REVIEW_MATERIAL";
      answer = JSON.stringify({
        learning_targets: nonMinting ? [] : [{
          unit_ids: payload.units.map((unit) => unit.unit_id),
          title: `${payload.window.title}：核心学习单元`,
          one_sentence_meaning: `概括 ${payload.window.title} 中需要独立理解的学科内容。`,
        }],
        non_kp_units: nonMinting ? payload.units.map((unit) => unit.unit_id) : [],
      });
      await delay(1000);
    }
  } else if (system.includes("Chapter Knowledge Map 结构审查者")) {
    assert.equal(body.reasoning_effort, "low");
    assert.equal(body.thinking, undefined);
    const payload = JSON.parse(body.messages[1].content);
    reviewCallCount += 1;
    const firstWindow = payload.windows.find((window) => window.learning_targets.length > 0);
    answer = reviewCallCount === 1
      ? JSON.stringify({
        verdict: "FAIL",
        summary: "一个候选存在阻断性拆分问题，本次准备应终止。",
        findings: [{
          dimension: "split_merge_quality",
          severity: "BLOCKING",
          section_id: firstWindow.section_id,
          unit_ids: firstWindow.learning_targets[0].unit_ids,
          detail: "这些 evidence units 不应形成当前独立学习状态。",
        }],
      })
      : JSON.stringify({
        verdict: "PASS",
        summary: "显式用户重试的新准备通过整章结构审查。",
        findings: [],
      });
    assert.ok(firstWindow);
    await delay(700);
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
  if(process.env.READER_KP_LIST_ONLY === '1') {
    const books=(await json(page,'/api/books')).books;
    const book=books.find(b=>b.active_revision?.page_count===348);
    assert.equal(book.active_revision.blob_sha256,expectedHash);
    await page.locator('.book-card').filter({hasText:'348 个 PDF 页面'}).getByRole('button',{name:'打开',exact:true}).click();
    await page.locator('.overview-book-heading .primary-action').click();
    const outline=await json(page,`/api/revisions/${book.active_revision.id}/outline`);
    const chapter=outline.nodes.find(n=>n.title==='第4章 指令系统');
    assert.ok(['PARTIAL','RESOLVED'].includes(chapter.resolution_state));
    const initial=await json(page,`/api/revisions/${book.active_revision.id}/chapters/${chapter.outline_node_id}/knowledge-map`);
    assert.equal(initial.status,'NOT_PREPARED');
    await page.locator('#page-number').fill(String(chapter.start_page+1));
    await page.locator('#page-number').press('Enter');
    await page.locator(`.page[data-index="${chapter.start_page}"] canvas`).waitFor();
    const entry=page.locator('#reader-kp-action');
    await entry.filter({hasText:'＋ 生成本章知识点'}).waitFor();
    await page.evaluate(()=>{
      window.kpStages=[];
      new MutationObserver(()=>window.kpStages.push(document.querySelector('#reader-kp-action').textContent)).observe(document.querySelector('#reader-kp-action'),{childList:true,subtree:true});
    });
    await entry.click();
    await entry.filter({hasText:'生成失败 · 重试'}).waitFor({timeout:180000});
    await entry.click();
    await entry.filter({hasText:'个知识点'}).waitFor({timeout:180000});
    await entry.click();
    await page.locator('.reader-kp-row').first().waitFor();
    const count=await page.locator('.reader-kp-row').count();assert.ok(count>0);
    await page.locator('.reader-kp-row button').first().click();
    assert.equal(await page.locator('#reader-kp-list').isVisible(),false);
    await entry.click();await page.locator('.reader-kp-row').first().waitFor();
    await page.getByRole('button',{name:'查看完整学习结构 ↗'}).click();
    await page.locator('#book-overview').waitFor();
    const stages=await page.evaluate(()=>window.kpStages);
    assert.ok(stages.some(s=>s.includes('生成中')));assert.ok(stages.some(s=>s.includes('审查中')));
    const semanticPayloads=transports.filter(t=>t.messages[0].content.includes('内部语义归并器')).map(t=>JSON.parse(t.messages[1].content));
    const large=semanticPayloads.filter(p=>p.window.title.includes('4.3.1'));
    assert.ok(large.length>0);
    for(const p of large) assert.equal(p.units.reduce((n,u)=>n+u.text.length,0),6485);
    assert.deepEqual(pageErrors,[]);
    console.log(JSON.stringify({status:'PASS',flow:'real Chapter 4 with 6485-character subsection preparation -> review failure -> retry -> READY -> Reader KP list -> PDF -> Overview',count,stages,externalProviderCalls:0}));
  } else {
  const book = await openBook(page, 348);
  assert.equal(book.active_revision.blob_sha256, expectedHash);
  const siblingBooksBefore = (await json(page, "/api/books")).books
    .filter((candidate) => candidate.id !== book.id)
    .map((candidate) => [
      candidate.id,
      candidate.active_revision?.page_count,
      candidate.active_revision?.blob_sha256,
    ])
    .sort((left, right) => left[0].localeCompare(right[0]));
  assert.ok(siblingBooksBefore.length > 0, "a sibling book is required for cascade isolation");
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

  await page.evaluate(() => {
    window.__knowledgeStatusHistory = [];
    const status = document.querySelector("#knowledge-status");
    new MutationObserver(() => window.__knowledgeStatusHistory.push(status.textContent || ""))
      .observe(status, { childList: true, subtree: true, characterData: true });
  });
  await page.waitForFunction(() => {
    const status = document.querySelector("#knowledge-status")?.textContent || "";
    return status.includes("正在按小节生成知识点") && /已完成 [1-9]\d*\/\d+ 个小节/.test(status);
  }, null, { timeout: 20_000 });
  assert.equal(await page.locator("#knowledge-map li").count(), 0);
  await page.waitForFunction(() => {
    const status = document.querySelector("#knowledge-status")?.textContent || "";
    return status.includes("准备失败");
  }, null, { timeout: 40_000 });
  const failed = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failure_stage, "REVIEW");
  assert.equal(failed.failure_code, "review_rejected");
  assert.deepEqual(failed.knowledge_points, []);
  assert.equal(reviewCallCount, 1, "a valid Review FAIL must not auto-review or regenerate");
  assert.equal(await page.locator("#knowledge-map li").count(), 0);

  const retryResponse = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/prepare"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await retryResponse).status(), 202);
  await page.waitForFunction(() => {
    const status = document.querySelector("#knowledge-status")?.textContent || "";
    return status.includes("结构版本") || status.includes("准备失败");
  }, null, { timeout: 40_000 });
  const ready = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map`);
  assert.equal(ready.status, "READY", JSON.stringify({
    state: ready,
    calls: [...generationCallsByWindow.entries()],
    reviewCallCount,
  }));
  assert.equal(ready.structure_version, 1);
  assert.ok(ready.knowledge_points.length >= 4);
  assert.equal(
    new Set(ready.knowledge_points.map((point) => point.knowledge_point_id)).size,
    ready.knowledge_points.length,
  );
  const publishedSectionGroups = new Set(
    ready.knowledge_points.map((point) => point.primary_section_id),
  ).size;
  assert.equal(await page.locator("#knowledge-map .knowledge-section").count(), publishedSectionGroups);
  assert.equal(await page.locator("#knowledge-map li").count(), ready.knowledge_points.length);
  const statusHistory = await page.evaluate(() => window.__knowledgeStatusHistory);
  assert.ok(statusHistory.some((status) => (
    status.includes("正在按小节生成知识点") && /已完成 \d+\/\d+ 个小节/.test(status)
  )), `missing Section progress: ${JSON.stringify(statusHistory)}`);

  const inspection = await json(page, `/api/revisions/${revisionId}/chapters/${chapter6.outline_node_id}/knowledge-map/inspection`);
  assert.equal(inspection.attempts.length, 2);
  assert.deepEqual(inspection.attempts.map((attempt) => attempt.outcome), ["FAILED", "READY"]);
  for (const attempt of inspection.attempts) {
    assert.equal(attempt.chapter_id, chapter6.outline_node_id);
    assert.ok(attempt.unit_count > 0);
    assert.ok(attempt.window_count > 0);
    assert.equal(attempt.window_bounds.length, attempt.window_count);
    assert.ok(["FAIL", "PASS"].includes(attempt.review.verdict));
    const serialized = JSON.stringify(attempt);
    assert.ok(!/本节习题精选|答案与解析|knowledge-generator-loopback-secret|knowledge-review-loopback-secret/.test(serialized));
  }
  assert.equal(reviewCallCount, 2);
  const failedAttemptId = inspection.attempts[0].attempt_id;
  const failedGenerationAttempts = inspection.pipeline_attempts.filter(
    (attempt) => attempt.preparation_attempt_id === failedAttemptId,
  );
  const failedTransport = failedGenerationAttempts.find(
    (attempt) => attempt.packet_or_stage_id === failingWindowId && attempt.status === "FAILED",
  );
  assert.ok(failedTransport);
  assert.equal(failedTransport.failure_code, "empty_response");
  assert.equal(failedTransport.finish_reason, "length");
  assert.equal(failedTransport.content_present, 0);
  assert.equal(failedTransport.reasoning_present, 1);
  assert.equal(failedTransport.reasoning_length, reasoningCanary.length);
  assert.ok(!JSON.stringify(inspection.pipeline_attempts).includes(reasoningCanary));
  assert.ok(inspection.pipeline_attempts.every(
    (attempt) => attempt.semantic_round === 0,
  ));
  const reviewAttempts = inspection.pipeline_attempts.filter(
    (attempt) => attempt.pipeline_stage === "STRUCTURAL_REVIEW",
  );
  assert.equal(reviewAttempts.length, 2);
  assert.ok(reviewAttempts.every((attempt) => attempt.structured_attempt === 1));

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
  await waitForSourceAnchor(page, firstPoint);
  await page.locator(`.page[data-index="${firstPoint.start_page}"] canvas`).waitFor({ state: "visible" });

  const screenshot = path.join(process.cwd(), "test-results", "knowledge-map-golden.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await openKnowledge(page, chapter6.outline_node_id);
  await page.screenshot({ path: screenshot });

  const idsBeforeRestart = ready.knowledge_points.map((point) => point.knowledge_point_id);

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
  await page.waitForFunction(
    (count) => document.querySelectorAll(".book-card").length === count,
    siblingBooksBefore.length,
  );
  const remaining = await json(page, "/api/books");
  assert.deepEqual(
    remaining.books.map((candidate) => [
      candidate.id,
      candidate.active_revision?.page_count,
      candidate.active_revision?.blob_sha256,
    ]).sort((left, right) => left[0].localeCompare(right[0])),
    siblingBooksBefore,
  );
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: { pages: 348, sha256: expectedHash, chapter: "第6章 总线" },
    oneChapterOnly: true,
    outlineLogicalIdentityPreserved: true,
    atomicVisibility: true,
    failureRecovery: "same-window EMPTY_RESPONSE retry -> terminal Review FAIL -> explicit user retry -> READY",
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
}
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

async function waitForSourceAnchor(page, point) {
  await page.waitForFunction(({ pageIndex, normalizedY }) => {
    const viewer = document.querySelector("#viewer");
    const wrapper = document.querySelector(`.page[data-index="${pageIndex}"]`);
    if (!viewer || !wrapper) return false;
    const viewerRect = viewer.getBoundingClientRect();
    const pageRect = wrapper.getBoundingClientRect();
    const anchorY = pageRect.top + pageRect.height * normalizedY;
    return anchorY >= viewerRect.top - 4 && anchorY <= viewerRect.bottom + 4;
  }, { pageIndex: point.start_page, normalizedY: point.start_y });
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
    process.env.READER_KP_LIST_ONLY === '1'
      ? "connection.execute(\"DELETE FROM chapter_preparations WHERE status = 'FAILED'\")"
      : "connection.execute(\"DELETE FROM chapter_preparations\")",
    "connection.commit()",
    "connection.close()",
  ].join("; ");
  const reset = spawnSync(process.env.READER_PYTHON || "python", ["-c", script, database], {
    cwd: process.cwd(), windowsHide: true, encoding: "utf8",
  });
  if (reset.status !== 0) throw new Error(reset.stderr || "failed to reset copied Knowledge state");
}
