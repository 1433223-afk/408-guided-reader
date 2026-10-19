// Tablet reading images are derived from the immutable PDF, while the existing
// canvas, OCR overlay and reader coordinates remain the interaction surface.
const CACHE_LIMIT = 32 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 128;
const MAX_IMAGE_WIDTH = 8192;
const images = new Map();
let cachedBytes = 0;

export function clearTabletPdfPageCache() {
  images.clear();
  cachedBytes = 0;
}

function removeCached(key) {
  const previous = images.get(key);
  if (previous) cachedBytes -= previous.blob.size;
  images.delete(key);
}

function cachedImage(key) {
  const value = images.get(key);
  if (value) { images.delete(key); images.set(key, value); }
  return value;
}

function cacheImage(key, value) {
  removeCached(key);
  if (value.blob.size > CACHE_LIMIT) return;
  images.set(key, value);
  cachedBytes += value.blob.size;
  while (cachedBytes > CACHE_LIMIT) removeCached(images.keys().next().value);
}

function cancelled() {
  const error = new Error('Page rendering cancelled');
  error.name = 'RenderingCancelledException';
  return error;
}

function metadataError() {
  const error = new Error('原 PDF 页图尺寸与来源不一致，请重新打开教材。');
  error.name = 'TabletPdfMetadataError';
  return error;
}

function geometry(headers, width) {
  const pointWidth = Number(headers.get('X-Reader-Page-Width'));
  const pointHeight = Number(headers.get('X-Reader-Page-Height'));
  const imageWidth = Number(headers.get('X-Reader-Image-Width'));
  const imageHeight = Number(headers.get('X-Reader-Image-Height'));
  if (![pointWidth, pointHeight, imageWidth, imageHeight].every(value => Number.isFinite(value) && value > 0)
      || !Number.isInteger(imageWidth) || !Number.isInteger(imageHeight)
      || imageWidth < width || Math.abs(imageWidth * pointHeight / pointWidth - imageHeight) > 1.5) {
    throw metadataError();
  }
  return {pointWidth, pointHeight, imageWidth, imageHeight};
}

