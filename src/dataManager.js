'use strict';

const BinanceWebSocket = require('./websocket');
const SignalEngine = require('./signalEngine');
const OrderFlowEngine = require('./orderFlow');
const axios = require('axios');

const BASE_URL = 'https://fapi.binance.com';

class DataManager {
  constructor() {
    this.ws = new BinanceWebSocket();
    this.signalEngine = new SignalEngine();
    this.orderFlow = new OrderFlowEngine();
    this.symbol = 'BTCUSDT';
    this.isRunning = false;
    this.cache = new Map();
    this.cacheTTL = {
      funding: 60000,
      openInterest: 30000,
      longShort: 60000,
      ticker: 1000,
      indicators: 5000,
      orderFlow: 1000
    };
    this.listeners = new Set();
    this.lastIndicators = null;
    this.previousOI = null;
    this.previousLongShort = null;
    this.lastPrice = 0;
    this.shortSqueezeDetected = false;
  }

  async start(symbol = 'BTCUSDT') {
    this.symbol = symbol.toUpperCase();
    this.isRunning = true;
    
    this.orderFlow.onSignal((signal) => {
      this.emitSignal(signal);
      this.cache.set('orderFlow', { data: this.orderFlow.getAnalysis(), time: Date.now() });
    });
    
    console.log('[DATA MANAGER] Iniciando sistema de datos en tiempo real...');
    
    this.ws.connect(this.symbol.toLowerCase());
    
    this.ws.on('all', (msg) => {
      this.handleWSData(msg);
    });
    
    this.signalEngine.onSignal((signal) => {
      this.emitSignal(signal);
    });
    
    this.startHttpPolling();
    
    console.log('[DATA MANAGER] ✓ Sistema activo');
  }

  stop() {
    this.isRunning = false;
    this.ws.disconnect();
    console.log('[DATA MANAGER] Sistema detenido');
  }

  handleWSData(msg) {
    switch (msg.type) {
      case 'ticker':
        this.cache.set('ticker', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'ticker', data: msg.data });
        this.signalEngine.processTicker(msg.data);
        this.orderFlow.processTicker(msg.data);
        break;
        
      case 'depth':
        this.cache.set('depth', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'depth', data: msg.data });
        this.signalEngine.processDepth(msg.data);
        this.orderFlow.processDepth(msg.data);
        break;
        
