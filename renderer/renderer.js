'use strict';

var currentPair = 'BTCUSDT';
var currentTimeframe = '1m';
var realtimeActive = false;
var priceChart = null;
var cvdChart = null;
var klineData = [];
var cvdData = [];
var signalHistory = [];
var liquidationsList = [];

// Throttle control
var obLastRender = 0;
var OB_THROTTLE_MS = 500;
var obPendingData = null;
var obRowCache = { bids: [], asks: [] };

function debugLog(msg, type) {
  var dc = document.getElementById('debug-content');
  if (dc) {
    var e = document.createElement('div');
    e.className = 'debug-entry ' + (type || 'info');
    e.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    dc.appendChild(e);
    if (dc.children.length > 200) dc.removeChild(dc.firstChild);
    dc.scrollTop = dc.scrollHeight;
  }
  console.log(msg);
}

function formatPrice(p) {
  var n = parseFloat(p);
  if (isNaN(n)) return '--';
  if (n >= 1000) return n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatK(n) {
  n = parseFloat(n);
  if (isNaN(n)) return '--';
  if (n >= 1e9) return (n/1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

/* ═══════════════ INIT ═══════════════ */
document.addEventListener('DOMContentLoaded', function() {
  debugLog('App initialized', 'success');

  if (!window.electronAPI) {
    debugLog('ERROR: electronAPI not available', 'error');
    return;
  }

  debugLog('electronAPI OK - Starting real-time data...', 'success');
  initChart();
  initCVDChart();
  loadHistoricalChart(currentPair, currentTimeframe);
  initRealtimeData();
  setupEventListeners();
});

/* ═══════════════ CHART ═══════════════ */
function initChart() {
  var ctx = document.getElementById('price-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  priceChart = new Chart(ctx.getContext('2d'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Price',
          data: [],
          borderColor: '#4a9eff',
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          backgroundColor: function(context) {
            var chart = context.chart;
            var ctx2 = chart.ctx, area = chart.chartArea;
            if (!area) return 'rgba(74,158,255,0.05)';
            var g = ctx2.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, 'rgba(74,158,255,0.15)');
            g.addColorStop(1, 'rgba(74,158,255,0.0)');
            return g;
          },
          tension: 0.2
        },
        {
          label: 'EMA9',
          data: [],
          borderColor: 'rgba(0,212,170,0.5)',
          borderWidth: 1,
          pointRadius: 0,
          borderDash: [3,3],
          fill: false,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a1f2e',
        borderColor: '#2a3142',
        borderWidth: 1,
        titleFont: { family: 'JetBrains Mono', size: 11 },
        bodyFont: { family: 'JetBrains Mono', size: 11 },
        callbacks: { label: function(ctx) { return '$' + formatPrice(ctx.parsed.y); } }
      }},
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { color: '#3b4a6b', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 8, maxRotation: 0 }
        },
        y: {
          position: 'right',
          grid: { color: 'rgba(42,49,66,0.4)', drawBorder: false },
          ticks: { color: '#5a6478', font: { family: 'JetBrains Mono', size: 10 }, callback: function(v) { return formatPrice(v); } }
        }
      },
      interaction: { intersect: false, mode: 'index' }
    }
  });
}

