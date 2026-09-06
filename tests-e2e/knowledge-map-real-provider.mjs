import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  deepseek: "deepseek-v4-pro",
  zhipu: "GLM-5.3-Flash",
  openrouter: "google/gemini-3.8-flash",
};
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-knowledge-real-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });

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
  const chapter = outline.nodes.find((node) => node.title === "第6章 总线");
  assert.ok(chapter);
  await page.locator(`li[data-node-id="${chapter.outline_node_id}"] > .outline-row .outline-map-action`).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/knowledge-map/prepare"));
  await page.locator("#knowledge-prepare").click();
  assert.equal((await responsePromise).status(), 202);

  try {
    await page.waitForFunction(
      () => {
        const text = document.querySelector("#knowledge-status")?.textContent || "";
        return text.includes("结构版本") || text.includes("准备失败");
      },
      null,
      { timeout: 900_000 },
    );
  } catch (error) {
    const stalled = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
    const inspected = await json(page, "/api/assistant/inspection");
    const attempts = inspected.calls.filter((call) => call.interaction_id?.startsWith("kp-"));
    throw new Error(`Real provider Chapter preparation timed out: ${JSON.stringify({
      chapter: { status: stalled.status, stage: stalled.failure_stage, code: stalled.failure_code },
      providerAttempts: attempts.map((call) => ({
        provider: call.provider,
        interaction_id: call.interaction_id,
        attempt: call.attempt,
        max_tokens: call.request_body.max_tokens,
      })),
      cause: error.message,
    })}`);
  }
  const result = await json(page, `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map`);
  if (result.status !== "READY") {
    const inspected = await json(page, "/api/assistant/inspection");
    const attempts = inspected.calls.filter((call) => call.interaction_id?.startsWith("kp-"));
    throw new Error(`Real provider Chapter preparation did not publish: ${JSON.stringify({
      status: result.status,
      stage: result.failure_stage,
      kind: result.failure_kind,
      code: result.failure_code,
      generator: [result.generator_provider, result.generator_model],
      reviewer: [result.reviewer_provider, result.reviewer_model],
      summary: result.review_summary,
      providerAttempts: attempts.map((call) => ({
        provider: call.provider,
        interaction_id: call.interaction_id,
        attempt: call.attempt,
        max_tokens: call.request_body.max_tokens,
      })),
    })}`);
  }
  assert.ok(result.knowledge_points.length >= 2);
  assert.equal(result.generator_provider, generatorProvider);
  assert.equal(result.generator_model, providerModels[generatorProvider]);
  assert.equal(result.reviewer_provider, reviewerProvider);
  assert.equal(result.reviewer_model, providerModels[reviewerProvider]);
  assert.ok(await page.locator("#knowledge-map .knowledge-section").count() >= 1);

  const knowledgeInspection = await json(
    page,
    `/api/revisions/${revisionId}/chapters/${chapter.outline_node_id}/knowledge-map/inspection`,
  );
  assert.equal(knowledgeInspection.attempts.length, 1);
  assert.equal(knowledgeInspection.attempts[0].outcome, "READY");
  assert.deepEqual(Object.keys(knowledgeInspection.attempts[0].source_payload).sort(), [
    "chapter", "outline", "source_sections",
  ]);
  assert.deepEqual(Object.keys(knowledgeInspection.attempts[0].review_payload).sort(), [
    "bounded_source", "candidate_knowledge_points", "chapter", "generation_provenance", "outline",
  ]);
  const runtimeInspection = await json(page, "/api/assistant/inspection");
  const calls = runtimeInspection.calls.filter((call) => (
    call.interaction_id?.startsWith("kp-generation:") || call.interaction_id?.startsWith("kp-review:")
  ));
  const generationCalls = calls.filter((call) => call.interaction_id.startsWith("kp-generation:"));
  const reviewCalls = calls.filter((call) => call.interaction_id.startsWith("kp-review:"));
  assert.ok(calls.some((call) => call.provider === generatorProvider && call.request_body.model === providerModels[generatorProvider]));
  assert.ok(calls.some((call) => call.provider === reviewerProvider && call.request_body.model === providerModels[reviewerProvider]));
  assert.ok(generationCalls.length >= 1);
  assert.ok(generationCalls.every((call) => call.request_body.max_tokens === 12_288));
  assert.ok(reviewCalls.length >= 1);
  assert.ok(reviewCalls.every((call) => call.request_body.max_tokens === 12_288));
  assert.ok(!/Authorization|api[_-]?key|credential/i.test(JSON.stringify(calls)));

  const screenshot = path.join(process.cwd(), "test-results", "knowledge-map-real-provider.png");
  await mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  console.log(JSON.stringify({
    status: "PASS",
    realBook: { pages: 348, sha256: expectedHash, chapter: "第6章 总线" },
    generator: `${result.generator_provider}/${result.generator_model}`,
    reviewer: `${result.reviewer_provider}/${result.reviewer_model}`,
    providerCalls: calls.length,
    generatorMaxTokens: 12_288,
    reviewerMaxTokens: 12_288,
    structureVersion: result.structure_version,
    knowledgePointCount: result.knowledge_points.length,
    sectionGroups: await page.locator("#knowledge-map .knowledge-section").count(),
    finalPayloadsInspected: true,
    screenshot,
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
    return response.json();
  }, url);
}

async function startService() {
  const child = spawn(
    process.env.READER_PYTHON || "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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
