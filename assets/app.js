/* SDU TT Tournament site. Reads data/fixtures.json, data/results.json, data/knockout.json and data/config.json.
   Ranking follows the coordinator's scorecard: 2 points per win; ties split on point difference, then team number.
   Scores refresh automatically; the page never needs a reload during the tournament. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k) } catch (_) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (_) {} } };

  let FX = null, RES = { results: {} }, CFG = {}, R = {};
  const fresh = new Map();               // match id -> time it arrived; highlighted for 3 minutes
  const isFresh = id => { const t = fresh.get(String(id)); return t && Date.now() - t < 180000 };
  let EVENTS = [], ROSTER = {}, MATCHES = [], KO = [];
  const TEAMS = [1, 2, 3, 4, 5, 6];
  let curEv = store.get("tt_ev") || "MD1", feedMode = "res", tvIdx = 0, tvTimer = null, lastUpdated = null;

  const teamName = t => (CFG.team_names && CFG.team_names[t]) || `Team ${t}`;
  const chip = t => `<span class="tchip" style="--tc:var(--t${t})"><i></i>${esc(teamName(t))}</span>`;
  const captain = t => (CFG.captains && CFG.captains[t]) || "";
  // One treatment wherever a TEAM is the subject: swatch, team name prominent, captain beneath.
  const capTxt = t => captain(t) ? `Captain ${esc(captain(t))}` : `<span class="tbc">Captain to be confirmed</span>`;
  const teamBlock = (t, size = "", noTbc = false) => `<span class="team ${size}" style="--tc:var(--t${t})"><i class="tsw"></i><span class="tw"><span class="tname">${esc(teamName(t))}</span>${noTbc && !captain(t) ? "" : `<span class="tcap">${capTxt(t)}</span>`}</span></span>`;
  const teamInline = t => `<b>${esc(teamName(t))}</b> · ${captain(t) ? `Captain ${esc(captain(t))}` : "Captain to be confirmed"}`;
  const nm = (f, t) => (ROSTER[f] && ROSTER[f][t]) || `Team ${t}`;
  const evName = k => (EVENTS.find(e => e.k === k) || { n: k }).n;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dayTxt(d) {
    const iso = CFG.day_dates && CFG.day_dates[d];
    if (!iso) return `Day ${d}`;
    const dt = new Date(iso + "T00:00:00");
    return isNaN(dt) ? `Day ${d}` : `Day ${d}, ${DOW[dt.getDay()]} ${dt.getDate()} ${MON[dt.getMonth()]}`;
  }
  const slotTxt = m => `${dayTxt(m.day)} · ${m.slot === "L" ? "Lunch" : m.slot === "P" ? "Post office hours" : esc(m.slot)}`;

  /* ---------- standings logic ---------- */
  function table(f) {
    const rows = TEAMS.map(t => ({ t, p: 0, w: 0, l: 0, pf: 0, pa: 0 }));
    for (const m of MATCHES) {
      if (m.f !== f) continue; const r = R[m.id]; if (!r) continue;
      const A = rows[m.a - 1], B = rows[m.b - 1];
      A.p++; B.p++; A.pf += r[0]; A.pa += r[1]; B.pf += r[1]; B.pa += r[0];
      if (r[0] > r[1]) { A.w++; B.l++ } else { B.w++; A.l++ }
    }
    rows.forEach(r => { r.d = r.pf - r.pa; r.pts = 2 * r.w });
    return rows.sort((x, y) => y.w - x.w || y.d - x.d || x.t - y.t);
  }
  // Q = top 4 in every possible outcome of the remaining matches; E = cannot reach top 4.
  // Ties on wins are split on point difference, then team number. Difference can move either way
  // while a player still has matches, so a tie counts as settled only when both have finished.
  const groupDone = f => MATCHES.every(m => m.f !== f || R[m.id]);
  function status(f) {
    const base = {}, d = {}, left = {}; TEAMS.forEach(t => { base[t] = 0; d[t] = 0; left[t] = 0 });
    const rem = [];
    for (const m of MATCHES) {
      if (m.f !== f) continue; const r = R[m.id];
      if (r) { base[r[0] > r[1] ? m.a : m.b]++; d[m.a] += r[0] - r[1]; d[m.b] += r[1] - r[0] } else { rem.push(m); left[m.a]++; left[m.b]++ }
    }
    const beats = (o, t) => d[o] > d[t] || (d[o] === d[t] && o < t);   // o ranks above t on the tiebreak
    const thru = {}, out = {}; TEAMS.forEach(t => { thru[t] = true; out[t] = true });
    if (rem.length > 16) { TEAMS.forEach(t => { thru[t] = false; out[t] = false }) }
    else for (let mask = 0; mask < (1 << rem.length); mask++) {
      const w = { ...base };
      for (let i = 0; i < rem.length; i++) w[(mask >> i) & 1 ? rem[i].a : rem[i].b]++;
      for (const t of TEAMS) {
        let maybeAhead = 0, surelyAhead = 0;
        for (const o of TEAMS) {
          if (o === t) continue;
          if (w[o] > w[t]) { maybeAhead++; surelyAhead++; continue }
          if (w[o] < w[t]) continue;
          const settled = left[o] === 0 && left[t] === 0;
          if (!settled || beats(o, t)) maybeAhead++;
          if (settled && beats(o, t)) surelyAhead++;
        }
        if (maybeAhead > 3) thru[t] = false;
        if (surelyAhead < 4) out[t] = false;
      }
    }
    const s = {}; TEAMS.forEach(t => s[t] = thru[t] ? "in" : out[t] ? "out" : ""); return s;
  }
  const qBadge = s => s === "in" ? '<span class="q in" title="Qualified">Q</span>' : s === "out" ? '<span class="q out" title="Eliminated">E</span>' : "";
  const pairLine = (m, r) => {
    const aw = r && r[0] > r[1], bw = r && r[1] > r[0];
    return `<span class="${aw ? "won" : ""}">${esc(nm(m.f, m.a))}</span><span class="sc ${r ? "" : "pend"}">${r ? `${r[0]}-${r[1]}` : "v"}</span><span class="r ${bw ? "won" : ""}">${esc(nm(m.f, m.b))}</span>`;
  };

  /* ---------- HOME ---------- */
  function renderHeader() {
    const played = Object.keys(R).length;
    const koDone = KO.filter(k => k.winner).length;
    $("progTxt").textContent = koDone ? `Knockouts under way · league ${played} of ${MATCHES.length} played` : `League stage · ${played} of ${MATCHES.length} matches played`;
    $("progBar").style.width = (MATCHES.length ? played / MATCHES.length * 100 : 0) + "%";
    if (RES.updated) {
      const d = new Date(RES.updated);
      $("liveTxt").textContent = (window.TT_OFFLINE ? "Offline copy · " : RES.live ? "Live · " : "") + (isNaN(d) ? "Live" : `Updated ${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    }
  }
  // Best Team scoring, as in the scorecard: 1 per league win, 1 per set won in a quarterfinal or semifinal,
  // 5 for an event title, 3 for runner-up (final sets earn nothing extra).
  function teamScores() {
    const s = {}; TEAMS.forEach(t => s[t] = { t, lw: 0, ko: 0, bonus: 0, d: 0 });
    for (const m of MATCHES) { const r = R[m.id]; if (!r) continue; s[r[0] > r[1] ? m.a : m.b].lw++; s[m.a].d += r[0] - r[1]; s[m.b].d += r[1] - r[0] }
    for (const k of KO) {
      if (/^final/i.test(k.round)) {
        if (!k.winner) continue;
        const wt = k.winner === 1 ? k.t1 : k.t2, lt = k.winner === 1 ? k.t2 : k.t1;
        if (s[wt]) s[wt].bonus += 5; if (s[lt]) s[lt].bonus += 3;
      } else (k.sets || []).forEach(p => { const t = p[0] > p[1] ? k.t1 : p[1] > p[0] ? k.t2 : null; if (s[t]) s[t].ko++ });   // every QF/SF set won counts, for both sides
    }
    Object.values(s).forEach(r => r.pts = r.lw + r.ko + r.bonus);
    return Object.values(s).sort((a, b) => b.pts - a.pts || a.t - b.t);
  }
  // Rank movement: compare with the ranks from the previous data update (kept per browser).
  function rankMoves(ranks) {
    let snap = null; try { snap = JSON.parse(store.get("tt_ranks") || "null") } catch (_) {}
    if (snap && snap.updated === RES.updated) return snap.moves || {};
    const moves = {}; if (snap && snap.ranks) TEAMS.forEach(t => { if (snap.ranks[t]) moves[t] = snap.ranks[t] - ranks[t] });
    store.set("tt_ranks", JSON.stringify({ updated: RES.updated, ranks, moves })); return moves;
  }
  /* Race for Best Team: each captain runs in their team's lane; distance = team points (leader near the finish). */
  const ordTxt = n => n + ({ 1: "st", 2: "nd", 3: "rd" }[n] || "th");
  function renderRace(order, ranks) {
    const box = $("race"); if (!box) return;
    const top = Math.max(1, ...order.map(r => r.pts)), pos = v => (v / top * 0.9).toFixed(4);
    if (box.dataset.n !== String(TEAMS.length)) {
      box.dataset.n = TEAMS.length;
      box.innerHTML = TEAMS.map(t => `<div class="lane" data-t="${t}" style="--tc:var(--t${t});--tcf:${t === 1 ? "#fff" : "#0F1E2C"}"><div class="lane-id">${teamBlock(t, "", true)}<span class="lpts"></span><span class="lfans"><i><b></b></i><em></em></span></div><div class="track"><div class="runner" style="--p:0"><span class="rtag"></span>${art(t, "run") ? `<img src="${esc(art(t, "run"))}" alt="${esc(captain(t) || teamName(t))}">` : `<i class="rdot">${t}</i>`}</div></div></div>`).join("")
        + `<div class="lane scale" aria-hidden="true"><div class="lane-id"></div><div class="track" id="raceScale"></div></div>`;
    }
    const step = top > 40 ? 20 : top > 15 ? 10 : 5;
    $("raceScale").innerHTML = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step).map(v => `<span style="--p:${pos(v)}">${v}</span>`).join("");
    const rankCount = {}; order.forEach(r => rankCount[ranks[r.t]] = (rankCount[ranks[r.t]] || 0) + 1);
    order.forEach(r => {
      const lane = box.querySelector(`.lane[data-t="${r.t}"]`); if (!lane) return;
      const run = lane.querySelector(".runner"), rk = ranks[r.t], p = pos(r.pts);
      lane.classList.toggle("lead", rk === 1);
      run.dataset.p = p; run.classList.toggle("back", p > 0.28);
      lane.querySelector(".lpts").innerHTML = `<b>${r.pts}</b> · ${rankCount[rk] > 1 ? "=" : ""}${ordTxt(rk)}`;
      run.querySelector(".rtag").innerHTML = `<b>${r.pts}</b> pts · ${rankCount[rk] > 1 ? "=" : ""}${ordTxt(rk)}${rk === 1 ? " · Leader" : ""}`;
    });
    requestAnimationFrame(() => box.querySelectorAll(".runner").forEach(el => el.style.setProperty("--p", el.dataset.p || 0)));
    renderFans();
  }

  /* Fan cheers (data/config.json "cheer_db"): the office taps on cheer.html, the TV race shows each lane's
     fan meter live and bursts from the captain as cheers land. Off in the offline copy. */
  let CHEERS = null, cheerOn = false;
  const scripts = {};
  const loadScript = src => scripts[src] || (scripts[src] = new Promise((ok, no) => { const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = no; document.head.appendChild(el) }));
  // The QR always points at the public site (config "public_url"), so it also works from the offline copy and the preview.
  const cheerUrl = () => { const pub = String(CFG.public_url || "").trim(), q = /[?&]tugtest\b/.test(location.search) ? "?tugtest" : "";   // a test TV sends phones to the test pull
    try { return pub ? new URL("cheer.html" + q, pub).href : /^https?:/.test(location.protocol) ? new URL("cheer.html" + q, location.href).href : "" } catch (_) { return "" } };
  let qrOn = false;
  // In the Claude preview the cheer database can't be reached, so cheer and Smash links open the live site in a new tab.
  function liveLinks() {
    const pub = String(CFG.public_url || "").trim();
    if (liveLinks.done || !pub || !/^https?:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    let host = ""; try { host = new URL(pub).hostname } catch (_) { return }
    if (host === location.hostname) return; liveLinks.done = true;
    document.querySelectorAll('a[href="cheer.html"], a[href="game.html"]').forEach(a => { a.href = new URL(a.getAttribute("href"), pub).href; a.target = "_blank"; a.rel = "noopener" });
  }
  function startQr() {
    const url = cheerUrl(); if (qrOn || !url) return; qrOn = true;
    const make = () => { try {
      const q = window.qrcode(0, "M"); q.addData(url); q.make(); $("qrDockSvg").innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
      const d = $("qrDock"); d.href = url; d.hidden = false; document.documentElement.classList.add("qr-on");
    } catch (_) { qrOn = false } };
    window.qrcode ? make() : loadScript("assets/qrcode.js").then(make).catch(() => { qrOn = false });
  }
  // Draw the eye to the QR now and then: on the race slide and after each celebration.
  function pulseQr() { const d = $("qrDock"); if (!d || d.hidden) return; d.classList.remove("pulse"); void d.offsetWidth; d.classList.add("pulse") }
  function startCheers() {
    const db = String(CFG.cheer_db || "").trim();
    if (cheerOn || !db || window.TT_OFFLINE) return;
    cheerOn = true; $("race").classList.add("cheers-on"); $("cheerLink").hidden = false;
    if (isTv()) requestAnimationFrame(fitSlide);
    loadScript("assets/cheerdb.js").then(() => { window.TTCheer.watch(db, onCheers); tickRush(); tickTug(); setInterval(() => { tickRush(); tickTug() }, 1000); refreshTugAll(); setInterval(refreshTugAll, 60000) }).catch(() => {});
  }
  function onCheers(d) {
    const prev = CHEERS; CHEERS = d || {};
    renderFans();
    if (!prev) return;
    TEAMS.forEach(t => { const diff = (Number(CHEERS[t]) || 0) - (Number(prev[t]) || 0); if (diff > 0) cheerBurst(t, diff) });
    cheerAlerts(prev, CHEERS);
  }

  /* Cheer Rush (data/config.json "cheer_rush"): a banner counts down to it; while it runs, phones count every cheer double
     and the TV jumps to the race and holds it until the rush ends. */
  let RUSH = null;
  function tickRush() {
    if (!cheerOn || !window.TTCheer) return;
    const was = !!(RUSH && RUSH.active); RUSH = window.TTCheer.rush(CFG.cheer_rush);
    const bar = $("rushBar"), on = !!(RUSH && RUSH.active);
    if (!RUSH) bar.hidden = true;
    else {
      bar.hidden = false; bar.classList.toggle("on", on);
      bar.innerHTML = on ? `<b>Cheer Rush!</b><span>Every cheer counts double</span><i>${window.TTCheer.clock(RUSH.endsIn)}</i>`
        : `<b>Cheer Rush</b><span>starts in</span><i>${window.TTCheer.clock(RUSH.startsIn)}</i><span>Get your phones ready</span>`;
    }
    document.documentElement.classList.toggle("rushing", on);
    if (on && !was && isTv() && !celBusy) { const i = slides().findIndex(x => x.k === "race"); if (i >= 0) { if (tvSlide !== i) showSlide(i); tvRestart() } }
  }

  /* Tug of war (data/config.json "tug_of_war"): all six teams pull at once, in pairs, for a few minutes. Taps on cheer.html
     pull the rope (and count as cheers too). The TV jumps to the ropes, holds them for the pull and shows the result. */
  let TUG = null, tugKey = "", tugStop = null, TUGT = {};
  function tickTug() {
    if (!cheerOn || !window.TTCheer) return;
    const st = window.TTCheer.tug(CFG.tug_of_war), key = st ? st.key : "", was = !!(TUG && TUG.active);
    TUG = st;
    if (TUG && TUG.done && !tickTug.wasDone) setTimeout(refreshTugAll, 4000);                  // score the pull that just ended
    tickTug.wasDone = !!(TUG && TUG.done);
    if (key !== tugKey) {
      if (tugStop) tugStop(); tugStop = null; TUGT = {}; tugKey = key;
      if (key) tugStop = window.TTCheer.watchPath(String(CFG.cheer_db).trim(), `tug/${key}`, d => { TUGT = d || {}; if (document.documentElement.dataset.slide === "tug") renderTugTv() });
    }
    if (!RUSH && TUG && (TUG.soon || TUG.upcoming)) {               // notice all day in the top bar, countdown in the last 10 minutes
      const bar = $("rushBar"); bar.hidden = false; bar.classList.remove("on"); bar.classList.toggle("soon", !!TUG.soon);
      bar.innerHTML = TUG.soon ? `<b>Tug of war</b><span>starts in</span><i>${window.TTCheer.clock(TUG.startsIn)}</i><span>Scan the QR code to join your team</span>`
        : `<b>Tug of war</b><span>today at</span><i>${TUG.at}</i><span>Every team pulls · be ready on the cheer page</span>`;
    } else if (!RUSH) $("rushBar").classList.remove("soon");
    if (TUG && TUG.soon && isTv()) {                                  // pop-ups on the TV at 10, 5 and 1 minute to go
      const prev = tickTug.prev && tickTug.prev.key === TUG.key ? tickTug.prev.ms : null;
      const mins = prev == null ? null : [10, 5, 1].find(m => prev > m * 60000 && TUG.startsIn <= m * 60000);
      tickTug.prev = { key: TUG.key, ms: TUG.startsIn };
      if (mins) {
        alertQ.push({ title: mins === 1 ? "Tug of war in 1 minute!" : `Tug of war in ${mins} minutes!`, sub: `${TUG.pairs.map(p => p.map(t => teamName(t)).join(" v ")).join(" · ")} · scan the QR code to pull for your team` });
        if (!alertBusy) nextAlert();
      }
    }
    const strip = !$("rushBar").hidden, root = document.documentElement;   // TV: the bar gets its own strip above the header
    if (root.classList.contains("noticebar") !== strip) { root.classList.toggle("noticebar", strip); if (isTv()) requestAnimationFrame(fitSlide) }
    if (!isTv()) return;
    const onTug = document.documentElement.dataset.slide === "tug";
    if (TUG && TUG.active && !was && !celBusy) { const i = slides().findIndex(x => x.k === "tug"); if (i >= 0) { showSlide(i); tvRestart() } }
    else if (onTug) { if (TUG) renderTugTv(); else tvTick() }
  }
  /* Tug of war table: every finished pull, on the home page, its own TV slide and the cheer page. */
  let TUGALL = null;
  async function refreshTugAll() {
    if (!cheerOn || !window.TTCheer) return;
    const d = await window.TTCheer.fetchTugAll(String(CFG.cheer_db).trim()); if (d == null) return;
    TUGALL = window.TTCheer.tugTable(d, CFG.tug_of_war); renderTugTable();
  }
  function renderTugTable() {
    const card = $("tugCard"), list = Array.isArray(CFG.tug_of_war) ? CFG.tug_of_war : [];
    if (!cheerOn || !list.length || !TUGALL) { card.hidden = true; return }
    card.hidden = false;
    const ap = hm => { const [h, m] = String(hm).split(":").map(Number); return `${(h % 12) || 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "AM" : "PM"}` };
    $("tugTblSub").textContent = `2 pts a win · 1 a draw · ${list.length > 1 ? `${list.length} pulls a day, ${ap(list[0].start)} to ${ap(list[list.length - 1].start)}` : `daily at ${ap(list[0].start)}`}`;
    $("tugNext").textContent = TUG && TUG.active ? "Pull on now!" : TUG && (TUG.soon || TUG.upcoming) ? `Next pull ${TUG.at}` : "";
    const played = TUGALL.rounds.length, rows = TUGALL.rows;
    const top = rows[0] && rows[0].pts > 0 ? rows[0].pts : -1;
    $("tugTbl").tBodies[0].innerHTML = !played ? `<tr><td class="l" colspan="7">No pulls yet. ${TUG && TUG.at ? `First pull at ${esc(TUG.at)}.` : ""} Scan the QR code and pull for your team.</td></tr>`
      : rows.map((r, i) => `<tr class="${r.pts === top ? "lead" : ""}"><td class="rk">${i + 1}</td><td class="l">${teamBlock(r.t)}${r.pts === top && i === 0 ? '<span class="leadtag">Top pullers</span>' : ""}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${fmtN(r.pulls)}</td><td class="big">${r.pts}</td></tr>`).join("");
    const last = TUGALL.rounds[played - 1];
    $("tugLastTitle").textContent = last ? `Latest pull · ${last.at}` : "Latest pull";
    $("tugLast").innerHTML = last ? last.res.map(x => `<li><span class="${x.w === x.a ? "won" : ""}">${esc(teamName(x.a))}</span><span class="sc">${fmtN(x.na)}-${fmtN(x.nb)}</span><span class="r ${x.w === x.b ? "won" : ""}">${esc(teamName(x.b))}</span></li>`).join("")
      : `<li class="muted">Results appear here after each pull.</li>`;
  }

  function renderTugTv() {
    if (!TUG) return;
    const n = t => Number(TUGT[t]) || 0;
    $("tugTitle").textContent = window.TTCheer.demo ? "Tug of war · practice" : window.TTCheer.test && TUG.active ? "Tug of war · test" : TUG.active ? "Tug of war!" : TUG.done ? "Tug of war · result" : "Tug of war";
    const pwr = CFG.smash_boost && (window.TTCheer.test || String(CFG.smash_boost.from || "00:00").padStart(5, "0") <= `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`);
    $("tugSub").textContent = TUG.active ? `Every team is pulling. Scan the QR code and tap for your team.${pwr ? ` Power Play: Smash points count x${Math.max(2, Number(CFG.smash_boost.multiplier) || 3)} and pull the rope.` : ""}` : TUG.done ? "Well pulled, everyone." : "";
    $("tugClock").textContent = TUG.active ? `${window.TTCheer.clock(TUG.endsIn)} left` : TUG.done ? "Final" : `in ${window.TTCheer.clock(TUG.startsIn)}`;
    $("tugClock").classList.toggle("on", !!TUG.active);
    // Build the rows once per pull, then only move the knots and counts, so the rope slides and the art doesn't flicker.
    const box = $("tugRows"), sig = TUG.key + JSON.stringify(TUG.pairs);
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      const side = (t, cls) => `<div class="tteam ${cls}" data-t="${t}" style="--tc:var(--t${t});--tcf:${t === 1 ? "#fff" : "#0F1E2C"}">
          ${art(t, "run") ? `<img src="${esc(art(t, "run"))}" alt="">` : ""}<span class="tname"><b>${esc(teamName(t))}</b>${captain(t) ? `<small>Captain ${esc(captain(t))}</small>` : ""}<em class="twin">Wins</em></span>
          <span class="tcount">0</span></div>`;
      box.innerHTML = TUG.pairs.map(([x, y]) => `<div class="trow" data-a="${x}" data-b="${y}" style="--ta:var(--t${x});--tb:var(--t${y})">${side(x, "a")}
          <div class="ttrack"><i class="tmid"></i><b class="tknot" style="left:50%"></b></div>${side(y, "b")}</div>`).join("");
    }
    box.querySelectorAll(".trow").forEach(row => {
      const x = Number(row.dataset.a), y = Number(row.dataset.b), a = n(x), b = n(y), done = !!TUG.done && a !== b;
      row.querySelector(".tteam.a .tcount").textContent = fmtN(a); row.querySelector(".tteam.b .tcount").textContent = fmtN(b);
      row.querySelector(".tteam.a").classList.toggle("won", done && a > b); row.querySelector(".tteam.b").classList.toggle("won", done && b > a);
      row.querySelector(".tknot").style.left = `${(50 + window.TTCheer.rope(a, b) * 44).toFixed(1)}%`;
    });
  }

  /* Alerts on the TV when a team's fans pass a milestone (100, 250, 500, 1,000 then every 1,000) or overtake another team. */
  const milestone = n => n >= 1000 ? Math.floor(n / 1000) * 1000 : [500, 250, 100].find(m => n >= m) || 0;
  const alertQ = []; let alertBusy = false, lastOvertake = 0;
  function cheerAlerts(prev, now) {
    if (!isTv()) return;
    const c = (o, t) => Number(o[t]) || 0;
    TEAMS.forEach(t => { const m = milestone(c(now, t)); if (m > milestone(c(prev, t))) alertQ.push({ t, title: `${teamName(t)} fans hit ${fmtN(m)} cheers!`, sub: captain(t) ? `Cheering for Captain ${captain(t)}` : "" }) });
    if (Date.now() - lastOvertake > 20000) {
      const passes = TEAMS.map(t => ({ t, over: TEAMS.filter(u => u !== t && c(prev, t) <= c(prev, u) && c(now, t) > c(now, u)) }))
        .filter(x => x.over.length && c(now, x.t) >= 50);
      if (passes.length) {
        const x = passes.sort((a, b) => c(now, b.t) - c(now, a.t))[0], u = x.over.sort((a, b) => c(now, b) - c(now, a))[0];
        const top = TEAMS.every(v => v === x.t || c(now, v) < c(now, x.t));
        alertQ.push({ t: x.t, title: top ? `${teamName(x.t)} fans take the lead!` : `${teamName(x.t)} fans overtake ${teamName(u)}!`, sub: `${fmtN(c(now, x.t))} cheers and counting` });
        lastOvertake = Date.now();
      }
    }
    if (!alertBusy) nextAlert();
  }
  function nextAlert() {
    const a = alertQ.shift(), box = $("cAlert"); if (!a) { alertBusy = false; box.hidden = true; return }
    alertBusy = true;
    box.style.setProperty("--tc", a.t ? `var(--t${a.t})` : "#F5C451");
    const img = box.querySelector("img"); if (a.t && art(a.t, "run")) { img.src = art(a.t, "run"); img.hidden = false } else img.hidden = true;
    box.querySelector("b").textContent = a.title; box.querySelector("em").textContent = a.sub;
    box.hidden = false; box.classList.remove("show"); void box.offsetWidth; box.classList.add("show");
    if (a.t) cheerBurst(a.t, 8);
    setTimeout(nextAlert, a.t ? 4600 : 7000);
  }
  const fmtN = n => Number(n || 0).toLocaleString("en-IN");
  function renderFans() {
    if (!cheerOn || !CHEERS) return;
    const top = Math.max(1, ...TEAMS.map(t => Number(CHEERS[t]) || 0));
    const loud = TEAMS.slice().sort((a, b) => (Number(CHEERS[b]) || 0) - (Number(CHEERS[a]) || 0))[0];
    TEAMS.forEach(t => {
      const lane = document.querySelector(`#race .lane[data-t="${t}"]`); if (!lane) return;
      const n = Number(CHEERS[t]) || 0;
      lane.querySelector(".lfans b").style.width = `${(n / top * 100).toFixed(1)}%`;
      lane.querySelector(".lfans em").textContent = `${fmtN(n)} cheer${n === 1 ? "" : "s"}${t === loud && n > 0 ? " · Loudest fans" : ""}`;
      lane.classList.toggle("loud", t === loud && n > 0);
    });
  }
  const CHEER_BITS = ["👏", "🔥", "🏓", "💪", "🎉"];
  function cheerBurst(t, n) {
    if (reduceMotion()) return;
    const lane = document.querySelector(`#race .lane[data-t="${t}"]`); if (!lane || !lane.offsetParent) return;
    const run = lane.querySelector(".runner"), track = lane.querySelector(".track");
    const x = run.offsetLeft + run.offsetWidth * .55, y = run.offsetTop + run.offsetHeight * .35;
    for (let i = 0; i < Math.min(n, 8); i++) setTimeout(() => {
      const s = document.createElement("span"); s.className = "cbit"; s.textContent = CHEER_BITS[(Math.random() * CHEER_BITS.length) | 0];
      s.style.left = `${x}px`; s.style.top = `${y}px`;
      s.style.setProperty("--dx", `${(Math.random() - .3) * 120}px`); s.style.setProperty("--dy", `${-60 - Math.random() * 70}px`);
      track.appendChild(s); setTimeout(() => s.remove(), 1300);
    }, i * 90);
    run.classList.remove("cheered"); void run.offsetWidth; run.classList.add("cheered");
  }
  // On the TV, the race restarts from the start line each time its slide comes round.
  function replayRace() {
    const runs = document.querySelectorAll("#race .runner"); if (!runs.length) return;
    runs.forEach(el => { el.style.transition = "none"; el.style.setProperty("--p", 0) });
    void document.body.offsetWidth;
    runs.forEach(el => el.style.transition = "");
    setTimeout(() => runs.forEach(el => el.style.setProperty("--p", el.dataset.p || 0)), 350);
  }
  function renderTop() {
    const order = teamScores();
    let rank = 0, prev = null; const ranks = {};
    order.forEach((r, i) => { if (r.pts !== prev) { rank = i + 1; prev = r.pts } ranks[r.t] = rank });
    const moves = rankMoves(ranks);
    const mv = t => moves[t] > 0 ? `<span class="mv up" title="Up ${moves[t]}">▲${moves[t]}</span>` : moves[t] < 0 ? `<span class="mv down" title="Down ${-moves[t]}">▼${-moves[t]}</span>` : "";
    $("teamTbl").tBodies[0].innerHTML = order.map(r => `<tr class="${ranks[r.t] === 1 ? "lead" : ""}"><td class="rk">${ranks[r.t]}${mv(r.t)}</td><td class="l">${teamBlock(r.t)}${ranks[r.t] === 1 ? '<span class="leadtag">Leader</span>' : ""}</td><td>${r.lw}</td><td>${r.ko}</td><td>${r.bonus}</td><td class="big">${r.pts}</td></tr>`).join("");
    renderRace(order, ranks);
    if (feedMode === "res") {
      $("rTitle").textContent = "Recent results";
      const kos = KO.filter(k => k.winner).slice().reverse();
      const seen = RES.first_seen || {};
      const list = MATCHES.filter(m => R[m.id]).sort((a, b) => String(seen[b.id] || "").localeCompare(String(seen[a.id] || "")) || b.id - a.id).slice(0, Math.max(0, 6 - kos.length));
      const koItems = kos.slice(0, 6).map(k => `<li><span class="meta"><span class="tag">${esc(koTag(k))}</span>${esc(k.format)} · ${esc(k.round)}</span><span class="${k.winner === 1 ? "won" : ""}">${esc(k.c1)}</span><span class="sc">${k.w1 ?? ""}-${k.w2 ?? ""}</span><span class="r ${k.winner === 2 ? "won" : ""}">${esc(k.c2)}</span></li>`);
      const added = id => { const d = new Date(seen[id]); return isNaN(d) ? "" : ` · in ${d.getDate()} ${MON[d.getMonth()]}` };
      const items = koItems.concat(list.map(m => `<li class="${isFresh(m.id) ? "fresh" : ""}"><span class="meta"><span class="tag">${esc(m.f)}</span>${slotTxt(m)}${added(m.id)}</span>${pairLine(m, R[m.id])}</li>`));
      $("feed").innerHTML = items.length ? items.join("") : '<li class="empty">No results yet.</li>';
    } else {
      $("rTitle").textContent = "Next up";
      const nx = MATCHES.find(m => !R[m.id]);
      const list = nx ? MATCHES.filter(m => !R[m.id] && m.day === nx.day && m.slot === nx.slot) : [];
      $("feed").innerHTML = list.length ? list.map(m => `<li><span class="meta"><span class="tag">${esc(m.f)}</span>${slotTxt(m)}</span>${pairLine(m, null)}</li>`).join("") : '<li class="empty">All league matches are played.</li>';
    }
  }
  function renderEvent() {
    if (!EVENTS.some(e => e.k === curEv)) curEv = EVENTS[0].k;
    const f = curEv, tb = table(f), st = status(f);
    $("evTitle").textContent = evName(f);
    const ms = MATCHES.filter(m => m.f === f);
    $("evSub").textContent = `${ms.filter(m => R[m.id]).length} of ${ms.length} matches played`;
    $("evTabs").innerHTML = EVENTS.map(e => `<button role="tab" class="tab" aria-selected="${e.k === f}" data-ev="${esc(e.k)}">${esc(e.n)}</button>`).join("");
    $("stand").tBodies[0].innerHTML = tb.map((r, i) => `<tr class="${i === 3 ? "cut" : ""}"><td class="rk">${i + 1}</td><td class="l"><div class="nm">${esc(nm(f, r.t))}</div>${chip(r.t)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.l}</td><td>${r.d > 0 ? "+" : ""}${r.d}</td><td class="big">${r.pts}</td><td class="c">${qBadge(st[r.t])}</td></tr>`).join("");
    $("evMatches").innerHTML = ms.slice().sort((x, y) => (!!R[y.id]) - (!!R[x.id]) || x.id - y.id).map(m => `<li class="${isFresh(m.id) ? "fresh" : ""}"><span class="meta">${slotTxt(m)}</span>${pairLine(m, R[m.id])}</li>`).join("");
    renderBracket(f);
  }
  const ROUND_SHORT = r => r.replace(/^quarterfinal\s*/i, "QF").replace(/^semifinal\s*/i, "SF").replace(/^final$/i, "Final");
  const koTag = k => `${k.events.length > 1 ? k.events[0].replace(/\d$/, "") : k.events[0]} ${ROUND_SHORT(k.round)}`;
  function koSide(k, n) {
    const c = n === 1 ? k.c1 : k.c2, t = n === 1 ? k.t1 : k.t2, seed = n === 1 ? k.seed1 : k.seed2;
    const tbd = !c || /^tbd$/i.test(c);
    const seedTxt = seed && !/winner|awaiting/i.test(seed) ? (/^\d+$/.test(seed) ? `#${seed}` : seed) : "";
    const won = k.winner === n, lost = k.winner && k.winner !== n;
    const sets = k.sets.map(p => `<span class="${p[n - 1] > p[2 - n] ? "sw" : ""}">${p[n - 1]}</span>`).join("");
    return `<span class="p ${won ? "won" : ""} ${lost ? "lost" : ""}" style="--tc:var(--t${t || 0})"><span class="who"><span class="nm">${won ? '<span class="tick" aria-label="Winner">✓</span>' : ""}${tbd ? `<span class="tbd">${esc(seed && /winner|awaiting/i.test(seed) ? seed : "To be decided")}</span>` : esc(c)}${seedTxt ? `<span class="seed">${esc(seedTxt)}</span>` : ""}</span>${t ? chip(t) : ""}</span>${sets ? `<span class="sets">${sets}</span>` : ""}</span>`;
  }
  function renderBracket(f) {
    const ties = KO.filter(k => k.events.includes(f));
    if (ties.length) {
      const fam = ties[0].events.length > 1 ? ties[0].format : evName(f);
      const anyResult = ties.some(k => k.winner);
      const pending = !(ties[0].events.every(groupDone));
      $("brTitle").textContent = `${fam} knockout${pending && !anyResult ? " (projected)" : ""}`;
      $("bracket").innerHTML = ties.map(k => `<div class="tie ${k.winner ? "done" : ""} ${k.winner && /^final/i.test(k.round) ? "champ" : ""}">${k.winner && /^final/i.test(k.round) ? `<span class="ribbon">Champion · ${esc(k.winner === 1 ? k.c1 : k.c2)}</span>` : ""}<span class="lab">${esc(k.round)}${k.winner ? ` · ${esc(k.w1 ?? "")}-${esc(k.w2 ?? "")}` : ""}</span>${koSide(k, 1)}${koSide(k, 2)}</div>`).join("");
      return;
    }
    // Fallback when the scorecard has no Finals sheet: work the draw out from the standings.
    let list, title;
    const fam = f.replace(/\d$/, ""), hasPair = /\d$/.test(f) && EVENTS.some(e => e.k === fam + "1") && EVENTS.some(e => e.k === fam + "2");
    if (!hasPair) {
      const tb = table(f); title = groupDone(f) ? "Semifinal draw" : "Semifinal draw (projected)";
      list = [["SF1", f, tb[0].t, 1, f, tb[3].t, 4], ["SF2", f, tb[1].t, 2, f, tb[2].t, 3]];
    } else {
      const f1 = fam + "1", f2 = fam + "2", t1 = table(f1), t2 = table(f2);
      title = `${evName(f1).replace(/\s*1$/, "")} quarterfinal draw${groupDone(f1) && groupDone(f2) ? "" : " (projected)"}`;
      list = [0, 1, 2, 3].map(i => ["QF" + (i + 1), f1, t1[i].t, i + 1, f2, t2[3 - i].t, 4 - i]);
    }
    $("brTitle").textContent = title;
    $("bracket").innerHTML = list.map(([l, fa, ta, sa, fb, tb, sb]) => {
      const tag = (ff, s) => fa === fb ? `#${s}` : `${ff} #${s}`;
      return `<div class="tie"><span class="lab">${l}</span><span class="p"><span>${esc(nm(fa, ta))}<span class="seed">${tag(fa, sa)}</span></span>${chip(ta)}</span><span class="p"><span>${esc(nm(fb, tb))}<span class="seed">${tag(fb, sb)}</span></span>${chip(tb)}</span></div>`;
    }).join("");
  }

  /* ---------- TEAMS ---------- */
  function renderTeams() {
    const wins = {}, played = {}, pf = {}; TEAMS.forEach(t => { wins[t] = 0; played[t] = 0; pf[t] = 0 });
    for (const m of MATCHES) { const r = R[m.id]; if (!r) continue; played[m.a]++; played[m.b]++; pf[m.a] += r[0]; pf[m.b] += r[1]; wins[r[0] > r[1] ? m.a : m.b]++ }
    const ts = teamScores(), order = ts.map(r => r.t), tpts = {}, trank = {};
    ts.forEach((r, i) => { tpts[r.t] = r.pts; trank[r.t] = i && r.pts === ts[i - 1].pts ? trank[ts[i - 1].t] : i + 1 });
    const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
    const tables = {}; EVENTS.forEach(e => tables[e.k] = table(e.k));
    $("teamGrid").innerHTML = order.map((t, i) => {
      const rows = EVENTS.map(e => {
        const pos = tables[e.k].findIndex(r => r.t === t) + 1, row = tables[e.k][pos - 1];
        return `<tr><td class="ev">${esc(e.k)}</td><td class="l">${esc(nm(e.k, t))}</td><td>${row.p ? ord(pos) : "–"}</td><td>${row.w}-${row.l}</td></tr>`;
      }).join("");
      return `<div class="card tcard ${i < 3 ? "half1" : "half2"}" style="--tc:var(--t${t})"><div class="thead">${teamBlock(t, "lg")}<div class="rank">${ord(trank[t])}<small>${tpts[t]} pts</small></div></div>
        <div class="tstats">${played[t]} played · ${wins[t]} won · ${tpts[t]} pts</div>
        <div class="tablewrap"><table><thead><tr><th class="l">Event</th><th class="l">Player / Pair</th><th>Pos</th><th>W-L</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }).join("");
  }

  /* ---------- PHOTOS ---------- */
  // Photos tab appears only once an upload or album link is set in data/config.json.
  const photosOn = () => !!(CFG.photos_upload_url || CFG.photos_album_url);
  function renderPhotos() {
    $("navPhotos").hidden = !photosOn();
    const set = (a, soon, url) => { if (url) { $(a).href = url; $(a).hidden = false; $(soon).hidden = true } else { $(a).hidden = true; $(soon).hidden = false } };
    set("photoUp", "photoUpSoon", CFG.photos_upload_url);
    set("photoAlbum", "photoAlbumSoon", CFG.photos_album_url);
    if (!photosOn() && location.hash === "#photos") location.hash = "#home";
  }

  /* ---------- AVAILABILITY ---------- */
  function players() {
    const map = {};
    for (const e of EVENTS) for (const t of TEAMS) {
      const entry = nm(e.k, t);
      entry.split(/\s*\+\s*/).forEach(p => { if (!p) return; (map[p] = map[p] || []).push({ f: e.k, t, entry }) });
    }
    return map;
  }
  let PLAYERS = {};
  function renderAvailability() {
    PLAYERS = players();
    const sel = $("who"), keep = sel.value || store.get("tt_who") || "";
    sel.innerHTML = '<option value="">Choose your name</option>' + Object.keys(PLAYERS).sort((a, b) => a.localeCompare(b)).map(p => `<option${p === keep ? " selected" : ""}>${esc(p)}</option>`).join("");
    renderMine();
    const c = CFG.coordinator || {};
    if (!c.name && !c.email) { $("coord").innerHTML = '<p class="soon">Coordinator details will appear here soon.</p>'; return }
    const email = c.email ? esc(c.email) : "";
    $("coord").innerHTML = `<div class="coord"><div class="nm">${esc(c.name || "Tournament coordinator")}</div>
      ${email ? `<div class="row"><code id="cEmail">${email}</code><button class="small" type="button" id="copyEmail">Copy email</button></div>
      <div class="row"><a class="cta" href="https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(c.email)}" target="_blank" rel="noopener">Chat on Teams</a><a class="small" href="mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent((CFG.tournament || "TT Tournament") + ": my availability")}">Send an email</a></div>` : ""}</div>`;
    const btn = $("copyEmail");
    if (btn) btn.onclick = async () => { try { await navigator.clipboard.writeText(c.email); btn.textContent = "Copied" } catch (_) { const r = document.createRange(); r.selectNodeContents($("cEmail")); getSelection().removeAllRanges(); getSelection().addRange(r); btn.textContent = "Selected, press Ctrl+C" } setTimeout(() => btn.textContent = "Copy email", 2500) };
  }
  function renderMine() {
    const who = $("who").value, box = $("myMatches");
    if (!who || !PLAYERS[who]) { box.innerHTML = '<p class="empty">Pick your name to see your matches and results.</p>'; return }
    box.innerHTML = '<div class="mine">' + PLAYERS[who].map(({ f, t, entry }) => {
      const ms = MATCHES.filter(m => m.f === f && (m.a === t || m.b === t));
      const left = ms.filter(m => !R[m.id]), done = ms.filter(m => R[m.id]);
      const pos = table(f).findIndex(r => r.t === t) + 1;
      const head = `<h4>${esc(evName(f))}<span class="sub">${esc(entry)} · ${teamInline(t)}${done.length ? ` · ${pos}${["th", "st", "nd", "rd"][pos] || "th"} in group` : ""}</span></h4>`;
      const li = m => `<li><span class="meta">${slotTxt(m)}</span>${pairLine(m, R[m.id])}</li>`;
      return `<div>${head}<ul class="list">${left.map(li).join("")}${done.map(li).join("")}</ul>${left.length ? "" : '<p class="empty">All group matches played.</p>'}</div>`;
    }).join("") + "</div>";
  }

  /* ---------- routing, TV, refresh ---------- */
  const VIEWS = ["home", "teams", "photos", "availability"];
  function route() {
    let v = location.hash.replace("#", "");
    if (v === "tv") { setTv(true); v = "home" }
    if (!VIEWS.includes(v)) v = "home";
    VIEWS.forEach(x => $("view-" + x).hidden = x !== v); $("view-today").hidden = true; $("view-tug").hidden = true;
    document.querySelectorAll(".nav a").forEach(a => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current") });
  }
  function renderAll() { if (!FX) return; renderHeader(); renderTop(); renderEvent(); renderTeams(); renderPhotos(); renderAvailability(); renderToday() }

  /* TV slideshow: overview, then each event (group table + knockout), then the team cards. */
  let wake = null, tvSlide = -1, tvDur = 12000;
  const isTv = () => document.documentElement.classList.contains("tv");
  // Today's session lists (data/config.json "today"): every listed match with a score gets its own winner moment.
  const todayCfg = () => CFG.today || {};
  const todayLabel = () => { const d = new Date((todayCfg().date || "") + "T00:00:00"); return isNaN(d) ? "Today" : `${d.getDate()} ${MON[d.getMonth()]}` };
  function todayMoments() {
    const t = todayCfg(), out = [];
    const koKey = k => `${k.format}|${k.round}`;
    [...(t.lunch || []), ...(t.evening || [])].forEach(id => { const m = MATCHES.find(x => x.id === Number(id)); if (m && R[m.id]) out.push(leagueMoment(m)) });
    (t.knockout || []).forEach(key => { const k = KO.find(x => koKey(x) === key && x.winner); if (k) out.unshift(koMoment(k)) });
    return out;
  }
  function todayPending() {
    const t = todayCfg(), pick = ids => (ids || []).map(id => MATCHES.find(x => x.id === Number(id))).filter(m => m && !R[m.id]);
    return { lunch: pick(t.lunch), evening: pick(t.evening) };
  }
  function slides() {
    const list = [{ k: "race", label: "Race for Best Team" }];
    if (cheerOn && TUGALL && TUGALL.rounds.length) list.push({ k: "tugtable", label: "Tug of war table" });
    const tp0 = todayPending(); if (tp0.lunch.length + tp0.evening.length + todayKo().length) list.push({ k: "today", label: `Match day · ${todayLabel()}` });
    list.push({ k: "overview", label: "Team standings and results" });
    const tm = todayMoments();
    if (tm.length) tm.forEach((m, i) => list.push({ k: "spot", m, label: `Results · ${todayLabel()} · ${i + 1} of ${tm.length}` }));
    else { const m = spotlight(); if (m) list.push({ k: "spot", m, label: "Spotlight" }) }
    EVENTS.forEach(e => list.push({ k: "event", ev: e.k, label: e.n }));
    list.push({ k: "teams", part: 1, label: "Teams · 1 of 2" }, { k: "teams", part: 2, label: "Teams · 2 of 2" });
    if (cheerOn && TUG && (TUG.active || TUG.done)) list.push({ k: "tug", label: "Tug of war" });   // last, so it never shifts the others
    return list;
  }
  const slideDur = s => s && s.k === "tug" ? (TUG && TUG.active ? TUG.endsIn + 12000 : Math.max(4000, Math.min(15000, 60000 - ((TUG && TUG.since) || 0))))
    : s && s.k === "spot" ? Math.max(6, Number(CFG.tv_spot_seconds) || 11) * 1000
    : s && s.k === "race" && cheerOn ? (RUSH && RUSH.active ? Math.max(tvDur, RUSH.endsIn + 800)        // hold the race for the whole Cheer Rush
      : Math.max(tvDur, (Number(CFG.tv_race_seconds) || 20) * 1000)) : tvDur;                              // longer, so people can scan and cheer
  // Shrink the slide to fit the screen whatever the TV's resolution or browser bars.
  function fitSlide() {
    const main = document.querySelector("main"); main.style.zoom = "";
    if (!isTv() || document.documentElement.dataset.slide === "spot") return;
    const head = document.querySelector("header.band").getBoundingClientRect().height, bar = document.querySelector(".tvbar").getBoundingClientRect().height || 64;
    const avail = innerHeight - head - bar - 8, need = main.scrollHeight;
    if (need > avail) main.style.zoom = Math.max(.55, avail / need).toFixed(3);
  }
  /* Match day: today's matches still to play (data/config.json "today": lunch/evening league ids and knockout keys),
     as head-to-head cards with what's at stake. Shown as a TV slide and on the home page; optional "hype" lines
     per match in config ("today.hype", keyed by match id or "Format|Round") replace the automatic stake line. */
  function todayKo() {
    const keys = todayCfg().knockout || [];
    return KO.filter(k => keys.includes(`${k.format}|${k.round}`) && !k.winner && k.c1 && k.c2 && k.t1 && k.t2);
  }
  function stakeFor(k) {
    const n = (k.round.match(/(\d+)/) || [])[1];
    if (/^quarter/i.test(k.round)) {
      const sf = KO.find(x => x.format === k.format && /^semi/i.test(x.round) && [x.seed1, x.seed2].some(sd => new RegExp(`^QF${n} Winner`, "i").test(sd || "")));
      let opp = "";
      if (sf) {
        const mine = new RegExp(`^QF${n} Winner`, "i").test(sf.seed1 || "") ? 1 : 2, c = mine === 1 ? sf.c2 : sf.c1, sd = mine === 1 ? sf.seed2 : sf.seed1;
        const qn = ((sd || "").match(/^QF(\d+)/i) || [])[1], feeder = qn && KO.find(x => x.format === k.format && x.round === `Quarterfinal ${qn}` && !x.winner);
        if (feeder && feeder.c1 && feeder.c2 && !/^tbd$/i.test(feeder.c1)) opp = `the ${feeder.c1} / ${feeder.c2} winner`;
        else if (c && !/^tbd$/i.test(c)) opp = c;
      }
      return `${opp ? `Winner plays ${opp} in the semifinal` : "Winner goes through to the semifinal"} · up to 2 Best Team points on the line`;
    }
    if (/^semi/i.test(k.round)) return "Winner goes to the final · up to 2 Best Team points on the line";
    return "For the title · champions +5 Best Team points, runners-up +3";
  }
  function renderToday() {
    const tp = todayPending(), kos = todayKo(), hype = todayCfg().hype || {};
    const sc = teamScores(), rank = {}, pts = {}; sc.forEach((r, i) => { rank[r.t] = i + 1; pts[r.t] = r.pts });
    const ord = n => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
    const capOn = (names, t) => captain(t) && String(names).split(/\s*\+\s*/).some(p => p.trim().toLowerCase() === captain(t).toLowerCase());
    const tags = (a, b, pa, pb) => {
      const out = [];
      if ([rank[a], rank[b]].sort().join() === "1,2") out.push("Top two clash");
      else if (Math.abs(rank[a] - rank[b]) === 1 && Math.abs(pts[a] - pts[b]) <= 2) out.push("Neck and neck");
      if (capOn(pa, a) || capOn(pb, b)) out.push("Captain on court");
      return out.map(x => `<em class="hot">${x}</em>`).join("");
    };
    const side = (names, t, cls) => `<div class="vside ${cls}" style="--tc:var(--t${t})"><b class="vpl">${esc(names)}</b>
        <span class="vtm"><i class="tsw"></i>${esc(teamName(t))}${captain(t) ? ` · Captain ${esc(captain(t))}` : ""}</span>
        <span class="vpts">${ord(rank[t])} in Best Team · ${pts[t]} pts</span></div>`;
    const card = (key, tag, title, a, b, pa, pb, stake) => `<article class="vs" style="--ta:var(--t${a});--tb:var(--t${b})">
        <header><span class="tag">${esc(tag)}</span><span class="vtitle">${esc(title)}</span>${tags(a, b, pa, pb)}</header>
        <div class="vrow">${side(pa, a, "l")}<i class="vsx">VS</i>${side(pb, b, "r")}</div>
        <p class="stake">${esc(hype[key] || stake)}</p></article>`;
    const order = (todayCfg().order || []).map(String), pos = key => { const i = order.indexOf(key); return i < 0 ? 999 : i };   // optional display order
    const cards = kos.map(k => ({ key: `${k.format}|${k.round}`, html: card(`${k.format}|${k.round}`, koTag(k), `${k.format} · ${k.round}`, k.t1, k.t2, k.c1, k.c2, stakeFor(k)) }))
      .concat([...tp.lunch, ...tp.evening].map(m => ({ key: String(m.id), html: card(String(m.id), m.f, `${evName(m.f)} · league`, m.a, m.b, nm(m.f, m.a), nm(m.f, m.b), "League match · the win is worth 1 Best Team point") })))
      .map((c, i) => Object.assign(c, { i })).sort((x, y) => pos(x.key) - pos(y.key) || x.i - y.i).map(c => c.html);
    const total = cards.length;
    $("todayTitle").textContent = `Match day · ${todayLabel()}`;
    $("todaySub").textContent = total ? `${total} match${total > 1 ? "es" : ""} to play · played as players are available` : "";
    $("todayList").innerHTML = cards.join("");
    const home = $("mdCard"); if (home) { home.hidden = !total; $("mdTitle").textContent = `Match day · ${todayLabel()}`; $("mdSub").textContent = $("todaySub").textContent; $("mdList").innerHTML = cards.join("") }
  }
  function showSlide(i) {
    if (!EVENTS.length) return;
    const list = slides(); tvSlide = ((i % list.length) + list.length) % list.length; const s = list[tvSlide];
    document.documentElement.dataset.slide = s.k;
    const mainEl = document.querySelector("main"); mainEl.classList.remove("enter"); void mainEl.offsetWidth; mainEl.classList.add("enter");
    const view = s.k === "teams" ? "teams" : s.k === "today" ? "today" : s.k === "tug" ? "tug" : "home";
    VIEWS.forEach(x => $("view-" + x).hidden = x !== view); $("view-today").hidden = view !== "today"; $("view-tug").hidden = view !== "tug";
    document.documentElement.dataset.part = s.part || "";
    if (s.k === "event") { curEv = s.ev; renderEvent() }
    if (s.k === "today") renderToday();
    if (s.k === "tug") renderTugTv();
    if (s.k === "race") { replayRace(); pulseQr() }
    if (s.k === "spot") showMoment(s.m, true); else if (spotOn && !celBusy) hideMoment();
    $("tvLabel").textContent = s.label;
    $("tvDots").innerHTML = list.map((_, j) => `<i class="${j === tvSlide ? "on" : ""}"></i>`).join("");
    const bar = $("tvProg"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = `tvprog ${slideDur(s)}ms linear forwards`;
    window.scrollTo(0, 0); requestAnimationFrame(fitSlide);
  }
  function tvTick() { showSlide(tvSlide + 1); tvRestart() }
  function tvRestart() { clearTimeout(tvTimer); const s = slides()[tvSlide]; tvTimer = setTimeout(tvTick, slideDur(s)) }
  async function setTv(on) {
    document.documentElement.classList.toggle("tv", on);
    $("tvBtn").textContent = on ? "Exit TV mode" : "TV mode";
    clearTimeout(tvTimer);
    if (on) {
      tvDur = Math.max(5, Number(CFG.tv_seconds) || 12) * 1000;
      tvSlide = -1; tvTick();
      try { await document.documentElement.requestFullscreen() } catch (_) {}
      try { wake = await navigator.wakeLock.request("screen") } catch (_) {}
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch (_) {}
      try { wake && wake.release() } catch (_) {}
      delete document.documentElement.dataset.slide; tvSlide = -1; document.querySelector("main").style.zoom = ""; if (spotOn) hideMoment();
      if (location.hash === "#tv") history.replaceState(null, "", "#home");
      route();
    }
  }
  /* ---------- result moments: banner + confetti on the TV, toast elsewhere, optional chime ---------- */
  const reduceMotion = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  let chimeOn = store.get("tt_chime") === "1", audio = null;
  function setChimeBtn() { $("chimeBtn").textContent = chimeOn ? "Chime on" : "Chime off"; $("chimeBtn").setAttribute("aria-pressed", chimeOn) }
  function chime(big) {
    if (!chimeOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [659.25, 880];   // C-E-G-C for a title, E-A otherwise
      notes.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.16;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.65);
      });
    } catch (_) {}
  }
  /* Moments. A moment = { kick, tag, name, team, loser, sa, sb, sets, big }. */
  const TEAMCOL = t => getComputedStyle(document.documentElement).getPropertyValue(`--t${t}`).trim() || "#00F6ED";
  function leagueMoment(m) {
    const r = R[m.id], w = r[0] > r[1] ? m.a : m.b, l = w === m.a ? m.b : m.a;
    return { kick: "Winner", tag: `${evName(m.f)} · ${dayTxt(m.day)}`, name: nm(m.f, w), team: w, loser: nm(m.f, l), loserTeam: l, sa: Math.max(...r), sb: Math.min(...r), sets: "", big: false };
  }
  function koMoment(k) {
    const w = k.winner, final = /^final/i.test(k.round);
    return { kick: final ? "Champions" : `${k.round} winner`, tag: `${k.format} · ${k.round}`, name: w === 1 ? k.c1 : k.c2, team: w === 1 ? k.t1 : k.t2, loser: w === 1 ? k.c2 : k.c1, loserTeam: w === 1 ? k.t2 : k.t1,
      sa: w === 1 ? k.w1 : k.w2, sb: w === 1 ? k.w2 : k.w1, sets: k.sets.map(p => w === 1 ? `${p[0]}-${p[1]}` : `${p[1]}-${p[0]}`).join("  ·  "),
      setList: k.sets.map(p => w === 1 ? p : [p[1], p[0]]), big: final };
  }
  // Spotlight on the TV: the latest champion, else the latest knockout winner, else the newest league result.
  function spotlight() {
    const finals = KO.filter(k => k.winner && /^final/i.test(k.round)); if (finals.length) return koMoment(finals[finals.length - 1]);
    const kos = KO.filter(k => k.winner); if (kos.length) return koMoment(kos[kos.length - 1]);
    const seen = RES.first_seen || {};
    const last = MATCHES.filter(m => R[m.id]).sort((a, b) => String(seen[b.id] || "").localeCompare(String(seen[a.id] || "")) || b.id - a.id)[0];
    return last ? leagueMoment(last) : null;
  }
  let fxRun = 0;
  function burst(big, col) {
    if (reduceMotion()) return;
    const run = ++fxRun, cv = $("confetti"), ctx = cv.getContext("2d");
    const W = cv.width = innerWidth, H = cv.height = innerHeight;
    const cols = [col, col, "#00F6ED", "#E9806E", "#E75A7C", "#CAD8DE", "#ffffff"];
    const parts = [];
    const spray = (x, y, n, sp, up) => { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = Math.random() * sp; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, s: 4 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[(Math.random() * cols.length) | 0], life: 1 }) } };
    // side cannons, then (for titles) fireworks bursts across the top half
    spray(0, H * .8, big ? 120 : 80, 16, 10); spray(W, H * .8, big ? 120 : 80, 16, 10);
    parts.forEach(p => { p.vx = Math.abs(p.vx) * (p.x === 0 ? 1 : -1) });
    const bursts = big ? 9 : 3; let fired = 0;
    const t0 = performance.now(), dur = big ? 8000 : 5000;
    (function frame(t) {
      if (run !== fxRun) return;
      const k = (t - t0) / dur; ctx.clearRect(0, 0, W, H); if (k >= 1) return;
      if (fired < bursts && t - t0 > 500 + fired * (big ? 650 : 900)) { spray(W * (.2 + Math.random() * .6), H * (.15 + Math.random() * .3), big ? 90 : 60, 9, 2); fired++ }
      for (const p of parts) { p.vy += .22; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life -= .004;
        ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, p.life) * (1 - k * .6)); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore() }
      requestAnimationFrame(frame);
    })(t0);
  }
  /* The winner moment plays like a match:
     1) card + name   2) the rally: both scores climb point by point, slowing at the end (knockouts land set by set)
     3) the winning point slams in: flash, shockwave, confetti   4) "beat ...", team and captain rise in. */
  let momentRun = 0;
  const later = (run, ms, fn) => setTimeout(() => { if (run === momentRun) fn() }, ms);
  function tick(win) {
    if (!chimeOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = "triangle"; o.frequency.value = win ? 1320 : 990;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(win ? 0.05 : 0.025, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.1);
    } catch (_) {}
  }
  // Point-by-point rally: winner's and loser's numbers rise together; the loser stops at their score.
  function rally(run, sa, sb, done) {
    const A = $("celA"), B = $("celB"), top = Math.max(sa, sb);
    let i = 0;
    (function step() {
      if (run !== momentRun) return;
      i++; A.textContent = Math.min(i, sa); B.textContent = Math.min(i, sb);
      const left = top - i;
      if (left <= 0) { done(); return }
      tick(i <= sa && i > sb);
      // steady at first, then each of the last five points slows down for tension
      const wait = left > 5 ? 95 : [520, 420, 320, 230, 160][left - 1];
      setTimeout(step, wait);
    })();
  }
  // Knockout: each set lands in turn and the sets-won tally moves.
  function setsReveal(run, list, done) {
    const A = $("celA"), B = $("celB"), box = $("celSets");
    box.innerHTML = list.map(p => `<span class="set ${p[0] > p[1] ? "w" : "l"}">${p[0]}-${p[1]}</span>`).join("");
    const pills = [...box.children]; let a = 0, b = 0, i = 0;
    (function next() {
      if (run !== momentRun) return;
      if (i >= list.length) { done(); return }
      const p = list[i]; pills[i].classList.add("in");
      if (p[0] > p[1]) a++; else b++;
      A.textContent = a; B.textContent = b; tick(p[0] > p[1]);
      i++; setTimeout(next, i === list.length - 1 ? 1300 : 1000);
    })();
  }
  // Captain caricatures (data/config.json "team_art"): the winning team's captain celebrates on the left,
  // the losing team's captain sulks on the right.
  const art = (t, side) => { const a = CFG.team_art && CFG.team_art[t]; return (a && a[side]) || "" };
  function setArt(id, t, side) {
    const fig = $(id), src = t ? art(t, side) : "";
    fig.hidden = !src; if (!src) return false;
    fig.style.setProperty("--ac", TEAMCOL(t));
    const img = fig.querySelector("img"); if (img.getAttribute("src") !== src) img.src = src;
    fig.querySelector("figcaption").innerHTML = `<i></i>${esc(teamName(t))}${captain(t) ? ` · ${esc(captain(t))}` : ""}`;
    return true;
  }
  let artLoaded = "";
  function preloadArt() {
    const list = Object.values(CFG.team_art || {}).flatMap(a => [a.win, a.loss]).filter(Boolean), key = list.join();
    if (key === artLoaded) return; artLoaded = key; list.forEach(src => { const i = new Image(); i.src = src });
  }
  let spotOn = false;
  function showMoment(m, asSlide) {
    const run = ++momentRun, el = $("celebrate"); spotOn = !!asSlide; fxRun++;
    el.style.setProperty("--wc", TEAMCOL(m.team)); el.style.setProperty("--wcf", m.team === 1 ? "#fff" : "#0F1E2C");
    $("celKick").textContent = m.kick; $("celTag").textContent = m.tag;
    $("celTrophy").toggleAttribute("hidden", !m.big);   // an SVG has no .hidden property
    $("celName").innerHTML = m.name.split(" ").map((w, i) => `<span style="animation-delay:${.3 + i * .12}s">${esc(w)}</span>`).join(" ");
    $("celA").textContent = "0"; $("celB").textContent = "0";
    $("celSets").innerHTML = "";
    $("celVs").textContent = m.loser && !/^tbd$/i.test(m.loser) ? `beat ${m.loser}` : "";
    $("celTeam").innerHTML = m.team ? teamBlock(m.team, "cel", true) : "";
    const hasArt = setArt("celWin", m.team, "win") | setArt("celLoss", m.loserTeam, "loss");
    el.classList.toggle("art", !!hasArt);
    el.classList.toggle("big", !!m.big); el.classList.toggle("slide", !!asSlide);
    el.classList.remove("show", "slammed"); el.hidden = false; void el.offsetWidth; el.classList.add("show");
    const slam = () => {
      $("celA").textContent = m.sa; $("celB").textContent = m.sb;
      el.classList.add("slammed"); chime(m.big);
      burst(m.big, TEAMCOL(m.team));
    };
    if (reduceMotion()) { if (m.setList) $("celSets").innerHTML = m.setList.map(p => `<span class="set in ${p[0] > p[1] ? "w" : "l"}">${p[0]}-${p[1]}</span>`).join(""); slam(); return }
    const hasSets = m.setList && m.setList.length;
    later(run, 1300, () => hasSets ? setsReveal(run, m.setList, slam) : (m.sa != null ? rally(run, m.sa, m.sb, slam) : slam()));
  }
  function hideMoment() { spotOn = false; fxRun++; momentRun++; $("celebrate").hidden = true }
  let celQueue = [], celBusy = false;
  function celebrate(list) {
    chime(list.some(x => x.big));
    if (!isTv()) { const m = list[0]; toast(list.length > 1 ? `${list.length} new results in` : `${m.name} (${teamName(m.team)}) win ${m.sa}-${m.sb} · ${m.tag}`); return }
    celQueue.push(...list.slice(0, 4)); if (!celBusy) nextCel();
  }
  function nextCel() {
    const m = celQueue.shift(); if (!m) { celBusy = false; hideMoment(); return }
    celBusy = true; clearTimeout(tvTimer);                   // pause the slideshow while celebrating
    showMoment(m, false);
    setTimeout(() => { if (!celQueue.length) { celBusy = false; hideMoment(); if (isTv()) { showSlide(tvSlide); tvRestart() } } else nextCel() }, m.big ? 13000 : 11000);
  }

  let toastT = null;
  function toast(msg) { $("toast").textContent = msg; $("toast").hidden = false; clearTimeout(toastT); toastT = setTimeout(() => $("toast").hidden = true, 9000) }

  // The offline file (tt-offline.html) carries its data in window.TT_OFFLINE instead of fetching it.
  async function getJSON(path) { const off = window.TT_OFFLINE; if (off && off[path]) return JSON.parse(JSON.stringify(off[path])); const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error(path + " " + r.status); return r.json() }
  /* Live Google Sheet (data/config.json "sheet_id"): when set, scores come straight from the sheet on every refresh,
     so a score typed into the sheet reaches the site and the TV within about 30 seconds. The GitHub data stays as the fallback. */
  let sheetNote = "";
  async function liveSheet(cfg) {
    if (!cfg.sheet_id || window.TT_OFFLINE) return null;
    try {
      await loadScript("assets/sheetfeed.js");
      const d = await window.TTSheet.load(cfg.sheet_id, cfg.name_fixes, cfg.sheet_layout);
      sheetNote = ""; return d;
    } catch (e) { sheetNote = String(e && e.message || e); console.warn("Live sheet:", sheetNote); return null }
  }
  function mergeLive(res, results, ko, cfg) {
    const iso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
    let seen = {}; try { seen = JSON.parse(store.get("tt_live_seen") || "{}") } catch (_) {}
    const first_seen = Object.assign({}, res.first_seen || {});
    Object.keys(results).forEach(k => { if (!first_seen[k]) { if (!seen[k]) seen[k] = iso(); first_seen[k] = seen[k] } });
    store.set("tt_live_seen", JSON.stringify(seen));
    // "Updated" moves only when the sheet differs from what was last seen, so the time means something.
    const sig = JSON.stringify([results, (ko.ties || []).map(t => [t.c1, t.c2, t.sets, t.winner])]);
    let stamp = {}; try { stamp = JSON.parse(store.get("tt_live_sig") || "{}") } catch (_) {}
    if (stamp.sig !== sig) { stamp = { sig, at: stamp.sig ? iso() : (res.updated || iso()) }; store.set("tt_live_sig", JSON.stringify(stamp)) }
    return Object.assign({}, res, { results, first_seen, played: Object.keys(results).length, updated: stamp.at, live: true });
  }
  async function refresh(first) {
    try {
      let [fx, res, cfg, ko] = await Promise.all([getJSON("data/fixtures.json"), getJSON("data/results.json"), getJSON("data/config.json"), getJSON("data/knockout.json").catch(() => ({ ties: [] }))]);
      const live = await liveSheet(cfg || {});
      if (live && live.fixtures.matches.length === fx.matches.length) {
        // Google drops numbers from a column that is mostly text (the numeric seeds), so keep those from the last upload.
        const base = {}; ((ko && ko.ties) || []).forEach(t => base[`${t.format}|${t.round}`] = t);
        live.knockout.ties.forEach(t => { const b = base[`${t.format}|${t.round}`]; if (b) { if (!t.seed1) t.seed1 = b.seed1; if (!t.seed2) t.seed2 = b.seed2 } });
        fx = live.fixtures; ko = live.knockout; res = mergeLive(res, live.results, ko, cfg);
      }
      const newIds = first ? [] : Object.keys(res.results || {}).filter(k => !R[k]);
      const koKey = k => `${k.format}|${k.round}`;
      const prevKo = new Set(KO.filter(k => k.winner).map(koKey));
      const newKo = first ? [] : ((ko && ko.ties) || []).filter(k => k.winner && !prevKo.has(koKey(k)));
      FX = fx; RES = res; CFG = cfg || {};
      EVENTS = fx.events; ROSTER = fx.roster; MATCHES = fx.matches; R = res.results || {}; KO = (ko && ko.ties) || [];
      preloadArt();
      if (CFG.tournament) { $("title").textContent = CFG.tournament; document.title = CFG.tournament + " | SDU" }
      $("live").classList.remove("off");
      newIds.forEach(id => fresh.set(String(id), Date.now()));
      if (first || res.updated !== lastUpdated) renderAll();
      startQr(); liveLinks(); startCheers();
      const moments = newKo.map(koMoment).concat(newIds.map(id => MATCHES.find(x => String(x.id) === id)).filter(Boolean).map(leagueMoment));
      if (moments.length) celebrate(moments);
      if (isTv()) { if (first) tvDur = Math.max(5, Number(CFG.tv_seconds) || 12) * 1000; if (tvSlide < 0) { showSlide(0); tvRestart() } else requestAnimationFrame(fitSlide) }
      lastUpdated = res.updated;
    } catch (e) {
      $("live").classList.add("off");
      if (first) { $("liveTxt").textContent = "Could not load results"; $("progTxt").textContent = "Check your connection and refresh the page." }
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-ev]"); if (t) { curEv = t.dataset.ev; store.set("tt_ev", curEv); renderEvent() }
  });
  $("segRes").onclick = () => { feedMode = "res"; $("segRes").setAttribute("aria-pressed", "true"); $("segNext").setAttribute("aria-pressed", "false"); renderTop() };
  $("segNext").onclick = () => { feedMode = "next"; $("segNext").setAttribute("aria-pressed", "true"); $("segRes").setAttribute("aria-pressed", "false"); renderTop() };
  $("who").addEventListener("change", () => { store.set("tt_who", $("who").value); renderMine() });
  $("tvBtn").onclick = () => setTv(!document.documentElement.classList.contains("tv"));
  setChimeBtn();
  $("chimeBtn").onclick = () => { chimeOn = !chimeOn; store.set("tt_chime", chimeOn ? "1" : "0"); setChimeBtn(); if (chimeOn) chime(false) };
  window.ttDemo = big => celebrate([big ? { kick: "Champions", tag: "Mixed Doubles · Final", name: "Sample Pair + Winners", team: 3, loserTeam: 6, loser: "Sample Runners-up", sa: 2, sb: 1, sets: "15-12  ·  13-15  ·  15-11", big: true }
                                          : { kick: "Winner", tag: "Men's Doubles 1 · Day 8", name: "Sample Pair + Winners", team: 4, loserTeam: 2, loser: "Sample Opponents", sa: 21, sb: 18, sets: "", big: false }]);
  document.addEventListener("keydown", e => {
    if (!isTv()) return;
    if (e.key === "Escape") setTv(false);
    else if (e.key === "ArrowRight") { showSlide(tvSlide + 1); tvRestart() }
    else if (e.key === "ArrowLeft") { showSlide(tvSlide - 1); tvRestart() }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") return;
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("resize", () => { if (isTv()) fitSlide() });

  route();
  refresh(true).then(() => {
    const every = (CFG.sheet_id ? 30 : Math.max(20, Number(CFG.refresh_seconds) || 60)) * 1000;   // a live sheet is checked every 30 seconds
    setInterval(() => refresh(false), every);
  });
})();
