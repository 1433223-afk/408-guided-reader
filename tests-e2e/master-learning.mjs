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
const payloads = [];
const provider = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  const payload = JSON.parse(body.messages[1].content);
  payloads.push(payload);
  if (fail) { res.writeHead(401); res.end('{}'); return; }
  const answer = payload.candidate
    ? JSON.stringify({ verdict: "PASS", summary: "教材归属和解释已检查。" })
    : "依据所附教材，这个知识点需要区分概念本身与它的实现条件。补充解释：先看成立条件，再用例子检查边界。";
  await new Promise((resolve) => setTimeout(resolve, 150));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: "stop" }] }));
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
  await openMap(page, point.chapter_outline_node_id);
  const kpRow = page.locator("#knowledge-map li").filter({ has: page.locator("strong", { hasText: point.title }) }).first();
  await kpRow.getByRole("button", { name: "这里没完全懂", exact: true }).click();
  await page.locator("#master-title").filter({ hasText: point.title }).waitFor();
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await page.locator("#master-question").fill(`学习“${point.title}”时，我应该抓住什么核心区别？请结合当前教材解释。`);
  await page.locator("#master-send").click();
  await completed(page, 2);
  await page.locator("#master-question").fill("如果只记定义而不理解成立条件，最容易在哪里混淆？请接着刚才的解释举例。");
  await page.locator("#master-send").click();
  await completed(page, 4);
  const initial = await snapshot();
  assert.equal(initial.status, "NOT_FULLY_CLEAR");
  assert.equal(initial.topics[0].state, "ACTIVE");
  assert.equal(initial.messages.filter((m) => m.review_state === "PASS").length, 2);
  await page.getByRole("button", { name: "解释 Assistant", exact: true }).click();
  assert.ok(await page.locator("#assistant-empty").isVisible());
  await page.getByRole("button", { name: "学习 Master", exact: true }).click();
  assert.equal(await page.locator("#master-history .master-message").count(), 4);
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  const subsection = entries.sections.find((s) => s.kind === "SUBSECTION" && s.knowledge_point_ids.includes(point.knowledge_point_id));
  const subsectionLast = entries.points.filter((p) => subsection.knowledge_point_ids.includes(p.knowledge_point_id))
    .sort((a, b) => b.end_page - a.end_page || b.end_y - a.end_y)[0];
  const beforeSubsection = await json(page, base);
  await page.locator("#page-number").fill(String(subsectionLast.end_page + 1));
  await page.locator("#page-number").press("Enter");
  const subMarker = page.locator(`.subsection-learning-marker[data-outline-node-id="${subsection.outline_node_id}"]`);
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
  assert.equal(confirmationPlacement.page, subsectionLast.end_page);
  assert.ok(confirmationPlacement.belowPdf && confirmationPlacement.aligned, "Batch card belongs below its ending PDF page, aligned with the reading column");
  await assertLearningControlsOutsidePdf(page);
  await page.locator("#assistant-toggle").click();
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlsOutsidePdf(page);
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlsOutsidePdf(page);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(250);
  await subMarker.scrollIntoViewIfNeeded();
  await assertLearningControlsOutsidePdf(page);
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
  await openMap(page, point.chapter_outline_node_id);
  await page.locator("#knowledge-map li").filter({ has: page.locator("strong", { hasText: point.title }) }).first().getByRole("button", { name: "继续 Master 对话", exact: true }).click();
  await page.locator("#master-history .master-message").nth(3).waitFor();
  assert.deepEqual(await snapshot(), initial);
  const restoredEntries = await json(page, base);
  assert.deepEqual(restoredEntries.points.map((p) => [p.knowledge_point_id, p.status]), afterSubsection.points.map((p) => [p.knowledge_point_id, p.status]));
  await stop();
  fail = true;
  running = await start(loopbackEnv);
  await page.goto(running.url);
  await openBook(page);
  await openMap(page, point.chapter_outline_node_id);
  await page.locator("#knowledge-map li").filter({ has: page.locator("strong", { hasText: point.title }) }).first().getByRole("button", { name: "继续 Master 对话", exact: true }).click();
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await page.locator("#master-mode").selectOption("Fast");
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
  await openMap(page, point.chapter_outline_node_id);
  await page.locator("#knowledge-map li").filter({ has: page.locator("strong", { hasText: point.title }) }).first().getByRole("button", { name: "继续 Master 对话", exact: true }).click();
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await page.getByRole("button", { name: "重试发送", exact: true }).click();
  await completed(page, 6);
  const retried = await snapshot();
  assert.deepEqual(retried.messages.filter((m) => m.role === "user").map((m) => m.id), failed.messages.filter((m) => m.role === "user").map((m) => m.id));
  await page.locator(".dock-tabs").getByRole("button", { name: "收起", exact: true }).click();
  const sectionLast = entries.points.filter((p) => p.primary_section_id === section.outline_node_id)
    .sort((a, b) => b.end_page - a.end_page || b.end_y - a.end_y)[0];
  await page.locator("#page-number").fill(String(sectionLast.end_page + 1));
  await page.locator("#page-number").press("Enter");
  const marker = page.locator(`.page[data-index="${sectionLast.end_page}"] .section-learning-marker`).filter({ hasText: section.title }).first();
  await marker.getByRole("button", { name: "确认本节", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#status")?.textContent.includes("本节仍有未完全清楚"));
  const afterBulk = await json(page, base);
  assert.equal((await snapshot()).status, "NOT_FULLY_CLEAR");
  for (const p of afterBulk.points) {
    const before = entries.points.find((q) => q.knowledge_point_id === p.knowledge_point_id);
    if (p.primary_section_id === section.outline_node_id && p.knowledge_point_id !== point.knowledge_point_id) assert.equal(p.status, "UNDERSTOOD");
    else if (p.primary_section_id !== section.outline_node_id) assert.equal(p.status, before.status);
  }
  await openMap(page, point.chapter_outline_node_id);
  await page.locator("#knowledge-map li").filter({ has: page.locator("strong", { hasText: point.title }) }).first().getByRole("button", { name: "继续 Master 对话", exact: true }).click();
  assert.ok(await page.locator("#knowledge-panel").isHidden());
  await page.locator("#master-confirm").click();
  await page.waitForFunction(() => document.querySelector("#master-status")?.textContent.includes("已弄懂"));
  const final = await snapshot();
  assert.equal(final.topics[0].state, "RESOLVED");
  assert.equal(final.status, "UNDERSTOOD");
  assert.equal(final.messages.length, 6);
  for (const payload of payloads) {
    assert.deepEqual(Object.keys(payload).sort(), payload.candidate ? ["candidate", "mode", "question", "source"] : ["source", "topic_messages"]);
    assert.equal(payload.source.knowledge_point_id, point.knowledge_point_id);
    assert.equal(payload.source.section.id, section.outline_node_id);
  }
  const inspection = await json(page, "/api/assistant/inspection");
  assert.ok(!JSON.stringify(inspection).includes("test-loopback-key"));
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/master-learning.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "PASS", liveInitialConversation: live, realPages: 348, kp: point.title,
    restartAndAIoffHistory: true, retryNoDuplicates: true, explicitConfirmation: true, sectionIsolation: true,
    payloadAllowlist: true, subsectionIsolationAndRestart: true, controlsOutsidePdf: true, subsection: subsection.title,
    dataDir, screenshot: "test-results/master-learning.png" }));
} finally {
  if (browser) await browser.close();
  await stop();
  await new Promise((resolve) => provider.close(resolve));
}

async function json(page, url) {
  return page.evaluate(async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); }, url);
}
async function assertLearningControlsOutsidePdf(page) {
  const violations = await page.evaluate(() => {
    const pages = [...document.querySelectorAll(".page:has(canvas)")];
    const controls = [...document.querySelectorAll(".learning-marker, .learning-batch-card")];
    return controls.flatMap((control) => {
      const box = control.getBoundingClientRect();
      return pages.filter((page) => {
        const pdf = page.querySelector("canvas").getBoundingClientRect();
        return Math.min(box.right, pdf.right) - Math.max(box.left, pdf.left) > 1
          && Math.min(box.bottom, pdf.bottom) - Math.max(box.top, pdf.top) > 1;
      }).map(() => control.textContent);
    });
  });
  assert.deepEqual(violations, [], "Learning controls must never overlap original PDF pixels");
}
async function openBook(page) {
  await page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" }).click();
  await page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
}
async function openMap(page, chapter) {
  if (!(await page.locator("#outline-panel").isVisible())) await page.locator("#outline-toggle").click();
  await page.locator(`li[data-node-id="${chapter}"] > .outline-row .outline-map-action`).click();
  await page.locator("#knowledge-map li").first().waitFor();
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
