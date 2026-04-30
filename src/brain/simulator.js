'use strict';

const fs = require('fs');
const path = require('path');

class Simulator {
  constructor() {
    this.balance = 10000;
    this.initialBalance = 10000;
    this.position = null;
    this.trades = [];
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      pendingTrades: 0,
      totalProfit: 0,
      maxDrawdown: 0,
      currentDrawdown: 0
    };
    this.config = {
      riskPerTrade: 2,
      maxDailyLoss: 5,
      takeProfitPercent: 2,
      stopLossPercent: 1,
      minConfidence: 60
    };
    this.dailyStats = this.loadDailyStats();
  }

  loadDailyStats() {
    const today = new Date().toDateString();
    const statsPath = path.join(__dirname, 'daily_stats.json');
    
    try {
      if (fs.existsSync(statsPath)) {
        const data = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        if (data.date === today) {
          return data;
        }
      }
    } catch (e) {}
    
    return {
      date: today,
      trades: 0,
      profit: 0,
      wins: 0,
      losses: 0
    };
  }

  saveDailyStats() {
    const statsPath = path.join(__dirname, 'daily_stats.json');
    try {
      fs.writeFileSync(statsPath, JSON.stringify(this.dailyStats));
    } catch (e) {}
  }

  canTrade(confidence) {
    if (this.position) {
      return { canTrade: false, reason: 'Posición abierta' };
    }

    if (this.dailyStats.profit <= -this.config.maxDailyLoss) {
      return { canTrade: false, reason: 'Límite de pérdida diaria alcanzado' };
    }

    if (confidence < this.config.minConfidence) {
      return { canTrade: false, reason: 'Confianza muy baja: ' + confidence + '%' };
    }

    return { canTrade: true };
  }

  openPosition(direction, entryPrice, confidence, signalData) {
    const canTrade = this.canTrade(confidence);
    if (!canTrade.canTrade) {
      return { success: false, reason: canTrade.reason };
    }

    const positionSize = (this.balance * this.config.riskPerTrade) / 100;
    const quantity = positionSize / entryPrice;
    
    this.position = {
      direction,
      entryPrice,
      quantity,
      entryTime: Date.now(),
      stopLoss: direction === 'LONG' 
        ? entryPrice * (1 - this.config.stopLossPercent / 100)
        : entryPrice * (1 + this.config.stopLossPercent / 100),
      takeProfit: direction === 'LONG'
        ? entryPrice * (1 + this.config.takeProfitPercent / 100)
        : entryPrice * (1 - this.config.takeProfitPercent / 100),
      confidence,
      signalData
    };

    this.stats.pendingTrades++;
    
    return {
      success: true,
      position: this.position,
      message: `Posición ${direction} abierta a $${entryPrice.toFixed(2)}`
    };
  }

  checkPosition(currentPrice) {
    if (!this.position) return null;

    const pnl = this.position.direction === 'LONG'
      ? (currentPrice - this.position.entryPrice) * this.position.quantity
      : (this.position.entryPrice - currentPrice) * this.position.quantity;

    const pnlPercent = (pnl / (this.position.entryPrice * this.position.quantity)) * 100;

    let status = 'OPEN';
    let outcome = null;

    if (this.position.direction === 'LONG') {
      if (currentPrice >= this.position.takeProfit) {
        status = 'WIN';
        outcome = 'WIN';
      } else if (currentPrice <= this.position.stopLoss) {
        status = 'LOSS';
        outcome = 'LOSS';
      }
    } else {
      if (currentPrice <= this.position.takeProfit) {
        status = 'WIN';
        outcome = 'WIN';
      } else if (currentPrice >= this.position.stopLoss) {
        status = 'LOSS';
        outcome = 'LOSS';
      }
    }

    if (outcome) {
      return this.closePosition(outcome, pnl, pnlPercent);
    }

    return {
      status: 'OPEN',
      pnl: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
      currentPrice
    };
  }

  closePosition(outcome, pnl, pnlPercent) {
    const trade = {
      id: this.trades.length + 1,
      direction: this.position.direction,
      entryPrice: this.position.entryPrice,
      exitPrice: this.position.direction === 'LONG' 
        ? this.position.takeProfit 
        : this.position.stopLoss,
      quantity: this.position.quantity,
      outcome,
      profit: pnl,
      profitPercent: pnlPercent,
      confidence: this.position.confidence,
      duration: Date.now() - this.position.entryTime,
      entryTime: new Date(this.position.entryTime).toISOString(),
      exitTime: new Date().toISOString(),
      signalData: this.position.signalData
    };

    this.trades.push(trade);
    this.balance += pnl;
    
    this.stats.totalTrades++;
    if (outcome === 'WIN') {
      this.stats.wins++;
      this.dailyStats.wins++;
    } else {
      this.stats.losses++;
      this.dailyStats.losses++;
    }

    this.stats.pendingTrades--;
    this.stats.totalProfit += pnl;
    this.dailyStats.trades++;
    this.dailyStats.profit += pnl;

    this.updateDrawdown();
    this.saveDailyStats();
    this.saveTradeHistory();

    const closedPosition = this.position;
    this.position = null;

    return {
      status: outcome,
      trade,
      balance: this.balance.toFixed(2),
      winRate: this.getWinRate()
    };
  }

  forceClose(reason = 'MANUAL') {
    if (!this.position) return null;

    const pnl = 0;
    const outcome = 'CANCEL';

    const trade = {
      id: this.trades.length + 1,
      direction: this.position.direction,
      entryPrice: this.position.entryPrice,
      exitPrice: null,
      quantity: this.position.quantity,
      outcome,
      profit: 0,
      profitPercent: 0,
      confidence: this.position.confidence,
      reason,
      duration: Date.now() - this.position.entryTime,
      entryTime: new Date(this.position.entryTime).toISOString(),
      exitTime: new Date().toISOString()
    };

    this.trades.push(trade);
    this.stats.pendingTrades--;
    this.position = null;

    return { trade, balance: this.balance.toFixed(2) };
  }

  updateDrawdown() {
    const drawdown = ((this.balance - this.initialBalance) / this.initialBalance) * 100;
    this.stats.currentDrawdown = drawdown;
    if (drawdown < this.stats.maxDrawdown) {
      this.stats.maxDrawdown = drawdown;
    }
  }

  saveTradeHistory() {
    const historyPath = path.join(__dirname, 'trade_history.json');
    const recentTrades = this.trades.slice(-100);
    try {
      fs.writeFileSync(historyPath, JSON.stringify(recentTrades, null, 2));
    } catch (e) {
      console.error('[CEREBRO] Error guardando historial:', e.message);
    }
  }

  getWinRate() {
    const total = this.stats.wins + this.stats.losses;
    if (total === 0) return 0;
    return ((this.stats.wins / total) * 100).toFixed(1);
  }

  getStats() {
    return {
      balance: this.balance.toFixed(2),
      initialBalance: this.initialBalance,
      totalProfit: this.stats.totalProfit.toFixed(2),
      profitPercent: ((this.stats.totalProfit / this.initialBalance) * 100).toFixed(2),
      totalTrades: this.stats.totalTrades,
      wins: this.stats.wins,
      losses: this.stats.losses,
      winRate: this.getWinRate(),
      maxDrawdown: this.stats.maxDrawdown.toFixed(2),
      currentDrawdown: this.stats.currentDrawdown.toFixed(2),
      pendingPositions: this.stats.pendingTrades,
      dailyProfit: this.dailyStats.profit.toFixed(2),
      dailyTrades: this.dailyStats.trades
    };
  }

  getStatus() {
    return {
      hasPosition: this.position !== null,
      position: this.position ? {
        direction: this.position.direction,
        entryPrice: this.position.entryPrice.toFixed(2),
        stopLoss: this.position.stopLoss.toFixed(2),
        takeProfit: this.position.takeProfit.toFixed(2),
        confidence: this.position.confidence,
        timeOpen: Math.floor((Date.now() - this.position.entryTime) / 1000 / 60)
      } : null,
      balance: this.balance.toFixed(2),
      dailyProfit: this.dailyStats.profit.toFixed(2)
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  resetStats() {
    this.balance = this.initialBalance;
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      pendingTrades: 0,
      totalProfit: 0,
      maxDrawdown: 0,
      currentDrawdown: 0
    };
    this.dailyStats = {
      date: new Date().toDateString(),
      trades: 0,
      profit: 0,
      wins: 0,
      losses: 0
    };
    this.position = null;
    this.saveDailyStats();
    console.log('[CEREBRO] Estadísticas del simulador reiniciadas');
  }

  getRecentTrades(count = 20) {
    return this.trades.slice(-count).reverse();
  }
}

module.exports = new Simulator();