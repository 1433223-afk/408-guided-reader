import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cp, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

// Only manifest sections run: {cases:[{name,revision,section,expect?}]}.
// expect: "match", "no-candidates", or "any". The source Library is read-only;
// the service always runs in output/data, optionally reusing that isolated copy.
const source = process.env.READER_DATA_DIR;
const root = process.env.READER_OUTPUT_DIR;
if (!source || !root) throw Error('Set READER_DATA_DIR and READER_OUTPUT_DIR');
const launcher = process.env.READER_AUDITED_LAUNCHER || fileURLToPath(new URL('./practice-knowledge-server.py', import.meta.url));
const manifestPath = process.env.PRACTICE_KNOWLEDGE_MANIFEST;
const legacyRevision = process.env.PRACTICE_KNOWLEDGE_REVISION || '0581f325-67dc-4a2c-ab7d-3b13e0daaa10';
const manifest = manifestPath ? JSON.parse(await readFile(manifestPath, 'utf8')) : {cases: [
  {name: 'network-matched', revision: legacyRevision, expect: 'match',
    section: process.env.PRACTICE_KNOWLEDGE_SECTION || '249a53de-3297-51b8-93ca-a0a64b9d703e'},
  {name: 'network-no-candidates', revision: legacyRevision, expect: 'no-candidates',
    section: process.env.PRACTICE_KNOWLEDGE_EMPTY_SECTION || '4f6fc51d-33e4-51fd-8d13-5c3aa7213bf3'},
]};
const cases = Array.isArray(manifest) ? manifest : manifest.cases;
assert.ok(Array.isArray(cases) && cases.length, 'manifest needs cases');
const perBook = new Map();
for (const item of cases) {
  assert.ok(item && typeof item.name === 'string' && item.name.trim(), 'case needs a name');
  assert.ok(typeof item.revision === 'string' && /^[a-f0-9-]+$/.test(item.revision), 'case needs revision');
  assert.ok(typeof item.section === 'string' && item.section, 'case needs section');
  assert.ok(['any', 'match', 'no-candidates'].includes(item.expect || 'any'), 'invalid expectation');
  const selected = perBook.get(item.revision) || new Set();
  assert.ok(!selected.has(item.section), 'duplicate case');
  selected.add(item.section);
  assert.ok(selected.size <= 2, 'sample at most two sections per book');
  perBook.set(item.revision, selected);
}
const dataDir = path.join(root, 'data'), auditPath = path.join(root, 'model-calls.jsonl');
await mkdir(dataDir, {recursive: true});
const sourceReal = (await realpath(source)).toLowerCase();
const destinationReal = (await realpath(dataDir)).toLowerCase();
assert.ok(destinationReal !== sourceReal && !destinationReal.startsWith(sourceReal + path.sep),
  'output data must be outside the source Library');
