'use strict';

var currentPair = 'BTCUSDT';
var currentTimeframe = '1m';
var chart = null;
var obChart = null;
var settings = { groqApiKey: '', favorites: ['SOLUSDT','BNBUSDT','ETHUSDT'], minConfidence: 50, minRR: 1.0 };
var TRADING_PAIRS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOTUSDT','AVAXUSDT','LINKUSDT','MATICUSDT','ATOMUSDT','LTCUSDT','UNIUSDT','ETCUSDT','NEARUSDT','APTUSDT','ARBUSDT','OPUSDT'];
var updateInterval = null;
var analysisInterval = null;
var lastPrice = 0;
var realtimeActive = false;
var signalHistory = [];
var currentActiveSignal = null;
var isAnalyzingAI = false;
var AI_MIN_CONFIDENCE = 70;

document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM cargado');
  loadSettings();
  initEventListeners();
  initCharts();
  initRealtimeData();
  initSignalActions();
});

function initSignalActions() {
  document.getElementById('btn-confirm-signal').addEventListener('click', function() {
    showToast('Signal confirmada', 'success');
    playAlertSound('confirm');
  });
  
  document.getElementById('btn-discard-signal').addEventListener('click', function() {
    hideActiveSignal();
    showToast('Signal descartada', 'info');
  });
  
  document.getElementById('btn-open-strategy').addEventListener('click', function() {
    document.getElementById('strategy-panel').classList.remove('hidden');
    runFullAnalysis();
  });
}

async function initRealtimeData() {
  try {
    console.log('[RENDERER] Iniciando datos en tiempo real...');
    var result = await window.electronAPI.realtimeStart(currentPair);
    if (result.success) {
      realtimeActive = true;
      console.log('[RENDERER] ✓ Datos en tiempo real activados');
      
      window.electronAPI.onRealtimeData(function(data) {
        handleRealtimeData(data);
      });
      
      window.electronAPI.onTradingSignal(function(signal) {
        handleTradingSignal(signal);
      });
    } else {
      console.error('[RENDERER] Error:', result.error);
    }
  } catch(e) {
    console.error('[RENDERER] Error realtime:', e.message);
  }
}

function handleRealtimeData(data) {
  if (data.type === 'ticker' && data.data) {
    var t = data.data;
    document.getElementById('current-price').textContent = '$' + t.price.toFixed(2);
    document.getElementById('price-change').textContent = (t.priceChangePercent >= 0 ? '+' : '') + t.priceChangePercent.toFixed(2) + '%';
    document.getElementById('price-change').className = 'price-change ' + (t.priceChangePercent >= 0 ? 'positive' : 'negative');
  }
  
  if (data.type === 'depth' && data.data) {
    updateOrderBookVisual(data.data);
  }
  
  if (data.type === 'indicators' && data.data) {
    updateIndicatorsPanel(data.data);
  }
}

