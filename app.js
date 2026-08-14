(() => {
  const canvas = document.getElementById("glass");
  const ctx = canvas.getContext("2d", { alpha: false });
  const enableBtn = document.getElementById("enable");
  const statusEl = document.getElementById("status");
  const debugEl = document.getElementById("debug");

  let W = 0;
  let H = 0;
  let dpr = 1;

  // Gravity "down" in screen space (x right, y down). Water surface ⊥ this.
  let gx = 0;
  let gy = 1;
  let targetGx = 0;
  let targetGy = 1;

  // How strongly phone roll maps into the water line (1 = true horizon lock)
  const SENSITIVITY = 0.32;
  const SMOOTH = 4.5; // lower = slower / less twitchy

  const FILL = 0.55;
  let phase = 0;
  let last = performance.now();
  let usingSensors = false;

  /** @type {{x:number,y:number,r:number,vx:number,vy:number,life:number}[]} */
  const bubbles = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 3);
    W = Math.max(320, window.innerWidth || document.documentElement.clientWidth);
    H = Math.max(480, window.innerHeight || document.documentElement.clientHeight);
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function glass() {
    const top = H * 0.16;
    const bottom = H * 0.88;
    const topW = Math.min(W * 0.82, 400);
    const botW = topW * 0.64;
    return { top, bottom, h: bottom - top, topW, botW, cx: W / 2 };
  }

  function halfAt(y, g) {
    const t = Math.min(1, Math.max(0, (y - g.top) / g.h));
    return (g.topW + (g.botW - g.topW) * t * t) / 2;
  }

  function setGravityDown(x, y) {
    const len = Math.hypot(x, y);
    if (len < 0.05) {
      targetGx = 0;
      targetGy = 1;
      return;
    }
    targetGx = x / len;
    targetGy = y / len;
    // Keep a little downward bias so the meniscus stays drawable
    if (targetGy < 0.12) {
      const n = Math.hypot(targetGx, 0.12);
      targetGx /= n;
      targetGy = 0.12 / n;
    }
  }

  /**
   * Map deviceorientation → screen gravity (y down).
   * Water plane stays world-level (parallel to horizon).
   */
  function applyOrientation(beta, gamma) {
    if (beta == null || gamma == null || Number.isNaN(beta) || Number.isNaN(gamma)) {
      return;
    }

    let b = Math.max(-90, Math.min(90, beta));
    let g = Math.max(-90, Math.min(90, gamma));
    const radB = (b * Math.PI) / 180;
    const radG = (g * Math.PI) / 180;

    // Unit gravity in device coords (W3C-style), then into screen x-right / y-down
    const dx = Math.sin(radG); // device +X (right)
    const dy = -Math.cos(radG) * Math.sin(radB); // device +Y (up of phone)
    // screen: x = device x, y = -device y  (screen y grows downward)
    setGravityDown(dx, -dy);

    usingSensors = true;
    const horizonDeg = (Math.atan2(targetGx, targetGy) * 180) / Math.PI;
    statusEl.textContent = "Water stays level with the horizon";
    debugEl.textContent =
      "β " +
      b.toFixed(0) +
      "° γ " +
      g.toFixed(0) +
      "° · horizon " +
      horizonDeg.toFixed(0) +
      "°";
  }

  function onOrientation(e) {
    applyOrientation(e.beta, e.gamma);
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;

    // Prefer raw gravity vector when available (most accurate horizon)
    // Device: +x right, +y up. Screen y-down ⇒ (ax, -ay)
    const sx = a.x;
    const sy = -(a.y);
    setGravityDown(sx, sy);
    usingSensors = true;

    const horizonDeg = (Math.atan2(targetGx, targetGy) * 180) / Math.PI;
    statusEl.textContent = "Water stays level with the horizon";
    debugEl.textContent =
      "g " +
      sx.toFixed(1) +
      "," +
      sy.toFixed(1) +
      " · horizon " +
      horizonDeg.toFixed(0) +
      "°";
  }

  function onPointer(e) {
    if (usingSensors) return; // sensors own the horizon lock
    const t = e.touches && e.touches[0] ? e.touches[0] : e;
    if (t.clientX == null) return;
    const nx = (t.clientX / W - 0.5) * 2;
    const ny = 0.75;
    setGravityDown(nx, ny);
    statusEl.textContent = "Drag tips the horizon · Enable motion for real level";
    debugEl.textContent =
      "manual horizon " + ((Math.atan2(targetGx, targetGy) * 180) / Math.PI).toFixed(0) + "°";
  }

  async function enableMotion() {
    statusEl.textContent = "Requesting permission…";
    try {
      const DOE = window.DeviceOrientationEvent;
      const DME = window.DeviceMotionEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission();
        if (r !== "granted") {
          statusEl.textContent = "Denied — drag to tip instead";
          enableBtn.hidden = true;
          return;
        }
      }
      if (DME && typeof DME.requestPermission === "function") {
        try {
          await DME.requestPermission();
        } catch (_) {
          /* optional */
        }
      }
      window.addEventListener("deviceorientation", onOrientation, true);
      window.addEventListener("devicemotion", onMotion, true);
      enableBtn.hidden = true;
      statusEl.textContent = "Sensors on — water locks to the horizon";
    } catch (err) {
      statusEl.textContent = "Sensors blocked — drag to tip";
      debugEl.textContent = String(err && err.message ? err.message : err);
      enableBtn.hidden = true;
    }
  }

  /** Horizon-aligned free surface: plane ⟂ gravity = fill constant */
  function surfaceY(x, g) {
    const y0 = g.bottom - g.h * FILL;
    const denom = Math.max(0.2, gy);
    let y = y0 - ((x - g.cx) * gx) / denom;
    // Soft ripples only — keep the mean surface horizon-true
    const along = (x - g.cx) * gy - (y0 - g.cx) * 0; // distance along surface-ish
    y += Math.sin(phase + along * 0.035) * 2.2;
    y += Math.sin(phase * 1.5 + x * 0.02) * 1.2;
    return y;
  }

  function pathGlass(g) {
    const steps = 40;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const y = g.top + (g.h * i) / steps;
      const x = g.cx - halfAt(y, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.quadraticCurveTo(g.cx, g.bottom + 16, g.cx + halfAt(g.bottom, g), g.bottom);
    for (let i = steps; i >= 0; i--) {
      const y = g.top + (g.h * i) / steps;
      ctx.lineTo(g.cx + halfAt(y, g), y);
    }
    ctx.closePath();
  }

  function draw() {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1a28");
    bg.addColorStop(1, "#050b12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const g = glass();

    ctx.save();
    pathGlass(g);
    ctx.fillStyle = "rgba(180, 220, 255, 0.08)";
    ctx.fill();
    ctx.restore();

    // Blue liquid under horizon plane
    ctx.save();
    pathGlass(g);
    ctx.clip();

    const left = g.cx - g.topW / 2 - 20;
    const right = g.cx + g.topW / 2 + 20;
    const steps = 72;
    const deep = H * 1.25;

    // Fill below the horizon plane (surface ⊥ gravity)
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      const y = surfaceY(x, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(right + gx * deep, surfaceY(right, g) + gy * deep);
    ctx.lineTo(left + gx * deep, surfaceY(left, g) + gy * deep);
    ctx.closePath();

    const water = ctx.createLinearGradient(
      g.cx - gx * 100,
      g.top,
      g.cx + gx * 40,
      g.bottom
    );
    water.addColorStop(0, "#7ad0ff");
    water.addColorStop(0.35, "#2f9de0");
    water.addColorStop(0.7, "#1a6fbf");
    water.addColorStop(1, "#0d3f7a");
    ctx.fillStyle = water;
    ctx.fill();

    // Horizon line (water surface)
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      const y = surfaceY(x, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(230, 248, 255, 0.9)";
    ctx.lineWidth = 3;
    ctx.stroke();

    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(230, 250, 255, 0.45)";
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    pathGlass(g);
    ctx.strokeStyle = "rgba(210, 235, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const y = g.top + (g.h * i) / 28;
      const x = g.cx - halfAt(y, g) + 8;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(g.cx, g.top + 4, g.topW / 2, 12, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(230,245,255,0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom + 8, g.botW / 2 + 14, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
  }

  function update(dt) {
    // Snappy tracking so horizon feels locked
    gx += (targetGx - gx) * Math.min(1, dt * 12);
    gy += (targetGy - gy) * Math.min(1, dt * 12);
    const len = Math.hypot(gx, gy) || 1;
    gx /= len;
    gy /= len;

    phase += dt * 1.6;

    const g = glass();
    if (Math.random() < dt * 1.8) {
      const y = g.top + g.h * (0.5 + Math.random() * 0.35);
      bubbles.push({
        x: g.cx + (Math.random() - 0.5) * halfAt(y, g),
        y,
        r: 1.5 + Math.random() * 3,
        vx: -gx * 20,
        vy: -gy * 40 - 10,
        life: 2,
      });
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Rise against gravity
      b.x -= gx * 25 * dt;
      b.y -= gy * 35 * dt;
      if (b.life <= 0 || b.y < surfaceY(b.x, g)) bubbles.splice(i, 1);
    }
  }

  function loop(ts) {
    const dt = Math.min(0.033, (ts - last) / 1000 || 0.016);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 250));

  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", (e) => {
    if (e.buttons) onPointer(e);
  });
  window.addEventListener("touchstart", onPointer, { passive: true });
  window.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      onPointer(e);
    },
    { passive: false }
  );

  enableBtn.addEventListener("click", enableMotion);

  if (
    !(
      window.DeviceOrientationEvent &&
      typeof window.DeviceOrientationEvent.requestPermission === "function"
    )
  ) {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);
  }

  // Idle sway only before sensors — still horizon-like
  let demo = 0;
  setInterval(() => {
    if (usingSensors) return;
    demo += 0.03;
    setGravityDown(Math.sin(demo) * 0.2, 1);
  }, 30);

  statusEl.textContent = "Blue water · tap Enable motion to lock to horizon";
  debugEl.textContent = "v4 · horizon-aligned surface";
  requestAnimationFrame(loop);
})();
