/* Fan cheers, stored as six numbers in a Firebase Realtime Database (data/config.json "cheer_db").
   Uses the plain REST API: an EventSource stream for live totals and a server-side increment for taps,
   so no Firebase SDK is needed. Shared by cheer.html and the TV race slide. */
(function () {
  const clean = db => String(db || "").replace(/\/+$/, "");
  // Demo: add ?tugdemo to the address to see a practice tug of war at any time. Nothing is written to the database.
  const DEMO = /[?&]tugdemo\b/.test(location.search);
  // Test: add ?tugtest to try a real pull with real phones. Pulls run on the live database every 3 minutes under separate
  // test rounds (key ending -9xxx), only for people who open the test link. Taps don't add to the real cheer totals.
  const TEST = !DEMO && /[?&]tugtest\b/.test(location.search);
  const sim = {}, simSubs = [], DEMO_T0 = Date.now();
  if (DEMO) setInterval(() => {
    [1, 2, 3, 4, 5, 6].forEach(t => { sim[t] = (sim[t] || 0) + Math.floor(Math.random() * (t === 2 || t === 4 ? 6 : 4)) });
    simSubs.forEach(f => f(Object.assign({}, sim)));
  }, 700);

  // Live totals under a path ("cheers", or "tug/<round>"): calls onTotals({ "1": n, ... }) on every change.
  // Falls back to polling if streaming fails.
  function watchPath(db, path, onTotals) {
    if (DEMO && path.startsWith("tug/")) { Object.keys(sim).forEach(k => delete sim[k]); simSubs.length = 0; simSubs.push(onTotals); return () => { simSubs.length = 0 } }
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
    if (DEMO) { const m = path.match(/^tug\/[^/]+\/(\d)$/); if (m) sim[m[1]] = (sim[m[1]] || 0) + n; api.lastStatus = 200; return Promise.resolve(true) }
    if (TEST && !path.startsWith("tug/")) { api.lastStatus = 200; return Promise.resolve(true) }
    db = clean(db);
    return fetch(`${db}/${path}.json`, {
      method: "PUT", keepalive: !!keepalive,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ".sv": { increment: n } }),
    }).then(r => { api.lastStatus = r.status; return r.ok }).catch(() => { api.lastStatus = 0; return false });
  }

  // Cheers that could not be sent (no signal, or the database refused them) are kept on this device and sent later,
  // so a Smash score is never lost. Capped so a device can't hoard a huge burst.
  const OWED = "tt_cheer_owed", OWED_MAX = 1000;
  const owedGet = () => { try { return JSON.parse(localStorage.getItem(OWED) || "{}") || {} } catch (_) { return {} } };
  const owedSet = o => { try { localStorage.setItem(OWED, JSON.stringify(o)) } catch (_) {} };
  function owe(team, n) { const o = owedGet(); o[team] = Math.min(OWED_MAX, (Number(o[team]) || 0) + n); owedSet(o) }
  let settling = false;
  async function settle(db) {                                    // resolves the number of owed cheers delivered
    if (settling || DEMO || TEST || !clean(db)) return 0; settling = true; let done = 0;
    try {
      for (const t of Object.keys(owedGet())) {
        while ((Number(owedGet()[t]) || 0) > 0) {
          const n = Math.min(25, Number(owedGet()[t]));
          if (!(await add(db, t, n))) return done;
          const o = owedGet(); o[t] = Math.max(0, (Number(o[t]) || 0) - n); if (!o[t]) delete o[t]; owedSet(o); done += n;
        }
      }
    } finally { settling = false }
    return done;
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
     after it ends (the result), { soon, startsIn, at, key, pairs } in the 10 minutes before, { upcoming, startsIn, at, ... } for a later
     pull today, else null. The key names the round in the database. */
  const PAIRS = [[1, 2], [3, 4], [5, 6]];
  const ampm = hm => { const [h, m] = String(hm).split(":").map(Number); return `${(h % 12) || 12}:${String(m || 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` };
  const until = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}` };
  function tug(list, now) {
    now = now || new Date();
    if (DEMO) {                                                   // 2.5-minute pull, 30 seconds of result, repeat
      const c = Math.floor((now - DEMO_T0) / 180000), at = (now - DEMO_T0) % 180000, base = { key: `demo-${c}`, pairs: [[2, 3], [4, 6], [1, 5]] };
      return at < 150000 ? Object.assign({ active: true, endsIn: 150000 - at }, base) : Object.assign({ active: false, done: true, since: at - 150000 }, base);
    }
    if (TEST) {                                                   // same clock for every device: 2.5-minute pull, 30 seconds of result
      const c = Math.floor(now / 180000), at = now % 180000;
      const base = { key: `${ymd(now).replace(/-/g, "")}-9${String(c % 1000).padStart(3, "0")}`, pairs: [[2, 3], [4, 6], [1, 5]] };
      return at < 150000 ? Object.assign({ active: true, endsIn: 150000 - at }, base) : Object.assign({ active: false, done: true, since: at - 150000 }, base);
    }
    let active = null, done = null, soon = null, next = null;
    for (const r of Array.isArray(list) ? list : []) {
      if (!r || !r.start || !r.end || (r.date && r.date !== ymd(now))) continue;
      const at = hm => { const [h, m] = String(hm).split(":").map(Number); const d = new Date(now); d.setHours(h, m || 0, 0, 0); return d };
      const s = at(r.start), e = at(r.end);
      const pairs = (Array.isArray(r.pairs) && r.pairs.length ? r.pairs : PAIRS).filter(p => Array.isArray(p) && p.length === 2).map(p => p.map(Number));
      const base = { key: `${ymd(now).replace(/-/g, "")}-${String(r.start).replace(":", "").padStart(4, "0")}`, pairs };
      if (now >= s && now < e) active = Object.assign({ active: true, endsIn: e - now }, base);
      else if (now >= e && now - e < 60000) done = Object.assign({ active: false, done: true, since: now - e }, base);
      else if (now < s && s - now <= 10 * 60000 && (!soon || s - now < soon.startsIn)) soon = Object.assign({ active: false, soon: true, startsIn: s - now, at: ampm(r.start) }, base);
      else if (now < s && (!next || s - now < next.startsIn)) next = Object.assign({ active: false, upcoming: true, startsIn: s - now, at: ampm(r.start) }, base);
    }
    return active || done || soon || next;                        // next: a later pull today, announced all day ahead
  }
  // Where the rope's centre sits for a pull of a against b: -1 (fully to a's side) to 1 (fully to b's side).
  const rope = (a, b) => { a = Number(a) || 0; b = Number(b) || 0; return Math.max(-1, Math.min(1, (b - a) / (a + b + 40))) };
  // In a copy that can't reach the cheer database (the Claude preview), point people to the live site instead.
  // Returns the live address of `page`, or "" when this already is the live site (or a local test or offline copy).
  function liveUrl(cfg, page) {
    const pub = String((cfg && cfg.public_url) || "").trim();
    if (!pub || !/^https?:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return "";
    try { const u = new URL(page, pub); return u.hostname === location.hostname ? "" : u.href } catch (_) { return "" }
  }
  function liveBanner(cfg, page, where) {
    const url = liveUrl(cfg, page); if (!url || !where) return "";
    const a = document.createElement("a"); a.className = "livebanner"; a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.innerHTML = "<b>This is a preview copy</b><span>Cheers only count on the live page. Tap here to open it.</span>";
    where.prepend(a); return url;
  }
  const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };

  const api = window.TTCheer = { watch, watchPath, add, addPath, rush, tug, rope, clock, owe, settle, owed: owedGet, lastStatus: null, demo: DEMO, test: TEST, until, liveUrl, liveBanner };
})();
