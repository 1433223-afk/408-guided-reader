import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to a scanned PDF");
const observeMs = Number(process.env.READER_PROGRESS_OBSERVE_MS || 35000);
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(existsSync);
if (!executablePath) throw new Error("Chrome or Edge is required");

const dataDir = await mkdtemp(path.join(os.tmpdir(), "guided-reader-progress-"));
const service = spawn("python", ["-m", "reader_service", "--no-open", "--port", "0", "--data-dir", dataDir], {
  cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let browser;
let serviceErrors = "";
service.stderr.on("data", chunk => { serviceErrors += chunk.toString(); });
try {
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Reader service did not start")), 30000);
    service.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    service.on("exit", code => { clearTimeout(timeout); reject(new Error(`Reader service exited: ${code}`)); });
  });
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let streams = 0;
  page.on("request", request => {
    if (request.url().includes("/preparation/events")) streams += 1;
  });
  await page.goto(url);
  await page.locator("#import-input").setInputFiles(pdfPath);
  await page.locator("#reader").waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll(".page[data-preparation]").length > 0);
  const initial = await progress(page);
  await page.waitForTimeout(observeMs);
  // The current revision is available through the library API without exposing app internals.
  const revisionId = await page.evaluate(async () => {
    const books = await (await fetch("/api/books")).json();
    return books.books[0].active_revision.id;
  });
  const saved = await page.evaluate(async id => (await (await fetch(`/api/revisions/${id}/preparation`)).json()).pages, revisionId);
  const ready = saved.filter(row => row.status === "READY").length;
  await page.waitForFunction(expected => document.querySelectorAll('.page[data-preparation="READY"]').length >= expected, ready, { timeout: 10000 });
  const final = await progress(page);
  if (observeMs > 30000 && saved.some(row => !["READY", "FAILED"].includes(row.status))) {
    assert.ok(streams >= 2, `unfinished OCR opened only ${streams} progress stream(s) after ${observeMs} ms`);
  }
  console.log(JSON.stringify({ initial, final, backendReady: ready, streams }));
} finally {
  if (browser) await browser.close();
  service.kill();
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!path.resolve(dataDir).startsWith(tempRoot)) throw new Error("Unexpected temporary data directory");
  await rm(dataDir, { recursive: true, force: true });
  if (process.env.READER_VERBOSE && serviceErrors.trim()) process.stderr.write(serviceErrors);
}

async function progress(page) {
  return page.evaluate(() => ({
    ready: document.querySelectorAll('.page[data-preparation="READY"]').length,
    label: document.querySelector("#preparation-status")?.textContent,
  }));
}
