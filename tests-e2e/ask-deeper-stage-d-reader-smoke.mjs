import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the prepared real library");
const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-stage-d-smoke-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });

let running;
let browser;
try {
  running = await startService();
  browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(running.url);
  await openBook(page, 348);
  const revisionId = await currentRevisionId(page);

  await selectExactReaderText(page, revisionId, 24, "时钟脉冲信号");
  await page.locator("#ask-selection").click();
  await dragDockToWidth(page, 540);
  const dockWidth = await page.locator("#assistant-panel").evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(Math.abs(dockWidth - 540) <= 2);
  await page.locator("#assistant-expand").click();
  assert.equal(await page.locator("#assistant-expand").getAttribute("aria-pressed"), "true");
  await page.locator("#assistant-expand").click();
  assert.ok(Math.abs(
    await page.locator("#assistant-panel").evaluate((element) => element.getBoundingClientRect().width) - dockWidth,
  ) <= 2);

  assert.equal(await selectExactReaderText(page, revisionId, 24, "时钟脉冲信号"), "时钟脉冲信号");
  assert.equal(await page.locator("#selection-actions").isVisible(), true);
  const highlightResponse = page.waitForResponse((response) => (
    response.url().includes("/annotations") && response.request().method() === "POST"
  ));
  await page.locator("#save-highlight").click(); // Expand colors first.
  await page.locator("#save-highlight").click();
  assert.equal((await highlightResponse).status(), 201);
  await page.getByText("高亮已保存。").waitFor();

  assert.equal(await selectExactReaderText(page, revisionId, 24, "时钟脉冲信号"), "时钟脉冲信号");
  await page.locator("#add-note").click();
  await page.locator("#annotation-note").fill("Stage D 邻近交互 smoke");
  const noteResponse = page.waitForResponse((response) => (
    response.url().includes("/annotations") && response.request().method() === "POST"
  ));
  await page.locator("#save-note").click();
  assert.equal((await noteResponse).status(), 201);
  await page.getByText("笔记已保存。").waitFor();
  const annotations = await json(page, `/api/revisions/${revisionId}/annotations?page=24`);
  assert.ok(annotations.annotations.some((annotation) => annotation.body === "Stage D 邻近交互 smoke"));

  await page.locator("#search-toggle").click();
  await page.locator("#search-panel").waitFor({ state: "visible" });
  await page.locator("#search-query").fill("中断向量");
  const searchResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/search"));
  await page.locator("#search-form button").click();
  const searchPayload = await (await searchResponse).json();
  assert.ok(searchPayload.results.length > 0);
  const searchTarget = searchPayload.results[0].pdf_page_index;
  await page.locator(".search-result").first().click();
  await page.waitForFunction((value) => document.querySelector("#page-number").value === String(value), searchTarget + 1);
  await page.locator(`.page[data-index="${searchTarget}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#search-close").click();

  await page.locator("#assistant-toggle").click();
  assert.ok(Math.abs(
    await page.locator("#assistant-panel").evaluate((element) => element.getBoundingClientRect().width) - dockWidth,
  ) <= 2);
  await page.locator("#outline-toggle").click();
  await page.locator("#outline-panel").waitFor({ state: "visible" });
  const outline = await json(page, `/api/revisions/${revisionId}/outline`);
  const target = outline.nodes.find((node) => node.title === "6.2.1 总线事务");
  assert.ok(target);
  await expandAncestors(page, outline.nodes, target);
  await page.locator(`li[data-node-id="${target.outline_node_id}"] > .outline-row .outline-target`).click();
  await page.waitForFunction((value) => document.querySelector("#page-number").value === String(value), target.start_page + 1);
  await page.locator(`.page[data-index="${target.start_page}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator("#assistant-panel").isVisible(), true);
  assert.ok(Math.abs(
    await page.locator("#assistant-panel").evaluate((element) => element.getBoundingClientRect().width) - dockWidth,
  ) <= 2);
  assert.deepEqual(pageErrors, []);

  console.log(JSON.stringify({
    status: "PASS",
    realBook: {
      pages: 348,
      sha256: "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd",
    },
    readerSelection: "PASS",
    contextMenu: "PASS",
    highlight: "PASS",
    addNote: "PASS",
    find: { query: "中断向量", targetPdfPage: searchTarget + 1, resultCount: searchPayload.results.length },
    map: { target: target.title, targetPdfPage: target.start_page + 1 },
    assistantWidthPreserved: true,
    assistantExpandedCycle: "PASS",
  }));
} finally {
  if (browser) await browser.close();
  if (running) await stopService(running.child);
  await rm(acceptanceRoot, { recursive: true, force: true });
}

async function expandAncestors(page, nodes, node) {
  const byId = new Map(nodes.map((value) => [value.outline_node_id, value]));
  const parents = [];
  let parent = byId.get(node.parent_id);
  while (parent) {
    parents.unshift(parent);
    parent = byId.get(parent.parent_id);
  }
  for (const ancestor of parents) {
    const button = page.locator(`li[data-node-id="${ancestor.outline_node_id}"] > .outline-row .outline-target`);
    if (await button.getAttribute("aria-expanded") === "false") await button.click();
  }
}

async function dragDockToWidth(page, width) {
  const handle = page.locator("#assistant-resize-handle");
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(1440 - width, box.y + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(180);
}

async function selectExactReaderText(page, revisionId, pageIndex, needle) {
  await goToPage(page, pageIndex);
  const overlay = (await json(page, `/api/revisions/${revisionId}/overlay?page=${pageIndex}`)).page;
  const line = overlay.lines.find((candidate) => candidate.text.includes(needle));
  assert.ok(line, `OCR line missing: ${needle}`);
  const start = line.text.indexOf(needle);
  const end = start + needle.length;
  const firstCell = line.cells.findIndex((cell) => cell[3] > start && cell[2] < end);
  const lastCell = line.cells.findLastIndex((cell) => cell[3] > start && cell[2] < end);
  const boundaryX = (index) => {
    if (index === 0) return line.cells[0][0];
    if (index === line.cells.length) return line.cells.at(-1)[1];
    return (line.cells[index - 1][1] + line.cells[index][0]) / 2;
  };
  const overlayBox = await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).boundingBox();
  const ys = line.quad.map(([, y]) => y);
  const y = overlayBox.y + ((Math.min(...ys) + Math.max(...ys)) / 2) * overlayBox.height;
  const startX = overlayBox.x + boundaryX(firstCell) * overlayBox.width;
  const endX = overlayBox.x + boundaryX(lastCell + 1) * overlayBox.width;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 10 });
  await page.mouse.up();
  await page.mouse.click((startX + endX) / 2, y, { button: "right" });
  await page.locator("#selection-actions").waitFor({ state: "visible" });
  return page.evaluate(() => getSelection()?.toString() || "");
}

async function currentRevisionId(page) {
  return page.evaluate(async () => {
    const books = (await (await fetch("/api/books")).json()).books;
    return books.find((book) => book.active_revision.page_count === 348).active_revision.id;
  });
}

async function openBook(page, pageCount) {
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).locator('.book-open').click();
  await page.locator('#book-overview .overview-book-heading .primary-action').click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
  await page.locator(`.page[data-index="${pageIndex}"] .text-overlay`).waitFor({ state: "attached" });
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
}

async function startService() {
  const child = spawn(
    process.env.READER_PYTHON || "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: process.env },
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
    const timeout = setTimeout(() => reject(new Error(errors())), 20_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
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
