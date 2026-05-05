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
      riskPerTrade: 1,
      maxDailyLoss: 5,
      takeProfitPercent: 2,
      stopLossPercent: 1,
      minConfidence: 60,
      maxRiskPercent: 1,
      useSmartSL: true,
      useTrailingStop: true,
      trailingActivationPercent: 1,
      trailingDistancePercent: 0.5
    };
    this.dailyStats = this.loadDailyStats();
  }

  calculatePositionSize(entryPrice, sellWallPrice, balance, direction) {
    const maxRiskAmount = balance * (this.config.maxRiskPercent / 100);
    
    let stopLoss;
    if (this.config.useSmartSL && sellWallPrice) {
      if (direction === 'SHORT') {
        stopLoss = sellWallPrice * 1.002;
        console.log(`[SIMULATOR] 📍 SL basado en Sell Wall: $${stopLoss.toFixed(2)} (0.2% sobre wall)`);
      } else {
        stopLoss = sellWallPrice * 0.998;
        console.log(`[SIMULATOR] 📍 SL basado en Buy Wall: $${stopLoss.toFixed(2)} (0.2% bajo wall)`);
      }
    } else {
      const riskPercent = this.config.stopLossPercent / 100;
      if (direction === 'SHORT') {
        stopLoss = entryPrice * (1 + riskPercent);
      } else {
        stopLoss = entryPrice * (1 - riskPercent);
      }
    }
    
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    
    if (riskPerUnit === 0) {
      console.log(`[SIMULATOR] ⚠ Riesgo por unidad es 0, usando riesgo fijo del 1%`);
      return {
        size: maxRiskAmount / entryPrice,
        stopLoss: stopLoss,
        riskAmount: maxRiskAmount,
        riskPercent: 1
      };
    }
    
    const positionSize = maxRiskAmount / riskPerUnit;
    const actualRisk = positionSize * riskPerUnit;
    const actualRiskPercent = (actualRisk / balance) * 100;
    
    console.log(`[SIMULATOR] 💰 Position Size: ${positionSize.toFixed(4)} | SL: $${stopLoss.toFixed(2)} | Riesgo: $${actualRisk.toFixed(2)} (${actualRiskPercent.toFixed(2)}%)`);
    
    return {
      size: positionSize,
      stopLoss: stopLoss,
      riskAmount: actualRisk,
      riskPercent: actualRiskPercent,
      entryPrice: entryPrice,
      sellWallPrice: sellWallPrice
    };
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
      signalData,
      trailingStopActive: false,
      trailingStopPrice: null,
      initialStopLoss: direction === 'LONG' 
        ? entryPrice * (1 - this.config.stopLossPercent / 100)
        : entryPrice * (1 + this.config.stopLossPercent / 100)
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
    const entryPrice = this.position.entryPrice;
    const activationPercent = this.config.trailingActivationPercent;
    const distancePercent = this.config.trailingDistancePercent;

    if (this.config.useTrailingStop && !this.position.trailingStopActive) {
      const profitPercent = this.position.direction === 'LONG' 
        ? ((currentPrice - entryPrice) / entryPrice) * 100
        : ((entryPrice - currentPrice) / entryPrice) * 100;
      
      if (profitPercent >= activationPercent) {
        this.position.trailingStopActive = true;
        if (this.position.direction === 'LONG') {
          this.position.trailingStopPrice = currentPrice * (1 - distancePercent / 100);
          this.position.stopLoss = Math.max(this.position.stopLoss, this.position.trailingStopPrice);
        } else {
          this.position.trailingStopPrice = currentPrice * (1 + distancePercent / 100);
          this.position.stopLoss = Math.min(this.position.stopLoss, this.position.trailingStopPrice);
        }
        console.log(`[SIMULATOR] 🔒 Trailing Stop ACTIVADO | Precio: $${currentPrice.toFixed(2)} | SL Trailing: $${this.position.trailingStopPrice.toFixed(2)}`);
      }
    } else if (this.config.useTrailingStop && this.position.trailingStopActive) {
      if (this.position.direction === 'LONG') {
        const newTrailingPrice = currentPrice * (1 - distancePercent / 100);
        if (newTrailingPrice > this.position.trailingStopPrice) {
          this.position.trailingStopPrice = newTrailingPrice;
          this.position.stopLoss = Math.max(this.position.stopLoss, newTrailingPrice);
          console.log(`[SIMULATOR] 📈 SL actualizado: $${this.position.stopLoss.toFixed(2)}`);
        }
      } else {
        const newTrailingPrice = currentPrice * (1 + distancePercent / 100);
        if (newTrailingPrice < this.position.trailingStopPrice) {
          this.position.trailingStopPrice = newTrailingPrice;
          this.position.stopLoss = Math.min(this.position.stopLoss, newTrailingPrice);
          console.log(`[SIMULATOR] 📉 SL actualizado: $${this.position.stopLoss.toFixed(2)}`);
        }
      }
    }

    let status = 'OPEN';
    let outcome = null;

    if (this.position.direction === 'LONG') {
      if (currentPrice >= this.position.takeProfit) {
        status = 'WIN';
        outcome = 'WIN';
      } else if (currentPrice <= this.position.stopLoss) {
        status = pnl >= 0 ? 'WIN' : 'LOSS';
        outcome = pnl >= 0 ? 'WIN' : 'LOSS';
      }
    } else {
      if (currentPrice <= this.position.takeProfit) {
        status = 'WIN';
        outcome = 'WIN';
      } else if (currentPrice >= this.position.stopLoss) {
        status = pnl >= 0 ? 'WIN' : 'LOSS';
        outcome = pnl >= 0 ? 'WIN' : 'LOSS';
      }
    }

    if (outcome) {
      const exitPrice = outcome === 'WIN' ? this.position.takeProfit : currentPrice;
      return this.closePosition(outcome, pnl, pnlPercent, exitPrice);
    }

    return {
      status: 'OPEN',
      pnl: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
      currentPrice,
      trailingActive: this.position.trailingStopActive,
      trailingPrice: this.position.trailingStopPrice ? this.position.trailingStopPrice.toFixed(2) : null
    };
  }

  checkAbsorptionAndClose(orderFlowData, currentPrice) {
    if (!this.position || !orderFlowData) return null;
    
    const hasAbsorption = orderFlowData.absorption || false;
    const sellWalls = orderFlowData.sellWalls || [];
    const buyWalls = orderFlowData.buyWalls || [];
    
    if (this.position.direction === 'LONG' && hasAbsorption) {
      const nearResistance = sellWalls.find(w => Math.abs(w.price - currentPrice) / currentPrice < 0.002);
      if (nearResistance) {
        console.log(`[SIMULATOR] 🛡️ ABSORCIÓN DETECTADA: Cerrando posición LONG por absorción en resistencia`);
        return this.closePosition('PROFIT_TAKER', 0, 0, currentPrice);
      }
    }
    
    if (this.position.direction === 'SHORT' && hasAbsorption) {
      const nearSupport = buyWalls.find(w => Math.abs(w.price - currentPrice) / currentPrice < 0.002);
      if (nearSupport) {
        console.log(`[SIMULATOR] 🛡️ ABSORCIÓN DETECTADA: Cerrando posición SHORT por absorción en soporte`);
        return this.closePosition('PROFIT_TAKER', 0, 0, currentPrice);
      }
    }
    
    return null;
  }

  updateWithRealtimeData(currentPrice, orderFlowData, marketData) {
    if (!this.position) return null;
    
    const checkResult = this.checkPosition(currentPrice);
    
    if (checkResult.status === 'OPEN' && orderFlowData) {
      const absorptionResult = this.checkAbsorptionAndClose(orderFlowData, currentPrice);
      if (absorptionResult) return absorptionResult;
    }
    
    if (checkResult.status !== 'OPEN') {
      return checkResult;
    }
    
    return {
      status: 'OPEN',
      pnl: checkResult.pnl,
      pnlPercent: checkResult.pnlPercent,
      currentPrice,
      direction: this.position.direction,
      entry: this.position.entryPrice,
      stopLoss: this.position.stopLoss,
      takeProfit: this.position.takeProfit,
      trailingActive: this.position.trailingStopActive,
      trailingStop: this.position.trailingStopPrice,
      orderFlow: orderFlowData ? {
        delta: orderFlowData.cumulativeDelta,
        buyPressure: orderFlowData.buyPressure,
        walls: orderFlowData.walls
      } : null
    };
  }

  closePosition(outcome, pnl, pnlPercent, exitPrice) {
    const trade = {
      id: this.trades.length + 1,
      direction: this.position.direction,
      entryPrice: this.position.entryPrice,
      exitPrice: exitPrice || (this.position.direction === 'LONG' 
        ? this.position.takeProfit 
        : this.position.stopLoss),
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