import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const sourceDataDir = process.env.READER_DATA_DIR;
if (!sourceDataDir) throw new Error("Set READER_DATA_DIR to the app data directory containing both real books");
const expected = new Map([
  [29, "327da74eef4c0ee7ad0fb3bf4752907f71dff9c2d9877faf49d1b3201c7e0aa1"],
  [348, "6844d8eb2637f8adc6dcc54c686ac3b32df0452597550af807751169020c46bd"],
]);
const expectedTargets = new Map([
  [29, { title: "1.2.2 计算机硬件", pdfPageIndex: 14, printedLabel: "3", source: "TOC" }],
  [348, { title: "6.2.1 总线事务", pdfPageIndex: 302, printedLabel: "291", source: "BOOKMARK" }],
]);
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const executablePath = process.env.READER_CHROMIUM || chromeCandidates.find(requireExists);
if (!executablePath) throw new Error("Set READER_CHROMIUM to Chrome or Edge executable");

const acceptanceRoot = await mkdtemp(path.join(os.tmpdir(), "guided-reader-map-"));
const dataDir = path.join(acceptanceRoot, "data");
await cp(sourceDataDir, dataDir, { recursive: true });
let running = await startService();
let browser;
let page;
const results = [];
const identitySnapshots = new Map();
const revisionSnapshots = new Map();

