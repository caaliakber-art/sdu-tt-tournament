/* Fan cheers, stored as six numbers in a Firebase Realtime Database (data/config.json "cheer_db").
   Uses the plain REST API: an EventSource stream for live totals and a server-side increment for taps,
   so no Firebase SDK is needed. Shared by cheer.html and the TV race slide. */
(function () {
  const clean = db => String(db || "").replace(/\/+$/, "");

  // Live totals under a path ("cheers", or "tug/<round>"): calls onTotals({ "1": n, ... }) on every change.
  // Falls back to polling if streaming fails.
  function watchPath(db, path, onTotals) {
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
      const get = () => fetch(`${db}/${path}.json`, { cache: "no-store" }).then(r => r.json()).then(d => { totals = d || {}; emit() }).catch(() => {});
      get(); poll = setInterval(get, 5000);
    };
    try {
      es = new EventSource(`${db}/${path}.json`);
      es.addEventListener("put", apply);
      es.addEventListener("patch", e => { try { const { data } = JSON.parse(e.data); Object.assign(totals, data); emit() } catch (_) {} });
      es.onerror = () => { if (es.readyState === 2) { es = null; startPoll() } };
    } catch (_) { startPoll() }
    return () => { stopped = true; if (es) es.close(); if (poll) clearInterval(poll) };
  }

  const watch = (db, onTotals) => watchPath(db, "cheers", onTotals);

  // Add n to a counter ("cheers/<team>" or "tug/<round>/<team>"). Resolves true on success.
  function addPath(db, path, n, keepalive) {
    db = clean(db);
    return fetch(`${db}/${path}.json`, {
      method: "PUT", keepalive: !!keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ".sv": { increment: n } }),
    }).then(r => r.ok).catch(() => false);
  }
  const add = (db, team, n, keepalive) => addPath(db, `cheers/${team}`, n, keepalive);

  // Cheer Rush windows (data/config.json "cheer_rush": [{ "start": "13:15", "end": "13:20", "date": optional "YYYY-MM-DD" }]),
  // in the device's local time. Returns { active, endsIn } during a rush, { active: false, startsIn } in the 10 minutes before one, else null.
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function rush(list, now) {
    now = now || new Date(); let soon = null;
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || !r.start || !r.end || (r.date && r.date !== ymd(now))) continue;
      const at = hm => { const [h, m] = String(hm).split(":").map(Number); const d = new Date(now); d.setHours(h, m || 0, 0, 0); return d };
      const s = at(r.start), e = at(r.end);
      if (now >= s && now < e) return { active: true, endsIn: e - now };
      if (now < s && s - now <= 10 * 60000 && (!soon || s - now < soon.startsIn)) soon = { active: false, startsIn: s - now };
    }
    return soon;
  }
  /* Tug of war (data/config.json "tug_of_war": [{ "start": "13:20", "end": "13:23", "pairs": [[2, 3], [4, 6], [1, 5]] }]).
     Every team pulls at once, in pairs. Returns { active, endsIn, key, pairs } during a pull, { done, since, key, pairs } for a minute
     after it ends (the result), { soon, startsIn, key, pairs } in the 10 minutes before, else null. The key names the round in the database. */
  const PAIRS = [[1, 2], [3, 4], [5, 6]];
  function tug(list, now) {
    now = now || new Date(); let active = null, done = null, soon = null;
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || !r.start || !r.end || (r.date && r.date !== ymd(now))) continue;
      const at = hm => { const [h, m] = String(hm).split(":").map(Number); const d = new Date(now); d.setHours(h, m || 0, 0, 0); return d };
      const s = at(r.start), e = at(r.end);
      const pairs = (Array.isArray(r.pairs) && r.pairs.length ? r.pairs : PAIRS).filter(p => Array.isArray(p) && p.length === 2).map(p => p.map(Number));
      const base = { key: `${ymd(now).replace(/-/g, "")}-${String(r.start).replace(":", "").padStart(4, "0")}`, pairs };
      if (now >= s && now < e) active = Object.assign({ active: true, endsIn: e - now }, base);
      else if (now >= e && now - e < 60000) done = Object.assign({ active: false, done: true, since: now - e }, base);
      else if (now < s && s - now <= 10 * 60000 && (!soon || s - now < soon.startsIn)) soon = Object.assign({ active: false, soon: true, startsIn: s - now }, base);
    }
    return active || done || soon;
  }
  // Where the rope's centre sits for a pull of a against b: -1 (fully to a's side) to 1 (fully to b's side).
  const rope = (a, b) => { a = Number(a) || 0; b = Number(b) || 0; return Math.max(-1, Math.min(1, (b - a) / (a + b + 40))) };
  const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };

  window.TTCheer = { watch, watchPath, add, addPath, rush, tug, rope, clock };
})();
