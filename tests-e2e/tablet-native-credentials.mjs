// Fixed fake key only, task-owned AVD in airplane mode, never a provider call.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const tool = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
const pkg = 'com.guidedreader.tablet';
const adb = (...args) => execFileSync(tool, ['-s', 'emulator-5580', ...args], {windowsHide:true,
  timeout:30000, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}).trim();
assert.match(adb('emu', 'avd', 'name'), /^ReaderTabletQa\s/m);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const native = () => {
  adb('shell', 'uiautomator', 'dump', '/sdcard/reader-fake-key-check.xml');
  return [...adb('exec-out', 'cat', '/sdcard/reader-fake-key-check.xml').matchAll(/<node\s+([^>]+)>/g)]
    .map(match => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])));
};
const tap = node => {assert.ok(node); const b = node.bounds.match(/\d+/g).map(Number);
  adb('shell', 'input', 'tap', String((b[0]+b[2])/2), String((b[1]+b[3])/2));};
async function settings() {
  adb('shell', 'input', 'keyevent', '4'); await pause(250);
  tap(native().find(node => node.text === 'AI 设置')); await pause(250); return native();
}
const fake = 'sk-reader-qa-only-do-not-send-20261021';
let report, changed = false;
try {
  assert.equal(adb('shell', 'settings', 'get', 'global', 'airplane_mode_on'), '1');
  adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity'); await pause(1500);
  let entries = await settings();
  assert.equal(entries.filter(node => node.text === '尚未配置').length, 2, 'This QA device must have no preexisting credentials');
  tap(entries.find(node => node.class === 'android.widget.EditText'));
  adb('shell', 'input', 'text', fake);
  adb('shell', 'input', 'keyevent', '111'); // Expose dialog actions after typing.
  tap(native().find(node => node.text === '保存')); changed = true;
  let closed = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    await pause(250); const current = native();
    assert.equal(current.some(node => node.text.includes('保存未完成')), false, 'Native KeyStore save must succeed');
    if (!current.some(node => node.class === 'android.widget.EditText')) {closed = true; break;}
  }
  assert.ok(closed, 'Wait for asynchronous KeyStore save before reopening settings');
  entries = await settings();
  assert.ok(entries.some(node => node.text === '已配置'), 'Configured state requires successful KeyStore decrypt/read');
  const preferences = adb('exec-out', 'run-as', pkg, 'cat', 'shared_prefs/reader_local_ai_encrypted.xml');
  assert.equal(preferences.includes(fake), false);
  assert.match(preferences, /v1:/);
  tap(entries.find(node => node.text === '移除已保存的 Key' && node.enabled === 'true'));
  await pause(300); entries = native();
  assert.equal(entries.filter(node => node.text === '尚未配置').length, 2);
  const cleared = adb('exec-out', 'run-as', pkg, 'cat', 'shared_prefs/reader_local_ai_encrypted.xml');
  assert.equal(cleared.includes('name="deepseek"'), false);
  changed = false;
  tap(entries.find(node => node.text === '返回'));
  report = {result:'PASS', checks:['Native settings encrypts a fixed fake key in Android KeyStore-backed storage',
    'Configured status confirms decrypt/read works; preferences have versioned ciphertext and no plaintext key',
    'Native removal returns both providers to unconfigured state'], models:0, network:'airplane mode'};
} catch (error) {
  report = {result:'FAIL', error:String(error.stack || error).replaceAll(fake, '[fake-key]')}; process.exitCode = 1;
} finally {
  if (changed) {
    // Only the asserted-empty QA preferences ever received this fake value.
    adb('shell', 'am', 'force-stop', pkg);
    adb('shell', 'run-as', pkg, 'rm', '-f', 'shared_prefs/reader_local_ai_encrypted.xml');
  }
}
await mkdir('test-results/tablet-native-credentials', {recursive:true});
await writeFile('test-results/tablet-native-credentials/result.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
