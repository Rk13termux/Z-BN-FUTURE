'use strict';

function generateSignal(marketData, indicators, volatility) {
  if (!marketData || !indicators) {
    return { direction: 'WAIT', confidence: 0, reason: 'Sin datos suficientes' };
  }
  
  let score = 0;
  let reasons = [];
  let risks = [];
  
  const rsi = parseFloat(indicators.rsi);
  const ema9 = parseFloat(indicators.emas?.ema9);
  const ema21 = parseFloat(indicators.emas?.ema21);
  const ema50 = parseFloat(indicators.emas?.ema50);
  const macdHist = parseFloat(indicators.macd?.histogram);
  const stochK = parseFloat(indicators.stoch?.k);
  const price = parseFloat(marketData.price);
  
  if (marketData.momentum?.direction) {
    if (marketData.momentum.direction.includes('ALCISTA')) {
      score += 20;
      reasons.push('Momentum alza detectado');
    } else if (marketData.momentum.direction.includes('BAJISTA')) {
      score -= 20;
      reasons.push('Momentum a la baja');
    }
  }
  
  if (rsi < 30) {
    score += 25;
    reasons.push('RSI en zona de sobreventa (' + rsi + ')');
  } else if (rsi < 40) {
    score += 10;
    reasons.push('RSI cerca de zona de sobrevenda');
  } else if (rsi > 70) {
    score -= 25;
    reasons.push('RSI en zona de sobrecompra (' + rsi + ')');
    risks.push('Posible reversión de sobrecompra');
  } else if (rsi > 60) {
    score -= 10;
    reasons.push('RSI en zona de sobrecompra');
  }
  
  if (ema9 > ema21) {
    score += 15;
    reasons.push('EMA 9 sopra EMA 21 (alcista)');
  } else if (ema9 < ema21) {
    score -= 10;
    reasons.push('EMA 9 bajo EMA 21 (bajista)');
  }
  
  if (ema21 > ema50) {
    score += 10;
    reasons.push('EMA 21 sopra EMA 50');
  } else if (ema21 < ema50) {
    score -= 5;
  }
  
  if (macdHist > 0) {
    score += 15;
    reasons.push('MACD positivo (momentum alza)');
  } else if (macdHist < 0) {
    score -= 10;
    reasons.push('MACD negativo (momentum baja)');
  } else if (macdHist < 0) {
    score -= 15;
    reasons.push('MACD negativo (momentum baja)');
  }
  
  if (stochK < 20) {
    score += 10;
    reasons.push('Estocástico sobrevendido');
  } else if (stochK > 80) {
    score -= 10;
    reasons.push('Estocástico sobrecomprado');
    risks.push('Estocástico en extremos');
  }
  
  if (marketData.trend === 'ALCISTA') {
    score += 12;
    reasons.push('Tendencia 4h alcista');
  } else if (marketData.trend === 'BAJISTA') {
    score -= 12;
    reasons.push('Tendencia 4h bajista');
  }
  
  if (marketData.trend15m === 'ALCISTA') {
    score += 8;
    reasons.push('Tendencia 15m alcista');
  } else if (marketData.trend15m === 'BAJISTA') {
    score -= 8;
    reasons.push('Tendencia 15m bajista');
  }
  
  if (price && indicators.price) {
    const priceChange = ((price - parseFloat(indicators.price)) / parseFloat(indicators.price)) * 100;
    if (priceChange > 0.5) {
      score += 10;
      reasons.push('Precio subiendo (+' + priceChange.toFixed(2) + '%)');
    } else if (priceChange < -0.5) {
      score -= 10;
      reasons.push('Precio bajando (' + priceChange.toFixed(2) + '%)');
    }
  }
  
  if (parseFloat(marketData.volumeRatio) > 2) {
    score += 10;
    reasons.push('Volumen alto (' + marketData.volumeRatio + 'x promedio)');
  } else if (parseFloat(marketData.volumeRatio) < 0.5) {
    score -= 5;
    risks.push('Volumen bajo');
  }
  
  if (volatility?.volatilityTrend === 'EXTREMA') {
    score -= 20;
    risks.push('Volatilidad extrema - alto riesgo');
  } else if (volatility?.volatilityTrend === 'ELEVADA') {
    score -= 10;
    risks.push('Volatilidad elevada');
  }
  
  if (marketData.consolidation?.breakoutLikely) {
    reasons.push('Mercado en consolidación - posible breakout');
  }
  
  let direction = 'NEUTRAL';
  let confidence = Math.abs(score);
  
  if (score >= 15) {
    direction = 'LONG';
  } else if (score <= -15) {
    direction = 'SHORT';
  }
  
  if (marketData.trend === 'BAJISTA' && direction === 'LONG') {
    direction = 'NEUTRAL';
    reasons.push('Tendencia 4h bajista - precaución');
  }
  
  if (marketData.trend === 'ALCISTA' && direction === 'SHORT') {
    direction = 'NEUTRAL';
    reasons.push('Tendencia 4h alcista - precaución');
  }
  
  if (marketData.trend15m === 'BAJISTA' && direction === 'LONG') {
    direction = 'NEUTRAL';
    reasons.push('Contra tendencia 15m');
  } else if (marketData.trend15m === 'ALCISTA' && direction === 'SHORT') {
    direction = 'NEUTRAL';
    reasons.push('Contra tendencia 15m');
  }
  
  console.log(`[SIGNALS] Score: ${score}, Direction: ${direction}, Confidence: ${confidence}`);
  
  const riskReward = calculateRiskReward(marketData, direction, price, indicators);
  
  return {
    direction,
    confidence: Math.min(confidence, 95).toFixed(0),
    score,
    reasons,
    risks,
    entry: price ? price.toFixed(2) : '0',
    stopLoss: riskReward.stopLoss || '0',
    takeProfit1: riskReward.takeProfit1 || '0',
    takeProfit2: riskReward.takeProfit2 || '0',
    riskReward: riskReward.ratio || '0',
    timeframe: determineTimeframe(marketData, indicators),
    strategy: generateStrategyName(direction, marketData, indicators),
    marketConditions: {
      trend: marketData.trend,
      volatility: volatility?.volatilityTrend || 'NORMAL',
      momentum: marketData.momentum?.direction || 'NEUTRAL',
      volume: marketData.volumeStatus
    }
  };
}

