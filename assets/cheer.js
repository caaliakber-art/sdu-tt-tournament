/* Cheer page: pick your team once, then every tap is a cheer.
   Game layer: fast, steady tapping builds a combo (x2, x3, ON FIRE x5); during a Cheer Rush every cheer counts double;
   each fan climbs levels (Rookie, Ultra, Superfan, Legend) kept on their own device.
   Taps are batched and sent as server-side increments of at most 25 (the database rule), a couple of writes a second at most. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k) } catch (_) { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch (_) {} },
  };
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const BATCH = 25, MAX_PENDING = 250, FLUSH_MS = 450;
  const COMBOS = [[40, 5, "ON FIRE x5"], [20, 3, "x3 COMBO"], [8, 2, "x2 COMBO"]];          // [streak needed, multiplier, label]
  const LEVELS = [[0, "New fan"], [50, "Rookie"], [250, "Ultra"], [1000, "Superfan"], [5000, "Legend"]];
  let CFG = {}, DB = "", TEAMS = [], team = null, pending = 0, sending = false, mine = 0, all = 0, totals = {};
  let streak = 0, lastTap = 0, comboT = null, rushOn = false;
  let TUG = null, tugKey = "", tugStop = null, tugTotals = {}, tugPending = 0, tugPendKey = "", tugSending = false;

  const tname = t => (CFG.team_names && CFG.team_names[t]) || `Team ${t}`;
  const cap = t => (CFG.captains && CFG.captains[t]) || "";
  const run = t => (CFG.team_art && CFG.team_art[t] && CFG.team_art[t].run) || "";
  const fmt = n => Number(n || 0).toLocaleString("en-IN");
  const onT = t => Number(t) === 1 ? "#fff" : "#0F1E2C";             // readable text on each team colour (Team 1 is navy)
  const comboOf = s => COMBOS.find(c => s >= c[0]) || [0, 1, ""];
  const levelOf = n => { let i = 0; LEVELS.forEach((l, j) => { if (n >= l[0]) i = j }); return i };

  function renderPicks() {
    $("picks").innerHTML = TEAMS.map(t => `<button type="button" class="pickbtn" data-t="${t}" style="--tc:var(--t${t})">
      ${run(t) ? `<img src="${esc(run(t))}" alt="">` : ""}
      <span class="pk-name">${esc(tname(t))}</span>${cap(t) ? `<span class="pk-cap">Captain ${esc(cap(t))}</span>` : ""}</button>`).join("");
  }
  function choose(t) {
    team = t; store.set("tt_cheer_team", t);
    $("pick").hidden = true; $("go").hidden = false;
    $("go").style.setProperty("--tc", `var(--t${t})`); $("go").style.setProperty("--tcf", onT(t));
    $("myTeam").innerHTML = `<i class="tsw"></i><b>${esc(tname(t))}</b>${cap(t) ? ` · Captain ${esc(cap(t))}` : ""}`;
    const img = $("cheerImg"); if (run(t)) { img.src = run(t); img.hidden = false } else img.hidden = true;
    mine = Number(store.get(`tt_cheer_mine_${t}`)) || 0;
    renderMine(); renderMeter(); renderLevel(); renderCombo(); renderTug();
  }
  function renderMine() {
    $("mine").textContent = fmt(mine);
    $("teamTotal").textContent = fmt((Number(totals[team]) || 0) + pending);
  }
  function renderMeter() {
    const rows = TEAMS.map(t => ({ t, n: (Number(totals[t]) || 0) + (t === team ? pending : 0) })).sort((a, b) => b.n - a.n || a.t - b.t);
    const top = Math.max(1, ...rows.map(r => r.n));
    $("meter").innerHTML = rows.map((r, i) => `<div class="mrow ${r.t === team ? "me" : ""}" style="--tc:var(--t${r.t});--tcf:${onT(r.t)}">
      <span class="mname"><i class="tsw"></i>${esc(tname(r.t))}${i === 0 && r.n > 0 ? '<em class="loud">Loudest</em>' : ""}</span>
      <span class="mbar"><b style="width:${(r.n / top * 100).toFixed(1)}%"></b></span><span class="mnum">${fmt(r.n)}</span></div>`).join("");
  }

  // Levels follow everything this person has cheered, on this device, across teams.
  function renderLevel() {
    const i = levelOf(all), cur = LEVELS[i], next = LEVELS[i + 1];
    $("lvlName").textContent = cur[1];
    $("lvlBar").style.width = next ? `${((all - cur[0]) / (next[0] - cur[0]) * 100).toFixed(1)}%` : "100%";
    $("lvlNext").textContent = next ? `${fmt(next[0] - all)} to ${next[1]}` : "Top level";
    $("lvl").dataset.level = i;
  }
  function levelUp(i) {
    const box = $("levelUp"), next = LEVELS[i + 1];
    $("levelUpName").textContent = LEVELS[i][1];
    $("levelUpNext").textContent = next ? `Next: ${next[1]} at ${fmt(next[0])} cheers` : "You've reached the top. Legend!";
    box.hidden = false; box.classList.remove("show"); void box.offsetWidth; box.classList.add("show");
    clearTimeout(levelUp.t); levelUp.t = setTimeout(() => box.hidden = true, 2600);
    try { navigator.vibrate && navigator.vibrate([30, 60, 30]) } catch (_) {}
    const r = $("cheerBtn").getBoundingClientRect();
    for (let k = 0; k < 4; k++) setTimeout(() => burst(r.left + r.width * (.2 + Math.random() * .6), r.top + r.height * .4, 4), k * 120);
  }

  function renderCombo() {
    const [need, mult, label] = comboOf(streak), nextC = COMBOS.slice().reverse().find(c => c[0] > streak);
    const el = $("combo"); el.dataset.mult = mult;
    $("comboTxt").textContent = mult > 1 ? `${label}${rushOn ? " · RUSH x2" : ""}` : rushOn ? "CHEER RUSH · x2" : "Tap fast for a combo";
    const from = need || 0, to = nextC ? nextC[0] : from;
    $("comboBar").style.width = nextC ? `${Math.min(100, (streak - from) / (to - from) * 100).toFixed(0)}%` : "100%";
    $("cheerBtn").classList.toggle("fire", mult === 5);
  }

  // Little bursts where the finger lands, with the cheers that tap was worth.
  const BITS = ["👏", "🔥", "🏓", "💪", "🎉"];
  function burst(x, y, count, plus) {
    if (reduce()) return;
    const fx = $("fx");
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.textContent = BITS[(Math.random() * BITS.length) | 0];
      s.style.left = `${x}px`; s.style.top = `${y}px`;
      s.style.setProperty("--dx", `${(Math.random() - .5) * 160}px`);
      s.style.setProperty("--dy", `${-90 - Math.random() * 120}px`);
      s.style.setProperty("--r", `${(Math.random() - .5) * 60}deg`);
      fx.appendChild(s); setTimeout(() => s.remove(), 900);
    }
    if (plus > 1) {
      const p = document.createElement("span"); p.className = "plus"; p.textContent = `+${plus}`;
      p.style.left = `${x}px`; p.style.top = `${y - 30}px`; fx.appendChild(p); setTimeout(() => p.remove(), 800);
    }
  }
  function tap(e) {
    if (!team) return;
    const now = performance.now();
    streak = now - lastTap < 450 ? streak + 1 : 1; lastTap = now;
    clearTimeout(comboT); comboT = setTimeout(() => { streak = 0; renderCombo() }, 1000);
    const n = comboOf(streak)[1] * (rushOn ? 2 : 1);
    if (pending + n > MAX_PENDING) return;                        // offline or very slow network: hold back rather than pile up
    const before = levelOf(all);
    pending += n; mine += n; all += n;
    if (TUG && TUG.active && myPair()) { if (tugPendKey !== TUG.key) tugPending = 0; tugPending = Math.min(MAX_PENDING, tugPending + n); tugPendKey = TUG.key }   // a pull also counts as a cheer
    store.set(`tt_cheer_mine_${team}`, mine); store.set("tt_cheer_all", all);
    const r = $("cheerBtn").getBoundingClientRect();
    burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2, Math.min(2 + n, 7), n);
    const b = $("cheerBtn"); b.classList.remove("hit"); void b.offsetWidth; b.classList.add("hit");
    try { navigator.vibrate && navigator.vibrate(n >= 5 ? 22 : 12) } catch (_) {}
    renderMine(); renderMeter(); renderCombo(); renderLevel(); renderTug();
    const after = levelOf(all); if (after > before) levelUp(after);
  }
  async function flush(keepalive) {
    if (sending || !pending || !team || !DB) return;
    sending = true; const n = Math.min(pending, BATCH);
    const ok = await window.TTCheer.add(DB, team, n, keepalive);
    if (ok) pending -= n;
    sending = false;
    if (ok && pending >= BATCH) setTimeout(() => flush(false), 0);   // a hot streak drains in back-to-back writes
    $("meterSub").textContent = ok ? "Live" : "Reconnecting…";
  }

  // Tug of war: all six teams pull at once, in pairs. Your taps pull your team's rope; the result shows for a minute after.
  const myPair = () => TUG && team ? TUG.pairs.find(p => p.includes(team)) : null;
  async function flushTug(keepalive) {
    if (tugSending || !tugPending || !tugPendKey || !team || !DB) return;
    tugSending = true; const n = Math.min(tugPending, BATCH), key = tugPendKey;
    const ok = await window.TTCheer.addPath(DB, `tug/${key}/${team}`, n, keepalive);
    if (ok && key === tugPendKey) tugPending -= n; else if (!ok && !(TUG && TUG.key === key)) tugPending = 0;   // give up once the pull is over
    tugSending = false;
    if (ok && tugPending >= BATCH) setTimeout(() => flushTug(false), 0);
  }
  function tickTug() {
    const st = window.TTCheer.tug(CFG.tug_of_war), key = st ? st.key : "";
    const wasActive = !!(TUG && TUG.active); TUG = st;
    if (key !== tugKey) {
      if (tugStop) tugStop(); tugStop = null; tugTotals = {}; tugKey = key;
      if (key && DB) tugStop = window.TTCheer.watchPath(DB, `tug/${key}`, d => { tugTotals = d || {}; renderTug() });
    }
    if (TUG && TUG.active && !wasActive && myPair()) try { navigator.vibrate && navigator.vibrate([60, 40, 60]) } catch (_) {}
    renderTug();
  }
  function renderTug() {
    const box = $("tugBox"), pair = myPair(), pulling = !!(TUG && TUG.active && pair);
    document.body.classList.toggle("tugging", pulling);
    $("cbLabel").textContent = pulling ? "Pull!" : "Tap to cheer";
    if (!pair) { box.hidden = true; return }
    const rival = pair[0] === team ? pair[1] : pair[0];
    const a = (Number(tugTotals[team]) || 0) + (tugPendKey === TUG.key ? tugPending : 0), b = Number(tugTotals[rival]) || 0;
    box.hidden = false; box.dataset.state = TUG.active ? "on" : TUG.done ? "done" : "soon";
    box.style.setProperty("--ta", `var(--t${team})`); box.style.setProperty("--tb", `var(--t${rival})`);
    const side = (t, n) => `<i class="tsw" style="background:var(--t${t})"></i><span><b>${esc(tname(t))}</b><em>${fmt(n)}</em></span>`;
    $("tugMe").innerHTML = side(team, a); $("tugThem").innerHTML = side(rival, b);
    $("tugKnot").style.left = `${(50 + window.TTCheer.rope(a, b) * 42).toFixed(1)}%`;
    const gap = Math.abs(a - b);
    if (TUG.soon) {
      $("tugTitle").textContent = "Tug of war"; $("tugClock").textContent = `starts in ${window.TTCheer.clock(TUG.startsIn)}`;
      $("tugNote").textContent = `${tname(team)} v ${tname(rival)}. Get your team's fans together: every tap pulls the rope.`;
    } else if (TUG.active) {
      $("tugTitle").textContent = "Tug of war!"; $("tugClock").textContent = `${window.TTCheer.clock(TUG.endsIn)} left`;
      $("tugNote").textContent = a === b ? "Dead level. Pull!" : a > b ? `You're ahead by ${fmt(gap)}. Hold on!` : `Behind by ${fmt(gap)}. Pull harder!`;
    } else {
      $("tugTitle").textContent = a === b ? "It's a draw" : a > b ? "Your team won the pull!" : `${tname(rival)} won this one`;
      $("tugClock").textContent = "Final"; $("tugNote").textContent = `${tname(team)} ${fmt(a)} · ${tname(rival)} ${fmt(b)}`;
    }
  }

  // Cheer Rush banner and double cheers.
  function tickRush() {
    const st = window.TTCheer.rush(CFG.cheer_rush), el = $("rush");
    const was = rushOn; rushOn = !!(st && st.active);
    document.body.classList.toggle("rushing", rushOn);
    if (!st) { el.hidden = true } else {
      el.hidden = false; el.classList.toggle("on", rushOn);
      el.innerHTML = rushOn ? `<b>Cheer Rush!</b> Every cheer counts double · <span>${window.TTCheer.clock(st.endsIn)} left</span>`
        : `<b>Cheer Rush</b> starts in <span>${window.TTCheer.clock(st.startsIn)}</span> · every cheer will count double`;
    }
    if (was !== rushOn && team) { renderCombo(); if (rushOn) try { navigator.vibrate && navigator.vibrate([40, 40, 40]) } catch (_) {} }
  }

  async function loadCfg() {
    try { CFG = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json()) } catch (_) {}
  }
  async function init() {
    await loadCfg();
    if (CFG.tournament) document.title = `Cheer for your team | ${CFG.tournament} | SDU`;
    DB = String(CFG.cheer_db || "").trim();
    TEAMS = Object.keys(CFG.captains || CFG.team_names || { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }).map(Number).sort((a, b) => a - b);
    all = Number(store.get("tt_cheer_all")) || 0;
    renderPicks(); renderMeter();
    if (!DB) { $("intro").textContent = "Cheering opens soon. Check back on match day."; $("meterSub").textContent = "Not open yet"; return }
    window.TTCheer.watch(DB, d => { totals = d || {}; renderMine(); renderMeter() });
    const saved = Number(store.get("tt_cheer_team"));
    if (TEAMS.includes(saved)) choose(saved); else $("pick").hidden = false;
    setInterval(() => { flush(false); flushTug(false) }, FLUSH_MS);
    tickRush(); setInterval(tickRush, 1000);
    tickTug(); setInterval(tickTug, 1000);
    setInterval(loadCfg, 5 * 60000);                                // picks up new Cheer Rush times without a reload
  }

  document.addEventListener("click", e => { const b = e.target.closest(".pickbtn"); if (b) choose(Number(b.dataset.t)) });
  $("change").onclick = () => { flush(false); flushTug(false); team = null; $("go").hidden = true; $("pick").hidden = false; renderMeter() };
  $("cheerBtn").addEventListener("pointerdown", tap);
  $("cheerBtn").addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) tap(e) } });
  $("cheerBtn").addEventListener("click", e => e.preventDefault());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { flush(true); flushTug(true) } });
  init();
})();