async function handleTradingSignal(signal) {
  console.log('[RENDERER] Señal recibida:', signal.type, signal.direction, signal.confidence + '%');
  
  playAlertSound('signal');
  
  currentActiveSignal = signal;
  
  var activeSignalEl = document.getElementById('active-signal');
  var noSignalEl = document.getElementById('no-signal');
  var confidenceEl = document.getElementById('signal-confidence');
  var typeEl = document.getElementById('signal-type');
  var dirEl = document.getElementById('signal-direction');
  var priceEl = document.getElementById('signal-price');
  var changeEl = document.getElementById('signal-change');
  var reasonEl = document.getElementById('signal-reason');
  var aiStatusEl = document.getElementById('ai-status');
  var aiValidationEl = document.getElementById('ai-validation');
  var aiResultEl = document.getElementById('ai-result');
  
  activeSignalEl.classList.remove('hidden');
  noSignalEl.style.display = 'none';
  
  var score = signal.compositeScore || signal.confidence;
  var quality = signal.quality || (score >= 80 ? 'EXCELENT' : score >= 65 ? 'GOOD' : score >= 50 ? 'FAIR' : 'WEAK');
  
  confidenceEl.textContent = score + '%';
  typeEl.textContent = signal.type;
  dirEl.textContent = signal.direction;
  dirEl.className = 'signal-direction-badge ' + signal.direction;
  
  var alertEl = activeSignalEl.querySelector('.signal-alert');
  alertEl.className = 'signal-alert ' + signal.direction.toLowerCase();
  
  if (signal.data && signal.data.price) {
    priceEl.textContent = '$' + signal.data.price.toFixed(2);
    changeEl.textContent = (signal.data.priceChangePercent >= 0 ? '+' : '') + (signal.data.priceChangePercent || 0).toFixed(2) + '%';
    changeEl.style.color = signal.data.priceChangePercent >= 0 ? '#089981' : '#f6464d';
  }
  
  var marketCtx = signal.marketContext ? ` [${signal.marketContext.type} - ${signal.marketContext.trend}]` : '';
  var confirmations = signal.confirmations && signal.confirmations.length > 0 ? 
    ' ✓ ' + signal.confirmations.join(', ') : ' ⚠ sin confirmaciones';
  
  reasonEl.textContent = signal.reason + marketCtx + confirmations;
  
  aiValidationEl.style.display = 'block';
  aiResultEl.classList.remove('show');
  aiStatusEl.className = 'ai-status analyzing';
  document.getElementById('ai-status-text').textContent = 'Calidad: ' + quality + ' | Score: ' + score + '%';
  document.getElementById('ai-spinner').style.display = 'inline';
  
  if (score >= AI_MIN_CONFIDENCE) {
    aiStatusEl.textContent = 'AI: ANALIZANDO';
    await validateWithAI(signal);
  } else {
    aiStatusEl.textContent = 'AI: CONFIANZA BAJA';
    document.getElementById('ai-spinner').style.display = 'none';
    addToHistory(signal, 'pending', 'Confianza < 70%');
  }
  
  addToHistory(signal, 'pending', null);
  
  showToast('⚡ Señal: ' + signal.direction + ' (' + signal.confidence + '%)', 
    signal.direction === 'LONG' ? 'success' : signal.direction === 'SHORT' ? 'error' : 'info');
}

async function validateWithAI(signal) {
  try {
    var aiStatusEl = document.getElementById('ai-status');
    var aiResultEl = document.getElementById('ai-result');
    var aiVerdictEl = document.getElementById('ai-verdict');
    var aiAnalysisEl = document.getElementById('ai-analysis');
    
    aiStatusEl.className = 'ai-status active';
    document.getElementById('ai-status-text').textContent = 'Validando con AI...';
    
    var marketData = await window.electronAPI.analyzeMarketStructure(currentPair);
    var klines = await window.electronAPI.binanceGetKlines(currentPair, '1m', 100);
    var ind = await window.electronAPI.calculateIndicators(klines);
    
    var aiResult = await window.electronAPI.analyzeWithAI(
      currentPair, 
      ind, 
      { price: signal.data?.price, direction: signal.direction },
      {},
      [],
      settings.groqApiKey || 'demo'
    );
    
    document.getElementById('ai-spinner').style.display = 'none';
    aiResultEl.classList.add('show');
    
    var isConfirmed = aiResult && aiResult.recommendation && 
                      (aiResult.recommendation.toLowerCase().includes('long') || 
                       aiResult.recommendation.toLowerCase().includes('buy') ||
                       aiResult.recommendation.toLowerCase().includes('confirm'));
    
    if (isConfirmed) {
      aiResultEl.className = 'ai-result show confirmed';
      aiVerdictEl.textContent = '✅ CONFIRMADO POR AI';
      aiAnalysisEl.textContent = aiResult.summary || aiResult.analysis || 'La señal tiene confluencia positiva de indicadores';
      aiStatusEl.className = 'ai-status confirmed';
      aiStatusEl.textContent = 'AI: CONFIRMADO';
      
      updateHistoryItem(signal.type, 'confirmed', 'AI Confirmado');
      
      playAlertSound('confirm');
      
      document.getElementById('strategy-panel').classList.remove('hidden');
      runFullAnalysis();
      
    } else {
      aiResultEl.className = 'ai-result show rejected';
      aiVerdictEl.textContent = '❌ DESCARTADO POR AI';
      aiAnalysisEl.textContent = aiResult?.summary || 'La señal no tiene suficientes confluencias';
      aiStatusEl.className = 'ai-status rejected';
      aiStatusEl.textContent = 'AI: DESCARTADO';
      
      updateHistoryItem(signal.type, 'rejected', 'AI Descartó');
    }
    
  } catch(e) {
    console.error('[RENDERER] Error AI:', e.message);
    document.getElementById('ai-status-text').textContent = 'AI: ERROR - Usando señal';
    document.getElementById('ai-spinner').style.display = 'none';
  }
}

