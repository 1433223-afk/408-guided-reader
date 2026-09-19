import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to a representative real scanned PDF");
const expectedPages = Number(process.env.READER_EXPECTED_PAGES || 29);
const deviceScaleFactor = Number(process.env.READER_DPR || 2.5);

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const dataDir = await mkdtemp(path.join(os.tmpdir(), "guided-reader-e2e-"));
const artifacts = path.resolve("test-results");
await mkdir(artifacts, { recursive: true });
const service = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let serviceErrors = "";
service.stderr.on("data", (chunk) => { serviceErrors += chunk.toString(); });

let browser;
try {
  const url = await readyUrl(service);
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor,
  });
  const apiResponses = [];
  const apiFailures = [];
  let expectedAborts = 0;
  context.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/")) {
      apiResponses.push({ method: response.request().method(), url: response.url(), status: response.status() });
    }
  });
  context.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      const error = request.failure()?.errorText;
      if (error === "net::ERR_ABORTED") expectedAborts += 1;
      else apiFailures.push({ url: request.url(), error });
    }
  });
  let page = await context.newPage();
  const firstLibrary = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/books");
  await page.goto(url);
  assert.equal(new URL(page.url()).search, "", "normal local entry should not require a tokenized URL");
  assert.equal((await firstLibrary).status(), 200, "plain localhost entry could not load the Library API");

  // Library and Reader are distinct surfaces.
  assert.ok(await page.locator("#library-home").isVisible());
  assert.equal(await page.locator("#reader").isVisible(), false);
  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.locator("#reader").waitFor({ state: "visible" });
  assert.equal(await page.locator("#library-home").isVisible(), false);
  assert.equal(await page.locator(".library").count(), 0, "legacy permanent sidebar still exists");
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator(".page").count(), expectedPages, "unexpected real-fixture page count");
  const initialCanvases = await page.locator(".page canvas").count();
  assert.ok(initialCanvases <= 8, "virtualization retained too many canvases");

  // Canvas backing stores must meet the real device pixel ratio and never be CSS-upscaled.
  const metrics100 = await captureRenderMetrics(page, "100%");
  assertPixelExact(metrics100);

  await page.locator("#page-number").fill("12");
  await page.locator("#page-number").press("Enter");
  await page.waitForFunction(() => document.querySelector("#page-number").value === "12");
  await page.evaluate(() => {
    const viewer = document.querySelector("#viewer");
    const target = document.querySelectorAll(".page")[11];
    viewer.scrollTop = target.offsetTop + target.offsetHeight * 0.34;
    viewer.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(artifacts, "r1-reader-page-12-100.png"), fullPage: false });

  // Toolbar zoom preserves the PDF point at the viewport center.
  const centerBefore = await viewportCenterAnchor(page);
  await page.locator("#zoom-in").click();
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  const centerAfter = await viewportCenterAnchor(page);
  assertAnchorStable(centerBefore, centerAfter, "toolbar zoom");
  assert.equal(await page.locator("#zoom-value").textContent(), "110%");
  const metrics110 = await captureRenderMetrics(page, "110%");
  assertPixelExact(metrics110);
  await page.screenshot({ path: path.join(artifacts, "r1-reader-page-12-110.png"), fullPage: false });

  // Keyboard shortcuts are handled only while the Reader viewport has focus.
  await page.locator("#viewer").focus();
  await page.locator("#viewer").press("Control+=");
  assert.equal(await page.locator("#zoom-value").textContent(), "125%");
  const metrics125 = await captureRenderMetrics(page, "125%");
  assertPixelExact(metrics125);
  await page.screenshot({ path: path.join(artifacts, "r1-reader-page-12-125.png"), fullPage: false });
  await page.locator("#viewer").press("Control+-");
  assert.equal(await page.locator("#zoom-value").textContent(), "110%");

  // Ctrl+wheel preserves the PDF point under the pointer.
  const viewerBox = await page.locator("#viewer").boundingBox();
  const pointer = { x: viewerBox.x + viewerBox.width / 2, y: viewerBox.y + viewerBox.height * 0.42 };
  const pointerBefore = await anchorAt(page, pointer.x, pointer.y);
  await page.keyboard.down("Control");
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  assert.equal(await page.locator("#zoom-value").textContent(), "125%");
  const pointerAfter = await anchorAt(page, pointer.x, pointer.y);
  assertAnchorStable(pointerBefore, pointerAfter, "pointer zoom");

  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  assert.ok(await page.locator(".page canvas").count() <= 8, "zoom broke bounded virtualization");
  await page.screenshot({ path: path.join(artifacts, "r1-reader-corrected.png"), fullPage: false });

  // Return to Library, reopen, then close/reopen the browser and select the book again.
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  assert.equal(await page.locator("#reader").isVisible(), false);
  await page.screenshot({ path: path.join(artifacts, "r1-library-home.png"), fullPage: false });
  await page.getByRole("button", { name: /^打开教材 / }).click();
  await page.getByRole("button", { name: /^继续 PDF/ }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  assert.equal(await page.locator("#page-number").inputValue(), "12");

  await page.close();
  page = await context.newPage();
  await page.goto(url);
  assert.ok(await page.locator("#library-home").isVisible(), "startup should land on Library/Home");
  await page.getByRole("button", { name: /^打开教材 / }).click();
  await page.getByRole("button", { name: /^继续 PDF/ }).click();
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator("#page-number").inputValue(), "12", "reopen did not restore the PDF page");
  assert.equal(await page.locator("#zoom-value").textContent(), "125%", "reopen did not restore zoom");

  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.getByText("书库中已有这份文件").waitFor();
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  assert.equal(await page.locator(".book-card").count(), 1, "duplicate import created another book");

  // The same page at comparable visual widths in Chrome's built-in PDF viewer. The built-in
  // percentages differ because its 100% baseline is not the Reader's fit-width baseline.
  for (const [readerZoom, builtInZoom] of [[100, 125], [110, 138], [125, 156]]) {
    const builtIn = await context.newPage();
    await builtIn.goto(`${pathToFileURL(pdfPath).href}#page=12&zoom=${builtInZoom}`);
    await builtIn.waitForTimeout(1200);
    await builtIn.screenshot({
      path: path.join(artifacts, `chrome-built-in-page-12-reader-${readerZoom}.png`),
      fullPage: false,
    });
    await builtIn.close();
  }

  // UI deletion remains functional after the surface split.
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".book-more summary").click();
  await page.getByRole("button", { name: "删除教材", exact: true }).click();
  await page.getByText("还没有教材。").waitFor();
  assert.equal(await page.locator(".book-card").count(), 0);
  assert.deepEqual(apiFailures, [], `normal-browser API requests failed: ${JSON.stringify(apiFailures)}`);
  assert.ok(apiResponses.length >= 8, "normal-browser flow did not exercise the expected API operations");
  assert.ok(apiResponses.every((response) => response.status < 400), JSON.stringify(apiResponses));

  console.log(JSON.stringify({
    result: "PASS",
    pages: expectedPages,
    renderedCanvases: initialCanvases,
    devicePixelRatio: metrics100.dpr,
    renderMetrics: [metrics100, metrics110, metrics125],
    restoredPage: 12,
    restoredZoom: "125%",
    toolbarAnchorDrift: Math.abs(centerAfter.normalizedY - centerBefore.normalizedY),
    pointerAnchorDrift: Math.abs(pointerAfter.normalizedY - pointerBefore.normalizedY),
    apiStatusCounts: summarizeApiResponses(apiResponses),
    expectedAborts,
    screenshots: [100, 110, 125].flatMap((zoom) => [
      path.join(artifacts, `r1-reader-page-12-${zoom}.png`),
      path.join(artifacts, `chrome-built-in-page-12-reader-${zoom}.png`),
    ]),
  }));
} finally {
  if (browser) await browser.close();
  service.kill();
  await rm(dataDir, { recursive: true, force: true });
  if (serviceErrors.trim()) process.stderr.write(serviceErrors);
}

