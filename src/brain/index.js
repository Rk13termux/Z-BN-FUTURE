'use strict';

const dataCollector = require('./dataCollector');
const { calculateAllIndicators } = require('./advancedIndicators');
const mlModel = require('./mlModel');
const simulator = require('./simulator');

class TradingBrain {
  constructor() {
    this.isRunning = false;
    this.symbol = 'BTCUSDT';
    this.listeners = [];
    this.updateInterval = null;
  }

  async start(symbol = 'BTCUSDT') {
    if (this.isRunning) {
      console.log('[CEREBRO] Ya está en ejecución');
      return;
    }

    this.symbol = symbol;
    this.isRunning = true;
    
    console.log(`[CEREBRO] Iniciando cerebro de trading para ${symbol}...`);
    
    await dataCollector.start(symbol);
    
    this.updateInterval = setInterval(() => {
      this.processData();
    }, 5000);
    
    console.log('[CEREBRO] Cerebro activo y aprendiendo...');
  }

  stop() {
    this.isRunning = false;
    dataCollector.stop();
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    console.log('[CEREBRO] Cerebro detenido');
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  processData() {
    if (!this.isRunning) return;

    const marketData = dataCollector.getLatestData();
    const klines1m = marketData.klines['1m'];
    const klines5m = marketData.klines['5m'];
    const klines15m = marketData.klines['15m'];
    const klines1h = marketData.klines['1h'];

    if (!klines1m || klines1m.length < 100) {
      return;
    }

    const analysis1m = calculateAllIndicators(klines1m, marketData.orderBook, {
      funding: marketData.funding,
      longShort: marketData.longShort,
      openInterest: marketData.openInterest
    });

    let multiTfAnalysis = null;
    if (klines5m && klines5m.length > 100) {
      multiTfAnalysis = {
        '5m': calculateAllIndicators(klines5m)
      };
    }
    if (klines15m && klines15m.length > 100) {
      multiTfAnalysis = multiTfAnalysis || {};
      multiTfAnalysis['15m'] = calculateAllIndicators(klines15m);
    }
    if (klines1h && klines1h.length > 100) {
      multiTfAnalysis = multiTfAnalysis || {};
      multiTfAnalysis['1h'] = calculateAllIndicators(klines1h);
    }

    const prediction = mlModel.predict(analysis1m.features);
    
    const signal = this.generateSignal(analysis1m, multiTfAnalysis, prediction, marketData);

    const marketInfo = {
      symbol: this.symbol,
      price: marketData.price,
      volume: marketData.volume,
      funding: marketData.funding?.rate,
      longShort: marketData.longShort?.longAccount,
      openInterest: marketData.openInterest?.openInterest,
      timestamp: Date.now()
    };

    const brainData = {
      signal,
      analysis: analysis1m,
      multiTimeframe: multiTfAnalysis,
      prediction,
      marketInfo,
      simulatorStatus: simulator.getStatus(),
      brainStats: mlModel.getStats(),
      timestamp: new Date().toISOString()
    };

    this.checkAndTrade(brainData);

    this.listeners.forEach(cb => cb(brainData));
  }

  generateSignal(analysis, multiTf, prediction, marketData) {
    const ind = analysis.indicators;
    
    let score = 0;
    let reasons = [];
    let risks = [];

    if (ind.rsi14 < 30) {
      score += 20;
      reasons.push('RSI sobrevendido: ' + ind.rsi14.toFixed(1));
    } else if (ind.rsi14 > 70) {
      score -= 20;
      risks.push('RSI sobrecomprado: ' + ind.rsi14.toFixed(1));
    }

    if (ind.macdHistogram > 0) {
      score += 15;
      reasons.push('MACD positivo');
    } else {
      score -= 15;
      reasons.push('MACD negativo');
    }

    if (ind.ema9Above21) {
      score += 15;
      reasons.push('EMA 9/21 alineados al alza');
    } else {
      score -= 15;
      reasons.push('EMA 9/21 alineados a la baja');
    }

    if (ind.adx > 25) {
      score += 10;
      reasons.push('Fuerte tendencia (ADX: ' + ind.adx.toFixed(1) + ')');
    } else if (ind.adx < 15) {
      score -= 10;
      risks.push('Mercado sin tendencia');
    }

    if (ind.bbPosition < 20) {
      score += 10;
      reasons.push('Precio cerca de banda inferior BB');
    } else if (ind.bbPosition > 80) {
      score -= 10;
      risks.push('Precio cerca de banda superior BB');
    }

    if (ind.volumeRatio > 1.5) {
      score += 10;
      reasons.push('Volumen alto: ' + ind.volumeRatio.toFixed(1) + 'x');
    } else if (ind.volumeRatio < 0.5) {
      score -= 5;
      risks.push('Volumen bajo');
    }

    if (ind.stochK < 20) {
      score += 10;
      reasons.push('Estocástico sobrevendido');
    } else if (ind.stochK > 80) {
      score -= 10;
      risks.push('Estocástico sobrecomprado');
    }

    if (ind.trend === 'ALCISTA') {
      score += 15;
      reasons.push('Tendencia general ALCISTA');
    } else if (ind.trend === 'BAJISTA') {
      score -= 15;
      risks.push('Tendencia general BAJISTA');
    }

    if (ind.patternStrength >= 4) {
      score += 10;
      reasons.push('Patrón vela fuerte detectado');
    }

    if (marketData.funding?.rate) {
      const funding = marketData.funding.rate * 100;
      if (funding > 0.01) {
        score -= 5;
        risks.push('Funding alto: ' + funding.toFixed(3) + '%');
      }
    }

    if (marketData.longShort) {
      const ls = marketData.longShort.longAccount;
      if (ls > 0.6) {
        score += 5;
        reasons.push('L/S ratio sesgado a LARGO');
      } else if (ls < 0.4) {
        score -= 5;
        reasons.push('L/S ratio sesgado a CORTO');
      }
    }

    const mlBonus = prediction.direction === 'LONG' ? prediction.score / 10 : 
                    prediction.direction === 'SHORT' ? -prediction.score / 10 : 0;
    score += mlBonus;

    const confidence = Math.min(Math.abs(score) + 30, 95);
    let direction = 'NEUTRAL';
    
    if (score >= 30 && confidence >= 50) direction = 'LONG';
    else if (score <= -30 && confidence >= 50) direction = 'SHORT';

    let strategy = 'SEGUIR_TENDENCIA';
    if (ind.rsi14 < 30 && direction === 'LONG') strategy = 'REVERSAL_ALCISTA';
    else if (ind.rsi14 > 70 && direction === 'SHORT') strategy = 'REVERSAL_BAJISTA';
    else if (ind.adx > 30 && direction === 'LONG') strategy = 'MOMENTUM_ALCISTA';
    else if (ind.adx < 15) strategy = 'RANGO';

    const currentPrice = analysis.price;
    const atr = ind.atr14 || currentPrice * 0.02;
    
    const stopLoss = direction === 'LONG' 
      ? currentPrice - (atr * 2)
      : currentPrice + (atr * 2);
    
    const takeProfit = direction === 'LONG'
      ? currentPrice + (atr * 4)
      : currentPrice - (atr * 4);

    const riskReward = Math.abs((takeProfit - currentPrice) / (currentPrice - stopLoss));

    return {
      direction,
      confidence: Math.round(confidence),
      score,
      reasons,
      risks,
      strategy,
      entry: currentPrice.toFixed(2),
      stopLoss: stopLoss.toFixed(2),
      takeProfit: takeProfit.toFixed(2),
      riskReward: riskReward.toFixed(1),
      timeframe: '1m',
      indicators: {
        rsi: ind.rsi14?.toFixed(2),
        macd: ind.macdHistogram?.toFixed(4),
        trend: ind.trend,
        adx: ind.adx?.toFixed(2),
        volume: ind.volumeRatio?.toFixed(2)
      }
    };
  }

  checkAndTrade(brainData) {
    const { signal, analysis } = brainData;
    
    const canTrade = simulator.canTrade(signal.confidence);
    if (!canTrade.canTrade) return;

    if (signal.direction === 'LONG' || signal.direction === 'SHORT') {
      const result = simulator.openPosition(
        signal.direction,
        parseFloat(signal.entry),
        signal.confidence,
        signal
      );

      if (result.success) {
        console.log(`[CEREBRO] Nueva posición: ${signal.direction} en ${signal.entry}`);
        
        setTimeout(() => {
          this.checkSimulatedPosition();
        }, 60000);
      }
    }
  }

  checkSimulatedPosition() {
    const status = simulator.getStatus();
    if (!status.hasPosition) return;

    const marketData = dataCollector.getLatestData();
    const currentPrice = marketData.price;
    
    if (currentPrice > 0) {
      simulator.checkPosition(currentPrice);
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      symbol: this.symbol,
      dataCollection: dataCollector.isRunning,
      marketData: dataCollector.getLatestData(),
      simulator: simulator.getStatus(),
      brainStats: mlModel.getStats()
    };
  }

  getAnalysis() {
    const marketData = dataCollector.getLatestData();
    const klines = marketData.klines['1m'];
    
    if (!klines || klines.length < 100) {
      return { error: 'Datos insuficientes' };
    }

    const analysis = calculateAllIndicators(klines, marketData.orderBook, {
      funding: marketData.funding,
      longShort: marketData.longShort,
      openInterest: marketData.openInterest
    });

    const prediction = mlModel.predict(analysis.features);
    const signal = this.generateSignal(analysis, null, prediction, marketData);

    return {
      signal,
      indicators: analysis.indicators,
      prediction,
      marketInfo: {
        price: marketData.price,
        volume: marketData.volume,
        funding: marketData.funding?.rate,
        longShort: marketData.longShort?.longAccount,
        openInterest: marketData.openInterest?.openInterest
      }
    };
  }

  changeSymbol(symbol) {
    this.symbol = symbol;
    console.log(`[CEREBRO] Cambiando a ${symbol}...`);
    dataCollector.stop();
    dataCollector.start(symbol);
  }

  getSimulatorStats() {
    return simulator.getStats();
  }

  getSimulatorTrades(count = 20) {
    return simulator.getRecentTrades(count);
  }

  resetBrain() {
    mlModel.reset();
    simulator.resetStats();
    console.log('[CEREBRO] Cerebro reiniciado completamente');
  }

  updateSimulatorConfig(config) {
    simulator.updateConfig(config);
  }
}

module.exports = new TradingBrain();