function addToHistory(signal, aiStatus, aiNote) {
  var historyItem = {
    type: signal.type,
    direction: signal.direction,
    confidence: signal.confidence,
    time: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    aiStatus: aiStatus || 'pending',
    aiNote: aiNote
  };
  
  signalHistory.unshift(historyItem);
  if (signalHistory.length > 20) {
    signalHistory.pop();
  }
  
  renderHistory();
}

function updateHistoryItem(signalType, aiStatus, aiNote) {
  if (signalHistory.length > 0 && signalHistory[0].type === signalType) {
    signalHistory[0].aiStatus = aiStatus;
    signalHistory[0].aiNote = aiNote;
    renderHistory();
  }
}

function renderHistory() {
  var listEl = document.getElementById('signal-history-list');
  listEl.innerHTML = signalHistory.slice(0, 15).map(function(item) {
    var aiIcon = item.aiStatus === 'confirmed' ? '✓' : 
                 item.aiStatus === 'rejected' ? '✗' : '⏳';
    return '<div class="history-item">' +
      '<span class="history-time">' + item.time + '</span>' +
      '<span class="history-type">' + item.type + '</span>' +
      '<span class="history-direction ' + item.direction + '">' + item.direction + '</span>' +
      '<span class="history-conf">' + item.confidence + '%</span>' +
      '<span class="history-ai ' + item.aiStatus + '">' + aiIcon + '</span>' +
    '</div>';
  }).join('');
}

function hideActiveSignal() {
  document.getElementById('active-signal').classList.add('hidden');
  document.getElementById('no-signal').style.display = 'flex';
  currentActiveSignal = null;
}

function playAlertSound(type) {
  try {
    var audioContext = new (window.AudioContext || window.webkitAudioContext)();
    var oscillator = audioContext.createOscillator();
    var gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    if (type === 'signal') {
      oscillator.frequency.value = 880;
      gainNode.gain.value = 0.3;
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.15);
    } else if (type === 'confirm') {
      oscillator.frequency.value = 523.25;
      gainNode.gain.value = 0.3;
      oscillator.start();
      setTimeout(function() {
        oscillator.frequency.value = 659.25;
      }, 100);
      setTimeout(function() {
        oscillator.frequency.value = 783.99;
        oscillator.stop(audioContext.currentTime + 0.3);
      }, 200);
    }
  } catch(e) {
    console.log('[RENDERER] Audio no disponible');
  }
}

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
  var maxQty = Math.max(...asks.map(a => parseFloat(a[1])), ...bids.map(b => parseFloat(b[1])));
  
  var asksHtml = '';
  asks.reverse().forEach(function(a) {
    var price = parseFloat(a[0]);
    var qty = parseFloat(a[1]);
    var total = qty * price;
    var pct = (qty / maxQty) * 100;
    asksHtml += '<div class="ob-row ask" style="--pct:' + pct + '%">' +
      '<span class="price">' + price.toFixed(2) + '</span>' +
      '<span class="qty">' + qty.toFixed(2) + '</span>' +
      '<span class="total">' + formatCompact(total) + '</span></div>';
  });
  
  var bidsHtml = '';
  bids.forEach(function(b) {
    var price = parseFloat(b[0]);
    var qty = parseFloat(b[1]);
    var total = qty * price;
    var pct = (qty / maxQty) * 100;
    bidsHtml += '<div class="ob-row bid" style="--pct:' + pct + '%">' +
      '<span class="price">' + price.toFixed(2) + '</span>' +
      '<span class="qty">' + qty.toFixed(2) + '</span>' +
      '<span class="total">' + formatCompact(total) + '</span></div>';
  });
  
  var spread = (parseFloat(asks[0][0]) - parseFloat(bids[0][0])).toFixed(2);
  var spreadPct = ((spread / midPrice) * 100).toFixed(3);
  var bidVol = bids.reduce(function(s, b) { return s + parseFloat(b[0]) * parseFloat(b[1]); }, 0);
  var askVol = asks.reduce(function(s, a) { return s + parseFloat(a[0]) * parseFloat(a[1]); }, 0);
  
  document.getElementById('asks-list').innerHTML = asksHtml;
  document.getElementById('bids-list').innerHTML = bidsHtml;
  
  var obDepth = document.getElementById('ob-depth');
  if (obDepth) {
    obDepth.innerHTML = '<div class="depth-info"><span class="label">Spread</span><span class="value">$' + spread + ' (' + spreadPct + '%)</span></div>' +
      '<div class="depth-info"><span class="label">Bid Vol</span><span class="value bid">' + formatCompact(bidVol) + '</span></div>' +
      '<div class="depth-info"><span class="label">Ask Vol</span><span class="value ask">' + formatCompact(askVol) + '</span></div>';
  }
}

