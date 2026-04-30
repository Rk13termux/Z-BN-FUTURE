'use strict';

var currentPair = 'BTCUSDT';
var currentTimeframe = '15m';
var chart = null;
var obChart = null;
var settings = { groqApiKey: '', favorites: ['SOLUSDT','BNBUSDT','ETHUSDT'], minConfidence: 50, minRR: 1.0 };
var TRADING_PAIRS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOTUSDT','AVAXUSDT','LINKUSDT','MATICUSDT','ATOMUSDT','LTCUSDT','UNIUSDT','ETCUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT'];
var updateInterval = null;
var analysisInterval = null;
var lastPrice = 0;

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM cargado');
  loadSettings();
  initEventListeners();
  initCharts();
});

function loadSettings() {
  var saved = localStorage.getItem('binanceBotSettings');
  if (saved) { try { settings = Object.assign({}, settings, JSON.parse(saved)); } catch(e) {} }
  if (settings.groqApiKey) document.getElementById('groq-key').value = settings.groqApiKey;
}

function saveSettings() {
  settings.groqApiKey = document.getElementById('groq-key').value || '';
  settings.minConfidence = parseInt(document.getElementById('min-confidence').value) || 50;
  settings.minRR = parseFloat(document.getElementById('min-rr').value) || 1.0;
  var favs = document.querySelectorAll('.fav-pair.active');
  settings.favorites = Array.from(favs).map(function(f) { return f.dataset.pair; });
  localStorage.setItem('binanceBotSettings', JSON.stringify(settings));
}

function initEventListeners() {
  document.querySelectorAll('.tf-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      stopAutoUpdate();
      document.querySelectorAll('.tf-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      currentTimeframe = btn.dataset.tf;
      loadChartData();
      startAutoUpdate();
    });
  });
  document.getElementById('analyze-btn').addEventListener('click', runAnalysis);
  document.getElementById('settings-btn').addEventListener('click', function() { document.getElementById('settings-modal').classList.remove('hidden'); });
  document.querySelectorAll('#settings-modal .close-btn, #cancel-settings').forEach(function(btn) {
    btn.addEventListener('click', function() { document.getElementById('settings-modal').classList.add('hidden'); });
  });
  document.getElementById('save-settings').addEventListener('click', function() { saveSettings(); document.getElementById('settings-modal').classList.add('hidden'); showToast('Configuración guardada','success'); });
  document.querySelectorAll('.fav-pair').forEach(function(btn) { btn.addEventListener('click', function() { btn.classList.toggle('active'); }); });
  
  var searchInput = document.getElementById('pair-search');
  searchInput.addEventListener('input', handlePairSearch);
  searchInput.addEventListener('focus', handlePairSearch);
  searchInput.addEventListener('blur', function() { setTimeout(function() { document.getElementById('search-results').classList.remove('active'); }, 200); });
  document.querySelectorAll('.modal').forEach(function(modal) { modal.addEventListener('click', function(e) { if(e.target === modal) modal.classList.add('hidden'); }); });
  
  document.getElementById('strategy-btn').addEventListener('click', function() {
    document.getElementById('strategy-panel').classList.remove('hidden');
    runFullAnalysis();
  });
  
  document.getElementById('close-strategy').addEventListener('click', function() {
    document.getElementById('strategy-panel').classList.add('hidden');
  });
  
  document.getElementById('run-strategy-btn').addEventListener('click', function() {
    runFullAnalysis();
  });
  
  document.getElementById('ai-validation-btn').addEventListener('click', function() {
    runAnalysisWithAI();
  });
}

function handlePairSearch(e) {
  var q = e.target.value.toUpperCase().trim();
  var results = document.getElementById('search-results');
  var searchInput = document.getElementById('pair-search');
  if (q.length < 1) { results.classList.remove('active'); return; }
  var matches = TRADING_PAIRS.filter(function(p) { return p.includes(q); }).slice(0,6);
  if (matches.length > 0) {
    results.innerHTML = matches.map(function(p) { return '<div class="search-result-item" data-pair="'+p+'">'+p+'</div>'; }).join('');
    results.querySelectorAll('.search-result-item').forEach(function(item) {
      item.addEventListener('click', function() { selectPair(item.dataset.pair); searchInput.value = ''; results.classList.remove('active'); });
    });
    results.classList.add('active');
  } else results.classList.remove('active');
}

function selectPair(pair) {
  stopAutoUpdate();
  currentPair = pair;
  document.getElementById('current-pair').textContent = pair;
  loadChartData();
  runAnalysis();
  startAutoUpdate();
}

function initCharts() {
  console.log('Inicializando Charts...');
  
  if (typeof Chart === 'undefined') {
    console.error('Chart.js NO definido');
    return;
  }
  
  var ctx = document.getElementById('price-chart').getContext('2d');
  
chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Precio',
        data: [],
        borderColor: '#089981',
        backgroundColor: 'rgba(8, 153, 129, 0.1)',
        pointRadius: 0,
        pointHoverRadius: 4,
        borderWidth: 2,
        tension: 0,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { 
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(20, 20, 20, 0.95)',
          titleColor: '#f0b90b',
          bodyColor: '#d1d4dc',
          borderColor: '#333',
          borderWidth: 1,
          cornerRadius: 4,
          titleFont: { size: 12, weight: 'bold' },
          bodyFont: { size: 11 },
          displayColors: false,
          callbacks: {
            title: function(context) { return context[0].label; },
            label: function(context) { return '$' + context.parsed.y.toFixed(2); }
          }
        }
      },
      scales: {
        x: { 
          grid: { display: false }, 
          ticks: { color: '#5f6365', maxTicksLimit: 15, font: { size: 10 } } 
        },
        y: { 
          position: 'right',
          grid: { color: 'rgba(255,255,255,0.03)' }, 
          ticks: { 
            color: '#888', 
            font: { size: 10 },
            callback: function(value) { return '$' + value.toFixed(2); }
          }
        }
      },
      animation: false,
      interaction: { mode: 'index', intersect: false }
    }
});
  
  console.log('Chart inicializado');
  
  setTimeout(function() {
    loadInitialData();
  }, 500);
}

