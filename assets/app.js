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
      $("liveTxt").textContent = isNaN(d) ? "Live" : `Updated ${d.getDate()} ${MON[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
  // Best Team scoring, as in the scorecard: 1 per league win, 1 per quarterfinal or semifinal win,
  // 5 for an event title, 3 for runner-up (a final win does not also earn the 1 point).
  function teamScores() {
    const s = {}; TEAMS.forEach(t => s[t] = { t, lw: 0, ko: 0, bonus: 0, d: 0 });
    for (const m of MATCHES) { const r = R[m.id]; if (!r) continue; s[r[0] > r[1] ? m.a : m.b].lw++; s[m.a].d += r[0] - r[1]; s[m.b].d += r[1] - r[0] }
    for (const k of KO) {
      if (!k.winner) continue;
      const wt = k.winner === 1 ? k.t1 : k.t2, lt = k.winner === 1 ? k.t2 : k.t1;
      if (/^final/i.test(k.round)) { if (s[wt]) s[wt].bonus += 5; if (s[lt]) s[lt].bonus += 3 }
      else if (s[wt]) s[wt].ko++;
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
  function renderTop() {
    const order = teamScores();
    let rank = 0, prev = null; const ranks = {};
    order.forEach((r, i) => { if (r.pts !== prev) { rank = i + 1; prev = r.pts } ranks[r.t] = rank });
    const moves = rankMoves(ranks);
    const mv = t => moves[t] > 0 ? `<span class="mv up" title="Up ${moves[t]}">▲${moves[t]}</span>` : moves[t] < 0 ? `<span class="mv down" title="Down ${-moves[t]}">▼${-moves[t]}</span>` : "";
    $("teamTbl").tBodies[0].innerHTML = order.map(r => `<tr class="${ranks[r.t] === 1 ? "lead" : ""}"><td class="rk">${ranks[r.t]}${mv(r.t)}</td><td class="l">${teamBlock(r.t)}${ranks[r.t] === 1 ? '<span class="leadtag">Leader</span>' : ""}</td><td>${r.lw}</td><td>${r.ko}</td><td>${r.bonus}</td><td class="big">${r.pts}</td></tr>`).join("");
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
      return `<div class="card tcard" style="--tc:var(--t${t})"><div class="thead">${teamBlock(t, "lg")}<div class="rank">${ord(trank[t])}<small>${tpts[t]} pts</small></div></div>
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
    VIEWS.forEach(x => $("view-" + x).hidden = x !== v);
    document.querySelectorAll(".nav a").forEach(a => { if (a.dataset.view === v) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current") });
  }
  function renderAll() { if (!FX) return; renderHeader(); renderTop(); renderEvent(); renderTeams(); renderPhotos(); renderAvailability() }

  /* TV slideshow: overview, then each event (group table + knockout), then the team cards. */
  let wake = null, tvSlide = -1, tvDur = 12000;
  const isTv = () => document.documentElement.classList.contains("tv");
  const slides = () => [{ k: "overview", label: "Team standings and results" }, ...(spotlight() ? [{ k: "spot", label: "Spotlight" }] : []), ...EVENTS.map(e => ({ k: "event", ev: e.k, label: e.n })), { k: "teams", label: "Teams" }];
  function showSlide(i) {
    if (!EVENTS.length) return;
    const list = slides(); tvSlide = ((i % list.length) + list.length) % list.length; const s = list[tvSlide];
    document.documentElement.dataset.slide = s.k;
    const mainEl = document.querySelector("main"); mainEl.classList.remove("enter"); void mainEl.offsetWidth; mainEl.classList.add("enter");
    VIEWS.forEach(x => $("view-" + x).hidden = x !== (s.k === "teams" ? "teams" : "home"));
    if (s.k === "event") { curEv = s.ev; renderEvent() }
    if (s.k === "spot") { const m = spotlight(); if (m) showMoment(m, true) } else if (spotOn && !celBusy) hideMoment();
    $("tvLabel").textContent = s.label;
    $("tvDots").innerHTML = list.map((_, j) => `<i class="${j === tvSlide ? "on" : ""}"></i>`).join("");
    const bar = $("tvProg"); bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = `tvprog ${tvDur}ms linear forwards`;
    window.scrollTo(0, 0);
  }
  function tvTick() { showSlide(tvSlide + 1) }
  function tvRestart() { clearInterval(tvTimer); tvTimer = setInterval(tvTick, tvDur) }
  async function setTv(on) {
    document.documentElement.classList.toggle("tv", on);
    $("tvBtn").textContent = on ? "Exit TV mode" : "TV mode";
    clearInterval(tvTimer);
    if (on) {
      tvDur = Math.max(5, Number(CFG.tv_seconds) || 12) * 1000;
      tvSlide = -1; tvTick(); tvRestart();
      try { await document.documentElement.requestFullscreen() } catch (_) {}
      try { wake = await navigator.wakeLock.request("screen") } catch (_) {}
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch (_) {}
      try { wake && wake.release() } catch (_) {}
      delete document.documentElement.dataset.slide; tvSlide = -1;
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
    return { kick: "Winner", tag: `${evName(m.f)} · ${dayTxt(m.day)}`, name: nm(m.f, w), team: w, loser: nm(m.f, l), sa: Math.max(...r), sb: Math.min(...r), sets: "", big: false };
  }
  function koMoment(k) {
    const w = k.winner, final = /^final/i.test(k.round);
    return { kick: final ? "Champions" : `${k.round} winner`, tag: `${k.format} · ${k.round}`, name: w === 1 ? k.c1 : k.c2, team: w === 1 ? k.t1 : k.t2, loser: w === 1 ? k.c2 : k.c1,
      sa: w === 1 ? k.w1 : k.w2, sb: w === 1 ? k.w2 : k.w1, sets: k.sets.map(p => w === 1 ? `${p[0]}-${p[1]}` : `${p[1]}-${p[0]}`).join("  ·  "), big: final };
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
  function countUp(el, to, ms) {
    if (to == null || to === "") { el.textContent = ""; return }
    if (reduceMotion()) { el.textContent = to; return }
    const t0 = performance.now();
    (function f(t) { const k = Math.min(1, (t - t0) / ms); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(f) })(t0);
  }
  let spotOn = false;
  function showMoment(m, asSlide) {
    const el = $("celebrate"); spotOn = !!asSlide;
    el.style.setProperty("--wc", TEAMCOL(m.team));
    $("celKick").textContent = m.kick; $("celTag").textContent = m.tag;
    $("celTrophy").hidden = !m.big;
    $("celName").innerHTML = m.name.split(" ").map((w, i) => `<span style="animation-delay:${.25 + i * .09}s">${esc(w)}</span>`).join(" ");
    countUp($("celA"), m.sa, 1100); countUp($("celB"), m.sb, 1100);
    $("celSets").textContent = m.sets || "";
    $("celVs").textContent = m.loser && !/^tbd$/i.test(m.loser) ? `beat ${m.loser}` : "";
    $("celTeam").innerHTML = m.team ? teamBlock(m.team, "cel", true) : "";
    el.classList.toggle("big", !!m.big); el.classList.toggle("slide", !!asSlide);
    el.hidden = false; el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    burst(m.big, TEAMCOL(m.team));
  }
  function hideMoment() { spotOn = false; fxRun++; $("celebrate").hidden = true }
  let celQueue = [], celBusy = false;
  function celebrate(list) {
    chime(list.some(x => x.big));
    if (!isTv()) { const m = list[0]; toast(list.length > 1 ? `${list.length} new results in` : `${m.name} (${teamName(m.team)}) win ${m.sa}-${m.sb} · ${m.tag}`); return }
    celQueue.push(...list.slice(0, 4)); if (!celBusy) nextCel();
  }
  function nextCel() {
    const m = celQueue.shift(); if (!m) { celBusy = false; hideMoment(); return }
    celBusy = true; clearInterval(tvTimer);                  // pause the slideshow while celebrating
    showMoment(m, false);
    setTimeout(() => { if (!celQueue.length) { celBusy = false; hideMoment(); if (isTv()) { showSlide(tvSlide); tvRestart() } } else nextCel() }, m.big ? 10000 : 7000);
  }

  let toastT = null;
  function toast(msg) { $("toast").textContent = msg; $("toast").hidden = false; clearTimeout(toastT); toastT = setTimeout(() => $("toast").hidden = true, 9000) }

  async function getJSON(path) { const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) throw new Error(path + " " + r.status); return r.json() }
  async function refresh(first) {
    try {
      const [fx, res, cfg, ko] = await Promise.all([getJSON("data/fixtures.json"), getJSON("data/results.json"), getJSON("data/config.json"), getJSON("data/knockout.json").catch(() => ({ ties: [] }))]);
      const newIds = first ? [] : Object.keys(res.results || {}).filter(k => !R[k]);
      const koKey = k => `${k.format}|${k.round}`;
      const prevKo = new Set(KO.filter(k => k.winner).map(koKey));
      const newKo = first ? [] : ((ko && ko.ties) || []).filter(k => k.winner && !prevKo.has(koKey(k)));
      FX = fx; RES = res; CFG = cfg || {};
      EVENTS = fx.events; ROSTER = fx.roster; MATCHES = fx.matches; R = res.results || {}; KO = (ko && ko.ties) || [];
      if (CFG.tournament) { $("title").textContent = CFG.tournament; document.title = CFG.tournament + " | SDU" }
      $("live").classList.remove("off");
      newIds.forEach(id => fresh.set(String(id), Date.now()));
      if (first || res.updated !== lastUpdated) renderAll();
      const moments = newKo.map(koMoment).concat(newIds.map(id => MATCHES.find(x => String(x.id) === id)).filter(Boolean).map(leagueMoment));
      if (moments.length) celebrate(moments);
      if (isTv()) { if (first) tvDur = Math.max(5, Number(CFG.tv_seconds) || 12) * 1000; if (tvSlide < 0) { showSlide(0); tvRestart() } }
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
  window.ttDemo = big => celebrate([big ? { kick: "Champions", tag: "Mixed Doubles · Final", name: "Sample Pair + Winners", team: 3, loser: "Sample Runners-up", sa: 2, sb: 1, sets: "15-12  ·  13-15  ·  15-11", big: true }
                                          : { kick: "Winner", tag: "Men's Doubles 1 · Day 8", name: "Sample Pair + Winners", team: 4, loser: "Sample Opponents", sa: 21, sb: 18, sets: "", big: false }]);
  document.addEventListener("keydown", e => {
    if (!isTv()) return;
    if (e.key === "Escape") setTv(false);
    else if (e.key === "ArrowRight") { showSlide(tvSlide + 1); tvRestart() }
    else if (e.key === "ArrowLeft") { showSlide(tvSlide - 1); tvRestart() }
  });
  window.addEventListener("hashchange", route);

  route();
  refresh(true).then(() => {
    const every = Math.max(20, Number(CFG.refresh_seconds) || 60) * 1000;
    setInterval(() => refresh(false), every);
  });
})();
