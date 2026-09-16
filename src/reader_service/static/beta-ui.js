export const isBeta = document.documentElement.dataset.profile === 'beta';

export function betaUnavailable(status) {
  if (!isBeta) return null;
  if (status?.ai_off_reason === 'AI_DISABLED') return '管理员已暂停新 AI 调用，教材和已保存内容仍可阅读。';
  if (!status?.credential_available) return '请在书库的「DeepSeek Key」中设置自己的 Key；教材仍可阅读。';
  return null;
}

export function installBetaSettings(header, api, changed) {
  if (!isBeta) return;
  const entry = document.createElement('button');
  entry.type = 'button'; entry.id = 'beta-key-settings'; entry.textContent = 'DeepSeek Key';
  header.append(entry);
  const dialog = document.createElement('dialog');
  dialog.className = 'beta-key-dialog'; dialog.setAttribute('aria-labelledby', 'beta-key-title');
  dialog.innerHTML = `<form autocomplete="off">
    <h2 id="beta-key-title">连接 DeepSeek</h2>
    <p>生成、审查和重试均使用你的 DeepSeek 余额，由你承担费用。并发限制不限制消费金额。</p>
    <p>Key 保存在此实例的服务器私有配置中；受信任的服务器管理员在技术上可以访问。普通备份不包含 Key，恢复后需要重新输入。</p>
    <p id="beta-key-status" role="status" tabindex="-1"></p>
    <label for="beta-key-input">DeepSeek API Key</label>
    <input id="beta-key-input" type="password" autocomplete="off" spellcheck="false" maxlength="512" aria-describedby="beta-key-status">
    <div class="beta-key-actions"><button id="beta-key-submit" type="submit">验证并连接</button>
    <button id="beta-key-disconnect" type="button" hidden>断开连接</button>
    <button id="beta-key-close" type="button">关闭</button></div>
  </form>`;
  document.body.append(dialog);
  const input = dialog.querySelector('input'), status = dialog.querySelector('[role="status"]');
  const submit = dialog.querySelector('[type="submit"]'), disconnect = dialog.querySelector('#beta-key-disconnect');
  let busy = false;
  function show(value) {
    status.textContent = value.validation === 'INVALID' ? 'Key 已失效，请更换。' : value.configured ? '已连接 · DeepSeek' : '尚未连接；不影响阅读教材和已保存内容。';
    submit.textContent = value.configured ? '验证并更换' : '验证并连接';
    disconnect.hidden = !value.configured;
    entry.textContent = value.validation === 'INVALID' ? 'DeepSeek · Key 已失效' : value.configured ? 'DeepSeek · 已连接' : 'DeepSeek Key';
  }
  function close() { input.value = ''; dialog.close(); entry.focus(); }
  dialog.querySelector('#beta-key-close').onclick = close;
  dialog.addEventListener('close', () => {input.value = '';});
  dialog.addEventListener('cancel', () => {input.value = '';});
  entry.onclick = async () => {
    dialog.showModal(); input.focus();
    try {show(await api('/api/beta/key'));} catch (error) {status.textContent = error.message;}
  };
  async function update(method) {
    if (busy) return;
    busy = true; submit.disabled = disconnect.disabled = true;
    status.textContent = method === 'POST' ? '正在验证…' : '正在断开…';
    const body = method === 'POST' ? JSON.stringify({key: input.value}) : undefined;
    input.value = '';
    try {
      show(await api('/api/beta/key', {method, headers:{'Content-Type':'application/json'}, body}));
      await changed();
    } catch (error) {status.textContent = error.message; status.focus();}
    finally {busy = false; submit.disabled = disconnect.disabled = false; input.value = '';}
  }
  dialog.querySelector('form').onsubmit = event => {event.preventDefault(); update('POST');};
  disconnect.onclick = () => update('DELETE');
  api('/api/beta/key').then(show).catch(() => {});
  document.querySelectorAll('.local-note').forEach(node => {node.textContent = '教材与学习记录保存在你的独立服务器实例中';});
}
