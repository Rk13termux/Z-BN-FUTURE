'use strict';

class OrderFlowEngine {
  constructor() {
    this.listeners = [];
    this.orderBookHistory = [];
    this.tradeHistory = [];
    this.deltaHistory = [];
    this.maxHistory = 200;
    
    this.lastPrice = 0;
    this.currentPrice = 0;
    this.avgBidVolume = 0;
    this.avgAskVolume = 0;
    this.cumulativeDelta = 0;
    this.candleDelta = 0;
    
    this.walls = { buy: [], sell: [] };
    this.previousWalls = { buy: [], sell: [] };
    this.spoofingZones = [];
    
    this.imbalances = {
      buy: [],
      sell: [],
      stackedBuy: [],
      stackedSell: []
    };
    
    this.deltaDivergence = {
      priceHigh: 0,
      deltaHigh: 0,
      lastCheckTime: 0,
      divergences: []
    };
    
    this.trendData = { 
      direction: 'neutral', 
      strength: 0, 
      exhaustion: 0 
    };
    
    this.lastUpdate = 0;
    this.config = {
      imbalanceRatio: 3.0,
      stackedImbalanceCount: 3,
      spoofingMultiplier: 3.0,
      deltaHistoryLookback: 20,
      divergenceThreshold: 0.7
    };
    
    this.vwap = { value: 0, volume: 0 };
    this.poc = { price: 0, volume: 0 };
    this.volumeProfile = [];
  }

  onSignal(callback) {
    this.listeners.push(callback);
  }

  emitSignal(signal) {
    signal.timestamp = Date.now();
    signal.price = this.currentPrice;
    this.listeners.forEach(cb => {
      try { cb(signal); } catch (e) { console.error('[ORDER FLOW] Error:', e.message); }
    });
  }

  processTicker(ticker) {
    if (!ticker) return;
    
    this.lastPrice = this.currentPrice || ticker.price;
    this.currentPrice = ticker.price;
    
    const buyVol = parseFloat(ticker.buyVolume) || 0;
    const sellVol = parseFloat(ticker.sellVolume) || 0;
    
    const delta = buyVol - sellVol;
    this.cumulativeDelta += delta;
    this.candleDelta += delta;
    
    this.deltaHistory.push({
      delta,
      cumulativeDelta: this.cumulativeDelta,
      price: this.currentPrice,
      timestamp: Date.now()
    });
    
    if (this.deltaHistory.length > this.maxHistory) {
      this.deltaHistory.shift();
    }
    
    this.avgBidVolume = this.avgBidVolume * 0.95 + buyVol * 0.05;
    this.avgAskVolume = this.avgAskVolume * 0.95 + sellVol * 0.05;
    
    this.calculateDeltaDivergence();
    this.analyzeTrend();
  }

  processDepth(depth) {
    if (!depth || !depth.asks || !depth.bids) return;
    
    this.previousWalls = { 
      buy: [...this.walls.buy], 
      sell: [...this.walls.sell] 
    };
    
    this.detectImbalances(depth.bids, depth.asks);
    this.detectWalls(depth.bids, depth.asks);
    this.detectSpoofing(depth.bids, depth.asks);
    this.buildVolumeProfile(depth.bids, depth.asks);
    
    this.lastUpdate = Date.now();
  }

  processTrade(trade) {
    const isBuy = !trade.isBuyerMaker;
    const volume = parseFloat(trade.quantity) || 0;
    const price = parseFloat(trade.price) || this.currentPrice;
    
    this.tradeHistory.push({
      price,
      volume,
      isBuy,
      timestamp: Date.now()
    });
    
    if (this.tradeHistory.length > 500) {
      this.tradeHistory.shift();
    }
  }

  processKline(kline) {
    this.candleDelta = 0;
    this.deltaDivergence.priceHigh = 0;
    this.deltaDivergence.deltaHigh = 0;
  }