function updateChart(klines) {
  if (!klines || klines.length === 0 || !chart) return;
  
  var labels = klines.map(function(k, i) {
    return i % 4 === 0 ? new Date(k.openTime).toLocaleTimeString() : '';
  });
  
  var prices = klines.map(function(k) { return parseFloat(k.close); });
  var isUp = parseFloat(klines[klines.length-1].close) >= parseFloat(klines[klines.length-1].open);
  
  chart.data.labels = labels;
  chart.data.datasets[0].data = prices;
  chart.data.datasets[0].borderColor = isUp ? '#089981' : '#f6464d';
  chart.data.datasets[0].backgroundColor = isUp ? 'rgba(8, 153, 129, 0.1)' : 'rgba(246, 70, 77, 0.1)';
  chart.update('none');
}

function updatePriceInfo(klines) {
  if (!klines || klines.length === 0) return;
  var last = klines[klines.length-1];
  var prev = klines.length>1 ? klines[klines.length-2] : klines[0];
  var price = last.close;
  var change = ((price - prev.close) / prev.close * 100).toFixed(2);
  
  var priceStr = price >= 1000 ? price.toFixed(2) : price >= 1 ? price.toFixed(4) : price.toFixed(6);
  document.getElementById('current-price').textContent = '$'+priceStr;
  lastPrice = price;
  
  var ch = document.getElementById('price-change');
  ch.textContent = (change>0?'+':'')+change+'%';
  ch.className = 'price-change '+(change>=0?'positive':'negative');
}

function updateOrderBookVisual(ob) {
  if (!ob || !ob.asks || !ob.bids) return;
  
  var asks = ob.asks.slice(0, 15);
  var bids = ob.bids.slice(0, 15);
  
  var midPrice = (parseFloat(asks[0][0]) + parseFloat(bids[0][0])) / 2;
  var maxVol = 0;
  
  var asksHtml = '';
  asks.reverse().forEach(function(a) {
    var price = parseFloat(a[0]);
    var qty = parseFloat(a[1]);
    var total = qty * price;
    if (total > maxVol) maxVol = total;
    var pct = 0;
    var spread = parseFloat(asks[0][0]) - parseFloat(bids[0][0]);
    asksHtml += '<div class="ob-row ask" style="--pct:' + (qty / 50 * 100) + '%">' +
      '<span class="price">' + price.toFixed(2) + '</span>' +
      '<span class="qty">' + qty.toFixed(2) + '</span>' +
      '<span class="total">' + total.toFixed(0) + '</span></div>';
  });
  
  var bidsHtml = '';
  bids.forEach(function(b) {
    var price = parseFloat(b[0]);
    var qty = parseFloat(b[1]);
    var total = qty * price;
    if (total > maxVol) maxVol = total;
    bidsHtml += '<div class="ob-row bid" style="--pct:' + (qty / 50 * 100) + '%">' +
      '<span class="price">' + price.toFixed(2) + '</span>' +
      '<span class="qty">' + qty.toFixed(2) + '</span>' +
      '<span class="total">' + total.toFixed(0) + '</span></div>';
  });
  
  var spread = (parseFloat(asks[0][0]) - parseFloat(bids[0][0])).toFixed(2);
  var spreadPct = ((spread / midPrice) * 100).toFixed(3);
  
  document.getElementById('asks-list').innerHTML = asksHtml;
  document.getElementById('bids-list').innerHTML = bidsHtml;
  
  var obDepth = document.getElementById('ob-depth');
  if (obDepth) {
    obDepth.innerHTML = '<div class="depth-info"><span class="label">Spread:</span> <span class="value">$' + spread + ' (' + spreadPct + '%)</span></div>' +
      '<div class="depth-info"><span class="label">Bid Vol:</span> <span class="value bid">' + bids.reduce(function(s, b) { return s + parseFloat(b[0]) * parseFloat(b[1]); }, 0).toFixed(0) + '</span></div>' +
      '<div class="depth-info"><span class="label">Ask Vol:</span> <span class="value ask">' + asks.reduce(function(s, a) { return s + parseFloat(a[0]) * parseFloat(a[1]); }, 0).toFixed(0) + '</span></div>';
  }
}

function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async function() {
    try {
      var klines = await window.electronAPI.binanceGetKlines(currentPair, currentTimeframe, 80);
      if (klines && klines.length > 0) {
        updateChart(klines);
        updatePriceInfo(klines);
      }
      
      var ob = await window.electronAPI.binanceGetOrderBook(currentPair, 20).catch(function(){return null;});
      if (ob) updateOrderBookVisual(ob);
      
    } catch(e) { console.error('Auto-update error:', e); }
  }, 500);
  
  if (analysisInterval) clearInterval(analysisInterval);
  analysisInterval = setInterval(async function() {
    try {
      var klines = await window.electronAPI.binanceGetKlines(currentPair,'15m',100);
      if (klines && klines.length > 0) {
        var ind = await window.electronAPI.calculateIndicators(klines);
        var signal = {
          direction: ind.bias.signal, 
          confidence: ind.bias.bullPct, 
          entry: ind.price, 
          stopLoss: (parseFloat(ind.price) * (ind.bias.signal==='LONG'?0.98:1.02)).toFixed(4), 
          takeProfit: (parseFloat(ind.price) * (ind.bias.signal==='LONG'?1.02:0.98)).toFixed(4), 
          riskReward:'1:1', 
          timeframe: currentTimeframe, 
          topReasons:['Sesgo: '+ind.bias.signal], 
          risks:['Volatilidad'], 
          sentiment: ind.bias.signal==='LONG'?'BULLISH':ind.bias.signal==='SHORT'?'BEARISH':'NEUTRAL', 
          summary:'Análisis automático.'
        };
        updateSignalCard(signal);
        updateIndicatorsPanel(ind);
      }
    } catch(e) { console.error('Auto-analysis error:', e); }
  }, 2000);
}

