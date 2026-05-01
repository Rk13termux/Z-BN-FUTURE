'use strict';

const ti = require('technicalindicators');

function calcRSI(closes, period = 14) {
  const result = ti.RSI.calculate({ values: closes, period });
  return result[result.length - 1] || null;
}

function calcMACD(closes) {
  const result = ti.MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  return result[result.length - 1] || null;
}

function calcEMA(closes, period) {
  const result = ti.EMA.calculate({ values: closes, period });
  return result[result.length - 1] || null;
}

function calcSMA(closes, period) {
  const result = ti.SMA.calculate({ values: closes, period });
  return result[result.length - 1] || null;
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const result = ti.BollingerBands.calculate({ values: closes, period, stdDev });
  return result[result.length - 1] || null;
}

function calcATR(highs, lows, closes, period = 14) {
  const result = ti.ATR.calculate({ high: highs, low: lows, close: closes, period });
  return result[result.length - 1] || null;
}

function calcStochastic(highs, lows, closes) {
  const result = ti.Stochastic.calculate({
    high: highs, low: lows, close: closes,
    period: 14, signalPeriod: 3,
  });
  return result[result.length - 1] || null;
}

function calcVWAP(highs, lows, closes, volumes) {
  const result = ti.VWAP.calculate({
    high: highs, low: lows, close: closes, volume: volumes,
  });
  return result[result.length - 1] || null;
}

function calcCCI(highs, lows, closes, period = 20) {
  const result = ti.CCI.calculate({ high: highs, low: lows, close: closes, period });
  return result[result.length - 1] || null;
}

function calcWilliamsR(highs, lows, closes, period = 14) {
  const result = ti.WilliamsR.calculate({ high: highs, low: lows, close: closes, period });
  return result[result.length - 1] || null;
}

function calcMFI(highs, lows, closes, volumes, period = 14) {
  const result = ti.MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period });
  return result[result.length - 1] || null;
}

function calcADX(highs, lows, closes, period = 14) {
  const result = ti.ADX.calculate({ high: highs, low: lows, close: closes, period });
  return result[result.length - 1] || null;
}

function calcOBV(closes, volumes) {
  const result = ti.OBV.calculate({ close: closes, volume: volumes });
  return result[result.length - 1] || null;
}

function calcPivotPoints(highs, lows, closes) {
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const lastClose = closes[closes.length - 1];
  
  const pp = (lastHigh + lastLow + lastClose) / 3;
  const r1 = 2 * pp - lastLow;
  const r2 = pp + (lastHigh - lastLow);
  const r3 = lastHigh + 2 * (pp - lastLow);
  const s1 = 2 * pp - lastHigh;
  const s2 = pp - (lastHigh - lastLow);
  const s3 = lastLow - 2 * (lastHigh - pp);
  
  return { pp: pp.toFixed(2), r1: r1.toFixed(2), r2: r2.toFixed(2), r3: r3.toFixed(2), s1: s1.toFixed(2), s2: s2.toFixed(2), s3: s3.toFixed(2) };
}

function calcFibonacci(highs, lows) {
  const high = Math.max(...highs.slice(-50));
  const low = Math.min(...lows.slice(-50));
  const diff = high - low;
  
  return {
    level0: high.toFixed(2),
    level236: (high - diff * 0.236).toFixed(2),
    level382: (high - diff * 0.382).toFixed(2),
    level500: (high - diff * 0.500).toFixed(2),
    level618: (high - diff * 0.618).toFixed(2),
    level786: (high - diff * 0.786).toFixed(2),
    level100: low.toFixed(2)
  };
}

function detectCandlePattern(klines) {
  const last3 = klines.slice(-3);
  const patterns = [];
  if (last3.length >= 2) {
    const prev = last3[last3.length - 2];
    const curr = last3[last3.length - 1];
    if (prev.close < prev.open && curr.close > curr.open && curr.open < prev.close && curr.close > prev.open) {
      patterns.push('Bullish Engulfing');
    }
    if (prev.close > prev.open && curr.close < curr.open && curr.open > prev.close && curr.close < prev.open) {
      patterns.push('Bearish Engulfing');
    }
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range > 0 && body / range < 0.1) patterns.push('Doji');
    const lowerShadow = Math.min(curr.open, curr.close) - curr.low;
    const upperShadow = curr.high - Math.max(curr.open, curr.close);
    if (lowerShadow > body * 2 && upperShadow < body * 0.5) patterns.push('Hammer');
    if (upperShadow > body * 2 && lowerShadow < body * 0.5) patterns.push('Shooting Star');
  }
  return patterns.length > 0 ? patterns : ['Sin patrón'];
}

