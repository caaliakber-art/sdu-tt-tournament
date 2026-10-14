/* Cheer page: pick your team once, then every tap is a cheer. Taps are batched and sent
   as a server-side increment (at most 20 per send), so a fast tapper costs one write a second. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k) } catch (_) { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch (_) {} },
  };
  const BATCH = 20, MAX_PENDING = 40, FLUSH_MS = 900;
  let CFG = {}, DB = "", TEAMS = [], team = null, pending = 0, sending = false, mine = 0, totals = {};

  const tname = t => (CFG.team_names && CFG.team_names[t]) || `Team ${t}`;
  const cap = t => (CFG.captains && CFG.captains[t]) || "";
  const run = t => (CFG.team_art && CFG.team_art[t] && CFG.team_art[t].run) || "";
  const fmt = n => Number(n || 0).toLocaleString("en-IN");

  function renderPicks() {
    $("picks").innerHTML = TEAMS.map(t => `<button type="button" class="pickbtn" data-t="${t}" style="--tc:var(--t${t})">
      ${run(t) ? `<img src="${esc(run(t))}" alt="">` : ""}
      <span class="pk-name">${esc(tname(t))}</span>${cap(t) ? `<span class="pk-cap">Captain ${esc(cap(t))}</span>` : ""}</button>`).join("");
  }
  function choose(t) {
    team = t; store.set("tt_cheer_team", t);
    $("pick").hidden = true; $("go").hidden = false;
    const go = $("go"); go.style.setProperty("--tc", `var(--t${t})`);
    $("myTeam").innerHTML = `<i class="tsw"></i><b>${esc(tname(t))}</b>${cap(t) ? ` · Captain ${esc(cap(t))}` : ""}`;
    const img = $("cheerImg"); if (run(t)) { img.src = run(t); img.hidden = false } else img.hidden = true;
    mine = Number(store.get(`tt_cheer_mine_${t}`)) || 0;
    renderMine(); renderMeter();
  }
  function renderMine() {
    $("mine").textContent = fmt(mine);
    $("teamTotal").textContent = fmt((Number(totals[team]) || 0) + pending);
  }
  function renderMeter() {
    const rows = TEAMS.map(t => ({ t, n: (Number(totals[t]) || 0) + (t === team ? pending : 0) })).sort((a, b) => b.n - a.n || a.t - b.t);
    const top = Math.max(1, ...rows.map(r => r.n));
    $("meter").innerHTML = rows.map((r, i) => `<div class="mrow ${r.t === team ? "me" : ""}" style="--tc:var(--t${r.t})">
      <span class="mname"><i class="tsw"></i>${esc(tname(r.t))}${i === 0 && r.n > 0 ? '<em class="loud">Loudest</em>' : ""}</span>
      <span class="mbar"><b style="width:${(r.n / top * 100).toFixed(1)}%"></b></span><span class="mnum">${fmt(r.n)}</span></div>`).join("");
  }

  // Little bursts where the finger lands.
  const BITS = ["👏", "🔥", "🏓", "💪", "🎉"];
  function burst(x, y) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fx = $("fx");
    for (let i = 0; i < 3; i++) {
      const s = document.createElement("span");
      s.textContent = BITS[(Math.random() * BITS.length) | 0];
      s.style.left = `${x}px`; s.style.top = `${y}px`;
      s.style.setProperty("--dx", `${(Math.random() - .5) * 140}px`);
      s.style.setProperty("--dy", `${-90 - Math.random() * 110}px`);
      s.style.setProperty("--r", `${(Math.random() - .5) * 60}deg`);
      fx.appendChild(s); setTimeout(() => s.remove(), 900);
    }
  }
  function tap(e) {
    if (!team || pending >= MAX_PENDING) return;
    pending++; mine++; store.set(`tt_cheer_mine_${team}`, mine);
    const r = $("cheerBtn").getBoundingClientRect();
    burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
    const b = $("cheerBtn"); b.classList.remove("hit"); void b.offsetWidth; b.classList.add("hit");
    try { navigator.vibrate && navigator.vibrate(12) } catch (_) {}
    renderMine(); renderMeter();
  }
  async function flush(keepalive) {
    if (sending || !pending || !team || !DB) return;
    sending = true; const n = Math.min(pending, BATCH);
    const ok = await window.TTCheer.add(DB, team, n, keepalive);
    if (ok) pending -= n;
    sending = false;
    if (!ok) $("meterSub").textContent = "Reconnecting…";
  }

  async function init() {
    try { CFG = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json()) } catch (_) {}
    if (CFG.tournament) document.title = `Cheer for your team | ${CFG.tournament} | SDU`;
    DB = String(CFG.cheer_db || "").trim();
    TEAMS = Object.keys(CFG.captains || CFG.team_names || { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }).map(Number).sort((a, b) => a - b);
    renderPicks(); renderMeter();
    if (!DB) { $("intro").textContent = "Cheering opens soon. Check back on match day."; $("meterSub").textContent = "Not open yet"; return }
    window.TTCheer.watch(DB, d => { totals = d || {}; $("meterSub").textContent = "Live"; renderMine(); renderMeter() });
    const saved = Number(store.get("tt_cheer_team"));
    if (TEAMS.includes(saved)) choose(saved); else $("pick").hidden = false;
    setInterval(() => flush(false), FLUSH_MS);
  }

  document.addEventListener("click", e => { const b = e.target.closest(".pickbtn"); if (b) choose(Number(b.dataset.t)) });
  $("change").onclick = () => { flush(false); team = null; $("go").hidden = true; $("pick").hidden = false; renderMeter() };
  $("cheerBtn").addEventListener("pointerdown", tap);
  $("cheerBtn").addEventListener("keydown", e => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); tap(e) } });
  $("cheerBtn").addEventListener("click", e => e.preventDefault());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(true) });
  init();
})();
