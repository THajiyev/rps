(() => {
  'use strict';

  const TYPES = ['rock', 'paper', 'scissors'];
  const NAMES = ['Rock', 'Paper', 'Scissors'];
  const EMOJI = ['🪨', '📄', '✂️'];
  const TINT = [0.75, 0.8, 0.22];
  const PREY = t => (t + 2) % 3;
  const PREDATOR = t => (t + 1) % 3;

  const SIZES = {
    small: { w: 480, h: 480, def: 12, max: 40 },
    medium: { w: 760, h: 540, def: 25, max: 75 },
    large: { w: 1000, h: 700, def: 50, max: 130 },
  };

  const R = 13;
  const SPEED = 70;
  const VISION = 170;
  const CELL = R * 2;
  const HIST_INTERVAL = 0.1;
  const HIST_MAX = 600;

  const $ = id => document.getElementById(id);
  const canvas = $('arena');
  const ctx = canvas.getContext('2d');
  const histCanvas = $('history');
  const hctx = histCanvas.getContext('2d');
  const arenaWrap = $('arenaWrap');
  const playBtn = $('playBtn');
  const resetBtn = $('resetBtn');
  const timerEl = $('timer');
  const overlay = $('overlay');
  const perTeam = $('perTeam');
  const perTeamOut = $('perTeamOut');
  const customToggle = $('customToggle');
  const customFields = $('customFields');
  const customInputs = [...customFields.querySelectorAll('input')];
  const customHint = $('customHint');
  const speedInput = $('speed');
  const speedOut = $('speedOut');
  const huntInput = $('hunt');
  const sizeButtons = [...document.querySelectorAll('#sizeGroup button')];
  const barCols = TYPES.map(t => document.querySelector(`.bar-col[data-type="${t}"]`));

  const settings = {
    size: 'medium',
    perTeam: SIZES.medium.def,
    custom: false,
    counts: [SIZES.medium.def, SIZES.medium.def, SIZES.medium.def],
    speed: 1,
    hunt: false,
  };

  const world = { w: 760, h: 540, scale: 1 };
  let players = [];
  let counts = [0, 0, 0];
  let running = false;
  let finished = false;
  let simTime = 0;
  let conversions = 0;
  let history = [];
  let histStep = HIST_INTERVAL;
  let nextHist = 0;
  let dirty = true;
  let sprites = [];
  let colors = [];

  function teamCounts() {
    return settings.custom ? settings.counts.slice() : [settings.perTeam, settings.perTeam, settings.perTeam];
  }

  function setup() {
    const cfg = SIZES[settings.size];
    let w = cfg.w, h = cfg.h;
    if (w > h && window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches) {
      [w, h] = [h, w];
    }
    world.w = w;
    world.h = h;
    canvas.style.aspectRatio = `${w} / ${h}`;
    arenaWrap.style.maxWidth = Math.round(w * 1.15) + 'px';

    players = [];
    const want = teamCounts();
    for (let t = 0; t < 3; t++) {
      for (let i = 0; i < want[t]; i++) players.push(spawn(t));
    }

    running = false;
    finished = false;
    simTime = 0;
    conversions = 0;
    histStep = HIST_INTERVAL;
    nextHist = 0;
    history = [];
    overlay.hidden = true;
    recount();
    sampleHistory();
    resizeCanvas();
    updateUI();
    dirty = true;
  }

  function spawn(t) {
    let x, y;
    for (let attempt = 0; attempt < 40; attempt++) {
      x = R + Math.random() * (world.w - 2 * R);
      y = R + Math.random() * (world.h - 2 * R);
      if (!players.some(p => (p.x - x) ** 2 + (p.y - y) ** 2 < (2 * R) ** 2)) break;
    }
    const a = Math.random() * Math.PI * 2;
    return { x, y, vx: Math.cos(a) * SPEED, vy: Math.sin(a) * SPEED, t, flash: 0 };
  }

  function step(dt) {
    const n = players.length;

    for (let i = 0; i < n; i++) {
      const p = players[i];
      if (settings.hunt) steer(p, dt);
      else {
        const a = (Math.random() - 0.5) * 1.2 * dt;
        const c = Math.cos(a), s = Math.sin(a);
        const vx = p.vx * c - p.vy * s;
        p.vy = p.vx * s + p.vy * c;
        p.vx = vx;
      }
      const sp = Math.hypot(p.vx, p.vy) || 1;
      p.vx = (p.vx / sp) * SPEED;
      p.vy = (p.vy / sp) * SPEED;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < R) { p.x = R; p.vx = Math.abs(p.vx); }
      else if (p.x > world.w - R) { p.x = world.w - R; p.vx = -Math.abs(p.vx); }
      if (p.y < R) { p.y = R; p.vy = Math.abs(p.vy); }
      else if (p.y > world.h - R) { p.y = world.h - R; p.vy = -Math.abs(p.vy); }
      if (p.flash > 0) p.flash -= dt;
    }

    const cols = Math.ceil(world.w / CELL);
    const rows = Math.ceil(world.h / CELL);
    const head = new Int32Array(cols * rows).fill(-1);
    const next = new Int32Array(n);
    const cellX = new Int32Array(n);
    const cellY = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, (players[i].x / CELL) | 0);
      const cy = Math.min(rows - 1, (players[i].y / CELL) | 0);
      cellX[i] = cx;
      cellY[i] = cy;
      const c = cy * cols + cx;
      next[i] = head[c];
      head[c] = i;
    }

    for (let i = 0; i < n; i++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cy = cellY[i] + dy;
        if (cy < 0 || cy >= rows) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = cellX[i] + dx;
          if (cx < 0 || cx >= cols) continue;
          for (let j = head[cy * cols + cx]; j !== -1; j = next[j]) {
            if (j > i) collide(players[i], players[j]);
          }
        }
      }
    }
  }

  function collide(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    const min = 2 * R;
    if (d2 >= min * min || d2 === 0) return;

    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    const push = (min - d) / 2;
    a.x -= nx * push; a.y -= ny * push;
    b.x += nx * push; b.y += ny * push;

    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) {
      a.vx += rv * nx; a.vy += rv * ny;
      b.vx -= rv * nx; b.vy -= rv * ny;
    }

    if (a.t !== b.t) {
      if ((a.t - b.t + 3) % 3 === 1) convert(b, a.t);
      else convert(a, b.t);
    }
  }

  function convert(p, t) {
    counts[p.t]--;
    counts[t]++;
    p.t = t;
    p.flash = 0.35;
    conversions++;
  }

  function steer(p, dt) {
    const prey = PREY(p.t), pred = PREDATOR(p.t);
    let preyD = VISION * VISION, predD = VISION * VISION;
    let preyP = null, predP = null;
    for (const q of players) {
      if (q.t === p.t) continue;
      const d2 = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
      if (q.t === prey && d2 < preyD) { preyD = d2; preyP = q; }
      else if (q.t === pred && d2 < predD) { predD = d2; predP = q; }
    }
    let ax = 0, ay = 0;
    if (preyP) {
      const d = Math.sqrt(preyD) || 1;
      ax += (preyP.x - p.x) / d;
      ay += (preyP.y - p.y) / d;
    }
    if (predP) {
      const d = Math.sqrt(predD) || 1;
      const urgency = 1.3 * (1 - d / VISION) + 0.3;
      ax -= ((predP.x - p.x) / d) * urgency;
      ay -= ((predP.y - p.y) / d) * urgency;
    }
    ax += (Math.random() - 0.5) * 0.6;
    ay += (Math.random() - 0.5) * 0.6;
    const k = Math.min(1, 3 * dt);
    p.vx += (ax * SPEED - p.vx) * k;
    p.vy += (ay * SPEED - p.vy) * k;
  }

  function recount() {
    counts = [0, 0, 0];
    for (const p of players) counts[p.t]++;
  }

  function sampleHistory() {
    const total = players.length || 1;
    history.push([counts[0] / total, counts[1] / total, counts[2] / total]);
    if (history.length > HIST_MAX) {
      history = history.filter((_, i) => i % 2 === 0);
      histStep *= 2;
    }
  }

  function checkWinner() {
    const total = players.length;
    if (!total) return;
    const alive = counts.filter(c => c > 0).length;
    if (alive > 1) return;
    finished = true;
    running = false;
    const w = counts.findIndex(c => c > 0);
    $('winEmoji').textContent = EMOJI[w];
    $('winText').textContent = `${NAMES[w]} ${w === 2 ? 'win' : 'wins'}!`;
    $('winSub').textContent = `${formatTime(simTime)} · ${conversions} conversion${conversions === 1 ? '' : 's'}`;
    overlay.hidden = false;
  }

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = TYPES.map(t => cs.getPropertyValue('--' + t).trim());
  }

  function buildSprites() {
    const size = Math.ceil(2 * R * world.scale);
    sprites = TYPES.map((_, t) => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.fillStyle = colors[t];
      g.globalAlpha = TINT[t];
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      g.font = `${Math.round(size * 0.74)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(EMOJI[t], size / 2, size / 2 + size * 0.04);
      return c;
    });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || world.w;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * dpr * (world.h / world.w));
    world.scale = canvas.width / world.w;
    readColors();
    buildSprites();
    resizeHistory();
    dirty = true;
  }

  function draw() {
    const s = world.scale;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const half = R * s;
    for (const p of players) {
      const x = p.x * s, y = p.y * s;
      if (p.flash > 0) {
        const k = p.flash / 0.35;
        ctx.strokeStyle = colors[p.t];
        ctx.globalAlpha = k;
        ctx.lineWidth = 2 * s;
        ctx.beginPath();
        ctx.arc(x, y, half * (1 + (1 - k) * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(sprites[p.t], x - half, y - half);
    }
  }

  function resizeHistory() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    histCanvas.width = Math.round(histCanvas.clientWidth * dpr);
    histCanvas.height = Math.round(histCanvas.clientHeight * dpr);
    drawHistory();
  }

  function drawHistory() {
    const W = histCanvas.width, H = histCanvas.height;
    hctx.clearRect(0, 0, W, H);
    if (history.length < 2) {
      let y = 0;
      for (let t = 2; t >= 0; t--) {
        const h = (history[0] ? history[0][t] : 1 / 3) * H;
        hctx.fillStyle = colors[t];
        hctx.fillRect(0, y, W, h);
        y += h;
      }
      return;
    }
    const n = history.length;
    const xAt = i => (i / (n - 1)) * W;
    for (let t = 0; t < 3; t++) {
      hctx.beginPath();
      for (let i = 0; i < n; i++) {
        let top = 0;
        for (let k = 0; k <= t; k++) top += history[i][k];
        const y = H - top * H;
        if (i === 0) hctx.moveTo(xAt(i), y); else hctx.lineTo(xAt(i), y);
      }
      for (let i = n - 1; i >= 0; i--) {
        let bottom = 0;
        for (let k = 0; k < t; k++) bottom += history[i][k];
        hctx.lineTo(xAt(i), H - bottom * H);
      }
      hctx.closePath();
      hctx.fillStyle = colors[t];
      hctx.fill();
    }
  }

  function updateUI() {
    const total = players.length || 1;
    for (let t = 0; t < 3; t++) {
      const pct = (counts[t] / total) * 100;
      const col = barCols[t];
      col.querySelector('.pct').textContent = Math.round(pct) + '%';
      col.querySelector('.bar-fill').style.height = pct + '%';
      col.querySelector('.count').textContent = counts[t];
    }
    timerEl.textContent = formatTime(simTime);
    playBtn.textContent = finished ? '▶ Play again' : running ? '❚❚ Pause' : simTime > 0 ? '▶ Resume' : '▶ Start';
    drawHistory();
  }

  function formatTime(t) {
    if (t < 60) return t.toFixed(1) + 's';
    const m = Math.floor(t / 60);
    return `${m}m ${Math.floor(t % 60).toString().padStart(2, '0')}s`;
  }

  let last = performance.now();
  let lastUI = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (running) {
      let sim = dt * settings.speed;
      while (sim > 1e-6 && running) {
        const h = Math.min(sim, 1 / 60);
        step(h);
        simTime += h;
        sim -= h;
        if (simTime >= nextHist) {
          sampleHistory();
          nextHist = simTime + histStep;
        }
        checkWinner();
      }
      dirty = true;
      if (now - lastUI > 100 || !running) {
        lastUI = now;
        updateUI();
      }
    } else if (players.some(p => p.flash > 0)) {
      for (const p of players) if (p.flash > 0) p.flash -= dt;
      dirty = true;
    }

    if (dirty) {
      draw();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }

  function togglePlay() {
    if (finished) {
      setup();
      running = true;
    } else {
      running = !running;
    }
    updateUI();
  }

  playBtn.addEventListener('click', togglePlay);
  $('againBtn').addEventListener('click', togglePlay);
  resetBtn.addEventListener('click', setup);

  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.target.closest('input, button')) return;
    e.preventDefault();
    togglePlay();
  });

  function syncSizeLimits() {
    const cfg = SIZES[settings.size];
    perTeam.max = cfg.max;
    customInputs.forEach(inp => { inp.max = cfg.max; });
    customHint.textContent = `Up to ${cfg.max} per team in a ${settings.size} arena.`;
  }

  sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      settings.size = btn.dataset.size;
      sizeButtons.forEach(b => b.setAttribute('aria-checked', String(b === btn)));
      const cfg = SIZES[settings.size];
      settings.perTeam = cfg.def;
      settings.counts = [cfg.def, cfg.def, cfg.def];
      perTeam.value = cfg.def;
      perTeamOut.textContent = cfg.def;
      customInputs.forEach(inp => { inp.value = cfg.def; });
      syncSizeLimits();
      setup();
    });
  });

  perTeam.addEventListener('input', () => {
    const v = +perTeam.value;
    settings.perTeam = v;
    settings.counts = [v, v, v];
    perTeamOut.textContent = v;
    customInputs.forEach(inp => { inp.value = v; });
    setup();
  });

  customToggle.addEventListener('click', () => {
    settings.custom = !settings.custom;
    customFields.hidden = !settings.custom;
    customToggle.setAttribute('aria-expanded', String(settings.custom));
    customToggle.textContent = settings.custom ? 'Use equal teams' : 'Customize each team';
    if (!settings.custom) {
      customInputs.forEach(inp => { inp.value = settings.perTeam; });
      settings.counts = [settings.perTeam, settings.perTeam, settings.perTeam];
    }
    setup();
  });

  customInputs.forEach((inp, t) => {
    inp.addEventListener('change', () => {
      const max = SIZES[settings.size].max;
      const v = Math.max(0, Math.min(max, Math.round(+inp.value || 0)));
      inp.value = v;
      settings.counts[t] = v;
      setup();
    });
  });

  speedInput.addEventListener('input', () => {
    settings.speed = +speedInput.value;
    speedOut.textContent = settings.speed + '×';
  });

  huntInput.addEventListener('change', () => {
    settings.hunt = huntInput.checked;
  });

  new ResizeObserver(() => resizeCanvas()).observe(arenaWrap);
  new ResizeObserver(() => resizeHistory()).observe(histCanvas);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    resizeCanvas();
    updateUI();
  });

  syncSizeLimits();
  setup();
  requestAnimationFrame(frame);
})();