function formatCompact(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toFixed(0);
}

function startAutoUpdate() {
  if (updateInterval) clearInterval(updateInterval);
  updateInterval = setInterval(async function() {
    try {
      // Chart & Price
      var klines = await window.electronAPI.binanceGetKlines(currentPair, currentTimeframe, 80);
      if (klines && klines.length > 0) {
        updateChart(klines);
        updatePriceInfo(klines);
      }
      
      // Orderbook
      var ob = await window.electronAPI.binanceGetOrderBook(currentPair, 20).catch(function(){return null;});
      if (ob) updateOrderBookVisual(ob);
      
      // Futures Data (Funding, OI, L/S, Mark Price)
      await loadFuturesData();
      
    } catch(e) { console.error('Auto-update error:', e); }
  }, 1000);
  
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
  if (!ind || ind.error) {
    console.log('Indicadores no disponibles:', ind ? ind.error : 'sin datos');
    return;
  }
  
  // RSI
  var rsiVal = parseFloat(ind.rsi) || 50;
  document.getElementById('rsi-value').textContent = ind.rsi !== null ? ind.rsi : '--';
  document.getElementById('rsi-bar').style.width = rsiVal + '%';
  document.getElementById('rsi-status').textContent = ind.rsiStatus || '--';
  
  // RSI 25 y 50
  document.getElementById('rsi25-value').textContent = ind.rsi25 !== null ? ind.rsi25 : '--';
  document.getElementById('rsi25-bar').style.width = (parseFloat(ind.rsi25) || 50) + '%';
  document.getElementById('rsi50-value').textContent = ind.rsi50 !== null ? ind.rsi50 : '--';
  document.getElementById('rsi50-bar').style.width = (parseFloat(ind.rsi50) || 50) + '%';
  
  // Stochastic
  var stochK = parseFloat(ind.stoch ? ind.stoch.k : 0) || 0;
  var stochD = parseFloat(ind.stoch ? ind.stoch.d : 0) || 0;
  document.getElementById('stoch-k').textContent = ind.stoch && ind.stoch.k !== null ? ind.stoch.k.toFixed(2) : '--';
  document.getElementById('stoch-k-bar').style.width = Math.min(Math.max(stochK, 0), 100) + '%';
  document.getElementById('stoch-d').textContent = ind.stoch && ind.stoch.d !== null ? ind.stoch.d.toFixed(2) : '--';
  document.getElementById('stoch-d-bar').style.width = Math.min(Math.max(stochD, 0), 100) + '%';
  
  // CCI
  var cciVal = parseFloat(ind.cci) || 0;
  var cciEl = document.getElementById('cci-val');
  cciEl.textContent = ind.cci !== null ? ind.cci : '--';
  cciEl.className = 'ind-value ' + (cciVal > 100 ? 'negative' : cciVal < -100 ? 'positive' : 'neutral');
  
  // MFI
  var mfiVal = parseFloat(ind.mfi) || 0;
  var mfiEl = document.getElementById('mfi-val');
  mfiEl.textContent = ind.mfi !== null ? ind.mfi : '--';
  mfiEl.className = 'ind-value ' + (mfiVal < 20 ? 'positive' : mfiVal > 80 ? 'negative' : 'neutral');
  
  // Williams %R
  var willEl = document.getElementById('williams-val');
  willEl.textContent = ind.williamsR !== null ? ind.williamsR : '--';
  willEl.className = 'ind-value ' + (parseFloat(ind.williamsR) > -20 ? 'negative' : parseFloat(ind.williamsR) < -80 ? 'positive' : 'neutral');
  
  // MACD
  if (ind.macd) { 
    var macdLine = document.getElementById('macd-line');
    var macdHist = document.getElementById('macd-hist');
    
    macdLine.textContent = ind.macd.macd !== null ? parseFloat(ind.macd.macd).toFixed(4) : '--';
    document.getElementById('macd-signal').textContent = ind.macd.signal !== null ? parseFloat(ind.macd.signal).toFixed(4) : '--';
    
    var histVal = parseFloat(ind.macd.histogram) || 0;
    macdHist.textContent = histVal.toFixed(4);
    macdHist.className = 'ind-value ' + (histVal >= 0 ? 'positive' : 'negative');
    
    document.getElementById('macd-hint').textContent = histVal >= 0 ? '↑ Alcista' : '↓ Bajista';
  }
  
  // EMAs
  var ema9 = ind.emas && ind.emas.ema9 !== null ? parseFloat(ind.emas.ema9) : null;
  var ema21 = ind.emas && ind.emas.ema21 !== null ? parseFloat(ind.emas.ema21) : null;
  var ema50 = ind.emas && ind.emas.ema50 !== null ? parseFloat(ind.emas.ema50) : null;
  var ema100 = ind.emas && ind.emas.ema100 !== null ? parseFloat(ind.emas.ema100) : null;
  var ema200 = ind.emas && ind.emas.ema200 !== null ? parseFloat(ind.emas.ema200) : null;
  
  document.getElementById('ema9').textContent = ema9 ? ema9.toFixed(2) : '--';
  document.getElementById('ema21').textContent = ema21 ? ema21.toFixed(2) : '--';
  document.getElementById('ema50').textContent = ema50 ? ema50.toFixed(2) : '--';
  document.getElementById('ema100').textContent = ema100 ? ema100.toFixed(2) : '--';
  document.getElementById('ema200').textContent = ema200 ? ema200.toFixed(2) : '--';
  
  document.getElementById('ema9-trend').textContent = ema9 !== null && ema21 !== null ? (ema9 > ema21 ? '↑' : '↓') : '-';
  document.getElementById('ema21-trend').textContent = ema21 !== null && ema50 !== null ? (ema21 > ema50 ? '↑' : '↓') : '-';
  document.getElementById('ema50-trend').textContent = ema50 !== null && ema200 !== null ? (ema50 > ema200 ? '↑' : '↓') : '-';
  document.getElementById('ema100-trend').textContent = ema100 !== null && ema200 !== null ? (ema100 > ema200 ? '↑' : '↓') : '-';
  document.getElementById('ema200-trend').textContent = ema200 !== null ? '—' : '-';
  
  // SMAs
  var sma20 = ind.sma && ind.sma.sma20 !== null ? parseFloat(ind.sma.sma20) : null;
  var sma50 = ind.sma && ind.sma.sma50 !== null ? parseFloat(ind.sma.sma50) : null;
  var sma200 = ind.sma && ind.sma.sma200 !== null ? parseFloat(ind.sma.sma200) : null;
  
  document.getElementById('sma20').textContent = sma20 ? sma20.toFixed(2) : '--';
  document.getElementById('sma50').textContent = sma50 ? sma50.toFixed(2) : '--';
  document.getElementById('sma200').textContent = sma200 ? sma200.toFixed(2) : '--';
  
  // Bollinger Bands
  if (ind.bollingerBands) {
    document.getElementById('bb-upper').textContent = ind.bollingerBands.upper !== null ? parseFloat(ind.bollingerBands.upper).toFixed(2) : '--';
    document.getElementById('bb-middle').textContent = ind.bollingerBands.middle !== null ? parseFloat(ind.bollingerBands.middle).toFixed(2) : '--';
    document.getElementById('bb-lower').textContent = ind.bollingerBands.lower !== null ? parseFloat(ind.bollingerBands.lower).toFixed(2) : '--';
    document.getElementById('bb-width').textContent = ind.bbWidth !== null ? parseFloat(ind.bbWidth).toFixed(2) + '%' : '--';
  }
  
  // ATR
  document.getElementById('atr-val').textContent = ind.atr !== null ? parseFloat(ind.atr).toFixed(2) : '--';
  document.getElementById('atr50-val').textContent = ind.atr50 !== null ? parseFloat(ind.atr50).toFixed(2) : '--';
  
  // ADX
  var adxVal = parseFloat(ind.adx) || 0;
  var adxEl = document.getElementById('adx-val');
  adxEl.textContent = ind.adx !== null ? parseFloat(ind.adx).toFixed(2) : '--';
  adxEl.className = 'ind-value ' + (adxVal > 25 ? 'positive' : adxVal < 15 ? 'negative' : 'neutral');
  document.getElementById('adx-hint').textContent = adxVal > 25 ? 'Tendencia FUERTE' : adxVal < 15 ? 'Tendencia DÉBIL' : 'Tendencia MODERADA';
  
  // +DI y -DI
  var plusDI = parseFloat(ind.plusDI) || 0;
  var minusDI = parseFloat(ind.minusDI) || 0;
  var plusDiEl = document.getElementById('plus-di');
  plusDiEl.textContent = ind.plusDI !== null ? plusDI.toFixed(2) : '--';
  plusDiEl.className = 'ind-value ' + (plusDI > minusDI ? 'positive' : 'negative');
  
  var minusDiEl = document.getElementById('minus-di');
  minusDiEl.textContent = ind.minusDI !== null ? minusDI.toFixed(2) : '--';
  minusDiEl.className = 'ind-value ' + (minusDI > plusDI ? 'negative' : 'positive');
  
  // VWAP, Volumen y OBV
  document.getElementById('vwap-val').textContent = ind.vwap !== null ? parseFloat(ind.vwap).toFixed(2) : '--';
  document.getElementById('volume-val').textContent = ind.volume && ind.volume.lastVolume ? parseFloat(ind.volume.lastVolume).toFixed(0) : '--';
  document.getElementById('volume-hint').textContent = 'Ratio: ' + (ind.volumeRatio !== null ? parseFloat(ind.volumeRatio).toFixed(1) : '--') + 'x';
  document.getElementById('volume-ratio').textContent = ind.volumeRatio !== null ? parseFloat(ind.volumeRatio).toFixed(2) : '--';
  document.getElementById('obv-val').textContent = ind.obv !== null ? parseFloat(ind.obv).toFixed(0) : '--';
  
  // Estructura del mercado
  var trendEl = document.getElementById('market-trend-value');
  trendEl.textContent = ind.trend || '--';
  trendEl.className = 'ind-value ' + (ind.trend === 'ALCISTA' ? 'positive' : ind.trend === 'BAJISTA' ? 'negative' : 'neutral');
  document.getElementById('trend-hint').textContent = 'Strength: ' + (ind.trendStrength !== null ? ind.trendStrength + '%' : '--');
  
  document.getElementById('support-val').textContent = ind.supportResistance ? ind.supportResistance.support : '--';
  document.getElementById('support-dist').textContent = ind.supportResistance ? 'Dist: ' + ind.supportResistance.distToSupport : '--';
  document.getElementById('resistance-val').textContent = ind.supportResistance ? ind.supportResistance.resistance : '--';
  document.getElementById('resistance-dist').textContent = ind.supportResistance ? 'Dist: ' + ind.supportResistance.distToResistance : '--';
  
  // Pivot y Fibonacci
  if (ind.pivot) {
    document.getElementById('pivot-val').textContent = ind.pivot.pp || '--';
  }
  if (ind.fibonacci) {
    document.getElementById('fib618-val').textContent = ind.fibonacci.level618 || '--';
  }
  document.getElementById('price-pos-val').textContent = ind.pricePosition !== null ? ind.pricePosition + '%' : '--';
  
  // Patrones y señales
  document.getElementById('pattern-val').textContent = ind.candlePatterns && ind.candlePatterns[0] ? ind.candlePatterns[0] : '--';
  var signalEl = document.getElementById('signal-val');
  signalEl.textContent = ind.bias ? ind.bias.signal : '--';
  signalEl.className = 'ind-value ' + (ind.bias && ind.bias.signal === 'LONG' ? 'positive' : ind.bias && ind.bias.signal === 'SHORT' ? 'negative' : 'neutral');
  document.getElementById('confluence-val').textContent = ind.confluence !== null ? ind.confluence + '%' : '--';
  document.getElementById('momentum-val').textContent = ind.momentum !== null ? ind.momentum + '%' : '--';
  document.getElementById('strength-val').textContent = ind.trendStrength !== null ? ind.trendStrength + '%' : '--';
  
  // Chart indicators summary
  document.getElementById('ind-rsi').textContent = ind.rsi !== null ? ind.rsi : '--';
  document.getElementById('ind-macd').textContent = ind.macd && ind.macd.histogram > 0 ? '↑' : (ind.macd && ind.macd.histogram < 0 ? '↓' : '—');
  
  var emaText = '--';
  if (ind.emas && ind.emas.ema9 !== null && ind.emas.ema21 !== null) {
    var trend = parseFloat(ind.emas.ema9) > parseFloat(ind.emas.ema21) ? '↑' : '↓';
    emaText = trend + ' ' + parseFloat(ind.emas.ema9).toFixed(0) + '/' + parseFloat(ind.emas.ema21).toFixed(0);
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
    
    var realtimeData = await window.electronAPI.realtimeGetLatest();
    
    updateStrategyPanel(volData, marketData, signal, realtimeData);
    playAlertSound('analysis');
    showToast('Análisis completado con datos en tiempo real','success');
  } catch(e) {
    console.error('Error en análisis:', e);
    showToast('Error: '+e.message,'error');
  }
  showLoader(false);
}

