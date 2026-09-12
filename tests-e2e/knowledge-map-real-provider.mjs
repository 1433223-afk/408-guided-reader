import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const expectedHash = "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd";
const generatorProvider = process.env.READER_REAL_KP_GENERATOR || "deepseek";
const reviewerProvider = process.env.READER_REAL_KP_REVIEWER || "zhipu";
const providerModels = {
  deepseek: "deepseek-flash",
  zhipu: "GLM-5.3-Flash",
  openrouter: "google/gemini-3.8-flash",
};
const targetTitles = (process.env.READER_REAL_KP_CHAPTERS || "第1章 计算机系统概述|第6章 总线")
  .split("|").map((value) => value.trim()).filter(Boolean);
assert.ok(targetTitles.length >= 1, "real-provider run requires at least one Chapter");

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-knowledge-real-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
resetCopiedKnowledgeState();

let running;
let browser;
try {
  running = await startService();
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  const books = await json(page, "/api/books");
  const book = books.books.find((value) => value.active_revision?.page_count === 348);
  assert.ok(book, "missing 348-page real book");
  assert.equal(book.active_revision.blob_sha256, expectedHash);
  const revisionId = book.active_revision.id;
  await page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  const outline = await json(page, `/api/revisions/${revisionId}/outline`);

  const metrics = [];
  for (const title of targetTitles) {
    const chapter = outline.nodes.find((node) => node.title === title);
    assert.ok(chapter, `missing real Outline Chapter: ${title}`);
    const pathName = `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`;
    const startedAt = Date.now();
    const requested = await postJson(page, `${pathName}/prepare`, {});
    assert.equal(requested.chapter_map.status, "PREPARING");
    const result = await waitForTerminalChapter(page, pathName, 900_000);
    const durationMs = Date.now() - startedAt;
    const inspection = await json(page, `${pathName}/inspection`);
    if (result.status !== "READY") {
      throw new Error(`Real provider Chapter preparation did not publish: ${JSON.stringify({
        title,
        status: result.status,
        stage: result.failure_stage,
        kind: result.failure_kind,
        code: result.failure_code,
        summary: result.review_summary,
        safeInspection: inspection,
      })}`);
    }

    assert.ok(result.knowledge_points.length >= 2);
    assert.equal(result.generator_provider, generatorProvider);
    assert.equal(result.generator_model, providerModels[generatorProvider]);
    assert.equal(result.reviewer_provider, reviewerProvider);
    assert.equal(result.reviewer_model, providerModels[reviewerProvider]);
    assert.equal(inspection.attempts.length, 1);
    const observed = inspection.attempts[0];
    assert.equal(observed.outcome, "READY");
    assert.equal(observed.chapter_id, chapter.outline_node_id);
    assert.ok(observed.unit_count > 0);
    assert.ok(observed.window_count > 0);
    assert.equal(observed.window_bounds.length, observed.window_count);
    assert.ok(observed.window_bounds.every((window) => (
      window.unit_count >= 1
        && window.character_count > 0
        && window.character_count <= 4_800
    )));
    assert.equal(observed.review.verdict, "PASS");
    assert.ok(observed.review.payload_character_count > 0);
    assert.ok(observed.review.payload_character_count < observed.source_payload_character_count);
    const serializedObservation = JSON.stringify(observed);
    assert.ok(!/"(?:source_payload|generation_payloads|review_payload|request_body|response_body|reasoning_content)"\s*:/.test(serializedObservation));

    const attempts = inspection.pipeline_attempts.filter(
      (attempt) => attempt.preparation_attempt_id === result.attempt_id,
    );
    const semanticAttempts = attempts.filter(
      (attempt) => attempt.pipeline_stage === "SEMANTIC_CLASSIFICATION",
    );
    const reviewAttempts = attempts.filter(
      (attempt) => attempt.pipeline_stage === "STRUCTURAL_REVIEW",
    );
    assert.ok(semanticAttempts.length >= observed.window_count);
    assert.ok(reviewAttempts.length >= 1);
    assert.ok(semanticAttempts.every((attempt) => (
      attempt.provider === generatorProvider
        && attempt.model === providerModels[generatorProvider]
        && attempt.primary_section_id
        && attempt.packet_or_stage_id.startsWith("w")
        && attempt.semantic_round === 0
    )));
    assert.ok(reviewAttempts.every((attempt) => (
      attempt.provider === reviewerProvider
        && attempt.model === providerModels[reviewerProvider]
        && attempt.primary_section_id === null
        && attempt.packet_or_stage_id === "chapter-structural-review"
    )));
    assert.ok(attempts.every((attempt) => (
      !Object.hasOwn(attempt, "request_body")
        && !Object.hasOwn(attempt, "response_body")
        && !Object.hasOwn(attempt, "reasoning_content")
    )));
    let briefIoControlFrameworkCount = null;
    if (title === "第7章 输入/输出系统") {
      const ioControlBand = result.knowledge_points.filter((point) => (
        rangeOverlapsPageBand(point, 311, 0.467, 0.601)
      ));
      assert.equal(
        ioControlBand.length,
        1,
        "7.1.3 overview enumeration must publish as one framework KP",
      );
      assert.ok(ioControlBand[0].start_page < 311 || ioControlBand[0].start_y <= 0.468);
      assert.ok(ioControlBand[0].end_page > 311 || ioControlBand[0].end_y >= 0.600);
      briefIoControlFrameworkCount = ioControlBand.length;
    }
    const sectionGroups = new Set(
      result.knowledge_points.map((point) => point.primary_section_id),
    ).size;
    const sectionTitles = new Map(
      outline.nodes.map((node) => [node.outline_node_id, node.title]),
    );
    metrics.push({
      chapter: title,
      durationMs,
      unitCount: observed.unit_count,
      windowCount: observed.window_count,
      candidateCount: observed.candidate_count,
      maxWindowCharacters: Math.max(...observed.window_bounds.map((window) => window.character_count)),
      rawSourceCharacters: observed.source_character_count,
      rawSourcePayloadCharacters: observed.source_payload_character_count,
      compactReviewCharacters: observed.review.payload_character_count,
      generatorRoute: `${result.generator_provider}/${result.generator_model}`,
      reviewerRoute: `${result.reviewer_provider}/${result.reviewer_model}`,
      technicalFailures: attempts.filter((attempt) => attempt.status === "FAILED").length,
      structureVersion: result.structure_version,
      knowledgePointCount: result.knowledge_points.length,
      sectionGroups,
      briefIoControlFrameworkCount,
      knowledgePoints: result.knowledge_points.map((point) => ({
        section: sectionTitles.get(point.primary_section_id),
        title: point.title,
        oneSentenceMeaning: point.one_sentence_definition,
      })),
    });
  }

  const runtimeInspection = await json(page, "/api/assistant/inspection");
  assert.equal(
    runtimeInspection.calls.filter((call) => call.interaction_id?.startsWith("kp-")).length,
    0,
    "Knowledge provider request bodies must not be retained by PayloadInspector",
  );

  const lastChapter = outline.nodes.find((node) => node.title === targetTitles.at(-1));
  await page.locator(`li[data-node-id="${lastChapter.outline_node_id}"] > .outline-row .outline-map-action`).click();
  await page.locator("#knowledge-panel").waitFor({ state: "visible" });
  await page.locator("#knowledge-map .knowledge-section").first().waitFor();
  const visibleGroups = await page.locator("#knowledge-map .knowledge-section").count();
  assert.equal(visibleGroups, metrics.at(-1).sectionGroups);
  const lastResult = await json(
    page,
    `/api/revisions/${revisionId}/chapters/${lastChapter.outline_node_id}/knowledge-map`,
  );
  const firstPoint = lastResult.knowledge_points[0];
  await page.locator("#knowledge-map .knowledge-section li button").first().click();
  await waitForSourceAnchor(page, firstPoint);
  await page.locator(`.page[data-index="${firstPoint.start_page}"] canvas`).waitFor({ state: "visible" });

  const screenshot = path.join(process.cwd(), "test-results", "knowledge-map-real-provider.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  await page.locator(`li[data-node-id="${lastChapter.outline_node_id}"] > .outline-row .outline-map-action`).click();
  await page.locator("#knowledge-panel").waitFor({ state: "visible" });
  await page.screenshot({ path: screenshot });
  console.log(JSON.stringify({
    status: "PASS",
    realBook: { pages: 348, sha256: expectedHash },
    chapterReliability: metrics,
    requestBodiesRetained: false,
    sectionGroupedMap: true,
    kpToTextbookNavigation: true,
    screenshot,
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await rm(acceptanceRoot, { recursive: true, force: true });
}


function rangeOverlapsPageBand(point, pageIndex, startY, endY) {
  const startsBeforeEnd = point.start_page < pageIndex
    || (point.start_page === pageIndex && point.start_y <= endY);
  const endsAfterStart = point.end_page > pageIndex
    || (point.end_page === pageIndex && point.end_y >= startY);
  return startsBeforeEnd && endsAfterStart;
}


async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }, url);
}


async function postJson(page, url, body) {
  return page.evaluate(async ({ endpoint, value }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }, { endpoint: url, value: body });
}


async function waitForTerminalChapter(page, pathName, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await json(page, pathName);
    if (state.status === "READY" || state.status === "FAILED") return state;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  const state = await json(page, pathName);
  throw new Error(`Real provider Chapter preparation timed out: ${JSON.stringify({
    status: state.status,
    stage: state.prepare_stage,
    sections: [state.sections_completed, state.sections_total],
  })}`);
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


async function startService() {
  const child = spawn(
    process.env.READER_PYTHON || "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        GUIDED_READER_KP_GENERATOR_PROVIDER: generatorProvider,
        GUIDED_READER_KP_REVIEW_PROVIDER: reviewerProvider,
      },
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
  const reset = spawnSync(
    process.env.READER_PYTHON || "python",
    ["-c", script, database],
    { cwd: process.cwd(), windowsHide: true, encoding: "utf8" },
  );
  if (reset.status !== 0) throw new Error(
    reset.stderr || "failed to reset copied Knowledge state",
  );
}