async function captureRenderMetrics(page, expectedZoom) {
  await page.waitForFunction(() => document.querySelector(".page canvas")?.dataset.outputScaleX);
  const metrics = await page.locator(".page canvas").evaluateAll((canvases) => {
    const viewerRect = document.querySelector("#viewer").getBoundingClientRect();
    const viewportCenter = viewerRect.top + viewerRect.height / 2;
    const canvas = canvases.reduce((best, candidate) => {
      const rect = candidate.getBoundingClientRect();
      const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportCenter);
      return !best || distance < best.distance ? { canvas: candidate, distance } : best;
    }, null).canvas;
    const rect = canvas.getBoundingClientRect();
    const wrapperRect = canvas.parentElement.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      zoom: document.querySelector("#zoom-value").textContent,
      backingWidth: canvas.width,
      backingHeight: canvas.height,
      cssWidth: rect.width,
      cssHeight: rect.height,
      scaleX: canvas.width / rect.width,
      scaleY: canvas.height / rect.height,
      wrapperWidth: wrapperRect.width,
      wrapperHeight: wrapperRect.height,
      deviceLeft: rect.left * window.devicePixelRatio,
      deviceTop: rect.top * window.devicePixelRatio,
      smoothing: canvas.getContext("2d").imageSmoothingEnabled,
      smoothingQuality: canvas.getContext("2d").imageSmoothingQuality,
    };
  });
  assert.equal(metrics.zoom, expectedZoom);
  return metrics;
}

