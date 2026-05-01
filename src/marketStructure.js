'use strict';

function analyzeMarketStructure(klines) {
  if (!klines || klines.length < 20) return null;
  
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  
  const currentPrice = closes[closes.length - 1];
  const recentCloses = closes.slice(-10);
  const priceChange = ((currentPrice - recentCloses[0]) / recentCloses[0]) * 100;
  
  let trend = 'LATERAL';
  let trendStrength = 30;
  
  const emaUp = ema9 > ema21;
  const smaUp = sma20 > sma50;
  const priceAboveEma = currentPrice > ema21;
  const priceAboveSma = currentPrice > sma50;
  
  if (emaUp && smaUp && priceAboveEma && priceAboveSma && priceChange > 0) {
    trend = 'ALCISTA';
    trendStrength = Math.min(80, Math.max(50, 50 + priceChange * 2));
  } else if (!emaUp && !smaUp && !priceAboveEma && !priceAboveSma && priceChange < 0) {
    trend = 'BAJISTA';
    trendStrength = Math.min(80, Math.max(50, 50 + Math.abs(priceChange) * 2));
  } else if (Math.abs(priceChange) > 2) {
    trend = priceChange > 0 ? 'ALCISTA' : 'BAJISTA';
    trendStrength = Math.min(70, 40 + Math.abs(priceChange));
  }
  
  const swings = findSwings(klines);
  const supports = swings.filter(s => s.type === 'low').map(s => s.price).sort((a, b) => a - b);
  const resistances = swings.filter(s => s.type === 'high').map(s => s.price).sort((a, b) => b - a);
  
  const currentSupport = supports.reverse().find(s => s < currentPrice);
  const currentResistance = resistances.find(r => r > currentPrice);
  
  const distanceToSupport = currentSupport ? ((currentPrice - currentSupport) / currentPrice * 100).toFixed(2) : 'N/A';
  const distanceToResistance = currentResistance ? ((currentResistance - currentPrice) / currentPrice * 100).toFixed(2) : 'N/A';
  
  const volumeAvg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const lastVolume = volumes[volumes.length - 1];
  const volumeRatio = (lastVolume / volumeAvg);
  
  const momentum = calculateMomentum(klines);
  
  const consolidation = detectConsolidation(klines);
  
  return {
    trend,
    trendStrength: trendStrength.toFixed(0),
    price: currentPrice.toFixed(2),
    sma20: sma20.toFixed(2),
    sma50: sma50.toFixed(2),
    ema9: ema9.toFixed(2),
    ema21: ema21.toFixed(2),
    supports: supports.slice(0, 5),
    resistances: resistances.slice(0, 5),
    currentSupport: currentSupport ? currentSupport.toFixed(2) : null,
    currentResistance: currentResistance ? currentResistance.toFixed(2) : null,
    distanceToSupport,
    distanceToResistance,
    volumeRatio: volumeRatio.toFixed(2),
    volumeStatus: volumeRatio > 1.5 ? 'ALTO' : volumeRatio < 0.5 ? 'BAJO' : 'NORMAL',
    momentum,
    consolidation,
    recentSwings: swings.slice(0, 10)
  };
}

function calculateSMA(data, period) {
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function findSwings(klines, lookback = 20) {
  const swings = [];
  const recent = klines.slice(-lookback);
  
  for (let i = 2; i < recent.length - 2; i++) {
    const curr = recent[i];
    const prev = recent[i - 1];
    const next = recent[i + 1];
    const prev2 = recent[i - 2];
    const next2 = recent[i + 2];
    
    if (curr.low < prev.low && curr.low < next.low && curr.low < prev2.low && curr.low < next2.low) {
      swings.push({ type: 'low', price: curr.low, time: curr.openTime, index: i });
    }
    
    if (curr.high > prev.high && curr.high > next.high && curr.high > prev2.high && curr.high > next2.high) {
      swings.push({ type: 'high', price: curr.high, time: curr.openTime, index: i });
    }
  }
  
  return swings;
}

function calculateMomentum(klines) {
  const recent = klines.slice(-10);
  const closes = recent.map(k => k.close);
  
  const rsi14 = calculateRSI(closes, 14);
  const rsi50 = calculateRSI(closes, 50);
  
  const macd = calculateMACD(closes);
  
  const change = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
  
  let direction = 'NEUTRAL';
  let strength = 0;
  
  if (rsi14 > 60 && macd.histogram > 0 && change > 2) {
    direction = 'ALCISTA_FUERTE';
    strength = 90;
  } else if (rsi14 < 40 && macd.histogram < 0 && change < -2) {
    direction = 'BAJISTA_FUERTE';
    strength = 90;
  } else if (rsi14 > 50 && macd.histogram > 0) {
    direction = 'ALCISTA';
    strength = 60;
  } else if (rsi14 < 50 && macd.histogram < 0) {
    direction = 'BAJISTA';
    strength = 60;
  } else if (Math.abs(change) < 1) {
    direction = 'LATERAL';
    strength = 30;
  }
  
  return {
    direction,
    strength,
    rsi14: rsi14.toFixed(2),
    rsi50: rsi50.toFixed(2),
    macd: macd.macd.toFixed(4),
    macdSignal: macd.signal.toFixed(4),
    macdHistogram: macd.histogram.toFixed(4),
    change24h: change.toFixed(2)
  };
}

function calculateRSI(data, period = 14) {
  if (data.length < period) return 50;
  
  const changes = [];
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  
  const recentChanges = changes.slice(-period);
  const gains = recentChanges.filter(c => c > 0);
  const losses = recentChanges.filter(c => c < 0).map(c => Math.abs(c));
  
  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / period : 0;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(data) {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macdLine = ema12 - ema26;
  const signalLine = macdLine * 0.9 + (macdLine * 0.1);
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: macdLine - signalLine
  };
}

function detectConsolidation(klines) {
  const recent = klines.slice(-20);
  const highs = recent.map(k => k.high);
  const lows = recent.map(k => k.low);
  
  const range = Math.max(...highs) - Math.min(...lows);
  const avgPrice = (Math.max(...highs) + Math.min(...lows)) / 2;
  const rangePct = (range / avgPrice) * 100;
  
  const closes = recent.map(k => k.close);
  const closeRange = Math.max(...closes) - Math.min(...closes);
  
  if (rangePct < 2 && closeRange < range * 0.3) {
    return { status: 'CONSOLDACIÓN_ESTRECHA', range: rangePct.toFixed(2), breakoutLikely: true };
  } else if (rangePct < 4) {
    return { status: 'CONSOLDACIÓN_NORMAL', range: rangePct.toFixed(2), breakoutLikely: false };
  } else {
    return { status: 'NO_CONSOLIDACIÓN', range: rangePct.toFixed(2), breakoutLikely: false };
  }
}

module.exports = {
  analyzeMarketStructure,
  findSwings,
  calculateMomentum
};