(() => {
  const SYMBOL = "SNAP";
  const YAHOO =
    "https://query2.finance.yahoo.com/v8/finance/chart/SNAP?interval=5m&range=1d&includePrePost=false";

  const els = {
    company: document.getElementById("company"),
    price: document.getElementById("price"),
    change: document.getElementById("change"),
    asof: document.getElementById("asof"),
    open: document.getElementById("open"),
    high: document.getElementById("high"),
    low: document.getElementById("low"),
    prev: document.getElementById("prev"),
    volume: document.getElementById("volume"),
    range: document.getElementById("range"),
    note: document.getElementById("note"),
    refresh: document.getElementById("refresh"),
    spark: document.getElementById("spark"),
  };

  const ctx = els.spark.getContext("2d");

  function money(n) {
    if (n == null || Number.isNaN(n)) return "—";
    return (
      "$" +
      Number(n).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function compactVol(n) {
    if (n == null || Number.isNaN(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }

  async function fetchJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function loadYahoo() {
    const enc = encodeURIComponent(YAHOO);
    const attempts = [
      async () => fetchJson(YAHOO),
      async () => {
        const j = await fetchJson("https://api.allorigins.win/get?url=" + enc);
        if (!j.contents) throw new Error("empty proxy");
        return JSON.parse(j.contents);
      },
      async () => fetchJson("https://corsproxy.io/?" + enc),
      async () =>
        fetchJson(
          "https://api.codetabs.com/v1/proxy/?quest=" + encodeURIComponent(YAHOO)
        ),
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
    const quote = result.indicators?.quote?.[0] || {};
    const closes = (quote.close || []).filter((v) => v != null);
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    const prev = meta.chartPreviousClose ?? meta.previousClose;
    const change = price != null && prev != null ? price - prev : null;
    const changePct = change != null && prev ? (change / prev) * 100 : null;

    const highs = (quote.high || []).filter((v) => v != null);
    const lows = (quote.low || []).filter((v) => v != null);
    const vols = (quote.volume || []).filter((v) => v != null);
    const opens = (quote.open || []).filter((v) => v != null);

    return {
      symbol: meta.symbol || SYMBOL,
      exchange: meta.fullExchangeName || meta.exchangeName || "NYSE",
      currency: meta.currency || "USD",
      price,
      prev,
      change,
      changePct,
      open: meta.regularMarketOpen ?? opens[0],
      high: meta.regularMarketDayHigh ?? Math.max(...highs, price || 0),
      low: meta.regularMarketDayLow ?? Math.min(...lows, price || 0),
      volume: meta.regularMarketVolume ?? vols.reduce((a, b) => a + b, 0),
      time: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000)
        : new Date(),
      series: closes,
    };
  }

  function drawSpark(series, up) {
    const w = els.spark.width;
    const h = els.spark.height;
    ctx.clearRect(0, 0, w, h);

    if (!series || series.length < 2) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "20px IBM Plex Mono, monospace";
      ctx.fillText("No chart data", 24, h / 2);
      return;
    }

    const min = Math.min(...series);
    const max = Math.max(...series);
    const pad = 16;
    const span = Math.max(max - min, 0.01);

    ctx.beginPath();
    series.forEach((v, i) => {
      const x = pad + (i / (series.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const stroke = up ? "#3dd68c" : "#ff5c5c";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Fill under curve
    const lastX = pad + (w - pad * 2);
    const firstX = pad;
    ctx.lineTo(lastX, h - pad);
    ctx.lineTo(firstX, h - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad, 0, h);
    grad.addColorStop(0, up ? "rgba(61,214,140,0.28)" : "rgba(255,92,92,0.28)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function render(q) {
    els.company.textContent = "Snap Inc. · " + q.exchange;
    els.price.textContent = money(q.price);

    const up = (q.change ?? 0) > 0;
    const down = (q.change ?? 0) < 0;
    const sign = up ? "+" : "";
    els.change.textContent =
      q.change == null
        ? "—"
        : sign +
          money(q.change).replace("$", "") +
          "  (" +
          sign +
          q.changePct.toFixed(2) +
          "%)";
    els.change.className =
      "change " + (up ? "is-up" : down ? "is-down" : "is-flat");

    els.asof.textContent =
      "As of " +
      q.time.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });

    els.open.textContent = money(q.open);
    els.high.textContent = money(q.high);
    els.low.textContent = money(q.low);
    els.prev.textContent = money(q.prev);
    els.volume.textContent = compactVol(q.volume);
    els.range.textContent = money(q.low) + " – " + money(q.high);

    drawSpark(q.series, !down);
    els.note.textContent = "SNAP · delayed quote · auto-refresh 60s";
  }

  async function refresh() {
    els.refresh.disabled = true;
    els.change.textContent = "Fetching quote…";
    els.change.className = "change is-flat";
    try {
      const raw = await loadYahoo();
      render(parseQuote(raw));
    } catch (err) {
      els.change.textContent = "Could not load quote";
      els.change.className = "change is-down";
      els.note.textContent = String(err.message || err);
      console.error(err);
    } finally {
      els.refresh.disabled = false;
    }
  }

  els.refresh.addEventListener("click", refresh);
  refresh();
  setInterval(refresh, 60_000);
})();
