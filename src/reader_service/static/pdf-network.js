// PDF.js 6.3 uses the global fetch without a cache option. Chromium can serialize
// concurrent Range requests to one URL behind its HTTP-cache entry, even when the
// response later says no-store. Opt out before admission, for Beta PDF GETs only.
export function pdfFetchWithoutCache(fetch, origin) {
  // Flat page trees can request hundreds of disjoint ranges at once. Bound
  // admission until headers arrive, keeping the native response/body untouched.
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < 8 && waiting.length) waiting.shift()();
  }
  function rangeFetch(input, options) {
    const signal = options.signal !== undefined ? options.signal : (input instanceof Request ? input.signal : undefined);
    return new Promise((resolve, reject) => {
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const start = () => {
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) { abort(); return; }
        active++;
        Promise.resolve().then(() => fetch(input, options)).then(resolve, reject).finally(() => {
          active--;
          drain();
        });
      };
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, {once:true});
      waiting.push(start);
      drain();
    });
  }
  return function(input, init) {
    let url;
    try {
      url = new URL(input instanceof Request ? input.url : input, origin);
    } catch {
      return fetch(input, init);
    }
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() === 'GET' && url.origin === origin
        && /^\/api\/revisions\/[^/]+\/pdf$/.test(url.pathname)) {
      const options = {...init, cache:'no-store'};
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      return headers.has('Range') ? rangeFetch(input, options) : fetch(input, options);
    }
    return fetch(input, init);
  };
}
