'use strict';

const ti = require('technicalindicators');

function calculateAllIndicators(klines, orderBook = null, marketData = {}) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const currentPrice = closes[closes.length - 1];
  
  const indicators = {};
  
  // === OSCILADORES ===
  indicators.rsi14 = calcRSI(closes, 14);
  indicators.rsi25 = calcRSI(closes, 25);
  indicators.rsi50 = calcRSI(closes, 50);
  
  // Estocástico
  const stoch = calcStochastic(highs, lows, closes);
  indicators.stochK = stoch?.k;
  indicators.stochD = stoch?.d;
  indicators.stochRSI = calcStochasticRSI(closes);
  
  // MACD
  const macd = calcMACD(closes);
  indicators.macd = macd?.macd;
  indicators.macdSignal = macd?.signal;
  indicators.macdHistogram = macd?.histogram;
  
  // CCI
  indicators.cci = calcCCI(highs, lows, closes, 20);
  indicators.cci14 = calcCCI(highs, lows, closes, 14);
  
  // MFI (Money Flow Index)
  indicators.mfi = calcMFI(highs, lows, closes, volumes, 14);
  
  // Williams %R
  indicators.williamsR = calcWilliamsR(highs, lows, closes, 14);
  
  // Awesome Oscillator
  indicators.ao = calcAwesomeOscillator(highs, lows);
  
  // === MEDIAS MÓVILES ===
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const ema100 = calcEMA(closes, 100);
  const ema200 = calcEMA(closes, 200);
  const sma20 = calcSMA(closes, 20);
  const sma50 = calcSMA(closes, 50);
  const sma200 = calcSMA(closes, 200);
  
  indicators.ema9 = ema9;
  indicators.ema21 = ema21;
  indicators.ema50 = ema50;
  indicators.ema100 = ema100;
  indicators.ema200 = ema200;
  indicators.sma20 = sma20;
  indicators.sma50 = sma50;
  indicators.sma200 = sma200;
  
  // Cruces de EMAs
  indicators.ema9Above21 = ema9 > ema21;
  indicators.ema21Above50 = ema21 > ema50;
  indicators.ema50Above200 = ema50 > ema200;
  indicators.ema9Above50 = ema9 > ema50;
  
  // === BANDAS DE BOLLINGER ===
  const bb = calcBollingerBands(closes, 20, 2);
  if (bb) {
    indicators.bbUpper = bb.upper;
    indicators.bbMiddle = bb.middle;
    indicators.bbLower = bb.lower;
    indicators.bbWidth = ((bb.upper - bb.lower) / bb.middle) * 100;
    indicators.bbPosition = ((currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100;
  }
  
  // === ATR Y VOLATILIDAD ===
  indicators.atr14 = calcATR(highs, lows, closes, 14);
  indicators.atr50 = calcATR(highs, lows, closes, 50);
  
  // Keltner Channels
  const kc = calcKeltner(highs, lows, closes, 20, 2);
  if (kc) {
    indicators.kcUpper = kc.upper;
    indicators.kcMiddle = kc.middle;
    indicators.kcLower = kc.lower;
  }
  
  // Donchian Channels
  const dc = calcDonchian(highs, lows, 20);
  if (dc) {
    indicators.dcUpper = dc.upper;
    indicators.dcMiddle = dc.middle;
    indicators.dcLower = dc.lower;
  }
  
  // === VOLUMEN ===
  indicators.vwap = calcVWAP(highs, lows, closes, volumes);
  indicators.obv = calcOBV(closes, volumes);
  indicators.vwap2 = calcVWAP2(klines);
  
  // Volume SMA
  indicators.volumeSma20 = calcSMA(volumes, 20);
  indicators.volumeRatio = volumes[volumes.length - 1] / indicators.volumeSma20;
  
  // === ADX (Average Directional Index) ===
  const adxData = calcADX(highs, lows, closes, 14);
  indicators.adx = adxData?.adx;
  indicators.plusDI = adxData?.plusDI;
  indicators.minusDI = adxData?.minusDI;
  
  // === PIVOT POINTS ===
  const pivot = calcPivotPoints(highs, lows, closes);
  indicators.pivot = pivot;
  
  // === SOPORTE Y RESISTENCIA ===
  const sr = findSupportResistance(klines, 50);
  indicators.support = sr.support;
  indicators.resistance = sr.resistance;
  indicators.supportDistance = ((currentPrice - sr.support) / currentPrice) * 100;
  indicators.resistanceDistance = ((sr.resistance - currentPrice) / currentPrice) * 100;
  
  // === ICHIMOKU CLOUD (Simplificado) ===
  const ichimoku = calcIchimoku(klines);
  indicators.ichimoku = ichimoku;
  
  // === PATRONES ===
  indicators.patterns = detectCandlePatterns(klines, 5);
  indicators.patternStrength = calculatePatternStrength(indicators.patterns);
  
  // === MOMENTUM ===
  indicators.momentum = calcMomentum(closes, 10);
  indicators.roc = calcROC(closes, 10); // Rate of Change
  
  // === DIVERCENCIAS ===
  const divergence = detectDivergence(klines, indicators.rsi14);
  indicators.rsiDivergence = divergence;
  
  // === TENDENCIA ===
  indicators.trend = determineTrend(indicators);
  indicators.trendStrength = calculateTrendStrength(indicators);
  
  // === FIBONACCI RETRACEMENT ===
  indicators.fibonacci = calcFibonacci(highs, lows);
  
  // === PRICE ACTION ===
  indicators.pricePosition = calcPricePosition(klines);
  
  // === TIMEFRAME SIGNAL ===
  indicators.timeframeSignal = {
    '1m': calcTimeframeSignal(klines, indicators),
    confluence: calculateConfluence(indicators)
  };
  
  return {
    price: currentPrice,
    indicators,
    features: extractFeatures(indicators, currentPrice, marketData)
  };
}

function calcRSI(closes, period = 14) {
  try {
    const result = ti.RSI.calculate({ values: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcMACD(closes) {
  try {
    const result = ti.MACD.calculate({
      values: closes,
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcEMA(closes, period) {
  try {
    const result = ti.EMA.calculate({ values: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcSMA(closes, period) {
  try {
    const result = ti.SMA.calculate({ values: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  try {
    const result = ti.BollingerBands.calculate({ values: closes, period, stdDev });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcATR(highs, lows, closes, period = 14) {
  try {
    const result = ti.ATR.calculate({ high: highs, low: lows, close: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcStochastic(highs, lows, closes) {
  try {
    const result = ti.Stochastic.calculate({
      high: highs, low: lows, close: closes,
      period: 14, signalPeriod: 3,
    });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcStochasticRSI(closes, period = 14) {
  try {
    const rsiValues = ti.RSI.calculate({ values: closes, period });
    const result = ti.StochasticRSI.calculate({
      values: rsiValues,
      kPeriod: 3,
      dPeriod: 3,
      rsiPeriod: period,
      stochasticPeriod: 14
    });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcCCI(highs, lows, closes, period = 20) {
  try {
    const result = ti.CCI.calculate({ high: highs, low: lows, close: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcMFI(highs, lows, closes, volumes, period = 14) {
  try {
    const result = ti.MFI.calculate({ high: highs, low: lows, close: closes, volume: volumes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcWilliamsR(highs, lows, closes, period = 14) {
  try {
    const result = ti.WilliamsR.calculate({ high: highs, low: lows, close: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcAwesomeOscillator(highs, lows) {
  try {
    const result = ti.AwesomeOscillator.calculate({ high: highs, low: lows });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcVWAP(highs, lows, closes, volumes) {
  try {
    const result = ti.VWAP.calculate({ high: highs, low: lows, close: closes, volume: volumes });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcVWAP2(klines) {
  try {
    let total = 0;
    let volumeTotal = 0;
    for (let i = Math.max(0, klines.length - 100); i < klines.length; i++) {
      const typicalPrice = (klines[i].high + klines[i].low + klines[i].close) / 3;
      total += typicalPrice * klines[i].volume;
      volumeTotal += klines[i].volume;
    }
    return volumeTotal > 0 ? total / volumeTotal : null;
  } catch { return null; }
}

function calcOBV(closes, volumes) {
  try {
    const result = ti.OBV.calculate({ close: closes, volume: volumes });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcADX(highs, lows, closes, period = 14) {
  try {
    const result = ti.ADX.calculate({ high: highs, low: lows, close: closes, period });
    return result[result.length - 1] || null;
  } catch { return null; }
}

function calcKeltner(highs, lows, closes, period = 20, multiplier = 2) {
  try {
    const ema = calcEMA(closes, period);
    const atr = calcATR(highs, lows, closes, period);
    if (ema && atr) {
      return {
        middle: ema,
        upper: ema + (multiplier * atr),
        lower: ema - (multiplier * atr)
      };
    }
    return null;
  } catch { return null; }
}

function calcDonchian(highs, lows, period = 20) {
  try {
    const recentHighs = highs.slice(-period);
    const recentLows = lows.slice(-period);
    return {
      upper: Math.max(...recentHighs),
      middle: (Math.max(...recentHighs) + Math.min(...recentLows)) / 2,
      lower: Math.min(...recentLows)
    };
  } catch { return null; }
}

function calcPivotPoints(highs, lows, closes) {
  const lastClose = closes[closes.length - 1];
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  
  const pp = (lastHigh + lastLow + lastClose) / 3;
  const r1 = (2 * pp) - lastLow;
  const s1 = (2 * pp) - lastHigh;
  const r2 = pp + (lastHigh - lastLow);
  const s2 = pp - (lastHigh - lastLow);
  const r3 = lastHigh + 2 * (pp - lastLow);
  const s3 = lastLow - 2 * (lastHigh - pp);
  
  return { pp, r1, r2, r3, s1, s2, s3 };
}

function findSupportResistance(klines, lookback = 50) {
  const recent = klines.slice(-lookback);
  const highs = recent.map(k => k.high);
  const lows = recent.map(k => k.low);
  
  const highsSorted = [...highs].sort((a, b) => b - a);
  const lowsSorted = [...lows].sort((a, b) => a - b);
  
  const resistance = highsSorted[0];
  const support = lowsSorted[0];
  
  const currentPrice = klines[klines.length - 1].close;
  
  return { support, resistance };
}

function calcIchimoku(klines) {
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const closes = klines.map(k => k.close);
  
  const period9 = 9;
  const period26 = 26;
  const period52 = 52;
  
  const highest9 = (arr) => Math.max(...arr.slice(-period9));
  const highest26 = (arr) => Math.max(...arr.slice(-period26));
  const highest52 = (arr) => Math.max(...arr.slice(-period52));
  const lowest9 = (arr) => Math.min(...arr.slice(-period9));
  const lowest26 = (arr) => Math.min(...arr.slice(-period26));
  const lowest52 = (arr) => Math.min(...arr.slice(-period52));
  
  const tenkan = (highest9(highs) + lowest9(lows)) / 2;
  const kijun = (highest26(highs) + lowest26(lows)) / 2;
  const senkouA = (tenkan + kijun) / 2;
  const senkouB = (highest52(highs) + lowest52(lows)) / 2;
  const chikou = closes[closes.length - 1];
  
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function detectCandlePatterns(klines, count = 5) {
  const recent = klines.slice(-count);
  const patterns = [];
  
  if (recent.length < 3) return patterns;
  
  // Bullish Engulfing
  if (recent[recent.length - 3].close < recent[recent.length - 3].open &&
      recent[recent.length - 1].close > recent[recent.length - 1].open &&
      recent[recent.length - 1].open < recent[recent.length - 3].close &&
      recent[recent.length - 1].close > recent[recent.length - 3].open) {
    patterns.push({ name: 'BULLISH_ENGULFING', strength: 3 });
  }
  
  // Bearish Engulfing
  if (recent[recent.length - 3].close > recent[recent.length - 3].open &&
      recent[recent.length - 1].close < recent[recent.length - 1].open &&
      recent[recent.length - 1].open > recent[recent.length - 3].close &&
      recent[recent.length - 1].close < recent[recent.length - 3].open) {
    patterns.push({ name: 'BEARISH_ENGULFING', strength: 3 });
  }
  
  // Doji
  for (let i = recent.length - 1; i >= recent.length - 2; i--) {
    const body = Math.abs(recent[i].close - recent[i].open);
    const range = recent[i].high - recent[i].low;
    if (range > 0 && body / range < 0.15) {
      patterns.push({ name: 'DOJI', strength: 1 });
      break;
    }
  }
  
  // Hammer / Inverted Hammer
  const last = recent[recent.length - 1];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  
  if (lowerWick > body * 2 && upperWick < body * 0.5) {
    patterns.push({ name: 'HAMMER', strength: 2 });
  }
  if (upperWick > body * 2 && lowerWick < body * 0.5) {
    patterns.push({ name: 'INVERTED_HAMMER', strength: 2 });
  }
  
  // Morning Star
  if (recent.length >= 4) {
    const first = recent[recent.length - 3];
    const second = recent[recent.length - 2];
    const third = recent[recent.length - 1];
    
    if (first.close < first.open && second.close < second.open &&
        Math.abs(second.close - second.open) < Math.abs(first.close - first.open) * 0.5 &&
        third.close > (first.open + first.close) / 2) {
      patterns.push({ name: 'MORNING_STAR', strength: 4 });
    }
  }
  
  // Shooting Star
  if (upperWick > body * 2 && lowerWick < body * 0.3) {
    patterns.push({ name: 'SHOOTING_STAR', strength: 2 });
  }
  
  // Three White Soldiers
  if (recent.length >= 3) {
    let soldiers = true;
    for (let i = recent.length - 3; i < recent.length; i++) {
      if (i > 0 && recent[i].close < recent[i-1].close) soldiers = false;
      if (recent[i].close - recent[i].open < (recent[i].high - recent[i].low) * 0.3) soldiers = false;
    }
    if (soldiers) patterns.push({ name: 'THREE_WHITE_SOLDIERS', strength: 4 });
  }
  
  // Three Black Crows
  if (recent.length >= 3) {
    let crows = true;
    for (let i = recent.length - 3; i < recent.length; i++) {
      if (i > 0 && recent[i].close > recent[i-1].close) crows = false;
      if (recent[i].open - recent[i].close < (recent[i].high - recent[i].low) * 0.3) crows = false;
    }
    if (crows) patterns.push({ name: 'THREE_BLACK_CROWS', strength: 4 });
  }
  
  return patterns;
}

function calculatePatternStrength(patterns) {
  if (!patterns || patterns.length === 0) return 0;
  return patterns.reduce((sum, p) => sum + p.strength, 0);
}

function calcMomentum(closes, period = 10) {
  if (closes.length < period) return 0;
  return closes[closes.length - 1] - closes[closes.length - period];
}

function calcROC(closes, period = 10) {
  if (closes.length < period) return 0;
  return ((closes[closes.length - 1] - closes[closes.length - period]) / closes[closes.length - period]) * 100;
}

function detectDivergence(klines, rsi) {
  if (!rsi || klines.length < 50) return null;
  
  const prices = klines.map(k => k.close);
  const priceChange = prices[prices.length - 1] - prices[prices.length - 20];
  
  // RSI divergence simplified
  if (priceChange > 0 && rsi < 50) return 'BULLISH_DIVERGENCE';
  if (priceChange < 0 && rsi > 50) return 'BEARISH_DIVERGENCE';
  
  return 'NONE';
}

function determineTrend(indicators) {
  const bullishSignals = [
    indicators.ema9Above21,
    indicators.ema21Above50,
    indicators.ema50Above200,
    indicators.adx > 20 && indicators.plusDI > indicators.minusDI,
    indicators.rsi14 > 50 && indicators.rsi14 < 70,
    indicators.macdHistogram > 0
  ].filter(Boolean).length;
  
  const bearishSignals = [
    !indicators.ema9Above21,
    !indicators.ema21Above50,
    !indicators.ema50Above200,
    indicators.adx > 20 && indicators.minusDI > indicators.plusDI,
    indicators.rsi14 < 50 && indicators.rsi14 > 30,
    indicators.macdHistogram < 0
  ].filter(Boolean).length;
  
  if (bullishSignals >= 4) return 'ALCISTA';
  if (bearishSignals >= 4) return 'BAJISTA';
  return 'LATERAL';
}

function calculateTrendStrength(indicators) {
  let strength = 0;
  const trend = indicators.trend;
  
  if (indicators.adx > 25) strength += 25;
  else if (indicators.adx > 15) strength += 10;
  
  if (trend === 'ALCISTA') {
    if (indicators.ema50Above200) strength += 25;
    if (indicators.macdHistogram > 0) strength += 20;
    if (indicators.rsi14 > 40 && indicators.rsi14 < 65) strength += 15;
    if (indicators.volumeRatio > 1.2) strength += 15;
  } else if (trend === 'BAJISTA') {
    if (indicators.ema50Above200 === false) strength += 25;
    if (indicators.macdHistogram < 0) strength += 20;
    if (indicators.rsi14 > 35 && indicators.rsi14 < 60) strength += 15;
    if (indicators.volumeRatio > 1.2) strength += 15;
  }
  
  return Math.min(100, strength);
}

function calcFibonacci(highs, lows) {
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const diff = max - min;
  
  return {
    level0: max,
    level236: max - (diff * 0.236),
    level382: max - (diff * 0.382),
    level500: max - (diff * 0.500),
    level618: max - (diff * 0.618),
    level786: max - (diff * 0.786),
    level100: min
  };
}

function calcPricePosition(klines) {
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const current = klines[klines.length - 1].close;
  
  const range = Math.max(...highs) - Math.min(...lows);
  const position = ((current - Math.min(...lows)) / range) * 100;
  
  if (position > 80) return 'OVERBOUGHT';
  if (position < 20) return 'OVERSOLD';
  return 'NEUTRAL';
}

function calcTimeframeSignal(klines, indicators) {
  const score = calculateSignalScore(indicators);
  if (score >= 60) return 'LONG';
  if (score <= -60) return 'SHORT';
  return 'NEUTRAL';
}

function calculateSignalScore(indicators) {
  let score = 0;
  
  // RSI
  if (indicators.rsi14 < 30) score += 20;
  else if (indicators.rsi14 > 70) score -= 20;
  else if (indicators.rsi14 < 40) score += 10;
  else if (indicators.rsi14 > 60) score -= 10;
  
  // MACD
  if (indicators.macdHistogram > 0) score += 15;
  else score -= 15;
  
  // EMAs
  if (indicators.ema9Above21) score += 15;
  else score -= 15;
  
  // ADX
  if (indicators.adx > 25) {
    if (indicators.plusDI > indicators.minusDI) score += 10;
    else score -= 10;
  }
  
  // Bollinger
  if (indicators.bbPosition < 20) score += 10;
  else if (indicators.bbPosition > 80) score -= 10;
  
  // Volume
  if (indicators.volumeRatio > 1.5) score += 5;
  
  // Stochastic
  if (indicators.stochK < 20) score += 10;
  else if (indicators.stochK > 80) score -= 10;
  
  return score;
}

function calculateConfluence(indicators) {
  const signals = [];
  
  if (indicators.rsi14) signals.push(indicators.rsi14 < 50 ? 'bullish' : 'bearish');
  if (indicators.macdHistogram) signals.push(indicators.macdHistogram > 0 ? 'bullish' : 'bearish');
  if (indicators.ema9Above21) signals.push('bullish');
  else signals.push('bearish');
  if (indicators.trend) signals.push(indicators.trend === 'ALCISTA' ? 'bullish' : 'bearish');
  
  const bullish = signals.filter(s => s === 'bullish').length;
  const total = signals.length;
  
  return Math.round((bullish / total) * 100);
}

function extractFeatures(indicators, price, marketData = {}) {
  const features = [];
  
  // Normalize and push features
  features.push((indicators.rsi14 - 50) / 50); // RSI normalized
  features.push((indicators.rsi50 - 50) / 50);
  features.push(indicators.macdHistogram / price); // MACD normalized
  features.push(indicators.ema9 / price - 1);
  features.push(indicators.ema21 / price - 1);
  features.push(indicators.ema50 / price - 1);
  features.push(indicators.ema200 ? indicators.ema200 / price - 1 : 0);
  features.push((indicators.bbUpper - price) / price);
  features.push((indicators.bbLower - price) / price);
  features.push(indicators.atr14 / price);
  features.push(indicators.stochK / 100);
  features.push(indicators.stochD / 100);
  features.push(indicators.adx / 100);
  features.push(indicators.plusDI / 100);
  features.push(indicators.minusDI / 100);
  features.push(indicators.mfi / 100);
  features.push(indicators.cci / 200);
  features.push(indicators.momentum / price);
  features.push(indicators.roc / 100);
  features.push(indicators.volumeRatio);
  features.push(indicators.vwap / price - 1);
  features.push(indicators.obv ? Math.log(Math.abs(indicators.obv)) / 20 : 0);
  features.push(indicators.trendStrength / 100);
  features.push(indicators.supportDistance / 100);
  features.push(indicators.resistanceDistance / 100);
  features.push(indicators.bbPosition / 100);
  features.push(indicators.patternStrength / 20);
  features.push(indicators.confluence / 100);
  
  // Market data features
  if (marketData.funding) features.push(marketData.funding.rate * 100);
  else features.push(0);
  
  if (marketData.longShort) features.push(marketData.longShort.longAccount);
  else features.push(0.5);
  
  if (marketData.openInterest) features.push(Math.log(marketData.openInterest.openInterest) / 20);
  else features.push(0);
  
  return features;
}

module.exports = { calculateAllIndicators };