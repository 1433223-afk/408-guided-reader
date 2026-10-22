/* Standalone input probe. No Core calls, document content, or persistent storage. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const board = byId('writing-board');
  const canvas = byId('writing-canvas');
  const context = canvas.getContext('2d');
  const pointerSupported = typeof window.PointerEvent === 'function';
  const capabilities = {
    secureContext: window.isSecureContext === true,
    pointerEvents: pointerSupported,
    pressure: pointerSupported && 'pressure' in PointerEvent.prototype,
    tilt: pointerSupported && 'tiltX' in PointerEvent.prototype && 'tiltY' in PointerEvent.prototype,
    coalescedEvents: pointerSupported && typeof PointerEvent.prototype.getCoalescedEvents === 'function',
    predictedEvents: pointerSupported && typeof PointerEvent.prototype.getPredictedEvents === 'function',
    rawUpdates: 'onpointerrawupdate' in window,
  };
  const round = (value, digits = 3) => Number(value.toFixed(digits));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const browserVersion = () => {
    const agent = navigator.userAgent;
    for (const [name, pattern] of [['Edge', /Edg(?:A|iOS)?\/([\d.]+)/], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/]]) {
      const match = agent.match(pattern);
      if (match) return { name, version: match[1] };
    }
    return { name: 'Other', version: null };
  };
  let startedAt;
  let stats;
  let pressureValues;
  let buttonValues;
  let buttonsValues;
  let strokes = [];
  const activePens = new Map();
  const touches = new Map();
  let gesture = null;
  let view = { scale: 1, x: 0, y: 0 };
  let baseScale = 1;
  let frame = 0;
  let size = { width: 1, height: 1, ratio: 1 };
  const world = { width: 1000, height: 750 };

  function updateRange(range, value) {
    if (!finite(value)) return;
    range.min = range.min === null ? value : Math.min(range.min, value);
    range.max = range.max === null ? value : Math.max(range.max, value);
  }

  function resetStats() {
    startedAt = performance.now();
    pressureValues = new Set(); buttonValues = new Set(); buttonsValues = new Set();
    stats = {
      events: { pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0, lostpointercapture: 0, contextmenu: 0 },
      pen: { contacts: 0, samples: 0, hoverMoves: 0, pressure: { min: null, max: null }, tiltX: { min: null, max: null }, tiltY: { min: null, max: null }, sideButtonSamples: 0, eraserSamples: 0 },
      touch: { contacts: 0, maxConcurrent: 0, cancellations: 0 },
      sampling: { coalescedSamples: 0, predictedSamples: 0, methodErrors: 0 },
    };
  }

  function getReport() {
    // Deliberately enumerate fields. Never serialize event objects, URLs, or ink.
    return {
      schemaVersion: 1,
      browser: browserVersion(),
      capabilities: { ...capabilities },
      durationMs: Math.round(performance.now() - startedAt),
      events: { ...stats.events },
      pen: {
        contacts: stats.pen.contacts, samples: stats.pen.samples, hoverMoves: stats.pen.hoverMoves,
        pressure: { ...stats.pen.pressure, distinctValues: pressureValues.size },
        tiltX: { ...stats.pen.tiltX }, tiltY: { ...stats.pen.tiltY },
        buttonValues: [...buttonValues].sort((a, b) => a - b),
        buttonsValues: [...buttonsValues].sort((a, b) => a - b),
        sideButtonSamples: stats.pen.sideButtonSamples, eraserSamples: stats.pen.eraserSamples,
      },
      touch: { ...stats.touch },
      sampling: { ...stats.sampling },
    };
  }

  function rangeText(range, suffix = '') {
    if (range.min === null) return '尚未收到';
    return range.min === range.max ? `${range.min}${suffix}（未见变化）` : `${range.min}–${range.max}${suffix}`;
  }

  function renderStats() {
    byId('reading-pen').textContent = stats.pen.samples ? `已识别 · ${stats.pen.samples} 次采样` : '尚未收到';
    byId('reading-pressure').textContent = rangeText(stats.pen.pressure);
    const tilt = stats.pen.tiltX.min === null ? '尚未收到' : `X ${rangeText(stats.pen.tiltX, '°')} / Y ${rangeText(stats.pen.tiltY, '°')}`;
    byId('reading-tilt').textContent = tilt;
    byId('reading-buttons').textContent = stats.pen.eraserSamples || stats.pen.sideButtonSamples ? `侧键 ${stats.pen.sideButtonSamples} · 橡皮 ${stats.pen.eraserSamples}` : stats.pen.samples ? '仅笔尖 · 未收到侧键' : '尚未收到';
    byId('reading-hover').textContent = stats.pen.hoverMoves ? `已收到 · ${stats.pen.hoverMoves} 次` : '尚未收到';
    byId('reading-cancel').textContent = `${stats.events.pointercancel} 次`;
    byId('reading-touch').textContent = `${stats.touch.contacts} 次 · 最多 ${stats.touch.maxConcurrent} 点`;
    byId('pen-state').textContent = activePens.size ? '正在试写' : stats.pen.contacts ? '已收到触控笔' : '等待触控笔';
    byId('paper-scale').textContent = `${Math.round(view.scale / baseScale * 100)}%`;
  }

  function paint() {
    context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    context.fillStyle = '#fffdf7';
    context.fillRect(0, 0, world.width, world.height);
    context.fillStyle = '#deded2';
    for (let y = 35; y < world.height; y += 35) {
      for (let x = 35; x < world.width; x += 35) context.fillRect(x, y, 1.5, 1.5);
    }
    context.strokeStyle = '#354c3e'; context.fillStyle = '#354c3e';
    context.lineCap = 'round'; context.lineJoin = 'round';
    for (const stroke of strokes) {
      const points = stroke.points;
      if (points.length === 1) {
        context.beginPath(); context.arc(points[0].x, points[0].y, 1.3 + points[0].p * 1.6, 0, Math.PI * 2); context.fill();
      }
      for (let i = 1; i < points.length; i++) {
        context.lineWidth = 1.5 + (points[i - 1].p + points[i].p) * 2.5;
        context.beginPath(); context.moveTo(points[i - 1].x, points[i - 1].y); context.lineTo(points[i].x, points[i].y); context.stroke();
      }
    }
  }

  function schedulePaint() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; paint(); renderStats(); });
  }

  function fitPaper() {
    baseScale = Math.min(size.width / world.width, size.height / world.height) * .94;
    view = { scale: baseScale, x: (size.width - world.width * baseScale) / 2, y: (size.height - world.height * baseScale) / 2 };
    gesture = null;
  }

  function resize() {
    const rect = board.getBoundingClientRect();
    size = { width: rect.width, height: rect.height, ratio: Math.min(window.devicePixelRatio || 1, 2) };
    canvas.width = Math.round(size.width * size.ratio); canvas.height = Math.round(size.height * size.ratio);
    fitPaper(); schedulePaint();
  }

  function position(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function penSample(event) {
    stats.pen.samples++;
    if (finite(event.button) && event.button >= 0 && event.button <= 5) buttonValues.add(event.button);
    if (finite(event.buttons) && event.buttons >= 0 && event.buttons <= 63) buttonsValues.add(event.buttons);
    if (event.buttons & 2) stats.pen.sideButtonSamples++;
    if (event.buttons & 32) stats.pen.eraserSamples++;
    if ((event.buttons & 1) || (event.buttons & 32)) {
      if (finite(event.pressure)) {
        const pressure = round(clamp(event.pressure, 0, 1));
        updateRange(stats.pen.pressure, pressure); pressureValues.add(pressure);
      }
      if (finite(event.tiltX)) updateRange(stats.pen.tiltX, round(event.tiltX, 1));
      if (finite(event.tiltY)) updateRange(stats.pen.tiltY, round(event.tiltY, 1));
    }
  }

  function sampleBatch(event) {
    let samples = [event];
    if (capabilities.coalescedEvents && event.type === 'pointermove') {
      try {
        const batch = event.getCoalescedEvents();
        stats.sampling.coalescedSamples += batch.length;
        if (batch.length) samples = batch;
      } catch (_) { stats.sampling.methodErrors++; }
    }
    if (capabilities.predictedEvents && event.type === 'pointermove') {
      try { stats.sampling.predictedSamples += event.getPredictedEvents().length; }
      catch (_) { stats.sampling.methodErrors++; }
    }
    return samples;
  }

  function appendInk(event, stroke) {
    const pos = position(event);
    const point = { x: (pos.x - view.x) / view.scale, y: (pos.y - view.y) / view.scale, p: finite(event.pressure) ? clamp(event.pressure, 0, 1) : .5 };
    if (point.x < 0 || point.x > world.width || point.y < 0 || point.y > world.height) return;
    const last = stroke.points.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) > .15) stroke.points.push(point);
    byId('board-hint').hidden = true;
  }

  function startGesture() {
    const points = [...touches.values()];
    if (!points.length) { gesture = null; return; }
    const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
    gesture = { center, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, view: { ...view } };
  }

  function movePaper() {
    if (!gesture || activePens.size) return;
    const points = [...touches.values()];
    if (!points.length) return;
    if (points.length === 1) {
      view.x = gesture.view.x + points[0].x - gesture.center.x;
      view.y = gesture.view.y + points[0].y - gesture.center.y;
    } else {
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      view.scale = clamp(gesture.view.scale * distance / Math.max(gesture.distance, 1), baseScale * .6, baseScale * 4);
      const factor = view.scale / gesture.view.scale;
      view.x = center.x - (gesture.center.x - gesture.view.x) * factor;
      view.y = center.y - (gesture.center.y - gesture.view.y) * factor;
    }
  }

  function onPointer(event) {
    if (Object.hasOwn(stats.events, event.type)) stats.events[event.type]++;
    if (event.pointerType === 'pen') {
      if (event.type === 'pointermove' && event.buttons === 0 && !activePens.has(event.pointerId)) stats.pen.hoverMoves++;
      const samples = sampleBatch(event);
      for (const sample of samples) penSample(sample);
      if (event.type === 'pointerdown') {
        stats.pen.contacts++;
        gesture = null;
        // Buttons are observed, but only an ordinary pen tip leaves test ink.
        if (!(event.buttons & 32) && !(event.buttons & 2)) {
          const stroke = { points: [] }; strokes.push(stroke); activePens.set(event.pointerId, stroke);
          appendInk(event, stroke);
        }
        canvas.setPointerCapture(event.pointerId);
      } else if (event.type === 'pointermove' && activePens.has(event.pointerId)) {
        if (!(event.buttons & 32) && !(event.buttons & 2)) {
          for (const sample of samples) appendInk(sample, activePens.get(event.pointerId));
        }
      } else if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) {
        activePens.delete(event.pointerId);
        startGesture();
      }
      if (event.cancelable) event.preventDefault();
    } else if (event.pointerType === 'touch') {
      if (event.type === 'pointerdown') {
        stats.touch.contacts++; touches.set(event.pointerId, position(event));
        stats.touch.maxConcurrent = Math.max(stats.touch.maxConcurrent, touches.size);
        canvas.setPointerCapture(event.pointerId); startGesture();
      } else if (event.type === 'pointermove' && touches.has(event.pointerId)) {
        touches.set(event.pointerId, position(event)); movePaper();
      } else if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) {
        if (event.type === 'pointercancel') stats.touch.cancellations++;
        touches.delete(event.pointerId); startGesture();
      }
      if (event.cancelable) event.preventDefault();
    }
    schedulePaint();
  }

  function restart() {
    // Release captures before resetting counters; old input must not alter a new run.
    for (const pointerId of [...activePens.keys(), ...touches.keys()]) {
      if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    }
    activePens.clear(); touches.clear(); strokes = [];
    resetStats(); fitPaper(); byId('board-hint').hidden = false;
    byId('action-status').textContent = '已重新开始，之前的试写已清空。';
    schedulePaint();
  }

  resetStats();
  byId('connection-state').textContent = capabilities.secureContext ? '安全连接' : '基础采样';
  byId('sampling-detail').textContent = [
    `基础笔事件：${capabilities.pointerEvents ? '可用' : '不可用，请使用 Chrome'}`,
    `密集采样：${capabilities.coalescedEvents ? '接口可用，实际数量见下载结果' : '当前连接未开放，使用基础采样'}`,
    `预测采样：${capabilities.predictedEvents ? '接口可用，实际数量见下载结果' : '当前不可用'}`,
    '能力以本次收到的事件为准。试写纸的移动、缩放由本测试页处理，不代表原生应用的防误触效果。',
  ].join('\n');
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, onPointer);
  canvas.addEventListener('contextmenu', event => { event.preventDefault(); stats.events.contextmenu++; schedulePaint(); });
  byId('restart-check').addEventListener('click', restart);
  byId('download-report').addEventListener('click', () => {
    try {
      const blob = new Blob([JSON.stringify(getReport(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'guided-reader-pen-check.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      byId('action-status').textContent = '已生成结果文件，未包含试写内容。';
    } catch (_) { byId('action-status').textContent = '下载未成功，请重试。试写仍保留在本页。'; }
  });
  new ResizeObserver(resize).observe(board);
  window.TabletPenCheck = Object.freeze({ getReport, restart });
  resize(); renderStats();
})();
