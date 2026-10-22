// Tablet-only read recovery. Never replay a mutation, refresh credentials, or
// persist request/response bodies. Desktop keeps its existing transport.
const ROUTE_WORDS = new Set(('api books revisions ink page-image pdf-index pdf position overlay annotations preparation events outline page-labels search knowledge learning status health sections points chapters entries memory favorites practice questions records guide inline teaching assistant master messages context sessions review hint generate regenerate prepare confirm preferences reading-context section-reading practice-prototype catalog knowledge-map inline-teaching follow-up child retry-child bake-off save retry providers history visual-region readiness attempt favorite knowledge-links inspection open send app.js tablet.css tablet-connection.js tablet-pdf-pages.js tablet-reader-ui.js tablet-tool-rail.js tablet-layout.js tablet-touch.js tablet-pen.js tablet-ink.js tablet-ink-store.js tablet-app.apk tablet-pen-check.html tablet-pen-check.css tablet-pen-check.js').split(' '));
const READ_METHODS = new Set(['GET', 'HEAD']);
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const DIAGNOSTIC_KEY = 'reader-tablet-connection-diagnostics';

export function tabletDiagnosticRoute(value) {
  try {
    const url = new URL(String(value), 'http://reader.invalid');
    return '/' + url.pathname.split('/').filter(Boolean).slice(0, 12)
      .map(part => ROUTE_WORDS.has(part) ? part : ':id').join('/');
  } catch (_) { return '/:unknown'; }
}

function authenticationError(local = false) {
  const error = new Error(local ? '本机阅读会话已失效，请从应用菜单重新打开书库。' : '连接凭证已失效，请从电脑上的本次连接页重新打开。');
  error.name = 'ReaderAuthenticationError'; error.code = 'HTTP_401'; error.status = 401;
  return error;
}

function connectionError(timeout = false, local = false) {
  const error = new Error(local
    ? (timeout ? '本机 Reader 响应超时，正在尝试恢复；无需连接电脑。' : '本机 Reader 暂时无响应，正在尝试恢复。')
    : (timeout ? '连接超时，正在尝试恢复；请确认电脑服务和 Wi-Fi。' : '与电脑的连接暂时中断，正在尝试恢复。'));
  error.name = 'ReaderConnectionError'; error.code = timeout ? 'CONNECTION_TIMEOUT' : 'CONNECTION_INTERRUPTED';
  return error;
}

