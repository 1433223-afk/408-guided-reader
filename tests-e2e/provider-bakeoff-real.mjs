import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the prepared 348-page real-material library");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const expectedModels = {
  deepseek: "deepseek-flash",
  zhipu: "GLM-5.3-Flash",
  openrouter: "google/gemini-3.8-flash",
};
const items = [
  { id: "big_endian", page: 73, line: 37, needle: "大端方式" },
  { id: "little_endian", page: 73, line: 38, needle: "小端方式" },
  { id: "endian_when", page: 73, line: 15, needle: "大端方式", question: "什么时候用大端，什么时候用小端？" },
  { id: "machine_cycle", page: 224, line: 29, needle: "机器周期" },
  { id: "machine_vs_bus_cycle", page: 224, line: 29, needle: "机器周期", question: "机器周期就等于总线周期？" },
  { id: "bus_arbitration", page: 308, line: 27, needle: "总线仲裁" },
  { id: "mar_mdr", page: 14, line: 16, needle: "MAR和MDR", question: "MAR 和 MDR 有什么区别？" },
  { id: "cache_fully_associative", page: 130, line: 52, needle: "全相联映射", question: "Cache 为什么不能全部做成全相联？" },
  { id: "twos_complement", page: 40, line: 4, needle: "补码", question: "补码为什么能把减法变成加法？" },
  { id: "correct_wrong_endian", page: 73, line: 37, needle: "大端方式", question: "我的理解是：大端方式就是低位字节放在低地址，对吗？" },
];

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-provider-bakeoff-real-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
let running;
let browser;
const evidence = { status: "PASS", callDate: new Date().toISOString(), comparisons: [], followUps: [], failures: [] };
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  running = await startService({ GUIDED_READER_PROVIDER_BAKEOFF: "1" });
  await page.goto(running.url);
  const status = await json(page, "/api/assistant/status");
  assert.equal(status.bakeoff_enabled, true);
  assert.equal(status.active_provider, "deepseek");
  assert.deepEqual(Object.fromEntries(status.providers.map((item) => [item.provider, item.model])), expectedModels);
  assert.ok(status.providers.every((item) => item.configured), "all three real credentials must be available");
  evidence.providers = status.providers.map((item) => ({
    provider: item.provider,
    model: item.model,
    endpoint: item.endpoint,
    credential_target: item.credential_target,
    effective_config: item.effective_config,
  }));
  await openBook(page, 348);
  assert.equal(await page.locator("#compare-selection").count(), 0,
    "real benchmark must not expose a comparison control in the Reader UI");
  for (const item of items) {
    const selected = await selectExactText(page, item);
    const debugResult = await page.evaluate(async ({ revisionId, request, question }) => {
      const response = await fetch(`/api/revisions/${revisionId}/assistant/bake-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reader_session_id: "debug-bakeoff-real-run",
          ...request,
          ...(question ? { question } : {}),
        }),
      });
      return { status: response.status, payload: await response.json() };
    }, { revisionId: selected.revisionId, request: selected.request, question: item.question });
    assert.equal(debugResult.status, 200, `${item.id} comparison failed`);
    const comparison = debugResult.payload.comparison;
    assert.equal(comparison.selected_text, selected.text);
    assert.equal(comparison.question, item.question || selected.text);
    assert.deepEqual(Object.fromEntries(comparison.results.map((result) => [result.provider, result.model])), expectedModels);
    for (const result of comparison.results) {
      if (!result.answer) evidence.failures.push({ stage: item.id, provider: result.provider, error: result.error });
    }
    evidence.comparisons.push({
      id: item.id,
      selected_text: selected.text,
      question: comparison.question,
      scope: comparison.scope,
      call_date: new Date().toISOString(),
      results: comparison.results,
    });
  }
  await stopService(running.child);
  running = null;

  for (const provider of Object.keys(expectedModels)) {
    running = await startService({
      GUIDED_READER_ASSISTANT_PROVIDER: provider,
      GUIDED_READER_PROVIDER_BAKEOFF: "0",
    });
    await page.goto(running.url);
    const providerStatus = await json(page, "/api/assistant/status");
    assert.equal(providerStatus.active_provider, provider);
    assert.equal(providerStatus.model, expectedModels[provider]);
    assert.equal(providerStatus.configured, true);
    assert.equal(providerStatus.bakeoff_enabled, false);
    await openBook(page, 348);
    const selected = await selectExactText(
      page, items.find((item) => item.id === "machine_cycle"), false,
    );
    assert.equal(await page.locator("#compare-selection").count(), 0);
    const firstResponse = page.waitForResponse(
      (response) => response.url().endsWith("/assistant/ask"), { timeout: 180_000 },
    );
    await page.locator("#ask-selection").click();
    await page.locator("#assistant-first-turn").waitFor({ state: "visible" });
    await page.locator("#assistant-start").click();
    const firstHttp = await firstResponse;
    if (firstHttp.status() !== 200) {
      evidence.failures.push({ stage: "follow_up", provider, error: await firstHttp.json() });
      evidence.followUps.push({
        provider,
        model: expectedModels[provider],
        selected_text: selected.text,
        error: evidence.failures.at(-1).error,
        call_date: new Date().toISOString(),
      });
      await stopService(running.child);
      running = null;
      continue;
    }
    const first = (await firstHttp.json()).assistant.current;
    const questions = [
      "机器周期就等于总线周期？",
      "我的理解是：一个机器周期就是 CPU 完成一整条指令的时间，对吗？",
    ];
    const answers = [];
    for (const question of questions) {
      const followResponse = page.waitForResponse(
        (response) => response.url().endsWith("/assistant/follow-up"), { timeout: 180_000 },
      );
      await page.locator("#assistant-question").fill(question);
      await page.locator("#assistant-send").click();
      const followedHttp = await followResponse;
      assert.equal(followedHttp.status(), 200, `${provider} follow-up failed`);
      const followed = (await followedHttp.json()).assistant.current;
      answers.push(followed.turns.at(-1).answer);
    }
    const inspection = await json(page, "/api/assistant/inspection");
    assert.ok(inspection.calls.every((call) => call.provider === provider));
    evidence.followUps.push({
      provider,
      model: expectedModels[provider],
      selected_text: selected.text,
      first_answer: first.turns[0].answer,
      questions: questions.map((question, index) => ({ question, answer: answers[index] })),
      inspected_calls: inspection.calls.length,
      call_date: new Date().toISOString(),
    });
    await stopService(running.child);
    running = null;
  }
  evidence.status = evidence.failures.length ? "PARTIAL" : "PASS";
  if (process.env.BAKEOFF_EVIDENCE_PATH) {
    await writeFile(process.env.BAKEOFF_EVIDENCE_PATH, JSON.stringify(evidence, null, 2), "utf8");
    console.log(JSON.stringify({
      status: evidence.status,
      evidencePath: process.env.BAKEOFF_EVIDENCE_PATH,
      failureCount: evidence.failures.length,
      comparisonSummary: evidence.comparisons.map((item) => ({
        id: item.id,
        results: item.results.map((result) => ({
          provider: result.provider,
          latency_ms: result.latency_ms,
          total_tokens: result.usage?.total_tokens ?? null,
          error: result.error?.code ?? null,
        })),
      })),
    }));
  } else {
    console.log(JSON.stringify(evidence));
  }
  if (evidence.failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  if (running?.errors?.trim()) process.stderr.write(running.errors);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function selectExactText(page, item, requireCompare = true) {
  await goToPage(page, item.page);
  const revisionId = await page.evaluate(async () => (
    (await (await fetch("/api/books")).json()).books
      .find((book) => book.active_revision.page_count === 348).active_revision.id
  ));
  const overlay = await page.evaluate(async ({ revisionId: id, pageIndex: index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { revisionId, pageIndex: item.page });
  const line = overlay.lines.find((candidate) => candidate.line_ordinal === item.line);
  assert.ok(line, `${item.id}: line ${item.line} is unavailable on PDF page ${item.page + 1}`);
  const start = line.text.indexOf(item.needle);
  assert.ok(start >= 0, `${item.id}: ${item.needle} is absent from ${line.text}`);
  const end = start + item.needle.length;
  const chosen = line.cells.filter((cell) => cell[3] > start && cell[2] < end);
  assert.ok(chosen.length, `${item.id}: no selectable cells for ${item.needle}`);
  const pageBox = await page.locator(`.page[data-index="${item.page}"]`).boundingBox();
  const lineBounds = bounds(line.quad);
  const y = pageBox.y + ((lineBounds.y0 + lineBounds.y1) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  if (!requireCompare) assert.equal(await page.locator("#ask-selection").isEnabled(), true);
  return {
    text: line.text.slice(chosen[0][2], chosen.at(-1)[3]),
    revisionId,
    request: {
      pdf_page_index: item.page,
      start: { line_ordinal: line.line_ordinal, boundary: chosen[0][2] },
      end: { line_ordinal: line.line_ordinal, boundary: chosen.at(-1)[3] },
    },
  };
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached", timeout: 15_000 });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
}

async function startService(extraEnv) {
  const child = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    env: { ...process.env, ...extraEnv },
  });
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

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
