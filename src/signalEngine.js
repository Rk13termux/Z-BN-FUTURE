'use strict';

const ti = require('technicalindicators');

class SignalEngine {
  constructor() {
    this.listeners = [];
    this.lastSignal = null;
    this.lastPrice = 0;
    this.priceHistory = [];
    this.maxHistory = 100;
    this.volatilityThreshold = 0.5;
    this.volumeSpikeMultiplier = 2;
    this.lastCandleTime = 0;
    this.klinesBuffer = [];
    this.signalHistory = [];
    this.lastSignalTime = 0;
this.symbol = 'BTCUSDT';
    this.marketContext = { type: 'RANGING', trend: 'NEUTRAL', volatility: 'NORMAL' };
    this.klinesHigherTF = { '15m': [], '1h': [] };
    this.config = {
      minSignalInterval: 3000,
      minConfirmationCount: 2,
      enableFiltering: true,
      enableCascadeFilter: true,
      cascadeTimeframes: ['15m'],
      cascadeEMAperiod: 200
    };
  }

  async fetchHigherTimeframeData(symbol, interval, limit = 200) {
    try {
      const axios = require('axios');
      const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines`, {
        params: { symbol, interval, limit },
        timeout: 10000
      });
      return res.data.map(k => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        closeTime: k[6]
      }));
    } catch (e) {
      console.error(`[SIGNAL] Error fetching ${interval}:`, e.message);
      return [];
    }
  }

  async checkCascadeFilter(signal, symbol) {
    if (!this.config.enableCascadeFilter) return true;
    if (signal.timeframe && signal.timeframe !== '1m') return true;
    
    console.log(`[SIGNAL] 🔍 Verificando filtro cascada para señal ${signal.direction} en 1m...`);
    
    try {
      const klines15m = await this.fetchHigherTimeframeData(symbol, '15m', 200);
      if (klines15m.length < 200) {
        console.log(`[SIGNAL] ⚠ Datos insuficientes de 15m, permitiendo señal`);
        return true;
      }
      
      const closes15m = klines15m.map(k => k.close);
      const currentPrice15m = closes15m[closes15m.length - 1];
      
      const ema200 = ti.EMA.calculate({ values: closes15m, period: 200 });
      const ema200Value = ema200[ema200.length - 1];
      
      console.log(`[SIGNAL] 📊 15m: Precio=${currentPrice15m.toFixed(2)}, EMA200=${ema200Value.toFixed(2)}`);
      
      if (signal.direction === 'SHORT') {
        if (currentPrice15m > ema200Value) {
          console.log(`[SIGNAL] ❌ SEÑAL SHORT DESCARTADA: Precio ${currentPrice15m.toFixed(2)} > EMA200 ${ema200Value.toFixed(2)} en 15m - Contexto no es bearish`);
          return false;
        }
        console.log(`[SIGNAL] ✅ SEÑAL SHORT CONFIRMADA: Precio por debajo de EMA200 en 15m - Contexto bearish`);
      } else if (signal.direction === 'LONG') {
        if (currentPrice15m < ema200Value) {
          console.log(`[SIGNAL] ❌ SEÑAL LONG DESCARTADA: Precio ${currentPrice15m.toFixed(2)} < EMA200 ${ema200Value.toFixed(2)} en 15m - Contexto no es bullish`);
          return false;
        }
        console.log(`[SIGNAL] ✅ SEÑAL LONG CONFIRMADA: Precio por encima de EMA200 en 15m - Contexto bullish`);
      }
      
      return true;
      
    } catch (e) {
      console.error(`[SIGNAL] Error en filtro cascada:`, e.message);
      return true;
    }
  }

  shouldEmitSignal(signal) {
    if (Date.now() - this.lastSignalTime < this.config.minSignalInterval) {
      const lastSimilar = this.signalHistory.find(s => 
        s.type === signal.type && s.direction === signal.direction &&
        (Date.now() - s.timestamp) < 30000
      );
      if (lastSimilar) return false;
    }
    return true;
  }

  onSignal(callback) {
    this.listeners.push(callback);
  }

  async emitSignal(signal, symbol = 'BTCUSDT') {
    if (this.config.enableFiltering && !this.shouldEmitSignal(signal)) {
      console.log(`[SIGNAL] ❌ Señal filtrada por duplicado: ${signal.type}`);
      return;
    }
    
    if (!await this.checkCascadeFilter(signal, symbol)) {
      console.log(`[SIGNAL] ❌ Señal descartada por filtro cascada: ${signal.type} - No hay contexto bearish en 15m`);
      return;
    }
    
    signal.timestamp = Date.now();
    signal.marketContext = this.marketContext;
    signal.confirmations = this.getConfirmations(signal);
    signal.compositeScore = this.calculateCompositeScore(signal);
    signal.quality = this.getSignalQuality(signal);
    
    console.log(`[SIGNAL] ✅ Señal emitida: ${signal.type} | ${signal.direction} | Score: ${signal.compositeScore}% | Quality: ${signal.quality}`);
    
    this.signalHistory.push(signal);
    if (this.signalHistory.length > 50) this.signalHistory.shift();
    this.lastSignalTime = Date.now();
    
    this.lastSignal = signal;
    this.listeners.forEach(cb => {
      try {
        cb(signal);
      } catch (e) {
        console.error('[SEÑAL] Error:', e.message);
      }
    });
  }

  shouldEmitSignal(signal) {
    if (Date.now() - this.lastSignalTime < this.config.minSignalInterval) {
      const lastSimilar = this.signalHistory.find(s => 
        s.type === signal.type && s.direction === signal.direction &&
        (Date.now() - s.timestamp) < 30000
      );
      if (lastSimilar) return false;
    }
    return true;
  }

  getConfirmations(signal) {
    const confirmations = [];
    const klines = this.klinesBuffer;
    if (klines.length < 10) return confirmations;
    
    const closes = klines.slice(-10).map(k => k.close);
    const currentPrice = closes[closes.length - 1];
    
    try {
      const rsi = ti.RSI.calculate({ values: closes, period: 14 });
      const rsiVal = rsi[rsi.length - 1];
      
      if (signal.direction === 'LONG' && rsiVal < 40) confirmations.push('RSI_oversold');
      if (signal.direction === 'SHORT' && rsiVal > 60) confirmations.push('RSI_overbought');
      
      const ema9 = ti.EMA.calculate({ values: closes, period: 9 });
      const ema21 = ti.EMA.calculate({ values: closes, period: 21 });
      if (ema9[ema9.length-1] > ema21[ema21.length-1] && signal.direction === 'LONG') confirmations.push('EMA_bullish_cross');
      if (ema9[ema9.length-1] < ema21[ema21.length-1] && signal.direction === 'SHORT') confirmations.push('EMA_bearish_cross');
      
      const macd = ti.MACD.calculate({ values: closes, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, SimpleMAOscillator: false, SimpleMASignal: false });
      if (macd[macd.length-1].histogram > 0 && signal.direction === 'LONG') confirmations.push('MACD_bullish');
      if (macd[macd.length-1].histogram < 0 && signal.direction === 'SHORT') confirmations.push('MACD_bearish');
      
      const bb = ti.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      if (bb.length > 0) {
        if (currentPrice < bb[bb.length-1].lower && signal.direction === 'LONG') confirmations.push('BB_lower_touch');
        if (currentPrice > bb[bb.length-1].upper && signal.direction === 'SHORT') confirmations.push('BB_upper_touch');
      }
      
    } catch(e) {}
    
    return confirmations;
  }

  calculateCompositeScore(signal) {
    let score = signal.confidence || 50;
    
    const confirmationBonus = (signal.confirmations || []).length * 10;
    score += confirmationBonus;
    
    const priorityTypes = ['PULLBACK_LONG', 'PULLBACK_SHORT', 'TREND_EXHAUSTION', 'BUY_WALL', 'SELL_WALL', 'DELTA_CONFIRM_BULLISH', 'DELTA_CONFIRM_BEARISH'];
    if (priorityTypes.includes(signal.type)) score += 15;
    
    if (signal.marketContext?.type === 'TRENDING') score += 10;
    if (signal.marketContext?.type === 'RANGING' && ['BULLISH_ENGULFING', 'BEARISH_ENGULFING'].includes(signal.type)) score += 10;
    
    return Math.min(score, 100);
  }

  getSignalQuality(signal) {
    const score = signal.compositeScore;
    if (score >= 80) return 'EXCELENT';
    if (score >= 65) return 'GOOD';
    if (score >= 50) return 'FAIR';
    return 'WEAK';
  }

  updateMarketContext() {
    if (this.klinesBuffer.length < 20) return;
    
    const closes = this.klinesBuffer.slice(-20).map(k => k.close);
    const recent = closes.slice(-5);
    const older = closes.slice(-10, -5);
    
    const recentTrend = recent[recent.length-1] - recent[0];
    const olderTrend = older[older.length-1] - older[0];
    
    const volatility = closes.slice(-10).reduce((sum, p, i, arr) => {
      if (i === 0) return 0;
      return sum + Math.abs(p - arr[i-1]) / arr[i-1] * 100;
    }, 0) / 9;
    
    if (Math.abs(recentTrend) < closes[0] * 0.01) {
      this.marketContext.type = 'RANGING';
    } else if (recentTrend * olderTrend > 0 && Math.abs(recentTrend) > closes[0] * 0.02) {
      this.marketContext.type = 'TRENDING';
    } else {
      this.marketContext.type = 'TRANSITIONAL';
    }
    
    this.marketContext.trend = recentTrend > 0 ? 'UP' : recentTrend < 0 ? 'DOWN' : 'NEUTRAL';
    this.marketContext.volatility = volatility > 2 ? 'HIGH' : volatility > 1 ? 'NORMAL' : 'LOW';
  }

  processTicker(ticker) {
    if (!ticker) return;
    
    const currentPrice = ticker.price;
    const priceChange = ticker.priceChangePercent;
    
    this.lastPrice = currentPrice;
    this.priceHistory.push(currentPrice);
    if (this.priceHistory.length > this.maxHistory) {
      this.priceHistory.shift();
    }

    const signals = [];

    if (Math.abs(priceChange) > this.volatilityThreshold) {
      signals.push({
        type: 'VOLATILITY',
        direction: priceChange > 0 ? 'LONG' : 'SHORT',
        confidence: Math.min(Math.abs(priceChange) * 10, 95),
        reason: `Movimiento de precio: ${priceChange.toFixed(2)}%`,
        data: ticker
      });
    }

    if (ticker.volume > 0) {
      const avgVolume = this.calculateAvgVolume();
      if (ticker.volume > avgVolume * this.volumeSpikeMultiplier) {
        signals.push({
          type: 'VOLUME_SPIKE',
          direction: priceChange > 0 ? 'LONG' : 'SHORT',
          confidence: Math.min((ticker.volume / avgVolume) * 30, 90),
          reason: `Spike de volumen: ${(ticker.volume / avgVolume).toFixed(1)}x promedio`,
          data: ticker
        });
      }
    }

    if (ticker.buyVolume > ticker.sellVolume * 1.5) {
      signals.push({
        type: 'BUY_VOLUME_DOMINANCE',
        direction: 'LONG',
        confidence: Math.min(((ticker.buyVolume / (ticker.buyVolume + ticker.sellVolume)) * 100), 90),
        reason: 'Dominancia de compra: usuarios comprando más',
        data: ticker
      });
    } else if (ticker.sellVolume > ticker.buyVolume * 1.5) {
      signals.push({
        type: 'SELL_VOLUME_DOMINANCE',
        direction: 'SHORT',
        confidence: Math.min(((ticker.sellVolume / (ticker.buyVolume + ticker.sellVolume)) * 100), 90),
        reason: 'Dominancia de venta: usuarios vendiendo más',
        data: ticker
      });
    }

    signals.forEach(s => this.emitSignal(s));
  }

  processDepth(depth) {
    if (!depth || !depth.asks || !depth.bids) return;

    const topAsk = depth.asks[0] ? depth.asks[0][0] : 0;
    const topBid = depth.bids[0] ? depth.bids[0][0] : 0;
    const spread = topAsk - topBid;
    const spreadPercent = (spread / topBid) * 100;

    const bidVolume = depth.bids.reduce((sum, b) => sum + b[1], 0);
    const askVolume = depth.asks.reduce((sum, a) => sum + a[1], 0);

    if (spreadPercent < 0.01 && bidVolume > askVolume * 3) {
      this.emitSignal({
        type: 'ORDER_BOOK_IMBALANCE',
        direction: 'LONG',
        confidence: Math.min((bidVolume / askVolume) * 20, 85),
        reason: 'Presión compradora en orderbook',
        data: { spread, bidVolume, askVolume }
      });
    } else if (spreadPercent < 0.01 && askVolume > bidVolume * 3) {
      this.emitSignal({
        type: 'ORDER_BOOK_IMBALANCE',
        direction: 'SHORT',
        confidence: Math.min((askVolume / bidVolume) * 20, 85),
        reason: 'Presión vendedora en orderbook',
        data: { spread, bidVolume, askVolume }
      });
    }
  }

  processKline(kline) {
    if (!kline) return;
    
    if (kline.isClosed || kline.closeTime !== this.lastCandleTime) {
      this.lastCandleTime = kline.closeTime;
      this.klinesBuffer.push(kline);
      if (this.klinesBuffer.length > 200) {
        this.klinesBuffer.shift();
      }
      
      if (this.klinesBuffer.length >= 50) {
        this.updateMarketContext();
        this.analyzeCandlePatterns();
        this.analyzeIndicators();
      }
    }
  }

  analyzeCandlePatterns() {
    const klines = this.klinesBuffer.slice(-5);
    if (klines.length < 3) return;

    const curr = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const prevPrev = klines[klines.length - 3];

    const currBody = Math.abs(curr.close - curr.open);
    const prevBody = Math.abs(prev.close - prev.open);
    const currRange = curr.high - curr.low;
    const prevRange = prev.high - prev.low;

    if (prev.close < prev.open && curr.close > curr.open && 
        curr.open < prev.close && curr.close > prev.open) {
      this.emitSignal({
        type: 'BULLISH_ENGULFING',
        direction: 'LONG',
        confidence: 75,
        reason: 'Patrón Bullish Engulfing detectado',
        data: { kline: curr }
      });
    }

    if (prev.close > prev.open && curr.close < curr.open && 
        curr.open > prev.close && curr.close < prev.open) {
      this.emitSignal({
        type: 'BEARISH_ENGULFING',
        direction: 'SHORT',
        confidence: 75,
        reason: 'Patrón Bearish Engulfing detectado',
        data: { kline: curr }
      });
    }

    const upperShadow = curr.high - Math.max(curr.open, curr.close);
    const lowerShadow = Math.min(curr.open, curr.close) - curr.low;
    const body = Math.abs(curr.close - curr.open);

    if (lowerShadow > body * 2 && upperShadow < body * 0.3 && currRange > 0) {
      this.emitSignal({
        type: 'HAMMER',
        direction: 'LONG',
        confidence: 70,
        reason: 'Patrón Hammer (reversal alcista)',
        data: { kline: curr }
      });
    }

    if (upperShadow > body * 2 && lowerShadow < body * 0.3 && currRange > 0) {
      this.emitSignal({
        type: 'SHOOTING_STAR',
        direction: 'SHORT',
        confidence: 70,
        reason: 'Patrón Shooting Star (reversal bajista)',
        data: { kline: curr }
      });
    }

    if (currRange > 0 && currBody / currRange < 0.1) {
      this.emitSignal({
        type: 'DOJI',
        direction: 'NEUTRAL',
        confidence: 60,
        reason: 'Doji - indecisión del mercado',
        data: { kline: curr }
      });
    }
  }

  analyzeIndicators() {
    const closes = this.klinesBuffer.map(k => k.close);
    const highs = this.klinesBuffer.map(k => k.high);
    const lows = this.klinesBuffer.map(k => k.low);
    const volumes = this.klinesBuffer.map(k => k.volume);

    try {
      const rsi14 = ti.RSI.calculate({ values: closes, period: 14 });
      const rsi = rsi14[rsi14.length - 1];
      
      if (rsi !== null) {
        if (rsi < 25) {
          this.emitSignal({
            type: 'RSI_OVERSOLD',
            direction: 'LONG',
            confidence: Math.max(90 - rsi, 70),
            reason: `RSI muy bajo: ${rsi.toFixed(1)} (sobrevendido)`,
            data: { rsi }
          });
        } else if (rsi > 75) {
          this.emitSignal({
            type: 'RSI_OVERBOUGHT',
            direction: 'SHORT',
            confidence: Math.max(rsi - 10, 70),
            reason: `RSI muy alto: ${rsi.toFixed(1)} (sobrecomprado)`,
            data: { rsi }
          });
        }
      }

      const ema9 = ti.EMA.calculate({ values: closes, period: 9 });
      const ema21 = ti.EMA.calculate({ values: closes, period: 21 });
      
      if (ema9.length > 0 && ema21.length > 0) {
        const currentEma9 = ema9[ema9.length - 1];
        const currentEma21 = ema21[ema21.length - 1];
        const prevEma9 = ema9[ema9.length - 2];
        const prevEma21 = ema21[ema21.length - 2];
        
        if (prevEma9 <= prevEma21 && currentEma9 > currentEma21) {
          this.emitSignal({
            type: 'EMA_CROSS_BULLISH',
            direction: 'LONG',
            confidence: 80,
            reason: 'EMA 9 cruza arriba de EMA 21 (alcista)',
            data: { ema9: currentEma9, ema21: currentEma21 }
          });
        } else if (prevEma9 >= prevEma21 && currentEma9 < currentEma21) {
          this.emitSignal({
            type: 'EMA_CROSS_BEARISH',
            direction: 'SHORT',
            confidence: 80,
            reason: 'EMA 9 cruza debajo de EMA 21 (bajista)',
            data: { ema9: currentEma9, ema21: currentEma21 }
          });
        }
      }

      const macd = ti.MACD.calculate({
        values: closes,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false
      });
      
      if (macd.length > 0) {
        const currentMacd = macd[macd.length - 1];
        const prevMacd = macd[macd.length - 2];
        
        if (prevMacd.histogram <= 0 && currentMacd.histogram > 0) {
          this.emitSignal({
            type: 'MACD_BULLISH_CROSS',
            direction: 'LONG',
            confidence: 75,
            reason: 'MACD cruza positivo (momentum alcista)',
            data: { macd: currentMacd }
          });
        } else if (prevMacd.histogram >= 0 && currentMacd.histogram < 0) {
          this.emitSignal({
            type: 'MACD_BEARISH_CROSS',
            direction: 'SHORT',
            confidence: 75,
            reason: 'MACD cruza negativo (momentum bajista)',
            data: { macd: currentMacd }
          });
        }
      }

      const bb = ti.BollingerBands.calculate({ values: closes, period: 20, stdDev: 2 });
      if (bb.length > 0) {
        const currentBb = bb[bb.length - 1];
        const currentPrice = closes[closes.length - 1];
        
        if (currentPrice < currentBb.lower) {
          this.emitSignal({
            type: 'BB_LOWER_TOUCH',
            direction: 'LONG',
            confidence: 80,
            reason: 'Precio toca banda inferior de Bollinger',
            data: { bb: currentBb, price: currentPrice }
          });
        } else if (currentPrice > currentBb.upper) {
          this.emitSignal({
            type: 'BB_UPPER_TOUCH',
            direction: 'SHORT',
            confidence: 80,
            reason: 'Precio toca banda superior de Bollinger',
            data: { bb: currentBb, price: currentPrice }
          });
        }
      }

    } catch (e) {
      console.error('[SEÑAL] Error calculando indicadores:', e.message);
    }
  }

  calculateAvgVolume() {
    if (this.priceHistory.length < 10) return 0;
    return this.priceHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;
  }

  getLastSignal() {
    return this.lastSignal;
  }

  reset() {
    this.priceHistory = [];
    this.klinesBuffer = [];
    this.lastSignal = null;
  }
}

module.exports = SignalEngine;