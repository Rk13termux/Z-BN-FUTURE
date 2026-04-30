'use strict';

const fs = require('fs');
const path = require('path');

class TradingModel {
  constructor() {
    this.modelPath = path.join(__dirname, 'model.json');
    this.historyPath = path.join(__dirname, 'training_history.json');
    this.weights = this.loadWeights();
    this.bias = { long: 0, short: 0, neutral: 0 };
    this.isTrained = false;
    this.trainingData = [];
    this.minAccuracy = 0.6;
    this.loadTrainingHistory();
  }

  loadWeights() {
    try {
      if (fs.existsSync(this.modelPath)) {
        const data = fs.readFileSync(this.modelPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      console.log('[CEREBRO] Iniciando con pesos aleatorios');
    }
    return this.initializeRandomWeights();
  }

  loadTrainingHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        const data = fs.readFileSync(this.historyPath, 'utf8');
        this.history = JSON.parse(data);
      } else {
        this.history = [];
      }
    } catch (e) {
      this.history = [];
    }
  }

  initializeRandomWeights() {
    const weights = {};
    for (let i = 0; i < 30; i++) {
      weights[`w${i}`] = (Math.random() - 0.5) * 0.1;
    }
    return weights;
  }

  predict(features) {
    if (!this.isTrained || features.length !== 30) {
      return this.heuristicPrediction(features);
    }

    let longScore = this.bias.long;
    let shortScore = this.bias.short;
    let neutralScore = this.bias.neutral;

    for (let i = 0; i < Math.min(features.length, 30); i++) {
      const w = this.weights[`w${i}`] || 0;
      const f = features[i] || 0;
      
      longScore += w * f;
      shortScore -= w * f;
    }

    const total = Math.abs(longScore) + Math.abs(shortScore) + 0.5;
    const confidence = Math.min(Math.abs(longScore - shortScore) / total * 100, 95);

    if (longScore > shortScore && confidence > 30) {
      return { direction: 'LONG', confidence: Math.round(confidence), score: longScore };
    } else if (shortScore > longScore && confidence > 30) {
      return { direction: 'SHORT', confidence: Math.round(confidence), score: shortScore };
    }
    
    return { direction: 'NEUTRAL', confidence: 30, score: 0 };
  }

  heuristicPrediction(features) {
    let score = 0;
    const f = features;

    if (f[0] < -0.3) score += 25;
    else if (f[0] > 0.3) score -= 25;
    else if (f[0] < 0) score += 10;
    else score -= 10;

    if (f[2] > 0) score += 15;
    else score -= 15;

    if (f[3] > 0) score += 15;
    else score -= 15;

    if (f[4] > 0) score += 10;
    else score -= 10;

    if (f[6] > 0) score += 10;
    else score -= 10;

    if (f[7] < -0.02) score += 15;
    else if (f[7] > 0.02) score -= 15;

    if (f[10] < 0.2) score += 10;
    else if (f[10] > 0.8) score -= 10;

    if (f[21] > 0.5) score += 10;

    const confidence = Math.min(Math.abs(score), 80) + 20;

    if (score >= 20 && confidence >= 50) {
      return { direction: 'LONG', confidence, score };
    } else if (score <= -20 && confidence >= 50) {
      return { direction: 'SHORT', confidence, score };
    }
    
    return { direction: 'NEUTRAL', confidence: 30, score: 0 };
  }

  train(entryFeatures, actualDirection, outcome) {
    this.trainingData.push({
      features: entryFeatures,
      direction: actualDirection,
      outcome,
      timestamp: Date.now()
    });

    if (this.trainingData.length >= 10) {
      this.performTraining();
    }

    this.saveTrainingHistory();
  }

  performTraining() {
    if (this.trainingData.length < 10) return;

    const recentData = this.trainingData.slice(-100);
    const successCount = recentData.filter(d => d.outcome === 'WIN').length;
    const winRate = successCount / recentData.length;

    if (winRate >= this.minAccuracy || recentData.length >= 50) {
      this.updateWeights(recentData);
      this.isTrained = true;
      console.log(`[CEREBRO] Modelo entrenado - Win Rate: ${(winRate * 100).toFixed(1)}%`);
    }

    if (this.trainingData.length > 1000) {
      this.trainingData = this.trainingData.slice(-500);
    }
  }

  updateWeights(trainingData) {
    let longWins = 0, shortWins = 0, longLosses = 0, shortLosses = 0;

    trainingData.forEach(d => {
      if (d.direction === 'LONG' && d.outcome === 'WIN') longWins++;
      if (d.direction === 'LONG' && d.outcome === 'LOSS') longLosses++;
      if (d.direction === 'SHORT' && d.outcome === 'WIN') shortWins++;
      if (d.direction === 'SHORT' && d.outcome === 'LOSS') shortLosses++;
    });

    const longAccuracy = longWins / (longWins + longLosses + 0.01);
    const shortAccuracy = shortWins / (shortWins + shortLosses + 0.01);

    if (longAccuracy > 0.6) {
      this.bias.long += 0.01;
    } else if (longAccuracy < 0.4) {
      this.bias.long -= 0.01;
    }

    if (shortAccuracy > 0.6) {
      this.bias.short += 0.01;
    } else if (shortAccuracy < 0.4) {
      this.bias.short -= 0.01;
    }

    for (let i = 0; i < 30; i++) {
      const adjustment = (Math.random() - 0.5) * 0.001;
      this.weights[`w${i}`] = (this.weights[`w${i}`] || 0) + adjustment;
    }

    this.saveModel();
  }

  saveModel() {
    try {
      fs.writeFileSync(this.modelPath, JSON.stringify(this.weights));
    } catch (e) {
      console.error('[CEREBRO] Error guardando modelo:', e.message);
    }
  }

  saveTrainingHistory() {
    try {
      const summary = {
        totalTrades: this.trainingData.length,
        lastUpdate: Date.now(),
        recentWinRate: this.calculateRecentWinRate()
      };
      fs.writeFileSync(this.historyPath, JSON.stringify(summary));
    } catch (e) {
      console.error('[CEREBRO] Error guardando historial:', e.message);
    }
  }

  calculateRecentWinRate() {
    if (this.trainingData.length === 0) return 0;
    const recent = this.trainingData.slice(-50);
    const wins = recent.filter(d => d.outcome === 'WIN').length;
    return (wins / recent.length * 100).toFixed(1);
  }

  getStats() {
    const total = this.trainingData.length;
    if (total === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        isTrained: false,
        avgWin: 0,
        avgLoss: 0
      };
    }

    const wins = this.trainingData.filter(d => d.outcome === 'WIN').length;
    const winsData = this.trainingData.filter(d => d.outcome === 'WIN');
    const lossesData = this.trainingData.filter(d => d.outcome === 'LOSS');

    const avgWin = winsData.length > 0 
      ? winsData.reduce((sum, d) => sum + (d.profit || 0), 0) / winsData.length 
      : 0;
    const avgLoss = lossesData.length > 0 
      ? lossesData.reduce((sum, d) => sum + Math.abs(d.profit || 0), 0) / lossesData.length 
      : 0;

    return {
      totalTrades: total,
      winRate: (wins / total * 100).toFixed(1),
      isTrained: this.isTrained,
      avgWin: avgWin.toFixed(2),
      avgLoss: avgLoss.toFixed(2),
      profitFactor: avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : 0
    };
  }

  reset() {
    this.weights = this.initializeRandomWeights();
    this.bias = { long: 0, short: 0, neutral: 0 };
    this.isTrained = false;
    this.trainingData = [];
    this.saveModel();
    console.log('[CEREBRO] Modelo reiniciado');
  }
}

module.exports = new TradingModel();