function calcVolumeProfile(klines) {
  const volumes = klines.map(k => k.volume);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVol = volumes[volumes.length - 1];
  return {
    avgVolume: avgVol.toFixed(2),
    lastVolume: lastVol.toFixed(2),
    volumeRatio: (lastVol / avgVol).toFixed(2),
    trend: lastVol > avgVol * 1.5 ? 'Alto' : lastVol < avgVol * 0.5 ? 'Bajo' : 'Normal',
  };
}

function findSupportResistance(klines, lookback = 20) {
  const recent = klines.slice(-lookback);
  const highs = recent.map(k => k.high);
  const lows = recent.map(k => k.low);
  const resistance = Math.max(...highs);
  const support = Math.min(...lows);
  const currentPrice = klines[klines.length - 1].close;
  return {
    support: support.toFixed(4),
    resistance: resistance.toFixed(4),
    distToSupport: (((currentPrice - support) / currentPrice) * 100).toFixed(2) + '%',
    distToResistance: (((resistance - currentPrice) / currentPrice) * 100).toFixed(2) + '%',
  };
}

function determineTrend(closes, ema9, ema21, ema50, ema200) {
  let upCount = 0, downCount = 0;
  
  if (ema9 > ema21) upCount += 2; else downCount += 2;
  if (ema21 > ema50) upCount += 1; else downCount += 1;
  if (ema50 > ema200) upCount += 2; else downCount += 2;
  
  if (upCount > downCount) return 'ALCISTA';
  if (downCount > upCount) return 'BAJISTA';
  return 'LATERAL';
}

function calcTrendStrength(closes, ema9, ema21, ema50, ema200) {
  let points = 0;
  const total = 7;
  
  if (ema9 > ema21) points += 2;
  if (ema21 > ema50) points += 1;
  if (ema50 > ema200) points += 2;
  
  const price = closes[closes.length - 1];
  const emaVal = ema21 || ema50 || ema9;
  if (emaVal) {
    if (price > emaVal) points += 2;
    else points += 0;
  }
  
  return Math.round((points / total) * 100);
}

function calcConfluence(rsi, macdHist, stochK, bbPosition) {
  let score = 0;
  let count = 0;
  
  if (rsi !== null) {
    if (rsi < 35 || rsi > 65) score += 1;
    count++;
  }
  
  if (macdHist !== null) {
    if (macdHist > 0) score += 1;
    count++;
  }
  
  if (stochK !== null) {
    if (stochK < 25 || stochK > 75) score += 1;
    count++;
  }
  
  if (bbPosition !== null) {
    if (bbPosition < 20 || bbPosition > 80) score += 1;
    count++;
  }
  
  return count > 0 ? Math.round((score / count) * 100) : 50;
}

function calcMomentum(closes, period = 10) {
  const current = closes[closes.length - 1];
  const past = closes[closes.length - period] || current;
  const momentum = ((current - past) / past) * 100;
  return momentum;
}

