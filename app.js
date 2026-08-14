(() => {
  const COLS = 13;
  const ROWS = 13;
  const TILE = 30;
  const WIDTH = COLS * TILE;
  const HEIGHT = ROWS * TILE;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const levelEl = document.getElementById("level");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayCopy = document.getElementById("overlay-copy");
  const startBtn = document.getElementById("start-btn");

  /** @type {"title" | "playing" | "dead" | "win" | "over"} */
  let state = "title";
  let score = 0;
  let lives = 3;
  let level = 1;
  let homes = [false, false, false, false, false];
  let frog = createFrog();
  /** @type {Hazard[]} */
  let hazards = [];
  let lastTs = 0;
  let animId = 0;
  let deathTimer = 0;
  let hopCooldown = 0;

  /**
   * @typedef {{
   *   x: number, y: number, w: number, h: number,
   *   speed: number, kind: "car" | "log" | "turtle",
   *   color: string, dive?: number, submerged?: boolean
   * }} Hazard
   */

  function createFrog() {
    return {
      col: 6,
      row: 12,
      x: 6 * TILE + 3,
      y: 12 * TILE + 3,
      w: TILE - 6,
      h: TILE - 6,
      onLog: /** @type {Hazard | null} */ (null),
      facing: "up",
    };
  }

  function laneY(row) {
    return row * TILE;
  }

  function buildHazards() {
    const speedBoost = 1 + (level - 1) * 0.18;
    /** @type {Hazard[]} */
    const list = [];

    // Road (rows 8–11): cars
    const road = [
      { row: 11, speed: 55 * speedBoost, w: 48, gap: 110, color: "#d64545", dir: 1 },
      { row: 10, speed: -70 * speedBoost, w: 56, gap: 130, color: "#c0c4c8", dir: -1 },
      { row: 9, speed: 85 * speedBoost, w: 40, gap: 100, color: "#4aa3ff", dir: 1 },
      { row: 8, speed: -60 * speedBoost, w: 70, gap: 150, color: "#f0a020", dir: -1 },
      { row: 7, speed: 48 * speedBoost, w: 52, gap: 125, color: "#2aa5a5", dir: 1 },
    ];

    for (const lane of road) {
      const count = Math.ceil((WIDTH + lane.gap) / lane.gap);
      for (let i = 0; i < count; i++) {
        list.push({
          x: i * lane.gap + (lane.dir > 0 ? -lane.w : WIDTH),
          y: laneY(lane.row) + 4,
          w: lane.w,
          h: TILE - 8,
          speed: lane.speed,
          kind: "car",
          color: lane.color,
        });
      }
    }

    // River (rows 1–5): logs & turtles
    const river = [
      { row: 5, speed: 40 * speedBoost, w: 90, gap: 140, kind: "log", color: "#8b5a2b" },
      { row: 4, speed: -50 * speedBoost, w: 70, gap: 120, kind: "turtle", color: "#3d8b6e" },
      { row: 3, speed: 55 * speedBoost, w: 110, gap: 170, kind: "log", color: "#a06a35" },
      { row: 2, speed: -45 * speedBoost, w: 80, gap: 130, kind: "turtle", color: "#2f7a5c" },
      { row: 1, speed: 35 * speedBoost, w: 100, gap: 160, kind: "log", color: "#7a4a22" },
    ];

    for (const lane of river) {
      const count = Math.ceil((WIDTH + lane.gap) / lane.gap) + 1;
      for (let i = 0; i < count; i++) {
        /** @type {Hazard} */
        const h = {
          x: i * lane.gap,
          y: laneY(lane.row) + 5,
          w: lane.w,
          h: TILE - 10,
          speed: lane.speed,
          kind: /** @type {"log" | "turtle"} */ (lane.kind),
          color: lane.color,
        };
        if (lane.kind === "turtle") {
          h.dive = i * 1.4;
          h.submerged = false;
        }
        list.push(h);
      }
    }

    return list;
  }

  function resetFrog() {
    frog = createFrog();
    hopCooldown = 0.12;
  }

  function startGame(full = true) {
    if (full) {
      score = 0;
      lives = 3;
      level = 1;
      homes = [false, false, false, false, false];
    }
    hazards = buildHazards();
    resetFrog();
    state = "playing";
    overlay.hidden = true;
    syncHud();
    lastTs = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
  }

  function syncHud() {
    scoreEl.textContent = String(score);
    livesEl.textContent = String(lives);
    levelEl.textContent = String(level);
  }

  function showOverlay(title, copy, btnLabel) {
    overlayTitle.textContent = title;
    overlayCopy.textContent = copy;
    startBtn.textContent = btnLabel;
    overlay.hidden = false;
  }

  function moveFrog(dir) {
    if (state !== "playing" || hopCooldown > 0) return;

    const next = { col: frog.col, row: frog.row };
    if (dir === "up") next.row -= 1;
    if (dir === "down") next.row += 1;
    if (dir === "left") next.col -= 1;
    if (dir === "right") next.col += 1;

    if (next.col < 0 || next.col >= COLS || next.row < 0 || next.row >= ROWS) return;
    if (next.row === 0) {
      tryHome(next.col);
      return;
    }

    frog.col = next.col;
    frog.row = next.row;
    frog.x = frog.col * TILE + 3;
    frog.y = frog.row * TILE + 3;
    frog.facing = dir;
    frog.onLog = null;
    hopCooldown = 0.1;

    if (dir === "up") {
      score += 10;
      syncHud();
    }
  }

  function tryHome(col) {
    // Five home pads spanning two columns each
    const pads = [
      { cols: [0, 1], index: 0 },
      { cols: [3, 4], index: 1 },
      { cols: [6, 7], index: 2 },
      { cols: [9, 10], index: 3 },
      { cols: [11, 12], index: 4 },
    ];
    const pad = pads.find((p) => p.cols.includes(col));
    if (!pad || homes[pad.index]) {
      die();
      return;
    }
    homes[pad.index] = true;
    score += 200;
    syncHud();
    if (homes.every(Boolean)) {
      levelComplete();
      return;
    }
    resetFrog();
  }

  function levelComplete() {
    score += 500 + lives * 50;
    level += 1;
    homes = [false, false, false, false, false];
    hazards = buildHazards();
    resetFrog();
    syncHud();
  }

  function die() {
    lives -= 1;
    syncHud();
    if (lives <= 0) {
      state = "over";
      showOverlay("Game Over", `Final score ${score}. Try again?`, "Play again");
      return;
    }
    state = "dead";
    deathTimer = 0.7;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function update(dt) {
    if (state === "dead") {
      deathTimer -= dt;
      if (deathTimer <= 0) {
        resetFrog();
        state = "playing";
      }
      return;
    }
    if (state !== "playing") return;

    hopCooldown = Math.max(0, hopCooldown - dt);

    for (const h of hazards) {
      h.x += h.speed * dt;
      if (h.speed > 0 && h.x > WIDTH + 20) h.x = -h.w - 20;
      if (h.speed < 0 && h.x + h.w < -20) h.x = WIDTH + 20;

      if (h.kind === "turtle" && h.dive !== undefined) {
        h.dive += dt;
        const cycle = h.dive % 5.5;
        h.submerged = cycle > 3.6 && cycle < 4.8;
      }
    }

    // Road collision
    if (frog.row >= 7 && frog.row <= 11) {
      for (const h of hazards) {
        if (h.kind !== "car") continue;
        if (rectsOverlap(frog, h)) {
          die();
          return;
        }
      }
    }

    // River logic
    if (frog.row >= 1 && frog.row <= 5) {
      let riding = /** @type {Hazard | null} */ (null);
      for (const h of hazards) {
        if (h.kind === "car") continue;
        if (h.submerged) continue;
        if (rectsOverlap(frog, h)) {
          riding = h;
          break;
        }
      }
      if (!riding) {
        die();
        return;
      }
      frog.onLog = riding;
      frog.x += riding.speed * dt;
      frog.col = Math.floor((frog.x + frog.w / 2) / TILE);
      if (frog.x < -2 || frog.x + frog.w > WIDTH + 2) {
        die();
        return;
      }
    } else {
      frog.onLog = null;
      frog.x = frog.col * TILE + 3;
      frog.y = frog.row * TILE + 3;
    }
  }

  function drawBackground() {
    // Home bank
    ctx.fillStyle = "#1e4d2b";
    ctx.fillRect(0, 0, WIDTH, TILE);

    // Water
    ctx.fillStyle = "#155a82";
    ctx.fillRect(0, TILE, WIDTH, TILE * 5);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(i * 55 + 10, TILE * 2 + 8, 30, 2);
      ctx.fillRect(i * 50 + 20, TILE * 4 + 14, 24, 2);
    }

    // Median
    ctx.fillStyle = "#3a6e2f";
    ctx.fillRect(0, TILE * 6, WIDTH, TILE);

    // Road
    ctx.fillStyle = "#2c3036";
    ctx.fillRect(0, TILE * 7, WIDTH, TILE * 5);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.setLineDash([8, 10]);
    ctx.lineWidth = 2;
    for (let r = 8; r <= 11; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * TILE);
      ctx.lineTo(WIDTH, r * TILE);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Start grass
    ctx.fillStyle = "#2f6b3a";
    ctx.fillRect(0, TILE * 12, WIDTH, TILE);

    // Home alcoves
    const padStarts = [0, 3, 6, 9, 11];
    padStarts.forEach((c, i) => {
      const x = c * TILE;
      const w = (i === 4 ? 2 : 2) * TILE;
      ctx.fillStyle = homes[i] ? "#4caf50" : "#0d3a55";
      ctx.fillRect(x + 4, 4, w - 8, TILE - 8);
      if (homes[i]) {
        drawFrogIcon(x + w / 2 - 10, 8, 20, "up", "#9dff9a");
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.beginPath();
        ctx.arc(x + w / 2, TILE / 2, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Grass posts between home pads
    ctx.fillStyle = "#1a3d24";
    [2, 5, 8].forEach((c) => {
      ctx.fillRect(c * TILE, 0, TILE, TILE);
    });
  }

  function drawHazards() {
    for (const h of hazards) {
      if (h.kind === "car") {
        roundRect(h.x, h.y, h.w, h.h, 4, h.color);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(h.x + 6, h.y + 4, h.w - 12, 5);
        ctx.fillStyle = "#222";
        ctx.fillRect(h.x + 4, h.y + h.h - 5, 8, 4);
        ctx.fillRect(h.x + h.w - 12, h.y + h.h - 5, 8, 4);
      } else if (h.kind === "log") {
        roundRect(h.x, h.y, h.w, h.h, 6, h.color);
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.moveTo(h.x + 12, h.y + 3);
        ctx.lineTo(h.x + 12, h.y + h.h - 3);
        ctx.moveTo(h.x + h.w - 12, h.y + 3);
        ctx.lineTo(h.x + h.w - 12, h.y + h.h - 3);
        ctx.stroke();
      } else {
        if (h.submerged) {
          ctx.fillStyle = "rgba(255,255,255,0.12)";
          ctx.beginPath();
          ctx.ellipse(h.x + h.w / 2, h.y + h.h / 2, h.w / 2.4, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        const shells = Math.max(2, Math.floor(h.w / 28));
        for (let i = 0; i < shells; i++) {
          const cx = h.x + 16 + i * 28;
          ctx.fillStyle = h.color;
          ctx.beginPath();
          ctx.ellipse(cx, h.y + h.h / 2, 12, h.h / 2 - 1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#245a42";
          ctx.beginPath();
          ctx.arc(cx, h.y + h.h / 2, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawFrogIcon(x, y, size, facing, color) {
    ctx.save();
    ctx.translate(x + size / 2, y + size / 2);
    const rot = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[facing] || 0;
    ctx.rotate(rot);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.38, size * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-size * 0.18, -size * 0.28, size * 0.14, 0, Math.PI * 2);
    ctx.arc(size * 0.18, -size * 0.28, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#102418";
    ctx.beginPath();
    ctx.arc(-size * 0.18, -size * 0.3, size * 0.05, 0, Math.PI * 2);
    ctx.arc(size * 0.18, -size * 0.3, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    drawBackground();
    drawHazards();
    if (state !== "dead" || Math.floor(deathTimer * 12) % 2 === 0) {
      const color = state === "dead" ? "#d64545" : "#7CFF6B";
      drawFrogIcon(frog.x, frog.y, frog.w, frog.facing, color);
    }
  }

  function loop(ts) {
    const dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    update(dt);
    draw();
    if (state !== "over" && state !== "title") {
      animId = requestAnimationFrame(loop);
    } else {
      draw();
    }
  }

  // Input
  const keyMap = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    w: "up",
    W: "up",
    s: "down",
    S: "down",
    a: "left",
    A: "left",
    d: "right",
    D: "right",
  };

  window.addEventListener("keydown", (e) => {
    const dir = keyMap[e.key];
    if (!dir) return;
    e.preventDefault();
    if (state === "title" || state === "over") {
      startGame(true);
      return;
    }
    moveFrog(dir);
  });

  document.querySelectorAll(".pad").forEach((btn) => {
    const fire = (e) => {
      e.preventDefault();
      const dir = btn.getAttribute("data-dir");
      if (!dir) return;
      if (state === "title" || state === "over") {
        startGame(true);
        return;
      }
      moveFrog(dir);
    };
    btn.addEventListener("pointerdown", fire);
  });

  startBtn.addEventListener("click", () => startGame(true));

  // Initial draw
  hazards = buildHazards();
  draw();
  showOverlay(
    "Frogger",
    "Hop across traffic and ride logs home. Fill all five pads.",
    "Start"
  );
})();
