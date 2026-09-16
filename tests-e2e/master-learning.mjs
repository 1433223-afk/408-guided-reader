import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const root = await mkdtemp(path.join(os.tmpdir(), "guided-reader-master-"));
const dataDir = path.join(root, "data");
await mkdir(dataDir);
await cp(path.join(source, "blobs"), path.join(dataDir, "blobs"), { recursive: true });
const backup = spawnSync("python", ["-c", "import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()", path.join(source, "state.sqlite3"), path.join(dataDir, "state.sqlite3")], { windowsHide: true, encoding: "utf8" });
assert.equal(backup.status, 0, backup.stderr);
let fail = false;
let unsupportedReference = null;
const payloads = [];
const providerBodies = [];
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const payload = JSON.parse(body.messages[1].content);
  payloads.push(payload);
  providerBodies.push(body);
  if (fail) { res.writeHead(401); res.end('{}'); return; }
  const answer = payload.candidate
    ? JSON.stringify({ verdict: "PASS", summary: "教材归属和解释已检查。" })
    : unsupportedReference || "依据所附教材，这个知识点需要区分概念本身与它的实现条件。补充解释：先看成立条件，再用例子检查边界。";
  await new Promise((resolve) => setTimeout(resolve, 80));
  if(body.stream) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    if(body.thinking?.type === 'enabled') {
      res.write(`data: ${JSON.stringify({choices:[{delta:{reasoning_content:'先核对教材范围，'},finish_reason:null}]})}\n\n`);
      await new Promise(resolve=>setTimeout(resolve,60));
      res.write(`data: ${JSON.stringify({choices:[{delta:{reasoning_content:'再组织解释。'},finish_reason:null}]})}\n\n`);
    }
    const midpoint=Math.max(1,Math.floor(answer.length/2));
    res.write(`data: ${JSON.stringify({choices:[{delta:{content:answer.slice(0,midpoint)},finish_reason:null}]})}\n\n`);
    await new Promise(resolve=>setTimeout(resolve,120));
    res.write(`data: ${JSON.stringify({choices:[{delta:{content:answer.slice(midpoint)},finish_reason:'stop'}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] }));
  }
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const loopbackEnv = {
  GUIDED_READER_MASTER_PROVIDER: "deepseek", GUIDED_READER_REVIEW_PROVIDER: "zhipu",
  GUIDED_READER_DEEPSEEK_API_KEY: "test-loopback-key", GUIDED_READER_ZHIPU_API_KEY: "test-loopback-key",
  GUIDED_READER_DEEPSEEK_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
  GUIDED_READER_ZHIPU_ENDPOINT: `http://127.0.0.1:${provider.address().port}/chat/completions`,
};
let running;
let browser;
const live = process.env.MASTER_E2E_REAL === "1";
const liveSection = process.env.MASTER_E2E_SECTION_REAL === "1";
try {
  running = await start(live ? {} : loopbackEnv);
  browser = await chromium.launch({ executablePath: process.env.READER_CHROMIUM || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(running.url);
  const books = (await json(page, "/api/books")).books;
  const book = books.find((b) => b.active_revision.page_count === 348);
  assert.equal(book.active_revision.blob_sha256, "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd");
  const rev = book.active_revision.id;
  const base = `/api/revisions/${rev}/learning`;
  const entries = await json(page, base);
  const point = entries.points.find((p) => entries.points.filter((q) => q.primary_section_id === p.primary_section_id).length >= 2
    && entries.points.filter((q) => q.primary_section_id === p.primary_section_id).every((q) => q.status === "UNCONFIRMED" && !q.thread_id)
    && entries.sections.some((s) => s.kind === "SUBSECTION" && s.knowledge_point_ids.includes(p.knowledge_point_id) && s.knowledge_point_ids.length >= 2));
  assert.ok(point, "Need a READY Chapter with multiple real KPs in one Section");
  const section = entries.sections.find((s) => s.outline_node_id === point.primary_section_id);
  assert.ok(section);
  const snapshot = () => json(page, `${base}/${point.knowledge_point_id}`);
  await openBook(page);
  // User-reported Chapter 2 boundary: the durable span includes the next page's header.
  const boundaryPoint = entries.points.find((p) => p.title === "十进制数转换为任意进制数" && p.start_page === 38);
  assert.ok(boundaryPoint, "Need the real user-reported KP boundary");
  assert.equal(boundaryPoint.end_page, 39);
  assert.equal(boundaryPoint.display_end_page, 38);
  const boundarySubsection = entries.sections.find((s) => s.kind === "SUBSECTION"
    && s.knowledge_point_ids.includes(boundaryPoint.knowledge_point_id));
  await page.locator("#page-number").fill("39");
  await page.locator("#page-number").press("Enter");
  const boundaryTag = page.locator('.page[data-index="38"] .kp-learning-marker').filter({ hasText: boundaryPoint.title });
  await boundaryTag.locator("summary").click();
  assert.ok(await boundaryTag.getByRole("button", { name: "这里没完全懂", exact: true }).isVisible());
  await boundaryTag.locator("summary").click();
  const boundaryCard = page.locator(`.page[data-index="38"] .subsection-learning-marker[data-outline-node-id="${boundarySubsection.outline_node_id}"]`);
  await boundaryCard.scrollIntoViewIfNeeded();
  await page.locator("#viewer").hover();
  await page.mouse.wheel(0, 250);
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.page[data-index="39"] .kp-learning-marker').filter({ hasText: boundaryPoint.title }).count(), 0);
  await assertLearningControlPlacement(page);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/learning-boundary-39-40.png", fullPage: true });
  assert.deepEqual(await json(page, base), entries, "Display navigation must not write source ranges or learning state");
  await openPointMaster(page, point, "这里没完全懂");
  await page.locator("#master-title").filter({ hasText: point.title }).waitFor();
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await setReviewMode(page, 'Standard');
  await page.locator("#master-question").fill(`学习“${point.title}”时，我应该抓住什么核心区别？请结合当前教材解释。`);
  await page.locator("#master-send").click();
  await page.locator('.master-stream-message .assistant-answer-streaming').waitFor();
  assert.ok((await page.locator('.master-stream-message .assistant-answer-streaming').textContent()).length > 0);
  await completed(page, 2);
  await page.locator('#master-reasoning-choice-trigger').click();
  await page.locator('#master-reasoning-choice-options [data-value="Deep"]').click();
  await page.locator("#master-question").fill("如果只记定义而不理解成立条件，最容易在哪里混淆？请接着刚才的解释举例。");
  await page.locator("#master-send").click();
  await page.locator('.master-stream-message .master-reasoning').waitFor();
  assert.ok((await page.locator('.master-stream-message .master-reasoning-content').textContent()).includes('核对教材范围'));
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/master-deep-reasoning-stream.png" });
  await completed(page, 4);
  const initial = await snapshot();
  assert.equal(initial.status, "NOT_FULLY_CLEAR");
  assert.equal(initial.topics[0].state, "ACTIVE");
  assert.equal(initial.messages.filter((m) => m.review_state === "PASS").length, 2);
  assert.deepEqual(initial.messages.filter(m=>m.role==='user').map(m=>m.reasoning_mode), ['Quick','Deep']);
  const answerBodies=providerBodies.filter(body=>body.stream);
  assert.deepEqual(answerBodies[0].thinking,{type:'disabled'});
  assert.deepEqual(answerBodies[1].thinking,{type:'enabled'});
  await page.getByRole("button", { name: "解释 Assistant", exact: true }).click();
  assert.ok(await page.locator("#assistant-empty").isVisible());
  await page.getByRole("button", { name: "学习 Master", exact: true }).click();
  assert.equal(await page.locator("#master-history .master-message").count(), 4);
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  const subsection = entries.sections.find((s) => s.kind === "SUBSECTION" && s.knowledge_point_ids.includes(point.knowledge_point_id));
  const subsectionLast = entries.points.filter((p) => subsection.knowledge_point_ids.includes(p.knowledge_point_id))
    .sort((a, b) => b.display_end_page - a.display_end_page || b.display_end_y - a.display_end_y)[0];
  const beforeSubsection = await json(page, base);
  await page.locator("#page-number").fill(String(subsectionLast.display_end_page + 1));
  await page.locator("#page-number").press("Enter");
  const subMarker = page.locator(`.subsection-learning-marker[data-outline-node-id="${subsection.outline_node_id}"]`);
  const learningTag = page.locator(`.page[data-index="${subsectionLast.display_end_page}"] .kp-learning-marker`).first();
  await learningTag.locator("summary").click();
  assert.ok(await learningTag.getByRole("button", { name: "这里没完全懂", exact: true }).first().isVisible());
  await learningTag.locator("summary").click();
  await assertLearningControlPlacement(page);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/kp-learning-tags.png", fullPage: true });
  await subMarker.getByRole("button", { name: "确认本小节", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("本小节仍有未完全清楚的知识点：1 个"));
  const afterSubsection = await json(page, base);
  for (const p of afterSubsection.points) {
    const before = beforeSubsection.points.find((q) => q.knowledge_point_id === p.knowledge_point_id);
    assert.equal(p.status, subsection.knowledge_point_ids.includes(p.knowledge_point_id) && before.status === "UNCONFIRMED" ? "UNDERSTOOD" : before.status);
  }
  await subMarker.getByRole("button", { name: "确认本小节", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("已确认 0 个待确认知识点。本小节"));
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/subsection-confirmation.png", fullPage: true });
  assert.ok((await subMarker.locator("h3").textContent()).includes(subsection.title));
  assert.equal(await subMarker.locator(".learning-batch-stats").textContent(),
    `本小节共 ${subsection.knowledge_point_ids.length} 个知识点 · 已确认 ${subsection.knowledge_point_ids.length - 1} 个 · 未完全清楚 1 个`);
  assert.equal(await subMarker.locator(".learning-batch-hint").textContent(), "仅确认未标记为“没完全懂”的知识点");
  const confirmationPlacement = await subMarker.evaluate((marker) => {
    const pdf = marker.closest(".page").querySelector("canvas").getBoundingClientRect();
    return { belowPdf: marker.getBoundingClientRect().top >= pdf.bottom,
      aligned: Math.abs(marker.getBoundingClientRect().left - pdf.left) < 1,
      page: Number(marker.closest(".page").dataset.index) };
  });
  assert.equal(confirmationPlacement.page, subsectionLast.display_end_page);
  assert.ok(confirmationPlacement.belowPdf && confirmationPlacement.aligned, "Batch card belongs below its ending PDF page, aligned with the reading column");
  await assertLearningControlPlacement(page);
  await openPointMaster(page, point, "继续 Master 对话");
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlPlacement(page);
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlPlacement(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlPlacement(page);
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  await page.locator("#zoom-out").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(250);
  await page.locator("#page-number").fill(String(point.end_page + 3));
  await page.locator("#page-number").press("Enter");
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await stop();
  running = await start({ ...loopbackEnv, GUIDED_READER_DEEPSEEK_DISABLED: "1", GUIDED_READER_ZHIPU_DISABLED: "1" });
  await page.goto(running.url);
  await openBook(page);
  await openPointMaster(page, point, "继续 Master 对话");
  await page.locator("#master-history .master-message").nth(3).waitFor();
  assert.deepEqual(await snapshot(), initial);
  const restoredEntries = await json(page, base);
  assert.deepEqual(restoredEntries.points.map((p) => [p.knowledge_point_id, p.status]), afterSubsection.points.map((p) => [p.knowledge_point_id, p.status]));
  await stop();
  fail = true;
  running = await start(loopbackEnv);
  await page.goto(running.url);
  await openBook(page);
  await openPointMaster(page, point, "继续 Master 对话");
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await setReviewMode(page, "Fast");
  await page.locator("#master-question").fill("能再用一句话说明关键条件吗？");
  await page.locator("#master-send").click();
  await page.getByRole("button", { name: "重试发送", exact: true }).waitFor({ timeout: 20_000 });
  const failed = await snapshot();
  assert.equal(failed.messages.length, 5);
  assert.equal(failed.topics.length, 1);
  fail = false;
  // A new service clears provider cooling; the failed durable intent must survive it.
  await stop();
  running = await start(loopbackEnv);
  await page.goto(running.url);
  await openBook(page);
  await openPointMaster(page, point, "继续 Master 对话");
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  for (const [answer, error] of [["PDF p. 999", "PDF 页码"], ["教材图 999-9", "图号"]]) {
    unsupportedReference = answer;
    await page.getByRole("button", { name: "重试发送", exact: true }).click();
    await page.waitForFunction((error) => document.querySelector("#master-history")
      ?.textContent.includes(error), error);
    const grounded = await snapshot();
    assert.equal(grounded.messages.length, 5);
    assert.deepEqual(grounded.messages.map((m) => m.id), failed.messages.map((m) => m.id));
    assert.equal(grounded.status, "NOT_FULLY_CLEAR");
    assert.equal(grounded.topics[0].state, "ACTIVE");
  }
  unsupportedReference = null;
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await completed(page, 6);
  const retried = await snapshot();
  assert.deepEqual(retried.messages.filter((m) => m.role === "user").map((m) => m.id), failed.messages.filter((m) => m.role === "user").map((m) => m.id));
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  const sectionLast = entries.points.filter((p) => p.primary_section_id === section.outline_node_id)
    .sort((a, b) => b.display_end_page - a.display_end_page || b.display_end_y - a.display_end_y)[0];
  if (liveSection) {
    await stop();
    running = await start({});
    await page.goto(running.url);
    await openBook(page);
  }
  await page.locator("#page-number").fill(String(sectionLast.display_end_page + 1));
  await page.locator("#page-number").press("Enter");
  const marker = page.locator(`.page[data-index="${sectionLast.display_end_page}"] .section-learning-marker`).filter({ hasText: section.title }).first();
  const beforeSectionCheck = await json(page, base);
  await marker.getByRole("button", { name: "还有些地方不完全清楚", exact: true }).click();
  await page.locator("#master-title").filter({ hasText: section.title }).waitFor();
  assert.deepEqual((await json(page, base)).points.map((p) => [p.knowledge_point_id, p.status]), beforeSectionCheck.points.map((p) => [p.knowledge_point_id, p.status]));
  await setReviewMode(page, 'Standard');
  await page.locator("#master-question").fill("这一节的几个知识点如何联系起来？请先说明整节的主线。");
  await page.locator("#master-send").click();
  await completed(page, 2);
  await page.locator("#master-question").fill("请接着解释刚才提到的这些联系，不要替我判断已经掌握。");
  await page.locator("#master-send").click();
  await completed(page, 4);
  const sectionConversation = await json(page, `${base}/${section.outline_node_id}`);
  assert.equal(sectionConversation.status, "ANSWERED_HAS_UNCLEAR");
  assert.equal(sectionConversation.point.scope_kind, "SECTION");
  const sectionReviews = sectionConversation.messages.filter((m) => m.role === "assistant").map((m) => m.review_state);
  if (!liveSection) assert.deepEqual(sectionReviews, ["PASS", "PASS"]);
  assert.notEqual(sectionConversation.thread_id, retried.thread_id);
  await page.screenshot({ path: "test-results/section-master.png", fullPage: true });
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  await stop();
  running = await start({ ...loopbackEnv, GUIDED_READER_DEEPSEEK_DISABLED: "1", GUIDED_READER_ZHIPU_DISABLED: "1" });
  await page.goto(running.url);
  await openBook(page);
  await page.locator("#page-number").fill(String(sectionLast.display_end_page + 1));
  await page.locator("#page-number").press("Enter");
  await marker.getByRole("button", { name: "继续本节 Master 对话", exact: true }).click();
  await page.locator("#master-history .master-message").nth(3).waitFor();
  assert.deepEqual(await json(page, `${base}/${section.outline_node_id}`), sectionConversation);
  assert.deepEqual(await snapshot(), retried);
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  await marker.getByRole("button", { name: "都清楚了", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("本节知识点已全部确认"));
  const afterBulk = await json(page, base);
  assert.equal((await snapshot()).status, "UNDERSTOOD");
  const clearSection = await json(page, `${base}/${section.outline_node_id}`);
  assert.equal(clearSection.status, "ANSWERED_CLEAR");
  assert.equal(clearSection.topics[0].state, "RESOLVED");
  assert.deepEqual(clearSection.messages, sectionConversation.messages);
  for (const p of afterBulk.points) {
    const before = entries.points.find((q) => q.knowledge_point_id === p.knowledge_point_id);
    if (p.primary_section_id === section.outline_node_id) assert.equal(p.status, "UNDERSTOOD");
    else if (p.primary_section_id !== section.outline_node_id) assert.equal(p.status, before.status);
  }
  await openPointMaster(page, point, "继续 Master 对话");
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await page.locator("#master-more").click();
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith(`/learning/${point.knowledge_point_id}/confirm`)
      && response.request().method() === "POST"),
    page.locator("#master-confirm").click(),
  ]);
  const final = await snapshot();
  assert.equal(final.topics[0].state, "RESOLVED");
  assert.equal(final.status, "UNDERSTOOD");
  assert.equal(final.messages.length, 6);
  for (const payload of payloads) {
    assert.deepEqual(Object.keys(payload).sort(), payload.candidate ? ["candidate", "mode", "question", "source"] : ["source", "topic_messages"]);
    if (payload.source.scope_kind === "SECTION") {
      assert.deepEqual(Object.keys(payload.source).sort(), ["knowledge_points", "pages", "range", "scope_kind", "section"]);
      assert.deepEqual(payload.source.knowledge_points.map((p) => p.knowledge_point_id).sort(), entries.points.filter((p) => p.primary_section_id === section.outline_node_id).map((p) => p.knowledge_point_id).sort());
    } else assert.equal(payload.source.knowledge_point_id, point.knowledge_point_id);
    assert.equal(payload.source.section.id, section.outline_node_id);
  }
  const inspection = await json(page, "/api/assistant/inspection");
  assert.ok(!JSON.stringify(inspection).includes("test-loopback-key"));
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/master-learning.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "PASS", liveInitialConversation: live, liveSectionConversation: liveSection, sectionReviews, realPages: 348, kp: point.title,
    restartAndAIoffHistory: true, retryNoDuplicates: true, explicitConfirmation: true, sectionIsolation: true,
    payloadAllowlist: true, subsectionIsolationAndRestart: true, kpEntriesInsidePdf: true, batchCardsBelowPdf: true, sectionMasterRestartAndClear: true, subsection: subsection.title,
    dataDir, screenshot: "test-results/master-learning.png" }));
} finally {
  if (browser) await browser.close();
  await stop();
  await new Promise((resolve) => provider.close(resolve));
}

