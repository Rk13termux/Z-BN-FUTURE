'use strict';

const ti = require('technicalindicators');

class SignalEngine {
  constructor() {
    this.listeners = [];
    this.lastSignal = null;
    this.lastPrice = 0;
    this.priceHistory = [];
    this.maxHistory = 200;
    
    this.klinesBuffer = [];
    this.klines15m = [];
    this.signalHistory = [];
    this.lastSignalTime = 0;
    this.symbol = 'BTCUSDT';
    
    this.marketContext = { 
      type: 'RANGING', 
      trend: 'NEUTRAL', 
      volatility: 'NORMAL',
      trend15m: 'NEUTRAL',
      ema20015m: 0
    };
    
    this.deltaData = {
      cumulative: 0,
      buyPressure: 50,
      lastDirection: 'NEUTRAL'
    };
    
    this.orderFlowData = {
      imbalances: { buy: [], sell: [] },
      walls: { buy: [], sell: [] },
      absorption: false,
      spoofing: [],
      divergence: null
    };
    
    this.liquidationPressure = {
      long10s: 0,
      short10s: 0,
      lastAlert: null,
      priority: 'NONE'
    };
    
    this.cooldown = {
      lastFailedSignal: null,
      failedDirection: null,
      cooldownMs: 300000,
      revengeProtection: true
    };
    
    this.scoringWeights = {
      rsiOversold: 15,
      rsiOverbought: 15,
      emaCrossBullish: 20,
      emaCrossBearish: 20,
      macdBullish: 15,
      macdBearish: 15,
      ema200Below: 25,
      ema200Above: 25,
      imbalanceSell: 30,
      imbalanceBuy: 30,
      absorption: 40,
      stackedImbalance: 35,
      spoofing: 25,
      bearishDivergence: 45,
      bullishDivergence: 45,
      liquidationPressure: 35,
      volumeSpike: 10,
      trendConfirmation: 20
    };
    
    this.config = {
      minScore: 70,
      minSignalInterval: 5000,
      enableCascadeFilter: true,
      enableDeltaValidation: true,
      enableCooldown: true,
      enableLiquidationPriority: true,
      cascadeEMAperiod: 200,
      divergenceLookback: 20
    };
  }

  onSignal(callback) {
    this.listeners.push(callback);
  }