export function createTabletConnection({fetch: request = globalThis.fetch.bind(globalThis),
  headers = {}, credentials = 'same-origin', timeout = 15000, retryDelay = 300,
  recoveryDelays = [1000, 2000, 5000, 10000], window: surface = globalThis.window,
  storage = globalThis.localStorage, local = false, onState = () => {}, onRecovered = () => {}} = {}) {
  let state = 'connected', disposed = false, recoveryTimer = 0, recoveryAttempt = 0, probing = false, connectionGeneration = 0;
  const events = [];
  try {
    const saved = JSON.parse(storage?.getItem(DIAGNOSTIC_KEY) || '[]');
    if (Array.isArray(saved)) for (const event of saved.slice(-60)) {
      // Re-sanitize persisted entries; local storage is not a trusted source.
      if (!event || !Number.isFinite(event.elapsed_ms)) continue;
      events.push({time: Number.isFinite(Date.parse(event.time)) ? new Date(event.time).toISOString() : null,
        method: ['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(event.method) ? event.method : 'OTHER',
        route: tabletDiagnosticRoute(event.route), status: Number.isInteger(event.status) ? event.status :
          ['network','timeout','aborted','body'].includes(event.status) ? event.status : 'body',
        elapsed_ms: Math.max(0, Math.min(600000, Math.round(event.elapsed_ms)))});
    }
  } catch (_) { /* Diagnostics must never prevent reading. */ }

  function record(method, path, status, started) {
    events.push({time: new Date().toISOString(), method: ['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method) ? method : 'OTHER',
      route: tabletDiagnosticRoute(path), status, elapsed_ms: Math.max(0, Math.round(performance.now() - started))});
    if (events.length > 60) events.splice(0, events.length - 60);
    try { storage?.setItem(DIAGNOSTIC_KEY, JSON.stringify(events)); } catch (_) { /* Storage may be unavailable. */ }
  }

  function setState(next) {
    if (disposed || next === state) return;
    // A late response from before a 401 must not dismiss the login instruction.
    if (state === 'unauthorized' && next !== 'unauthorized') return;
    const previous = state; state = next; connectionGeneration += 1;
    try { onState({state: next, message: next === 'unauthorized' ? authenticationError(local).message :
      next === 'reconnecting' ? (local ? '本机 Reader 正在恢复…' : '连接暂时中断，正在重连…')
        : (local ? '本机阅读已恢复' : '连接已恢复')}); } catch (_) { /* UI callbacks cannot break transport. */ }
    if (next === 'connected') {
      clearTimeout(recoveryTimer); recoveryTimer = 0; recoveryAttempt = 0;
      if (previous === 'reconnecting') Promise.resolve().then(() => {if (!disposed) onRecovered();}).catch(() => {});
    } else if (next === 'unauthorized') { clearTimeout(recoveryTimer); recoveryTimer = 0; }
  }

  function healthy(generation) {
    // A body already in flight before Wi-Fi failed can finish afterwards. It
    // proves nothing about the current connection and must not run recovery UI.
    if (generation === connectionGeneration && (local || surface?.navigator?.onLine !== false)) setState('connected');
  }

  function interrupted(generation) {
    // Likewise, an obsolete request cannot undo a newer successful probe.
    if (generation === connectionGeneration) setState('reconnecting');
    scheduleRecovery();
  }

  function scheduleRecovery(immediate = false) {
    if (disposed || state !== 'reconnecting' || probing) return;
    if (recoveryTimer && !immediate) return;
    clearTimeout(recoveryTimer);
    const delay = immediate ? 0 : recoveryDelays[Math.min(recoveryAttempt++, recoveryDelays.length - 1)] || 1000;
    recoveryTimer = setTimeout(probe, delay);
    recoveryTimer.unref?.();
  }

  async function probe() {
    recoveryTimer = 0;
    if (disposed || state !== 'reconnecting') return;
    if ((!local && surface?.navigator?.onLine === false) || surface?.document?.hidden) {scheduleRecovery(); return;}
    probing = true;
    try { await perform('json', '/api/health', {}, true); }
    catch (_) { /* A single connection notice remains visible; no error loop. */ }
    finally { probing = false; scheduleRecovery(); }
  }

  async function perform(kind, path, options = {}, isProbe = false) {
    // This instance owns one launch credential. Background polls must not keep
    // sending an already rejected credential; a new launch page creates a new instance.
    if (state === 'unauthorized') throw authenticationError(local);
    const method = String(options.method || 'GET').toUpperCase();
    const read = READ_METHODS.has(method);
    for (let attempt = 0; ; attempt += 1) {
      const generation = connectionGeneration;
      const started = performance.now(), controller = new AbortController();
      const source = options.signal;
      let timedOut = false;
      const forwardAbort = () => controller.abort(source.reason);
      if (source?.aborted) forwardAbort(); else source?.addEventListener('abort', forwardAbort, {once: true});
      // Preserve existing long-running mutation/AI semantics. Only safe reads
      // get our deadline; an explicit caller signal still controls a mutation.
      const deadline = read ? setTimeout(() => { timedOut = true; controller.abort(); }, timeout) : null;
      let response, failure, status;
      try {
        response = await request(path, {...options, method, credentials: options.credentials || credentials,
          headers: {...headers, ...(options.headers || {})}, signal: controller.signal});
        status = response.status;
        if (status === 401) { setState('unauthorized'); throw authenticationError(local); }
        if (read && !isProbe && attempt === 0 && TRANSIENT_STATUSES.has(status)) {
          // The response is disposable; release its body before the next GET.
          await response.body?.cancel().catch(() => {});
          failure = {retry: true};
        } else if (kind === 'page') {
          if (!response.ok) {record(method, path, status, started); return response;}
          const body = await response.blob();
          record(method, path, status, started); healthy(generation);
          return {ok: response.ok, status, headers: response.headers, blob: () => Promise.resolve(body)};
        } else {
          let payload = null;
          if (status !== 204 && method !== 'HEAD') {
            try { payload = await response.json(); }
            catch (error) {
              if (error?.name !== 'SyntaxError') throw error;
              if (response.ok) {
                const invalid = new Error(local ? '本机返回的数据不完整，请重试。' : '电脑返回的数据不完整，请重试。');
                invalid.name = 'ReaderResponseError'; invalid.code = 'INVALID_RESPONSE'; throw invalid;
              }
            }
          }
          if (!response.ok) {
            const error = new Error(payload?.error || `请求失败（${status}）`);
            error.code = payload?.code || `HTTP_${status}`; error.status = status;
            throw error;
          }
          record(method, path, status, started); healthy(generation); return payload;
        }
      } catch (error) {
        if (error?.status || error?.name === 'ReaderResponseError') {
          record(method, path, status || error.status || 'body', started); throw error;
        }
        const timeoutFailure = timedOut || source?.reason?.name === 'TimeoutError';
        if (source?.aborted && !timeoutFailure) {record(method, path, 'aborted', started); throw error;}
        record(method, path, timeoutFailure ? 'timeout' : 'network', started);
        interrupted(generation);
        failure = {retry: read && !isProbe && attempt === 0, error: connectionError(timeoutFailure, local)};
      } finally {
        clearTimeout(deadline); source?.removeEventListener('abort', forwardAbort);
      }
      if (!failure?.retry || source?.aborted || disposed) throw failure?.error || connectionError(false, local);
      if (response && TRANSIENT_STATUSES.has(response.status)) record(method, path, response.status, started);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  const online = () => scheduleRecovery(true);
  const offline = () => {if (!local) {setState('reconnecting'); scheduleRecovery();}};
  surface?.addEventListener('online', online);
  surface?.addEventListener('offline', offline);
  surface?.document?.addEventListener('visibilitychange', online);
  return {json: (path, options) => perform('json', path, options),
    page: (path, options) => perform('page', path, options),
    diagnostics: () => events.map(event => ({...event})), get state() {return state;},
    dispose() {disposed = true; clearTimeout(recoveryTimer); surface?.removeEventListener('online', online);
      surface?.removeEventListener('offline', offline); surface?.document?.removeEventListener('visibilitychange', online);}};
}
