// Self-contained LAN upload regression. A temporary Core has no model or OCR
// runtime and never opens the user's library. This is desktop Chromium with a
// touch viewport; Android document-provider behavior still needs device testing.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright-core';

const isPrivate = address => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
const address = process.env.READER_TEST_LAN || Object.values(os.networkInterfaces()).flat()
  .find(entry => entry && entry.family === 'IPv4' && !entry.internal && isPrivate(entry.address))?.address;
assert.ok(address && isPrivate(address), 'Set READER_TEST_LAN to an assigned RFC1918 IPv4 address');
const workspace = process.cwd(), temporary = await mkdtemp(path.join(os.tmpdir(), 'reader-tablet-import-'));
const fixture = path.join(temporary, 'Y900-upload-fixture');
const token = randomBytes(32).toString('hex');
const python = String.raw`
import os
from pathlib import Path
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from reader_service.library import LibraryService
from reader_service.server import ReaderServer, handler_factory
from reader_service.storage import ManagedPaths
root = Path(os.environ['READER_IMPORT_TEST_ROOT'])
document = PdfWriter()
font = document._add_object(DictionaryObject({
    NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'),
    NameObject('/BaseFont'): NameObject('/Helvetica'),
}))
for index in range(350):
    page = document.add_blank_page(width=595, height=842)
    page[NameObject('/Resources')] = DictionaryObject({
        NameObject('/Font'): DictionaryObject({NameObject('/F1'): font}),
    })
    text = DecodedStreamObject()
    text.set_data(('BT /F1 12 Tf 60 760 Td (Tablet upload regression page %s) Tj ET' % (index + 1)).encode('ascii'))
    page[NameObject('/Contents')] = document._add_object(text)
document.add_attachment('upload-size-fixture.bin', os.urandom(10 * 1024 * 1024))
document.write(root / 'Y900-upload-fixture')
document.close()
library = LibraryService(ManagedPaths(root / 'data'))
server = ReaderServer((os.environ['READER_IMPORT_TEST_LAN'], 0), handler_factory(
    library, os.environ['READER_IMPORT_TEST_TOKEN'], tablet_lan=True))
print('READY_PORT %s' % server.server_port, flush=True)
server.serve_forever()
`;
const core = spawn(process.env.READER_PYTHON || 'python', ['-u', '-c', python], {
  cwd: workspace, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {...process.env, PYTHONPATH: path.join(workspace, 'src'), PYTHONIOENCODING: 'utf-8',
    READER_IMPORT_TEST_ROOT: temporary, READER_IMPORT_TEST_LAN: address, READER_IMPORT_TEST_TOKEN: token},
});
let output = '', serviceErrors = '', browser;
core.stderr.on('data', chunk => {serviceErrors += chunk.toString();});
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Temporary LAN Core did not start')), 30000);
  core.stdout.on('data', chunk => {
    output += chunk.toString();
    const match = output.match(/READY_PORT (\d+)/);
    if (match) {clearTimeout(timeout); resolve(Number(match[1]));}
  });
  core.once('error', error => {clearTimeout(timeout); reject(error);});
  core.once('exit', code => {clearTimeout(timeout); reject(new Error(`Temporary Core exited (${code})`));});
});

