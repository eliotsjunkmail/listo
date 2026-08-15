(() => {
  const STORAGE_KEY = "frogger-stocks-v1";
  const BUY_DOLLARS = 1000;
  const DEFAULTS = {
    symbols: ["SNAP", "META", "GOOG"],
    synthetic: true,
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
    hudCash: document.getElementById("hud-cash"),
    hudBuys: document.getElementById("hud-buys"),
    toast: document.getElementById("toast"),
    pad: document.getElementById("pad"),
    logs: [0, 1, 2].map((i) => ({
      el: document.getElementById("log-" + i),
      sym: document.getElementById("sym-" + i),
      last: document.getElementById("last-" + i),
      chg: document.getElementById("chg-" + i),
    })),
  };

  /** @type {{symbol:string, open:number, last:number, bid:number, ask:number, change:number}[]} */
  let quotes = DEFAULTS.symbols.map((symbol) => seedQuote(symbol));

  /** lane: -1 bottom bank, 0..2 river, 3 top bank */
  let frogLane = -1;
  let frogX = 0.5;
  let riding = false;
  let busy = false;
  let toastTimer = 0;
  let synthTimer = 0;

  /** @type {Record<string, {shares:number, spent:number, buys:number}>} */
  let portfolio = {};

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
    return { symbols: [...DEFAULTS.symbols], synthetic: DEFAULTS.synthetic };
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
    return {
      symbol,
      open: base.open,
      last: base.last,
      bid: base.last - half,
      ask: base.last + half,
      change: 0,
    };
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

  function pxPerDollar(open, width) {
    const band = Math.max(open * 0.04, 0.5);
    return (width * 0.42) / band;
  }

  function layoutLogs() {
    const width = els.world.clientWidth || window.innerWidth;
    const center = width / 2;
    const minW = 150;

    quotes.forEach((q, i) => {
      const log = els.logs[i];
      if (!log?.el || !q || !Number.isFinite(q.last) || !Number.isFinite(q.open)) return;

      const scale = pxPerDollar(q.open, width);
      let leftEdge = center + (q.bid - q.open) * scale;
      let rightEdge = center + (q.ask - q.open) * scale;
      if (rightEdge - leftEdge < minW) {
        const mid = center + (q.last - q.open) * scale;
        leftEdge = mid - minW / 2;
        rightEdge = mid + minW / 2;
      }
      const w = rightEdge - leftEdge;
      let placedMid = (leftEdge + rightEdge) / 2;
      // Keep at least ~35% of the log on-screen so it stays jumpable.
      const margin = w * 0.35;
      placedMid = Math.min(width - margin, Math.max(margin, placedMid));

      log.el.style.width = w + "px";
      log.el.style.left = placedMid + "px";
      log.sym.textContent = q.symbol;
      log.last.textContent = slimPrice(q.last);
      log.chg.textContent = slimChange(q.change);
      log.el.classList.toggle("is-up", q.change > 0.004);
      log.el.classList.toggle("is-down", q.change < -0.004);
    });

    placeFrog();
  }

  function laneY(lane) {
    const riverTop = els.river.offsetTop;
    const riverH = els.river.clientHeight;
    const worldH = els.world.clientHeight;
    const frog = els.frog.offsetHeight || 44;

    if (lane < 0) {
      return worldH - frog - Math.max(18, worldH * 0.09 - 10);
    }
    if (lane > 2) {
      return Math.max(12, worldH * 0.09 - frog / 2);
    }
    const laneH = riverH / 3;
    return riverTop + lane * laneH + laneH / 2 - frog / 2;
  }

  function placeFrog() {
    const frog = els.frog;
    const worldW = els.world.clientWidth;
    const worldBox = els.world.getBoundingClientRect();
    const size = frog.offsetWidth || 44;

    if (riding && frogLane >= 0 && frogLane <= 2) {
      const logBox = els.logs[frogLane].el.getBoundingClientRect();
      const mid = logBox.left + logBox.width / 2 - worldBox.left;
      frog.style.left = mid + "px";
      frogX = mid / worldW;
    } else {
      const x = Math.min(worldW - size / 2 - 8, Math.max(size / 2 + 8, frogX * worldW));
      frog.style.left = x + "px";
    }

    frog.style.top = laneY(frogLane) + "px";
    frog.style.bottom = "auto";
  }

  function showToast(msg) {
    els.toast.hidden = false;
    els.toast.textContent = msg;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.hidden = true;
    }, 1600);
  }

  function updateHud() {
    const entries = Object.entries(portfolio);
    if (!entries.length) {
      els.hudCash.textContent = "Jump a log to buy $1,000";
      els.hudBuys.textContent = "";
      return;
    }
    const spent = entries.reduce((s, [, p]) => s + p.spent, 0);
    els.hudCash.textContent = "Bought $" + spent.toLocaleString("en-US") + " total";
    els.hudBuys.textContent = entries
      .map(([sym, p]) => sym + " " + p.shares.toFixed(p.shares >= 10 ? 1 : 2) + " sh")
      .join(" · ");
  }

  function buyOnLog(index) {
    const q = quotes[index];
    if (!q || !Number.isFinite(q.last) || q.last <= 0) return;
    const price = q.last;
    const shares = BUY_DOLLARS / price;
    const bag = portfolio[q.symbol] || { shares: 0, spent: 0, buys: 0 };
    bag.shares += shares;
    bag.spent += BUY_DOLLARS;
    bag.buys += 1;
    portfolio[q.symbol] = bag;
    updateHud();
    showToast("Bought $" + BUY_DOLLARS + " " + q.symbol + " @ " + slimPrice(price));
  }

  function frogOverlapsLog(index) {
    const frog = els.frog.getBoundingClientRect();
    const log = els.logs[index].el.getBoundingClientRect();
    const pad = 8;
    return frog.left + pad < log.right && frog.right - pad > log.left;
  }

  function splash() {
    showToast("Missed the log — splash!");
    frogLane = -1;
    riding = false;
    frogX = 0.5;
    placeFrog();
  }

  function move(dir) {
    if (busy || !els.scrim.hidden) return;
    busy = true;
    els.frog.classList.add("is-jumping");

    if (dir === "left") {
      frogX = Math.max(0.08, frogX - 0.08);
      riding = false;
    } else if (dir === "right") {
      frogX = Math.min(0.92, frogX + 0.08);
      riding = false;
    } else if (dir === "up") {
      const next = Math.min(3, frogLane + 1);
      if (next >= 0 && next <= 2) {
        frogLane = next;
        placeFrog();
        if (frogOverlapsLog(next)) {
          riding = true;
          buyOnLog(next);
        } else {
          riding = false;
          splash();
          busy = false;
          els.frog.classList.remove("is-jumping");
          return;
        }
      } else {
        frogLane = next;
        riding = false;
      }
    } else if (dir === "down") {
      const next = Math.max(-1, frogLane - 1);
      if (frogLane >= 0 && frogLane <= 2 && next >= 0 && next <= 2) {
        frogLane = next;
        placeFrog();
        if (frogOverlapsLog(next)) {
          riding = true;
          buyOnLog(next);
        } else {
          riding = false;
          splash();
          busy = false;
          els.frog.classList.remove("is-jumping");
          return;
        }
      } else {
        frogLane = next;
        riding = false;
      }
    }

    placeFrog();
    window.setTimeout(() => {
      els.frog.classList.remove("is-jumping");
      busy = false;
    }, 220);
  }

  function tickSynthetic() {
    quotes = quotes.map((q) => {
      const vol = Math.max(q.open * 0.0007, 0.008);
      const towardOpen = (q.open - q.last) * 0.04;
      const drift = (Math.random() - 0.5) * vol * 3 + towardOpen;
      let last = Math.max(0.5, q.last + drift);
      // Soft clamp day move so logs stay near the play field.
      const maxMove = q.open * 0.035;
      last = Math.min(q.open + maxMove, Math.max(q.open - maxMove, last));
      const half = Math.max(q.open * 0.00045, 0.01) * (0.8 + Math.random() * 0.6);
      return {
        ...q,
        last,
        bid: last - half,
        ask: last + half,
        change: last - q.open,
      };
    });
    layoutLogs();
  }

  function setSynthetic(on) {
    const cfg = loadSettings();
    cfg.synthetic = on;
    persist(cfg);
    els.synthToggle.setAttribute("aria-pressed", on ? "true" : "false");
    els.synthLabel.textContent = on ? "Synthetic on" : "Synthetic off";
    window.clearInterval(synthTimer);
    if (on) {
      quotes = cfg.symbols.map((s) => {
        const existing = quotes.find((q) => q.symbol === s);
        return existing && Number.isFinite(existing.last) ? existing : seedQuote(s);
      });
      // nudge so logs aren't all centered
      quotes = quotes.map((q, i) => {
        const nudge = (i - 1) * q.open * 0.008;
        const last = q.last + nudge;
        const half = Math.max(q.open * 0.0005, 0.02);
        return {
          ...q,
          last,
          bid: last - half,
          ask: last + half,
          change: last - q.open,
        };
      });
      layoutLogs();
      synthTimer = window.setInterval(tickSynthetic, 900);
    } else {
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
      };
      persist(next);
      portfolio = {};
      updateHud();
      quotes = next.symbols.map((s) => seedQuote(s));
      if (next.synthetic) setSynthetic(true);
      else refresh(true);
    }
    els.scrim.hidden = true;
  }

  // boot
  const saved = loadSettings();
  els.symA.value = saved.symbols[0];
  els.symB.value = saved.symbols[1];
  els.symC.value = saved.symbols[2];
  quotes = saved.symbols.map((s) => seedQuote(s));

  frogX = 0.5;
  placeFrog();
  updateHud();
  updateMarketBadge();
  layoutLogs();

  els.synthToggle.addEventListener("click", () => {
    const on = els.synthToggle.getAttribute("aria-pressed") !== "true";
    setSynthetic(on);
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

  // ride with log each frame when attached
  window.setInterval(() => {
    if (riding) placeFrog();
  }, 100);

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
