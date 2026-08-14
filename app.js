(() => {
  const canvas = document.getElementById("glass");
  const ctx = canvas.getContext("2d");
  const enableBtn = document.getElementById("enable");
  const statusEl = document.getElementById("status");

  let width = 0;
  let height = 0;
  let dpr = 1;

  // Smoothed gravity direction in screen space (points "down")
  let gx = 0;
  let gy = 1;
  let targetGx = 0;
  let targetGy = 1;

  // Liquid fill 0–1 of glass height
  const FILL = 0.62;
  let wavePhase = 0;
  let splash = 0;

  /** @type {{x:number,y:number,r:number,vx:number,vy:number,life:number}[]} */
  let bubbles = [];

  let motionLive = false;
  let lastTs = performance.now();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function glassGeometry() {
    const top = height * 0.08;
    const bottom = height * 0.92;
    const midY = (top + bottom) / 2;
    const topW = Math.min(width * 0.78, 420);
    const botW = Math.min(width * 0.52, 280);
    const cx = width / 2;
    return { top, bottom, midY, topW, botW, cx, h: bottom - top };
  }

  function widthAtY(y, g) {
    const t = (y - g.top) / g.h;
    const w = g.topW + (g.botW - g.topW) * t * t;
    return w;
  }

  function clampGravity() {
    const len = Math.hypot(targetGx, targetGy) || 1;
    targetGx /= len;
    targetGy /= len;
    // Keep some downward bias so liquid doesn't stick to ceiling forever
    if (targetGy < 0.15) {
      targetGy = 0.15 + targetGy * 0.5;
      const n = Math.hypot(targetGx, targetGy) || 1;
      targetGx /= n;
      targetGy /= n;
    }
  }

  function onOrientation(e) {
    // beta: front-back (-180..180), gamma: left-right (-90..90)
    const beta = e.beta ?? 0;
    const gamma = e.gamma ?? 0;
    // Map tilt to gravity vector
    const radB = (beta * Math.PI) / 180;
    const radG = (gamma * Math.PI) / 180;
    targetGx = Math.sin(radG);
    targetGy = Math.cos(radG) * Math.cos(radB);
    if (targetGy < 0.05) targetGy = 0.05;
    clampGravity();
    motionLive = true;
    statusEl.textContent = "Liquid follows your tilt";
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    // Device coords vary; invert x for natural pour
    targetGx = -(a.x || 0) / 9.8;
    targetGy = (a.y || 0) / 9.8;
    if (Math.abs(targetGy) < 0.05 && Math.abs(targetGx) < 0.05) {
      targetGy = 1;
      targetGx = 0;
    }
    clampGravity();
    motionLive = true;
    statusEl.textContent = "Liquid follows your motion";
  }

  function onPointer(e) {
    if (motionLive) return;
    const x = (e.clientX ?? e.touches?.[0]?.clientX ?? width / 2) / width;
    const y = (e.clientY ?? e.touches?.[0]?.clientY ?? height / 2) / height;
    targetGx = (x - 0.5) * 1.6;
    targetGy = 0.55 + y * 0.55;
    clampGravity();
    splash = Math.min(1, splash + 0.08);
    statusEl.textContent = "Drag to tip the glass · enable motion on phone";
  }

  async function enableMotion() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          statusEl.textContent = "Motion blocked — drag to tip instead";
          enableBtn.hidden = true;
          return;
        }
      }
      window.addEventListener("deviceorientation", onOrientation, true);
      window.addEventListener("devicemotion", onMotion, true);
      enableBtn.hidden = true;
      statusEl.textContent = "Tilt your phone — pour away";
    } catch {
      statusEl.textContent = "Motion unavailable — drag to tip the glass";
      enableBtn.hidden = true;
    }
  }

  function spawnBubbles(g, surfaceY, count) {
    for (let i = 0; i < count; i++) {
      const y = g.top + g.h * (0.35 + Math.random() * 0.55);
      const half = widthAtY(y, g) / 2 - 12;
      bubbles.push({
        x: g.cx + (Math.random() - 0.5) * half * 1.4,
        y,
        r: 1.5 + Math.random() * 4,
        vx: (Math.random() - 0.5) * 10,
        vy: -12 - Math.random() * 28,
        life: 2 + Math.random() * 3,
      });
    }
  }

  function update(dt) {
    // Smooth gravity
    gx += (targetGx - gx) * Math.min(1, dt * 6);
    gy += (targetGy - gy) * Math.min(1, dt * 6);
    const glen = Math.hypot(gx, gy) || 1;
    gx /= glen;
    gy /= glen;

    const tilt = Math.hypot(gx, gy - 1);
    wavePhase += dt * (1.8 + tilt * 8);
    splash = Math.max(0, splash - dt * 0.55);
    splash = Math.min(1, splash + tilt * dt * 0.9);

    const g = glassGeometry();
    if (Math.random() < dt * (1.2 + splash * 4)) {
      spawnBubbles(g, 0, 1);
    }

    // Liquid surface plane: points with normal = gravity
    // Surface passes through fill center of glass
    const fillCenterY = g.bottom - g.h * FILL * 0.5;

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      b.vx += -gx * 40 * dt;
      b.vy += -gy * 60 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Rise relative to gravity (against down)
      b.x -= gx * 18 * dt;
      b.y -= gy * 28 * dt;

      const half = widthAtY(Math.min(Math.max(b.y, g.top), g.bottom), g) / 2 - 4;
      if (b.x < g.cx - half || b.x > g.cx + half || b.life <= 0 || b.y < g.top) {
        bubbles.splice(i, 1);
      }
    }

    void fillCenterY;
  }

  function drawGlassShell(g) {
    // Table / room backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#1a1510");
    bg.addColorStop(0.45, "#2a2118");
    bg.addColorStop(1, "#0c0a08");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Soft vignette light
    const light = ctx.createRadialGradient(
      width * 0.35,
      height * 0.2,
      20,
      width * 0.5,
      height * 0.45,
      height * 0.75
    );
    light.addColorStop(0, "rgba(255,220,160,0.14)");
    light.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, width, height);
  }

  function clipGlass(g) {
    ctx.beginPath();
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = g.top + g.h * t;
      const half = widthAtY(y, g) / 2;
      const x = g.cx - half;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const y = g.top + g.h * t;
      const half = widthAtY(y, g) / 2;
      ctx.lineTo(g.cx + half, y);
    }
    ctx.closePath();
  }

  function surfaceYAtX(x, g) {
    // Plane: (p - center) · gravity = offset for fill amount
    // center of mass-ish at fill height along glass axis when upright
    const uprightSurface = g.bottom - g.h * FILL;
    // Point on plane: uprightSurface along glass center, then tilt
    const cx = g.cx;
    const cy = uprightSurface;
    // For point (x,y) on plane: (x-cx)*gx + (y-cy)*gy = 0 => y = cy - (x-cx)*gx/gy
    const denom = Math.max(0.2, gy);
    let y = cy - ((x - cx) * gx) / denom;
    // Wave along surface tangent
    const tangentX = gy;
    const along = (x - cx) * tangentX;
    y += Math.sin(wavePhase + along * 0.045) * (5 + splash * 14);
    y += Math.sin(wavePhase * 1.7 + along * 0.02) * (2 + splash * 6);
    return y;
  }

  function drawLiquid(g) {
    ctx.save();
    clipGlass(g);
    ctx.clip();

    // Sample surface across glass
    const samples = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // x across max top width then clamp to local
      const x = g.cx - g.topW / 2 + t * g.topW;
      const y = surfaceYAtX(x, g);
      samples.push({ x, y });
    }

    // Liquid body path: surface then bottom corners
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(samples[i].x, samples[i].y);
    }
    // Down right side of glass to bottom, across, up left
    const botHalf = g.botW / 2;
    ctx.lineTo(g.cx + botHalf, g.bottom);
    ctx.lineTo(g.cx - botHalf, g.bottom);
    ctx.closePath();

    const lg = ctx.createLinearGradient(
      g.cx - gx * 200,
      g.cy - gy * 200,
      g.cx + gx * 220,
      g.bottom
    );
    // fix g.cy
    const mid = (g.top + g.bottom) / 2;
    const grad = ctx.createLinearGradient(
      g.cx - gx * height * 0.25,
      mid - gy * height * 0.25,
      g.cx + gx * height * 0.2,
      mid + gy * height * 0.35
    );
    grad.addColorStop(0, "rgba(232, 170, 90, 0.92)");
    grad.addColorStop(0.45, "rgba(196, 122, 44, 0.94)");
    grad.addColorStop(1, "rgba(120, 58, 18, 0.96)");
    ctx.fillStyle = grad;
    ctx.fill();

    // Meniscus highlight on surface
    ctx.beginPath();
    ctx.moveTo(samples[0].x, samples[0].y);
    for (let i = 1; i < samples.length; i++) {
      ctx.lineTo(samples[i].x, samples[i].y);
    }
    ctx.strokeStyle = "rgba(255, 236, 200, 0.55)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner caustic streaks
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 5; i++) {
      const px = g.cx + Math.sin(wavePhase * 0.4 + i) * 40 - gx * 30;
      const py = mid + 40 + i * 28;
      const streak = ctx.createLinearGradient(px, py, px + 30, py + 80);
      streak.addColorStop(0, "rgba(255,230,170,0.8)");
      streak.addColorStop(1, "rgba(255,230,170,0)");
      ctx.fillStyle = streak;
      ctx.fillRect(px, py, 18, 90);
    }
    ctx.globalAlpha = 1;

    // Bubbles
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,245,220,0.35)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
    void liquidColor;
  }

  function drawGlassRim(g) {
    // Glass wall (stroke)
    ctx.save();
    clipGlass(g);
    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.stroke();
    ctx.restore();

    // Outer silhouette
    ctx.save();
    clipGlass(g);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Specular rim left
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = g.top + g.h * t;
      const half = widthAtY(y, g) / 2;
      const x = g.cx - half + 6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.38)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.stroke();

    // Specular rim right (thinner)
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = g.top + g.h * t;
      const half = widthAtY(y, g) / 2;
      const x = g.cx + half - 5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top ellipse rim
    ctx.beginPath();
    ctx.ellipse(g.cx, g.top + 4, g.topW / 2, 10, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fill();

    // Base
    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom + 2, g.botW / 2 + 8, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom, g.botW / 2 + 2, 5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function draw() {
    const g = glassGeometry();
    drawGlassShell(g);
    drawLiquid(g);
    drawGlassRim(g);
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
  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", (e) => {
    if (e.buttons || e.pressure > 0) onPointer(e);
  });
  window.addEventListener("touchmove", onPointer, { passive: false });

  if (needsPermissionGate()) {
    enableBtn.hidden = false;
    statusEl.textContent = "Tap Enable motion, then tilt the phone";
    enableBtn.addEventListener("click", enableMotion);
  } else {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);
    statusEl.textContent = "Tilt your phone · drag if on desktop";
  }

  // Idle sway so it feels alive before input
  setInterval(() => {
    if (motionLive) return;
    targetGx = Math.sin(performance.now() / 1400) * 0.12;
    targetGy = 1;
    clampGravity();
  }, 32);

  requestAnimationFrame(loop);
})();
