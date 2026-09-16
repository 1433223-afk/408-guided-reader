import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const source = process.env.READER_DATA_DIR;
if (!source) throw new Error("Set READER_DATA_DIR to the prepared real-book Library");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "reader-position-"));
await cp(path.join(source, "blobs"), path.join(dataDir, "blobs"), { recursive: true });
const backup = spawnSync("python", ["-c",
  "import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); t=sqlite3.connect(sys.argv[2]); s.backup(t); t.close(); s.close()",
  path.join(source, "state.sqlite3"), path.join(dataDir, "state.sqlite3")],
{ windowsHide: true, encoding: "utf8" });
assert.equal(backup.status, 0, backup.stderr);
let running;
let browser;
try {
  running = await start();
  browser = await chromium.launch({
    executablePath: process.env.READER_CHROMIUM || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const writes = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/position")) writes.push(JSON.parse(request.postData()));
  });
  await page.goto(running.url);
  const books = await page.evaluate(async () => (await (await fetch("/api/books")).json()).books);
  const book = books.find((b) => b.active_revision.page_count === 348);
  assert.ok(book, "Need the real prepared 348-page textbook");
  const revision = book.active_revision.id;
  const learning = await page.evaluate(async (id) =>
    (await fetch(`/api/revisions/${id}/learning`)).json(), revision);
  assert.ok(learning.points.length, "Exercise the learning-gutter restoration race");

  async function open() {
    await page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" }).getByRole("button",{name:"打开",exact:true}).click();
    await page.locator(".overview-book-heading .primary-action").click();
    await page.locator(".page canvas").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
  }
  async function position() {
    return page.evaluate(async (id) => {
      const { books } = await (await fetch("/api/books")).json();
      return books.find((b) => b.active_revision.id === id).active_revision.position;
    }, revision);
  }
  async function assertRestored(expected) {
    assert.equal(await page.locator("#page-number").inputValue(), String(expected.pdf_page_index + 1));
    assert.equal(await page.locator("#zoom-value").textContent(), `${Math.round(expected.zoom * 100)}%`);
    const actual = await position();
    assert.equal(actual.pdf_page_index, expected.pdf_page_index);
    assert.equal(actual.zoom, expected.zoom);
    assert.ok(Math.abs(actual.normalized_offset - expected.normalized_offset) < 0.003,
      `In-page offset changed: ${expected.normalized_offset} -> ${actual.normalized_offset}`);
  }

  await open();
  await page.locator("#page-number").fill("50");
  await page.locator("#page-number").press("Enter");
  await page.locator("#zoom-in").click();
  await page.locator("#viewer").hover();
  await page.mouse.wheel(0, 160);
  await page.waitForTimeout(1200);
  const saved = await position();
  assert.equal(saved.pdf_page_index, 49);
  assert.ok(saved.normalized_offset > 0, "Exercise a real in-page reading offset");

  await page.reload();
  await open();
  await assertRestored(saved);
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await open();
  await assertRestored(saved);

  // Learning entries can resize placeholders while PDF loading is still pending.
  // Neither debounce nor pagehide may persist those temporary coordinates.
  await page.locator("#back-to-library").click();
  await page.reload();
  let releasePdf;
  let requestedPdf;
  const held = new Promise((resolve) => { releasePdf = resolve; });
  const requested = new Promise((resolve) => { requestedPdf = resolve; });
  await page.route("**/pdf", async (route) => { requestedPdf(); await held; await route.continue(); });
  const beforeLoading = writes.length;
  await page.locator(".book-card").filter({ hasText: "348 个 PDF 页面" }).getByRole("button",{name:"打开",exact:true}).click();
    await page.locator(".overview-book-heading .primary-action").click();
  await requested;
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(writes.length, beforeLoading, "Unrestored placeholders must never overwrite reading position");
  releasePdf();
  await page.locator(".page canvas").first().waitFor();
  await page.waitForTimeout(1200);
  await assertRestored(saved);
  await page.unroute("**/pdf");

  await page.locator("#back-to-library").click();
  await stop();
  running = await start();
  await page.goto(running.url);
  await open();
  await assertRestored(saved);
  assert.deepEqual(await page.evaluate(async (id) =>
    (await fetch(`/api/revisions/${id}/learning`)).json(), revision), learning,
  "Reading-position recovery must not alter Learning records");
  console.log(JSON.stringify({ result: "PASS", restoredPage: 50, checks: [
    "refresh", "Library reopen", "slow PDF + pagehide", "service restart", "offset + zoom", "Learning unchanged",
  ] }));
} finally {
  await browser?.close();
  await stop();
}

async function start() {
  const child = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Reader startup timed out")); }, 30_000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.stderr.on("data", () => {});
    child.on("exit", () => { clearTimeout(timer); reject(new Error("Reader exited")); });
  });
  return { child, url };
}
async function stop() {
  if (!running || running.child.exitCode !== null) return;
  const child = running.child;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}
