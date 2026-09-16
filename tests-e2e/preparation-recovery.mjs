import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to the hash-verified 29-page scanned PDF");
const dataDir = await mkdtemp(path.join(os.tmpdir(), "guided-reader-recovery-"));
const token = "r2-recovery-test-token";
let service;
let serviceErrors = "";

try {
  let started = await startService();
  service = started.child;
  let base = started.url;
  const pdf = await readFile(pdfPath);
  const imported = await request(base, "/api/books", {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "X-File-Name": encodeURIComponent(path.basename(pdfPath)),
    },
    body: pdf,
  });
  const revisionId = imported.book.active_revision.id;

  const interrupted = await waitFor(base, revisionId, (result) => {
    const ready = result.pages.filter((page) => page.status === "READY").length;
    const preparing = result.pages.filter((page) => page.status === "PREPARING").length;
    return ready >= 2 && preparing === 1 && ready < 29;
  }, 120_000);
  const readyBeforeKill = interrupted.pages.filter((page) => page.status === "READY").length;
  service.kill();
  await exited(service);
  service = null;

  started = await startService();
  service = started.child;
  base = started.url;
  const recovered = await request(base, `/api/revisions/${revisionId}/preparation`);
  const readyAfterRestart = recovered.pages.filter((page) => page.status === "READY").length;
  assert.equal(readyAfterRestart, readyBeforeKill, "restart discarded an already committed READY page");

  const completed = await waitFor(
    base,
    revisionId,
    (result) => result.pages.every((page) => page.status === "READY")
      && result.jobs.SUCCEEDED === 29,
    240_000,
  );
  assert.equal(completed.jobs.RUNNING, 0);
  assert.equal(completed.jobs.QUEUED, 0);

  const databasePath = path.join(dataDir, "state.sqlite3");
  const attempts = JSON.parse(execFileSync("python", [
    "-c",
    "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps([r[0] for r in c.execute('select attempts from jobs order by page_start')]))",
    databasePath,
  ], { encoding: "utf8" }));
  assert.ok(Math.max(...attempts) <= 2, "more than the one in-flight one-page batch was redone");
  assert.ok(attempts.filter((value) => value === 2).length <= 1, "more than one batch was redone");

  console.log(JSON.stringify({
    result: "PASS",
    readyBeforeKill,
    readyAfterRestart,
    pagesReadyAfterRecovery: completed.pages.length,
    redoneBatches: attempts.filter((value) => value === 2).length,
    maximumAttempts: Math.max(...attempts),
  }));
} finally {
  if (service) service.kill();
  await rm(dataDir, { recursive: true, force: true });
  if (serviceErrors.trim()) process.stderr.write(serviceErrors);
}

async function startService() {
  const child = spawn(
    "python",
    ["-m", "reader_service", "--no-open", "--port", "0", "--token", token, "--data-dir", dataDir],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  child.stderr.on("data", (chunk) => { serviceErrors += chunk.toString(); });
  return { child, url: await readyUrl(child) };
}

async function request(base, route, options = {}) {
  const response = await fetch(`${base}${route}`, {
    ...options,
    headers: { "X-Reader-Token": token, ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitFor(base, revisionId, predicate, timeout) {
  const deadline = Date.now() + timeout;
  let latest;
  while (Date.now() < deadline) {
    latest = await request(base, `/api/revisions/${revisionId}/preparation`);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Preparation timed out: ${JSON.stringify(latest)}`);
}

function exited(child) {
  return new Promise((resolve) => child.once("exit", resolve));
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