function assertPixelExact(metrics) {
  assert.ok(Math.abs(metrics.scaleX - metrics.dpr) < 0.001, "canvas width is resampled by CSS");
  assert.ok(Math.abs(metrics.scaleY - metrics.dpr) < 0.001, "canvas height is resampled by CSS");
  assert.ok(Math.abs(metrics.cssWidth - metrics.wrapperWidth) < 0.01, "canvas and page widths differ");
  assert.ok(Math.abs(metrics.cssHeight - metrics.wrapperHeight) < 0.01, "canvas and page heights differ");
  assert.ok(
    Math.abs(metrics.deviceLeft - Math.round(metrics.deviceLeft)) < 0.01,
    `page starts between horizontal device pixels: ${JSON.stringify(metrics)}`,
  );
  assert.ok(
    Math.abs(metrics.deviceTop - Math.round(metrics.deviceTop)) < 0.01,
    `page starts between vertical device pixels: ${JSON.stringify(metrics)}`,
  );
  assert.equal(metrics.smoothing, true);
  assert.equal(metrics.smoothingQuality, "high");
}

function summarizeApiResponses(responses) {
  return responses.reduce((summary, response) => {
    const pathName = new URL(response.url).pathname;
    const category = pathName.endsWith("/pdf") ? "/api/revisions/:id/pdf"
      : pathName.endsWith("/position") ? "/api/revisions/:id/position"
        : /^\/api\/books\/[^/]+$/.test(pathName) ? "/api/books/:id"
          : pathName;
    const key = `${response.method} ${category} ${response.status}`;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function requireExists(candidate) {
  return os.platform() === "win32" && process.getBuiltinModule("node:fs").existsSync(candidate);
}

async function viewportCenterAnchor(page) {
  const box = await page.locator("#viewer").boundingBox();
  return anchorAt(page, box.x + box.width / 2, box.y + box.height / 2);
}

async function anchorAt(page, x, y) {
  return page.evaluate(({ x, y }) => {
    let best = null;
    let distance = Infinity;
    for (const node of document.querySelectorAll(".page")) {
      const rect = node.getBoundingClientRect();
      const candidate = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (candidate < distance) {
        distance = candidate;
        best = { node, rect };
      }
    }
    return {
      pageIndex: Number(best.node.dataset.index),
      normalizedX: Math.max(0, Math.min(1, (x - best.rect.left) / best.rect.width)),
      normalizedY: Math.max(0, Math.min(1, (y - best.rect.top) / best.rect.height)),
    };
  }, { x, y });
}

function assertAnchorStable(before, after, label) {
  assert.equal(after.pageIndex, before.pageIndex, `${label} moved to another page`);
  assert.ok(Math.abs(after.normalizedX - before.normalizedX) < 0.015, `${label} shifted horizontally`);
  assert.ok(Math.abs(after.normalizedY - before.normalizedY) < 0.015, `${label} shifted vertically`);
}

function readyUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error(`Core Service did not start. ${serviceErrors}`)), 15_000);
    child.once("exit", (code) => reject(new Error(`Core Service exited ${code}. ${serviceErrors}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
}