function calculateRiskReward(marketData, direction, price, indicators) {
  const atr = parseFloat(indicators.atr) || price * 0.02;
  
  let stopLoss, takeProfit1, takeProfit2, ratio;
  
  if (direction === 'LONG') {
    stopLoss = (price - (atr * 2)).toFixed(2);
    takeProfit1 = (price + (atr * 4)).toFixed(2);
    takeProfit2 = (price + (atr * 6)).toFixed(2);
  } else if (direction === 'SHORT') {
    stopLoss = (price + (atr * 2)).toFixed(2);
    takeProfit1 = (price - (atr * 4)).toFixed(2);
    takeProfit2 = (price - (atr * 6)).toFixed(2);
  } else {
    stopLoss = (price * 0.99).toFixed(2);
    takeProfit1 = (price * 1.02).toFixed(2);
    takeProfit2 = (price * 1.04).toFixed(2);
  }
  
  const risk = Math.abs(price - stopLoss);
  const reward1 = Math.abs(takeProfit1 - price);
  const reward2 = Math.abs(takeProfit2 - price);
  
  ratio = (reward1 / risk).toFixed(1);
  
  return {
    stopLoss,
    takeProfit1,
    takeProfit2,
    ratio
  };
}

function determineTimeframe(marketData, indicators) {
  const rsi = parseFloat(indicators.rsi);
  const volatility = parseFloat(indicators.atr);
  
  if (rsi < 30 || rsi > 70 || volatility > 200) {
    return '15m';
  } else if (marketData.trend === 'LATERAL') {
    return '1H';
  } else {
    return '4H';
  }
}

function generateStrategyName(direction, marketData, indicators) {
  const rsi = parseFloat(indicators.rsi);
  const macdHist = parseFloat(indicators.macd?.histogram);
  const trend = marketData.trend;
  
  if (direction === 'LONG') {
    if (rsi < 30 && macdHist > 0) return 'REVERSAL ALCISTA';
    if (trend === 'ALCISTA' && rsi > 50) return 'CONTINUACIÓN ALCISTA';
    if (marketData.consolidation?.breakoutLikely) return 'BREAKOUT ALCISTA';
    return 'MOMENTUM ALCISTA';
  } else if (direction === 'SHORT') {
    if (rsi > 70 && macdHist < 0) return 'REVERSAL BAJISTA';
    if (trend === 'BAJISTA' && rsi < 50) return 'CONTINUACIÓN BAJISTA';
    if (marketData.consolidation?.breakoutLikely) return 'BREAKOUT BAJISTA';
    return 'MOMENTUM BAJISTA';
  }
  
  return 'ESPERA';
}

module.exports = {
  generateSignal,
  calculateRiskReward,
  determineTimeframe,
  generateStrategyName
};