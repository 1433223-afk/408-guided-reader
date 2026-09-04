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

  // Real TOC pages contain separately detected number/title fragments on the
  // same visual row.  Selection must hit the number by both axes, preserve the
  // left-to-right reading order, and expose a native DOM range for the normal
  // browser context-menu copy path.
  await page.reload();
  await page.locator(".book-card").click();
  await page.locator("#page-number").fill("12");
  await page.locator("#page-number").press("Enter");
  await page.locator('.page[data-index="11"] canvas').waitFor({ state: "visible", timeout: 30_000 });
  await page.locator('.page[data-index="11"] .text-overlay').waitFor({ state: "attached", timeout: 15_000 });
  const tocOverlay = await page.evaluate(async ({ revisionId }) => (
    await (await fetch(`/api/revisions/${revisionId}/overlay?page=11`)).json()
  ).page, { revisionId });
  const numberLine = tocOverlay.lines
    .filter((candidate) => /^\d+\.\d+\.\d+$/.test(candidate.text) && candidate.cells.length)
    .sort((left, right) => Math.abs(centerY(left.quad) - 0.378) - Math.abs(centerY(right.quad) - 0.378))[0];
  assert.ok(numberLine, "real TOC page did not expose a selectable dotted section number");
  const numberBounds = bounds(numberLine.quad);
  const titleLine = tocOverlay.lines.find((candidate) => {
    if (candidate === numberLine) return false;
    const candidateBounds = bounds(candidate.quad);
    const overlap = Math.min(numberBounds.y1, candidateBounds.y1) - Math.max(numberBounds.y0, candidateBounds.y0);
    return overlap > 0 && candidateBounds.x0 > numberBounds.x0;
  });
  assert.ok(titleLine, "real TOC number did not have the expected same-row title fragment");
  assert.ok(numberLine.line_ordinal < titleLine.line_ordinal, "same-row TOC fragments were not ordered left-to-right");

  const tocPageBox = await page.locator('.page[data-index="11"]').boundingBox();
  const numberCell = numberLine.cells[0];
  const numberY = tocPageBox.y + ((numberBounds.y0 + numberBounds.y1) / 2) * tocPageBox.height;
  const numberStartX = tocPageBox.x + numberCell[0] * tocPageBox.width;
  const numberEndX = tocPageBox.x + numberLine.cells.at(-1)[1] * tocPageBox.width;
  await page.mouse.move(numberStartX, numberY);
  await page.mouse.down();
  await page.mouse.move(numberEndX, numberY, { steps: 8 });
  await page.mouse.up();
  assert.equal(await page.locator("#selection-actions").isHidden(), true,
    "selection completion opened Annotation actions without a right-click");
  const nativeText = await page.evaluate(() => window.getSelection().toString());
  assert.equal(nativeText, numberLine.text, "precise TOC selection included an adjacent fragment");
  const contextState = await page.evaluate(({ x, y }) => {
    const overlay = document.querySelector('.page[data-index="11"] .text-overlay');
    const event = new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y,
    });
    overlay.dispatchEvent(event);
    return { text: window.getSelection().toString(), defaultPrevented: event.defaultPrevented };
  }, { x: (numberStartX + numberEndX) / 2, y: numberY });
  assert.equal(contextState.text, numberLine.text, "right-click did not preserve the native text selection");
  assert.equal(contextState.defaultPrevented, true, "selected text did not open selection actions");
  assert.equal(await page.locator("#selection-actions").isVisible(), true,
    "right-click on selected text did not open selection actions");
  await page.keyboard.press("Control+C");
  const tocClipboard = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(tocClipboard, numberLine.text, "TOC copy included an adjacent title fragment");
  await page.screenshot({ path: path.join(artifacts, "r2-precise-toc-selection.png"), fullPage: false });

  const selectionPaint = await page.evaluate(() => {
    const nativeLine = document.querySelector('.page[data-index="11"] .ocr-line');
    const customQuad = document.querySelector('.page[data-index="11"] .selection-quad');
    return {
      nativeBackground: getComputedStyle(nativeLine, "::selection").backgroundColor,
      customBackground: getComputedStyle(customQuad).backgroundColor,
    };
  });
  assert.ok(
    ["transparent", "rgba(0, 0, 0, 0)"].includes(selectionPaint.nativeBackground),
    `native selection paint leaked through: ${selectionPaint.nativeBackground}`,
  );
  assert.equal(selectionPaint.customBackground, "rgba(65, 126, 211, 0.2)");

  // Visual QA fixtures: a large split heading plus body, then ordinary body
  // lines.  These retain native selection/copy but must be painted only by the
  // lightweight presentation layer.
  await page.keyboard.press("Escape");
  await goToPreparedPage(page, 12);
  const headingOverlay = await overlayPage(page, revisionId, 12);
  const headingLines = headingOverlay.lines.filter((candidate) => (
    candidate.cells.length && centerY(candidate.quad) >= 0.1 && centerY(candidate.quad) <= 0.56
  ));
  assert.ok(headingLines.length > 8, "large-heading visual fixture lacked enough selectable lines");
  await dragLineRange(page, 12, headingLines[0], headingLines.at(-1));
  assert.ok((await page.evaluate(() => window.getSelection().toString())).length > 20);
  await page.screenshot({ path: path.join(artifacts, "r2-polished-large-heading-selection.png"), fullPage: false });

  await page.keyboard.press("Escape");
  await goToPreparedPage(page, 13);
  const bodyOverlay = await overlayPage(page, revisionId, 13);
  const bodyLines = bodyOverlay.lines.filter((candidate) => (
    candidate.cells.length >= 10 && centerY(candidate.quad) >= 0.18 && centerY(candidate.quad) <= 0.7
  ));
  assert.ok(bodyLines.length >= 3, "ordinary-body visual fixture lacked selectable lines");
  await dragLineRange(page, 13, bodyLines[0], bodyLines[2]);
  assert.ok((await page.evaluate(() => window.getSelection().toString())).length > 20);
  await page.screenshot({ path: path.join(artifacts, "r2-polished-body-selection.png"), fullPage: false });

  console.log(JSON.stringify({
    result: "PASS",
    pagesReady: completed.pages.length,
    routes,
    selectedPage: 29,
    selectedLine: line.line_ordinal,
    selectedCellCount: chosen.length,
    copiedCharacterCount: [...clipboard].length,
    preciseTocSelection: numberLine.text,
    contextMenuUsesSelectionActions: true,
    nativeSelectionPaint: selectionPaint.nativeBackground,
    customSelectionPaint: selectionPaint.customBackground,
    screenshots: [
      path.join(artifacts, "r2-selectable-page-29.png"),
      path.join(artifacts, "r2-precise-toc-selection.png"),
      path.join(artifacts, "r2-polished-large-heading-selection.png"),
      path.join(artifacts, "r2-polished-body-selection.png"),
    ],
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

async function overlayPage(page, revisionId, pageIndex) {
  return page.evaluate(async ({ id, index }) => (
    await (await fetch(`/api/revisions/${id}/overlay?page=${index}`)).json()
  ).page, { id: revisionId, index: pageIndex });
}

async function goToPreparedPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached", timeout: 15_000 });
}

async function dragLineRange(page, pageIndex, startLine, endLine) {
  const pageBox = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const startBounds = bounds(startLine.quad);
  const endBounds = bounds(endLine.quad);
  const startX = pageBox.x + startLine.cells[0][0] * pageBox.width;
  const startY = pageBox.y + ((startBounds.y0 + startBounds.y1) / 2) * pageBox.height;
  const endX = pageBox.x + endLine.cells.at(-1)[1] * pageBox.width;
  const endY = pageBox.y + ((endBounds.y0 + endBounds.y1) / 2) * pageBox.height;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 16 });
  await page.mouse.up();
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}

function bounds(quad) {
  const xs = quad.map(([x]) => x);
  const ys = quad.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

function centerY(quad) {
  const value = bounds(quad);
  return (value.y0 + value.y1) / 2;
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
