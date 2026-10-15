/* Smash for your team: a one-minute table tennis game.
   Top-down table. The opponent (top) always returns the ball; you (bottom) slide your paddle to return it.
   Targets appear on the opponent's side: hit one with your return for 1, 3 or 5 points, times your rally combo.
   Three misses or 60 seconds ends the game, and the score is added to your team's cheers. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get: k => { try { return localStorage.getItem(k) } catch (_) { return null } },
    set: (k, v) => { try { localStorage.setItem(k, v) } catch (_) {} },
  };
  const GAME_SECONDS = 60, LIVES = 3, MAX_CHEERS = 200, WIN_SCORE = 40;
  const cv = $("cv"), ctx = cv.getContext("2d");
  let CFG = {}, DB = "", TEAMS = [], team = null, W = 0, H = 0, S = 1, dpr = 1;
  let state = "idle", raf = 0, last = 0;
  let ball, padX, padTarget, oppX, targets, parts, pops, score, lives, combo, timeLeft, speed, serveT, missT, hits;

  const tname = t => (CFG.team_names && CFG.team_names[t]) || `Team ${t}`;
  const cap = t => (CFG.captains && CFG.captains[t]) || "";
  const art = (t, k) => (CFG.team_art && CFG.team_art[t] && CFG.team_art[t][k]) || "";
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const teamCol = t => css(`--t${t}`) || "#00F6ED";

  // ---------- layout ----------
  function size() {
    const stage = $("stage"), w = Math.min(stage.clientWidth, 520), h = Math.min(Math.round(w * 1.45), Math.max(420, innerHeight - stage.getBoundingClientRect().top - 70));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = `${w}px`; cv.style.height = `${h}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    W = w; H = h; S = w / 400;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (state !== "play") draw();
  }
  const M = () => 14 * S;                                   // table margin
  const padY = () => H - 46 * S, oppY = () => 40 * S, padW = () => 86 * S, padH = () => 12 * S, R = () => 8 * S;

  // ---------- sound ----------
  let audio = null;
  function beep(f, d = .06, v = .05, type = "triangle") {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = type; o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.linearRampToValueAtTime(v, t + .005); g.gain.exponentialRampToValueAtTime(.0001, t + d);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + d + .02);
    } catch (_) {}
  }

  // ---------- game ----------
  function reset() {
    score = 0; lives = LIVES; combo = 0; timeLeft = GAME_SECONDS; hits = 0;
    speed = H * .9; padX = padTarget = W / 2; oppX = W / 2;
    targets = []; parts = []; pops = [];
    for (let i = 0; i < 2; i++) targets.push(newTarget());
    serve(.6);
    hud();
  }
  function newTarget() {
    const roll = Math.random(), kind = roll < .15 ? 5 : roll < .5 ? 3 : 1;
    const r = (kind === 5 ? 17 : kind === 3 ? 23 : 30) * S, m = M() + r + 4 * S;
    let x, y, tries = 0;
    do { x = m + Math.random() * (W - 2 * m); y = oppY() + 40 * S + Math.random() * (H * .5 - oppY() - 80 * S); tries++ }
    while (tries < 20 && targets && targets.some(t => Math.hypot(t.x - x, t.y - y) < t.r + r + 12 * S));
    return { x, y, r, kind, born: performance.now(), life: kind === 5 ? 5000 : 8000 };
  }
  function serve(delay) {
    ball = { x: oppX, y: oppY() + padH() + R(), vx: 0, vy: 0, live: false };
    serveT = delay;
  }
  function launch() {
    const tx = M() + Math.random() * (W - 2 * M());
    const vy = speed, t = (padY() - ball.y) / vy;
    ball.vx = (tx - ball.x) / t; ball.vy = vy; ball.live = true;
    beep(520, .05, .04);
  }
  function burst(x, y, col, n, big) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (big ? 180 : 110) * S * (.4 + Math.random());
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, col, s: (2 + Math.random() * 3) * S });
    }
  }
  function flash(text, cls) {
    const f = $("flash"); f.textContent = text; f.className = `flash show ${cls || ""}`;
    clearTimeout(flash.t); flash.t = setTimeout(() => f.className = "flash", 900);
  }
  const tcol = k => k === 5 ? "#F5C451" : k === 3 ? "#E9806E" : "#00F6ED";   // same colours as the rules legend
  const mult = () => combo >= 10 ? 3 : combo >= 5 ? 2 : 1;

  function step(dt) {
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; return end() }
    padX += (padTarget - padX) * Math.min(1, dt * 22);
    padX = Math.max(M() + padW() / 2, Math.min(W - M() - padW() / 2, padX));
    oppX += ((ball.live && ball.vy < 0 ? ball.x : W / 2) - oppX) * Math.min(1, dt * 6);

    if (!ball.live) { ball.x = oppX; serveT -= dt; if (serveT <= 0) launch() }
    else {
      const py = ball.y;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      // side walls
      if (ball.x < M() + R()) { ball.x = M() + R(); ball.vx = Math.abs(ball.vx) }
      if (ball.x > W - M() - R()) { ball.x = W - M() - R(); ball.vx = -Math.abs(ball.vx) }
      // your paddle
      const top = padY() - padH() / 2;
      if (ball.vy > 0 && py + R() <= top && ball.y + R() >= top) {
        const off = (ball.x - padX) / (padW() / 2 + R());
        if (Math.abs(off) <= 1) {
          combo++; hits++;
          speed = Math.min(H * 1.9, speed * 1.035);
          const ang = off * 1.0;                                // up to about 57 degrees
          ball.vx = speed * Math.sin(ang); ball.vy = -speed * Math.cos(ang); ball.y = top - R();
          beep(780 + Math.min(combo, 15) * 30, .05, .05);
          burst(ball.x, top, "#ffffff", 6);
          if (combo === 5) flash("x2 combo!", "c2"); if (combo === 10) flash("x3 combo!", "c3");
          hud();
        }
      }
      // targets (only on the way up)
      if (ball.vy < 0) for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        if (Math.hypot(ball.x - t.x, ball.y - t.y) < t.r + R()) {
          const pts = t.kind * mult(); score += pts;
          pops.push({ x: t.x, y: t.y, txt: `+${pts}`, life: 1, col: t.kind === 5 ? "#F5C451" : "#ffffff" });
          burst(t.x, t.y, tcol(t.kind), t.kind === 5 ? 26 : 16, t.kind === 5);
          beep(t.kind === 5 ? 1320 : t.kind === 3 ? 1100 : 940, .12, .06, "square");
          if (t.kind === 5) flash("Bullseye!", "gold");
          targets.splice(i, 1); targets.push(newTarget()); hud();
        }
      }
      // opponent returns
      if (ball.vy < 0 && ball.y - R() <= oppY() + padH() / 2) {
        ball.y = oppY() + padH() / 2 + R();
        const tx = M() + R() + Math.random() * (W - 2 * M() - 2 * R()), vy = speed * .92, t = (padY() - ball.y) / vy;
        ball.vx = (tx - ball.x) / t; ball.vy = vy;
        beep(600, .04, .03);
      }
      // miss
      if (ball.y - R() > H) {
        lives--; combo = 0; hud(); beep(180, .25, .06, "sawtooth");
        flash(lives > 0 ? "Missed!" : "Out!", "miss");
        try { navigator.vibrate && navigator.vibrate(60) } catch (_) {}
        speed = Math.max(H * .9, speed * .85);
        if (lives <= 0) return end();
        serve(.9);
      }
    }
    // expire targets
    const now = performance.now();
    targets.forEach((t, i) => { if (now - t.born > t.life) targets[i] = newTarget() });
    parts.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .96; p.vy *= .96; p.life -= dt * 1.6 });
    parts = parts.filter(p => p.life > 0);
    pops.forEach(p => { p.y -= 40 * S * dt; p.life -= dt * 1.1 }); pops = pops.filter(p => p.life > 0);
    if (Math.ceil(timeLeft) !== hud.lastT) hud();
  }

  // ---------- drawing ----------
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h) }
  function draw() {
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    // floor and table
    ctx.fillStyle = "#132A40"; ctx.fillRect(0, 0, W, H);
    const m = M();
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#1C5A93"); g.addColorStop(1, "#204262");
    ctx.fillStyle = g; rr(m, m, W - 2 * m, H - 2 * m, 8 * S); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 3 * S; rr(m, m, W - 2 * m, H - 2 * m, 8 * S); ctx.stroke();
    ctx.lineWidth = 1.5 * S; ctx.strokeStyle = "rgba(255,255,255,.35)";
    ctx.beginPath(); ctx.moveTo(W / 2, m); ctx.lineTo(W / 2, H - m); ctx.stroke();
    // net
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fillRect(m - 6 * S, H / 2 - 2 * S, W - 2 * m + 12 * S, 4 * S);
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.fillRect(m, H / 2 + 2 * S, W - 2 * m, 6 * S);
    // targets
    const now = performance.now();
    if (targets) targets.forEach(t => {
      const age = (now - t.born) / t.life, pulse = 1 + Math.sin(now / 180) * .04, r = t.r * pulse * Math.min(1, (now - t.born) / 200);
      const col = tcol(t.kind);
      ctx.globalAlpha = age > .8 ? Math.max(.25, (1 - age) * 5) : 1;
      for (let k = 3; k >= 1; k--) { ctx.beginPath(); ctx.arc(t.x, t.y, r * k / 3, 0, Math.PI * 2); ctx.fillStyle = k % 2 ? col : "rgba(255,255,255,.92)"; ctx.fill() }
      ctx.fillStyle = "#0F1E2C"; ctx.font = `800 ${Math.round(r * .8)}px "Roboto Condensed",sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(t.kind, t.x, t.y + 1);
      ctx.globalAlpha = 1;
    });
    // paddles
    const drawPad = (x, y, col) => { ctx.fillStyle = col; rr(x - padW() / 2, y - padH() / 2, padW(), padH(), padH() / 2); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,.25)"; rr(x - padW() / 2 + 3 * S, y - padH() / 2 + 2 * S, padW() - 6 * S, padH() / 3, 3 * S); ctx.fill() };
    drawPad(oppX, oppY(), "#3a3f47");
    drawPad(padX, padY(), "#E23B3B");
    if (team) { ctx.fillStyle = teamCol(team); rr(padX - padW() / 2, padY() + padH() / 2 + 3 * S, padW(), 3 * S, 2 * S); ctx.fill() }
    // ball with shadow and a short trail
    if (ball) {
      ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(ball.x + 4 * S, ball.y + 6 * S, R(), R() * .7, 0, 0, Math.PI * 2); ctx.fill();
      if (ball.live) { ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.beginPath(); ctx.arc(ball.x - ball.vx * .025, ball.y - ball.vy * .025, R() * .8, 0, Math.PI * 2); ctx.fill() }
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(ball.x, ball.y, R(), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,170,60,.35)"; ctx.beginPath(); ctx.arc(ball.x - R() * .3, ball.y - R() * .3, R() * .45, 0, Math.PI * 2); ctx.fill();
    }
    // particles and score pops
    if (parts) parts.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.fillRect(p.x, p.y, p.s, p.s) });
    ctx.globalAlpha = 1;
    if (pops) pops.forEach(p => { ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.font = `800 ${Math.round(26 * S)}px "Roboto Condensed",sans-serif`; ctx.textAlign = "center"; ctx.fillText(p.txt, p.x, p.y) });
    ctx.globalAlpha = 1;
  }
  function loop(t) {
    const dt = Math.min(.033, (t - last) / 1000 || 0); last = t;
    if (state === "play") step(dt);
    draw();
    if (state === "play") raf = requestAnimationFrame(loop);
  }

  function hud() {
    $("score").textContent = score;
    const mu = mult(); $("combo").textContent = mu > 1 ? `x${mu} combo` : combo > 1 ? `${combo} rally` : "";
    $("combo").dataset.m = mu;
    $("lives").innerHTML = Array.from({ length: LIVES }, (_, i) => `<i class="${i < lives ? "" : "lost"}"></i>`).join("");
    hud.lastT = Math.ceil(timeLeft); $("time").textContent = hud.lastT;
    $("time").classList.toggle("low", timeLeft <= 10);
  }

  /* Power Play (data/config.json "smash_boost": { "from": "13:00", "multiplier": 3 }): during each tug of war pull from that
     time on, Smash points count several times over and also pull your team's rope. A game counts as Power Play if a pull
     was running when it started or when it ended. */
  let powerAtStart = null;
  const hhmm = d => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  function power(now) {
    const T = window.TTCheer, b = CFG.smash_boost; if (!T || !b) return null;
    now = now || new Date();
    const st = T.tug(CFG.tug_of_war, now), mult = Math.max(2, Number(b.multiplier) || 3), from = String(b.from || "00:00").padStart(5, "0");
    if (st && st.active && (T.test || hhmm(now) >= from)) return { active: true, mult, key: st.key, endsIn: st.endsIn };
    if (st && (st.soon || st.upcoming) && (T.test || hhmm(new Date(+now + st.startsIn)) >= from)) return { active: false, mult, at: st.at, startsIn: st.startsIn };
    if (st && st.done && !T.test) {                                // between pulls: look ahead to the next one
      const later = T.tug(CFG.tug_of_war, new Date(+now + 61000));
      if (later && (later.soon || later.upcoming) && hhmm(new Date(+now + 61000 + later.startsIn)) >= from) return { active: false, mult, at: later.at, startsIn: later.startsIn + 61000 };
    }
    return null;
  }
  function renderPower() {
    const p = power(), box = $("powerBox"), hud = $("hudPower");
    hud.hidden = !(p && p.active); hud.textContent = p ? `x${p.mult}` : "";
    if (!p) { box.hidden = true; return }
    box.hidden = false; box.classList.toggle("on", p.active);
    box.innerHTML = p.active ? `<b>Power Play!</b><span>Points count x${p.mult} and pull your team's rope · ${window.TTCheer.clock(p.endsIn)} left</span>`
      : `<b>Power Play at ${esc(p.at)}</b><span>During the tug of war, Smash points count x${p.mult} and pull your rope</span>`;
  }

  // ---------- screens ----------
  function show(id) { ["ovPick", "ovStart", "ovEnd"].forEach(x => $(x).hidden = x !== id) }
  function pick() {
    $("picks").innerHTML = TEAMS.map(t => `<button type="button" class="pk" data-t="${t}" style="--tc:var(--t${t})">${art(t, "run") ? `<img src="${esc(art(t, "run"))}" alt="">` : ""}<b>${esc(tname(t))}</b>${cap(t) ? `<span>${esc(cap(t))}</span>` : ""}</button>`).join("");
    show("ovPick");
  }
  function startScreen() {
    $("startTeam").textContent = tname(team);
    const img = $("startImg"); if (art(team, "run")) { img.src = art(team, "run"); img.hidden = false } else img.hidden = true;
    const best = Number(store.get("tt_smash_best")) || 0;
    $("bestTxt").textContent = best ? `Your best: ${best} points.` : "";
    $("hudTeam").innerHTML = `<i style="background:var(--t${team})"></i>${esc(tname(team))}`;
    state = "idle"; reset(); draw(); show("ovStart");
  }
  function start() {
    const p = power(); powerAtStart = p && p.active ? p : null;
    show(null); state = "play"; reset(); last = performance.now();
    cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
  }
  async function end() {
    state = "over"; cancelAnimationFrame(raf); draw();
    const best = Number(store.get("tt_smash_best")) || 0, isBest = score > best;
    if (isBest) store.set("tt_smash_best", score);
    const win = score >= WIN_SCORE;
    $("endKick").textContent = isBest && score > 0 ? "New personal best!" : timeLeft <= 0 ? "Time!" : "Game over";
    $("endScore").textContent = score;
    const img = $("endImg"), src = art(team, win ? "win" : "loss") || art(team, "run");
    if (src) { img.src = src; img.hidden = false } else img.hidden = true;
    $("endMsg").textContent = win ? `${cap(team) || tname(team)} is thrilled!` : score > 0 ? `${cap(team) || tname(team)} wants a rematch. ${WIN_SCORE} points makes the captain smile.` : "Hit the targets on the far side to score.";
    show("ovEnd");
    beep(win ? 1046 : 330, .3, .06);
    // Points become cheers for the team (doubled during a Cheer Rush, capped per game).
    const rush = window.TTCheer && window.TTCheer.rush(CFG.cheer_rush);
    const pEnd = power(), pp = pEnd && pEnd.active ? pEnd : powerAtStart;                  // Power Play beats Cheer Rush; they don't stack
    const mult = pp ? pp.mult : rush && rush.active ? 2 : 1;
    let cheers = Math.min(MAX_CHEERS * mult, score * mult);
    const el = $("endCheers");
    if (!cheers) { el.textContent = ""; return }
    if (!DB || !window.TTCheer) { el.textContent = "Cheering isn't open yet, so this score wasn't counted."; return }
    el.textContent = `Sending ${cheers} cheers to ${tname(team)}…`;
    await window.TTCheer.settle(DB);                             // anything left over from earlier games goes first
    let sent = 0;
    while (sent < cheers) {
      const n = Math.min(25, cheers - sent);
      if (!(await window.TTCheer.add(DB, team, n))) break;
      sent += n;
    }
    if (sent) {
      store.set(`tt_cheer_mine_${team}`, (Number(store.get(`tt_cheer_mine_${team}`)) || 0) + sent);
      store.set("tt_cheer_all", (Number(store.get("tt_cheer_all")) || 0) + sent);
    }
    let pulled = 0;
    if (pp && sent) {                                             // Power Play: the same points pull the rope
      while (pulled < sent) { const n = Math.min(25, sent - pulled); if (!(await window.TTCheer.addPath(DB, `tug/${pp.key}/${team}`, n))) break; pulled += n }
    }
    const left = cheers - sent;
    if (left) window.TTCheer.owe(team, left);                     // kept on this phone and sent on the next game or cheer page visit
    const refused = [401, 403].includes(window.TTCheer.lastStatus);
    el.textContent = !left ? `+${sent} cheers for ${tname(team)}${pp ? ` (Power Play x${pp.mult}${pulled ? `, +${pulled} on the rope` : ""})` : rush && rush.active ? " (Cheer Rush double!)" : ""}`
      : `${sent ? `+${sent} sent. ` : ""}${refused ? "Cheer meter not taking scores yet" : "No connection"}. ${left} cheers saved on this phone; they'll go through later.`;
    el.classList.toggle("warn", left > 0);
  }

  // ---------- input ----------
  const setX = clientX => { const r = cv.getBoundingClientRect(); padTarget = (clientX - r.left) * (W / r.width) };
  cv.addEventListener("pointerdown", e => { setX(e.clientX); try { cv.setPointerCapture(e.pointerId) } catch (_) {} });
  cv.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || e.buttons || e.pressure) setX(e.clientX) });
  addEventListener("keydown", e => {
    if (state !== "play") return;
    if (e.key === "ArrowLeft" || e.key === "a") { padTarget = padX - 60 * S; e.preventDefault() }
    if (e.key === "ArrowRight" || e.key === "d") { padTarget = padX + 60 * S; e.preventDefault() }
  });
  document.addEventListener("click", e => {
    const b = e.target.closest(".pk"); if (b) { team = Number(b.dataset.t); store.set("tt_cheer_team", team); startScreen() }
  });
  $("startBtn").onclick = () => { beep(660, .05, .03); start() };
  $("againBtn").onclick = () => start();
  $("changeTeam").onclick = () => pick();
  document.addEventListener("visibilitychange", () => { if (document.hidden && state === "play") { state = "paused"; cancelAnimationFrame(raf) } else if (!document.hidden && state === "paused") { state = "play"; last = performance.now(); raf = requestAnimationFrame(loop) } });
  addEventListener("resize", () => { const fx = W ? padX / W : .5; size(); if (padX != null) { padX = padTarget = fx * W } });

  async function init() {
    try { CFG = await fetch(`data/config.json?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json()) } catch (_) {}
    DB = String(CFG.cheer_db || "").trim();
    if (window.TTCheer && window.TTCheer.liveBanner(CFG, "game.html", document.querySelector("main"))) DB = "";
    TEAMS = Object.keys(CFG.captains || CFG.team_names || { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }).map(Number).sort((a, b) => a - b);
    size();
    if (DB && window.TTCheer) window.TTCheer.settle(DB);
    renderPower(); setInterval(renderPower, 1000);
    const saved = Number(store.get("tt_cheer_team"));
    if (TEAMS.includes(saved)) { team = saved; startScreen() } else pick();
  }
  window.ttSmash = { get state() { return { state, score, lives, combo, ball, padX, targets } }, setPad: x => { padTarget = x } };   // used by the automated playtest
  init();
})();
