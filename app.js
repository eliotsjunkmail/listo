(() => {
  const STORAGE_KEY = "holdings-v1";
  const DEFAULTS = { symbol: "SNAP", shares: 130000, target: 2000000 };

  const els = {
    symbol: document.getElementById("symbol"),
    company: document.getElementById("company"),
    value: document.getElementById("value"),
    change: document.getElementById("change"),
    asof: document.getElementById("asof"),
    progressLabel: document.getElementById("progress-label"),
    progressPct: document.getElementById("progress-pct"),
    progressTarget: document.getElementById("progress-target"),
    remain: document.getElementById("remain"),
    bar: document.getElementById("bar"),
    barFill: document.getElementById("bar-fill"),
    shares: document.getElementById("shares"),
    target: document.getElementById("target"),
    note: document.getElementById("note"),
    refresh: document.getElementById("refresh"),
  };

  /** @type {{price:number|null, prev:number|null, change:number|null, changePct:number|null, exchange:string, time:Date, name:string}|null} */
  let quote = null;

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return {
        symbol: String(parsed.symbol || DEFAULTS.symbol).toUpperCase(),
        shares: Number(parsed.shares) > 0 ? Number(parsed.shares) : DEFAULTS.shares,
        target: Number(parsed.target) > 0 ? Number(parsed.target) : DEFAULTS.target,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function settings() {
    const symbol = (els.symbol.value || DEFAULTS.symbol).trim().toUpperCase() || DEFAULTS.symbol;
    const shares = Math.max(0, Number(els.shares.value) || 0);
    const target = Math.max(1, Number(els.target.value) || DEFAULTS.target);
    return { symbol, shares, target };
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings()));
  }

  function money(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return "—";
    return (
      "$" +
      Number(n).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
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
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const change = price != null && prev != null ? price - prev : null;
    const changePct = change != null && prev ? (change / prev) * 100 : null;

    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.longName || meta.symbol,
      exchange: meta.fullExchangeName || meta.exchangeName || "",
      price,
      prev,
      change,
      changePct,
      time: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000)
        : new Date(),
    };
  }

  function render() {
    const { shares, target, symbol } = settings();
    const price = quote?.price ?? null;
    const value = price != null ? price * shares : null;
    const pct = value != null && target > 0 ? Math.min(100, (value / target) * 100) : 0;
    const remaining = value != null ? Math.max(0, target - value) : null;

    els.value.textContent = money(value, 0);
    els.progressLabel.textContent = money(value, 0);
    els.progressTarget.textContent = money(target, 0);
    els.progressPct.textContent = pct.toFixed(1) + "%";
    els.barFill.style.width = pct + "%";
    els.barFill.classList.toggle("is-done", pct >= 100);
    els.bar.setAttribute("aria-valuemax", String(target));
    els.bar.setAttribute("aria-valuenow", String(Math.round(value || 0)));

    if (remaining == null) {
      els.remain.textContent = "Toward " + money(target, 0);
    } else if (remaining <= 0) {
      els.remain.textContent = "Target reached";
    } else {
      els.remain.textContent = money(remaining, 0) + " to go";
    }

    if (!quote) return;

    els.company.textContent = (quote.name || symbol) + (quote.exchange ? " · " + quote.exchange : "");

    const up = (quote.change ?? 0) > 0;
    const down = (quote.change ?? 0) < 0;
    const sign = up ? "+" : down ? "−" : "";
    const dayValue = quote.change != null ? quote.change * shares : null;
    els.change.textContent =
      quote.price == null
        ? "—"
        : money(quote.price) +
          " / share" +
          (quote.change == null
            ? ""
            : " · " +
              sign +
              money(Math.abs(dayValue), 0).replace("$", "") +
              " today (" +
              sign +
              Math.abs(quote.changePct).toFixed(2) +
              "%)");
    els.change.className = "change " + (up ? "is-up" : down ? "is-down" : "is-flat");

    els.asof.textContent =
      shares.toLocaleString("en-US") +
      " shares · as of " +
      quote.time.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });

    els.note.textContent = symbol + " · delayed quote · auto-refresh 60s";
  }

  async function refresh() {
    const { symbol } = settings();
    els.refresh.disabled = true;
    els.change.textContent = "Fetching " + symbol + "…";
    els.change.className = "change is-flat";
    try {
      quote = parseQuote(await loadYahoo(symbol));
      els.symbol.value = quote.symbol || symbol;
      persist();
      render();
    } catch (err) {
      els.change.textContent = "Could not load quote";
      els.change.className = "change is-down";
      els.note.textContent = String(err.message || err);
      console.error(err);
    } finally {
      els.refresh.disabled = false;
    }
  }

  const saved = loadSettings();
  els.symbol.value = saved.symbol;
  els.shares.value = String(saved.shares);
  els.target.value = String(saved.target);
  render();

  els.shares.addEventListener("input", () => {
    persist();
    render();
  });
  els.target.addEventListener("input", () => {
    persist();
    render();
  });
  els.symbol.addEventListener("change", () => {
    els.symbol.value = els.symbol.value.trim().toUpperCase();
    persist();
    refresh();
  });
  els.symbol.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      els.symbol.blur();
    }
  });

  els.refresh.addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 60_000);
})();