try {
  browser = await chromium.launch({ executablePath, headless: process.env.READER_HEADLESS !== "0" });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(running.url);
  let books = await library(page);
  assert.equal(books.length, 2);

  for (const pageCount of [29, 348]) {
    const book = books.find((value) => value.active_revision.page_count === pageCount);
    assert.ok(book, `missing ${pageCount}-page real book`);
    assert.equal(book.active_revision.blob_sha256, expected.get(pageCount));
    const revisionId = book.active_revision.id;
    await openBook(page, pageCount);
    await page.locator("#outline-toggle").click();
    await page.locator("#outline-panel").waitFor({ state: "visible" });
    await page.locator(".outline-target").first().waitFor();

    const outline = await json(page, `/api/revisions/${revisionId}/outline`);
    const labels = await json(page, `/api/revisions/${revisionId}/page-labels`);
    const target = expectedTargets.get(pageCount);
    assert.equal(outline.evidence_source, target.source);
    assert.equal(outline.identity_conflict, false);
    assert.ok(outline.nodes.length >= 200, "real logical directory is unexpectedly incomplete");
    const visibleRoots = page.locator("#outline-tree > .outline-level-0 > li");
    if (pageCount === 348) {
      assert.equal(await visibleRoots.count(), 8, "main directory should show seven chapters plus one auxiliary group");
      assert.equal(await page.locator('#outline-tree > .outline-level-0 > li[data-node-id]').count(), 7);
      const other = page.locator('[data-outline-group="other"]');
      await other.getByText("其他内容", { exact: true }).waitFor();
      assert.equal(await other.locator(":scope > ul").isHidden(), true, "auxiliary content should default collapsed");
      assert.equal(await other.locator(":scope > ul > li").count(), 8);

      const chapter6 = outline.nodes.find((node) => node.title === "第6章 总线");
      assert.ok(chapter6, "chapter 6 is missing from the bookmark tree");
      const chapter6Target = page.locator(`li[data-node-id="${chapter6.outline_node_id}"] > .outline-row .outline-target`);
      await chapter6Target.click();
      assert.equal(await chapter6Target.getAttribute("aria-expanded"), "true");
      assert.deepEqual(await directChildTitles(page, chapter6), [
        "6.1 总线概述", "6.2 总线事务和定时", "6.3 本章小结", "6.4 常见问题和易混淆知识点",
      ]);

      const section62 = outline.nodes.find((node) => node.title === "6.2 总线事务和定时");
      assert.ok(section62, "section 6.2 is missing from the bookmark tree");
      const section62Target = page.locator(`li[data-node-id="${section62.outline_node_id}"] > .outline-row .outline-target`);
      await section62Target.click();
      assert.equal(await section62Target.getAttribute("aria-expanded"), "true");
      assert.deepEqual(await directChildTitles(page, section62), [
        "6.2.1 总线事务", "6.2.2 总线定时", "6.2.3 本节习题精选", "6.2.4 答案与解析",
      ]);
    } else {
      assert.equal(await visibleRoots.count(), 7, "TOC-derived main directory should show its seven chapters");
      assert.equal(await page.locator('[data-outline-group="other"]').count(), 0);
    }
    assert.equal(labels.labels.length, pageCount, "printed labels are not represented per PDF page");
    assert.ok(labels.unknown_count > 0, "real corpus must preserve honest UNKNOWN pages");
    assert.ok(labels.inferred_count > pageCount / 2, "validated printed-label coverage is unexpectedly low");
    const shape = outline.nodes.map((node) => [
      node.outline_node_id, node.parent_id, node.depth, node.order_index, node.title,
    ]);
    identitySnapshots.set(pageCount, shape);
    revisionSnapshots.set(pageCount, outline.nodes.map((node) => [
      node.outline_node_id, node.identity_revision, node.physical_revision,
    ]));
    const targetNode = outline.nodes.find((node) => node.title === target.title);
    assert.ok(targetNode, `${target.title} missing from real directory`);
    assert.equal(targetNode.start_page, target.pdfPageIndex);
    assert.ok(
      ["PARTIAL", "RESOLVED"].includes(targetNode.resolution_state),
      "saved real-book evidence must retain a safe physical target",
    );
    await expandAncestors(page, outline.nodes, targetNode);
    assert.ok(targetNode.depth >= 2, "real-use target must exercise at least a third-level entry");
    await page.locator(`li[data-node-id="${targetNode.outline_node_id}"] > .outline-row .outline-target`).click();
    await page.waitForFunction(
      (number) => document.querySelector("#page-number").value === String(number),
      target.pdfPageIndex + 1,
    );
    await page.locator(`.page[data-index="${target.pdfPageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#printed-page-label").getByText(`印刷页 ${target.printedLabel}`, { exact: true }).waitFor();
    results.push({
      pages: pageCount,
      source: outline.evidence_source,
      nodes: outline.nodes.length,
      inferred: labels.inferred_count,
      unknown: labels.unknown_count,
      target: target.title,
      pdfPage: target.pdfPageIndex + 1,
      printedLabel: target.printedLabel,
    });
    await page.locator("#back-to-library").click();
    await page.locator("#library-home").waitFor({ state: "visible" });
  }

  // Persist a manual label on the copied acceptance library, then reopen and restart.
  await openBook(page, 29);
  await goToPage(page, 0);
  page.once("dialog", (dialog) => dialog.accept("封面"));
  await page.locator("#printed-page-edit").click();
  await page.getByText("本页印刷页码已手工保存。").waitFor();
  await page.locator("#printed-page-label").getByText("印刷页 封面", { exact: true }).waitFor();
  await page.locator("#back-to-library").click();
  await page.locator("#library-home").waitFor({ state: "visible" });
  await openBook(page, 29);
  await goToPage(page, 0);
  await page.locator("#printed-page-label").getByText("印刷页 封面", { exact: true }).waitFor();

  await stopService(running.child);
  running = await startService();
  await page.goto(running.url);
  books = await library(page);
  await openBook(page, 29);
  await goToPage(page, 0);
  await page.locator("#printed-page-label").getByText("印刷页 封面", { exact: true }).waitFor();
  for (const pageCount of [29, 348]) {
    const book = books.find((value) => value.active_revision.page_count === pageCount);
    const outline = await json(page, `/api/revisions/${book.active_revision.id}/outline`);
    assert.deepEqual(
      outline.nodes.map((node) => [
        node.outline_node_id, node.parent_id, node.depth, node.order_index, node.title,
      ]),
      identitySnapshots.get(pageCount),
      `${pageCount}-page outline identity/hierarchy/order changed across restart`,
    );
    assert.deepEqual(
      outline.nodes.map((node) => [
        node.outline_node_id, node.identity_revision, node.physical_revision,
      ]),
      revisionSnapshots.get(pageCount),
      `${pageCount}-page Outline revisions changed across restart`,
    );
    assert.ok(outline.nodes.every((node) => node.identity_revision === 1));
  }
  const book29 = books.find((value) => value.active_revision.page_count === 29);
  const persisted = await json(page, `/api/revisions/${book29.active_revision.id}/page-labels`);
  assert.equal(persisted.labels[0].method, "MANUAL");
  assert.equal(persisted.labels[0].printed_label, "封面");

  console.log(JSON.stringify({
    status: "PASS",
    books: results,
    identityHierarchyOrderStableAcrossRestart: true,
    manualOverridePersistsAcrossReopenAndRestart: true,
    navigationUsesRenderedOriginalPdfCanvas: true,
  }));
} finally {
  if (browser) await browser.close();
  if (running?.child) await stopService(running.child);
  if (running?.errors?.trim()) process.stderr.write(running.errors);
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
    const group = page.locator(`li[data-node-id="${ancestor.outline_node_id}"] > ul`);
    if (await group.isHidden()) {
      await page.locator(`li[data-node-id="${ancestor.outline_node_id}"] > .outline-row .outline-disclosure`).click();
    }
  }
}

async function directChildTitles(page, node) {
  return page.locator(
    `li[data-node-id="${node.outline_node_id}"] > ul > li > .outline-row .outline-target > span`,
  ).allTextContents();
}

async function openBook(page, pageCount) {
  if (await page.locator("#back-to-library").isVisible()) {
    await page.locator("#back-to-library").click();
    await page.locator("#library-home").waitFor({ state: "visible" });
  }
  await page.locator(".book-card").filter({ hasText: `${pageCount} 个 PDF 页面` }).click();
  await page.locator("#reader").waitFor({ state: "visible" });
  await page.locator(".page canvas").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#printed-page-label").waitFor();
}

async function goToPage(page, pageIndex) {
  await page.locator("#page-number").fill(String(pageIndex + 1));
  await page.locator("#page-number").press("Enter");
  await page.locator(`.page[data-index="${pageIndex}"] canvas`).waitFor({ state: "visible", timeout: 30_000 });
}

async function library(page) {
  return json(page, "/api/books").then((payload) => payload.books);
}

async function json(page, url) {
  return page.evaluate(async (value) => {
    const response = await fetch(value);
    if (!response.ok) throw new Error(`${value}: ${response.status}`);
    return response.json();
  }, url);
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
