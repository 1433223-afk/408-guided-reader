import {createId} from './id.js';

export const INK_PALETTE = Object.freeze([
  ['黑色', '#252923'], ['灰色', '#8b9098'], ['红色', '#f04452'], ['橙色', '#f58220'],
  ['金色', '#e4b400'], ['绿色', '#24aa62'], ['蓝色', '#2f80ed'], ['紫色', '#a259e6'],
].map(([name,color]) => Object.freeze({name,color})));
// Existing saved strokes retain their original Paper palette.
export const INK_COLORS = Object.freeze([...new Set([...INK_PALETTE.map(item => item.color),
  '#777b75', '#ad3939', '#b66a35', '#9c7b27', '#477451', '#3d658f', '#785c91'])]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clone = value => JSON.parse(JSON.stringify(value));
const keyFor = (revision, id) => `${revision}:${id}`;

export function validateInkStroke(value) {
  if (!value || !UUID.test(value.id) || !Number.isInteger(value.page_index) || value.page_index < 0
      || value.coordinate_version !== 1 || !INK_COLORS.includes(value.color)
      || !Number.isFinite(value.width) || value.width < .0003 || value.width > .02
      || !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 1500
      || value.points.some(point => !Array.isArray(point) || point.length !== 3
        || point.some(number => !Number.isFinite(number) || number < 0 || number > 1))) {
    throw new Error('笔迹数据无效，尚未保存。');
  }
  return {id:value.id, page_index:value.page_index, coordinate_version:1,
    color:value.color, width:value.width, points:clone(value.points)};
}

// Only this origin's pending ink is stored here. Reader Core owns the durable
// library, either on this tablet or at the selected LAN origin.
export function createInkIndexedDB({indexedDB = globalThis.indexedDB,
  name = 'guided-reader-tablet-ink-v1'} = {}) {
  let opening = null;
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDB) {reject(new Error('此浏览器无法暂存待保存笔迹。')); return;}
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        const operations = database.createObjectStore('operations', {keyPath:'sequence', autoIncrement:true});
        operations.createIndex('operation_id', 'operation_id', {unique:true});
        database.createObjectStore('states', {keyPath:'key'});
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {request.result.close(); opening = null;};
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error('待保存笔迹存储无法打开。'));
      request.onblocked = () => reject(new Error('请关闭旧的 Reader 标签页后重试保存笔迹。'));
    }).catch(error => {opening = null; throw error;});
    return opening;
  };
  const transaction = async (names, work) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(names, 'readwrite');
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('待保存笔迹未能写入浏览器。'));
      work(tx, result => {value = result;});
    });
  };
  return {
    async load() {
      const database = await open();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(['operations','states'], 'readonly');
        const operations = tx.objectStore('operations').getAll(), states = tx.objectStore('states').getAll();
        tx.oncomplete = () => resolve({operations:operations.result, states:states.result});
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('待保存笔迹读取失败。'));
      });
    },
    append(operation, state) {
      return transaction(['operations','states'], (tx, done) => {
        const record = clone(operation); delete record.sequence; delete record.persisted;
        const request = tx.objectStore('operations').add(record);
        tx.objectStore('states').put(clone(state));
        request.onsuccess = () => done(request.result);
      });
    },
    acknowledge(sequence, state) {
      return transaction(['operations','states'], tx => {
        tx.objectStore('operations').delete(sequence);
        if (state) {
          const request = tx.objectStore('states').get(state.key);
          request.onsuccess = () => {
            if (request.result?.operation_id === state.operation_id) tx.objectStore('states').put(clone(state));
          };
        }
      });
    },
    forget(states) {
      return transaction(['states'], tx => {
        for (const state of states) {
          const request = tx.objectStore('states').get(state.key);
          request.onsuccess = () => {
            if (request.result?.operation_id === state.operation_id
                && request.result?.version === state.version) tx.objectStore('states').delete(state.key);
          };
        }
      });
    },
  };
}