try {
  const port = await ready;
  const entry = `http://${address}:${port}/?tablet=1&token=${token}`;
  const bytes = await readFile(fixture);
  assert.ok(bytes.length > 8 * 1024 * 1024, 'Exercise more than two 4 MiB read chunks');
  browser = await chromium.launch({headless: true, executablePath: process.env.READER_CHROMIUM ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  const context = await browser.newContext({viewport: {width: 1200, height: 800}, hasTouch: true, isMobile: true});
  const page = await context.newPage(), pageErrors = [], phases = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.exposeFunction('recordImportPhase', value => phases.push(value));
  await page.goto(entry);
  await page.waitForFunction(() => typeof window.readerIntakeDidStart === 'function' &&
    document.querySelector('.home-toolbar .primary-action'));
  assert.equal(await page.evaluate(() => isSecureContext), false, 'Exercise LAN HTTP');
  await page.evaluate(() => new MutationObserver(() => window.recordImportPhase(
    document.getElementById('import-feedback').dataset.phase)).observe(
    document.getElementById('import-feedback'), {attributes: true, attributeFilter: ['data-phase']}));

  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/books');
  await page.locator('#import-input').setInputFiles({name: 'Y900-no-extension', mimeType: 'application/octet-stream', buffer: bytes});
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const uploadHeaders = await response.request().allHeaders();
  assert.equal(uploadHeaders['x-reader-token'], token, 'Use the current launch token');
  assert.equal(uploadHeaders['content-type'], 'application/pdf');
  assert.equal(Number(uploadHeaders['content-length']), bytes.length, 'Known-size Blob supplies the raw PDF length');
  const result = await response.json();
  assert.equal(result.book.active_revision.page_count, 350);
  await page.locator('.page canvas').first().waitFor({state: 'visible', timeout: 45000});
  assert.equal(await page.locator('.page').count(), 350);
  assert.ok(phases.includes('reading') && phases.includes('uploading') && phases.includes('done'));
  assert.equal(await page.locator('#import-input').isDisabled(), false);
  assert.equal(await page.locator('#import-input').inputValue(), '');

  // Re-enter the library using the same active launch. Its saved PDF remains in
  // this disposable database for the duplicate and error paths below.
  await page.goto(entry);
  await page.locator('.book-card').waitFor();
  await page.locator('#import-input').setInputFiles({name: 'invalid.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF')});
  await page.waitForFunction(() => document.getElementById('import-feedback').dataset.phase === 'error');
  assert.match(await page.locator('#import-message').textContent(), /HTTP (400|415|422)/);
  assert.equal(await page.locator('#import-input').isDisabled(), false);
  assert.equal(await page.locator('#import-input').inputValue(), '');
  assert.equal(await page.locator('.book-card').count(), 1);

  // Exercise a real Core 401 while preserving the already-loaded page, as when
  // a server restarts and the previous page still holds its old launch token.
  await context.clearCookies();
  await page.route('**/api/books', route => route.request().method() === 'POST'
    ? route.continue({headers: {...route.request().headers(), 'x-reader-token': 'expired-upload-test'}})
    : route.continue());
  await page.locator('#import-input').setInputFiles({name: 'expired.pdf', mimeType: 'application/pdf', buffer: bytes.subarray(0, 4096)});
  await page.waitForFunction(() => /HTTP 401/.test(document.getElementById('import-message').textContent));
  assert.match(await page.locator('#import-message').textContent(), /启动凭证已失效/);
  assert.equal(await page.locator('#import-input').isDisabled(), false);
  await context.close();

  const compatibility = await browser.newContext({viewport: {width: 1200, height: 800}, hasTouch: true, isMobile: true});
  await compatibility.addInitScript(() => {AbortSignal.timeout = undefined;});
  const compatibilityPage = await compatibility.newPage();
  compatibilityPage.on('pageerror', error => pageErrors.push(error.message));
  await compatibilityPage.goto(entry);
  await compatibilityPage.locator('.book-card').waitFor();
  assert.equal(await compatibilityPage.evaluate(() => typeof AbortSignal.timeout), 'undefined');
  const duplicateResponse = compatibilityPage.waitForResponse(response => response.request().method() === 'POST' &&
    new URL(response.url()).pathname === '/api/books');
  await compatibilityPage.locator('#import-input').setInputFiles({name: 'compatibility.pdf', mimeType: 'application/pdf', buffer: bytes});
  const duplicate = await duplicateResponse;
  assert.equal(duplicate.status(), 200);
  assert.equal((await duplicate.json()).duplicate, true);
  await compatibilityPage.locator('.page canvas').first().waitFor({state: 'visible', timeout: 45000});
  assert.equal(await compatibilityPage.locator('.page').count(), 350);
  assert.equal(await compatibilityPage.evaluate(async () => (await (await fetch('/api/books')).json()).books.length), 1);
  await compatibility.close();

  const failedContext = await browser.newContext(), failedPage = await failedContext.newPage();
  await failedPage.route('**/app.js', route => route.abort('failed'));
  await failedPage.goto(entry);
  await failedPage.waitForFunction(() => document.getElementById('import-feedback').dataset.phase === 'startup-error');
  assert.equal(await failedPage.locator('#import-feedback').isVisible(), true);
  assert.match(await failedPage.locator('#import-message').textContent(), /阅读器尚未启动/);
  await failedPage.locator('#import-input').setInputFiles({name: 'early.pdf', mimeType: 'application/pdf', buffer: bytes.subarray(0, 4096)});
  assert.equal(await failedPage.locator('#import-input').inputValue(), '', 'Unstarted intake must not retain a silent pending file');
  await failedPage.evaluate(() => window.readerIntakeDidStart());
  assert.equal(await failedPage.locator('#import-feedback').isVisible(), true,
    'Late startup must keep a visible reselect message after discarding an early selection');
  assert.match(await failedPage.locator('#import-message').textContent(), /重新选择/);
  await failedContext.close();
  assert.deepEqual(pageErrors, []);
  assert.equal(serviceErrors.includes('Traceback'), false, 'No unhandled server failure');
  console.log(JSON.stringify({result: 'PASS', checks: ['isolated LAN HTTP', '350 synthetic pages',
    '> 8 MiB multi-chunk read', 'generic MIME without extension', 'raw PDF current-token XHR',
    'real PDF.js rendering', 'invalid PDF visible error and reset', 'expired token visible 401',
    'missing AbortSignal.timeout duplicate upload and rendering',
    'module startup visible error', 'early selection followed by late startup visible retry'], uploadBytes: bytes.length, modelCalls: 0}));
} catch (error) {
  throw new Error(String(error.message || error).replaceAll(token, '[redacted]'));
} finally {
  await browser?.close();
  core.kill();
  await new Promise(resolve => {if (core.exitCode !== null) resolve(); else core.once('exit', resolve);});
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()), 'Cleanup stays in the created system temporary directory');
  await rm(temporary, {recursive: true, force: true});
}
