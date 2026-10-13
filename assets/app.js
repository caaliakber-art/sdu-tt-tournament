/* SDU TT Tournament site. Reads data/fixtures.json, data/results.json and data/config.json.
   Scores refresh automatically; the page never needs a reload during the tournament. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k) { try { return localStorage.getItem(k) } catch (_) { return null } }, set(k, v) { try { localStorage.setItem(k, v) } catch (_) {} } };

  let FX = null, RES = { results: {} }, CFG = {}, R = {};
  let EVENTS = [], ROSTER = {}, MATCHES = [];
  const TEAMS = [1, 2, 3, 4, 5, 6];
  let curEv = store.get("tt_ev") || "MD1", feedMode = "res", tvIdx = 0, tvTimer = null, lastUpdated = null;

  const teamName = t => (CFG.team_names && CFG.team_names[t]) || `Team ${t}`;
  const chip = t => `<span class="tchip" style="--tc:var(--t${t})"><i></i>${esc(teamName(t))}</span>`;
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
    return rows.sort((x, y) => y.w - x.w || y.pf - x.pf || (y.pf - y.pa) - (x.pf - x.pa) || x.t - y.t);
  }
  // Q = top 4 in every possible outcome of the remaining matches; E = cannot reach top 4.
  function status(f) {
    const base = {}; TEAMS.forEach(t => base[t] = 0);
    const rem = [];
    for (const m of MATCHES) { if (m.f !== f) continue; const r = R[m.id]; if (r) base[r[0] > r[1] ? m.a : m.b]++; else rem.push(m) }
    const thru = {}, out = {}; TEAMS.forEach(t => { thru[t] = true; out[t] = true });
    if (rem.length > 16) { TEAMS.forEach(t => { thru[t] = false; out[t] = false }) }
    else for (let mask = 0; mask < (1 << rem.length); mask++) {
      const w = { ...base };
      for (let i = 0; i < rem.length; i++) w[(mask >> i) & 1 ? rem[i].a : rem[i].b]++;
      for (const t of TEAMS) {
        let ge = 0, gt = 0;
        for (const o of TEAMS) { if (o === t) continue; if (w[o] >= w[t]) ge++; if (w[o] > w[t]) gt++ }
        if (ge > 3) thru[t] = false; if (gt < 4) out[t] = false;
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
    $("progTxt").textContent = `League stage · ${played} of ${MATCHES.length} matches played`;
    $("progBar").style.width = (MATCHES.length ? played / MATCHES.length * 100 : 0) + "%";
    if (RES.updated) {
      const d = new Date(RES.updated);
      $("liveTxt").textContent = isNaN(d) ? "Live" : `Updated ${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
  function renderTop() {
    const s = {}; TEAMS.forEach(t => s[t] = { t, p: 0, w: 0, pf: 0 });
    for (const m of MATCHES) { const r = R[m.id]; if (!r) continue; s[m.a].p++; s[m.b].p++; s[m.a].pf += r[0]; s[m.b].pf += r[1]; s[r[0] > r[1] ? m.a : m.b].w++ }
    const order = Object.values(s).sort((a, b) => b.w - a.w || b.pf - a.pf || a.t - b.t);
    $("teamTbl").tBodies[0].innerHTML = order.map((r, i) => `<tr><td class="rk">${i + 1}</td><td class="l">${chip(r.t)}</td><td>${r.p}</td><td class="big">${r.w}</td><td>${r.p - r.w}</td></tr>`).join("");
    if (feedMode === "res") {
      $("rTitle").textContent = "Recent results";
      const list = MATCHES.filter(m => R[m.id]).sort((a, b) => b.id - a.id).slice(0, 6);
      $("feed").innerHTML = list.length ? list.map(m => `<li><span class="meta"><span class="tag">${esc(m.f)}</span>${slotTxt(m)}</span>${pairLine(m, R[m.id])}</li>`).join("") : '<li class="empty">No results yet.</li>';
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
    $("stand").tBodies[0].innerHTML = tb.map((r, i) => `<tr class="${i === 3 ? "cut" : ""}"><td class="rk">${i + 1}</td><td class="l"><div class="nm">${esc(nm(f, r.t))}</div>${chip(r.t)}</td><td>${r.p}</td><td class="big">${r.w}</td><td>${r.l}</td><td>${r.pf}</td><td>${r.pa}</td><td class="c">${qBadge(st[r.t])}</td></tr>`).join("");
    $("evMatches").innerHTML = ms.slice().sort((x, y) => (!!R[y.id]) - (!!R[x.id]) || x.id - y.id).map(m => `<li><span class="meta">${slotTxt(m)}</span>${pairLine(m, R[m.id])}</li>`).join("");
    renderBracket(f);
  }
  function renderBracket(f) {
    let ties, title;
    const fam = f.replace(/\d$/, ""), hasPair = /\d$/.test(f) && EVENTS.some(e => e.k === fam + "1") && EVENTS.some(e => e.k === fam + "2");
    if (!hasPair) {
      const tb = table(f); title = "Semifinal draw (projected)";
      ties = [["SF1", f, tb[0].t, 1, f, tb[3].t, 4], ["SF2", f, tb[1].t, 2, f, tb[2].t, 3]];
    } else {
      const f1 = fam + "1", f2 = fam + "2", t1 = table(f1), t2 = table(f2);
      title = `${evName(f1).replace(/\s*1$/, "")} quarterfinal draw (projected)`;
      ties = [0, 1, 2, 3].map(i => ["QF" + (i + 1), f1, t1[i].t, i + 1, f2, t2[3 - i].t, 4 - i]);
    }
    $("brTitle").textContent = title;
    $("bracket").innerHTML = ties.map(([l, fa, ta, sa, fb, tb, sb]) => {
      const tag = (ff, s) => fa === fb ? `#${s}` : `${ff} #${s}`;
      return `<div class="tie"><span class="lab">${l}</span><span class="p"><span>${esc(nm(fa, ta))}<span class="seed">${tag(fa, sa)}</span></span>${chip(ta)}</span><span class="p"><span>${esc(nm(fb, tb))}<span class="seed">${tag(fb, sb)}</span></span>${chip(tb)}</span></div>`;
    }).join("");
  }

  /* ---------- TEAMS ---------- */
  function renderTeams() {
    const wins = {}, played = {}, pf = {}; TEAMS.forEach(t => { wins[t] = 0; played[t] = 0; pf[t] = 0 });
    for (const m of MATCHES) { const r = R[m.id]; if (!r) continue; played[m.a]++; played[m.b]++; pf[m.a] += r[0]; pf[m.b] += r[1]; wins[r[0] > r[1] ? m.a : m.b]++ }
    const order = [...TEAMS].sort((a, b) => wins[b] - wins[a] || pf[b] - pf[a] || a - b);
    const ord = n => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || "th");
    const tables = {}; EVENTS.forEach(e => tables[e.k] = table(e.k));
    $("teamGrid").innerHTML = order.map((t, i) => {
      const cap = CFG.captains && CFG.captains[t];
      const rows = EVENTS.map(e => {
        const pos = tables[e.k].findIndex(r => r.t === t) + 1, row = tables[e.k][pos - 1];
        return `<tr><td class="ev">${esc(e.k)}</td><td class="l">${esc(nm(e.k, t))}</td><td>${row.p ? ord(pos) : "–"}</td><td>${row.w}-${row.l}</td></tr>`;
      }).join("");
      return `<div class="card tcard" style="--tc:var(--t${t})"><div class="thead"><span class="sw"></span><div><h3>${esc(teamName(t))}</h3><div class="cap">${cap ? `Captain: ${esc(cap)}` : `${played[t]} played · ${wins[t]} won`}</div></div><div class="rank">${ord(i + 1)}<small>${wins[t]} win${wins[t] === 1 ? "" : "s"}</small></div></div>
        <div class="tablewrap"><table><thead><tr><th class="l">Event</th><th class="l">Player / Pair</th><th>Pos</th><th>W-L</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }).join("");
  }

  /* ---------- PHOTOS ---------- */
  function renderPhotos() {
    const set = (a, soon, url) => { if (url) { $(a).href = url; $(a).hidden = false; $(soon).hidden = true } else { $(a).hidden = true; $(soon).hidden = false } };
    set("photoUp", "photoUpSoon", CFG.photos_upload_url);
    set("photoAlbum", "photoAlbumSoon", CFG.photos_album_url);
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
    if (CFG.availability_form_url) { $("formLink").href = CFG.availability_form_url; $("formLink").hidden = false; $("formSoon").hidden = true }
    else { $("formLink").hidden = true; $("formSoon").hidden = false }
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
      const head = `<h4>${esc(evName(f))}<span class="sub">${esc(entry)} · ${esc(teamName(t))}${done.length ? ` · ${pos}${["th", "st", "nd", "rd"][pos] || "th"} in group` : ""}</span></h4>`;
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
    VIEWS.forEach(x => $("view-" + x).hidden = x !== v);
    document.querySelectorAll(".nav a").forEach(a => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current") });
  }
  function renderAll() { if (!FX) return; renderHeader(); renderTop(); renderEvent(); renderTeams(); renderPhotos(); renderAvailability() }

  let wake = null;
  function tvTick() { curEv = EVENTS[tvIdx % EVENTS.length].k; tvIdx++; renderEvent() }
  async function setTv(on) {
    document.documentElement.classList.toggle("tv", on);
    $("tvBtn").textContent = on ? "Exit TV mode" : "TV mode";
    clearInterval(tvTimer);
    if (on) {
      VIEWS.forEach(x => $("view-" + x).hidden = x !== "home");
      tvTick(); tvTimer = setInterval(tvTick, 12000);
      try { await document.documentElement.requestFullscreen() } catch (_) {}
      try { wake = await navigator.wakeLock.request("screen") } catch (_) {}
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch (_) {}
      try { wake && wake.release() } catch (_) {}
      route();
    }
  }
  let toastT = null;
  function toast(msg) { $("toast").textContent = msg; $("toast").hidden = false; clearTimeout(toastT); toastT = setTimeout(() => $("toast").hidden = true, 9000) }

  async function getJSON(path) { const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error(path + " " + r.status); return r.json() }
  async function refresh(first) {
    try {
      const [fx, res, cfg] = await Promise.all([getJSON("data/fixtures.json"), getJSON("data/results.json"), getJSON("data/config.json")]);
      const newIds = first ? [] : Object.keys(res.results || {}).filter(k => !R[k]);
      FX = fx; RES = res; CFG = cfg || {};
      EVENTS = fx.events; ROSTER = fx.roster; MATCHES = fx.matches; R = res.results || {};
      if (CFG.tournament) { $("title").textContent = CFG.tournament; document.title = CFG.tournament + " | SDU" }
      $("live").classList.remove("off");
      if (newIds.length) {
        const m = MATCHES.find(x => String(x.id) === newIds[newIds.length - 1]);
        if (m) { const r = R[m.id], w = r[0] > r[1] ? m.a : m.b; toast(newIds.length > 1 ? `${newIds.length} new results in` : `${nm(m.f, w)} (${teamName(w)}) win ${Math.max(...r)}-${Math.min(...r)} · ${evName(m.f)}`) }
      }
      if (first || res.updated !== lastUpdated) renderAll();
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
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.documentElement.classList.contains("tv")) setTv(false) });
  window.addEventListener("hashchange", route);

  route();
  refresh(true).then(() => {
    const every = Math.max(20, Number(CFG.refresh_seconds) || 60) * 1000;
    setInterval(() => refresh(false), every);
  });
})();