function stopAutoUpdate() {
  if (updateInterval) { clearInterval(updateInterval); updateInterval = null; }
  if (analysisInterval) { clearInterval(analysisInterval); analysisInterval = null; }
}

async function loadChartData() {
  showLoader(true);
  try {
    if (!window.electronAPI) {
      showToast('API de Electron no disponible','error');
      return;
    }
    var klines = await window.electronAPI.binanceGetKlines(currentPair, currentTimeframe, 80);
    if (klines && klines.length > 0) { updateChart(klines); updatePriceInfo(klines); }
    else { showToast('Sin datos disponibles para '+currentPair,'error'); }
  } catch(err) { 
    console.error('Error loadChartData:', err);
    showToast('Error: '+err.message,'error'); 
  }
  finally { showLoader(false); }
}

async function runAnalysis() {
  var btn = document.getElementById('analyze-btn');
  btn.disabled = true;
  showLoader(true);
  try {
    if (!window.electronAPI) {
      showToast('API no disponible','error');
      showLoader(false);
      btn.disabled = false;
      return;
    }
    
    var results = await Promise.all([
      window.electronAPI.binanceGetKlines(currentPair,'15m',100).catch(function(e){return null;}),
      window.electronAPI.binanceGetTicker(currentPair).catch(function(e){return null;}),
      window.electronAPI.binanceGetOrderBook(currentPair, 20).catch(function(e){return null;}),
      window.electronAPI.getSentiment().catch(function(e){return null;})
    ]);

    var k15m = results[0];
    if (!k15m || k15m.length === 0) {
      showToast('Sin datos de Binance','error');
      showLoader(false);
      btn.disabled = false;
      return;
    }

    var ind15m = await window.electronAPI.calculateIndicators(k15m);
    var ob = results[2];
    if (ob) updateOrderBookVisual(ob);
    
    var futuresData = results[1];
    if (futuresData) updateFuturesData(futuresData);
    
    var sentimentData = results[3];
    if (sentimentData) updateSentimentData(sentimentData);
    
    var signal = {
      direction: ind15m.bias.signal, 
      confidence: ind15m.bias.bullPct, 
      entry: ind15m.price, 
      stopLoss: (parseFloat(ind15m.price) * (ind15m.bias.signal==='LONG'?0.98:1.02)).toFixed(4), 
      takeProfit: (parseFloat(ind15m.price) * (ind15m.bias.signal==='LONG'?1.02:0.98)).toFixed(4), 
      riskReward:'1:1', 
      timeframe: currentTimeframe, 
      topReasons:['Sesgo: '+ind15m.bias.signal, ob ? 'Order Book OK' : ''], 
      risks:['Volatilidad'], 
      sentiment: ind15m.bias.signal==='LONG'?'BULLISH':ind15m.bias.signal==='SHORT'?'BEARISH':'NEUTRAL', 
      summary:'Análisis técnico + Order Book'
    };

    updateSignalCard(signal);
    updateIndicatorsPanel(ind15m);
    updateChart(k15m);
    updatePriceInfo(k15m);
  } catch(err) { 
    console.error('Error en análisis:', err);
    showToast('Error: ' + err.message, 'error'); 
  }
  finally { btn.disabled = false; showLoader(false); }
}

function updateSignalCard(s) {
  var dir = s.direction || 'NEUTRAL';
  var card = document.getElementById('signal-card');
  card.querySelector('.signal-direction').className = 'signal-direction '+dir;
  card.querySelector('.direction-label').textContent = dir;
  card.querySelector('.confidence-badge').textContent = s.confidence+'%';
  card.querySelector('.level-value.entry').textContent = '$'+s.entry;
  card.querySelector('.level-value.stop-loss').textContent = '$'+(s.stopLoss||'--');
  card.querySelector('.level-value.take-profit').textContent = '$'+(s.takeProfit||'--');
  card.querySelector('.level-value.rr').textContent = s.riskReward||'--';
  document.getElementById('reasons-list').innerHTML = (s.topReasons||[]).map(function(r){return r ? '<li>'+r+'</li>' : '';}).join('');
  document.getElementById('risks-list').innerHTML = (s.risks||[]).map(function(r){return '<li>'+r+'</li>';}).join('');
}

function updateFuturesData(data) {
  if (!data) return;
  document.getElementById('funding-rate').textContent = (data.fundingRate ? (data.fundingRate * 100).toFixed(4) + '%' : '--');
  document.getElementById('open-interest').textContent = data.volume ? parseInt(data.volume).toLocaleString() : '--';
  document.getElementById('mark-price').textContent = data.lastPrice ? '$' + parseFloat(data.lastPrice).toFixed(2) : '--';
}

