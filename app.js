(() => {
  const STORAGE_KEY = "holdings-v2";
  const DEFAULTS = {
    symbol: "SNAP",
    shares: 130000,
    assets: 3530000,
    target: 5000000,
  };

  const els = {
    fill: document.getElementById("fill"),
    value: document.getElementById("value"),
    pct: document.getElementById("pct"),
    need: document.getElementById("need"),
    gear: document.getElementById("gear"),
    scrim: document.getElementById("scrim"),
    panel: document.getElementById("panel"),
    symbol: document.getElementById("symbol"),
    shares: document.getElementById("shares"),
    assets: document.getElementById("assets"),
    target: document.getElementById("target"),
  };

  /** @type {{price:number|null}|null} */
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
    };
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
      const digits = k >= 100 ? 0 : k >= 10 ? 1 : 1;
      return sign + "$" + k.toFixed(digits).replace(/\.0$/, "") + "K";
    }
    return (
      sign +
      "$" +
      Math.round(abs).toLocaleString("en-US")
    );
  }

  function sharePrice(n) {
    if (n == null || Number.isNaN(n) || !Number.isFinite(n)) return "—";
    return (
      "$" +
      n.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
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
    return { symbol: meta.symbol, price };
  }

  function render() {
    const { shares, assets, target, symbol } = loadSettings();
    const price = quote?.price ?? null;
    const stockValue = price != null ? price * shares : null;
    const value = stockValue != null ? stockValue + assets : null;
    const pct = value != null && target > 0 ? Math.min(100, (value / target) * 100) : 0;
    const neededFromStock = target - assets;
    const goalPrice = shares > 0 ? neededFromStock / shares : null;

    els.value.textContent = compactMoney(value);
    els.pct.textContent = value == null ? "" : Math.round(pct) + "%";

    if (goalPrice == null) {
      els.need.textContent = "";
    } else if (neededFromStock <= 0) {
      els.need.textContent = "Target covered";
    } else {
      els.need.textContent = sharePrice(goalPrice) + " " + symbol;
    }

    els.fill.style.height = pct + "%";
    els.fill.classList.toggle("is-done", pct >= 100);
    document.title = compactMoney(value);
  }

  async function refresh() {
    const { symbol } = loadSettings();
    try {
      quote = parseQuote(await loadYahoo(symbol));
      if (quote.symbol) {
        const cfg = loadSettings();
        cfg.symbol = quote.symbol;
        persist(cfg);
        els.symbol.value = quote.symbol;
      }
      render();
    } catch (err) {
      els.pct.textContent = "quote failed";
      console.error(err);
    }
  }

  function openSettings() {
    const cfg = loadSettings();
    els.symbol.value = cfg.symbol;
    els.shares.value = String(cfg.shares);
    els.assets.value = String(cfg.assets);
    els.target.value = String(cfg.target);
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