async function loadHistoricalChart(symbol, timeframe) {
  if (!window.electronAPI) return;
  var loader = document.getElementById('chart-loader');
  if (loader) loader.classList.remove('hidden');
  debugLog('Loading historical klines: ' + symbol + ' ' + timeframe, 'info');

  try {
    var klines = await window.electronAPI.binanceGetKlines(symbol, timeframe, 120);
    if (!klines || klines.length === 0) {
      debugLog('No kline data received', 'error');
      if (loader) loader.classList.add('hidden');
      return;
    }

    debugLog('Loaded ' + klines.length + ' candles', 'success');
    klineData = klines;

    if (!priceChart) return;
    var labels = [];
    var prices = [];
    var ema9Data = [];
    var ema9Period = 9;
    var emaVal = null;

    klines.forEach(function(k, i) {
      var t = new Date(k.openTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      labels.push(t);
      prices.push(k.close);

      // Calculate simple EMA9 on the fly
      if (i === 0) {
        emaVal = k.close;
      } else {
        var mult = 2 / (ema9Period + 1);
        emaVal = (k.close - emaVal) * mult + emaVal;
      }
      ema9Data.push(i >= ema9Period - 1 ? emaVal : null);
    });

    priceChart.data.labels = labels;
    priceChart.data.datasets[0].data = prices;
    priceChart.data.datasets[1].data = ema9Data;
    priceChart.update();

    debugLog('Chart populated with ' + prices.length + ' points', 'success');
  } catch(e) {
    debugLog('Chart load error: ' + e.message, 'error');
  }
  if (loader) loader.classList.add('hidden');
}

function initCVDChart() {
  var ctx = document.getElementById('cvd-chart');
  if (!ctx || typeof Chart === 'undefined') return;
  cvdChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderWidth: 0,
        barPercentage: 0.9
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: {
          position: 'right',
          grid: { color: 'rgba(42,49,66,0.3)', drawBorder: false },
          ticks: { color: '#5a6478', font: { family: 'JetBrains Mono', size: 9 } }
        }
      }
    }
  });
}

var lastChartPrice = 0;
var lastEmaVal = null;

function updateChart(kline) {
  if (!priceChart || !kline) return;
  var d = priceChart.data;
  var price = parseFloat(kline.close || kline.price);
  if (!price || isNaN(price)) return;

  var t = new Date(kline.openTime || kline.timestamp || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});

  // EMA9 calculation
  var mult = 2 / 10;
  if (lastEmaVal === null) {
    var lastData = d.datasets[1].data;
    for (var i = lastData.length - 1; i >= 0; i--) {
      if (lastData[i] !== null) { lastEmaVal = lastData[i]; break; }
    }
    if (lastEmaVal === null) lastEmaVal = price;
  }
  lastEmaVal = (price - lastEmaVal) * mult + lastEmaVal;

  // If kline is closed, add new point; otherwise update last point
  if (kline.isClosed) {
    d.labels.push(t);
    d.datasets[0].data.push(price);
    d.datasets[1].data.push(lastEmaVal);
    if (d.labels.length > 150) {
      d.labels.shift();
      d.datasets[0].data.shift();
      d.datasets[1].data.shift();
    }
  } else if (d.datasets[0].data.length > 0) {
    // Update the last candle in real-time
    d.datasets[0].data[d.datasets[0].data.length - 1] = price;
    d.datasets[1].data[d.datasets[1].data.length - 1] = lastEmaVal;
  }

  lastChartPrice = price;
  priceChart.update('none'); // 'none' mode = skip animation for speed
}

function updateCVD(delta) {
  if (!cvdChart) return;
  var d = cvdChart.data;
  var v = parseFloat(delta) || 0;
  d.labels.push('');
  d.datasets[0].data.push(v);
  d.datasets[0].backgroundColor.push(v >= 0 ? 'rgba(0,212,170,0.6)' : 'rgba(255,71,87,0.6)');
  if (d.labels.length > 60) { d.labels.shift(); d.datasets[0].data.shift(); d.datasets[0].backgroundColor.shift(); }
  cvdChart.update();

  var hdr = document.getElementById('cvd-value-header');
  if (hdr) {
    hdr.textContent = v >= 0 ? '+' + v.toFixed(2) : v.toFixed(2);
    hdr.style.color = v >= 0 ? 'var(--green)' : 'var(--red)';
  }
}

