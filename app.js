(() => {
  const canvas = document.getElementById("glass");
  const ctx = canvas.getContext("2d", { alpha: false });
  const enableBtn = document.getElementById("enable");
  const statusEl = document.getElementById("status");
  const debugEl = document.getElementById("debug");

  let W = 0;
  let H = 0;
  let dpr = 1;

  // Tilt in radians: 0 = flat surface, positive tips liquid to the right
  let tilt = 0;
  let targetTilt = 0;
  // Forward/back tips amount of "slosh" toward top/bottom (subtle fill shift)
  let pitch = 0;
  let targetPitch = 0;

  const FILL = 0.55;
  let phase = 0;
  let last = performance.now();
  let usingSensors = false;
  let lastBeta = 0;
  let lastGamma = 0;

  /** @type {{x:number,y:number,r:number,vy:number,life:number}[]} */
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

  function applyOrientation(beta, gamma) {
    if (beta == null || gamma == null || Number.isNaN(beta) || Number.isNaN(gamma)) {
      return;
    }
    lastBeta = beta;
    lastGamma = gamma;

    // Clamp
    let b = Math.max(-90, Math.min(90, beta));
    let g = Math.max(-90, Math.min(90, gamma));

    // Held upright: beta~90. Left/right tip = gamma.
    // Convert gamma degrees to surface tilt (strong response).
    targetTilt = (g / 45) * 0.65; // ~±0.65 rad (~37°)
    targetTilt = Math.max(-0.85, Math.min(0.85, targetTilt));

    // Pitch away from upright adds vertical slosh
    targetPitch = ((90 - b) / 60) * 0.12;
    targetPitch = Math.max(-0.2, Math.min(0.25, targetPitch));

    usingSensors = true;
    statusEl.textContent = "Tilt left / right — blue water moves";
    debugEl.textContent =
      "beta " + b.toFixed(0) + "° · gamma " + g.toFixed(0) + "° · tilt " + (targetTilt * 57.3).toFixed(0) + "°";
  }

  function onOrientation(e) {
    applyOrientation(e.beta, e.gamma);
  }

  function onMotion(e) {
    // Fallback if orientation is missing: derive from gravity accel
    if (usingSensors && Math.abs(lastGamma) + Math.abs(lastBeta) > 1) return;
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    // Portrait: x is left-right
    const gammaApprox = Math.max(-90, Math.min(90, (-a.x / 9.8) * 90));
    const betaApprox = Math.max(-90, Math.min(90, ((-a.y / 9.8) * 90 + 90)));
    applyOrientation(betaApprox, gammaApprox);
    debugEl.textContent =
      "accel x " + (a.x || 0).toFixed(1) + " y " + (a.y || 0).toFixed(1);
  }

  function onPointer(e) {
    const t = e.touches && e.touches[0] ? e.touches[0] : e;
    if (t.clientX == null) return;
    // Always allow manual tip (helps when sensors fail)
    const nx = t.clientX / W - 0.5;
    targetTilt = Math.max(-0.85, Math.min(0.85, nx * 1.8));
    if (!usingSensors) {
      statusEl.textContent = "Dragging works · also tap Enable motion";
      debugEl.textContent = "manual tilt " + (targetTilt * 57.3).toFixed(0) + "°";
    }
  }

  async function enableMotion() {
    statusEl.textContent = "Requesting permission…";
    try {
      const DOE = window.DeviceOrientationEvent;
      const DME = window.DeviceMotionEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const r = await DOE.requestPermission();
        if (r !== "granted") {
          statusEl.textContent = "Denied — drag finger to tip water";
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
      statusEl.textContent = "Permission on — tilt the phone now";
      // Nudge so user sees immediate movement
      targetTilt = 0.25;
      setTimeout(() => {
        targetTilt = -0.25;
      }, 280);
      setTimeout(() => {
        if (!usingSensors) targetTilt = 0;
      }, 600);
    } catch (err) {
      statusEl.textContent = "Sensors blocked — drag to tip";
      debugEl.textContent = String(err && err.message ? err.message : err);
      enableBtn.hidden = true;
    }
  }

  function surfaceY(x, g) {
    const mid = g.bottom - g.h * (FILL - pitch);
    const slope = Math.tan(tilt);
    let y = mid + (x - g.cx) * slope;
    y += Math.sin(phase + x * 0.04) * 5;
    y += Math.sin(phase * 1.7 + x * 0.02) * 3;
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
    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1a28");
    bg.addColorStop(1, "#050b12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const g = glass();

    // Empty glass fill so shape is always obvious
    ctx.save();
    pathGlass(g);
    ctx.fillStyle = "rgba(180, 220, 255, 0.08)";
    ctx.fill();
    ctx.restore();

    // Blue liquid
    ctx.save();
    pathGlass(g);
    ctx.clip();

    const left = g.cx - g.topW / 2 - 20;
    const right = g.cx + g.topW / 2 + 20;
    const steps = 64;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      const y = surfaceY(x, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(right, g.bottom + 100);
    ctx.lineTo(left, g.bottom + 100);
    ctx.closePath();

    const water = ctx.createLinearGradient(g.cx, g.top, g.cx + tilt * 80, g.bottom);
    water.addColorStop(0, "#7ad0ff");
    water.addColorStop(0.35, "#2f9de0");
    water.addColorStop(0.7, "#1a6fbf");
    water.addColorStop(1, "#0d3f7a");
    ctx.fillStyle = water;
    ctx.fill();

    // Surface line
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const x = left + ((right - left) * i) / steps;
      const y = surfaceY(x, g);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(220, 245, 255, 0.85)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Bubbles
    for (const b of bubbles) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(230, 250, 255, 0.45)";
      ctx.fill();
    }
    ctx.restore();

    // Glass outline — thick so it's impossible to miss
    ctx.save();
    pathGlass(g);
    ctx.strokeStyle = "rgba(210, 235, 255, 0.55)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Specular edge
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

    // Rim
    ctx.beginPath();
    ctx.ellipse(g.cx, g.top + 4, g.topW / 2, 12, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(230,245,255,0.7)";
    ctx.lineWidth = 3;
    ctx.stroke();

    // Base
    ctx.beginPath();
    ctx.ellipse(g.cx, g.bottom + 8, g.botW / 2 + 14, 11, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fill();
  }

  function update(dt) {
    tilt += (targetTilt - tilt) * Math.min(1, dt * 8);
    pitch += (targetPitch - pitch) * Math.min(1, dt * 6);
    phase += dt * (2.2 + Math.abs(tilt) * 6);

    const g = glass();
    if (Math.random() < dt * 2) {
      const y = g.top + g.h * (0.45 + Math.random() * 0.4);
      bubbles.push({
        x: g.cx + (Math.random() - 0.5) * halfAt(y, g),
        y,
        r: 1.5 + Math.random() * 3,
        vy: -30 - Math.random() * 40,
        life: 2,
      });
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.life -= dt;
      b.y += b.vy * dt;
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

  // Manual tip always available
  window.addEventListener("pointerdown", onPointer);
  window.addEventListener("pointermove", (e) => {
    if (e.buttons) onPointer(e);
  });
  window.addEventListener(
    "touchstart",
    (e) => {
      onPointer(e);
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      onPointer(e);
    },
    { passive: false }
  );

  enableBtn.addEventListener("click", enableMotion);

  // Non-iOS: listen immediately too
  if (
    !(
      window.DeviceOrientationEvent &&
      typeof window.DeviceOrientationEvent.requestPermission === "function"
    )
  ) {
    window.addEventListener("deviceorientation", onOrientation, true);
    window.addEventListener("devicemotion", onMotion, true);
  }

  // Idle demo so something always moves even with no input
  let demo = 0;
  setInterval(() => {
    if (usingSensors) return;
    demo += 0.04;
    targetTilt = Math.sin(demo) * 0.28;
  }, 30);

  statusEl.textContent = "You should see blue water now · tap Enable motion";
  debugEl.textContent = "v3 · drag screen if sensors fail";
  requestAnimationFrame(loop);
})();