if (process.env.READER_REUSE_DATA !== '1') {
  await cp(path.join(source, 'blobs'), path.join(dataDir, 'blobs'), {recursive: true, errorOnExist: true, force: false});
  const backup = spawnSync('python', ['-c',
    'import sqlite3,sys; s=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()',
    path.join(source, 'state.sqlite3'), path.join(dataDir, 'state.sqlite3')], {windowsHide: true, encoding: 'utf8'});
  assert.equal(backup.status, 0, backup.stderr);
}
if (process.env.READER_KEEP_AUDIT !== '1') await writeFile(auditPath, '');
const modelCalls = async () => (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const countCalls = async () => (await modelCalls()).filter(row => row.event === 'transport' && row.status === 'STARTED').length;
const report = {manifest: manifestPath || null, cases: [], status: 'RUNNING'};
const saveReport = () => writeFile(path.join(root, 'smoke-result.json'), JSON.stringify(report, null, 2));
const redact = value => String(value).replace(/token=[^\s&"']+/g, 'token=[redacted]');
let server, browser, page, stderr = '';
const errors = [], browserDiagnostics = [];
try {
  server = spawn('python', [launcher, '--no-open', '--port', '0', '--data-dir', dataDir], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env,
      GUIDED_READER_DEEPSEEK_DISABLED: '0', GUIDED_READER_ZHIPU_DISABLED: '1',
      GUIDED_READER_OPENROUTER_DISABLED: '1', PRACTICE_KNOWLEDGE_CALL_AUDIT: auditPath},
  });
  server.stderr.on('data', chunk => { stderr += chunk; });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(Error('server start timeout')), 30000);
    server.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/READY (http:\/\/\S+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
    server.once('exit', () => {clearTimeout(timer); reject(Error('server exited'));});
  });
  browser = await chromium.launch({executablePath: process.env.READER_CHROMIUM ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true});
  page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') browserDiagnostics.push(redact(message.text())); });
  page.on('requestfailed', request => browserDiagnostics.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
  await page.goto(url);
  await page.locator('.book-card').first().waitFor();
  const api = route => page.evaluate(async route => {
    const response = await fetch(route);
    if (!response.ok) throw Error(`${route}: ${response.status}`);
    return response.json();
  }, route);
  const waitPage = async index => {
    await page.locator(`.page[data-index="${index}"]:not(.loading) canvas`).waitFor();
    await page.waitForFunction(index => {
      const paper = document.querySelector(`.page[data-index="${index}"]`)?.getBoundingClientRect();
      const viewer = document.querySelector('#viewer').getBoundingClientRect();
      return paper && paper.bottom > viewer.top && paper.top < viewer.bottom;
    }, index);
  };
  const enter = async section => {
    await page.locator('#page-number').fill(String(section.entryPage + 1));
    await page.locator('#page-number').press('Enter');
    await page.getByRole('button', {name: `进入 ${section.title} 的做题模式`, exact: true}).click();
    await page.locator('#practice-section-title').filter({hasText: section.title}).waitFor();
  };
  const choose = async (question, letter = 'A') => {
    const index = question.regions?.find(region => region.options.some(option => option.choice === letter))?.page ?? question.page;
    // Printed hit regions render before the saved OCR event layer is attached.
    await page.locator(`.page[data-index="${index}"] .text-overlay`).waitFor();
    const option = page.locator(`.page[data-index="${index}"] .practice-choice-area[data-choice="${letter}"]`).first();
    await option.scrollIntoViewIfNeeded();
    const box = await option.boundingBox();
    assert.ok(box, 'printed option should be clickable');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('#practice-status').filter({hasText: new RegExp(`已选 ${letter}`)}).waitFor();
  };
  const selectQuestion = async (section, number) => {
    const question = section.questions.find(item => item.number === number);
    assert.ok(question, 'match must name a question in the catalog');
    const label = String(question.label ?? question.number).padStart(2, '0');
    await page.locator('#practice-question-list button').filter({hasText: new RegExp(`^${label}$`)}).click();
    assert.equal((await page.locator('#practice-number').innerText()).trim(), label);
    await waitPage(question.page);
    return question;
  };
  const assertEmpty = async () => {
    assert.equal(await page.locator('#practice-knowledge').isVisible(), false);
    assert.equal(await page.locator('#practice-knowledge').evaluate(node => node.getBoundingClientRect().height), 0);
  };
  const assertLayout = async () => {
    const geometry = await page.evaluate(() => {
      const rail = document.querySelector('#practice-panel').getBoundingClientRect();
      const viewer = document.querySelector('#viewer').getBoundingClientRect();
      const link = document.querySelector('#practice-knowledge-source').getBoundingClientRect();
      const title = document.querySelector('#practice-knowledge-title');
      const text = title.getBoundingClientRect();
      return {railLeft: rail.left, railRight: rail.right, viewerLeft: viewer.left,
        linkLeft: link.left, linkRight: link.right, titleLeft: text.left, titleRight: text.right,
        scrollWidth: title.scrollWidth, clientWidth: title.clientWidth};
    });
    assert.ok(geometry.linkLeft >= geometry.railLeft && geometry.linkRight <= geometry.railRight + 1
      && geometry.railRight <= geometry.viewerLeft + 1 && geometry.titleLeft >= geometry.linkLeft
      && geometry.titleRight <= geometry.linkRight + 1 && geometry.scrollWidth <= geometry.clientWidth + 1,
    `Practice link overflows: ${JSON.stringify(geometry)}`);
  };
  const waitCompleted = async (item, section, offset) => {
    const timeout = Number(process.env.PRACTICE_KNOWLEDGE_TIMEOUT_MS || 400000);
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = await api(`/api/revisions/${item.revision}/practice-prototype/knowledge-links?section_id=${encodeURIComponent(item.section)}`);
      if (!value.pending) {
        if (value.matches.length === section.questions.length) return value;
        const failures = (await modelCalls()).slice(offset).filter(event => event.event === 'failure');
        throw Error(`matching ended with ${value.matches.length}/${section.questions.length} results: ${JSON.stringify(failures)}`);
      }
      await page.waitForTimeout(1000);
    }
    throw Error(`matching did not finish within ${timeout / 1000}s`);
  };
  const matchingResponse = item => page.waitForResponse(response => response.request().method() === 'POST'
    && response.url().endsWith(`/api/revisions/${item.revision}/practice-prototype/knowledge-links`));

  for (const [caseIndex, item] of cases.entries()) {
    const slug = item.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 70);
    const caseDir = path.join(root, `${String(caseIndex + 1).padStart(2, '0')}-${slug}`);
    await mkdir(caseDir, {recursive: true});
    const current = {...item, expect: item.expect || 'any', checks: [], screenshots: [], status: 'RUNNING'};
    report.cases.push(current);
    const shot = async name => {
      const destination = path.join(caseDir, `${name}.png`);
      await page.screenshot({path: destination});
      current.screenshots.push(destination);
    };
    await page.setViewportSize({width: 1440, height: 1000});
    if (await page.locator('#reader').isVisible()) await page.locator('#back-to-library').click();
    await page.locator('#library-home').waitFor();
    const books = (await api('/api/books')).books;
    const bookIndex = books.findIndex(book => book.active_revision?.id === item.revision);
    assert.ok(bookIndex >= 0, `${item.name}: active revision absent`);
    const book = books[bookIndex];
    current.book = book.title;
    const catalog = (await api(`/api/revisions/${item.revision}/practice-prototype/catalog`)).sections;
    const section = catalog.find(section => section.id === item.section);
    assert.ok(section?.questions.length, `${item.name}: real section unavailable`);
    current.sectionTitle = section.title;
    current.questionCount = section.questions.length;
    const card = page.locator('.book-card').nth(bookIndex);
    assert.equal(await card.locator('.book-card-title').innerText(), book.title);
    await card.locator('.book-open').click();
    await page.locator('#book-overview .overview-book-heading .primary-action').click();
    await page.locator('#reader').waitFor();
    await page.waitForFunction(total => document.querySelector('#page-total').textContent.trim() === `/ ${total}`, book.active_revision.page_count);
    const offset = (await modelCalls()).length, callsBefore = await countCalls();
    const holdPath = `**/api/revisions/${item.revision}/practice-prototype/knowledge-links`;
    let releaseMatching, requestHeld = false;
    const matchingHeld = new Promise(resolve => {releaseMatching = resolve;});
    const hold = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      requestHeld = true;
      await matchingHeld;
      await route.continue();
    };
    await page.route(holdPath, hold);
    const firstResponse = matchingResponse(item);
    void firstResponse.catch(() => {}); // Preserve an earlier UI failure on teardown.
    await enter(section);
    await page.waitForFunction(() => !document.querySelector('#practice-panel').hidden);
    assert.equal(requestHeld, true);
    await assertEmpty();
    await choose(section.questions[0]);
    current.checks.push('Practice opens and selection works before matching POST is released; no placeholder');
    releaseMatching();
    assert.equal((await firstResponse).status(), 200);
    const results = await waitCompleted(item, section, offset);
    await page.unroute(holdPath, hold);
    current.matches = results.matches.map(result => ({number: result.number,
      label: section.questions.find(question => question.number === result.number)?.label,
      knowledgePointId: result.knowledge_point?.id || null, title: result.knowledge_point?.title || null}));
    const matched = results.matches.filter(result => result.knowledge_point);
    const unmatched = results.matches.filter(result => result.knowledge_point === null);
    current.matchedCount = matched.length;
    current.nullCount = unmatched.length;
    current.newModelCalls = (await countCalls()) - callsBefore;
    if (current.expect === 'match') assert.ok(matched.length, `${item.name}: expected a real match`);
    if (current.expect === 'no-candidates') {
      assert.equal(matched.length, 0);
      assert.equal(current.newModelCalls, 0, 'no-candidate section must not invoke a model');
    }
    const titleOrdered = matched.toSorted((a, b) => a.knowledge_point.title.length - b.knowledge_point.title.length || a.number - b.number);
    const examples = titleOrdered.length ? [
      {kind: 'shortest-title', result: titleOrdered[0]}, {kind: 'longest-title', result: titleOrdered.at(-1)},
    ].filter((value, index, values) => values.findIndex(other => other.result.number === value.result.number) === index) : [];
    current.titleExamples = examples.map(({kind, result}) => ({kind, number: result.number,
      title: result.knowledge_point.title, characters: result.knowledge_point.title.length}));
    for (const width of [1440, 900]) {
      await page.setViewportSize({width, height: 1000});
      await page.waitForTimeout(400);
      for (const [exampleIndex, {kind, result: {number, knowledge_point: point}}] of examples.entries()) {
        const question = await selectQuestion(section, number);
        await page.locator('#practice-knowledge-title').filter({hasText: point.title}).waitFor();
        assert.equal(await page.locator('#practice-knowledge-title').innerText(), point.title);
        await assertLayout();
        await choose(question);
        const label = await page.locator('#practice-number').innerText();
        await shot(`${kind}-matched-${width}`);
        await page.locator('#practice-knowledge-source').click();
        await page.locator('#practice-back').waitFor();
        await waitPage(point.start_page);
        assert.equal(await page.locator('#practice-number').innerText(), label);
        assert.match(await page.locator('#practice-status').innerText(), /已选 A/);
        await shot(`${kind}-textbook-${width}`);
        await page.locator('#practice-back').click();
        await waitPage(question.page);
        assert.match(await page.locator('#practice-status').innerText(), /已选 A/);
        assert.equal(await page.locator('#practice-number').innerText(), label);
        await shot(`${kind}-returned-${width}`);
        if (exampleIndex === 0) {
          await page.locator('#viewer').press('Enter');
          await page.locator('#practice-status').filter({hasText: /正确/}).waitFor();
          const submitted = await page.locator('#practice-status').innerText();
          const attempts = await page.locator('#practice-attempts').innerText();
          await page.locator('#practice-knowledge-source').click();
          await waitPage(point.start_page);
          await page.locator('#practice-back').click();
          await waitPage(question.page);
          assert.equal(await page.locator('#practice-status').innerText(), submitted);
          assert.equal(await page.locator('#practice-attempts').innerText(), attempts);
          assert.equal(await page.locator('#practice-number').innerText(), label);
          await shot(`submitted-returned-${width}`);
        }
      }
      if (unmatched.length) {
        const question = await selectQuestion(section, unmatched[0].number);
        await page.waitForFunction(() => document.querySelector('#practice-knowledge').hidden);
        await assertEmpty();
        await choose(question);
        await shot(`unmatched-${width}`);
        current.nullExample = {number: question.number, label: question.label,
          reason: current.expect === 'no-candidates' ? 'no-candidates' : 'real-model-null'};
      }
    }
    if (matched.length) current.checks.push('Actual shortest/longest titles fit at 1440/900; textbook round trips preserve selection and submitted result');
    if (unmatched.length) current.checks.push('Null hides the entry without placeholder and ordinary selection works at 1440/900');
    const callsBeforeReentry = await countCalls();
    await page.locator('#practice-close').click();
    const reentryResponse = matchingResponse(item);
    await enter(section);
    assert.equal((await reentryResponse).status(), 200);
    const reused = await waitCompleted(item, section, offset);
    const comparable = value => value.matches.map(result => ({number: result.number,
      point: result.knowledge_point?.id || null})).sort((a, b) => a.number - b.number);
    assert.deepEqual(comparable(reused), comparable(results));
    assert.equal(await countCalls(), callsBeforeReentry, 'reentry must cause zero new model calls');
    current.checks.push('Reentry reuses positive/null decisions with zero new model calls');
    current.modelEvents = (await modelCalls()).slice(offset);
    current.status = 'PASS';
    await page.locator('#practice-close').click();
    await saveReport();
    console.log(JSON.stringify({case: current.name, status: current.status, matched: current.matchedCount,
      null: current.nullCount, newModelCalls: current.newModelCalls}));
  }
  assert.deepEqual(errors, []);
  report.calls = await modelCalls();
  report.bookCount = perBook.size;
  report.status = 'PASS';
  await saveReport();
  console.log(JSON.stringify({status: report.status, books: perBook.size, cases: cases.length}));
} catch (error) {
  report.status = 'FAIL';
  report.error = redact(error.message);
  report.browserErrors = errors;
  report.browserDiagnostics = browserDiagnostics;
  if (report.cases.at(-1)?.status === 'RUNNING') report.cases.at(-1).status = 'FAIL';
  await saveReport();
  if (page) await page.screenshot({path: path.join(root, 'failure.png')}).catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(root, 'server.log'), redact(stderr));
  await browser?.close();
  if (server?.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
}
