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

function analyzeAll(klines) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);

  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const ema200 = calcSMA(closes, 200);
  const bb = calcBollingerBands(closes);
  const atr = calcATR(highs, lows, closes);
  const stoch = calcStochastic(highs, lows, closes);
  const vwap = calcVWAP(highs, lows, closes, volumes);
  const cci = calcCCI(highs, lows, closes);
  const vol = calcVolumeProfile(klines);
  const sr = findSupportResistance(klines);
  const patterns = detectCandlePattern(klines);
  const currentPrice = closes[closes.length - 1];

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

  const total = bullPoints + bearPoints;
  const bullPct = total > 0 ? Math.round((bullPoints / total) * 100) : 50;

  return {
    price: currentPrice.toFixed(4),
    rsi: rsi ? rsi.toFixed(2) : 'N/A',
    rsiStatus: rsi < 30 ? 'Sobrevenda' : rsi > 70 ? 'Sobrecompra' : 'Neutral',
    macd: macd ? { macd: macd.MACD?.toFixed(4), signal: macd.signal?.toFixed(4), histogram: macd.histogram?.toFixed(4) } : null,
    emas: { ema9: ema9?.toFixed(4), ema21: ema21?.toFixed(4), ema50: ema50?.toFixed(4), ema200: ema200?.toFixed(4) },
    bollingerBands: bb ? { upper: bb.upper?.toFixed(4), middle: bb.middle?.toFixed(4), lower: bb.lower?.toFixed(4) } : null,
    atr: atr ? atr.toFixed(4) : 'N/A',
    stoch: stoch ? { k: stoch.k?.toFixed(2), d: stoch.d?.toFixed(2) } : null,
    vwap: vwap ? vwap.toFixed(4) : 'N/A',
    cci: cci ? cci.toFixed(2) : 'N/A',
    volume: vol,
    supportResistance: sr,
    candlePatterns: patterns,
    bias: { bullPoints, bearPoints, bullPct, signal: bullPct >= 60 ? 'LONG' : bullPct <= 40 ? 'SHORT' : 'NEUTRAL' },
  };
}

module.exports = { analyzeAll };