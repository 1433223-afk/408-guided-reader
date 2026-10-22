// PDF.js 6 owns the worker and network readers on the loading task.
export function createPdfSession(getDocument) {
  let generation = 0, current = null, pending = Promise.resolve();
  const destroyed = new WeakMap();
  function dispose(task) {
    if (!task) return Promise.resolve();
    if (!destroyed.has(task)) destroyed.set(task, Promise.resolve().then(() => task.destroy()));
    return destroyed.get(task);
  }
  function release() {
    const old = current;
    current = null;
    pending = Promise.allSettled([pending, dispose(old)]).then(() => undefined);
    return pending;
  }
  return {
    close() { generation++; return release(); },
    async open(options) {
      const request = ++generation;
      await release();
      if (request !== generation) return null;
      const task = getDocument(options);
      current = task;
      try {
        const pdf = await task.promise;
        if (request !== generation) { await dispose(task).catch(() => {}); return null; }
        return pdf;
      } catch (error) {
        if (current === task) await release();
        if (request !== generation) return null;
        throw error;
      }
    },
  };
}