  detectImbalances(bids, asks) {
    const buyImbalances = [];
    const sellImbalances = [];
    
    const avgBidVol = bids.reduce((s, b) => s + b[1], 0) / bids.length;
    const avgAskVol = asks.reduce((s, a) => s + a[1], 0) / asks.length;
    
    for (let i = 0; i < Math.min(bids.length, 10); i++) {
      const bidVol = bids[i][1];
      const askVol = asks[i] ? asks[i][1] : 0;
      
      if (bidVol > avgBidVol * this.config.imbalanceRatio) {
        buyImbalances.push({
          level: i,
          price: bids[i][0],
          volume: bidVol,
          ratio: (bidVol / avgBidVol).toFixed(2),
          type: 'IMBALANCE_ZONE'
        });
      }
      
      if (askVol > avgAskVol * this.config.imbalanceRatio) {
        sellImbalances.push({
          level: i,
          price: asks[i][0],
          volume: askVol,
          ratio: (askVol / avgAskVol).toFixed(2),
          type: 'IMBALANCE_ZONE'
        });
      }
    }
    
    this.imbalances.buy = buyImbalances;
    this.imbalances.sell = sellImbalances;
    
    this.detectStackedImbalances(buyImbalances, sellImbalances);
  }

  detectStackedImbalances(buyImbalances, sellImbalances) {
    if (buyImbalances.length >= this.config.stackedImbalanceCount) {
      console.log('[ORDER FLOW] 📊 STACKED BUY IMBALANCE: ' + buyImbalances.length + ' niveles detectados');
      
      this.imbalances.stackedBuy = buyImbalances;
      
      this.emitSignal({
        type: 'STACKED_IMBALANCE',
        direction: 'LONG',
        confidence: 90,
        reason: `Presión compradora masiva: ${buyImbalances.length} niveles de desequilibrio apilados`,
        data: {
          imbalances: buyImbalances,
          totalVolume: buyImbalances.reduce((s, i) => s + i.volume, 0)
        }
      });
    }
    
    if (sellImbalances.length >= this.config.stackedImbalanceCount) {
      console.log('[ORDER FLOW] 📊 STACKED SELL IMBALANCE: ' + sellImbalances.length + ' niveles detectados');
      
      this.imbalances.stackedSell = sellImbalances;
      
      this.emitSignal({
        type: 'STACKED_IMBALANCE',
        direction: 'SHORT',
        confidence: 90,
        reason: `Presión vendedora masiva: ${sellImbalances.length} niveles de desequilibrio apilados`,
        data: {
          imbalances: sellImbalances,
          totalVolume: sellImbalances.reduce((s, i) => s + i.volume, 0)
        }
      });
    }
  }

