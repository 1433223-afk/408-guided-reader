// Installed non-debug release: no CDP, no app-data reset, task-owned AVD only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const serial = 'emulator-5580', pkg = 'com.guidedreader.tablet';
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], {windowsHide:true,
  timeout:30000, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}).trim();
assert.match(adb('emu', 'avd', 'name'), /^ReaderTabletQa\s/m);
const output = path.resolve('test-results/tablet-offline-release'); await mkdir(output, {recursive:true});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const native = () => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/reader-release-check.xml');
  const xml = adb('exec-out', 'cat', '/sdcard/reader-release-check.xml');
  return [...xml.matchAll(/<node\s+([^>]+)>/g)].map(match => Object.fromEntries(
    [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]])));
};
const tap = node => {assert.ok(node); const b = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String((b[0] + b[2]) / 2), String((b[1] + b[3]) / 2));};
const screen = async name => writeFile(path.join(output, name + '.png'), execFileSync(adbPath,
  ['-s', serial, 'exec-out', 'screencap', '-p'], {windowsHide:true, timeout:15000}));
let report;
try {
  assert.equal(adb('shell', 'settings', 'get', 'global', 'airplane_mode_on'), '1');
  assert.equal(adb('shell', 'settings', 'get', 'global', 'wifi_on'), '0');
  assert.equal(adb('shell', 'settings', 'get', 'global', 'mobile_data'), '0');
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
  let entries = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    entries = native();
    if (entries.some(node => node.text.includes('348 个 PDF 页面') || /^继续 PDF(?: \d+)? →$/.test(node.text))) break;
    await pause(500);
  }
  const meta = entries.findIndex(node => node.text.includes('348 个 PDF 页面'));
  assert.ok(meta >= 0 || entries.some(node => /^继续 PDF(?: \d+)? →$/.test(node.text)), 'Release retains the migrated 348-page textbook in its local library');
  await screen('release-offline-migrated-library');
  if (meta >= 0) tap(entries.slice(meta).find(node => node.text === '打开 →' || node['content-desc']?.startsWith('打开教材 ')));
  for (let attempt = 0; attempt < 10; attempt++) {
    entries = native(); const resume = entries.find(node => /^继续 PDF(?: \d+)? →$/.test(node.text));
    if (resume) {tap(resume); break;} await pause(300);
  }
  for (let attempt = 0; attempt < 15; attempt++) {
    entries = native();
    if (entries.some(node => /^PDF 第 \d+ 页可选择文字$/.test(node.text))) break;
    await pause(500);
  }
  assert.ok(entries.some(node => /^PDF 第 \d+ 页可选择文字$/.test(node.text)), 'Actual release shows stored selectable original PDF pages while offline');
  assert.ok(entries.some(node => node.text.includes('/ 348')), 'Reader total matches the migrated original PDF');
  const pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
  assert.equal(adb('shell', 'cat', '/proc/net/unix').includes('webview_devtools_remote_' + pid), false,
    'Release does not expose a WebView debugger');
  const fatalExceptions = (adb('logcat', '-d', '-s', 'AndroidRuntime:E').match(/FATAL EXCEPTION/g) || []).length;
  assert.equal(fatalExceptions, 0);
  await screen('release-offline-original-textbook');
  report = {result:'PASS', checks:['Same-signature release retains migrated local library after install -r',
    'Airplane mode, Wi-Fi and mobile data disabled; real 348-page PDF and stored selectable text appear',
    'Non-debug release has no WebView debugger socket and no AndroidRuntime fatal exception'], fatalExceptions};
} catch (error) {
  await screen('failure').catch(() => {}); report = {result:'FAIL', error:String(error.stack || error)}; process.exitCode = 1;
}
await writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