async function loadFuturesData() {
  try {
    var funding = await window.electronAPI.binanceGetFundingRate(currentPair).catch(function(){return null;});
    var openInterest = await window.electronAPI.binanceGetOpenInterest(currentPair).catch(function(){return null;});
    var longShort = await window.electronAPI.binanceGetLongShortRatio(currentPair, '15m').catch(function(){return null;});
    var markPrice = await window.electronAPI.binanceGetMarkPrice(currentPair).catch(function(){return null;});
    var ticker = await window.electronAPI.binanceGetTicker(currentPair).catch(function(){return null;});
    
    // Panel lateral
    if (funding) document.getElementById('funding-rate').textContent = (funding.frequency * 100 || funding.fundingRate * 100).toFixed(4) + '%';
    if (openInterest) document.getElementById('open-interest').textContent = parseInt(openInterest.openInterest).toLocaleString();
    if (markPrice) document.getElementById('mark-price').textContent = '$' + parseFloat(markPrice.markPrice).toFixed(2);
    if (longShort && longShort.length > 0) {
      var ls = longShort[0];
      var ratio = (ls.longAccountRatio * 100).toFixed(1);
      document.getElementById('long-short').textContent = ratio + '% L / ' + (100 - ratio).toFixed(1) + '% S';
    }
    
    // Panel de indicadores - datos de Binance Futures
    if (funding) {
      var fundingPct = (funding.fundingRate * 100).toFixed(4);
      document.getElementById('funding-val').textContent = fundingPct + '%';
      document.getElementById('funding-val').className = 'ind-value ' + (fundingPct > 0 ? 'positive' : 'negative');
    }
    if (openInterest) {
      var oi = parseFloat(openInterest.openInterest);
      document.getElementById('oi-val').textContent = (oi / 1000000).toFixed(1) + 'M';
    }
    if (longShort && longShort.length > 0) {
      var lsVal = longShort[0].longAccountRatio * 100;
      document.getElementById('ls-val').textContent = lsVal.toFixed(0) + '% L';
      document.getElementById('ls-val').className = 'ind-value ' + (lsVal > 50 ? 'positive' : 'negative');
    }
    if (markPrice) {
      document.getElementById('mark-val').textContent = '$' + parseFloat(markPrice.markPrice).toFixed(2);
    }
    if (ticker) {
      var changePct = parseFloat(ticker.priceChangePercent);
      var changeEl = document.getElementById('change-val');
      changeEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';
      changeEl.className = 'ind-value ' + (changePct >= 0 ? 'positive' : 'negative');
      document.getElementById('hl-val').textContent = '$' + parseFloat(ticker.highPrice).toFixed(2) + ' / $' + parseFloat(ticker.lowPrice).toFixed(2);
    }
  } catch(e) { console.error('Error futures data:', e); }
}

function updateSentimentData(data) {
  if (!data) return;
  if (data.fearGreed && data.fearGreed.value !== null) {
    var fg = data.fearGreed;
    document.getElementById('fear-greed').textContent = fg.value + '/100';
    document.getElementById('fg-bar').style.width = fg.value + '%';
    document.getElementById('fg-bar').style.background = fg.value < 30 ? '#f6464d' : fg.value > 70 ? '#089981' : '#f0b90b';
  }
  if (data.btcDominance && data.btcDominance.btcDominance) {
    document.getElementById('btc-dom').textContent = data.btcDominance.btcDominance;
  }
}

