// Targeted PDF.js decoder regression; no import, OCR, or model calls.
// READER_REAL_PDF points to a real JBIG2 PDF kept outside the repository.
// Optional READER_ARTIFACTS also must be outside the repository.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pdfPath = process.env.READER_REAL_PDF;
if (!pdfPath) throw new Error("Set READER_REAL_PDF to a real JBIG2 PDF outside the repository");
assertOutsideRepository(path.resolve(pdfPath));
const artifacts = process.env.READER_ARTIFACTS
  ? path.resolve(process.env.READER_ARTIFACTS)
  : await mkdtemp(path.join(os.tmpdir(), "guided-reader-decoders-"));
assertOutsideRepository(artifacts);
await mkdir(artifacts, { recursive: true });
const runDir = await mkdtemp(path.join(artifacts, "run-"));
const fallbackDir = path.join(runDir, "http-assets");
await mkdir(fallbackDir);
await writeFile(path.join(fallbackDir, "package.json"), '{"type":"module"}\n');

// A fresh empty service validates the same resource routes used by Reader.
// PYTHONPATH avoids accidentally running an installed checkout's service.
const service = spawn(process.env.READER_PYTHON || "python", [
  "-m", "reader_service", "--no-open", "--port", "0", "--data-dir", path.join(runDir, "empty-data"),
], {
  cwd: root,
  env: { ...process.env, PYTHONPATH: path.join(root, "src") },
  stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
// Do not emit service logs: READY includes a private startup credential.
service.stderr.resume();
const resources = [];
const results = [];
try {
  const origin = new URL(await readyUrl(service)).origin;
  for (const filename of ["jbig2.wasm", "jbig2_nowasm_fallback.js"]) {
    const assetPath = `/vendor/pdfjs/wasm/${filename}`;
    const response = await fetch(origin + assetPath);
    assert.equal(response.status, 200, `${assetPath} unavailable`);
    assert.match(response.headers.get("content-type"), filename.endsWith(".wasm")
      ? /^application\/wasm(?:;|$)/ : /^(?:application|text)\/javascript(?:;|$)/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const installed = await readFile(path.join(root, "node_modules", "pdfjs-dist", "wasm", filename));
    assert.equal(digest(bytes), digest(installed), `${assetPath} differs from installed PDF.js`);
    await writeFile(path.join(fallbackDir, filename), bytes);
    resources.push({ path: assetPath, status: response.status, bytes: bytes.length, sha256: digest(bytes) });
  }

  // Operator-list decoding does not draw to canvas. The minimal DOMMatrix
  // allows PDF.js's Node build to load without an optional canvas dependency.
  globalThis.DOMMatrix ||= class DOMMatrix {};
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const original = await readFile(pdfPath);
  for (const useWasm of [true, false]) {
    // WASM bytes are fetched directly over the real service HTTP route.
    // Node cannot import HTTP ES modules, so JS fallback uses the byte-exact
    // module fetched above. This checks core decoding, not browser rendering.
    const task = pdfjs.getDocument({
      data: new Uint8Array(original),
      useWasm,
      useWorkerFetch: true,
      wasmUrl: useWasm ? `${origin}/vendor/pdfjs/wasm/` : `${pathToFileURL(fallbackDir).href}/`,
      cMapUrl: `${origin}/vendor/pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${origin}/vendor/pdfjs/standard_fonts/`,
      iccUrl: `${origin}/vendor/pdfjs/iccs/`,
      isOffscreenCanvasSupported: false,
    });
    try {
      const document = await task.promise;
      assert.ok(document.numPages >= 2, "Fixture needs two representative pages");
      const pages = [];
      for (const pageNumber of [1, 2]) {
        const page = await document.getPage(pageNumber);
        const operators = await page.getOperatorList();
        const imageIds = operators.fnArray.flatMap((operation, index) =>
          operation === pdfjs.OPS.paintImageXObject ? [operators.argsArray[index][0]] : []);
        assert.ok(imageIds.length, `Page ${pageNumber} has no image operators`);
        const images = [];
        for (const imageId of new Set(imageIds)) {
          const image = await new Promise(resolve => page.objs.get(imageId, resolve));
          assert.ok(image?.data?.length, `Page ${pageNumber}: image decoder returned no pixels`);
          assert.ok(image.width > 0 && image.height > 0);
          let min = 255;
          let max = 0;
          for (const value of image.data) { min = Math.min(min, value); max = Math.max(max, value); }
          assert.ok(min < max, `Page ${pageNumber}: decoded image is uniform/blank`);
          images.push({ width: image.width, height: image.height, bytes: image.data.length,
            min, max, sha256: digest(image.data) });
        }
        pages.push({ page: pageNumber, images });
      }
      results.push({ mode: useWasm ? "wasm-over-http" : "http-downloaded-js-fallback", pageCount: document.numPages, pages });
    } finally { await task.destroy(); }
  }
  assert.deepEqual(results[0].pages, results[1].pages, "WASM and JS fallback decoded different pixels");
  const report = { pdfjsVersion: pdfjs.version, fixtureSha256: digest(original), resources, results };
  await writeFile(path.join(runDir, "decoder-result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, artifactDirectory: runDir }));
} finally {
  service.kill();
}

function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function assertOutsideRepository(target) {
  const relative = path.relative(root, target);
  assert.ok(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "PDFs and decoder artifacts must stay outside the repository");
}
function readyUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Reader service did not start within 30 seconds")), 30000);
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      const match = output.match(/READY (http:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Reader service exited (${code})`)); });
  });
}
