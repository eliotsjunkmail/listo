(() => {
  const STORAGE_KEY = "frogger-stocks-v2";
  const BUY_DOLLARS = 100_000;
  const DEFAULTS = {
    symbols: ["SNAP", "META", "GOOG"],
    synthetic: true,
    pace: 4,
    orientation: "vertical",
  };

  const SYNTH_BASE = {
    SNAP: { open: 10.4, last: 10.4, spread: 0.04 },
    META: { open: 512, last: 512, spread: 0.35 },
    GOOG: { open: 178, last: 178, spread: 0.12 },
  };

  const els = {
    world: document.getElementById("world"),
    river: document.getElementById("river"),
    frog: document.getElementById("frog"),
    frogLev: document.getElementById("frog-lev"),
    gear: document.getElementById("gear"),
    scrim: document.getElementById("scrim"),
    panel: document.getElementById("panel"),
    symA: document.getElementById("sym-a"),
    symB: document.getElementById("sym-b"),
    symC: document.getElementById("sym-c"),
    market: document.getElementById("market"),
    marketLabel: document.getElementById("market-label"),
    synthToggle: document.getElementById("synth-toggle"),
    synthLabel: document.getElementById("synth-label"),
    synthPace: document.getElementById("synth-pace"),
    paceSlider: document.getElementById("pace-slider"),
    paceValue: document.getElementById("pace-value"),
    orientation: document.getElementById("orientation"),
    hudCash: document.getElementById("hud-cash"),
    hudBuys: document.getElementById("hud-buys"),
    toast: document.getElementById("toast"),
    pad: document.getElementById("pad"),
    logs: [0, 1, 2].map((i) => ({
      el: document.getElementById("log-" + i),
      sym: document.getElementById("sym-" + i),
      last: document.getElementById("last-" + i),
      chg: document.getElementById("chg-" + i),
      res: document.getElementById("res-" + i),
      sup: document.getElementById("sup-" + i),
    })),
  };

  /** @type {{symbol:string, open:number, last:number, bid:number, ask:number, change:number, support?:number, resistance?:number, velocity?:number}[]} */
  let quotes = DEFAULTS.symbols.map((symbol) => seedQuote(symbol));
  /** Previous last prices — used to infer trail direction when velocity is missing */
  let prevLast = [null, null, null];
  /** Sticky trail direction per lane so brief flat ticks don't flicker the wake off */
  let trailDir = [0, 0, 0];

  /** frogLane: -1 bottom bank, 0 nearest river log, 1 mid, 2 far, 3 top bank.
   *  DOM logs are top→bottom as indices 0,1,2 so nearest is log index 2. */
  let frogLane = -1;
  let frogX = 0.5;
  /** Offset of frog center from log center while riding */
  let rideOffsetX = 0;
  let rideOffsetY = 0;
  let riding = false;
  let busy = false;
  let toastTimer = 0;
  let synthTimer = 0;
  let rideRaf = 0;
  /** While > now, frog eases to the new leverage seat (skip mid-slide rAF snaps) */
  let leverageSlideUntil = 0;
  let leverageSlideArmed = false;

  /** @type {{symbol:string, shares:number, invested:number, entry:number}|null} */
  let holding = null;
  /** Liquid cash after selling back to shore; spent when boarding a log */
  let cash = BUY_DOLLARS;
  /** Tap the frog to cycle 1× → 2× → 3× → 1× */
  let leverage = 1;

  const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

  function readCookie(name) {
    const parts = document.cookie.split("; ");
    for (const part of parts) {
      if (part.startsWith(name + "=")) {
        return decodeURIComponent(part.slice(name.length + 1));
      }
    }
    return "";
  }

  function writeCookie(name, value) {
    document.cookie =
      name +
      "=" +
      encodeURIComponent(value) +
      "; Max-Age=" +
      COOKIE_MAX_AGE +
      "; Path=/; SameSite=Lax";
  }

  function normalizeSymbol(raw, fallback) {
    const s = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z.]/g, "")
      .slice(0, 8);
    return s || fallback;
  }

  function clampPace(n) {
    const p = Math.round(Number(n));
    if (!Number.isFinite(p)) return DEFAULTS.pace;
    return Math.min(10, Math.max(1, p));
  }

  function normalizeOrientation(raw) {
    return raw === "horizontal" ? "horizontal" : "vertical";
  }

  function parseSettings(raw) {
    const parsed = JSON.parse(raw);
    const symbols = Array.isArray(parsed.symbols)
      ? parsed.symbols
      : [parsed.symA, parsed.symB, parsed.symC];
    return {
      symbols: [
        normalizeSymbol(symbols?.[0], DEFAULTS.symbols[0]),
        normalizeSymbol(symbols?.[1], DEFAULTS.symbols[1]),
        normalizeSymbol(symbols?.[2], DEFAULTS.symbols[2]),
      ],
      synthetic: Boolean(parsed.synthetic),
      pace: clampPace(parsed.pace ?? DEFAULTS.pace),
      orientation: normalizeOrientation(parsed.orientation ?? DEFAULTS.orientation),
    };
  }

  function loadSettings() {
    try {
      const fromCookie = readCookie(STORAGE_KEY);
      if (fromCookie) return parseSettings(fromCookie);
      const fromLocal = localStorage.getItem(STORAGE_KEY);
      if (fromLocal) {
        const cfg = parseSettings(fromLocal);
        persist(cfg);
        return cfg;
      }
    } catch {
      /* defaults */
    }
    return {
      symbols: [...DEFAULTS.symbols],
      synthetic: DEFAULTS.synthetic,
      pace: DEFAULTS.pace,
      orientation: DEFAULTS.orientation,
    };
  }

  function persist(cfg) {
    const payload = JSON.stringify(cfg);
    writeCookie(STORAGE_KEY, payload);
    try {
      localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      /* ignore */
    }
  }

  function seedQuote(symbol) {
    const base = SYNTH_BASE[symbol] || {
      open: 100,
      last: 100,
      spread: 0.08,
    };
    const half = base.spread / 2;
    return withLevels({
      symbol,
      open: base.open,
      last: base.last,
      bid: base.last - half,
      ask: base.last + half,
      change: 0,
    });
  }

  function withLevels(q) {
    // Fixed channel around last, wide enough that the log sits between S and R
    const halfLog = estimateLogHalfPrice(q);
    const pad = Math.max(q.open * 0.006, 0.04);
    const gap = halfLog + pad * (1.2 + Math.random() * 0.8);
    const support = q.last - gap;
    const resistance = q.last + gap;
    const speed = Math.max(q.open * 0.00018, 0.003);
    return {
      ...q,
      support,
      resistance,
      velocity: (Math.random() > 0.5 ? 1 : -1) * speed,
    };
  }

  function estimateLogHalfPrice(q) {
    if (isVertical()) {
      const laneH = els.river?.clientHeight || 300;
      const scale = pxPerDollar(q.open, laneH);
      const h = Math.max(72, Math.min(120, laneH * 0.18));
      return h / 2 / Math.max(scale, 1e-6);
    }
    const worldW = els.world?.clientWidth || window.innerWidth || 390;
    const scale = pxPerDollar(q.open, worldW);
    return 75 / Math.max(scale, 1e-6);
  }

  function ensureLevels(q) {
    if (
      Number.isFinite(q.support) &&
      Number.isFinite(q.resistance) &&
      q.resistance > q.support &&
      Number.isFinite(q.velocity)
    ) {
      return q;
    }
    return withLevels(q);
  }

  function slimPrice(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    let body;
    if (abs >= 100) body = abs.toFixed(2);
    else if (abs >= 10) body = abs.toFixed(2);
    else body = abs.toFixed(2);
    return (n < 0 ? "−" : "") + body;
  }

  function slimChange(n) {
    if (n == null || !Number.isFinite(n)) return "";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "";
    return sign + Math.abs(n).toFixed(2);
  }

  function isNyseOpen(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(now);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = get("weekday");
    if (weekday === "Sat" || weekday === "Sun") return false;
    let hour = Number(get("hour"));
    const minute = Number(get("minute"));
    if (hour === 24) hour = 0;
    const mins = hour * 60 + minute;
    return mins >= 9 * 60 + 30 && mins < 16 * 60;
  }

  function updateMarketBadge() {
    const open = isNyseOpen();
    els.market.classList.toggle("is-open", open);
    els.market.classList.toggle("is-closed", !open);
    els.marketLabel.textContent = open ? "NYSE open" : "NYSE closed";
    els.market.setAttribute("aria-label", open ? "NYSE is open" : "NYSE is closed");
    return open;
  }

  function yahooUrl(symbol) {
    return (
      "https://query2.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?interval=1m&range=1d&includePrePost=false"
    );
  }

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadYahoo(symbol) {
    const url = yahooUrl(symbol);
    const enc = encodeURIComponent(url);
    const attempts = [
      async () => fetchJson(url),
      async () => {
        const j = await fetchJson("https://api.allorigins.win/get?url=" + enc);
        if (!j.contents) throw new Error("empty proxy");
        return JSON.parse(j.contents);
      },
      async () => fetchJson("https://corsproxy.io/?" + enc),
      async () =>
        fetchJson("https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(url)),
    ];
    let lastErr;
    for (const attempt of attempts) {
      try {
        const data = await attempt();
        const result = data?.chart?.result?.[0];
        if (!result?.meta) throw new Error("bad payload");
        return result;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("quote failed");
  }

  function parseQuote(result, symbol) {
    const meta = result.meta;
    const quoteData = result.indicators?.quote?.[0] || {};
    const closes = (quoteData.close || []).filter((v) => v != null);
    const last = Number(meta.regularMarketPrice ?? closes[closes.length - 1]);
    const open = Number(
      meta.regularMarketOpen ?? meta.chartPreviousClose ?? meta.previousClose ?? last
    );
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose ?? open);
    let bid = Number(meta.bid);
    let ask = Number(meta.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || ask <= bid) {
      const spread = Math.max(last * 0.0008, 0.01);
      bid = last - spread / 2;
      ask = last + spread / 2;
    }
    return {
      symbol: meta.symbol || symbol,
      open: Number.isFinite(open) ? open : last,
      last,
      bid,
      ask,
      change: Number.isFinite(last) && Number.isFinite(prev) ? last - prev : 0,
    };
  }

  function pxPerDollar(open, span) {
    const band = Math.max(open * 0.04, 0.5);
    return (span * 0.42) / band;
  }

  function isVertical() {
    return loadSettings().orientation !== "horizontal";
  }

  function updateLogTrail(i, q, vertical) {
    const el = els.logs[i]?.el;
    if (!el || !q) return;

    let dir = 0;
    if (Number.isFinite(q.velocity) && Math.abs(q.velocity) > 1e-9) {
      dir = Math.sign(q.velocity);
    } else if (prevLast[i] != null && Number.isFinite(q.last)) {
      const delta = q.last - prevLast[i];
      if (Math.abs(delta) > 1e-9) dir = Math.sign(delta);
    }
    if (dir !== 0) trailDir[i] = dir;
    if (Number.isFinite(q.last)) prevLast[i] = q.last;

    el.classList.remove("trail-left", "trail-right", "trail-top", "trail-bottom");
    const d = trailDir[i];
    if (!d) return;

    // Price up → right (horizontal) or toward top (vertical). Wake sits behind motion.
    if (vertical) {
      el.classList.add(d > 0 ? "trail-bottom" : "trail-top");
    } else {
      el.classList.add(d > 0 ? "trail-left" : "trail-right");
    }

    const speed = Number.isFinite(q.velocity) ? Math.abs(q.velocity) : 0;
    const open = Math.max(q.open || 1, 0.5);
    const t = Math.min(1, speed / Math.max(open * 0.00025, 0.004));
    el.style.setProperty("--trail-len", Math.round(40 + t * 48) + "px");
  }

  function applyOrientationClass() {
    const vertical = isVertical();
    document.body.classList.toggle("is-vertical", vertical);
    document.body.classList.toggle("is-horizontal", !vertical);
    return vertical;
  }

  function layoutLogs() {
    const vertical = applyOrientationClass();
    const worldW = els.world.clientWidth || window.innerWidth;
    const riverH = els.river.clientHeight || 300;

    quotes.forEach((q, i) => {
      const log = els.logs[i];
      if (!log?.el || !q || !Number.isFinite(q.last) || !Number.isFinite(q.open)) return;
      const lane = log.el.parentElement;
      if (!lane) return;

      if (vertical) {
        // Columns: log rides the full river height. Price up → toward top.
        const laneH = lane.clientHeight || riverH;
        const center = laneH / 2;
        const scale = pxPerDollar(q.open, laneH);
        // Keep logs compact so S/R lines have room above and below
        const minH = Math.max(72, Math.min(120, laneH * 0.18));
        let topEdge = center - (q.ask - q.open) * scale;
        let botEdge = center - (q.bid - q.open) * scale;
        if (botEdge - topEdge < minH) {
          const mid = center - (q.last - q.open) * scale;
          topEdge = mid - minH / 2;
          botEdge = mid + minH / 2;
        }
        const h = botEdge - topEdge;
        let placedMid = (topEdge + botEdge) / 2;
        const margin = h * 0.28 + 36;
        placedMid = Math.min(laneH - margin, Math.max(margin, placedMid));

        const colW = lane.clientWidth || worldW / 3;
        log.el.style.left = "50%";
        log.el.style.width = Math.min(colW * 0.72, 120) + "px";
        log.el.style.height = h + "px";
        log.el.style.top = placedMid + "px";
      } else {
        const center = worldW / 2;
        const minW = 150;
        const scale = pxPerDollar(q.open, worldW);
        let leftEdge = center + (q.bid - q.open) * scale;
        let rightEdge = center + (q.ask - q.open) * scale;
        if (rightEdge - leftEdge < minW) {
          const mid = center + (q.last - q.open) * scale;
          leftEdge = mid - minW / 2;
          rightEdge = mid + minW / 2;
        }
        const w = rightEdge - leftEdge;
        let placedMid = (leftEdge + rightEdge) / 2;
        const margin = w * 0.35 + 36;
        placedMid = Math.min(worldW - margin, Math.max(margin, placedMid));

        log.el.style.top = "50%";
        log.el.style.height = "";
        log.el.style.width = w + "px";
        log.el.style.left = placedMid + "px";
      }

      log.sym.textContent = q.symbol;
      log.last.textContent = slimPrice(q.last);
      log.chg.textContent = slimChange(q.change);
      log.el.classList.toggle("is-up", q.change > 0.004);
      log.el.classList.toggle("is-down", q.change < -0.004);
      updateLogTrail(i, q, vertical);

      // Draw fixed S/R from price levels (they stay put until a breakout)
      layoutLevelLines(i, q, vertical, lane);
    });

    placeFrog();
    updateHud();
  }

  function layoutLevelLines(i, q, vertical, lane) {
    const resEl = els.logs[i].res;
    const supEl = els.logs[i].sup;
    if (!resEl || !supEl || !lane) return;
    const synth = document.body.classList.contains("synth-on");
    if (
      !synth ||
      !Number.isFinite(q.support) ||
      !Number.isFinite(q.resistance) ||
      !Number.isFinite(q.open)
    ) {
      resEl.hidden = true;
      supEl.hidden = true;
      return;
    }
    resEl.hidden = false;
    supEl.hidden = false;

    if (vertical) {
      const laneH = lane.clientHeight || 300;
      const center = laneH / 2;
      const scale = pxPerDollar(q.open, laneH);
      const resY = center - (q.resistance - q.open) * scale;
      const supY = center - (q.support - q.open) * scale;
      resEl.style.top = resY + "px";
      resEl.style.left = "0";
      resEl.style.right = "0";
      resEl.style.bottom = "auto";
      supEl.style.top = supY + "px";
      supEl.style.left = "0";
      supEl.style.right = "0";
      supEl.style.bottom = "auto";
    } else {
      const worldW = els.world.clientWidth || window.innerWidth;
      const center = worldW / 2;
      const scale = pxPerDollar(q.open, worldW);
      const resX = center + (q.resistance - q.open) * scale;
      const supX = center + (q.support - q.open) * scale;
      resEl.style.left = resX + "px";
      resEl.style.top = "0";
      resEl.style.bottom = "0";
      resEl.style.right = "auto";
      supEl.style.left = supX + "px";
      supEl.style.top = "0";
      supEl.style.bottom = "0";
      supEl.style.right = "auto";
    }

    resEl.querySelector("span").textContent = "R " + slimPrice(q.resistance);
    supEl.querySelector("span").textContent = "S " + slimPrice(q.support);
  }

  /** Horizontal rows: lane 0=nearest maps to log index 2. Vertical columns: lane == log index. */
  function logIndexForLane(lane) {
    if (lane < 0 || lane > 2) return -1;
    return isVertical() ? lane : 2 - lane;
  }

  function columnFromFrogX() {
    const river = els.river.getBoundingClientRect();
    const world = els.world.getBoundingClientRect();
    const x = frogX * (els.world.clientWidth || 1);
    const rel = (x + world.left - river.left) / Math.max(1, river.width);
    return Math.min(2, Math.max(0, Math.floor(rel * 3)));
  }

  function laneY(lane) {
    const riverTop = els.river.offsetTop;
    const riverH = els.river.clientHeight;
    const worldH = els.world.clientHeight;
    const frog = els.frog.offsetHeight || 44;

    if (lane < 0) {
      // Start on the bottom bank at the water's edge
      return riverTop + riverH + 4;
    }
    if (lane > 2) {
      return Math.max(12, worldH * 0.09 - frog / 2);
    }
    if (isVertical()) {
      // Resting Y before ride snap — mid river
      return riverTop + riverH / 2 - frog / 2;
    }
    const laneH = riverH / 3;
    const row = 2 - lane;
    return riverTop + row * laneH + laneH / 2 - frog / 2;
  }

  function leverageSpotT() {
    if (leverage <= 1) return 0.22;
    if (leverage === 2) return 0.5;
    return 0.78;
  }

  /** Horizontal offset from log center for the current leverage seat */
  function leverageRideOffsetX(logWidth) {
    return logWidth * (leverageSpotT() - 0.5);
  }

  function placeFrog() {
    const frog = els.frog;
    const worldW = els.world.clientWidth;
    const worldBox = els.world.getBoundingClientRect();
    const size = frog.offsetWidth || 44;
    const logIdx = logIndexForLane(frogLane);

    frog.style.bottom = "auto";

    if (riding && logIdx >= 0) {
      const logBox = els.logs[logIdx].el.getBoundingClientRect();
      const logCx = logBox.left + logBox.width / 2 - worldBox.left;
      const logCy = logBox.top + logBox.height / 2 - worldBox.top;
      rideOffsetX = leverageRideOffsetX(logBox.width);
      const fx = logCx + rideOffsetX;
      const fy = logCy + rideOffsetY - size / 2;
      const sliding = performance.now() < leverageSlideUntil;

      if (sliding) {
        if (leverageSlideArmed) {
          leverageSlideArmed = false;
          frog.classList.remove("is-riding");
          frog.style.transition =
            "left 0.2s ease, top 0.2s ease, width 0.18s ease, height 0.18s ease";
          frog.style.left = fx + "px";
          frog.style.top = fy + "px";
          frogX = fx / worldW;
        }
        startRideLoop();
        return;
      }

      frog.classList.add("is-riding");
      frog.style.transition = "none";
      frog.style.left = fx + "px";
      frog.style.top = fy + "px";
      frogX = fx / worldW;
      startRideLoop();
    } else {
      frog.classList.remove("is-riding");
      stopRideLoop();
      const x = Math.min(worldW - size / 2 - 8, Math.max(size / 2 + 8, frogX * worldW));
      frog.style.left = x + "px";
      frog.style.top = laneY(frogLane) + "px";
      restoreFrogTransition();
    }
  }

  function syncFrogRideFrame() {
    rideRaf = 0;
    if (!riding) return;
    placeFrog();
  }

  function startRideLoop() {
    if (rideRaf) return;
    rideRaf = requestAnimationFrame(syncFrogRideFrame);
  }

  function stopRideLoop() {
    if (!rideRaf) return;
    cancelAnimationFrame(rideRaf);
    rideRaf = 0;
  }

  function frogCenter() {
    const frog = els.frog.getBoundingClientRect();
    const world = els.world.getBoundingClientRect();
    return {
      x: frog.left + frog.width / 2 - world.left,
      y: frog.top + frog.height / 2 - world.top,
      size: frog.height || 44,
    };
  }

  function positionFrogAt(landX, landYTop) {
    const worldW = els.world.clientWidth;
    const size = els.frog.offsetWidth || 44;
    const x = Math.min(worldW - size / 2 - 8, Math.max(size / 2 + 8, landX));
    // Clear CSS bottom anchor and skip transition so layout matches instantly
    els.frog.style.transition = "none";
    els.frog.style.bottom = "auto";
    els.frog.style.left = x + "px";
    els.frog.style.top = landYTop + "px";
    void els.frog.offsetWidth;
    frogX = x / worldW;
  }

  function restoreFrogTransition() {
    els.frog.style.transition = "";
  }

  function showToast(msg) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 1600);
  }

  function quoteForSymbol(symbol) {
    return quotes.find((q) => q.symbol === symbol) || null;
  }

  function money(n) {
    return (
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function pnlText(value) {
    const pnl = value - BUY_DOLLARS;
    const pct = (pnl / BUY_DOLLARS) * 100;
    const sign = pnl >= 0 ? "+" : "−";
    const dollars =
      "$" +
      Math.abs(pnl).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    const percent =
      Math.abs(pct).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + "%";
    return sign + dollars + " (" + sign + percent + ")";
  }

  function holdingValue() {
    if (!holding) return null;
    const q = quoteForSymbol(holding.symbol);
    const px = q && Number.isFinite(q.last) && q.last > 0 ? q.last : null;
    if (px == null || !Number.isFinite(holding.entry) || holding.entry <= 0) return null;
    // Margin stays invested; P&L is amplified by leverage
    const equity = holding.invested * (1 + leverage * (px / holding.entry - 1));
    return Math.max(0, equity);
  }

  function updateLeverageUi() {
    els.frog.dataset.lev = String(leverage);
    els.frog.setAttribute(
      "aria-label",
      "Leverage " + leverage + "x. Tap to change"
    );
    if (els.frogLev) els.frogLev.textContent = leverage + "×";
  }

  function cycleLeverage() {
    if (!els.scrim.hidden) return;
    leverage = leverage >= 3 ? 1 : leverage + 1;
    if (holding && Number.isFinite(holding.entry) && holding.entry > 0) {
      holding.shares = (holding.invested * leverage) / holding.entry;
    }
    updateLeverageUi();
    if (riding) {
      leverageSlideUntil = performance.now() + 220;
      leverageSlideArmed = true;
      placeFrog();
    }
    updateHud();
    showToast(leverage + "× leverage");
  }

  function updateHud() {
    if (!holding) {
      els.hudCash.textContent = "Cash " + money(cash) + "  " + pnlText(cash);
      els.hudBuys.textContent = leverage + "× · Jump a log to invest";
      return;
    }
    const value = holdingValue();
    const q = quoteForSymbol(holding.symbol);
    const px = q?.last;
    if (value == null || px == null) {
      els.hudCash.textContent = holding.symbol + " —";
      els.hudBuys.textContent = leverage + "×";
      return;
    }
    els.hudCash.textContent = money(value) + "  " + pnlText(value);
    els.hudBuys.textContent =
      holding.symbol +
      " · " +
      leverage +
      "× · " +
      holding.shares.toFixed(holding.shares >= 10 ? 2 : 3) +
      " sh @ " +
      slimPrice(px);
  }

  /** Sell the open position into cash (shore). Stops tracking stock moves. */
  function sellToCash() {
    if (!holding) return;
    const value = holdingValue();
    const from = holding.symbol;
    if (value != null && value > 0) {
      cash = value;
      showToast("Sold " + from + " → " + money(cash) + " cash");
    } else {
      cash = 0;
      showToast("Closed " + from + " — wiped out");
    }
    holding = null;
    updateHud();
  }

  /** First log: invest cash. Switching logs: sell MTM value, buy the next stock. */
  function landOnLog(index) {
    const q = quotes[index];
    if (!q || !Number.isFinite(q.last) || q.last <= 0) return;

    if (!holding) {
      const spend = cash > 0 ? cash : BUY_DOLLARS;
      const notional = spend * leverage;
      holding = {
        symbol: q.symbol,
        shares: notional / q.last,
        invested: spend,
        entry: q.last,
      };
      cash = 0;
      updateHud();
      showToast(
        "Invested " +
          money(spend) +
          " @ " +
          leverage +
          "× in " +
          q.symbol +
          " @ " +
          slimPrice(q.last)
      );
      return;
    }

    if (holding.symbol === q.symbol) {
      updateHud();
      return;
    }

    const soldValue = holdingValue();
    if (soldValue == null || soldValue <= 0) {
      holding = null;
      cash = 0;
      updateHud();
      return;
    }
    const from = holding.symbol;
    const notional = soldValue * leverage;
    holding = {
      symbol: q.symbol,
      shares: notional / q.last,
      invested: soldValue,
      entry: q.last,
    };
    updateHud();
    showToast(
      "Sold " +
        from +
        " (" +
        money(soldValue) +
        ") → " +
        leverage +
        "× " +
        q.symbol +
        " @ " +
        slimPrice(q.last)
    );
  }

  function frogOverlapsLog(index) {
    const frog = els.frog.getBoundingClientRect();
    const log = els.logs[index].el.getBoundingClientRect();
    const pad = 6;
    return (
      frog.left + pad < log.right &&
      frog.right - pad > log.left &&
      frog.top + pad < log.bottom &&
      frog.bottom - pad > log.top
    );
  }

  function finishMove() {
    placeFrog();
    window.setTimeout(() => {
      els.frog.classList.remove("is-jumping");
      busy = false;
    }, 220);
  }

  /**
   * Jump toward a log; land on the leverage seat (left 1× / mid 2× / right 3×).
   */
  function tryBoard(logIdx, nextLane, landX) {
    const worldBox = els.world.getBoundingClientRect();
    const size = els.frog.offsetWidth || 44;
    const prev = frogCenter();
    const prevLane = frogLane;
    const prevRiding = riding;
    const prevOffX = rideOffsetX;
    const prevOffY = rideOffsetY;
    const prevFrogX = frogX;
    const aimX = landX != null ? landX : prev.x;

    const logBox = els.logs[logIdx].el.getBoundingClientRect();
    const logLeft = logBox.left - worldBox.left;
    const logRight = logBox.right - worldBox.left;
    const logTop = logBox.top - worldBox.top;
    const logBot = logBox.bottom - worldBox.top;
    const logCx = (logLeft + logRight) / 2;
    const logCy = (logTop + logBot) / 2;
    const logW = logRight - logLeft;

    const insetX = Math.min(size * 0.35, Math.max(8, logW * 0.2));
    const minX = logLeft + insetX;
    const maxX = logRight - insetX;
    const minY = logTop + 4;
    const maxY = Math.max(minY, logBot - size * 0.5);

    if (maxX < minX || logBot - logTop < size * 0.4) {
      restoreFrogTransition();
      finishMove();
      return;
    }

    const fromBank = prevLane < 0;
    const reach = Math.max(logW, size) * 0.65;
    if (!fromBank && (aimX < logLeft - reach || aimX > logRight + reach)) {
      frogLane = prevLane;
      riding = prevRiding;
      rideOffsetX = prevOffX;
      rideOffsetY = prevOffY;
      frogX = prevFrogX;
      finishMove();
      return;
    }

    const landCenterX = Math.min(
      maxX,
      Math.max(minX, logLeft + logW * leverageSpotT())
    );
    const preferY = isVertical() ? logBot - size - 4 : laneY(nextLane);
    const landYTop = Math.min(maxY, Math.max(minY, preferY));
    const landCenterY = landYTop + size / 2;

    frogLane = nextLane;
    rideOffsetX = leverageRideOffsetX(logW);
    rideOffsetY = landCenterY - logCy;
    riding = true;
    leverageSlideUntil = 0;

    positionFrogAt(landCenterX, landYTop);
    landOnLog(logIdx);
    placeFrog();
    window.setTimeout(() => {
      els.frog.classList.remove("is-jumping");
      busy = false;
    }, 220);
  }

  function move(dir) {
    if (busy || !els.scrim.hidden) return;
    busy = true;
    els.frog.classList.add("is-jumping");

    if (isVertical()) {
      if (dir === "left" || dir === "right") {
        if (frogLane < 0 || frogLane > 2) {
          frogX = Math.min(0.92, Math.max(0.08, frogX + (dir === "right" ? 0.12 : -0.12)));
          riding = false;
          rideOffsetX = 0;
          rideOffsetY = 0;
          finishMove();
          return;
        }
        const next = Math.min(2, Math.max(0, frogLane + (dir === "right" ? 1 : -1)));
        if (next === frogLane) {
          finishMove();
          return;
        }
        // Jump sideways; keep current Y, shift X toward the next column
        const colW = els.river.clientWidth / 3;
        const landX = frogCenter().x + (dir === "right" ? colW : -colW);
        tryBoard(next, next, landX);
        return;
      }
      if (dir === "up") {
        if (frogLane < 0) {
          const col = columnFromFrogX();
          tryBoard(col, col, frogCenter().x);
          return;
        }
        if (frogLane <= 2) {
          frogLane = 3;
          riding = false;
          rideOffsetX = 0;
          rideOffsetY = 0;
          sellToCash();
          finishMove();
          return;
        }
        finishMove();
        return;
      }
      if (dir === "down") {
        if (frogLane > 2) {
          tryBoard(1, 1, frogCenter().x);
          return;
        }
        if (frogLane >= 0 && frogLane <= 2) {
          frogLane = -1;
          riding = false;
          rideOffsetX = 0;
          rideOffsetY = 0;
          sellToCash();
          finishMove();
          return;
        }
        finishMove();
        return;
      }
    }

    if (dir === "left") {
      frogX = Math.max(0.08, frogX - 0.08);
      riding = false;
      rideOffsetX = 0;
      rideOffsetY = 0;
    } else if (dir === "right") {
      frogX = Math.min(0.92, frogX + 0.08);
      riding = false;
      rideOffsetX = 0;
      rideOffsetY = 0;
    } else if (dir === "up") {
      const next = Math.min(3, frogLane + 1);
      const logIdx = logIndexForLane(next);
      if (logIdx >= 0) {
        tryBoard(logIdx, next, frogCenter().x);
        return;
      }
      frogLane = next;
      riding = false;
      rideOffsetX = 0;
      rideOffsetY = 0;
      if (next === 3) sellToCash();
    } else if (dir === "down") {
      const next = Math.max(-1, frogLane - 1);
      const logIdx = logIndexForLane(next);
      if (logIdx >= 0) {
        tryBoard(logIdx, next, frogCenter().x);
        return;
      }
      frogLane = next;
      riding = false;
      rideOffsetX = 0;
      rideOffsetY = 0;
      if (next === -1) sellToCash();
    }

    finishMove();
  }

  function tickSynthetic() {
    const pace = loadSettings().pace;
    const { stepScale, maxMove, meanRevert } = synthParams(pace);
    const breakChance = 0.08 + ((clampPace(pace) - 1) / 9) * 0.12;

    quotes = quotes.map((raw) => {
      let q = ensureLevels(raw);
      const half = estimateLogHalfPrice(q);
      const noise =
        (Math.random() - 0.5) * Math.max(q.open * 0.00008, 0.001) * stepScale;
      const towardOpen = (q.open - q.last) * meanRevert * 0.25;
      let velocity = q.velocity + towardOpen * 0.12 + noise;
      const maxSpeed = Math.max(q.open * 0.00012, 0.002) * stepScale * 2.2;
      velocity = Math.max(-maxSpeed, Math.min(maxSpeed, velocity));

      let last = q.last + velocity;
      let support = q.support;
      let resistance = q.resistance;
      let broke = null;
      const eps = Math.max(q.open * 0.00004, 0.0008);

      // Hit when the TOP of the log reaches resistance / BOTTOM reaches support
      const logTop = last + half;
      const logBot = last - half;

      if (logTop >= resistance && velocity > 0) {
        if (Math.random() < breakChance) {
          support = resistance;
          const extend = half + Math.max(q.open * 0.006, 0.04) * (0.9 + Math.random());
          resistance = last + extend;
          broke = "res";
        } else {
          // Rest the top of the log against resistance; reverse
          last = resistance - half - eps;
          velocity = -Math.abs(velocity) * (0.65 + Math.random() * 0.45);
        }
      } else if (logBot <= support && velocity < 0) {
        if (Math.random() < breakChance) {
          resistance = support;
          const extend = half + Math.max(q.open * 0.006, 0.04) * (0.9 + Math.random());
          support = last - extend;
          broke = "sup";
        } else {
          last = support + half + eps;
          velocity = Math.abs(velocity) * (0.65 + Math.random() * 0.45);
        }
      }

      const cap = q.open * maxMove * 1.4;
      last = Math.min(q.open + cap, Math.max(q.open - cap, Math.max(0.5, last)));
      const spread = Math.max(q.open * 0.00035, 0.01);

      return {
        ...q,
        last,
        bid: last - spread,
        ask: last + spread,
        change: last - q.open,
        support,
        resistance,
        velocity,
        _broke: broke,
      };
    });

    layoutLogs();
    quotes.forEach((q, i) => {
      if (!q._broke) return;
      const el = q._broke === "res" ? els.logs[i].res : els.logs[i].sup;
      if (!el) return;
      el.classList.remove("is-broken");
      void el.offsetWidth;
      el.classList.add("is-broken");
      window.setTimeout(() => el.classList.remove("is-broken"), 600);
    });
  }

  /** Pace 1 = quiet day, 10 = wild session. Controls step size + tick rate. */
  function synthParams(pace) {
    const t = (clampPace(pace) - 1) / 9;
    return {
      interval: Math.round(4200 - t * 3800),
      stepScale: 0.35 + t * 7.65,
      maxMove: 0.006 + t * 0.054,
      meanRevert: 0.02 - t * 0.012,
    };
  }

  function applyLogTransition(intervalMs) {
    const ms = Math.max(280, Math.min(2400, intervalMs * 0.85));
    const vertical = loadSettings().orientation !== "horizontal";
    els.logs.forEach(({ el }) => {
      el.style.transition = vertical
        ? `top ${ms}ms linear, height ${ms}ms ease`
        : `left ${ms}ms linear, width ${ms}ms ease`;
    });
  }

  function startSynthTimer() {
    window.clearInterval(synthTimer);
    const cfg = loadSettings();
    const { interval } = synthParams(cfg.pace);
    applyLogTransition(interval);
    synthTimer = window.setInterval(tickSynthetic, interval);
  }

  function syncPaceUi(pace) {
    const p = clampPace(pace);
    if (els.paceSlider) els.paceSlider.value = String(p);
    if (els.paceValue) els.paceValue.textContent = String(p);
  }

  function setSynthetic(on) {
    const cfg = loadSettings();
    cfg.synthetic = on;
    persist(cfg);
    els.synthToggle.setAttribute("aria-pressed", on ? "true" : "false");
    els.synthLabel.textContent = on ? "Synthetic on" : "Synthetic off";
    document.body.classList.toggle("synth-on", on);
    if (els.synthPace) els.synthPace.hidden = !on;
    window.clearInterval(synthTimer);
    if (on) {
      syncPaceUi(cfg.pace);
      quotes = cfg.symbols.map((s) => {
        const existing = quotes.find((q) => q.symbol === s);
        const base =
          existing && Number.isFinite(existing.last) ? { ...existing } : seedQuote(s);
        return withLevels(base);
      });
      quotes = quotes.map((q, i) => {
        const nudge = (i - 1) * q.open * 0.0015;
        const last = q.last + nudge;
        const half = Math.max(q.open * 0.00035, 0.01);
        return withLevels({
          ...q,
          last,
          bid: last - half,
          ask: last + half,
          change: last - q.open,
        });
      });
      layoutLogs();
      startSynthTimer();
    } else {
      els.logs.forEach(({ res, sup }) => {
        if (res) res.hidden = true;
        if (sup) sup.hidden = true;
      });
      document.body.classList.remove("synth-on");
      refresh(true);
    }
  }

  async function refresh(force) {
    const cfg = loadSettings();
    if (cfg.synthetic) return;
    if (!force && !isNyseOpen() && quotes.every((q) => Number.isFinite(q.last))) {
      layoutLogs();
      return;
    }
    try {
      const results = await Promise.all(
        cfg.symbols.map(async (symbol) => {
          try {
            return parseQuote(await loadYahoo(symbol), symbol);
          } catch (err) {
            console.error(symbol, err);
            return quotes.find((q) => q.symbol === symbol) || seedQuote(symbol);
          }
        })
      );
      quotes = results;
      layoutLogs();
    } catch (err) {
      console.error(err);
    }
  }

  function openSettings() {
    const cfg = loadSettings();
    els.symA.value = cfg.symbols[0];
    els.symB.value = cfg.symbols[1];
    els.symC.value = cfg.symbols[2];
    if (els.orientation) els.orientation.value = cfg.orientation;
    els.scrim.hidden = false;
    els.symA.focus();
  }

  function closeSettings(save) {
    if (save) {
      const next = {
        symbols: [
          normalizeSymbol(els.symA.value, DEFAULTS.symbols[0]),
          normalizeSymbol(els.symB.value, DEFAULTS.symbols[1]),
          normalizeSymbol(els.symC.value, DEFAULTS.symbols[2]),
        ],
        synthetic: loadSettings().synthetic,
        pace: loadSettings().pace,
        orientation: normalizeOrientation(els.orientation?.value),
      };
      persist(next);
      holding = null;
      cash = BUY_DOLLARS;
      updateHud();
      quotes = next.symbols.map((s) => seedQuote(s));
      applyLogTransition(synthParams(next.pace).interval);
      if (next.synthetic) setSynthetic(true);
      else refresh(true);
      layoutLogs();
    }
    els.scrim.hidden = true;
  }

  // boot
  const saved = loadSettings();
  els.symA.value = saved.symbols[0];
  els.symB.value = saved.symbols[1];
  els.symC.value = saved.symbols[2];
  if (els.orientation) els.orientation.value = saved.orientation;
  quotes = saved.symbols.map((s) => seedQuote(s));

  frogX = 0.5;
  updateLeverageUi();
  placeFrog();
  updateHud();
  updateMarketBadge();
  applyOrientationClass();
  layoutLogs();

  els.frog.addEventListener("click", (e) => {
    e.stopPropagation();
    cycleLeverage();
  });

  els.synthToggle.addEventListener("click", () => {
    const on = els.synthToggle.getAttribute("aria-pressed") !== "true";
    setSynthetic(on);
  });

  els.paceSlider?.addEventListener("input", () => {
    const pace = clampPace(els.paceSlider.value);
    const cfg = loadSettings();
    cfg.pace = pace;
    persist(cfg);
    syncPaceUi(pace);
    if (cfg.synthetic) startSynthTimer();
  });

  els.gear.addEventListener("click", openSettings);
  els.scrim.addEventListener("click", (e) => {
    if (e.target === els.scrim) closeSettings(true);
  });
  els.panel.addEventListener("submit", (e) => {
    e.preventDefault();
    closeSettings(true);
  });

  window.addEventListener("keydown", (e) => {
    if (!els.scrim.hidden) {
      if (e.key === "Escape") closeSettings(true);
      return;
    }
    const map = {
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
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  });

  els.pad.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-dir]");
    if (!btn) return;
    move(btn.getAttribute("data-dir"));
  });

  window.addEventListener("resize", () => {
    layoutLogs();
  });

  if (saved.synthetic) {
    setSynthetic(true);
  } else {
    els.synthToggle.setAttribute("aria-pressed", "false");
    els.synthLabel.textContent = "Synthetic off";
    refresh(true);
  }

  setInterval(() => {
    updateMarketBadge();
    const cfg = loadSettings();
    if (!cfg.synthetic && isNyseOpen()) refresh(false);
  }, 60_000);
})();