function updateIndicatorsPanel(ind) {
  if (!ind) return;
  
  var rsiVal = parseFloat(ind.rsi) || 50;
  document.getElementById('rsi-value').textContent = ind.rsi || '--';
  document.getElementById('rsi-bar').style.width = rsiVal + '%';
  document.getElementById('rsi-status').textContent = ind.rsiStatus || '--';
  
  // RSI 25 y 50
  document.getElementById('rsi25-value').textContent = ind.rsi25 || '--';
  document.getElementById('rsi25-bar').style.width = (parseFloat(ind.rsi25) || 50) + '%';
  document.getElementById('rsi50-value').textContent = ind.rsi50 || '--';
  document.getElementById('rsi50-bar').style.width = (parseFloat(ind.rsi50) || 50) + '%';
  
  // Stochastic
  var stochK = parseFloat(ind.stoch ? ind.stoch.k : 0) || 0;
  var stochD = parseFloat(ind.stoch ? ind.stoch.d : 0) || 0;
  document.getElementById('stoch-k').textContent = ind.stoch && ind.stoch.k ? ind.stoch.k : '--';
  document.getElementById('stoch-k-bar').style.width = stochK + '%';
  document.getElementById('stoch-d').textContent = ind.stoch && ind.stoch.d ? ind.stoch.d : '--';
  document.getElementById('stoch-d-bar').style.width = stochD + '%';
  
  // CCI
  var cciVal = parseFloat(ind.cci) || 0;
  var cciEl = document.getElementById('cci-val');
  cciEl.textContent = ind.cci || '--';
  cciEl.className = 'ind-value ' + (cciVal > 100 ? 'negative' : cciVal < -100 ? 'positive' : 'neutral');
  
  // MFI
  document.getElementById('mfi-val').textContent = ind.mfi || '--';
  
  // Williams %R
  document.getElementById('williams-val').textContent = ind.williamsR || '--';
  
  // MACD
  if (ind.macd) { 
    var macdLine = document.getElementById('macd-line');
    var macdHist = document.getElementById('macd-hist');
    
    macdLine.textContent = ind.macd.macd ? parseFloat(ind.macd.macd).toFixed(4) : '--';
    document.getElementById('macd-signal').textContent = ind.macd.signal ? parseFloat(ind.macd.signal).toFixed(4) : '--';
    
    var histVal = parseFloat(ind.macd.histogram) || 0;
    macdHist.textContent = histVal.toFixed(4);
    macdHist.className = 'ind-value ' + (histVal >= 0 ? 'positive' : 'negative');
    
    document.getElementById('macd-hint').textContent = histVal >= 0 ? '↑ Alcista' : '↓ Bajista';
    document.getElementById('macd-hist-hint').textContent = histVal >= 0 ? 'Histograma positivo' : 'Histograma negativo';
  }
  
  // EMAs
  var ema9 = ind.emas && ind.emas.ema9 ? parseFloat(ind.emas.ema9) : null;
  var ema21 = ind.emas && ind.emas.ema21 ? parseFloat(ind.emas.ema21) : null;
  var ema50 = ind.emas && ind.emas.ema50 ? parseFloat(ind.emas.ema50) : null;
  var ema100 = ind.emas && ind.emas.ema100 ? parseFloat(ind.emas.ema100) : null;
  var ema200 = ind.emas && ind.emas.ema200 ? parseFloat(ind.emas.ema200) : null;
  
  document.getElementById('ema9').textContent = ema9 ? ema9.toFixed(2) : '--';
  document.getElementById('ema21').textContent = ema21 ? ema21.toFixed(2) : '--';
  document.getElementById('ema50').textContent = ema50 ? ema50.toFixed(2) : '--';
  document.getElementById('ema100').textContent = ema100 ? ema100.toFixed(2) : '--';
  document.getElementById('ema200').textContent = ema200 ? ema200.toFixed(2) : '--';
  
  document.getElementById('ema9-trend').textContent = ema9 && ema21 ? (ema9 > ema21 ? '↑' : '↓') : '-';
  document.getElementById('ema21-trend').textContent = ema21 && ema50 ? (ema21 > ema50 ? '↑' : '↓') : '-';
  document.getElementById('ema50-trend').textContent = ema50 && ema200 ? (ema50 > ema200 ? '↑' : '↓') : '-';
  document.getElementById('ema100-trend').textContent = ema100 && ema200 ? (ema100 > ema200 ? '↑' : '↓') : '-';
  document.getElementById('ema200-trend').textContent = ema200 ? '—' : '-';
  
  // SMAs
  document.getElementById('sma20').textContent = ind.sma20 ? parseFloat(ind.sma20).toFixed(2) : '--';
  document.getElementById('sma50').textContent = ind.sma50 ? parseFloat(ind.sma50).toFixed(2) : '--';
  document.getElementById('sma200').textContent = ind.sma200 ? parseFloat(ind.sma200).toFixed(2) : '--';
  
  // Bollinger Bands
  if (ind.bollingerBands) {
    document.getElementById('bb-upper').textContent = ind.bollingerBands.upper ? parseFloat(ind.bollingerBands.upper).toFixed(2) : '--';
    document.getElementById('bb-middle').textContent = ind.bollingerBands.middle ? parseFloat(ind.bollingerBands.middle).toFixed(2) : '--';
    document.getElementById('bb-lower').textContent = ind.bollingerBands.lower ? parseFloat(ind.bollingerBands.lower).toFixed(2) : '--';
    document.getElementById('bb-width').textContent = ind.bbWidth ? parseFloat(ind.bbWidth).toFixed(2) + '%' : '--';
    document.getElementById('bb-pos').textContent = 'Posición: ' + (ind.bbPosition ? parseFloat(ind.bbPosition).toFixed(0) + '%' : '--');
  }
  
  // ATR
  document.getElementById('atr-val').textContent = ind.atr ? parseFloat(ind.atr).toFixed(2) : '--';
  document.getElementById('atr50-val').textContent = ind.atr50 ? parseFloat(ind.atr50).toFixed(2) : '--';
  
  // ADX
  var adxVal = parseFloat(ind.adx) || 0;
  var adxEl = document.getElementById('adx-val');
  adxEl.textContent = ind.adx ? parseFloat(ind.adx).toFixed(2) : '--';
  adxEl.className = 'ind-value ' + (adxVal > 25 ? 'positive' : adxVal < 15 ? 'negative' : 'neutral');
  document.getElementById('adx-hint').textContent = adxVal > 25 ? 'Tendencia FUERTE' : adxVal < 15 ? 'Tendencia DÉBIL' : 'Tendencia MODERADA';
  
  // +DI y -DI
  document.getElementById('plus-di').textContent = ind.plusDI ? parseFloat(ind.plusDI).toFixed(2) : '--';
  document.getElementById('minus-di').textContent = ind.minusDI ? parseFloat(ind.minusDI).toFixed(2) : '--';
  
  // VWAP y Volumen
  document.getElementById('vwap-val').textContent = ind.vwap ? parseFloat(ind.vwap).toFixed(2) : '--';
  document.getElementById('volume-val').textContent = ind.volume ? parseFloat(ind.volume.lastVolume).toFixed(0) : '--';
  document.getElementById('volume-hint').textContent = 'Ratio: ' + (ind.volume ? parseFloat(ind.volume.volumeRatio).toFixed(1) : '--') + 'x';
  document.getElementById('volume-ratio').textContent = ind.volumeRatio ? parseFloat(ind.volumeRatio).toFixed(2) : '--';
  document.getElementById('obv-val').textContent = ind.obv ? parseFloat(ind.obv).toFixed(0) : '--';
  
  // Estructura del mercado
  document.getElementById('market-trend-value').textContent = ind.trend || '--';
  document.getElementById('market-trend-value').className = 'ind-value ' + (ind.trend === 'ALCISTA' ? 'positive' : ind.trend === 'BAJISTA' ? 'negative' : 'neutral');
  document.getElementById('trend-hint').textContent = 'Strength: ' + (ind.trendStrength || '--') + '%';
  
  document.getElementById('support-val').textContent = ind.supportResistance ? ind.supportResistance.support : '--';
  document.getElementById('support-dist').textContent = 'Dist: ' + (ind.supportResistance ? ind.supportResistance.distToSupport : '--');
  document.getElementById('resistance-val').textContent = ind.supportResistance ? ind.supportResistance.resistance : '--';
  document.getElementById('resistance-dist').textContent = 'Dist: ' + (ind.supportResistance ? ind.supportResistance.distToResistance : '--');
  
  document.getElementById('pivot-val').textContent = ind.pivot ? parseFloat(ind.pivot.pp).toFixed(2) : '--';
  document.getElementById('fib618-val').textContent = ind.fibonacci ? parseFloat(ind.fibonacci.level618).toFixed(2) : '--';
  document.getElementById('price-pos-val').textContent = ind.pricePosition || '--';
  
  // Patrones y señales
  document.getElementById('pattern-val').textContent = ind.candlePatterns ? ind.candlePatterns[0] : '--';
  document.getElementById('signal-val').textContent = ind.bias ? ind.bias.signal : '--';
  document.getElementById('signal-val').className = 'ind-value ' + (ind.bias && ind.bias.signal === 'LONG' ? 'positive' : ind.bias && ind.bias.signal === 'SHORT' ? 'negative' : 'neutral');
  document.getElementById('confluence-val').textContent = ind.confluence ? ind.confluence + '%' : '--';
  document.getElementById('momentum-val').textContent = ind.momentum ? parseFloat(ind.momentum).toFixed(2) : '--';
  document.getElementById('strength-val').textContent = ind.trendStrength ? ind.trendStrength + '%' : '--';
  
  // Chart indicators summary
  document.getElementById('ind-rsi').textContent = ind.rsi;
  document.getElementById('ind-macd').textContent = ind.macd && ind.macd.histogram > 0 ? '↑' : (ind.macd && ind.macd.histogram < 0 ? '↓' : '—');
  
  var emaText = '--';
  if (ind.emas && ind.emas.ema9 && ind.emas.ema21) {
    var trend = parseFloat(ind.emas.ema9) > parseFloat(ind.emas.ema21) ? '↑' : '↓';
    emaText = trend + ' ' + ind.emas.ema9.slice(0,5) + '/' + ind.emas.ema21.slice(0,5);
  }
  document.getElementById('ind-ema').textContent = emaText;
  
  var bbText = '--';
  if (ind.bollingerBands && ind.price) {
    var price = parseFloat(ind.price);
    if (price < parseFloat(ind.bollingerBands.lower)) bbText = '↑ Bajo';
    else if (price > parseFloat(ind.bollingerBands.upper)) bbText = '↓ Alto';
    else bbText = '— Medio';
  }
  document.getElementById('ind-bb').textContent = bbText;
}