function updateStrategyPanel(volData, marketData, signal, realtimeData) {
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
    
    document.getElementById('ctx-type').textContent = marketData.trend || 'NEUTRAL';
    document.getElementById('ctx-trend').textContent = marketData.trendStrength + '%';
    
    if (marketData.trend15m) {
      var trend15mEl = document.getElementById('ctx-trend-15m');
      trend15mEl.textContent = marketData.trend15m;
      trend15mEl.className = 'ctx-value ' + (marketData.trend15m === 'ALCISTA' ? 'up' : marketData.trend15m === 'BAJISTA' ? 'down' : '');
    }
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
    
    document.getElementById('strategy-current-price').textContent = '$' + (signal.entry || '--');
    
    if (signal.compositeScore) {
      var aiStatusEl = document.getElementById('strategy-ai-status');
      aiStatusEl.className = 'strategy-ai-status confirmed';
      aiStatusEl.innerHTML = '<span class="ai-status-indicator">✅</span><span class="ai-status-text">AI Validada - Score: ' + signal.compositeScore + '%</span>';
    }
    
    if (signal.confirmations && signal.confirmations.length > 0) {
      var confListEl = document.getElementById('signal-confirmations');
      confListEl.innerHTML = signal.confirmations.map(function(c) { 
        return '<span class="confirmation-tag">' + c + '</span>'; 
      }).join('');
    }
    
    if (signal.direction !== 'WAIT') {
      playAlertSound('signal');
    }
  }
  
  if (realtimeData && realtimeData.orderFlow) {
    var of = realtimeData.orderFlow;
    
    document.getElementById('of-delta').textContent = of.cumulativeDelta > 0 ? '+' + of.cumulativeDelta.toFixed(0) : of.cumulativeDelta.toFixed(0);
    document.getElementById('of-delta').className = 'of-value ' + (of.cumulativeDelta > 0 ? 'positive' : 'negative');
    
    document.getElementById('of-buy-walls').textContent = of.buyWalls ? of.buyWalls.length : '0';
    document.getElementById('of-sell-walls').textContent = of.sellWalls ? of.sellWalls.length : '0';
    
    var totalPressure = (of.buyWallPressure || 0) - (of.sellWallPressure || 0);
    var pressureEl = document.getElementById('of-buy-pressure');
    pressureEl.textContent = (totalPressure > 0 ? '+' : '') + totalPressure.toFixed(0) + '%';
    pressureEl.className = 'of-value ' + (totalPressure > 0 ? 'positive' : 'negative');
    
    if (of.trend) {
      document.getElementById('ctx-trend').textContent = of.trend.direction;
      document.getElementById('ctx-trend').className = 'ctx-value ' + (of.trend.direction === 'UP' ? 'up' : of.trend.direction === 'DOWN' ? 'down' : '');
      document.getElementById('ctx-volatility').textContent = of.trend.volatility || 'NORMAL';
      document.getElementById('ctx-volatility').className = 'ctx-value ' + (of.trend.volatility === 'HIGH' ? 'high' : of.trend.volatility === 'LOW' ? 'low' : '');
    }
  }
  
  if (realtimeData && realtimeData.ticker) {
    var ticker = realtimeData.ticker;
    document.getElementById('strategy-current-price').textContent = '$' + ticker.price.toFixed(2);
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