  emitSignal(signal) {
    signal.timestamp = Date.now();
    signal.symbol = this.symbol;
    this.lastSignal = signal;
    this.lastSignalTime = Date.now();
    
    this.signalHistory.push(signal);
    if (this.signalHistory.length > 50) {
      this.signalHistory.shift();
    }
    
    console.log(`[SIGNAL ENGINE] ✅ SEÑAL EMITIDA: ${signal.direction} | Score: ${signal.score} | ${signal.reason}`);
    
    this.listeners.forEach(cb => {
      try { cb(signal); } catch (e) { console.error('[SIGNAL] Error:', e.message); }
    });
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

  async checkCascadeFilter(direction) {
    if (!this.config.enableCascadeFilter) return { allowed: true, reason: 'Filtro cascada deshabilitado' };
    
    try {
      if (this.klines15m.length < 50) {
        this.klines15m = await this.fetchHigherTimeframeData(this.symbol, '15m', 200);
      }
      
      if (this.klines15m.length < 50) {
        return { allowed: true, reason: 'Datos 15m insuficientes' };
      }
      
      const closes = this.klines15m.map(k => k.close);
      const currentPrice = closes[closes.length - 1];
      
      const ema200 = ti.EMA.calculate({ values: closes, period: 200 });
      const ema200Value = ema200[ema200.length - 1];
      
      this.marketContext.ema20015m = ema200Value;
      
      if (direction === 'SHORT') {
        if (currentPrice > ema200Value) {
          console.log(`[SIGNAL] 🚫 BLOQUEO CASCADA: SHORT bloqueado - Precio ${currentPrice.toFixed(2)} > EMA200 ${ema200Value.toFixed(2)} (15m)`);
          return { allowed: false, reason: 'Precio sobre EMA200 (15m) - tendencia macro bajista requerida' };
        }
        return { allowed: true, reason: 'Precio bajo EMA200 (15m) - contexto bearish confirmado' };
      }
      
      if (direction === 'LONG') {
        if (currentPrice < ema200Value) {
          console.log(`[SIGNAL] 🚫 BLOQUEO CASCADA: LONG bloqueado - Precio ${currentPrice.toFixed(2)} < EMA200 ${ema200Value.toFixed(2)} (15m)`);
          return { allowed: false, reason: 'Precio bajo EMA200 (15m) - tendencia macro alcista requerida' };
        }
        return { allowed: true, reason: 'Precio sobre EMA200 (15m) - contexto bullish confirmado' };
      }
      
      return { allowed: true, reason: 'NEUTRAL' };
    } catch (e) {
      console.error('[SIGNAL] Error cascade filter:', e.message);
      return { allowed: true, reason: 'Error en filtro, permitiendo señal' };
    }
  }

  checkCooldown(direction) {
    if (!this.config.enableCooldown) return { allowed: true, reason: 'Cooldown deshabilitado' };
    
    const now = Date.now();
    const timeSinceFailed = now - (this.cooldown.lastFailedSignal || 0);
    
    if (this.cooldown.lastFailedSignal && 
        this.cooldown.failedDirection === direction &&
        timeSinceFailed < this.cooldown.cooldownMs) {
      
      const remainingSec = Math.ceil((this.cooldown.cooldownMs - timeSinceFailed) / 1000);
      console.log(`[SIGNAL] ⏳ COOLDOWN ACTIVO: ${remainingSec}s restantes antes de poder emitir ${direction}`);
      return { allowed: false, reason: `Revenge trading protection: ${remainingSec}s remaining` };
    }
    
    return { allowed: true, reason: 'Cooldown passed' };
  }

  setFailedSignal(direction) {
    this.cooldown.lastFailedSignal = Date.now();
    this.cooldown.failedDirection = direction;
  }

  checkDeltaDivergence(direction) {
    if (!this.config.enableDeltaValidation) return { confirmed: true, reason: 'Validación Delta deshabilitada' };
    
    const divergence = this.orderFlowData.divergence;
    if (!divergence) return { confirmed: true, reason: 'Sin datos de divergencia' };
    
    if (direction === 'SHORT' && divergence.type === 'BEARISH') {
      console.log(`[SIGNAL] 🎯 DELTA CONFIRMATION: Divergencia bajista detectada - Short confirmado`);
      return { confirmed: true, reason: 'Bearish divergence confirmada' };
    }
    
    if (direction === 'LONG' && divergence.type === 'BULLISH') {
      console.log(`[SIGNAL] 🎯 DELTA CONFIRMATION: Divergencia alcista detectada - Long confirmado`);
      return { confirmed: true, reason: 'Bullish divergence confirmada' };
    }
    
    if (direction === 'SHORT' && this.deltaData.cumulative < -100 && this.deltaData.lastDirection === 'DOWN') {
      console.log(`[SIGNAL] 🎯 DELTA CONFIRMATION: Delta negativo confirmando presión vendedor`);
      return { confirmed: true, reason: 'Delta negativo confirma SHORT' };
    }
    
    if (direction === 'LONG' && this.deltaData.cumulative > 100 && this.deltaData.lastDirection === 'UP') {
      console.log(`[SIGNAL] 🎯 DELTA CONFIRMATION: Delta positivo confirmando presión compradora`);
      return { confirmed: true, reason: 'Delta positivo confirma LONG' };
    }
    
    return { confirmed: false, reason: 'Delta no confirma dirección - esperando validación' };
  }

  checkLiquidationPriority(direction) {
    if (!this.config.enableLiquidationPriority) return { active: false };
    
    if (this.liquidationPressure.priority === 'BEARISH' && direction === 'SHORT') {
      console.log(`[SIGNAL] 💧 PRIORIDAD LIQUIDACIONES: Presión Short detectada - SHORT priorizado`);
      return { active: true, reason: 'Liquidation pressure SHORT confirmada' };
    }
    
    if (this.liquidationPressure.priority === 'BULLISH' && direction === 'LONG') {
      console.log(`[SIGNAL] 💧 PRIORIDAD LIQUIDACIONES: Presión Long detectada - LONG priorizado`);
      return { active: true, reason: 'Liquidation pressure LONG confirmada' };
    }
    
    return { active: false };
  }

  calculateScore(direction, indicators, marketData, orderFlow) {
    let score = 0;
    let confirmations = [];
    let risks = [];
    
    const rsi = parseFloat(indicators?.rsi) || 50;
    if (rsi < 30) {
      score += this.scoringWeights.rsiOversold;
      confirmations.push(`RSI sobrevendido (${rsi.toFixed(1)})`);
    } else if (rsi > 70) {
      score += this.scoringWeights.rsiOverbought;
      confirmations.push(`RSI sobrecomprado (${rsi.toFixed(1)})`);
    }
    
    const ema9 = parseFloat(indicators?.emas?.ema9) || 0;
    const ema21 = parseFloat(indicators?.emas?.ema21) || 0;
    const ema50 = parseFloat(indicators?.emas?.ema50) || 0;
    
    if (direction === 'LONG' && ema9 > ema21 && ema21 > ema50) {
      score += this.scoringWeights.emaCrossBullish;
      confirmations.push('EMA 9/21/50 alineados ALCISTA');
    } else if (direction === 'SHORT' && ema9 < ema21 && ema21 < ema50) {
      score += this.scoringWeights.emaCrossBearish;
      confirmations.push('EMA 9/21/50 alineados BAJISTA');
    }
    
    const macdHist = parseFloat(indicators?.macd?.histogram) || 0;
    if (direction === 'LONG' && macdHist > 0) {
      score += this.scoringWeights.macdBullish;
      confirmations.push('MACD positivo');
    } else if (direction === 'SHORT' && macdHist < 0) {
      score += this.scoringWeights.macdBearish;
      confirmations.push('MACD negativo');
    }
    
    const trend15m = this.marketContext.trend15m;
    if (direction === 'SHORT' && trend15m === 'BAJISTA') {
      score += this.scoringWeights.ema200Below;
      confirmations.push('Tendencia 15m BAJISTA');
    } else if (direction === 'LONG' && trend15m === 'ALCISTA') {
      score += this.scoringWeights.ema200Above;
      confirmations.push('Tendencia 15m ALCISTA');
    }
    
    if (direction === 'SHORT' && orderFlow?.imbalances?.sell?.length > 0) {
      score += this.scoringWeights.imbalanceSell * Math.min(orderFlow.imbalances.sell.length, 3);
      confirmations.push(`Imbalance VENTA (${orderFlow.imbalances.sell.length} niveles)`);
    } else if (direction === 'LONG' && orderFlow?.imbalances?.buy?.length > 0) {
      score += this.scoringWeights.imbalanceBuy * Math.min(orderFlow.imbalances.buy.length, 3);
      confirmations.push(`Imbalance COMPRA (${orderFlow.imbalances.buy.length} niveles)`);
    }
    
    if (orderFlow?.absorption) {
      score += this.scoringWeights.absorption;
      confirmations.push('Absorción detectada en resistencia');
    }
    
    if (orderFlow?.divergence) {
      if (direction === 'SHORT' && orderFlow.divergence.type === 'BEARISH') {
        score += this.scoringWeights.bearishDivergence;
        confirmations.push('BEARISH DIVERGENCE detectada');
      } else if (direction === 'LONG' && orderFlow.divergence.type === 'BULLISH') {
        score += this.scoringWeights.bullishDivergence;
        confirmations.push('BULLISH DIVERGENCE detectada');
      }
    }
    
    const liqPriority = this.checkLiquidationPriority(direction);
    if (liqPriority.active) {
      score += this.scoringWeights.liquidationPressure;
      confirmations.push('Prioridad liquidaciones activada');
    }
    
    if (marketData?.trend === 'ALCISTA' && direction === 'LONG') {
      score += this.scoringWeights.trendConfirmation;
      confirmations.push('Tendencia 4h ALCISTA');
    } else if (marketData?.trend === 'BAJISTA' && direction === 'SHORT') {
      score += this.scoringWeights.trendConfirmation;
      confirmations.push('Tendencia 4h BAJISTA');
    }
    
    if (score < 30) {
      risks.push('Score bajo - baja probabilidad de éxito');
    }
    
    if (parseFloat(indicators?.atr) > this.lastPrice * 0.03) {
      risks.push('Alta volatilidad - considerar stops amplios');
    }
    
    return { score, confirmations, risks };
  }

  async evaluateSignal(direction, type, data) {
    if (Date.now() - this.lastSignalTime < this.config.minSignalInterval) {
      console.log(`[SIGNAL] ⏳ Intervalo mínimo no cumplido`);
      return;
    }
    
    const cooldownCheck = this.checkCooldown(direction);
    if (!cooldownCheck.allowed) {
      console.log(`[SIGNAL] 🚫 SEÑAL BLOQUEADA: ${cooldownCheck.reason}`);
      return;
    }
    
    const cascadeCheck = await this.checkCascadeFilter(direction);
    if (!cascadeCheck.allowed) {
      console.log(`[SIGNAL] 🚫 SEÑAL BLOQUEADA: ${cascadeCheck.reason}`);
      return;
    }
    
    const indicators = data.indicators || {};
    const marketData = data.marketData || {};
    const orderFlow = data.orderFlow || this.orderFlowData;
    
    const { score, confirmations, risks } = this.calculateScore(direction, indicators, marketData, orderFlow);
    
    if (score >= this.config.minScore) {
      const deltaCheck = this.checkDeltaDivergence(direction);
      
      if (!deltaCheck.confirmed && this.config.enableDeltaValidation) {
        console.log(`[SIGNAL] ⏳ Esperando confirmación Delta: ${deltaCheck.reason}`);
        return;
      }
      
      this.emitSignal({
        type: 'TRADE_READY',
        direction,
        score,
        confidence: Math.min(score, 95),
        reasons: confirmations,
        risks,
        price: this.lastPrice,
        entryPrice: this.lastPrice,
        stopLoss: direction === 'LONG' ? this.lastPrice * 0.995 : this.lastPrice * 1.005,
        takeProfit: direction === 'LONG' ? this.lastPrice * 1.015 : this.lastPrice * 0.985,
        data,
        timeframe: '1m'
      });
    } else {
      console.log(`[SIGNAL] ❌ Score insuficiente: ${score} < ${this.config.minScore}`);
    }
  }

  async processTicker(ticker) {
    if (!ticker) return;
    this.lastPrice = ticker.price;
    
    this.deltaData.cumulative = parseFloat(ticker.buyVolume || 0) - parseFloat(ticker.sellVolume || 0);
    const totalVol = (parseFloat(ticker.buyVolume) || 0) + (parseFloat(ticker.sellVolume) || 0);
    this.deltaData.buyPressure = totalVol > 0 ? (parseFloat(ticker.buyVolume) / totalVol * 100) : 50;
    this.deltaData.lastDirection = this.deltaData.cumulative > 0 ? 'UP' : this.deltaData.cumulative < 0 ? 'DOWN' : 'NEUTRAL';
  }

  processDepth(depth) {
    if (!depth || !depth.asks || !depth.bids) return;
  }

  processKline(kline) {
    if (!kline) return;
    
    this.klinesBuffer.push(kline);
    if (this.klinesBuffer.length > 200) {
      this.klinesBuffer.shift();
    }
    
    if (kline.isClosed && this.klines15m.length > 0) {
      this.klines15m = this.klines15m.slice(1);
      this.klines15m.push({ close: kline.close });
    }
    
    this.analyzePattern(kline);
    this.analyzeIndicators();
  }

  analyzePattern(kline) {
    if (this.klinesBuffer.length < 3) return;
    
    const curr = kline;
    const prev = this.klinesBuffer[this.klinesBuffer.length - 2];
    const prevPrev = this.klinesBuffer[this.klinesBuffer.length - 3];
    
    if (!curr || !prev || !prevPrev) return;
    
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    
    if (body < range * 0.1 && range > 0) {
      this.evaluateSignal('NEUTRAL', 'DOJI', { indicators: { rsi: 50 } });
    }
  }

  analyzeIndicators() {
    if (this.klinesBuffer.length < 50) return;
    
    const closes = this.klinesBuffer.map(k => k.close);
    const highs = this.klinesBuffer.map(k => k.high);
    const lows = this.klinesBuffer.map(k => k.low);
    const volumes = this.klinesBuffer.map(k => k.volume);
    
    try {
      const rsi14 = ti.RSI.calculate({ values: closes, period: 14 });
      const rsi = rsi14[rsi14.length - 1];
      
      if (rsi !== null) {
        if (rsi < 25) {
          this.evaluateSignal('LONG', 'RSI_OVERSOLD', { 
            indicators: { rsi: rsi.toFixed(2), emas: this.getEMAs(closes) } 
          });
        } else if (rsi > 75) {
          this.evaluateSignal('SHORT', 'RSI_OVERBOUGHT', { 
            indicators: { rsi: rsi.toFixed(2), emas: this.getEMAs(closes) } 
          });
        }
      }
      
      const ema9 = ti.EMA.calculate({ values: closes, period: 9 });
      const ema21 = ti.EMA.calculate({ values: closes, period: 21 });
      const ema50 = ti.EMA.calculate({ values: closes, period: 50 });
      
      if (ema9.length > 2 && ema21.length > 2) {
        const currEma9 = ema9[ema9.length - 1];
        const currEma21 = ema21[ema21.length - 1];
        const prevEma9 = ema9[ema9.length - 2];
        const prevEma21 = ema21[ema21.length - 2];
        
        if (prevEma9 <= prevEma21 && currEma9 > currEma21) {
          this.evaluateSignal('LONG', 'EMA_CROSS', { 
            indicators: { 
              rsi: rsi?.toFixed(2), 
              emas: { ema9: currEma9.toFixed(2), ema21: currEma21.toFixed(2), ema50: ema50[ema50.length - 1]?.toFixed(2) } 
            } 
          });
        } else if (prevEma9 >= prevEma21 && currEma9 < currEma21) {
          this.evaluateSignal('SHORT', 'EMA_CROSS', { 
            indicators: { 
              rsi: rsi?.toFixed(2), 
              emas: { ema9: currEma9.toFixed(2), ema21: currEma21.toFixed(2), ema50: ema50[ema50.length - 1]?.toFixed(2) } 
            } 
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
      
      if (macd.length > 2) {
        const currMacd = macd[macd.length - 1];
        const prevMacd = macd[macd.length - 2];
        
        if (prevMacd.histogram <= 0 && currMacd.histogram > 0) {
          this.evaluateSignal('LONG', 'MACD_CROSS', { 
            indicators: { macd: currMacd, rsi: rsi?.toFixed(2), emas: this.getEMAs(closes) } 
          });
        } else if (prevMacd.histogram >= 0 && currMacd.histogram < 0) {
          this.evaluateSignal('SHORT', 'MACD_CROSS', { 
            indicators: { macd: currMacd, rsi: rsi?.toFixed(2), emas: this.getEMAs(closes) } 
          });
        }
      }
      
    } catch (e) {
      console.error('[SIGNAL] Error análisis indicadores:', e.message);
    }
  }

  getEMAs(closes) {
    return {
      ema9: ti.EMA.calculate({ values: closes, period: 9 }).slice(-1)[0],
      ema21: ti.EMA.calculate({ values: closes, period: 21 }).slice(-1)[0],
      ema50: ti.EMA.calculate({ values: closes, period: 50 }).slice(-1)[0]
    };
  }

  updateOrderFlow(data) {
    this.orderFlowData = {
      ...this.orderFlowData,
      ...data
    };
  }

  updateLiquidationPressure(data) {
    this.liquidationPressure = {
      long10s: data.long10s || 0,
      short10s: data.short10s || 0,
      priority: data.long10s > 100000 ? 'BEARISH' : data.short10s > 100000 ? 'BULLISH' : 'NONE',
      lastAlert: Date.now()
    };
  }

  updateMarketContext(data) {
    this.marketContext = {
      ...this.marketContext,
      ...data
    };
  }

  signalFailed(direction) {
    this.setFailedSignal(direction);
    console.log(`[SIGNAL] ⚠️ SEÑAL FALLIDA: ${direction} - Cooldown activado por 5 minutos`);
  }

  getLastSignal() {
    return this.lastSignal;
  }

  getHistory(count = 10) {
    return this.signalHistory.slice(-count);
  }

  reset() {
    this.klinesBuffer = [];
    this.signalHistory = [];
    this.lastSignalTime = 0;
    this.cooldown = {
      lastFailedSignal: null,
      failedDirection: null,
      cooldownMs: 300000,
      revengeProtection: true
    };
  }
}

module.exports = SignalEngine;