function showLoader(show) { document.getElementById('chart-loader').classList.toggle('hidden',!show); }

function showToast(msg, type) {
  type = type || 'info';
  var old = document.querySelector('.toast');
  if (old) old.remove();
  var toast = document.createElement('div');
  toast.className = 'toast '+type;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function(){toast.remove();},3000);
}

async function loadInitialData() { 
  try { 
    showLoader(true);
    var klines = await window.electronAPI.binanceGetKlines(currentPair, currentTimeframe, 80);
    if (klines && klines.length > 0) {
      updateChart(klines);
      updatePriceInfo(klines);
      var ind = await window.electronAPI.calculateIndicators(klines);
      updateIndicatorsPanel(ind);
      var ob = await window.electronAPI.binanceGetOrderBook(currentPair, 20).catch(function(){return null;});
      if (ob) updateOrderBookVisual(ob);
      showToast('BTCUSDT - Mercado actualizado','success');
    }
    
    loadFuturesData();
    
    var sentiment = await window.electronAPI.getSentiment().catch(function(){return null;});
    if (sentiment) updateSentimentData(sentiment);
    
    showLoader(false);
    startAutoUpdate();
  } catch(err) { 
    console.error(err); 
    showLoader(false);
  } 
}

if (window.electronAPI) {
  window.electronAPI.onTriggerAnalysis(function(){runAnalysis();});
  window.electronAPI.onSelectPair(function(pair){selectPair(pair);});
  window.electronAPI.onOpenSettings(function(){document.getElementById('settings-modal').classList.remove('hidden');});
}

async function runFullAnalysis() {
  var days = parseInt(document.getElementById('volatility-days').value) || 30;
  showLoader(true);
  try {
    var volData = await window.electronAPI.analyzeVolatility(currentPair, days);
    var marketData = await window.electronAPI.analyzeMarketStructure(currentPair);
    var signal = await window.electronAPI.generateStrategySignal(currentPair);
    
    updateStrategyPanel(volData, marketData, signal);
    playAlertSound('analysis');
    showToast('Análisis completado','success');
  } catch(e) {
    console.error('Error en análisis:', e);
    showToast('Error: '+e.message,'error');
  }
  showLoader(false);
}

