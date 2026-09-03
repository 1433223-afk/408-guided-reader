import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to a representative real scanned PDF");
const expectedPages = Number(process.env.READER_EXPECTED_PAGES || 29);

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find((candidate) => {
  try { return os.platform() === "win32" && requireExists(candidate); } catch { return false; }
});
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
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  await page.goto(url);
  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.locator(".book-card").waitFor();
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await page.locator(".page").count(), expectedPages, "unexpected real-fixture page count");
  const initialCanvases = await page.locator(".page canvas").count();
  assert.ok(initialCanvases <= 8, "virtualization retained too many canvases");

  await page.locator("#page-number").fill("12");
  await page.locator("#page-number").press("Enter");
  await page.waitForFunction(() => {
    const viewer = document.querySelector("#viewer");
    const target = document.querySelectorAll(".page")[11];
    return viewer.scrollTop >= target.offsetTop - 100;
  });
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("#page-number").inputValue(), "12");
  assert.equal(await page.locator("#zoom-value").textContent(), "110%");
  await page.screenshot({ path: path.join(artifacts, "r1-reader-page-12.png"), fullPage: false });

  await page.close();
  page = await context.newPage();
  await page.goto(url);
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#page-number").inputValue(), "12", "reopen did not restore the PDF page");
  assert.equal(await page.locator("#zoom-value").textContent(), "110%", "reopen did not restore zoom");
  assert.ok(await page.locator("#reader").isVisible(), "reader did not reopen visibly");
  const sidebar = await page.locator(".library").boundingBox();
  assert.ok(sidebar && sidebar.width >= 280 && sidebar.x === 0, "desktop library sidebar is not visible");
  assert.equal(await page.locator(".library").evaluate((node) => getComputedStyle(node).backgroundColor), "rgb(36, 42, 39)");
  await page.screenshot({ path: path.join(artifacts, "r1-reader-reopen.png"), fullPage: false });

  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.getByText("Already in your library").waitFor();
  assert.equal(await page.locator(".book-card").count(), 1, "duplicate import created another book");
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  console.log(JSON.stringify({ result: "PASS", pages: expectedPages, renderedCanvases: initialCanvases, restoredPage: 12, restoredZoom: "110%", screenshot: path.join(artifacts, "r1-reader-page-12.png") }));
} finally {
  if (browser) await browser.close();
  service.kill();
  await rm(dataDir, { recursive: true, force: true });
  if (serviceErrors.trim()) process.stderr.write(serviceErrors);
}

function requireExists(candidate) {
  const fs = process.getBuiltinModule("node:fs");
  return fs.existsSync(candidate);
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
