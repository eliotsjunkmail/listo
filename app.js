(() => {
  const STORAGE_KEY = "holdings-v2";
  const DEFAULTS = {
    symbol: "SNAP",
    shares: 130000,
    assets: 3530000,
    target: 5000000,
    distribution: 0.04,
  };

  const els = {
    fill: document.getElementById("fill"),
    value: document.getElementById("value"),
    dist: document.getElementById("dist"),
    story: document.getElementById("story"),
    gear: document.getElementById("gear"),
    scrim: document.getElementById("scrim"),
    panel: document.getElementById("panel"),
    symbol: document.getElementById("symbol"),
    shares: document.getElementById("shares"),
    assets: document.getElementById("assets"),
    target: document.getElementById("target"),
    distribution: document.getElementById("distribution"),
  };

  /** @type {{symbol?:string, price:number|null, change:number|null, time:Date|null}|null} */
  let quote = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return {
        symbol: String(parsed.symbol || DEFAULTS.symbol).toUpperCase(),
        shares: Number(parsed.shares) > 0 ? Number(parsed.shares) : DEFAULTS.shares,
        assets: Number(parsed.assets) >= 0 ? Number(parsed.assets) : DEFAULTS.assets,
        target: Number(parsed.target) > 0 ? Number(parsed.target) : DEFAULTS.target,
        distribution: normalizeRate(parsed.distribution),
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function readForm() {
    return {
      symbol: (els.symbol.value || DEFAULTS.symbol).trim().toUpperCase() || DEFAULTS.symbol,
      shares: Math.max(0, Number(els.shares.value) || 0),
      assets: Math.max(0, Number(els.assets.value) || 0),
      target: Math.max(1, Number(els.target.value) || DEFAULTS.target),
      distribution: normalizeRate(els.distribution.value),
    };
  }

  function normalizeRate(raw) {
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return DEFAULTS.distribution;
    if (n > 1) n = n / 100;
    return n;
  }

  function persist(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function compactMoney(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);
    const sign = n < 0 ? "−" : "";
    if (abs >= 1e6) {
      const m = abs / 1e6;
      const digits = m >= 10 ? 1 : 2;
      return sign + "$" + m.toFixed(digits).replace(/\.0$/, "") + "M";
    }
    if (abs >= 1e3) {
      const k = abs / 1e3;
      const digits = k >= 100 ? 0 : 1;
      return sign + "$" + k.toFixed(digits).replace(/\.0$/, "") + "K";
    }
    return (
      sign +
      "$" +
      Math.round(abs).toLocaleString("en-US")
    );
  }

  function slimPrice(n) {
    if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
    const abs = Math.abs(n);
    const formatted = abs.toFixed(abs >= 10 ? 2 : 2).replace(/\.?0+$/, "");
    const body = formatted.includes(".") ? formatted : abs.toFixed(1);
    return (n < 0 ? "−" : "") + body;
  }

  function clock(date) {
    if (!date) return "";
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
  }

  function yahooUrl(symbol) {
    return (
      "https://query2.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(symbol) +
      "?interval=5m&range=1d&includePrePost=false"
    );
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
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
    throw lastErr || new Error("All quote sources failed");
  }

  function parseQuote(result) {
    const meta = result.meta;
    const quoteData = result.indicators?.quote?.[0] || {};
    const closes = (quoteData.close || []).filter((v) => v != null);
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const change = price != null && prev != null ? price - prev : null;
    return {
      symbol: meta.symbol,
      price,
      change,
      time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000) : new Date(),
    };
  }

  function render() {
    const { shares, assets, target, symbol, distribution } = loadSettings();
    const price = quote?.price ?? null;
    const stockValue = price != null ? price * shares : null;
    const value = stockValue != null ? stockValue + assets : null;
    const pct = value != null && target > 0 ? Math.min(100, (value / target) * 100) : 0;
    const neededFromStock = target - assets;
    const goalPrice = shares > 0 ? neededFromStock / shares : null;
    const yearly = value != null ? value * distribution : null;

    els.value.textContent = compactMoney(value);
    els.dist.textContent = yearly == null ? "" : compactMoney(yearly);

    if (!quote || quote.price == null) {
      els.story.textContent = "";
    } else {
      const direction =
        (quote.change ?? 0) > 0.004 ? "up" : (quote.change ?? 0) < -0.004 ? "down" : "unchanged";
      const moveWord = direction === "up" ? "up " : "down ";
      const move =
        quote.change == null
          ? ""
          : direction === "unchanged"
            ? "flat"
            : moveWord + "<strong>" + slimPrice(Math.abs(quote.change)) + "</strong>";
      const asOf = quote.time ? " as of <strong>" + clock(quote.time) + "</strong>" : "";
      const first =
        symbol +
        " is " +
        direction +
        ". Trading at <strong>" +
        slimPrice(quote.price) +
        "</strong>" +
        (move ? ", " + move + " for today" : "") +
        asOf +
        ".";
      let second;
      if (goalPrice == null) {
        second = "";
      } else if (neededFromStock <= 0) {
        second =
          " You've already reached your target of <strong>" +
          compactMoney(target).replace("$", "") +
          "</strong>.";
      } else {
        second =
          " When " +
          symbol +
          " gets to <strong>" +
          slimPrice(goalPrice) +
          "</strong> you will reach your target of <strong>" +
          compactMoney(target).replace("$", "") +
          "</strong>.";
      }
      els.story.innerHTML = first + second;
    }

    els.fill.style.height = pct + "%";
    els.fill.classList.toggle("is-done", pct >= 100);
    document.title = compactMoney(value);
  }

  async function refresh() {
    const initial = !quote;
    const started = Date.now();
    if (initial) document.body.classList.remove("is-ready");
    try {
      quote = parseQuote(await loadYahoo(loadSettings().symbol));
      if (quote.symbol) {
        const cfg = loadSettings();
        cfg.symbol = quote.symbol;
        persist(cfg);
        els.symbol.value = quote.symbol;
      }
      render();
    } catch (err) {
      els.story.textContent = "Could not load quote";
      console.error(err);
    } finally {
      const wait = initial ? Math.max(0, 700 - (Date.now() - started)) : 0;
      window.setTimeout(() => document.body.classList.add("is-ready"), wait);
    }
  }

  function openSettings() {
    const cfg = loadSettings();
    els.symbol.value = cfg.symbol;
    els.shares.value = String(cfg.shares);
    els.assets.value = String(cfg.assets);
    els.target.value = String(cfg.target);
    els.distribution.value = String(cfg.distribution);
    els.scrim.hidden = false;
    els.symbol.focus();
  }

  function closeSettings(save) {
    if (save) {
      const next = readForm();
      const prev = loadSettings();
      persist(next);
      if (next.symbol !== prev.symbol) refresh();
      else render();
    }
    els.scrim.hidden = true;
  }

  const saved = loadSettings();
  els.symbol.value = saved.symbol;
  els.shares.value = String(saved.shares);
  els.assets.value = String(saved.assets);
  els.target.value = String(saved.target);
  els.distribution.value = String(saved.distribution);
  render();

  els.gear.addEventListener("click", openSettings);
  els.scrim.addEventListener("click", (e) => {
    if (e.target === els.scrim) closeSettings(true);
  });
  els.panel.addEventListener("submit", (e) => {
    e.preventDefault();
    closeSettings(true);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.scrim.hidden) closeSettings(true);
  });

  refresh();
  setInterval(refresh, 60_000);
})();