function analyzeAll(klines) {
  const closes = klines.map(k => parseFloat(k.close));
  const highs = klines.map(k => parseFloat(k.high));
  const lows = klines.map(k => parseFloat(k.low));
  const volumes = klines.map(k => parseFloat(k.volume));
  
  if (closes.length < 50) {
    return { error: 'Datos insuficientes' };
  }
  
  const currentPrice = closes[closes.length - 1];
  
  const rsi = calcRSI(closes, 14);
  const rsi25 = calcRSI(closes, 25);
  const rsi50 = calcRSI(closes, 50);
  const macd = calcMACD(closes);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcSMA(closes, 200);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const bb = calcBollingerBands(closes);
  const atr = calcATR(highs, lows, closes, 14);
  const atr50 = calcATR(highs, lows, closes, 50);
  const stoch = calcStochastic(highs, lows, closes);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const cci = calcCCI(highs, lows, closes, 20);
  const williamsR = calcWilliamsR(highs, lows, closes, 14);
  const mfi = calcMFI(highs, lows, closes, volumes, 14);
  const adxData = calcADX(highs, lows, closes, 14);
  const obv = calcOBV(closes, volumes);
  const pivot = calcPivotPoints(highs, lows, closes);
  const fib = calcFibonacci(highs, lows);
  const vol = calcVolumeProfile(klines);
  const sr = findSupportResistance(klines);
  const patterns = detectCandlePattern(klines);
  
  let bbPosition = 50;
  if (bb && currentPrice) {
    const range = bb.upper - bb.lower;
    if (range > 0) {
      bbPosition = ((currentPrice - bb.lower) / range) * 100;
    }
  }
  
  let bbWidth = 0;
  if (bb) {
    bbWidth = ((bb.upper - bb.lower) / bb.middle) * 100;
  }
  
  const trend = determineTrend(closes, ema9, ema21, ema50, ema200);
  const trendStrength = calcTrendStrength(closes, ema9, ema21, ema50, ema200);
  const confluence = calcConfluence(rsi, macd ? macd.histogram : null, stoch ? stoch.k : null, bbPosition);
  const momentum = calcMomentum(closes);
  
  let bullPoints = 0;
  let bearPoints = 0;
  
  if (rsi !== null) {
    if (rsi < 30) bullPoints += 3;
    else if (rsi > 70) bearPoints += 3;
    else if (rsi < 45) bullPoints += 1;
    else bearPoints += 1;
  }
  if (ema9 && ema21) {
    if (ema9 > ema21) bullPoints += 2;
    else bearPoints += 2;
  }
  if (ema21 && ema50) {
    if (ema21 > ema50) bullPoints += 1;
    else bearPoints += 1;
  }
  if (ema50 && ema200) {
    if (ema50 > ema200) bullPoints += 2;
    else bearPoints += 2;
  }
  if (macd) {
    if (macd.histogram > 0) bullPoints += 2;
    else bearPoints += 2;
  }
  if (bb && currentPrice) {
    if (currentPrice < bb.lower) bullPoints += 2;
    else if (currentPrice > bb.upper) bearPoints += 2;
  }
  if (stoch) {
    if (stoch.k < 20) bullPoints += 1;
    else if (stoch.k > 80) bearPoints += 1;
  }
  if (adxData && adxData.adx > 25) {
    if (ema9 > ema21) bullPoints += 1;
    else bearPoints += 1;
  }
  
  const total = bullPoints + bearPoints;
  const bullPct = total > 0 ? Math.round((bullPoints / total) * 100) : 50;
  
  return {
    price: currentPrice.toFixed(4),
    rsi: rsi ? rsi.toFixed(2) : null,
    rsiStatus: rsi < 30 ? 'Sobrevenda' : rsi > 70 ? 'Sobrecompra' : 'Neutral',
    rsi25: rsi25 ? rsi25.toFixed(2) : null,
    rsi50: rsi50 ? rsi50.toFixed(2) : null,
    macd: macd ? { macd: macd.MACD, signal: macd.signal, histogram: macd.histogram } : null,
    emas: { 
      ema9: ema9 ? ema9.toFixed(4) : null, 
      ema21: ema21 ? ema21.toFixed(4) : null, 
      ema50: ema50 ? ema50.toFixed(4) : null, 
      ema100: ema100 ? ema100.toFixed(4) : null,
      ema200: ema200 ? ema200.toFixed(4) : null 
    },
    sma: {
      sma20: sma20 ? sma20.toFixed(4) : null,
      sma50: sma50 ? sma50.toFixed(4) : null,
      sma200: ema200 ? ema200.toFixed(4) : null
    },
    bollingerBands: bb ? { upper: bb.upper, middle: bb.middle, lower: bb.lower } : null,
    bbWidth: bbWidth.toFixed(2),
    bbPosition: bbPosition.toFixed(2),
    atr: atr ? atr.toFixed(4) : null,
    atr50: atr50 ? atr50.toFixed(4) : null,
    stoch: stoch ? { k: stoch.k, d: stoch.d } : null,
    vwap: vwap ? vwap.toFixed(4) : null,
    cci: cci ? cci.toFixed(2) : null,
    williamsR: williamsR ? williamsR.toFixed(2) : null,
    mfi: mfi ? mfi.toFixed(2) : null,
    adx: (adxData && adxData.adx) ? adxData.adx.toFixed(2) : null,
    plusDI: (adxData && adxData.plusDI) ? adxData.plusDI.toFixed(2) : null,
    minusDI: (adxData && adxData.minusDI) ? adxData.minusDI.toFixed(2) : null,
    obv: obv ? obv.toFixed(0) : null,
    pivot: pivot,
    fibonacci: fib,
    volume: vol,
    volumeRatio: vol.volumeRatio,
    supportResistance: sr,
    candlePatterns: patterns,
    trend: trend,
    trendStrength: trendStrength,
    confluence: confluence,
    momentum: momentum.toFixed(2),
    bias: { 
      bullPoints, 
      bearPoints, 
      bullPct, 
      signal: bullPct >= 60 ? 'LONG' : bullPct <= 40 ? 'SHORT' : 'NEUTRAL' 
    },
    pricePosition: bbPosition.toFixed(2)
  };
}

module.exports = { analyzeAll };