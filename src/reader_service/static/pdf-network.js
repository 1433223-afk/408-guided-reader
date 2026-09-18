// PDF.js 6.3 uses the global fetch without a cache option. Chromium can serialize
// concurrent Range requests to one URL behind its HTTP-cache entry, even when the
// response later says no-store. Opt out before admission, for Beta PDF GETs only.
export function pdfFetchWithoutCache(fetch, origin) {
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
      return fetch(input, {...init, cache:'no-store'});
    }
    return fetch(input, init);
  };
}
