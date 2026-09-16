import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const dataDir = process.env.READER_DATA_DIR;
if (!dataDir) throw new Error("Set READER_DATA_DIR to the app data directory containing both real books");
const expected = new Map([
  [29, "327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1"],
  [348, "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"],
]);
const targetPages = new Map([[29, [0, 11, 28]], [348, [0, 173, 347]]]);
const highlightStyles = ["YELLOW", "GREEN", "BLUE", "YELLOW", "NONE", "GREEN"];
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const artifacts = path.resolve("test-results");
await mkdir(artifacts, { recursive: true });
let running = await startService();
let browser;
let page;
const created = [];
const originalPositions = new Map();
const loadTimings = [];

try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  page = await context.newPage();
  await page.goto(running.url);
  let books = await library(page);
  assert.equal(books.length, 2, "formal R3 data directory must contain exactly the two acceptance books");
  for (const book of books) {
    const revision = book.active_revision;
    assert.equal(revision.blob_sha256, expected.get(revision.page_count), `unexpected ${revision.page_count}-page source`);
    originalPositions.set(revision.id, { ...revision.position });
  }

  for (const pageCount of [29, 348]) {
    const book = books.find((value) => value.active_revision.page_count === pageCount);
    await openBook(page, pageCount);
    assert.equal(await page.locator(".page").count(), pageCount);
    for (const [targetOffset, pageIndex] of targetPages.get(pageCount).entries()) {
      const started = performance.now();
      const line = await goToSelectableLine(page, book.active_revision.id, pageIndex);
      loadTimings.push({ pageCount, pageIndex, milliseconds: Math.round(performance.now() - started) });
      const body = targetOffset % 2 ? `R3 acceptance note · ${pageCount}p · page ${pageIndex + 1}` : "";
      const highlightStyle = highlightStyles[created.length];
      const before = await annotationsOnPage(page, book.active_revision.id, pageIndex);
      await dragCells(page, pageIndex, line, 0, Math.min(5, line.cells.length));
      assert.equal(await page.locator("#selection-actions").isHidden(), true,
        "finishing a selection must not open Annotation actions");
      if (created.length === 0) await assertOutsideContextMenuIsNative(page);
      await rightClickSelection(page, pageIndex, line, 0, Math.min(5, line.cells.length));
      await page.locator("#selection-actions").waitFor({ state: "visible" });
      assert.equal(await page.locator("#marks-panel").isHidden(), true, "Marks must stay collapsed while saving");
      await page.locator("#save-highlight").click();
      await page.locator(`label:has(input[name="highlight-style"][value="${highlightStyle}"])`).click();
      if (body) {
        await page.locator("#add-note").click();
        await page.locator("#annotation-note").fill(body);
        if (pageCount === 348 && pageIndex === 173) {
          await page.screenshot({
            path: path.join(artifacts, "r3-selection-actions.png"),
            fullPage: false,
          });
        }
        await page.locator("#save-note").click();
      } else {
        await page.locator("#save-highlight").click();
      }
      await page.getByText(body ? "笔记已保存。" : "高亮已保存。").waitFor();
      const beforeIds = new Set(before.map((value) => value.id));
      const annotation = await waitForNewAnnotation(
        page, book.active_revision.id, pageIndex, beforeIds,
      );
      assert.ok(annotation, "UI save did not create exactly addressable durable annotation data");
      assert.equal(annotation.body, body || null);
      assert.equal(annotation.highlight_style, highlightStyle);
      assert.equal(annotation.foundation_version_at_creation, 1);
      assert.equal(annotation.source_kind, "USER");
      assert.equal(annotation.anchor_state, "OK");
      assert.ok(annotation.quote.length > 0 && annotation.quads.length > 0);
      created.push({ revisionId: book.active_revision.id, pageCount, pageIndex, annotation });
      await page.locator(`.annotation-quad.annotation-style-${highlightStyle.toLowerCase()}[data-annotation-id="${annotation.id}"]`).first().waitFor();
      assert.equal(await page.locator("#marks-panel").isHidden(), true, "Saving must not auto-open Marks");
      assert.equal(await page.locator("#marks-toggle").getAttribute("aria-expanded"), "false");
      if (pageCount === 348) {
        await page.screenshot({
          path: path.join(artifacts, `r3-full-${pageIndex + 1}.png`),
          fullPage: false,
        });
      }
    }
    await page.locator("#back-to-library").click();
    await page.locator("#library-home").waitFor({ state: "visible" });
  }

  // Reopen both books before process restart: every stored quad must paint directly.
  for (const pageCount of [29, 348]) {
    await openBook(page, pageCount);
    for (const record of created.filter((value) => value.pageCount === pageCount)) {
      await goToPage(page, record.pageIndex);
      assert.equal(
        await page.locator(`.annotation-quad[data-annotation-id="${record.annotation.id}"]`).count(),
        record.annotation.quads.length,
      );
    }
    await page.locator("#back-to-library").click();
  }

  // Kill and restart the Core Service against the same database, then reload in a fresh page.
  await stopService(running.child);
  running = await startService();
  await page.goto(running.url);
  books = await library(page);
  for (const record of created) {
    const values = await annotationsOnPage(page, record.revisionId, record.pageIndex);
    const reloaded = values.find((value) => value.id === record.annotation.id);
    assert.ok(reloaded, `annotation ${record.annotation.id} was lost across service restart`);
    assert.deepEqual(reloaded.quads, record.annotation.quads, "restart changed persisted display geometry");
    assert.equal(reloaded.quote, record.annotation.quote);
    assert.equal(reloaded.context_before, record.annotation.context_before);
    assert.equal(reloaded.context_after, record.annotation.context_after);
  }

  // Full-book UI reload plus R1/R2 navigation and selection/copy regression.
  await openBook(page, 348);
  const regression = created.find((value) => value.pageCount === 348 && value.pageIndex === 173);
  const line = await goToSelectableLine(page, regression.revisionId, regression.pageIndex);
  assert.equal(
    await page.locator(`.annotation-quad[data-annotation-id="${regression.annotation.id}"]`).count(),
    regression.annotation.quads.length,
  );
  const end = Math.min(4, line.cells.length);
  const expectedCopy = line.text.slice(line.cells[0][2], line.cells[end - 1][3]);
  await dragCells(page, regression.pageIndex, line, 0, end);
  assert.equal(await page.locator("#selection-actions").isHidden(), true);
  await rightClickSelection(page, regression.pageIndex, line, 0, end);
  await page.locator("#copy-selection").click();
  await page.getByText("已复制所选文字。").waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expectedCopy);
  await page.keyboard.press("Control+C");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expectedCopy);
  await page.keyboard.press("Escape");

  // Delete one via the actual Reader affordance and prove it stays gone after reopen.
  await page.locator("#marks-toggle").click();
  const card = page.locator(".mark-card").filter({ hasText: regression.annotation.quote }).first();
  page.once("dialog", (dialog) => dialog.accept());
  await card.locator(".mark-remove").click();
  await page.getByText("标记已删除。").waitFor();
  assert.equal((await annotationsOnPage(page, regression.revisionId, regression.pageIndex))
    .some((value) => value.id === regression.annotation.id), false);
  await page.locator("#back-to-library").click();
  await openBook(page, 348);
  await goToPage(page, regression.pageIndex);
  assert.equal(await page.locator(`.annotation-quad[data-annotation-id="${regression.annotation.id}"]`).count(), 0);
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });

  // Remove only acceptance-created marks and restore the user's original reading positions.
  for (const record of created.filter((value) => value.annotation.id !== regression.annotation.id)) {
    await page.evaluate(async ({ revisionId, annotationId }) => {
      const response = await fetch(`/api/revisions/${revisionId}/annotations/${annotationId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`cleanup failed: ${response.status}`);
    }, { revisionId: record.revisionId, annotationId: record.annotation.id });
  }
  for (const [revisionId, position] of originalPositions) {
    await page.evaluate(async ({ revisionId, position }) => {
      const response = await fetch(`/api/revisions/${revisionId}/position`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(position),
      });
      if (!response.ok) throw new Error(`position restore failed: ${response.status}`);
    }, { revisionId, position });
  }
  for (const record of created) {
    const values = await annotationsOnPage(page, record.revisionId, record.pageIndex);
    assert.equal(values.some((value) => value.id === record.annotation.id), false, "acceptance mark cleanup failed");
  }

  console.log(JSON.stringify({
    result: "PASS",
    books: books.map((book) => ({
      pages: book.active_revision.page_count,
      sha256: book.active_revision.blob_sha256,
    })),
    created: created.map((value) => ({
      pages: value.pageCount,
      page: value.pageIndex + 1,
      note: Boolean(value.annotation.body),
      highlightStyle: value.annotation.highlight_style,
      quadCount: value.annotation.quads.length,
      quoteCharacters: [...value.annotation.quote].length,
    })),
    serviceRestartPersistence: true,
    readerSelectionCopyRegression: true,
    selectionActionCopy: true,
    selectionCompletionIsQuiet: true,
    outsideContextMenuPreserved: true,
    marksCollapsedByDefault: true,
    deletedAndGoneAfterReopen: { pages: 348, page: regression.pageIndex + 1 },
    pageLoadTimings: loadTimings,
    acceptanceMarksCleanedUp: true,
    originalReadingPositionsRestored: true,
    screenshots: targetPages.get(348).map((index) => path.join(artifacts, `r3-full-${index + 1}.png`)),
    interactionScreenshot: path.join(artifacts, "r3-selection-actions.png"),
  }));
} finally {
  if (page && !page.isClosed()) {
    for (const record of created) {
      await page.evaluate(async ({ revisionId, annotationId }) => {
        await fetch(`/api/revisions/${revisionId}/annotations/${annotationId}`, { method: "DELETE" });
      }, { revisionId: record.revisionId, annotationId: record.annotation.id }).catch(() => {});
    }
    for (const [revisionId, position] of originalPositions) {
      await page.evaluate(async ({ revisionId, position }) => {
        await fetch(`/api/revisions/${revisionId}/position`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(position),
        });
      }, { revisionId, position }).catch(() => {});
    }
  }
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  if (running?.errors?.trim()) process.stderr.write(running.errors);
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

async function goToSelectableLine(page, revisionId, pageIndex) {
  await goToPage(page, pageIndex);
  const overlay = await page.evaluate(async ({ revisionId, pageIndex }) => (
    await (await fetch(`/api/revisions/${revisionId}/overlay?page=${pageIndex}`)).json()
  ).page, { revisionId, pageIndex });
  const line = overlay.lines.find((candidate) => candidate.cells.length >= 5
    && candidate.quad.every(([, y]) => y > 0.04 && y < 0.96));
  assert.ok(line, `page ${pageIndex + 1} has no suitable real selectable line`);
  return line;
}

async function dragCells(page, pageIndex, line, start, end) {
  const box = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = box.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * box.height;
  await page.mouse.move(box.x + line.cells[start][0] * box.width, y);
  await page.mouse.down();
  await page.mouse.move(box.x + line.cells[end - 1][1] * box.width, y, { steps: 8 });
  await page.mouse.up();
}

async function rightClickSelection(page, pageIndex, line, start, end) {
  const box = await page.locator(`.page[data-index="${pageIndex}"]`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const x = box.x + ((line.cells[start][0] + line.cells[end - 1][1]) / 2) * box.width;
  const y = box.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * box.height;
  await page.mouse.click(x, y, { button: "right" });
}

async function assertOutsideContextMenuIsNative(page) {
  await page.evaluate(() => {
    window.__outsideContextMenuPrevented = null;
    document.addEventListener("contextmenu", (event) => {
      window.__outsideContextMenuPrevented = event.defaultPrevented;
    }, { once: true });
  });
  const viewer = await page.locator("#viewer").boundingBox();
  await page.mouse.click(viewer.x + 5, viewer.y + viewer.height / 2, { button: "right" });
  await page.waitForFunction(() => window.__outsideContextMenuPrevented !== null);
  assert.equal(await page.evaluate(() => window.__outsideContextMenuPrevented), false,
    "right-click outside the selected text was prevented");
  assert.equal(await page.locator("#selection-actions").isHidden(), true,
    "right-click outside the selected text opened Annotation actions");
}

async function library(page) {
  return page.evaluate(async () => (await (await fetch("/api/books")).json()).books);
}

async function annotationsOnPage(page, revisionId, pageIndex) {
  return page.evaluate(async ({ revisionId, pageIndex }) => (
    await (await fetch(`/api/revisions/${revisionId}/annotations?page=${pageIndex}`)).json()
  ).annotations, { revisionId, pageIndex });
}

async function waitForNewAnnotation(page, revisionId, pageIndex, beforeIds) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const values = await annotationsOnPage(page, revisionId, pageIndex);
    const created = values.find((value) => !beforeIds.has(value.id));
    if (created) return created;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

async function startService() {
  const child = spawn(
    "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
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

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