async function json(page, url) {
  return page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }, url);
}
async function assertLearningControlPlacement(page) {
  const violations = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page:has(canvas)")];
    const controls = [...document.querySelectorAll(".learning-batch-card")];
    return controls.flatMap((control) => {
      const box = control.getBoundingClientRect();
      return pages.filter((page) => {
        const pdf = page.querySelector("canvas").getBoundingClientRect();
        return Math.min(box.right, pdf.right) - Math.max(box.left, pdf.left) > 1
          && Math.min(box.bottom, pdf.bottom) - Math.max(box.top, pdf.top) > 1;
      }).map(() => control.textContent);
    });
  });
  assert.deepEqual(violations, [], "Batch cards remain below the PDF");
  const inside = await page.locator('.kp-learning-marker').evaluateAll(markers => markers.every(marker => {
    const box=marker.getBoundingClientRect(), pdf=marker.closest('.page').getBoundingClientRect();
    return box.left>=pdf.left && box.right<=pdf.right && box.top>=pdf.top && box.bottom<=pdf.bottom+1;
  }));
  assert.ok(inside, 'Compact KP entries stay inside their PDF page');
}
async function openBook(page) {
  await page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" }).locator(".book-open").click();
  await page.locator("#book-overview").waitFor({ state: "visible" });
  await page.locator("#book-overview .overview-book-heading .primary-action").click();
  await page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
}
async function openPointMaster(page, point, actionName) {
  await page.locator("#page-number").fill(String(point.display_end_page + 1));
  await page.locator("#page-number").press("Enter");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const marker = page.locator(`.page[data-index="${point.display_end_page}"] .kp-learning-marker`)
      .filter({ hasText: point.title }).first();
    try {
      await marker.scrollIntoViewIfNeeded();
      if (!(await marker.evaluate((element) => element.open))) await marker.locator("summary").click();
      await marker.getByRole("button", { name: actionName, exact: true }).click({ timeout: 5_000 });
      await page.locator("#master-title").filter({ hasText: point.title }).waitFor();
      return;
    } catch (error) {
      if (await page.locator("#master-title").filter({ hasText: point.title }).isVisible().catch(() => false)) return;
      if (attempt === 3) throw error;
      await page.waitForTimeout(150);
    }
  }
}
async function setReviewMode(page, mode) {
  await page.locator("#master-more").click();
  await page.locator("#master-mode").selectOption(mode);
  await page.keyboard.press("Escape");
}
async function completed(page, count) {
  await page.waitForFunction(({ count }) => {
    const rows = document.querySelectorAll("#master-history .master-message");
    const text = document.querySelector("#master-history")?.textContent || "";
    return rows.length === count && !text.includes("正在回答") && !text.includes("审查中");
  }, { count }, { timeout: 300_000 });
}
async function start(extra) {
  const child = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extra },
  });
  let output = "", errors = "";
  child.stderr.on("data", (v) => { errors += v; });
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(output + errors)), 30_000);
    child.stdout.on("data", (v) => { output += v; const match = output.match(/READY (http:\/\/\S+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    child.on("exit", () => { clearTimeout(timeout); reject(new Error(errors || output)); });
  });
  return { child, url };
}
async function stop() {
  if (!running || running.child.exitCode !== null) return;
  const child = running.child;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}