  detectWalls(bids, asks) {
    const avgBidVol = bids.reduce((s, b) => s + b[1], 0) / bids.length;
    const avgAskVol = asks.reduce((s, a) => s + a[1], 0) / asks.length;
    
    const bidThreshold = avgBidVol * this.config.spoofingMultiplier;
    const askThreshold = avgAskVol * this.config.spoofingMultiplier;
    
    const buyWalls = bids
      .filter(b => b[1] >= bidThreshold)
      .map(w => ({
        price: w[0],
        volume: w[1],
        strength: (w[1] / avgBidVol).toFixed(2)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
    
    const sellWalls = asks
      .filter(a => a[1] >= askThreshold)
      .map(w => ({
        price: w[0],
        volume: w[1],
        strength: (w[1] / avgAskVol).toFixed(2)
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
    
    this.walls = { buy: buyWalls, sell: sellWalls };
  }

  detectSpoofing(bids, asks) {
    if (!this.previousWalls.sell.length || !this.walls.sell.length) return;
    
    const previousTopWall = this.previousWalls.sell[0];
    const currentTopWall = this.walls.sell[0];
    
    if (previousTopWall && currentTopWall && 
        previousTopWall.volume > currentTopWall.volume * 2 &&
        previousTopWall.price === currentTopWall.price) {
      
      const recentTrades = this.tradeHistory.filter(t => 
        t.timestamp > Date.now() - 3000 &&
        Math.abs(t.price - previousTopWall.price) < previousTopWall.price * 0.001
      );
      
      const executedVolume = recentTrades.reduce((s, t) => s + t.volume, 0);
      const wallRemoved = previousTopWall.volume - executedVolume;
      
      if (wallRemoved > previousTopWall.volume * 0.7 && executedVolume < previousTopWall.volume * 0.3) {
        console.log('[ORDER FLOW] 🎭 SPOOFING DETECTED: Wall masivo en $' + previousTopWall.price + ' removido sin ejecución');
        
        this.spoofingZones.push({
          price: previousTopWall.price,
          volume: previousTopWall.volume,
          removedVolume: wallRemoved,
          timestamp: Date.now()
        });
        
        if (this.spoofingZones.length > 10) {
          this.spoofingZones.shift();
        }
        
        this.emitSignal({
          type: 'SPOOFING_DETECTED',
          direction: 'WAIT',
          confidence: 85,
          reason: `Wall falso detectado en $${previousTopWall.price} - riesgo de fake breakout`,
          data: {
            wallPrice: previousTopWall.price,
            wallVolume: previousTopWall.volume,
            removedWithoutExecution: wallRemoved
          }
        });
      }
    }
  }

  buildVolumeProfile(bids, asks) {
    const profile = [];
    const totalVolume = [...bids, ...asks].reduce((s, p) => s + p[1], 0);
    
    const bidVol = bids.reduce((s, b) => s + b[1], 0);
    const askVol = asks.reduce((s, a) => s + a[1], 0);
    
    this.vwap.value = this.vwap.value * 0.9 + this.currentPrice * 0.1;
    
    const allLevels = [...bids, ...asks].sort((a, b) => a[0] - b[0]);
    let maxVol = 0;
    let pocPrice = 0;
    
    allLevels.forEach(level => {
      if (level[1] > maxVol) {
        maxVol = level[1];
        pocPrice = level[0];
      }
      profile.push({ price: level[0], volume: level[1] });
    });
    
    this.volumeProfile = profile;
    this.poc = { price: pocPrice, volume: maxVol };
  }

  calculateDeltaDivergence() {
    if (this.deltaHistory.length < 10) return;
    
    const recent = this.deltaHistory.slice(-this.config.deltaHistoryLookback);
    
    const maxPrice = Math.max(...recent.map(d => d.price));
    const maxDelta = Math.max(...recent.map(d => d.cumulativeDelta));
    
    if (maxPrice > this.deltaDivergence.priceHigh * 1.001) {
      this.deltaDivergence.priceHigh = maxPrice;
      this.deltaDivergence.deltaHigh = maxDelta;
    }
    
    const currentDelta = recent[recent.length - 1].cumulativeDelta;
    
    if (this.currentPrice >= this.deltaDivergence.priceHigh * 0.999 &&
        currentDelta < this.deltaDivergence.deltaHigh * this.config.divergenceThreshold) {
      
      if (Date.now() - this.deltaDivergence.lastCheckTime > 5000) {
        console.log('[ORDER FLOW] 📉 BEARISH DIVERGENCE: Precio nuevo máximo, Delta bajando');
        
        this.deltaDivergence.divergences.push({
          type: 'BEARISH',
          priceHigh: this.deltaDivergence.priceHigh,
          deltaPeak: this.deltaDivergence.deltaHigh,
          currentDelta: currentDelta,
          timestamp: Date.now()
        });
        
        this.emitSignal({
          type: 'BEARISH_DIVERGENCE',
          direction: 'SHORT',
          confidence: 88,
          reason: 'Divergencia bajista: precio nuevo máximo pero delta decreciendo - distribución institucional',
          data: {
            priceHigh: this.deltaDivergence.priceHigh,
            deltaPeak: this.deltaDivergence.deltaHigh,
            currentDelta: currentDelta,
            priceChange: ((this.currentPrice - this.deltaDivergence.priceHigh) / this.deltaDivergence.priceHigh * 100).toFixed(2)
          }
        });
        
        this.deltaDivergence.lastCheckTime = Date.now();
      }
    }
    
    if (this.currentPrice <= this.deltaDivergence.priceHigh * 0.999 &&
        currentDelta > this.deltaDivergence.deltaHigh * this.config.divergenceThreshold) {
      
      if (Date.now() - this.deltaDivergence.lastCheckTime > 5000) {
        console.log('[ORDER FLOW] 📈 BULLISH DIVERGENCE: Precio nuevo mínimo, Delta subiendo');
        
        this.emitSignal({
          type: 'BULLISH_DIVERGENCE',
          direction: 'LONG',
          confidence: 88,
          reason: 'Divergencia alcista: precio nuevos mínimos pero delta creciente - acumulación institucional',
          data: {
            priceLow: this.deltaDivergence.priceHigh,
            deltaPeak: this.deltaDivergence.deltaHigh,
            currentDelta: currentDelta
          }
        });
        
        this.deltaDivergence.lastCheckTime = Date.now();
      }
    }
  }

  analyzeTrend() {
    if (this.deltaHistory.length < 10) return;
    
    const recent = this.deltaHistory.slice(-10);
    const buyPressure = recent.filter(d => d.delta > 0).length;
    const priceChange = this.currentPrice - recent[0].price;
    
    const deltaMomentum = this.cumulativeDelta / (recent.length || 1);
    
    if (buyPressure >= 7 && deltaMomentum > 50 && priceChange > 0) {
      this.trendData = { direction: 'UP', strength: 80, exhaustion: 0 };
    } else if (buyPressure <= 3 && deltaMomentum < -50 && priceChange < 0) {
      this.trendData = { direction: 'DOWN', strength: 80, exhaustion: 0 };
    } else if (Math.abs(priceChange) < this.currentPrice * 0.002) {
      this.trendData = { direction: 'SIDEWAYS', strength: 30, exhaustion: buyPressure > 5 ? 50 : 0 };
    }
    
    const recentTrades = this.tradeHistory.slice(-50);
    if (recentTrades.length > 30) {
      const buyTrades = recentTrades.filter(t => t.isBuy).length;
      const sellTrades = recentTrades.filter(t => !t.isBuy).length;
      
      if (buyTrades > sellTrades * 2) {
        this.trendData.exhaustion = Math.min(100, this.trendData.exhaustion + 5);
      }
    }
  }

  getAnalysis() {
    const totalVol = this.avgBidVolume + this.avgAskVolume;
    const buyPressure = totalVol > 0 ? (this.avgBidVolume / totalVol * 100) : 50;
    
    return {
      price: this.currentPrice,
      cumulativeDelta: this.cumulativeDelta.toFixed(2),
      candleDelta: this.candleDelta.toFixed(2),
      buyPressure: buyPressure.toFixed(1),
      walls: this.walls,
      imbalances: this.imbalances,
      spoofingZones: this.spoofingZones.slice(-3),
      divergence: this.deltaDivergence.divergences.slice(-1)[0] || null,
      trend: this.trendData,
      vwap: this.vwap.value.toFixed(2),
      poc: this.poc,
      volumeProfile: this.volumeProfile.slice(0, 20),
      timestamp: Date.now()
    };
  }

  getSummary() {
    return this.getAnalysis();
  }

  getVisualizationData() {
    return {
      imbalances: {
        buy: this.imbalances.buy.map(i => ({ price: i.price, volume: i.volume, type: 'buy' })),
        sell: this.imbalances.sell.map(i => ({ price: i.price, volume: i.volume, type: 'sell' }))
      },
      walls: this.walls,
      spoofing: this.spoofingZones.map(s => ({ price: s.price, volume: s.volume })),
      divergence: this.deltaDivergence.divergences.slice(-1)[0],
      currentPrice: this.currentPrice,
      cumulativeDelta: this.cumulativeDelta,
      buyPressure: this.avgBidVolume / (this.avgBidVolume + this.avgAskVolume) * 100
    };
  }

  reset() {
    this.orderBookHistory = [];
    this.tradeHistory = [];
    this.deltaHistory = [];
    this.cumulativeDelta = 0;
    this.candleDelta = 0;
    this.walls = { buy: [], sell: [] };
    this.imbalances = { buy: [], sell: [], stackedBuy: [], stackedSell: [] };
    this.spoofingZones = [];
    this.deltaDivergence = { priceHigh: 0, deltaHigh: 0, lastCheckTime: 0, divergences: [] };
    this.trendData = { direction: 'neutral', strength: 0, exhaustion: 0 };
  }
}

module.exports = OrderFlowEngine;