/* ═══════════════ REALTIME ═══════════════ */
async function initRealtimeData() {
  try {
    var result = await window.electronAPI.realtimeStart(currentPair);
    debugLog('Realtime: ' + (result.success ? 'CONNECTED' : 'FAILED'), result.success ? 'success' : 'error');

    if (!result.success) return;
    realtimeActive = true;
    setConnectionStatus(true);

    // Main data listener
    window.electronAPI.onRealtimeData(function(data) {
      if (!data) return;
      handleRealtimeData(data);
    });

    // Market data (delta, liquidations, walls)
    window.electronAPI.onMarketDataUpdate(function(data) {
      if (!data) return;
      updateMarketData(data);
    });

    // Trading signals
    window.electronAPI.onTradingSignal(function(signal) {
      if (!signal) return;
      handleTradingSignal(signal);
    });

    // Indicators update
    window.electronAPI.onIndicatorsUpdate(function(ind) {
      if (!ind) return;
      updateIndicatorsUI(ind);
    });

    debugLog('All listeners configured', 'success');
  } catch(e) {
    debugLog('Realtime ERROR: ' + e.message, 'error');
  }
}

function setConnectionStatus(connected) {
  var dot = document.getElementById('ws-dot');
  var label = document.getElementById('ws-label');
  if (dot) dot.className = 'ws-dot' + (connected ? ' connected' : '');
  if (label) label.textContent = connected ? 'Connected' : 'Disconnected';
}

/* ═══════════════ DATA HANDLERS ═══════════════ */
function handleRealtimeData(data) {
  switch(data.type) {
    case 'ticker':
      updateTicker(data.data);
      break;
    case 'depth':
      updateOrderBook(data.data);
      break;
    case 'kline':
      updateChart(data.data);
      break;
    case 'aggressiveTrade':
      // Trade data for delta
      break;
    case 'liquidation':
      addLiquidation(data.data);
      break;
    case 'orderFlowStats':
      updateOrderFlowStats(data.data);
      break;
    case 'depthWalls':
      updateWalls(data.data);
      break;
    case 'funding':
      updateFunding(data.data);
      break;
    case 'openInterest':
      updateOI(data.data);
      break;
    case 'longShort':
      updateLS(data.data);
      break;
    case 'indicators':
      updateIndicatorsUI(data.data);
      break;
  }
}