export function createTabletInkStore({api, persistence = createInkIndexedDB(),
  makeId = createId, windowTarget = globalThis.window, documentTarget = globalThis.document,
  requestTimeout = 15000} = {}) {
  const records = [], desired = new Map(), remote = new Map(), listeners = new Set(), loading = new Map();
  let version = 0, saving = false, error = null, storageError = false, disposed = false, loaded = false;
  let serial = Promise.resolve(), pumpPromise = null;
  const pageKey = (revision, page) => `${revision}:${page}`;
  const snapshot = () => ({pending:records.length, saving, error});
  const notify = (revision, page) => {
    for (const listener of listeners) {
      try {listener({...snapshot(), revision, page});} catch (_) { /* Observers cannot discard ink. */ }
    }
  };
  function hydrate(saved) {
    const volatile = records.filter(record => !record.persisted);
    for (const state of saved.states || []) {
      if (!state || !UUID.test(state.revision_id) || !UUID.test(state.stroke_id)) continue;
      if (state.stroke) state.stroke = validateInkStroke(state.stroke);
      version = Math.max(version, state.version || 0);
      if (!desired.has(state.key)) desired.set(state.key, state);
    }
    const durable = (saved.operations || []).map(operation => ({...operation,persisted:true})).sort((a,b) => a.sequence-b.sequence);
    records.splice(0,records.length,...durable,...volatile);
    for (const operation of volatile) {
      operation.local_state.version = ++version;
      desired.set(operation.local_state.key,operation.local_state);
    }
    loaded = true;
  }
  const ready = Promise.resolve().then(() => persistence.load()).then(hydrate).then(() => {
    storageError = false;
  }).catch(() => {
    storageError = true; error = '浏览器草稿存储不可用；笔迹尚未保存，请保留此页面并重试。';
  }).then(() => {notify(); if (!storageError) pump();});

  function stateFor(operation) {
    const key = keyFor(operation.revision_id, operation.stroke_id), previous = desired.get(key);
    const stroke = operation.stroke || previous?.stroke;
    if (!stroke) throw new Error('找不到这笔批注，请重新打开本页后重试。');
    return {key, revision_id:operation.revision_id, page_index:operation.page_index,
      stroke_id:operation.stroke_id, stroke, deleted:operation.action === 'delete', pending:true,
      operation_id:operation.operation_id, version:++version};
  }
  function enqueue(value) {
    const operation = {operation_id:value.operation_id || makeId(), revision_id:value.revision_id,
      page_index:value.page_index, action:value.action, stroke_id:value.stroke_id};
    if (!UUID.test(operation.operation_id) || !UUID.test(operation.revision_id) || !UUID.test(operation.stroke_id)
        || !Number.isInteger(operation.page_index) || operation.page_index < 0
        || !['put','delete','restore'].includes(operation.action)) return Promise.reject(new Error('笔迹操作无效。'));
    if (value.stroke) operation.stroke = validateInkStroke(value.stroke);
    if (operation.action === 'put' && !operation.stroke) return Promise.reject(new Error('缺少笔迹数据。'));
    if (operation.stroke && (operation.stroke.id !== operation.stroke_id
        || operation.stroke.page_index !== operation.page_index)) return Promise.reject(new Error('笔迹页面不匹配。'));
    const result = serial.then(() => ready).then(async () => {
      if (records.some(record => record.operation_id === operation.operation_id)) return operation.operation_id;
      const state = stateFor(operation);
      desired.set(state.key, state);
      const record = {...operation, local_state:clone(state), persisted:false}; records.push(record); notify(operation.revision_id, operation.page_index);
      if (loaded && !records.some(item => item !== record && !item.persisted)) {
        try {record.sequence = await persistence.append(record, state); record.persisted = true; storageError = false;}
        catch (_) {storageError = true; error = '笔迹尚未写入浏览器草稿，请保留此页面并重试。';}
      }
      notify(operation.revision_id, operation.page_index); pump();
      return operation.operation_id;
    });
    serial = result.catch(() => {});
    return result;
  }
  function pump() {
    if (disposed || pumpPromise || !records.length || !records[0].persisted) return pumpPromise;
    pumpPromise = (async () => {
      while (!disposed && records.length && records[0].persisted) {
        const operation = records[0]; saving = true; notify(operation.revision_id, operation.page_index);
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(),requestTimeout); deadline.unref?.();
        try {
          const body = {operation_id:operation.operation_id, action:operation.action, stroke_id:operation.stroke_id};
          if (operation.action === 'put') {
            const {id: _id, ...payload} = operation.stroke;
            body.stroke = payload;
          }
          const ack = await api(`/api/revisions/${operation.revision_id}/ink`, {
            method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),signal:controller.signal});
          if (ack?.operation_id !== operation.operation_id || ack?.stroke_id !== operation.stroke_id
              || typeof ack.deleted !== 'boolean') throw new Error('未能确认这笔批注，请重试。');
          const key = keyFor(operation.revision_id, operation.stroke_id), latest = desired.get(key);
          const committed = latest?.operation_id === operation.operation_id ? {...latest,
            stroke:ack.stroke ? validateInkStroke(ack.stroke) : latest.stroke,
            deleted:ack.deleted, pending:false, version:++version} : null;
          // Keep the operation until the acknowledgement is itself durable.
          // Repeating an acknowledged UUID after a storage failure is safe.
          await persistence.acknowledge(operation.sequence, committed);
          if (committed && desired.get(key)?.operation_id === operation.operation_id) desired.set(key, committed);
          records.shift(); error = storageError ? error : null;
          notify(operation.revision_id, operation.page_index);
        } catch (failure) {
          error = controller.signal.aborted ? '保存超时，笔迹待保存，请重试。'
            : failure?.message || '笔迹待保存，请保留此页面并重试。';
          break; // FIFO: a later delete/restore must never overtake a failed put.
        } finally {clearTimeout(deadline);}
      }
    })().finally(() => {saving = false; pumpPromise = null; notify();});
    return pumpPromise;
  }
  async function retry() {
    await ready;
    const work = serial.then(async () => {
      if (!loaded) {
        try {hydrate(await persistence.load()); storageError = false;}
        catch (_) {storageError = true; error = '浏览器草稿仍不可读取，请保留页面后重试。'; notify(); return;}
      }
      for (const operation of records) {
        if (operation.persisted) continue;
        try {
          operation.sequence = await persistence.append(operation, operation.local_state);
          operation.persisted = true; storageError = false;
        } catch (_) {
          storageError = true; error = '浏览器草稿仍未保存，请保留页面后重试。'; notify(); return;
        }
      }
      if (!storageError) error = null;
    });
    serial = work.catch(() => {}); await work; return pump();
  }
  function getPage(revision, page) {
    const merged = new Map(remote.get(pageKey(revision,page)) || []);
    for (const state of desired.values()) if (state.revision_id === revision && state.page_index === page) {
      if (state.deleted) merged.delete(state.stroke_id); else merged.set(state.stroke_id, state.stroke);
    }
    return [...merged.values()];
  }
  async function loadPage(revision, page, {force = false} = {}) {
    await ready;
    const key = pageKey(revision,page);
    if (!force && remote.has(key)) return getPage(revision,page);
    if (loading.has(key)) return loading.get(key);
    const started = version;
    const work = (async () => {
      const response = await api(`/api/revisions/${revision}/ink?page=${page}`);
      if (!Array.isArray(response?.strokes)) throw new Error('本页笔迹读取失败，请重试。');
      const values = response.strokes.map(validateInkStroke);
      if (values.some(stroke => stroke.page_index !== page)) throw new Error('本页笔迹来源不匹配。');
      remote.set(key, new Map(values.map(stroke => [stroke.id,stroke])));
      // Only a GET started after an ack can retire its local override. A late
      // older GET must not resurrect a deleted stroke or erase a local restore.
      const forget = [...desired.values()].filter(state => state.revision_id === revision
        && state.page_index === page && !state.pending && state.version <= started);
      if (forget.length) {
        await persistence.forget(forget);
        for (const state of forget) if (desired.get(state.key)?.version === state.version) desired.delete(state.key);
      }
      notify(revision,page); return getPage(revision,page);
    })().finally(() => loading.delete(key));
    loading.set(key,work); return work;
  }
  const online = () => {retry().catch(() => {});};
  const visible = () => {if (!documentTarget?.hidden) online();};
  windowTarget?.addEventListener('online', online);
  documentTarget?.addEventListener('visibilitychange', visible);
  return {ready, enqueue, retry, loadPage, getPage, getState:snapshot,
    async hasPending() {await ready; await serial; return records.length > 0 || storageError;},
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    destroy() {disposed = true; listeners.clear(); windowTarget?.removeEventListener('online', online);
      documentTarget?.removeEventListener('visibilitychange', visible);},
  };
}