export function createTabletPdfPages({revision, getWidth, token, loadFallback}) {
  const {id, blob_sha256: source, page_count: numPages} = revision;
  if (!id || !source || !Number.isInteger(numPages) || numPages < 1) throw metadataError();
  const jobs = new Set();
  let destroyed = false, fallbackPromise = null;

  function check(job) {
    if (destroyed || job.stopped) throw cancelled();
  }

  function jobFor(number) {
    const controller = new AbortController();
    let reject;
    const interruption = new Promise((_, fail) => { reject = fail; });
    interruption.catch(() => {});
    const job = {number, controller, interruption, stopped: false, nativeTask: null, decodeCancel: null,
      cancel() {
        if (job.stopped) return;
        job.stopped = true;
        controller.abort();
        try { job.nativeTask?.cancel(); } catch (_) { /* Cancellation remains final. */ }
        job.decodeCancel?.();
        reject(cancelled());
        jobs.delete(job);
      }};
    jobs.add(job);
    return job;
  }

  async function wait(job, promise) {
    check(job);
    const value = await Promise.race([promise, job.interruption]);
    check(job);
    return value;
  }

  function disposeFallback(document) {
    try { Promise.resolve(document.destroy?.()).catch(() => {}); } catch (_) { /* Already closed. */ }
  }

  function fallback() {
    if (!fallbackPromise) fallbackPromise = Promise.resolve().then(() => {
      if (destroyed) throw cancelled();
      return loadFallback();
    }).then(document => {
      if (destroyed) { disposeFallback(document); throw cancelled(); }
      if (document.numPages !== numPages) { disposeFallback(document); throw metadataError(); }
      return document;
    });
    return fallbackPromise;
  }

  async function fallbackPage(job) {
    const document = await wait(job, fallback());
    return wait(job, document.getPage(job.number));
  }

  async function nativeRender(job, page, options, imageViewport = false) {
    check(job);
    let parameters = options;
    if (imageViewport) {
      const base = page.getViewport({scale: 1});
      const viewport = page.getViewport({scale: options.viewport.width / base.width});
      // A fallback must not stretch a different CropBox under the existing OCR.
      if (Math.abs(viewport.height - options.viewport.height) > 1.5) throw metadataError();
      const transform = [...(options.transform || [1, 0, 0, 1, 0, 0])];
      const ratio = options.viewport.height / viewport.height;
      transform[2] *= ratio;
      transform[3] *= ratio;
      parameters = {...options, viewport, transform};
    }
    job.nativeTask = page.render(parameters);
    await wait(job, job.nativeTask.promise);
    if (options.canvasContext.canvas?.dataset) {
      const dataset = options.canvasContext.canvas.dataset;
      dataset.readerRenderer = 'pdfjs';
      delete dataset.readerImageWidth;
      delete dataset.readerImageHeight;
    }
  }

  async function decode(job, blob) {
    if (typeof globalThis.createImageBitmap === 'function') {
      const pending = Promise.resolve().then(() => createImageBitmap(blob)).then(bitmap => {
        if (destroyed || job.stopped) { bitmap.close(); throw cancelled(); }
        return {image: bitmap, close: () => bitmap.close()};
      });
      const decoded = await Promise.race([pending, job.interruption]);
      try { check(job); } catch (error) { decoded.close(); throw error; }
      return decoded;
    }
    const pending = new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(blob);
      let released = false;
      const close = () => {
        if (released) return;
        released = true;
        image.onload = image.onerror = null;
        image.src = '';
        URL.revokeObjectURL(url);
      };
      job.decodeCancel = () => { close(); reject(cancelled()); };
      image.onload = () => { job.decodeCancel = null; resolve({image, close}); };
      image.onerror = () => { job.decodeCancel = null; close(); reject(new Error('PDF page image could not be decoded')); };
      image.src = url;
    });
    const decoded = await Promise.race([pending, job.interruption]);
    try { check(job); } catch (error) { decoded.close(); throw error; }
    return decoded;
  }

  function task(job, render) {
    jobs.add(job);
    const promise = Promise.resolve().then(() => { check(job); return render(); }).finally(() => jobs.delete(job));
    return {promise, cancel: () => job.cancel()};
  }

  function nativePage(job, page) {
    return {getViewport: options => page.getViewport(options),
      render: options => task(job, () => nativeRender(job, page, options))};
  }

  function imagePage(job, key, details, response, cached) {
    let body = cached ? Promise.resolve(cached.blob) : null;
    return {
      getViewport({scale = 1} = {}) {
        if (!Number.isFinite(scale) || scale <= 0) throw metadataError();
        return {width: details.pointWidth * scale, height: details.pointHeight * scale, scale};
      },
      render(options) {
        return task(job, async () => {
          let decoded, blob;
          try {
            try {
              body ||= response.blob();
              blob = await wait(job, body);
              decoded = await decode(job, blob);
              const image = decoded.image;
              if ((image.naturalWidth || image.width) !== details.imageWidth
                  || (image.naturalHeight || image.height) !== details.imageHeight) throw new Error('PDF image dimensions differ');
            } catch (error) {
              if (job.stopped || destroyed || error?.name === 'RenderingCancelledException') throw cancelled();
              job.controller.abort();
              decoded?.close();
              decoded = null;
              removeCached(key);
              await nativeRender(job, await fallbackPage(job), options, true);
              return;
            }
            check(job);
            const {canvasContext: context, viewport, transform} = options;
            context.save();
            try {
              if (transform) context.transform(...transform);
              context.drawImage(decoded.image, 0, 0, viewport.width, viewport.height);
            } finally { context.restore(); }
            if (context.canvas?.dataset) Object.assign(context.canvas.dataset, {
              readerRenderer: 'page-image', readerImageWidth: String(details.imageWidth), readerImageHeight: String(details.imageHeight),
            });
            cacheImage(key, {...details, blob});
          } finally { decoded?.close(); }
        });
      },
    };
  }

  return {
    numPages,
    async getPage(number) {
      if (destroyed) throw cancelled();
      if (!Number.isInteger(number) || number < 1 || number > numPages) throw new RangeError('PDF page number is invalid');
      const width = getWidth();
      if (!Number.isInteger(width) || width < 1) throw metadataError();
      const key = `${source}:${number - 1}:${width}`;
      const job = jobFor(number);
      try {
        if (width < MIN_IMAGE_WIDTH || width > MAX_IMAGE_WIDTH) return nativePage(job, await fallbackPage(job));
        const cached = cachedImage(key);
        if (cached) return imagePage(job, key, cached, null, cached);
        let response;
        try {
          response = await wait(job, fetch(`/api/revisions/${encodeURIComponent(id)}/page-image?page=${number - 1}&width=${width}`, {
            headers: {'X-Reader-Token': token}, credentials: 'include', signal: job.controller.signal,
          }));
        } catch (error) {
          check(job);
          return nativePage(job, await fallbackPage(job));
        }
        if (!response.ok) {
          if (response.status === 422 || response.status >= 500) {
            job.controller.abort();
            return nativePage(job, await fallbackPage(job));
          }
          const error = new Error(`无法读取原 PDF 页图（${response.status}）。`);
          error.status = response.status;
          throw error;
        }
        return imagePage(job, key, geometry(response.headers, width), response, null);
      } catch (error) { job.controller.abort(); jobs.delete(job); throw error; }
    },
    cancelPage(number) { for (const job of [...jobs]) if (job.number === number) job.cancel(); },
    cancelAll() { for (const job of [...jobs]) job.cancel(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const job of [...jobs]) job.cancel();
      fallbackPromise?.then(disposeFallback, () => {});
    },
  };
}
