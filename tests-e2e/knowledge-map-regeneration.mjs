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
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-regenerate-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
resetCopiedKnowledgeState();

let reviewCount = 0;
const provider = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const system = body.messages[0]?.content || "";
  const payload = JSON.parse(body.messages[1]?.content || "{}");
  let answer;
  if (system.includes("内部语义归并器")) {
    const version = reviewCount + 1;
    const unitIds = payload.units.map((unit) => unit.unit_id);
    const forbidden = payload.window.kp_creation === "FORBIDDEN_REVIEW_MATERIAL";
    answer = JSON.stringify({
      learning_targets: forbidden ? [] : [{
        unit_ids: unitIds,
        title: `${payload.window.title}：验证版本 ${version}`,
        one_sentence_meaning: `以完整教材证据验证该小节的第 ${version} 次整章学习地图。`,
      }],
      non_kp_units: forbidden ? unitIds : [],
    });
    await delay(120);
  } else if (system.includes("Chapter Knowledge Map 结构审查者")) {
    reviewCount += 1;
    answer = JSON.stringify({
      verdict: "PASS",
      summary: `第 ${reviewCount} 次完整 Chapter candidate 通过结构审查。`,
      findings: [],
    });
    await delay(300);
  } else {
    answer = "unsupported";
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify({
    choices: [{ message: { content: answer }, finish_reason: "stop" }],
    usage: { prompt_tokens: 100, completion_tokens: answer.length, total_tokens: 100 + answer.length },
  }));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));

const serviceEnv = {
  GUIDED_READER_ASSISTANT_PROVIDER: "deepseek",
  GUIDED_READER_KP_GENERATOR_PROVIDER: "deepseek",
  GUIDED_READER_KP_REVIEW_PROVIDER: "zhipu",
  GUIDED_READER_DEEPSEEK_API_KEY: "loopback-generator-secret",
  GUIDED_READER_ZHIPU_API_KEY: "loopback-review-secret",
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
  const outline = await json(page, `/api/revisions/${revisionId}/outline`);
  const chapter = outline.nodes.find((node) => node.title.startsWith("第3章"));
  assert.ok(chapter, "Chapter 3 missing from real Outline");
  await openKnowledge(page, chapter.outline_node_id);

  const initialResponse = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/prepare"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await initialResponse).status(), 202);
  await page.waitForFunction(() => document.querySelector("#knowledge-status")?.textContent.includes("结构版本 1"), null, { timeout: 60_000 });
  const first = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
  assert.equal(first.status, "READY");
  assert.equal(first.regeneration_state, "IDLE");
  assert.equal(first.regeneration_allowed, true);
  const firstIds = first.knowledge_points.map((point) => point.knowledge_point_id);
  const firstTitles = first.knowledge_points.map((point) => point.title);
  assert.ok(firstIds.length > 0);
  assert.ok(firstTitles.every((title) => title.includes("验证版本 1")));

  const replacementResponse = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/regenerate"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await replacementResponse).status(), 202);
  await page.waitForFunction(() => document.querySelector("#knowledge-status")?.textContent.includes("当前地图继续可用"), null, { timeout: 10_000 });
  const runningReplacement = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
  assert.equal(runningReplacement.status, "READY");
  assert.equal(runningReplacement.regeneration_state, "RUNNING");
  assert.deepEqual(runningReplacement.knowledge_points.map((point) => point.knowledge_point_id), firstIds);
  assert.equal(await page.locator("#knowledge-map li").count(), firstIds.length);

  await page.waitForFunction(() => document.querySelector("#knowledge-status")?.textContent.includes("结构版本 2"), null, { timeout: 60_000 });
  const second = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
  const secondIds = second.knowledge_points.map((point) => point.knowledge_point_id);
  assert.equal(second.status, "READY");
  assert.equal(second.regeneration_state, "IDLE");
  assert.equal(second.structure_version, 2);
  assert.equal(secondIds.length, firstIds.length);
  assert.equal(secondIds.some((id) => firstIds.includes(id)), false);
  assert.ok(second.knowledge_points.every((point) => point.title.includes("验证版本 2")));
  assert.equal(reviewCount, 2);

  const screenshot = path.join(process.cwd(), "test-results", "knowledge-map-regeneration.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });

  await stopService(running.child);
  running = await startService(serviceEnv);
  await page.goto(running.url);
  const reopenedBook = await openBook(page, 348);
  assert.equal(reopenedBook.active_revision.id, revisionId);
  const reopened = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
  assert.equal(reopened.structure_version, 2);
  assert.deepEqual(reopened.knowledge_points.map((point) => point.knowledge_point_id), secondIds);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: { pages: 348, sha256: expectedHash, chapter: chapter.title },
    oldMapVisibleDuringReplacement: true,
    atomicFreshIdReplacement: true,
    stableAfterRestart: true,
    firstKnowledgePointCount: firstIds.length,
    replacementKnowledgePointCount: secondIds.length,
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
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await page.locator(`li[data-node-id="${chapterId}"] > .outline-row .outline-map-action`).click();
  await page.locator("#knowledge-panel").waitFor({ state: "visible" });
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
    "tables={row[0] for row in connection.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")}",
    "connection.execute(\"DELETE FROM jobs WHERE job_type = 'CHAPTER_PREPARE'\") if 'jobs' in tables else None",
    "connection.execute(\"DELETE FROM chapter_preparations\") if 'chapter_preparations' in tables else None",
    "connection.commit()",
    "connection.close()",
  ].join("; ");
  const reset = spawnSync(process.env.READER_PYTHON || "python", ["-c", script, database], {
    cwd: process.cwd(), windowsHide: true, encoding: "utf8",
  });
  if (reset.status !== 0) throw new Error(reset.stderr || "failed to reset copied Knowledge state");
}
