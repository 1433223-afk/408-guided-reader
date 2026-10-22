// Tablet reading images are derived from the immutable PDF, while the existing
// canvas, OCR overlay and reader coordinates remain the interaction surface.
const CACHE_LIMIT = 32 * 1024 * 1024;
const MIN_IMAGE_WIDTH = 128;
const MAX_IMAGE_WIDTH = 8192;
const PREVIEW_IMAGE_WIDTH = 512;
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

function cachedPage(prefix, width) {
  const exact = `${prefix}${width}`;
  if (images.has(exact)) return {key: exact, value: cachedImage(exact)};
  let selected = null;
  for (const [key, value] of images) {
    // A previously rendered, larger original page can be drawn smaller with no
    // loss of target detail. Bound decoding work when returning from 400% zoom;
    // never reuse a smaller scan when zooming in or cross a PDF/page boundary.
    if (key.startsWith(prefix) && value.imageWidth >= width && value.imageWidth <= width * 2
        && (!selected || value.imageWidth < selected.value.imageWidth)) selected = {key, value};
  }
  if (selected) selected.value = cachedImage(selected.key);
  return selected;
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

export function createTabletPdfPages({revision, getWidth, token, loadFallback, fetchPage = globalThis.fetch}) {
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
    if (!fallbackPromise) {
      const pending = Promise.resolve().then(() => {
        if (destroyed) throw cancelled();
        return loadFallback();
      }).then(document => {
        if (destroyed) { disposeFallback(document); throw cancelled(); }
        if (document.numPages !== numPages) { disposeFallback(document); throw metadataError(); }
        return document;
      }).catch(error => {
        // A transient PDF.js load failure must not poison all subsequent pages
        // until the entire browser window is refreshed.
        if (!destroyed && error?.name !== 'TabletPdfMetadataError' && fallbackPromise === pending) fallbackPromise = null;
        throw error;
      });
      fallbackPromise = pending;
    }
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
      delete dataset.readerPreview;
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

  function imagePage(job, key, details, response, cached, preview = false) {
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
            body ||= response.blob();
            blob = await wait(job, body);
            // A broken image transfer is a connection failure, not evidence
            // that the PDF engine cannot render this page. Keep it retryable
            // without initiating a potentially 150MB PDF.js fallback download.
            cacheImage(key, {...details, blob});
            try {
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
            if (preview) {
              if (context.canvas?.dataset) context.canvas.dataset.readerPreview = 'true';
              decoded.close(); decoded = null;
              options.onPreview?.();
              check(job);
              // The first paint is an exact-source thumbnail, never the final
              // reading resolution. It and the full image share this canvas and
              // the same PDF coordinate system, so OCR can be selected meanwhile.
              const full = await wait(job, getPage(job.number));
              const fullBase = full.getViewport({scale: 1});
              if (Math.abs(fullBase.width - details.pointWidth) > .01
                  || Math.abs(fullBase.height - details.pointHeight) > .01) throw metadataError();
              job.nativeTask = full.render({...options, onPreview: undefined});
              await wait(job, job.nativeTask.promise);
            } else if (context.canvas?.dataset) delete context.canvas.dataset.readerPreview;
          } finally { decoded?.close(); }
        });
      },
    };
  }

  async function getPage(number, {preview = false} = {}) {
      if (destroyed) throw cancelled();
      if (!Number.isInteger(number) || number < 1 || number > numPages) throw new RangeError('PDF page number is invalid');
      const width = getWidth();
      if (!Number.isInteger(width) || width < 1) throw metadataError();
      const prefix = `${source}:${number - 1}:`;
      const job = jobFor(number);
      try {
        if (width < MIN_IMAGE_WIDTH || width > MAX_IMAGE_WIDTH) return nativePage(job, await fallbackPage(job));
        const cached = cachedPage(prefix, width);
        if (cached) return imagePage(job, cached.key, cached.value, null, cached.value);
        const requestWidth = preview && width > PREVIEW_IMAGE_WIDTH * 1.5 ? PREVIEW_IMAGE_WIDTH : width;
        const progressive = requestWidth !== width;
        const requestKey = `${prefix}${requestWidth}`;
        const thumbnail = progressive ? cachedPage(prefix, requestWidth) : null;
        if (thumbnail) return imagePage(job, thumbnail.key, thumbnail.value, null, thumbnail.value, true);
        let response;
        try {
          response = await wait(job, fetchPage(`/api/revisions/${encodeURIComponent(id)}/page-image?page=${number - 1}&width=${requestWidth}`, {
            headers: {'X-Reader-Token': token}, credentials: 'include', signal: job.controller.signal,
          }));
        } catch (error) {
          check(job);
          throw error;
        }
        if (!response.ok) {
          if (response.status === 422) {
            job.controller.abort();
            return nativePage(job, await fallbackPage(job));
          }
          const error = new Error(`无法读取原 PDF 页图（${response.status}）。`);
          error.status = response.status;
          throw error;
        }
        return imagePage(job, requestKey, geometry(response.headers, requestWidth), response, null, progressive);
      } catch (error) { job.controller.abort(); jobs.delete(job); throw error; }
  }

  return {
    numPages, getPage,
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
