/* Fan cheers, stored as six numbers in a Firebase Realtime Database (data/config.json "cheer_db").
   Uses the plain REST API: an EventSource stream for live totals and a server-side increment for taps,
   so no Firebase SDK is needed. Shared by cheer.html and the TV race slide. */
(function () {
  const clean = db => String(db || "").replace(/\/+$/, "");

  // Live totals: calls onTotals({ "1": n, ... }) on every change. Falls back to polling if streaming fails.
  function watch(db, onTotals) {
    db = clean(db); if (!db) return () => {};
    let totals = {}, es = null, poll = null, stopped = false;
    const emit = () => onTotals(Object.assign({}, totals));
    const apply = msg => {
      try {
        const { path, data } = JSON.parse(msg.data);
        if (path === "/") totals = data && typeof data === "object" ? data : {};
        else totals[path.replace(/^\//, "")] = data;
        emit();
      } catch (_) {}
    };
    const startPoll = () => {
      if (poll || stopped) return;
      const get = () => fetch(`${db}/cheers.json`, { cache: "no-store" }).then(r => r.json()).then(d => { totals = d || {}; emit() }).catch(() => {});
      get(); poll = setInterval(get, 5000);
    };
    try {
      es = new EventSource(`${db}/cheers.json`);
      es.addEventListener("put", apply);
      es.addEventListener("patch", e => { try { const { data } = JSON.parse(e.data); Object.assign(totals, data); emit() } catch (_) {} });
      es.onerror = () => { if (es.readyState === 2) { es = null; startPoll() } };
    } catch (_) { startPoll() }
    return () => { stopped = true; if (es) es.close(); if (poll) clearInterval(poll) };
  }

  // Add n cheers to a team (1-6). Resolves true on success.
  function add(db, team, n, keepalive) {
    db = clean(db);
    return fetch(`${db}/cheers/${team}.json`, {
      method: "PUT", keepalive: !!keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ".sv": { increment: n } }),
    }).then(r => r.ok).catch(() => false);
  }

  window.TTCheer = { watch, add };
})();