function updateStrategyPanel(volData, marketData, signal) {
  if (volData && volData.analysis) {
    document.getElementById('vol-avg').textContent = volData.analysis.avgVolatility + '%';
    document.getElementById('vol-today').textContent = volData.analysis.todayVolatility.toFixed(2) + '%';
    document.getElementById('vol-trend').textContent = volData.analysis.volatilityTrend;
    document.getElementById('vol-best-day').textContent = volData.analysis.bestDayToTrade;
    
    if (volData.pattern) {
      document.getElementById('vol-pattern-name').textContent = volData.pattern.pattern;
      document.getElementById('vol-pattern-desc').textContent = volData.pattern.description + ' - ' + volData.pattern.recommendation;
    }
    
    var volDaysList = document.getElementById('volatile-days-list');
    volDaysList.innerHTML = volData.analysis.mostVolatileDays.slice(0,5).map(function(d) {
      return '<li><span>'+d.date+'</span><span>'+d.volatility.toFixed(2)+'%</span></li>';
    }).join('');
    
    var peakHoursList = document.getElementById('peak-hours-list');
    peakHoursList.innerHTML = volData.analysis.peakHours.slice(0,3).map(function(h) {
      return '<li><span>'+h.hour+':00</span><span>'+h.avgVolume.toFixed(0)+'</span></li>';
    }).join('');
  }
  
  if (marketData) {
    var trendEl = document.getElementById('market-trend');
    trendEl.textContent = marketData.trend;
    trendEl.className = 'value trend-value ' + marketData.trend;
    document.getElementById('trend-confidence').textContent = marketData.trendStrength + '%';
    
    document.getElementById('current-support').textContent = marketData.currentSupport || '--';
    document.getElementById('support-distance').textContent = marketData.distanceToSupport !== 'N/A' ? marketData.distanceToSupport + '%' : '';
    document.getElementById('current-resistance').textContent = marketData.currentResistance || '--';
    document.getElementById('resistance-distance').textContent = marketData.distanceToResistance !== 'N/A' ? marketData.distanceToResistance + '%' : '';
    
    if (marketData.momentum) {
      document.getElementById('momentum-direction').textContent = marketData.momentum.direction;
      document.getElementById('momentum-strength').textContent = marketData.momentum.strength + '%';
    }
    document.getElementById('volume-ratio').textContent = marketData.volumeRatio + 'x';
  }
  
  if (signal) {
    var dirEl = document.getElementById('strategy-direction');
    dirEl.querySelector('.direction-label').textContent = signal.direction;
    dirEl.querySelector('.direction-label').className = 'direction-label ' + signal.direction;
    dirEl.querySelector('.confidence-badge').textContent = signal.confidence + '%';
    
    document.getElementById('strategy-entry').textContent = '$' + signal.entry;
    document.getElementById('strategy-sl').textContent = '$' + signal.stopLoss;
    document.getElementById('strategy-tp1').textContent = '$' + signal.takeProfit1;
    document.getElementById('strategy-tp2').textContent = '$' + signal.takeProfit2;
    document.getElementById('strategy-rr').textContent = signal.riskReward + ':1';
    document.getElementById('strategy-name').textContent = signal.strategy;
    document.getElementById('market-conditions-text').textContent = signal.marketConditions.trend + ' | ' + signal.marketConditions.volatility + ' | ' + signal.marketConditions.momentum;
    
    document.getElementById('strategy-reasons').innerHTML = signal.reasons.map(function(r) { return '<li>'+r+'</li>'; }).join('');
    document.getElementById('strategy-risks').innerHTML = signal.risks.map(function(r) { return '<li>'+r+'</li>'; }).join('');
    
    if (signal.direction !== 'WAIT') {
      playAlertSound('signal');
    }
  }
}

function playAlertSound(type) {
  try {
    var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    var oscillator = audioCtx.createOscillator();
    var gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type === 'signal') {
      oscillator.frequency.value = 880;
      gainNode.gain.value = 0.3;
    } else {
      oscillator.frequency.value = 440;
      gainNode.gain.value = 0.2;
    }
    
    oscillator.type = 'sine';
    oscillator.start();
    
    setTimeout(function() {
      oscillator.stop();
      audioCtx.close();
    }, type === 'signal' ? 500 : 200);
  } catch(e) {
    console.log('Audio no disponible');
  }
}

async function runAnalysisWithAI() {
  showToast('Validando con AI...', 'info');
  try {
    var marketData = await window.electronAPI.analyzeMarketStructure(currentPair);
    var ind = await window.electronAPI.calculateIndicators(await window.electronAPI.binanceGetKlines(currentPair,'15m',100));
    var signal = await window.electronAPI.generateStrategySignal(currentPair);
    
    var aiResult = await window.electronAPI.analyzeWithAI(currentPair, ind, {}, {}, [], settings.groqApiKey || 'demo');
    
    showToast('AI: ' + (aiResult.summary || 'Análisis completado'), 'success');
  } catch(e) {
    showToast('AI no disponible. Configura API Key en settings.', 'error');
  }
}

// ==================== BRAIN PANEL ====================
var brainRunning = false;
var brainInterval = null;

document.getElementById('brain-btn').addEventListener('click', function() {
  document.getElementById('brain-panel').classList.remove('hidden');
  refreshBrainData();
});

document.getElementById('close-brain').addEventListener('click', function() {
  document.getElementById('brain-panel').classList.add('hidden');
});

document.getElementById('toggle-brain').addEventListener('click', async function() {
  var btn = this;
  if (!brainRunning) {
    btn.textContent = 'DETENER CEREBRO';
    btn.style.background = 'var(--danger)';
    document.getElementById('brain-status-dot').classList.add('active');
    document.getElementById('brain-status-text').textContent = 'ACTIVO - APRENDIENDO';
    
    await window.electronAPI.brainStart(currentPair);
    brainRunning = true;
    
    brainInterval = setInterval(refreshBrainData, 5000);
    showToast('Cerebro iniciado - Aprendiendo del mercado', 'success');
  } else {
    btn.textContent = 'INICIAR CEREBRO';
    btn.style.background = '';
    document.getElementById('brain-status-dot').classList.remove('active');
    document.getElementById('brain-status-text').textContent = 'INACTIVO';
    
    await window.electronAPI.brainStop();
    brainRunning = false;
    
    if (brainInterval) clearInterval(brainInterval);
    showToast('Cerebro detenido', 'info');
  }
});

