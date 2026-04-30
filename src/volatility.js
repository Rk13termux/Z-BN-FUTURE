'use strict';

function analyzeVolatility(klines, days = 30) {
  if (!klines || klines.length === 0) return null;
  
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const startTime = now - (days * dayMs);
  
  const dailyData = {};
  
  klines.forEach(k => {
    const date = new Date(k.openTime);
    const dayKey = date.toISOString().split('T')[0];
    
    if (!dailyData[dayKey]) {
      dailyData[dayKey] = {
        date: dayKey,
        open: k.open,
        close: k.close,
        high: k.high,
        low: k.low,
        volume: k.volume,
        candles: [],
        highTime: k.openTime,
        lowTime: k.openTime
      };
    }
    
    const day = dailyData[dayKey];
    day.high = Math.max(day.high, k.high);
    day.low = Math.min(day.low, k.low);
    day.close = k.close;
    day.volume += k.volume;
    day.candles.push(k);
    
    if (k.high === day.high) day.highTime = k.openTime;
    if (k.low === day.low) day.lowTime = k.openTime;
  });
  
  const dayArray = Object.values(dailyData).filter(d => new Date(d.date).getTime() > startTime);
  
  const volatilities = dayArray.map(d => {
    const range = d.high - d.low;
    const avgPrice = (d.high + d.low) / 2;
    const volatilityPct = (range / avgPrice) * 100;
    const direction = d.close >= d.open ? 'UP' : 'DOWN';
    const bodySize = Math.abs(d.close - d.open);
    const bodyPct = (bodySize / range) * 100;
    
    return {
      date: d.date,
      volatility: volatilityPct,
      direction,
      range,
      bodyPct,
      volume: d.volume,
      highTime: d.highTime,
      lowTime: d.lowTime,
      open: d.open,
      close: d.close,
      high: d.high,
      low: d.low
    };
  });
  
  volatilities.sort((a, b) => b.volatility - a.volatility);
  
  const avgVolatility = volatilities.reduce((sum, v) => sum + v.volatility, 0) / volatilities.length;
  
  const hourlyData = {};
  klines.forEach(k => {
    const hour = new Date(k.openTime).getHours();
    if (!hourlyData[hour]) {
      hourlyData[hour] = { hour, volumes: [], ranges: [] };
    }
    hourlyData[hour].volumes.push(k.volume);
    hourlyData[hour].ranges.push(Math.abs(k.close - k.open));
  });
  
  const hourlyVolatility = Object.values(hourlyData).map(h => ({
    hour: h.hour,
    avgVolume: h.volumes.reduce((a, b) => a + b, 0) / h.volumes.length,
    avgRange: h.ranges.reduce((a, b) => a + b, 0) / h.ranges.length
  })).sort((a, b) => b.avgVolume - a.avgVolume);
  
  const dayOfWeekData = {};
  volatilities.forEach(v => {
    const dayOfWeek = new Date(v.date).getDay();
    if (!dayOfWeekData[dayOfWeek]) {
      dayOfWeekData[dayOfWeek] = { day: dayOfWeek, volatilities: [], volumes: [] };
    }
    dayOfWeekData[dayOfWeek].volatilities.push(v.volatility);
    dayOfWeekData[dayOfWeek].volumes.push(v.volume);
  });
  
  const dayOfWeekAvg = Object.values(dayOfWeekData).map(d => ({
    day: d.day,
    avgVolatility: d.volatilities.reduce((a, b) => a + b, 0) / d.volatilities.length,
    avgVolume: d.volumes.reduce((a, b) => a + b, 0) / d.volumes.length
  })).sort((a, b) => b.avgVolatility - a.avgVolatility);
  
  const daysName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  
  return {
    totalDays: volatilities.length,
    avgVolatility: avgVolatility.toFixed(2),
    mostVolatileDays: volatilities.slice(0, 10),
    leastVolatileDays: volatilities.slice(-5),
    highestVolumeHour: hourlyVolatility[0],
    peakHours: hourlyVolatility.slice(0, 5),
    quietHours: hourlyVolatility.slice(-3),
    bestDayToTrade: dayOfWeekAvg[0] ? daysName[dayOfWeekAvg[0].day] : 'N/A',
    worstDayToTrade: dayOfWeekAvg[dayOfWeekAvg.length - 1] ? daysName[dayOfWeekAvg[dayOfWeekAvg.length - 1].day] : 'N/A',
    daysByVolatility: dayOfWeekAvg.map(d => ({
      day: daysName[d.day],
      avgVolatility: d.avgVolatility.toFixed(2),
      avgVolume: d.avgVolume.toFixed(0)
    })),
    lastDay: volatilities[volatilities.length - 1],
    todayVolatility: volatilities[volatilities.length - 1]?.volatility || 0,
    volatilityTrend: volatilities[volatilities.length - 1]?.volatility > avgVolatility ? 'ALTA' : 'BAJA'
  };
}

function detectVolatilityPattern(volatilityData) {
  if (!volatilityData) return { pattern: 'N/A', description: 'Sin datos suficientes' };
  
  const { todayVolatility, avgVolatility, volatilityTrend } = volatilityData;
  const diff = todayVolatility - avgVolatility;
  const diffPct = (diff / avgVolatility) * 100;
  
  if (Math.abs(diffPct) < 10) {
    return {
      pattern: 'NORMAL',
      description: 'Volatilidad dentro del promedio',
      recommendation: 'Operar con estrategia estándar'
    };
  } else if (diffPct > 10 && diffPct < 50) {
    return {
      pattern: 'ELEVADA',
      description: `Volatilidad ${diffPct.toFixed(0)}% por encima del promedio`,
      recommendation: 'Ajustar SL más amplio, menor tamaño de posición'
    };
  } else if (diffPct >= 50) {
    return {
      pattern: 'EXTREMA',
      description: `Volatilidad ${diffPct.toFixed(0)}% muy por encima del promedio`,
      recommendation: 'Evitar operaciones, esperar normalización'
    };
  } else if (diffPct < -10 && diffPct > -30) {
    return {
      pattern: 'BAJA',
      description: `Volatilidad ${Math.abs(diffPct).toFixed(0)}% por debajo del promedio`,
      recommendation: 'Buscar breakout lateral, posible movimiento fuerte próximo'
    };
  } else {
    return {
      pattern: 'MUY_BAJA',
      description: 'Mercado muy silencioso',
      recommendation: 'Esperar, posible explosión de volatilidad pronto'
    };
  }
}

function predictNextDayVolatility(volatilityData) {
  if (!volatilityData || volatilityData.totalDays < 7) {
    return { prediction: 'N/A', confidence: 0 };
  }
  
  const recent = volatilityData.mostVolatileDays.slice(0, 5);
  const avgRecent = recent.reduce((sum, v) => sum + v.volatility, 0) / recent.length;
  
  const trend = avgRecent > parseFloat(volatilityData.avgVolatility) ? 'AUMENTANDO' : 'DISMINUYENDO';
  
  const confidence = Math.min(90, 50 + (volatilityData.totalDays / 2));
  
  return {
    prediction: trend,
    expectedVolatility: avgRecent.toFixed(2),
    confidence: confidence.toFixed(0),
    recommendation: trend === 'AUMENTANDO' ? 'Prepararse para más movimiento' : 'Mercado estabilizándose'
  };
}

module.exports = {
  analyzeVolatility,
  detectVolatilityPattern,
  predictNextDayVolatility
};