import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to the hash-verified 29-page scanned PDF");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const dataDir = await mkdtemp(path.join(os.tmpdir(), "guided-reader-r2-e2e-"));
const artifacts = path.resolve("test-results");
await mkdir(artifacts, { recursive: true });
const service = spawn(
  "python",
  ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
  { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
let serviceErrors = "";
service.stderr.on("data", (chunk) => { serviceErrors += chunk.toString(); });

let browser;
try {
  const url = await readyUrl(service);
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });

  // The original PDF remains navigable while OCR is incomplete.
  const early = await preparation(page);
  assert.ok(early.pages.some((item) => item.status !== "READY"), "all OCR completed before the non-blocking check");
  await page.locator("#page-number").fill("29");
  await page.locator("#page-number").press("Enter");
  await page.locator('.page[data-index="28"] canvas').waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator("#page-number").inputValue(), "29");

  // Visible-page priority should make page 29 selectable without waiting for the whole book.
  const revisionId = await page.evaluate(async () => (await (await fetch("/api/books")).json()).books[0].active_revision.id);
  await waitForPreparation(
    page,
    revisionId,
    (result) => result.pages[28].status === "READY",
    90_000,
  );
  await page.locator('.page[data-index="28"] .text-overlay').waitFor({ state: "attached", timeout: 15_000 });

  const overlay = await page.evaluate(async ({ revisionId }) => (
    await (await fetch(`/api/revisions/${revisionId}/overlay?page=28`)).json()
  ).page, { revisionId });
  const line = overlay.lines.find((candidate) => candidate.cells.length >= 4 && candidate.quad.every((point) => point[1] > 0.05 && point[1] < 0.95));
  assert.ok(line, "prepared real page did not expose a selectable line");
  const chosen = line.cells.slice(0, Math.min(5, line.cells.length));
  const expectedText = line.text.slice(chosen[0][2], chosen.at(-1)[3]);
  assert.ok(expectedText.length > 0, "selected real glyph range resolved to empty text");

  const pageBox = await page.locator('.page[data-index="28"]').boundingBox();
  const ys = line.quad.map((point) => point[1]);
  const y = pageBox.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * pageBox.height;
  const startX = pageBox.x + chosen[0][0] * pageBox.width;
  const endX = pageBox.x + chosen.at(-1)[1] * pageBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.locator('.page[data-index="28"] .selection-quad').count() >= 1);
  await page.keyboard.press("Control+C");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clipboard, expectedText, "browser copy did not use the resolved real-page cell range");
  await page.screenshot({ path: path.join(artifacts, "r2-selectable-page-29.png"), fullPage: false });

  // Reload proves persisted geometry, not an in-memory OCR response, rebuilds the overlay.
  const beforeReload = JSON.stringify(line.quad);
  await page.reload();
  await page.locator(".book-card").click();
  await page.locator('.page[data-index="28"] canvas').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('.page[data-index="28"] .text-overlay').waitFor({ state: "attached", timeout: 15_000 });
  const reloaded = await page.evaluate(async ({ revisionId }) => (
    await (await fetch(`/api/revisions/${revisionId}/overlay?page=28`)).json()
  ).page, { revisionId });
  assert.equal(JSON.stringify(reloaded.lines.find((item) => item.line_ordinal === line.line_ordinal).quad), beforeReload);

  // Complete the actual 29-page background run and require page-level terminal state.
  const completed = await waitForPreparation(
    page,
    revisionId,
    (result) => result.pages.length === 29
      && result.pages.every((item) => item.status === "READY")
      && result.jobs.SUCCEEDED === 29,
    240_000,
  );
  assert.equal(completed.pages.length, 29);
  const routes = [...new Set(completed.pages.map((item) => item.route))];
  assert.ok(
    routes.every((route) => ["OCR", "EMBEDDED"].includes(route)),
    JSON.stringify(completed.pages.filter((item) => !item.route)),
  );
  assert.ok(routes.includes("OCR"), "the scanned real sample never exercised the OCR route");
  assert.equal(completed.jobs.SUCCEEDED, 29);
  assert.equal(completed.jobs.RUNNING, 0);
  assert.equal(completed.jobs.QUEUED, 0);

  console.log(JSON.stringify({
    result: "PASS",
    pagesReady: completed.pages.length,
    routes,
    selectedPage: 29,
    selectedLine: line.line_ordinal,
    selectedCellCount: chosen.length,
    copiedCharacterCount: [...clipboard].length,
    screenshot: path.join(artifacts, "r2-selectable-page-29.png"),
  }));
} finally {
  if (browser) await browser.close();
  service.kill();
  await rm(dataDir, { recursive: true, force: true });
  if (serviceErrors.trim()) process.stderr.write(serviceErrors);
}

async function preparation(page, revisionId = null) {
  return page.evaluate(async (knownRevision) => {
    const id = knownRevision || (await (await fetch("/api/books")).json()).books[0].active_revision.id;
    return (await (await fetch(`/api/revisions/${id}/preparation`)).json());
  }, revisionId);
}

async function waitForPreparation(page, revisionId, predicate, timeout) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await preparation(page, revisionId);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Preparation timed out: ${JSON.stringify(latest)}`);
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}

function readyUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Core Service did not start. ${serviceErrors}`)), 20_000);
    child.once("exit", (code) => reject(new Error(`Core Service exited ${code}. ${serviceErrors}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
}
