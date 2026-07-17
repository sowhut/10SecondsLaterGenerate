/*
 * 十秒以后 · 首页
 * 首屏草图：自动演示「记录 → 回溯 → 与过去的自己协作」的一次完整循环。
 * 第一次记录：小人拿到钥匙，跳回地面把钥匙放下，但来不及走到门边；
 * 第二次：分身分毫不差地重演，现在的你路过捡起钥匙，开门过关。
 * 无依赖，仅供首页使用。
 */

document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 滚动显现 ---------- */

const revealEls = document.querySelectorAll('[data-reveal]');
if (reduceMotion || !('IntersectionObserver' in window)) {
  revealEls.forEach((el) => el.classList.add('is-in'));
} else {
  const revealIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          revealIO.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 },
  );
  revealEls.forEach((el) => revealIO.observe(el));
}

/* ---------- 首屏草图场景 ---------- */

const sceneCanvas = document.querySelector('[data-scene]');
if (sceneCanvas instanceof HTMLCanvasElement) {
  initScene(sceneCanvas);
}

function initScene(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const statusEl = document.querySelector('[data-status]');
  const playheadEl = document.querySelector('[data-playhead]');
  const toggleBtn = document.querySelector('[data-anim-toggle]');

  const INK = '#211d16';
  const RED = '#bd3a2c';
  const BLUE = '#2e4fa3';
  const BLUE_SOFT = 'rgba(46, 79, 163, 0.12)';
  const AMBER = '#b07208';
  const AMBER_GLOW = 'rgba(176, 114, 8, 0.16)';
  const PAPER = '#f3efe4';

  // 场景网格：与游戏一致的两层平台、钥匙、门
  const COLS = 22;
  const ROWS = 13;
  const GROUND = 10; // 地面顶边所在行
  const TIER = 6; // 二层平台顶边所在行
  const TIER_A = [8, 10]; // 二层左段（含端点）
  const TIER_B = [13, 14]; // 二层右段
  const KEY_POS = { x: 13.8, y: TIER };
  const DOOR = { x: 18, w: 2, h: 3 };
  const DURATION = 10;
  const KEY_T = 5.6; // 拿到钥匙的时刻
  const DROP_T = 8.7; // 跳回地面后，把钥匙放下的时刻
  const DROP_X = 8.8; // 钥匙放在地面的位置（第一次 10 秒结束时它仍在这里）
  const PICK_T = 3.3; // 第二次：现在的你路过钥匙、自动拾取的时刻
  const DOOR_T = 7.6; // 到达门口的时刻
  const ENTER_T = 8.6; // 走进门里的时刻
  const END_T = 9.4;
  const SPEED = 1.5;

  // 第一次记录：拿到钥匙，跳回地面放下，但来不及走到门边
  const runA = [
    { t: 0.0, x: 1.6, y: GROUND },
    { t: 2.2, x: 7.4, y: GROUND },
    { t: 3.0, x: 8.9, y: TIER, arc: 2.2 },
    { t: 4.0, x: 10.3, y: TIER },
    { t: 4.8, x: 13.1, y: TIER, arc: 1.8 },
    { t: KEY_T, x: KEY_POS.x, y: TIER },
    { t: 6.6, x: 13.2, y: TIER },
    { t: 7.4, x: 10.4, y: TIER, arc: 1.8 },
    { t: 8.4, x: DROP_X, y: GROUND, arc: 1.4 },
    { t: DROP_T, x: DROP_X, y: GROUND }, // 落地后停顿一下，把钥匙放到地上
    { t: DURATION, x: 11.6, y: GROUND },
  ];

  // 第二次：分身重演，现在的你路过捡起钥匙，直奔大门
  const runB = [
    { t: 0.0, x: 1.6, y: GROUND },
    { t: PICK_T, x: DROP_X, y: GROUND },
    { t: DOOR_T, x: DOOR.x + 0.2, y: GROUND },
    { t: ENTER_T, x: DOOR.x + 1.0, y: GROUND },
  ];

  const STATE_TEXT = {
    record: '● REC · 记录中',
    rewind: '◀◀ · 回溯',
    replay: '▶ 重演 · 新的记录',
    clear: '✓ · 抵达',
  };

  let W = 1;
  let H = 1;
  let cell = 10;
  let ox = 0;
  let oy = 0;
  let phase = 'record'; // record | rewind | replay | clear
  let t = 0;
  let phaseTime = 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let paused = false;
  const trail = [];

  function X(x) {
    return ox + x * cell;
  }

  function Y(y) {
    return oy + y * cell;
  }

  function lw(v) {
    return Math.max(1, v * cell);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(rect.width * dpr));
    H = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    cell = Math.min(W / (COLS + 1.2), H / (ROWS + 1.1));
    ox = (W - cell * COLS) / 2;
    oy = (H - cell * ROWS) / 2;
  }

  function posAt(path, time) {
    const first = path[0];
    if (time <= first.t) {
      return { x: first.x, y: first.y, dir: 1, moving: false, lift: 0 };
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (time <= b.t) {
        const u = (time - a.t) / (b.t - a.t);
        const lift = b.arc ? Math.sin(Math.PI * u) * b.arc : 0;
        const dx = b.x - a.x;
        return {
          x: a.x + dx * u,
          y: a.y + (b.y - a.y) * u - lift,
          dir: dx === 0 ? 1 : Math.sign(dx),
          moving: dx !== 0 || b.y !== a.y,
          lift,
        };
      }
    }
    const lastP = path[path.length - 1];
    return { x: lastP.x, y: lastP.y, dir: 1, moving: false, lift: 0 };
  }

  function walkY(p, time) {
    const bob = p.moving && p.lift < 0.05 ? Math.abs(Math.sin(time * 9)) * 0.07 : 0;
    return p.y - bob;
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function slab(cx0, ry0, cx1, ry1) {
    const x = X(cx0);
    const y = Y(ry0);
    const w = (cx1 - cx0) * cell;
    const h = (ry1 - ry0) * cell;
    ctx.fillStyle = 'rgba(33, 29, 22, 0.05)';
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = lw(0.09);
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, w, h);
    // 侧面排线
    ctx.lineWidth = lw(0.05);
    ctx.strokeStyle = 'rgba(33, 29, 22, 0.35)';
    const n = Math.max(2, Math.floor(w / (cell * 0.9)));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const hx = x + ((i + 0.5) * w) / n;
      ctx.moveTo(hx, y + h * 0.55);
      ctx.lineTo(hx + cell * 0.22, y + h * 0.95);
    }
    ctx.stroke();
    // 顶边加重
    ctx.lineWidth = lw(0.14);
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.stroke();
  }

  function door(unlocked) {
    const x = X(DOOR.x);
    const w = DOOR.w * cell;
    const yTop = Y(GROUND - DOOR.h);
    const yBot = Y(GROUND);
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x, yBot);
    ctx.lineTo(x, yTop + r);
    ctx.arc(x + r, yTop + r, r, Math.PI, 0);
    ctx.lineTo(x + w, yBot);
    ctx.closePath();
    if (unlocked) {
      ctx.fillStyle = AMBER_GLOW;
      ctx.fill();
    }
    ctx.lineWidth = lw(0.1);
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (unlocked) {
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = lw(0.06);
      const cx = x + r;
      const cy = yTop + r;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i / 4) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (r + cell * 0.16), cy + Math.sin(a) * (r + cell * 0.16));
        ctx.lineTo(cx + Math.cos(a) * (r + cell * 0.4), cy + Math.sin(a) * (r + cell * 0.4));
        ctx.stroke();
      }
    } else {
      const cx = x + r;
      const cy = yBot - (DOOR.h * cell) / 2 + cell * 0.3;
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - cell * 0.04, cy, cell * 0.08, cell * 0.32);
    }
  }

  function key(cx, cy, scale, color) {
    const px = X(cx);
    const py = Y(cy);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw(0.07);
    ctx.beginPath();
    ctx.arc(px, py - cell * 0.12 * scale, cell * 0.13 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px, py + cell * 0.01 * scale);
    ctx.lineTo(px, py + cell * 0.3 * scale);
    ctx.moveTo(px, py + cell * 0.3 * scale);
    ctx.lineTo(px + cell * 0.14 * scale, py + cell * 0.3 * scale);
    ctx.moveTo(px, py + cell * 0.18 * scale);
    ctx.lineTo(px + cell * 0.11 * scale, py + cell * 0.18 * scale);
    ctx.stroke();
    ctx.restore();
  }

  // 放在地面上的钥匙；settle 为放下后的经过时间，用于落地轻微弹跳
  function keyOnGround(settle) {
    let lift = 0;
    if (settle > 0 && settle < 0.6) {
      lift = Math.abs(Math.sin(settle * 12)) * 0.22 * (1 - settle / 0.6);
    }
    key(DROP_X, GROUND - 0.72 - lift, 1, AMBER);
  }

  function figure(x, y, opts) {
    const o = opts || {};
    const w = cell * 1.15;
    const h = cell * 2.3;
    ctx.save();
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    ctx.translate(X(x), Y(y));
    ctx.rotate(o.lean || 0);
    rr(-w / 2, -h, w, h, cell * 0.3);
    if (o.ghost) {
      ctx.fillStyle = BLUE_SOFT;
      ctx.fill();
      ctx.setLineDash([cell * 0.16, cell * 0.11]);
      ctx.lineWidth = lw(0.08);
      ctx.strokeStyle = BLUE;
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.fillStyle = INK;
      ctx.fill();
    }
    const dir = o.dir || 1;
    const ex = dir * w * 0.1;
    ctx.fillStyle = o.ghost ? BLUE : PAPER;
    ctx.beginPath();
    ctx.arc(ex - w * 0.16, -h * 0.7, cell * 0.08, 0, Math.PI * 2);
    ctx.arc(ex + w * 0.16, -h * 0.7, cell * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function tag(text, x, y, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.font = `500 ${Math.max(10, Math.round(cell * 0.42))}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(text, X(x), Y(y));
    ctx.restore();
  }

  function stamp(text, x, y, color, rot, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(X(x), Y(y));
    ctx.rotate(rot);
    ctx.font = `700 ${Math.max(10, Math.round(cell * 0.55))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    const w = ctx.measureText(text).width;
    ctx.lineWidth = lw(0.05);
    ctx.strokeStyle = color;
    ctx.strokeRect(-w / 2 - cell * 0.25, -cell * 0.42, w + cell * 0.5, cell * 0.84);
    ctx.restore();
  }

  function recDot(x, y, on, color, text) {
    const px = X(x);
    const py = Y(y);
    ctx.save();
    ctx.font = `700 ${Math.max(9, Math.round(cell * 0.4))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    if (on) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw(0.05);
      ctx.beginPath();
      ctx.arc(px, py, cell * 0.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.fillText(text, px + cell * 0.26, py);
    ctx.restore();
  }

  function spawnMark() {
    ctx.save();
    ctx.strokeStyle = 'rgba(33, 29, 22, 0.35)';
    ctx.lineWidth = lw(0.05);
    ctx.setLineDash([cell * 0.12, cell * 0.1]);
    ctx.beginPath();
    ctx.arc(X(1.6), Y(GROUND) - cell * 1.15, cell * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function scanlines() {
    ctx.save();
    ctx.fillStyle = 'rgba(33, 29, 22, 0.05)';
    for (let i = 0; i < 6; i++) {
      const yy = (((i * 137 + Math.floor(phaseTime * 30) * 23) % 100) / 100) * H;
      ctx.fillRect(0, yy, W, Math.max(1, cell * 0.045));
    }
    ctx.restore();
  }

  function pushTrail(x, y, c) {
    trail.push({ x, y, c });
    if (trail.length > 90) trail.shift();
  }

  function drawTrail() {
    const len = trail.length;
    for (let i = 0; i < len; i++) {
      const p = trail[i];
      const a = ((i + 1) / len) * 0.45;
      ctx.fillStyle = p.c ? `rgba(46, 79, 163, ${a})` : `rgba(33, 29, 22, ${a})`;
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y) - cell * 1.1, cell * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function dashedPath(path, color) {
    const tEnd = path[path.length - 1].t;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw(0.05);
    ctx.setLineDash([cell * 0.14, cell * 0.16]);
    ctx.beginPath();
    for (let tt = 0; tt <= tEnd + 0.001; tt += 0.2) {
      const p = posAt(path, Math.min(tt, tEnd));
      const px = X(p.x);
      const py = Y(p.y) - cell * 1.1;
      if (tt === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 第二次里，现在的你捡到钥匙后，门解锁发光
    const heroHasKey = (phase === 'replay' || phase === 'clear') && t >= PICK_T;

    spawnMark();
    slab(0, GROUND, COLS, ROWS);
    slab(TIER_A[0], TIER, TIER_A[1] + 1, TIER + 1);
    slab(TIER_B[0], TIER, TIER_B[1] + 1, TIER + 1);
    door(heroHasKey);

    drawTrail();

    if (phase === 'record') {
      // 钥匙：台上 → 被携带 → 放在地面
      if (t < KEY_T) {
        const bob = Math.sin((t + phaseTime) * 2.2) * 0.5 + 0.5;
        key(KEY_POS.x, KEY_POS.y - 0.75 - bob * 0.12, 1, AMBER);
      } else if (t >= DROP_T) {
        keyOnGround(t - DROP_T);
      }
      const p = posAt(runA, t);
      const py = walkY(p, t);
      figure(p.x, py, { dir: p.dir, lean: p.moving ? p.dir * 0.05 : 0 });
      if (t >= KEY_T && t < DROP_T) key(p.x, py - 3.05, 0.66, AMBER);
      recDot(0.25, 0.7, Math.floor(phaseTime * 2) % 2 === 0, RED, 'REC');
    } else if (phase === 'rewind') {
      // 倒带时，钥匙留在第一次 10 秒结束时的位置
      keyOnGround(0);
      const p1 = posAt(runA, Math.min(DURATION, t + 0.5));
      const p2 = posAt(runA, Math.min(DURATION, t + 0.25));
      figure(p1.x, p1.y, { alpha: 0.1, dir: p1.dir });
      figure(p2.x, p2.y, { alpha: 0.2, dir: p2.dir });
      const p = posAt(runA, t);
      figure(p.x, p.y, { dir: p.dir });
      scanlines();
      stamp('时间到', 11, 3.2, RED, -0.08, Math.max(0, 1 - phaseTime / 1.1));
    } else {
      // replay / clear：分身重演（不再带钥匙），现在的你捡钥匙直奔大门
      const g = posAt(runA, t);
      const gy = walkY(g, t);
      figure(g.x, gy, { ghost: true, dir: g.dir });

      const h = posAt(runB, t);
      const hy = walkY(h, t);
      const hAlpha = t <= DOOR_T ? 1 : Math.max(0, 1 - (t - DOOR_T) / (ENTER_T - DOOR_T));
      if (hAlpha > 0) {
        figure(h.x, hy, { dir: h.dir, alpha: hAlpha, lean: h.moving ? h.dir * 0.05 : 0 });
      }

      if (t < PICK_T) {
        // 钥匙留在地上，轻轻浮动等待被捡起
        const bob = Math.sin(phaseTime * 2.4) * 0.5 + 0.5;
        key(DROP_X, GROUND - 0.72 - bob * 0.08, 1, AMBER);
      } else {
        if (t < PICK_T + 0.35) {
          // 拾取瞬间的小光圈
          const u = (t - PICK_T) / 0.35;
          ctx.save();
          ctx.globalAlpha = 1 - u;
          ctx.strokeStyle = AMBER;
          ctx.lineWidth = lw(0.05);
          ctx.beginPath();
          ctx.arc(X(DROP_X), Y(GROUND - 0.8), cell * (0.2 + u * 0.5), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        if (hAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = hAlpha;
          key(h.x, hy - 3.05, 0.66, AMBER);
          ctx.restore();
        }
      }

      if (phase === 'replay') {
        const labelAlpha = Math.min(1, phaseTime / 0.8);
        tag('过去的你', g.x, gy - 3.55, BLUE, labelAlpha);
        if (hAlpha > 0) tag('现在的你', h.x, hy - 3.55, INK, labelAlpha * hAlpha);
      }

      recDot(0.25, 0.7, true, BLUE, 'PLAY');
      recDot(2.4, 0.7, Math.floor(phaseTime * 2) % 2 === 0, RED, 'REC');

      if (phase === 'clear') {
        stamp('抵达 ✓', DOOR.x + 1, GROUND - DOOR.h - 1.1, INK, -0.06, Math.min(1, phaseTime * 2.5));
      }
    }
  }

  function renderStatic() {
    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    dashedPath(runB, 'rgba(33, 29, 22, 0.5)');
    dashedPath(runA, 'rgba(46, 79, 163, 0.55)');
    spawnMark();
    slab(0, GROUND, COLS, ROWS);
    slab(TIER_A[0], TIER, TIER_A[1] + 1, TIER + 1);
    slab(TIER_B[0], TIER, TIER_B[1] + 1, TIER + 1);
    door(true);
    const g = posAt(runA, 6.4);
    figure(g.x, g.y, { ghost: true, dir: g.dir });
    const h = posAt(runB, 6.4);
    figure(h.x, h.y, { dir: h.dir });
    key(h.x, h.y - 3.05, 0.66, AMBER); // 现在的你带着钥匙走向大门
    tag('过去的你', g.x, g.y - 3.55, BLUE, 1);
    tag('现在的你', h.x, h.y - 3.55, INK, 1);
  }

  function syncStatus() {
    if (!statusEl) return;
    statusEl.setAttribute('data-phase', phase);
    statusEl.textContent = STATE_TEXT[phase];
  }

  function setPhase(next) {
    phase = next;
    phaseTime = 0;
    syncStatus();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    const dt = Math.min((now - last) / 1000, 0.05) * SPEED;
    last = now;
    phaseTime += dt;

    if (phase === 'record') {
      t += dt;
      if (t >= DURATION) {
        t = DURATION;
        setPhase('rewind');
      }
      const p = posAt(runA, t);
      pushTrail(p.x, p.y, 0);
    } else if (phase === 'rewind') {
      t -= dt * 6;
      if (t <= 0) {
        t = 0;
        trail.length = 0;
        setPhase('replay');
      }
    } else if (phase === 'replay') {
      t += dt;
      if (t >= END_T) {
        t = END_T;
        setPhase('clear');
      }
      const g = posAt(runA, t);
      pushTrail(g.x, g.y, 1);
      if (t <= ENTER_T) {
        const h = posAt(runB, t);
        pushTrail(h.x, h.y, 0);
      }
    } else if (phase === 'clear') {
      if (phaseTime > 1.8) {
        t = 0;
        trail.length = 0;
        setPhase('record');
      }
    }

    render();
    if (playheadEl) playheadEl.style.left = `${(t / DURATION) * 100}%`;
  }

  function start() {
    if (running || reduceMotion || paused) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  /* ---------- 启动 ---------- */

  resize();
  window.addEventListener('resize', () => {
    resize();
    if (reduceMotion) renderStatic();
  });

  if (reduceMotion) {
    if (statusEl) {
      statusEl.setAttribute('data-phase', 'still');
      statusEl.textContent = '静止示意图';
    }
    if (playheadEl) playheadEl.style.display = 'none';
    renderStatic();
    return;
  }

  syncStatus();
  start();

  if (toggleBtn) {
    toggleBtn.hidden = false;
    toggleBtn.addEventListener('click', () => {
      paused = !paused;
      toggleBtn.setAttribute('aria-pressed', String(paused));
      toggleBtn.textContent = paused ? '继续动画' : '暂停动画';
      if (paused) stop();
      else start();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  if ('IntersectionObserver' in window) {
    const sceneIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) start();
          else stop();
        });
      },
      { threshold: 0.05 },
    );
    sceneIO.observe(canvas);
  }
}
