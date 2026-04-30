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

function updateIndicatorsPanel(ind) {
  var rsiVal = parseFloat(ind.rsi) || 50;
  document.getElementById('rsi-value').textContent = ind.rsi;
  document.getElementById('rsi-bar').style.width = rsiVal+'%';
  document.getElementById('rsi-status').textContent = ind.rsiStatus || '--';
  
  if (ind.macd) { 
    document.getElementById('macd-line').textContent = ind.macd.macd || '--'; 
    document.getElementById('macd-signal').textContent = ind.macd.signal || '--'; 
  }
  
  document.getElementById('ema9').textContent = ind.emas && ind.emas.ema9 ? ind.emas.ema9.slice(0,6) : '--';
  document.getElementById('ema21').textContent = ind.emas && ind.emas.ema21 ? ind.emas.ema21.slice(0,6) : '--';
  document.getElementById('ema50').textContent = ind.emas && ind.emas.ema50 ? ind.emas.ema50.slice(0,6) : '--';
  
  document.getElementById('bb-upper').textContent = ind.bollingerBands && ind.bollingerBands.upper ? ind.bollingerBands.upper.slice(0,6) : '--';
  document.getElementById('bb-middle').textContent = ind.bollingerBands && ind.bollingerBands.middle ? ind.bollingerBands.middle.slice(0,6) : '--';
  document.getElementById('bb-lower').textContent = ind.bollingerBands && ind.bollingerBands.lower ? ind.bollingerBands.lower.slice(0,6) : '--';
  
  document.getElementById('stoch-k').textContent = ind.stoch && ind.stoch.k ? ind.stoch.k : '--';
  document.getElementById('stoch-d').textContent = ind.stoch && ind.stoch.d ? ind.stoch.d : '--';
  
  document.getElementById('atr-val').textContent = ind.atr || '--';
  document.getElementById('vwap-val').textContent = ind.vwap || '--';
  document.getElementById('cci-val').textContent = ind.cci || '--';
  
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