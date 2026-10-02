// Optional enrichment: Practice never awaits this work or displays its status.
export function createPracticeKnowledge({api, onChange, schedule = setTimeout, cancel = clearTimeout}) {
  let session = null;
  let matches = new Map();

  function stop() {
    if (session) {
      cancel(session.timer);
      session.controller.abort();
    }
    session = null;
    matches = new Map();
  }

  async function refresh(current, start) {
    try {
      const path = `/api/revisions/${current.revisionId}/practice-prototype/knowledge-links`;
      const payload = await api(start ? path : `${path}?section_id=${encodeURIComponent(current.sectionId)}`, start
        ? {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({section_id: current.sectionId}), signal: current.controller.signal}
        : {signal: current.controller.signal});
      if (session !== current || payload.section_id !== current.sectionId) return;
      matches = new Map(payload.matches.map(item => [item.number, item.knowledge_point]));
      onChange();
      if (payload.pending) current.timer = schedule(() => refresh(current, false), 1500);
    } catch {
      // A later Practice entry can retry. An unavailable enrichment is invisible.
    }
  }

  return {
    start(revisionId, sectionId) {
      stop();
      const current = {revisionId, sectionId, controller: new AbortController(), timer: null};
      session = current;
      onChange();
      void refresh(current, true);
    },
    stop,
    point: number => matches.get(number) || null,
  };
}