/* ═══════════════ TICKER ═══════════════ */
function updateTicker(t) {
  if (!t) return;
  var priceEl = document.getElementById('current-price');
  var changeEl = document.getElementById('price-change');
  var highEl = document.getElementById('stat-high');
  var lowEl = document.getElementById('stat-low');
  var volEl = document.getElementById('stat-vol');

  if (priceEl) priceEl.textContent = '$' + formatPrice(t.price);
  if (changeEl) {
    var c = parseFloat(t.priceChangePercent) || 0;
    changeEl.textContent = (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
    changeEl.className = 'ticker-change ' + (c >= 0 ? 'positive' : 'negative');
  }
  if (highEl) highEl.textContent = formatPrice(t.high);
  if (lowEl) lowEl.textContent = formatPrice(t.low);
  if (volEl) volEl.textContent = formatK(t.quoteVolume);
}

/* ═══════════════ ORDER BOOK (Throttled + In-Place Updates) ═══════════════ */
function updateOrderBook(depth) {
  if (!depth || !depth.bids || !depth.asks) return;

  // Throttle: store latest data, only render at interval
  obPendingData = depth;
  var now = Date.now();
  if (now - obLastRender < OB_THROTTLE_MS) return;
  obLastRender = now;
  renderOrderBook(obPendingData);
  obPendingData = null;
}

function renderOrderBook(depth) {
  var bidsEl = document.getElementById('bids-list');
  var asksEl = document.getElementById('asks-list');
  if (!bidsEl || !asksEl) return;

  var maxBidVol = 0, maxAskVol = 0, sumBid = 0, sumAsk = 0;
  for (var i = 0; i < depth.bids.length; i++) {
    if (depth.bids[i][1] > maxBidVol) maxBidVol = depth.bids[i][1];
    sumBid += depth.bids[i][1];
  }
  for (var j = 0; j < depth.asks.length; j++) {
    if (depth.asks[j][1] > maxAskVol) maxAskVol = depth.asks[j][1];
    sumAsk += depth.asks[j][1];
  }
  var avgBidVol = sumBid / (depth.bids.length || 1);
  var avgAskVol = sumAsk / (depth.asks.length || 1);
  var wallThreshold = 2.5;

  // In-place update bids
  updateOBSide(bidsEl, depth.bids, maxBidVol, avgBidVol, wallThreshold, 'bid');

  // Asks displayed in reverse (highest at top)
  var asksReversed = depth.asks.slice().reverse();
  updateOBSide(asksEl, asksReversed, maxAskVol, avgAskVol, wallThreshold, 'ask');

  // Spread
  if (depth.asks[0] && depth.bids[0]) {
    var spread = ((depth.asks[0][0] - depth.bids[0][0]) / depth.asks[0][0] * 100);
    var spreadEl = document.getElementById('ob-spread');
    if (spreadEl) spreadEl.textContent = spread.toFixed(4) + '%';
  }

  // Depth ratio bar
  var total = sumBid + sumAsk;
  if (total > 0) {
    var buyPct = (sumBid / total * 100).toFixed(0);
    var sellPct = (sumAsk / total * 100).toFixed(0);
    var buyBar = document.getElementById('depth-bar-buy');
    var sellBar = document.getElementById('depth-bar-sell');
    var buyLabel = document.getElementById('depth-buy-pct');
    var sellLabel = document.getElementById('depth-sell-pct');
    if (buyBar) buyBar.style.width = buyPct + '%';
    if (sellBar) sellBar.style.width = sellPct + '%';
    if (buyLabel) buyLabel.textContent = buyPct + '% Buy';
    if (sellLabel) sellLabel.textContent = sellPct + '% Sell';
  }
}

function updateOBSide(container, levels, maxVol, avgVol, wallThreshold, side) {
  var rows = container.children;
  var cum = 0;

  for (var i = 0; i < levels.length; i++) {
    var price = levels[i][0];
    var qty = levels[i][1];
    cum += qty;
    var pct = maxVol > 0 ? (qty / maxVol * 100).toFixed(0) : '0';
    var isWall = qty >= avgVol * wallThreshold;

    if (i < rows.length) {
      // Update existing row in-place (no DOM rebuild = no flicker)
      var row = rows[i];
      var cells = row.children;
      cells[0].textContent = formatPrice(price);
      cells[1].textContent = qty.toFixed(3);
      cells[2].textContent = cum.toFixed(2);
      row.style.setProperty('--pct', pct + '%');
      row.className = 'ob-row ' + side + (isWall ? ' wall' : '');
    } else {
      // Create new row if needed
      var newRow = document.createElement('div');
      newRow.className = 'ob-row ' + side + (isWall ? ' wall' : '');
      newRow.style.setProperty('--pct', pct + '%');
      newRow.innerHTML = '<span class="price">' + formatPrice(price) + '</span><span class="qty">' + qty.toFixed(3) + '</span><span class="total">' + cum.toFixed(2) + '</span>';
      container.appendChild(newRow);
    }
  }

  // Remove extra rows if depth shrunk
  while (container.children.length > levels.length) {
    container.removeChild(container.lastChild);
  }
}

/* ═══════════════ ORDER FLOW STATS ═══════════════ */
function updateOrderFlowStats(stats) {
  if (!stats) return;
  var deltaEl = document.getElementById('of-delta-display');
  var bpEl = document.getElementById('of-buy-pressure-display');

  if (deltaEl) {
    var delta = parseFloat(stats.cumulativeDelta) || 0;
    deltaEl.textContent = delta >= 0 ? '+' + delta.toFixed(2) : delta.toFixed(2);
    deltaEl.className = 'of-metric-val ' + (delta >= 0 ? 'positive' : 'negative');
    updateCVD(delta);
  }
  if (bpEl) bpEl.textContent = (stats.buyPressure || 50) + '%';

  // Delta bar
  var bar = document.getElementById('of-delta-bar');
  if (bar) {
    var bp = parseFloat(stats.buyPressure) || 50;
    bar.style.width = bp + '%';
  }
}

function updateWalls(data) {
  if (!data) return;
  var buyWallsEl = document.getElementById('of-buy-walls-display');
  var sellWallsEl = document.getElementById('of-sell-walls-display');
  if (buyWallsEl) buyWallsEl.textContent = (data.buyWalls ? data.buyWalls.length : 0);
  if (sellWallsEl) sellWallsEl.textContent = (data.sellWalls ? data.sellWalls.length : 0);
}

function updateMarketData(data) {
  if (!data) return;
  if (data.cumulativeDelta !== undefined) {
    var deltaEl = document.getElementById('of-delta-display');
    if (deltaEl) {
      var d = parseFloat(data.cumulativeDelta) || 0;
      deltaEl.textContent = d >= 0 ? '+' + d.toFixed(2) : d.toFixed(2);
      deltaEl.className = 'of-metric-val ' + (d >= 0 ? 'positive' : 'negative');
    }
  }
  if (data.ticker) updateTicker(data.ticker);
  if (data.indicators) updateIndicatorsUI(data.indicators);
}

/* ═══════════════ LIQUIDATIONS ═══════════════ */
function addLiquidation(liq) {
  if (!liq) return;
  liquidationsList.unshift(liq);
  if (liquidationsList.length > 20) liquidationsList.pop();
  renderLiquidations();
}

function renderLiquidations() {
  var el = document.getElementById('liquidations-list');
  if (!el) return;
  if (liquidationsList.length === 0) {
    el.innerHTML = '<span class="liq-empty">Waiting for liquidations...</span>';
    return;
  }
  var html = '';
  liquidationsList.slice(0, 8).forEach(function(l) {
    var isLong = l.side === 'BUY';
    var cls = isLong ? 'long-liq' : 'short-liq';
    var label = isLong ? 'LONG LIQ' : 'SHORT LIQ';
    var usd = l.quantityUSD >= 1e6 ? (l.quantityUSD/1e6).toFixed(2)+'M' : (l.quantityUSD/1e3).toFixed(0)+'K';
    html += '<div class="liq-item ' + cls + '"><span>' + label + '</span><span>$' + usd + '</span><span>' + (l.symbol || '') + '</span></div>';
  });
  el.innerHTML = html;
}

/* ═══════════════ SIGNALS ═══════════════ */
function handleTradingSignal(signal) {
  debugLog('SIGNAL: ' + signal.direction + ' Score:' + (signal.score || signal.confidence), 'success');

  var activeEl = document.getElementById('active-signal');
  var noSignalEl = document.getElementById('no-signal');
  var statusEl = document.getElementById('signal-status');

  if (activeEl) activeEl.classList.remove('hidden');
  if (noSignalEl) noSignalEl.classList.add('hidden');
  if (statusEl) { statusEl.textContent = 'ACTIVE'; statusEl.style.background = 'var(--green-dim)'; statusEl.style.color = 'var(--green)'; }

  var dirCard = document.getElementById('signal-dir-card');
  var dirLabel = document.getElementById('signal-direction');
  var confEl = document.getElementById('signal-confidence');
  var typeEl = document.getElementById('signal-type-badge');
  var entryEl = document.getElementById('signal-entry');
  var slEl = document.getElementById('signal-sl');
  var tpEl = document.getElementById('signal-tp');
  var reasonEl = document.getElementById('signal-reason');
  var confListEl = document.getElementById('signal-confirmations');

  var dir = signal.direction || 'NEUTRAL';
  if (dirCard) dirCard.className = 'signal-direction-card ' + dir.toLowerCase();
  if (dirLabel) dirLabel.textContent = dir;
  if (confEl) confEl.textContent = (signal.score || signal.confidence || 0) + '%';
  if (typeEl) typeEl.textContent = signal.type || 'SIGNAL';
  if (entryEl) entryEl.textContent = '$' + formatPrice(signal.entryPrice || signal.price || 0);
  if (slEl) slEl.textContent = '$' + formatPrice(signal.stopLoss || 0);
  if (tpEl) tpEl.textContent = '$' + formatPrice(signal.takeProfit || 0);
  if (reasonEl) reasonEl.textContent = signal.reason || (signal.reasons ? signal.reasons[0] : '--');

  if (confListEl && signal.reasons) {
    confListEl.innerHTML = signal.reasons.map(function(r) {
      return '<span class="conf-tag">✓ ' + r + '</span>';
    }).join('');
  }

  // Add to history
  signalHistory.unshift({
    direction: dir,
    score: signal.score || signal.confidence || 0,
    type: signal.type || '',
    time: new Date().toLocaleTimeString()
  });
  if (signalHistory.length > 20) signalHistory.pop();
  renderSignalHistory();
}

function renderSignalHistory() {
  var el = document.getElementById('signal-history-list');
  if (!el) return;
  if (signalHistory.length === 0) {
    el.innerHTML = '<span class="history-empty">No signals yet</span>';
    return;
  }
  var html = '';
  signalHistory.slice(0, 10).forEach(function(s) {
    html += '<div class="history-item">' +
      '<span class="history-dir ' + s.direction.toLowerCase() + '">' + s.direction + '</span>' +
      '<span class="history-score">' + s.score + '%</span>' +
      '<span class="history-time">' + s.time + '</span>' +
    '</div>';
  });
  el.innerHTML = html;
}

/* ═══════════════ INDICATORS ═══════════════ */
function updateIndicatorsUI(ind) {
  if (!ind) return;

  setVal('rsi-value', ind.rsi, true);
  setVal('stoch-k', ind.stoch ? ind.stoch.k?.toFixed(1) : null);
  setVal('stoch-d', ind.stoch ? ind.stoch.d?.toFixed(1) : null);
  setVal('cci-val', ind.cci);
  setVal('mfi-val', ind.mfi);
  setVal('williams-val', ind.williamsR);
  setVal('ema9', ind.emas?.ema9);
  setVal('ema21', ind.emas?.ema21);
  setVal('ema50', ind.emas?.ema50);
  setVal('ema200', ind.emas?.ema200);
  setVal('adx-val', ind.adx);
  setVal('vwap-val', ind.vwap);
  setVal('macd-line', ind.macd?.macd ? parseFloat(ind.macd.macd).toFixed(2) : null);
  setVal('macd-signal', ind.macd?.signal ? parseFloat(ind.macd.signal).toFixed(2) : null);
  setVal('macd-hist', ind.macd?.histogram ? parseFloat(ind.macd.histogram).toFixed(2) : null, true);
  setVal('atr-val', ind.atr);
  setVal('bb-width', ind.bbWidth ? ind.bbWidth + '%' : null);
  setVal('obv-val', ind.obv ? formatK(ind.obv) : null);

  // RSI bar
  var rsiBar = document.getElementById('rsi-bar');
  if (rsiBar && ind.rsi) rsiBar.style.width = ind.rsi + '%';

  // Indicator chips
  setVal('ind-rsi', ind.rsi);
  setVal('ind-macd', ind.macd?.histogram ? parseFloat(ind.macd.histogram).toFixed(2) : '--');
  setVal('ind-ema', ind.emas?.ema9 && ind.emas?.ema21 ? (parseFloat(ind.emas.ema9) > parseFloat(ind.emas.ema21) ? '▲ Bull' : '▼ Bear') : '--');
  setVal('ind-atr', ind.atr);
  setVal('ind-vol', ind.volume?.volumeRatio ? ind.volume.volumeRatio + 'x' : '--');
}

function setVal(id, val, colorize) {
  var el = document.getElementById(id);
  if (!el) return;
  if (val === null || val === undefined) { el.textContent = '--'; return; }
  el.textContent = val;
  if (colorize) {
    var n = parseFloat(val);
    if (!isNaN(n)) {
      el.className = el.className.replace(/positive|negative/g, '').trim();
      if (n > 0) el.classList.add('positive');
      else if (n < 0) el.classList.add('negative');
    }
  }
}

/* ═══════════════ FUTURES DATA ═══════════════ */
function updateFunding(data) {
  if (!data) return;
  setVal('funding-rate', data.fundingRate || '--');
}

function updateOI(data) {
  if (!data) return;
  setVal('open-interest', data.openInterest ? formatK(data.openInterest) : '--');
}

function updateLS(data) {
  if (!data) return;
  setVal('long-short', data.longShortRatio ? parseFloat(data.longShortRatio).toFixed(3) : '--');
}

/* ═══════════════ EVENT LISTENERS ═══════════════ */
function setupEventListeners() {
  // Pair selector
  document.querySelectorAll('.pair-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.pair-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentPair = btn.dataset.pair;
      document.getElementById('current-pair').textContent = currentPair;
      if (window.electronAPI) window.electronAPI.realtimeChangeSymbol(currentPair);
      debugLog('Changed pair to ' + currentPair, 'info');
      // Reset chart for new pair
      if (priceChart) {
        priceChart.data.labels = [];
        priceChart.data.datasets[0].data = [];
        priceChart.data.datasets[1].data = [];
        lastEmaVal = null;
        priceChart.update();
      }
      // Clear order book
      var bidsEl = document.getElementById('bids-list');
      var asksEl = document.getElementById('asks-list');
      if (bidsEl) bidsEl.innerHTML = '';
      if (asksEl) asksEl.innerHTML = '';
      // Reload chart
      loadHistoricalChart(currentPair, currentTimeframe);
    });
  });

  // Timeframe buttons — reload chart on change
  document.querySelectorAll('.tf-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.tf-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentTimeframe = btn.dataset.tf;
      debugLog('Timeframe changed: ' + currentTimeframe, 'info');
      // Reset chart and load new timeframe data
      if (priceChart) {
        priceChart.data.labels = [];
        priceChart.data.datasets[0].data = [];
        priceChart.data.datasets[1].data = [];
        lastEmaVal = null;
        priceChart.update();
      }
      loadHistoricalChart(currentPair, currentTimeframe);
    });
  });

  // Debug toggle
  var toggleDebug = document.getElementById('btn-toggle-debug');
  if (toggleDebug) toggleDebug.addEventListener('click', function() { document.getElementById('debug-panel').classList.toggle('hidden'); });

  var closeDebug = document.getElementById('btn-close-debug');
  if (closeDebug) closeDebug.addEventListener('click', function() { document.getElementById('debug-panel').classList.add('hidden'); });

  var clearDebug = document.getElementById('btn-clear-debug');
  if (clearDebug) clearDebug.addEventListener('click', function() { document.getElementById('debug-content').innerHTML = '<div class="debug-entry info">Cleared</div>'; });

  // Settings
  var settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) settingsBtn.addEventListener('click', function() { document.getElementById('settings-modal').classList.remove('hidden'); });

  var closeSettings = document.getElementById('close-settings');
  if (closeSettings) closeSettings.addEventListener('click', function() { document.getElementById('settings-modal').classList.add('hidden'); });

  var cancelSettings = document.getElementById('cancel-settings');
  if (cancelSettings) cancelSettings.addEventListener('click', function() { document.getElementById('settings-modal').classList.add('hidden'); });

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (e.altKey && e.key === 'd') {
      e.preventDefault();
      document.getElementById('debug-panel').classList.toggle('hidden');
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'R') {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.clearCache) {
        window.electronAPI.clearCache().then(function() { location.reload(); });
      }
    }
  });
}

console.log('[APP] Renderer.js loaded');