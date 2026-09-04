import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import os from "node:os";
import { chromium } from "playwright-core";

const dataDir = process.env.READER_DATA_DIR;
if (!dataDir) throw new Error("Set READER_DATA_DIR to the app data directory containing both real books");
const expected = new Map([
  [29, "327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1"],
  [348, "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"],
]);
const queries = new Map([[29, "总线"], [348, "中断向量"]]);
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const running = await startService();
let browser;
const timings = [];
try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
  const books = await page.evaluate(async () => (await (await fetch("/api/books")).json()).books);
  assert.equal(books.length, 2, "acceptance library must contain exactly the 29- and 348-page books");
  for (const pageCount of [29, 348]) {
    const book = books.find((value) => value.active_revision.page_count === pageCount);
    assert.ok(book, `missing ${pageCount}-page real book`);
    assert.equal(book.active_revision.blob_sha256, expected.get(pageCount));
    await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
    await page.locator("#reader").waitFor({ state: "visible" });
    await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#search-toggle").click();
    await page.locator("#search-panel").waitFor({ state: "visible" });
    await page.locator("#search-coverage").getByText(`已检索全书 ${pageCount} 页`).waitFor();

    const term = queries.get(pageCount);
    await page.locator("#search-query").fill(term);
    const started = performance.now();
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/search") && url.searchParams.get("q") === term;
    });
    await page.locator("#search-form button").click();
    const response = await responsePromise;
    const payload = await response.json();
    await page.locator(".search-result").first().waitFor();
    timings.push({ pageCount, query: term, milliseconds: Math.round((performance.now() - started) * 10) / 10, matches: payload.results.length });
    assert.ok(payload.results.length > 0, `${term} did not match the real ${pageCount}-page OCR corpus`);
    assert.ok(payload.results.length > 1, `${term} needs two real results for replacement-highlighting acceptance`);
    assert.equal(payload.coverage.ready_pages, pageCount);
    assert.equal(payload.coverage.complete, true);
    assert.ok(payload.results[0].match_ranges.length > 0, "search result lacks transient match ranges");
    const targets = payload.results.slice(0, 2).map((result) => result.pdf_page_index);
    const annotationsBefore = await annotationsForPages(page, book.active_revision.id, targets);
    const target = targets[0];
    await page.locator(".search-result").first().click();
    await page.waitForFunction((number) => document.querySelector("#page-number").value === String(number), target + 1);
    await page.locator(`.page[data-index="${target}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
    const firstMarkers = page.locator(`.page[data-index="${target}"] .search-match-quad`);
    await firstMarkers.first().waitFor({ state: "visible", timeout: 15_000 });
    assert.ok(await firstMarkers.count() >= 1, "clicked result did not paint a transient match");
    const markerStyle = await firstMarkers.first().evaluate((node) => ({
      position: getComputedStyle(node).position,
      backgroundColor: getComputedStyle(node).backgroundColor,
      borderStyle: getComputedStyle(node).borderStyle,
      annotation: node.classList.contains("annotation-quad"),
    }));
    assert.equal(markerStyle.position, "absolute");
    assert.equal(markerStyle.annotation, false, "transient match reused durable Annotation presentation identity");
    assert.notEqual(markerStyle.backgroundColor, "rgba(0, 0, 0, 0)");
    assert.equal(markerStyle.borderStyle, "none");
    const markerBox = await firstMarkers.first().boundingBox();
    const viewerBox = await page.locator("#viewer").boundingBox();
    assert.ok(markerBox.y < viewerBox.y + viewerBox.height && markerBox.y + markerBox.height > viewerBox.y,
      "clicked match was painted outside the visible Reader viewport");

    const replacement = targets[1];
    await page.locator(".search-result").nth(1).click();
    await page.waitForFunction((number) => document.querySelector("#page-number").value === String(number), replacement + 1);
    await page.locator(`.page[data-index="${replacement}"] .search-match-quad`).first().waitFor({ state: "visible", timeout: 15_000 });
    assert.equal(await page.locator(`.page[data-index="${target}"] .search-match-quad`).count(), 0,
      "switching results left the previous transient match painted");

    await page.locator("#search-close").click();
    assert.equal(await page.locator(".search-match-quad").count(), 0, "closing search left transient paint");
    await page.locator("#search-toggle").click();
    await page.locator(".search-result").first().waitFor();
    await page.locator(".search-result").first().click();
    await page.locator(".search-match-quad").first().waitFor({ state: "visible", timeout: 15_000 });
    await page.locator("#search-query").fill("");
    assert.equal(await page.locator(".search-match-quad").count(), 0, "clearing search left transient paint");
    assert.deepEqual(
      await annotationsForPages(page, book.active_revision.id, targets), annotationsBefore,
      "transient search highlighting changed durable Annotations",
    );

    await page.locator("#search-query").fill("绝不会存在的检索词XYZ987654");
    await page.locator("#search-form button").click();
    await page.locator("#search-empty").getByText("在当前已检索页面中没有找到结果。").waitFor();
    await page.locator("#back-to-library").click();
    await page.locator("#library-home").waitFor({ state: "visible" });
  }
  console.log(JSON.stringify({ status: "PASS", timings }));
} finally {
  if (browser) await browser.close();
  await stopService(running.child);
  if (running.errors.trim()) process.stderr.write(running.errors);
}

async function annotationsForPages(page, revisionId, pageIndexes) {
  return page.evaluate(async ({ revisionId, pageIndexes }) => {
    const values = {};
    for (const pageIndex of [...new Set(pageIndexes)]) {
      const payload = await (await fetch(`/api/revisions/${revisionId}/annotations?page=${pageIndex}`)).json();
      values[pageIndex] = payload.annotations;
    }
    return values;
  }, { revisionId, pageIndexes });
}

async function startService() {
  const child = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
    cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
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

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}