document.getElementById('refresh-brain').addEventListener('click', refreshBrainData);

document.getElementById('reset-brain').addEventListener('click', async function() {
  if (confirm('¿Reiniciar el cerebro? Esto borrará todo el aprendizaje.')) {
    await window.electronAPI.brainReset();
    showToast('Cerebro reiniciado', 'success');
    refreshBrainData();
  }
});

async function refreshBrainData() {
  try {
    var analysis = await window.electronAPI.brainGetAnalysis();
    var stats = await window.electronAPI.brainGetSimulatorStats();
    var trades = await window.electronAPI.brainGetSimulatorTrades(10);
    
    if (analysis && analysis.signal) {
      updateBrainSignal(analysis.signal);
      updateBrainIndicators(analysis.indicators, analysis.marketInfo);
    }
    
    if (stats) {
      document.getElementById('brain-balance').textContent = '$' + stats.balance;
      document.getElementById('brain-winrate').textContent = stats.winRate + '%';
      document.getElementById('brain-trades').textContent = stats.totalTrades;
      document.getElementById('brain-profit').textContent = (parseFloat(stats.totalProfit) >= 0 ? '+' : '') + '$' + stats.totalProfit;
      document.getElementById('brain-profit').style.color = parseFloat(stats.totalProfit) >= 0 ? 'var(--success)' : 'var(--danger)';
    }
    
    if (trades && trades.length > 0) {
      updateBrainTrades(trades);
    }
    
    var status = await window.electronAPI.brainGetStatus();
    if (status && status.simulator) {
      updateBrainPosition(status.simulator);
    }
  } catch (e) {
    console.error('Error refresh brain:', e);
  }
}

function updateBrainSignal(signal) {
  var dirEl = document.getElementById('brain-signal-direction');
  dirEl.querySelector('.direction-label').textContent = signal.direction;
  dirEl.querySelector('.direction-label').className = 'direction-label ' + signal.direction;
  dirEl.querySelector('.confidence-badge').textContent = signal.confidence + '%';
  
  document.getElementById('brain-entry').textContent = '$' + signal.entry;
  document.getElementById('brain-sl').textContent = '$' + signal.stopLoss;
  document.getElementById('brain-tp').textContent = '$' + signal.takeProfit;
  document.getElementById('brain-rr').textContent = signal.riskReward + ':1';
  document.getElementById('brain-strategy').textContent = signal.strategy || '--';
  
  document.getElementById('brain-reasons').innerHTML = (signal.reasons || []).map(function(r) { return '<li>' + r + '</li>'; }).join('');
}

function updateBrainIndicators(indicators, marketInfo) {
  document.getElementById('brain-rsi').textContent = indicators.rsi ? indicators.rsi.toFixed(2) : '--';
  document.getElementById('brain-macd').textContent = indicators.macdHistogram ? (indicators.macdHistogram > 0 ? '↑' : '↓') : '--';
  document.getElementById('brain-ema').textContent = indicators.ema9Above21 ? '↑' : '↓';
  document.getElementById('brain-adx').textContent = indicators.adx ? indicators.adx.toFixed(1) : '--';
  document.getElementById('brain-atr').textContent = indicators.atr14 ? indicators.atr14.toFixed(2) : '--';
  document.getElementById('brain-volume').textContent = indicators.volumeRatio ? indicators.volumeRatio.toFixed(1) + 'x' : '--';
  document.getElementById('brain-trend').textContent = indicators.trend || '--';
  document.getElementById('brain-ls').textContent = marketInfo.longShort ? (marketInfo.longShort * 100).toFixed(0) + '%' : '--';
  document.getElementById('brain-funding').textContent = marketInfo.funding ? (marketInfo.funding * 100).toFixed(3) + '%' : '--';
  document.getElementById('brain-oi').textContent = marketInfo.openInterest ? (marketInfo.openInterest / 1000000).toFixed(1) + 'M' : '--';
}

function updateBrainPosition(status) {
  var posEl = document.getElementById('brain-position');
  if (status.hasPosition && status.position) {
    var p = status.position;
    posEl.innerHTML = '<div class="position-active">' +
      '<span class="direction ' + p.direction + '">' + p.direction + '</span>' +
      '<span>Entrada: $' + p.entryPrice + '</span>' +
      '<span>SL: $' + p.stopLoss + '</span>' +
      '<span>TP: $' + p.takeProfit + '</span>' +
      '<span>Conf: ' + p.confidence + '%</span>' +
      '<span>' + p.timeOpen + 'min</span>' +
      '</div>';
  } else {
    posEl.innerHTML = '<span class="no-position">Sin posición abierta</span>';
  }
}

function updateBrainTrades(trades) {
  var listEl = document.getElementById('brain-trades-list');
  listEl.innerHTML = trades.map(function(t) {
    return '<div class="trade-item ' + t.outcome + '">' +
      '<span>' + t.direction + '</span>' +
      '<span>$' + t.entryPrice + '</span>' +
      '<span>' + t.outcome + '</span>' +
      '<span style="color: ' + (t.profit >= 0 ? 'var(--success)' : 'var(--danger)') + '">' +
      (t.profit >= 0 ? '+' : '') + '$' + t.profit.toFixed(2) +
      '</span>' +
      '</div>';
  }).join('');
}