      case 'kline':
        this.cache.set('kline', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'kline', data: msg.data });
        this.signalEngine.processKline(msg.data);
        this.orderFlow.processKline(msg.data);
        this.checkAndUpdateIndicators(msg.data);
        break;
        
      case 'trade':
        this.orderFlow.processTrade(msg.data);
        break;
    }
  }

  checkAndUpdateIndicators(kline) {
    if (kline.isClosed) {
      setTimeout(() => this.updateIndicators(), 100);
    }
  }

  startHttpPolling() {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      await Promise.all([
        this.fetchFundingRate(),
        this.fetchOpenInterest(),
        this.fetchLongShortRatio()
      ]);
    }, 10000);
  }

  async fetchFundingRate() {
    if (this.isCacheValid('funding')) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/fundingRate`, {
        params: { symbol: this.symbol, limit: 1 },
        timeout: 5000
      });
      
      if (res.data.length > 0) {
        this.cache.set('funding', {
          data: res.data[0],
          time: Date.now()
        });
        this.notifyListeners({ type: 'funding', data: res.data[0] });
      }
    } catch (e) {
      console.error('[DATA] Error funding:', e.message);
    }
  }

  async fetchOpenInterest() {
    if (this.isCacheValid('openInterest')) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/openInterest`, {
        params: { symbol: this.symbol },
        timeout: 5000
      });
      
      const currentOI = parseFloat(res.data.openInterest);
      let oiChange = 0;
      
      if (this.previousOI !== null) {
        oiChange = ((currentOI - this.previousOI) / this.previousOI) * 100;
      }
      
      this.cache.set('openInterest', {
        data: { ...res.data, oiChange },
        time: Date.now()
      });
      
      this.previousOI = currentOI;
      this.notifyListeners({ type: 'openInterest', data: { ...res.data, oiChange } });
      
      if (Math.abs(oiChange) > 1) {
        this.detectShortSqueeze(oiChange);
      }
      
    } catch (e) {
      console.error('[DATA] Error OI:', e.message);
    }
  }

  detectShortSqueeze(oiChange) {
    const currentTicker = this.cache.get('ticker')?.data;
    if (!currentTicker) return;
    
    const priceChange = currentTicker.priceChangePercent || 0;
    const currentLongShort = this.cache.get('longShort')?.data;
    
    if (!currentLongShort) return;
    
    const longAccountRatio = parseFloat(currentLongShort.longAccountRatio || 0.5);
    
    const isShortSqueeze = (
      priceChange > 0.5 &&
      oiChange < -2 &&
      longAccountRatio > 0.55
    );
    
    if (isShortSqueeze && !this.shortSqueezeDetected) {
      this.shortSqueezeDetected = true;
      
      console.log(`[DATA] ⚠ SHORT SQUEEZE DETECTED: Precio +${priceChange.toFixed(2)}% | OI -${oiChange.toFixed(2)}% | L/S ${(longAccountRatio*100).toFixed(0)}%`);
      
      const signal = {
        type: 'SHORT_SQUEEZE',
        direction: 'SHORT',
        confidence: 90,
        reason: `Short Squeeze detectado: Precio sube +${priceChange.toFixed(1)}% pero OI baja -${Math.abs(oiChange).toFixed(1)}% - Subida artificial sin respaldo de volumen. L/S Ratio: ${(longAccountRatio*100).toFixed(0)}% compradores`,
        data: {
          priceChange,
          oiChange,
          longShortRatio: longAccountRatio,
          squeezeType: 'artificial_rally'
        },
        compositeScore: 95,
        quality: 'EXCELENT'
      };
      
      this.emitSignal(signal);
      
      setTimeout(() => { this.shortSqueezeDetected = false; }, 60000);
    }
  }

  async fetchLongShortRatio() {
    if (this.isCacheValid('longShort')) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol: this.symbol, period: '5m', limit: 1 },
        timeout: 5000
      });
      
      if (res.data.length > 0) {
        this.cache.set('longShort', {
          data: res.data[0],
          time: Date.now()
        });
        this.notifyListeners({ type: 'longShort', data: res.data[0] });
      }
    } catch (e) {
      console.error('[DATA] Error L/S:', e.message);
    }
  }

  async updateIndicators() {
    if (!this.isCacheValid('indicators')) return;
    
    try {
      const kline = this.cache.get('kline')?.data;
      if (!kline) return;
      
      const res = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
        params: { symbol: this.symbol, interval: '1m', limit: 200 },
        timeout: 10000
      });
      
      const closes = res.data.map(k => parseFloat(k[4]));
      const highs = res.data.map(k => parseFloat(k[2]));
      const lows = res.data.map(k => parseFloat(k[3]));
      
      const ti = require('technicalindicators');
      
      const rsi = ti.RSI.calculate({ values: closes, period: 14 });
      const macd = ti.MACD.calculate({
        values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9,
        SimpleMAOscillator: false, SimpleMASignal: false
      });
      const ema9 = ti.EMA.calculate({ values: closes, period: 9 });
      const ema21 = ti.EMA.calculate({ values: closes, period: 21 });
      const ema50 = ti.EMA.calculate({ values: closes, period: 50 });
      
      this.lastIndicators = {
        rsi: rsi[rsi.length - 1],
        macd: macd[macd.length - 1],
        ema9: ema9[ema9.length - 1],
        ema21: ema21[ema21.length - 1],
        ema50: ema50[ema50.length - 1],
        price: closes[closes.length - 1],
        timestamp: Date.now()
      };
      
      this.cache.set('indicators', {
        data: this.lastIndicators,
        time: Date.now()
      });
      
      this.notifyListeners({ type: 'indicators', data: this.lastIndicators });
      
    } catch (e) {
      console.error('[DATA] Error indicadores:', e.message);
    }
  }

  isCacheValid(key) {
    const cached = this.cache.get(key);
    if (!cached) return false;
    
    const ttl = this.cacheTTL[key] || 5000;
    return (Date.now() - cached.time) < ttl;
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        console.error('[DATA] Listener error:', e.message);
      }
    });
  }

  onSignal(callback) {
    this.signalEngine.onSignal(callback);
  }

  emitSignal(signal) {
    this.signalEngine.emitSignal(signal);
  }

  getLatestData() {
    return {
      ticker: this.cache.get('ticker')?.data,
      depth: this.cache.get('depth')?.data,
      kline: this.cache.get('kline')?.data,
      funding: this.cache.get('funding')?.data,
      openInterest: this.cache.get('openInterest')?.data,
      longShort: this.cache.get('longShort')?.data,
      indicators: this.lastIndicators,
      orderFlow: this.orderFlow.getAnalysis()
    };
  }

  changeSymbol(symbol) {
    this.symbol = symbol.toUpperCase();
    this.cache.clear();
    this.orderFlow.reset();
    this.ws.changeSymbol(symbol.toLowerCase());
    console.log(`[DATA MANAGER] Cambiado a ${symbol}`);
  }

  isConnected() {
    return this.ws.isReady();
  }
}

module.exports = new DataManager();