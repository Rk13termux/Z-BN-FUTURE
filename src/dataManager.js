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
      ticker: 5000,
      tickerHTTP: 5000,
      indicators: 5000,
      orderFlow: 1000
    };
    this.listeners = new Set();
    this.lastIndicators = null;
    this.previousOI = null;
    this.previousLongShort = null;
    this.lastPrice = 0;
    this.shortSqueezeDetected = false;
    
    this.deltaAccumulator = {
      current: 0,
      buyVolume: 0,
      sellVolume: 0,
      tradeCount: 0,
      lastResetTime: Date.now(),
      candleOpenPrice: 0,
      highPrice: 0,
      lowPrice: Number.MAX_VALUE
    };
    
    this.liquidationMonitor = {
      longLiquidations: [],
      shortLiquidations: [],
      last10SecLongVolume: 0,
      last10SecShortVolume: 0,
      alertThreshold: 100000,
      windowMs: 10000
    };
    
    this.absorptionDetector = {
      sellWallPrice: 0,
      sellWallVolume: 0,
      lastCheckTime: 0,
      checkInterval: 1000,
      absorptionCount: 0,
      absorptionThreshold: 3
    };
    
    this.orderFlowStats = {
      cumulativeDelta: 0,
      buyPressure: 50,
      buyWalls: [],
      sellWalls: [],
      spread: 0,
      volumeRatio: 1
    };
    
    this.deltaUpdateInterval = null;
  }

  async start(symbol = 'BTCUSDT') {
    this.symbol = symbol.toUpperCase();
    this.isRunning = true;
    
    this.orderFlow.onSignal((signal) => {
      this.emitSignal(signal);
      this.cache.set('orderFlow', { data: this.orderFlow.getAnalysis(), time: Date.now() });
      
      // Forward order flow signals to signal engine
      if (signal.type === 'STACKED_IMBALANCE' || 
          signal.type === 'SPOOFING_DETECTED' ||
          signal.type.includes('DIVERGENCE') ||
          signal.type === 'ABSORPTION_DETECTED') {
        console.log('[DATA MANAGER] 📡 Enviando señal OrderFlow al SignalEngine:', signal.type);
        this.signalEngine.updateOrderFlow({
          imbalances: this.orderFlow?.getAnalysis()?.imbalances || { buy: [], sell: [] },
          walls: this.orderFlow?.getAnalysis()?.walls || { buy: [], sell: [] },
          divergence: signal.type.includes('DIVERGENCE') ? signal : null,
          absorption: signal.type === 'ABSORPTION_DETECTED'
        });
      }
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
    this.startDeltaUpdater();
    this.updateIndicators();
    
    console.log('[DATA MANAGER] ✓ Sistema activo');
  }

  stop() {
    this.isRunning = false;
    this.ws.disconnect();
    if (this.deltaUpdateInterval) {
      clearInterval(this.deltaUpdateInterval);
    }
    console.log('[DATA MANAGER] Sistema detenido');
  }

  startDeltaUpdater() {
    this.deltaUpdateInterval = setInterval(() => {
      this.updateOrderFlowStats();
    }, 100);
  }

  updateOrderFlowStats() {
    const now = Date.now();
    const delta = this.deltaAccumulator;
    
    const totalVolume = delta.buyVolume + delta.sellVolume;
    const buyPressure = totalVolume > 0 ? (delta.buyVolume / totalVolume) * 100 : 50;
    
    this.orderFlowStats = {
      cumulativeDelta: delta.current.toFixed(2),
      buyVolume: delta.buyVolume.toFixed(4),
      sellVolume: delta.sellVolume.toFixed(4),
      tradeCount: delta.tradeCount,
      buyPressure: buyPressure.toFixed(1),
      priceChange: delta.candleOpenPrice > 0 
        ? ((this.lastPrice - delta.candleOpenPrice) / delta.candleOpenPrice * 100).toFixed(2)
        : 0,
      highPrice: delta.highPrice === Number.MAX_VALUE ? 0 : delta.highPrice,
      lowPrice: delta.lowPrice === Number.MAX_VALUE ? 0 : delta.lowPrice,
      timestamp: now
    };
    
    this.notifyListeners({ 
      type: 'orderFlowStats', 
      data: this.orderFlowStats 
    });
    
    this.checkAbsorption();
  }

  checkAbsorption() {
    const depthWalls = this.cache.get('depthWalls');
    if (!depthWalls || !depthWalls.data) return;
    
    const walls = depthWalls.data;
    if (!walls.sellWalls || walls.sellWalls.length === 0) return;
    
    const topSellWall = walls.sellWalls[0];
    const priceNearWall = this.lastPrice >= topSellWall.price * 0.998;
    
    if (priceNearWall && parseFloat(this.orderFlowStats.cumulativeDelta) > 100) {
      this.absorptionDetector.absorptionCount++;
      
      if (this.absorptionDetector.absorptionCount >= this.absorptionDetector.absorptionThreshold) {
        this.emitSignal({
          type: 'ABSORPTION_DETECTED',
          direction: 'SHORT',
          confidence: 85,
          reason: 'Absorción detectada: precio cerca de wall + delta positivo sin movimiento',
          data: {
            wallPrice: topSellWall.price,
            wallVolume: topSellWall.volume,
            delta: this.orderFlowStats.cumulativeDelta,
            currentPrice: this.lastPrice
          }
        });
        
        console.log('[DATA MANAGER] 🕸️ ABSORPTION DETECTED: Precio cerca de Sell Wall con delta positivo sin subir');
        
        this.absorptionDetector.absorptionCount = 0;
      }
    }
  }

  resetDeltaAccumulator() {
    const previousDelta = this.deltaAccumulator.current;
    const previousBuyPressure = this.deltaAccumulator.buyVolume / (this.deltaAccumulator.buyVolume + this.deltaAccumulator.sellVolume) * 100;
    
    console.log(`[DATA MANAGER] 🔄 Delta reseteado. Anterior: ${previousDelta.toFixed(2)}, Buy Pressure: ${previousBuyPressure.toFixed(1)}%`);
    
    this.deltaAccumulator = {
      current: 0,
      buyVolume: 0,
      sellVolume: 0,
      tradeCount: 0,
      lastResetTime: Date.now(),
      candleOpenPrice: this.lastPrice,
      highPrice: this.lastPrice,
      lowPrice: this.lastPrice
    };
  }

  processLiquidations(liquidation) {
    const now = Date.now();
    const data = liquidation;
    
    if (data.side === 'BUY') {
      this.liquidationMonitor.longLiquidations.push({ 
        ...data, 
        timestamp: now 
      });
      this.liquidationMonitor.last10SecLongVolume += data.quantityUSD;
    } else {
      this.liquidationMonitor.shortLiquidations.push({ 
        ...data, 
        timestamp: now 
      });
      this.liquidationMonitor.last10SecShortVolume += data.quantityUSD;
    }
    
    this.cleanOldLiquidations(now);
    
    if (this.liquidationMonitor.last10SecLongVolume > this.liquidationMonitor.alertThreshold) {
      console.log(`[DATA MANAGER] 🚨 ALERTA: Presión bajista extrema - ${(this.liquidationMonitor.last10SecLongVolume/1000).toFixed(0)}K USD liquidaciones Long en 10s`);
      
      this.emitSignal({
        type: 'HIGH_BEARISH_PRESSURE',
        direction: 'SHORT',
        confidence: 90,
        reason: `Fuerte presión bajista: ${(this.liquidationMonitor.last10SecLongVolume/1000).toFixed(0)}K USD liquidaciones Long en 10s`,
        data: {
          liquidations: this.liquidationMonitor.longLiquidations.slice(-5),
          volume: this.liquidationMonitor.last10SecLongVolume
        }
      });
      
      this.liquidationMonitor.last10SecLongVolume = 0;
    }
    
    if (this.liquidationMonitor.last10SecShortVolume > this.liquidationMonitor.alertThreshold) {
      console.log(`[DATA MANAGER] 🚨 ALERTA: Presión alcista extrema - ${(this.liquidationMonitor.last10SecShortVolume/1000).toFixed(0)}K USD liquidaciones Short en 10s`);
      
      this.emitSignal({
        type: 'HIGH_BULLISH_PRESSURE',
        direction: 'LONG',
        confidence: 90,
        reason: `Fuerte presión alcista: ${(this.liquidationMonitor.last10SecShortVolume/1000).toFixed(0)}K USD liquidaciones Short en 10s`,
        data: {
          liquidations: this.liquidationMonitor.shortLiquidations.slice(-5),
          volume: this.liquidationMonitor.last10SecShortVolume
        }
      });
      
      this.liquidationMonitor.last10SecShortVolume = 0;
    }
  }

  cleanOldLiquidations(now) {
    const windowStart = now - this.liquidationMonitor.windowMs;
    
    this.liquidationMonitor.longLiquidations = this.liquidationMonitor.longLiquidations.filter(
      l => l.timestamp > windowStart
    );
    this.liquidationMonitor.shortLiquidations = this.liquidationMonitor.shortLiquidations.filter(
      l => l.timestamp > windowStart
    );
  }

  handleWSData(msg) {
    switch (msg.type) {
      case 'ticker':
        console.log('[DATA MANAGER] ★ TICKER precio:', msg.data?.price, 'high:', msg.data?.high, 'low:', msg.data?.low);
        this.lastPrice = msg.data.price;
        this.lastTicker = msg.data;
        this.cache.set('ticker', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'ticker', data: msg.data });
        this.signalEngine.processTicker(msg.data);
        this.orderFlow.processTicker(msg.data);
        break;
        
      case 'depth':
        this.cache.set('depth', { data: msg.data, time: Date.now() });
        this.cache.set('depthWalls', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'depth', data: msg.data });
        this.signalEngine.processDepth(msg.data);
        this.orderFlow.processDepth(msg.data);
        break;
        
      case 'kline':
        this.cache.set('kline', { data: msg.data, time: Date.now() });
        this.notifyListeners({ type: 'kline', data: msg.data });
        this.signalEngine.processKline(msg.data);
        this.orderFlow.processKline(msg.data);
        
        if (msg.data.isClosed) {
          this.resetDeltaAccumulator();
          this.updateIndicators();
        }
        
        if (this.deltaAccumulator.candleOpenPrice === 0) {
          this.deltaAccumulator.candleOpenPrice = msg.data.open;
        }
        
        if (msg.data.close > this.deltaAccumulator.highPrice) {
          this.deltaAccumulator.highPrice = msg.data.close;
        }
        if (msg.data.close < this.deltaAccumulator.lowPrice) {
          this.deltaAccumulator.lowPrice = msg.data.close;
        }
        break;
        
      case 'trade':
      case 'aggressiveTrade':
        const trade = msg.data || msg;
        
        if (trade.direction === 'BUY') {
          this.deltaAccumulator.current += trade.quantity;
          this.deltaAccumulator.buyVolume += trade.quantity;
        } else {
          this.deltaAccumulator.current -= trade.quantity;
          this.deltaAccumulator.sellVolume += trade.quantity;
        }
        this.deltaAccumulator.tradeCount++;
        
        this.orderFlow.processTrade({
          price: trade.price,
          volume: trade.quantity,
          buyVolume: trade.direction === 'BUY' ? trade.quantity : 0,
          sellVolume: trade.direction === 'SELL' ? trade.quantity : 0
        });
        
        this.notifyListeners({ type: 'aggressiveTrade', data: trade });
        break;
        
      case 'liquidation':
        console.log('[DATA MANAGER] 💧 Liquidación:', msg.data.symbol, msg.data.side, msg.data.quantityUSD.toFixed(0) + ' USD');
        this.processLiquidations(msg.data);
        this.signalEngine.updateLiquidationPressure({
          long10s: this.liquidationMonitor.last10SecLongVolume,
          short10s: this.liquidationMonitor.last10SecShortVolume
        });
        this.notifyListeners({ type: 'liquidation', data: msg.data });
        this.cache.set('liquidation', { data: msg.data, time: Date.now() });
        break;
        
      case 'depthWalls':
        this.cache.set('depthWalls', { data: msg.data, time: Date.now() });
        this.orderFlowStats.buyWalls = msg.data.buyWalls || [];
        this.orderFlowStats.sellWalls = msg.data.sellWalls || [];
        this.orderFlowStats.spread = msg.data.spread || 0;
        this.notifyListeners({ type: 'depthWalls', data: msg.data });
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
        this.fetchTicker(),
        this.fetchFundingRate(),
        this.fetchOpenInterest(),
        this.fetchLongShortRatio()
      ]);
    }, 5000);
  }

  isCacheValid(key) {
    const cached = this.cache.get(key);
    if (!cached) return false;
    return (Date.now() - cached.time) < this.cacheTTL[key];
  }

  async fetchTicker() {
    // Fetch ticker via REST fallback (si WS no funciona)
    const cacheKey = 'tickerHTTP';
    if (this.isCacheValid(cacheKey)) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/ticker/24hr`, {
        params: { symbol: this.symbol },
        timeout: 5000
      });
      
      if (res.data) {
        const tickerData = {
          symbol: res.data.symbol,
          price: parseFloat(res.data.lastPrice),
          priceChange: parseFloat(res.data.priceChange),
          priceChangePercent: parseFloat(res.data.priceChangePercent),
          high: parseFloat(res.data.highPrice),
          low: parseFloat(res.data.lowPrice),
          volume: parseFloat(res.data.volume),
          quoteVolume: parseFloat(res.data.quoteVolume),
          openPrice: parseFloat(res.data.openPrice),
          trades: parseInt(res.data.count),
          buyVolume: parseFloat(res.data.buyVolume),
          sellVolume: parseFloat(res.data.sellVolume),
          timestamp: Date.now(),
          fundingRate: parseFloat(res.data.fundingRate)
        };
        
        this.cache.set(cacheKey, { data: tickerData, time: Date.now() });
        this.notifyListeners({ type: 'ticker', data: tickerData });
        this.signalEngine.processTicker(tickerData);
        this.orderFlow.processTicker(tickerData);
      }
    } catch (e) {
      console.error('[DATA MANAGER] Error fetch ticker:', e.message);
    }
  }

  async fetchFundingRate() {
    if (this.isCacheValid('funding')) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/fundingRate`, {
        params: { symbol: this.symbol, limit: 1 },
        timeout: 5000
      });
      
      if (res.data.length > 0) {
        const fundingData = {
          ...res.data[0],
          fundingRate: (parseFloat(res.data[0].fundingRate) * 100).toFixed(4) + '%',
          nextFunding: new Date(res.data[0].fundingTime).toLocaleString()
        };
        
        this.cache.set('funding', { data: fundingData, time: Date.now() });
        this.notifyListeners({ type: 'funding', data: fundingData });
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
      
      const oiData = {
        openInterest: currentOI.toFixed(2),
        oiChange: oiChange.toFixed(2) + '%',
        timestamp: Date.now()
      };
      
      this.cache.set('openInterest', { data: oiData, time: Date.now() });
      this.previousOI = currentOI;
      this.notifyListeners({ type: 'openInterest', data: oiData });
      
      if (Math.abs(oiChange) > 1) {
        this.detectShortSqueeze(oiChange);
      }
      
    } catch (e) {
      console.error('[DATA] Error OI:', e.message);
    }
  }

  async fetchLongShortRatio() {
    if (this.isCacheValid('longShort')) return;
    
    try {
      const res = await axios.get(`${BASE_URL}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol: this.symbol, period: '5m', limit: 1 },
        timeout: 5000
      });
      
      this.cache.set('longShort', { data: res.data[0], time: Date.now() });
      this.notifyListeners({ type: 'longShort', data: res.data[0] });
      
    } catch (e) {
      console.error('[DATA] Error longShort:', e.message);
    }
  }

  detectShortSqueeze(oiChange) {
    const ticker = this.cache.get('ticker');
    if (!ticker || !ticker.data) return;
    
    const priceChange = ticker.data.priceChangePercent;
    
    if (priceChange > 2 && oiChange < -1) {
      if (!this.shortSqueezeDetected) {
        console.log('[DATA MANAGER] 📊 Short Squeeze detectado: Precio ↑' + priceChange.toFixed(1) + '% + OI ↓' + oiChange.toFixed(1) + '%');
        
        this.emitSignal({
          type: 'SHORT_SQUEEZE',
          direction: 'LONG',
          confidence: 95,
          reason: 'Short Squeeze confirmado: Precio subiendo con OI bajando',
          data: { priceChange, oiChange }
        });
        
        this.shortSqueezeDetected = true;
        setTimeout(() => { this.shortSqueezeDetected = false; }, 60000);
      }
    }
  }

  async updateIndicators() {
    try {
      const binance = require('./binance');
      
      const [klines1h, klines4h] = await Promise.all([
        binance.getKlines(this.symbol, '1h', 100),
        binance.getKlines(this.symbol, '4h', 100)
      ]);
      
      const indicators = require('./indicators');
      
      const ind1h = indicators.analyzeAll(klines1h);
      const ind4h = indicators.analyzeAll(klines4h);
      
      this.lastIndicators = { 
        ...ind1h, 
        timeframe: '1h',
        timeframe4h: ind4h 
      };
      
      this.cache.set('indicators', { data: this.lastIndicators, time: Date.now() });
      this.notifyListeners({ type: 'indicators', data: this.lastIndicators });
      
    } catch (e) {
      console.error('[DATA] Error indicadores:', e.message);
    }
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners(data) {
    this.listeners.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[DATA] Listener error:', e.message); }
    });
  }

  emitSignal(signal) {
    signal.symbol = this.symbol;
    signal.timestamp = Date.now();
    
    this.cache.set('lastSignal', { data: signal, time: Date.now() });
    this.notifyListeners({ type: 'signal', data: signal });
  }

  getLatestData() {
    const tickerWS = this.cache.get('ticker')?.data;
    const tickerHTTP = this.cache.get('tickerHTTP')?.data;
    return {
      ticker: tickerWS || tickerHTTP,
      tickerHTTP: tickerHTTP,
      depth: this.cache.get('depth')?.data,
      depthWalls: this.cache.get('depthWalls')?.data,
      orderFlow: this.orderFlowStats,
      delta: this.deltaAccumulator,
      liquidations: {
        long10s: this.liquidationMonitor.last10SecLongVolume,
        short10s: this.liquidationMonitor.last10SecShortVolume
      },
      funding: this.cache.get('funding')?.data,
      openInterest: this.cache.get('openInterest')?.data,
      indicators: this.lastIndicators,
      lastSignal: this.cache.get('lastSignal')?.data
    };
  }

  changeSymbol(symbol) {
    this.symbol = symbol.toUpperCase();
    this.resetDeltaAccumulator();
    this.liquidationMonitor = {
      longLiquidations: [],
      shortLiquidations: [],
      last10SecLongVolume: 0,
      last10SecShortVolume: 0,
      alertThreshold: 100000,
      windowMs: 10000
    };
    this.ws.changeSymbol(symbol.toLowerCase());
  }
}

module.exports = new DataManager();