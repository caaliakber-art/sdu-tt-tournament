/* Live feed from the scorecard as a Google Sheet (data/config.json "sheet_id").
   Reads the "Shuffled Matches" and "Finals" tabs straight from Google every refresh, with the same rules as
   scripts/update_scores.py, so the site no longer waits for an Excel upload. The sheet must be shared as
   "Anyone with the link: Viewer". Uses Google's visualization endpoint as JSONP, so no keys or sign-in are needed.
   Keep the Score column formatted as plain text in the sheet: a score such as 11-5 typed into a number column
   can turn into a date. */
(function () {
  const clean = v => v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  const teamNo = v => { const m = clean(v).match(/(\d+)/); return m ? Number(m[1]) : null };
  const num = v => { const n = Math.trunc(parseFloat(v)); return Number.isFinite(n) ? n : null };
  const slot = v => { const t = clean(v).toLowerCase(); return t.startsWith("lunch") ? "L" : t.startsWith("post") ? "P" : (clean(v) || "?") };
  const EVENT_KEYS = { "women's singles": ["WS", "Women's Singles"], "women's doubles": ["WD", "Women's Doubles"], "mixed doubles": ["XD", "Mixed Doubles"],
    "men's singles 1": ["MS1", "Men's Singles 1"], "men's singles 2": ["MS2", "Men's Singles 2"], "men's doubles 1": ["MD1", "Men's Doubles 1"], "men's doubles 2": ["MD2", "Men's Doubles 2"] };
  const EVENT_ORDER = ["WS", "WD", "XD", "MS1", "MS2", "MD1", "MD2"];
  const KO_FAMILY = { "women's singles": ["WS"], "women's doubles": ["WD"], "mixed doubles": ["XD"], "men's singles": ["MS1", "MS2"], "men's doubles": ["MD1", "MD2"] };
  const eventOf = v => EVENT_KEYS[clean(v).toLowerCase().replace(/’/g, "'")] || [(clean(v).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "EV"), clean(v)];
  const fixNames = (entry, fixes) => !entry || !fixes ? entry : entry.split(/\s*\+\s*/).map(p => fixes[p] || p).join(" + ");

  // One tab as { labels, rows } via JSONP. `range` starts at the tab's header row, so the header becomes the labels.
  let seq = 0;
  function tab(id, sheet, range) {
    return new Promise((resolve, reject) => {
      const cb = `__ttSheet${Date.now()}_${seq++}`, el = document.createElement("script");
      const done = (fn, x) => { clearTimeout(timer); delete window[cb]; el.remove(); fn(x) };
      const timer = setTimeout(() => done(reject, new Error("Sheet timed out")), 12000);
      window[cb] = resp => {
        if (!resp || resp.status === "error" || !resp.table) return done(reject, new Error((resp && resp.errors && resp.errors[0] && resp.errors[0].detailed_message) || "Sheet error"));
        const t = resp.table;
        const val = c => {
          if (!c) return null;
          // A score typed as 21-5 may have been turned into a date (21 May); read it back as day-month.
          if (typeof c.v === "string" && /^Date\(\d+,\d+,\d+/.test(c.v)) { const [, , mo, d] = c.v.match(/Date\((\d+),(\d+),(\d+)/); return `${Number(d)}-${Number(mo) + 1}` }
          return c.v;
        };
        done(resolve, { labels: t.cols.map(c => clean(c.label).toLowerCase()), rows: (t.rows || []).map(r => (r.c || []).map(val)) });
      };
      el.onerror = () => done(reject, new Error("Sheet not reachable. Is it shared as Anyone with the link?"));
      el.src = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=1&sheet=${encodeURIComponent(sheet)}&range=${encodeURIComponent(range)}&t=${Date.now()}`;
      document.head.appendChild(el);
    });
  }
  // Column index by header name; n picks the nth column with that name (Finals repeats several headers).
  const finder = labels => (name, n = 1) => { let k = 0; for (let i = 0; i < labels.length; i++) if (labels[i] === name || labels[i].startsWith(name)) { if (++k === n) return i } return -1 };

  function matches(t, fixes) {
    const col = finder(t.labels), at = (row, i) => i >= 0 ? row[i] : null;
    const cDay = col("day"), cTime = col("timing"), cT1 = col("team 1"), cT2 = col("team 2"), cFmt = col("format"),
      cP1 = col("participant 1"), cP2 = col("participant 2"), cScore = col("score");
    if (cDay < 0 || cFmt < 0) throw new Error("Shuffled Matches: header row not found");
    const events = {}, roster = {}, list = [], results = {};
    let mid = 0;
    for (const row of t.rows) {
      if (!clean(at(row, cDay)).toLowerCase().startsWith("day")) continue;
      mid++;
      const [key, name] = eventOf(at(row, cFmt)); events[key] = name;
      const a = teamNo(at(row, cT1)), b = teamNo(at(row, cT2));
      const p1 = fixNames(clean(at(row, cP1)), fixes), p2 = fixNames(clean(at(row, cP2)), fixes);
      roster[key] = roster[key] || {};
      if (!roster[key][a]) roster[key][a] = p1; if (!roster[key][b]) roster[key][b] = p2;
      list.push({ id: mid, day: teamNo(at(row, cDay)), slot: slot(at(row, cTime)), a, b, f: key });
      const m = clean(at(row, cScore)).match(/^(\d+)\s*[-–:]\s*(\d+)$/);
      if (m && m[1] !== m[2]) results[mid] = [Number(m[1]), Number(m[2])];
    }
    const order = EVENT_ORDER.filter(k => events[k]).concat(Object.keys(events).filter(k => !EVENT_ORDER.includes(k)).sort());
    const sortedRoster = {}; order.forEach(k => { sortedRoster[k] = {}; Object.keys(roster[k]).map(Number).sort((x, y) => x - y).forEach(t => sortedRoster[k][t] = roster[k][t]) });
    return { fixtures: { events: order.map(k => ({ k, n: events[k] })), roster: sortedRoster, matches: list }, results };
  }

  function finals(t, fixes) {
    const col = finder(t.labels), at = (row, i) => i >= 0 ? row[i] : null;
    if (col("format") < 0 || col("round") < 0) throw new Error("Finals: header row not found");
    const ties = [];
    for (const row of t.rows) {
      const fmt = clean(at(row, col("format"))), rnd = clean(at(row, col("round")));
      if (!fmt || !rnd) continue;
      const fam = KO_FAMILY[fmt.toLowerCase().replace(/’/g, "'")]; if (!fam) continue;
      const sets = [];
      for (const n of [1, 2, 3]) {
        const a = num(at(row, col(`match/set ${n}`, 1))), b = num(at(row, col(`match/set ${n}`, 2)));
        if (a != null && b != null && (a || b)) sets.push([a, b]);
      }
      const c1 = fixNames(clean(at(row, col("competitor 1"))), fixes), c2 = fixNames(clean(at(row, col("competitor 2"))), fixes);
      const winner = fixNames(clean(at(row, col("winner"))), fixes);
      ties.push({ format: fmt, events: fam, round: rnd,
        seed1: clean(at(row, col("seed 1"))), c1, t1: teamNo(at(row, col("team 1"))),
        seed2: clean(at(row, col("seed 2"))), c2, t2: teamNo(at(row, col("team 2"))),
        sets, w1: num(at(row, col("wins", 1))), w2: num(at(row, col("wins", 2))),
        winner: winner && winner === c1 ? 1 : winner && winner === c2 ? 2 : null });
    }
    return { ties };
  }

  // layout: { matches: { sheet, range }, finals: { sheet, range } } from data/config.json "sheet_layout".
  async function load(id, fixes, layout) {
    const L = Object.assign({ matches: { sheet: "Shuffled Matches", range: "B2:P" }, finals: { sheet: "Finals", range: "A4:T" } }, layout || {});
    const [m, f] = await Promise.all([tab(id, L.matches.sheet, L.matches.range), tab(id, L.finals.sheet, L.finals.range)]);
    const out = matches(m, fixes || {});
    out.knockout = finals(f, fixes || {});
    return out;
  }

  window.TTSheet = { load, _parse: { matches, finals } };
})();
