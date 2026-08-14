(() => {
  const canvas = document.getElementById("glass");
  const ctx = canvas.getContext("2d");
  const enableBtn = document.getElementById("enable");
  const statusEl = document.getElementById("status");

  let width = 0;
  let height = 0;
  let dpr = 1;

  // Gravity direction in screen space (points toward "down")
  let gx = 0;
  let gy = 1;
  let targetGx = 0;
  let targetGy = 1;

  const FILL = 0.58; // fraction of glass volume
  let wavePhase = 0;
  let splash = 0;
  let motionLive = false;
  let lastTs = performance.now();

  /** @type {{x:number,y:number,r:number,vx:number,vy:number,life:number}[]} */
  let bubbles = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    width = Math.max(1, window.innerWidth);
    height = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function glassGeometry() {
    const marginX = Math.max(24, width * 0.08);
    const top = height * 0.14;
    const bottom = height * 0.9;
    const topW = Math.min(width - marginX * 2, 440);
    const botW = topW * 0.62;
    return {
      top,
      bottom,
      h: bottom - top,
      topW,
      botW,
      cx: width / 2,
    };
  }

  function halfWidthAt(y, g) {
    const t = Math.min(1, Math.max(0, (y - g.top) / g.h));
    // Slight taper toward base
    const w = g.topW + (g.botW - g.topW) * (t * t);
    return w / 2;
  }

  function normalize(x, y) {
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  function setTargetGravity(x, y) {
    let n = normalize(x, y);
    // Never let gravity point fully upward — keep liquid readable
    if (n.y < 0.2) {
      n = normalize(n.x, 0.2 + Math.max(0, n.y));
    }
    targetGx = n.x;
    targetGy = n.y;
  }

  /**
   * iPhone portrait (screen facing you, upright): beta ≈ 90, gamma ≈ 0
   * → gravity should be (0, 1) = toward bottom of screen.
   * Use sin(beta) for screen-down, sin(gamma) for screen-right.
   */
  function onOrientation(e) {
    let beta = e.beta;
    let gamma = e.gamma;
    if (beta == null || gamma == null) return;

    // Normalize beta into a friendly range when device flips
    if (beta > 90) beta = 90;
    if (beta < -90) beta = -90;

    const radB = (beta * Math.PI) / 180;
    const radG = (gamma * Math.PI) / 180;

    const x = Math.sin(radG);
    const y = Math.sin(radB); // ~1 when phone upright
    setTargetGravity(x, Math.max(0.15, y));
    motionLive = true;
    statusEl.textContent = "Liquid follows your tilt";
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || (a.x == null && a.y == null)) return;

    // Portrait phone: +x right, +y up (device). Screen down ≈ -deviceY.
    const x = -(a.x || 0);
    const y = a.y || 0;
    // Prefer orientation when available; motion as backup with damping
    if (!motionLive) {
      setTargetGravity(x / 9.8, Math.max(0.15, -y / 9.8 + 0.5));
      statusEl.textContent = "Liquid follows your motion";
    }
  }

  function onPointer(e) {
    if (motionLive) return;
    const point = e.touches?.[0] || e;
    const x = point.clientX / width;
    const y = point.clientY / height;
    setTargetGravity((x - 0.5) * 2.2, 0.45 + y * 0.7);
    splash = Math.min(1, splash + 0.12);
    statusEl.textContent = "Drag to tip · Enable motion on iPhone";
  }

  async function enableMotion() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          statusEl.textContent = "Permission denied — drag to tip instead";
          enableBtn.hidden = true;
          return;
        }
      }
      window.addEventListener("deviceorientation", onOrientation, true);
      window.addEventListener("devicemotion", onMotion, true);
      enableBtn.hidden = true;
      motionLive = true;
      statusEl.textContent = "Tilt your phone — pour away";
    } catch {
      statusEl.textContent = "Motion unavailable — drag to tip";
      enableBtn.hidden = true;
    }
  }

  function spawnBubble(g) {
    const y = g.top + g.h * (0.4 + Math.random() * 0.5);
    const half = halfWidthAt(y, g) - 10;
    if (half < 8) return;
    bubbles.push({
      x: g.cx + (Math.random() - 0.5) * half * 1.5,
      y,
      r: 1.2 + Math.random() * 3.5,
      vx: (Math.random() - 0.5) * 12,
      vy: -20 - Math.random() * 30,
      life: 1.8 + Math.random() * 2.5,
    });
  }

  function update(dt) {
    gx += (targetGx - gx) * Math.min(1, dt * 7);
    gy += (targetGy - gy) * Math.min(1, dt * 7);
    ({ x: gx, y: gy } = normalize(gx, gy));

    const tilt = Math.hypot(gx, Math.max(0, gy) - 1);
    wavePhase += dt * (2 + tilt * 10);
    splash = Math.max(0, splash * (1 - dt * 1.8));
    splash = Math.min(1, splash + tilt * dt * 1.4);

    const g = glassGeometry();
    if (Math.random() < dt * (1.5 + splash * 5)) spawnBubble(g);

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      // Rise against gravity
      b.vx += -gx * 50 * dt + (Math.random() - 0.5) * 8 * dt;
      b.vy += -gy * 70 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      const half = halfWidthAt(Math.min(Math.max(b.y, g.top), g.bottom), g) - 4;
      const surface = surfaceY(b.x, g);
      if (
        b.life <= 0 ||
        b.y < surface - 4 ||
        b.x < g.cx - half ||
        b.x > g.cx + half
      ) {
        bubbles.splice(i, 1);
      }
    }
  }

  function surfaceY(x, g) {
    // Upright fill line, then tilt with gravity so liquid settles "down"
    const base = g.bottom - g.h * FILL;
    const denom = Math.max(0.35, gy);
    let y = base - ((x - g.cx) * gx) / denom;
    const along = (x - g.cx) * gy;
    y += Math.sin(wavePhase + along * 0.05) * (4 + splash * 16);
    y += Math.sin(wavePhase * 1.6 + along * 0.02) * (2 + splash * 7);
    return y;
  }

  function buildGlassPath(g) {
    const steps = 36;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = g.top + g.h * t;
      const x = g.cx - halfWidthAt(y, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // Bottom curve
    ctx.quadraticCurveTo(g.cx, g.bottom + 14, g.cx + halfWidthAt(g.bottom, g), g.bottom);
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const y = g.top + g.h * t;
      ctx.lineTo(g.cx + halfWidthAt(y, g), y);
    }
    ctx.closePath();
  }

  function drawBackground() {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#241c14");
    bg.addColorStop(0.5, "#1a1410");
    bg.addColorStop(1, "#0b0907");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.35,
      40,
      width * 0.5,
      height * 0.5,
      height * 0.7
    );
    glow.addColorStop(0, "rgba(255, 200, 120, 0.1)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }

  function drawLiquid(g) {
    const steps = 56;
    const left = g.cx - g.topW / 2;
    const right = g.cx + g.topW / 2;

    ctx.save();
    buildGlassPath(g);
    ctx.clip();

    // Surface polyline
    /** @type {{x:number,y:number}[]} */
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      pts.push({ x, y: surfaceY(x, g) });
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(right + 40, g.bottom + 80);
    ctx.lineTo(left - 40, g.bottom + 80);
    ctx.closePath();

    const mid = (g.top + g.bottom) / 2;
    const grad = ctx.createLinearGradient(
      g.cx - gx * 160,
      mid - gy * 120,
      g.cx + gx * 120,
      g.bottom
    );
    grad.addColorStop(0, "#e8b45a");
    grad.addColorStop(0.4, "#d4892f");
    grad.addColorStop(0.75, "#a85a18");
    grad.addColorStop(1, "#6e3510");
    ctx.fillStyle = grad;
    ctx.fill();

    // Surface sheen
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = "rgba(255, 245, 210, 0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Foam line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 6;
    ctx.stroke();

    // Bubbles inside liquid only
    for (const b of bubbles) {
      if (b.y < surfaceY(b.x, g)) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 248, 230, 0.4)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawGlass(g) {
    // Inner empty glass tint
    ctx.save();
    buildGlassPath(g);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();
    ctx.restore();

    drawLiquid(g);

    // Rim + walls
    ctx.save();
    buildGlassPath(g);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    // Left specular
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const y = g.top + g.h * t;
      const x = g.cx - halfWidthAt(y, g) + 7;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    // Right specular
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const y = g.top + g.h * t;
      const x = g.cx + halfWidthAt(y, g) - 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top rim ellipse
    ctx.beginPath();
    ctx.ellipse(g.cx, g.top + 3, g.topW / 2, 11, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();

    // Base shadow + foot
    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom + 6, g.botW / 2 + 16, 10, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom, g.botW / 2 + 4, 6, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function draw() {
    drawBackground();
    drawGlass(glassGeometry());
  }

  function loop(ts) {
    const dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function needsPermissionGate() {
    const DOE = window.DeviceOrientationEvent;
    return Boolean(DOE && typeof DOE.requestPermission === "function");
  }

  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));

  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", (e) => {
    if (e.buttons) onPointer(e);
  });
  window.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      onPointer(e);
    },
    { passive: false }
  );

  // Always show enable on iOS; also try listening anyway on others
  if (needsPermissionGate()) {
    enableBtn.hidden = false;
    statusEl.textContent = "Tap Enable motion, then tilt";
    enableBtn.addEventListener("click", enableMotion);
  } else {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);
    // Android sometimes needs a tap before sensors start
    enableBtn.hidden = false;
    enableBtn.textContent = "Start sensors";
    enableBtn.addEventListener("click", () => {
      window.addEventListener("deviceorientation", onOrientation, true);
      window.addEventListener("devicemotion", onMotion, true);
      enableBtn.hidden = true;
      statusEl.textContent = "Tilt your phone";
    });
    statusEl.textContent = "Tilt phone · or tap Start sensors";
  }

  // Gentle idle sway before sensors
  setInterval(() => {
    if (motionLive) return;
    setTargetGravity(Math.sin(performance.now() / 1600) * 0.15, 1);
  }, 40);

  requestAnimationFrame(loop);
})();
