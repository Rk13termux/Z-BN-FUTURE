'use strict';

class OrderFlowEngine {
  constructor() {
    this.listeners = [];
    this.orderBookHistory = [];
    this.tradeHistory = [];
    this.deltaHistory = [];
    this.maxHistory = 100;
    this.lastPrice = 0;
    this.currentPrice = 0;
    this.avgVolume = 0;
    this.cumulativeDelta = 0;
    this.walls = { buy: [], sell: [] };
    this.trendData = { direction: 'neutral', strength: 0, exhaustion: 0 };
    this.lastUpdate = 0;
    this.config = {
      wallMultiplier: 3,
      deltaThreshold: 100,
      volumeSpikeMultiplier: 2,
      minLevels: 15,
      lookbackTicks: 10
    };
  }

  onSignal(callback) {
    this.listeners.push(callback);
  }

  emitSignal(signal) {
    this.listeners.forEach(cb => {
      try { cb(signal); } catch (e) { console.error('[ORDER FLOW] Error:', e.message); }
    });
  }

  processTicker(ticker) {
    if (!ticker) return;
    this.lastPrice = this.currentPrice || ticker.price;
    this.currentPrice = ticker.price;
    this.avgVolume = this.avgVolume * 0.9 + ticker.volume * 0.1;
    
    const delta = (ticker.buyVolume || 0) - (ticker.sellVolume || 0);
    this.cumulativeDelta += delta;
    
    this.deltaHistory.push({
      delta,
      price: this.currentPrice,
      timestamp: Date.now()
    });
    if (this.deltaHistory.length > 50) this.deltaHistory.shift();
    
    this.analyzeTrend();
    
    if (Math.abs(delta) > this.avgVolume * 0.5) {
      this.emitSignal({
        type: 'DELTA_SPIKE',
        direction: delta > 0 ? 'LONG' : 'SHORT',
        confidence: Math.min(Math.abs(delta) / this.avgVolume * 50, 90),
        reason: `Delta: ${delta > 0 ? '+' : ''}${delta.toFixed(0)} (${((delta/this.avgVolume)*100).toFixed(1)}% del volumen)`,
        data: { delta, cumulativeDelta: this.cumulativeDelta, price: this.currentPrice }
      });
    }
  }

  processDepth(depth) {
    if (!depth || !depth.asks || !depth.bids) return;
    
    this.analyzeWalls(depth.asks, depth.bids);
    this.detectExecution(depth);
    this.detectPullback(depth);
    this.lastUpdate = Date.now();
  }

  processTrade(trade) {
    this.tradeHistory.push({
      price: trade.price,
      quantity: trade.quantity,
      isBuyerMaker: trade.isBuyerMaker,
      timestamp: trade.time
    });
    if (this.tradeHistory.length > 100) this.tradeHistory.shift();
  }

  analyzeWalls(asks, bids) {
    const avgBidVol = bids.slice(0, 10).reduce((s, b) => s + b[1], 0) / 10;
    const avgAskVol = asks.slice(0, 10).reduce((s, a) => s + a[1], 0) / 10;
    const wallThreshold = avgBidVol * this.config.wallMultiplier;
    
    const newBuyWalls = [];
    const newSellWalls = [];
    
    bids.forEach(([price, qty], index) => {
      if (qty > wallThreshold && qty > avgBidVol * 2) {
        const strength = Math.min((qty / avgBidVol) * 20, 100);
        const distance = ((this.currentPrice - price) / this.currentPrice) * 100;
        
        if (distance > 0 && distance < 0.5) {
          newBuyWalls.push({ price, qty, strength, level: index, distance });
          
          if (strength > 60) {
            this.emitSignal({
              type: 'BUY_WALL',
              direction: 'LONG',
              confidence: strength,
              reason: `Buy Wall detectado en $${price.toFixed(2)} (fuerza: ${strength.toFixed(0)}%) - Soporte potencial`,
              data: { price, qty, strength, distance }
            });
          }
        }
      }
    });
    
    asks.forEach(([price, qty], index) => {
      if (qty > wallThreshold && qty > avgAskVol * 2) {
        const strength = Math.min((qty / avgAskVol) * 20, 100);
        const distance = ((price - this.currentPrice) / this.currentPrice) * 100;
        
        if (distance > 0 && distance < 0.5) {
          newSellWalls.push({ price, qty, strength, level: index, distance });
          
          if (strength > 60) {
            this.emitSignal({
              type: 'SELL_WALL',
              direction: 'SHORT',
              confidence: strength,
              reason: `Sell Wall detectado en $${price.toFixed(2)} (fuerza: ${strength.toFixed(0)}%) - Resistencia potencial`,
              data: { price, qty, strength, distance }
            });
          }
        }
      }
    });
    
    this.walls.buy = newBuyWalls;
    this.walls.sell = newSellWalls;
    
    this.detectAbsorption(newSellWalls, newBuyWalls);
  }

  detectAbsorption(sellWalls, buyWalls) {
    if (!sellWalls || sellWalls.length === 0) return;
    if (this.cumulativeDelta <= 0) return;
    if (this.priceHistory.length < 5) return;
    
    const nearbySellWall = sellWalls.find(w => w.distance < 0.3 && w.strength > 50);
    if (!nearbySellWall) return;
    
    const recentPriceChange = this.priceHistory.length >= 5 
      ? (this.currentPrice - this.priceHistory[this.priceHistory.length - 5]) / this.priceHistory[this.priceHistory.length - 5] * 100
      : 0;
    
    const priceNearWall = this.currentPrice >= nearbySellWall.price * 0.998;
    const wallIntact = nearbySellWall.qty > this.avgVolume * 3;
    
    if (priceNearWall && recentPriceChange < 0.3 && wallIntact && this.cumulativeDelta > 300) {
      const absorptionScore = Math.min(
        (this.cumulativeDelta / 500) * 30 + 
        (nearbySellWall.strength * 0.4) + 
        ((0.3 - recentPriceChange) * 20),
        95
      );
      
      console.log(`[ORDER FLOW] ⚠ ABSORPTION DETECTED: Delta=${this.cumulativeDelta}, Wall=${nearbySellWall.strength.toFixed(0)}%, PriceChange=${recentPriceChange.toFixed(2)}%`);
      
      this.emitSignal({
        type: 'SHORT_CONFIRMATION',
        direction: 'SHORT',
        confidence: absorptionScore,
        reason: `Absorción detectada: Buy wall erosionado por sellers, precio no supera wall en $${nearbySellWall.price.toFixed(2)} (Delta: +${this.cumulativeDelta.toFixed(0)}, Wall strength: ${nearbySellWall.strength.toFixed(0)}%)`,
        data: {
          wallPrice: nearbySellWall.price,
          wallStrength: nearbySellWall.strength,
          cumulativeDelta: this.cumulativeDelta,
          priceChange: recentPriceChange,
          absorptionType: 'buyer_exhaustion'
        }
      });
    }
  }

  detectExecution(depth) {
    const bids = depth.bids || [];
    const asks = depth.asks || [];
    
    const currentBidVol = bids.slice(0, 3).reduce((s, b) => s + b[1], 0);
    const currentAskVol = asks.slice(0, 3).reduce((s, a) => s + a[1], 0);
    
    const prevBidVol = this.orderBookHistory.length > 0 
      ? this.orderBookHistory[this.orderBookHistory.length - 1].bidVol 
      : currentBidVol;
    const prevAskVol = this.orderBookHistory.length > 0 
      ? this.orderBookHistory[this.orderBookHistory.length - 1].askVol 
      : currentAskVol;
    
    const bidChange = currentBidVol - prevBidVol;
    const askChange = currentAskVol - prevAskVol;
    
    if (bidChange < -prevBidVol * 0.3 && bidChange < -100) {
      this.emitSignal({
        type: 'BUY_WALL_EXECUTED',
        direction: 'LONG',
        confidence: Math.min(Math.abs(bidChange) / 100 * 10, 85),
        reason: `Buy Wall ejecutado - posible entrada de dinero`,
        data: { executed: Math.abs(bidChange), price: this.currentPrice }
      });
    }
    
    if (askChange < -prevAskVol * 0.3 && askChange < -100) {
      this.emitSignal({
        type: 'SELL_WALL_EXECUTED',
        direction: 'SHORT',
        confidence: Math.min(Math.abs(askChange) / 100 * 10, 85),
        reason: `Sell Wall ejecutado - presión vendedora`,
        data: { executed: Math.abs(askChange), price: this.currentPrice }
      });
    }
    
    this.orderBookHistory.push({
      bidVol: currentBidVol,
      askVol: currentAskVol,
      timestamp: Date.now()
    });
    if (this.orderBookHistory.length > 20) this.orderBookHistory.shift();
  }

  analyzeTrend() {
    if (this.deltaHistory.length < 10) return;
    
    const recentDelta = this.deltaHistory.slice(-10);
    const olderDelta = this.deltaHistory.slice(-20, -10);
    
    const recentSum = recentDelta.reduce((s, d) => s + d.delta, 0);
    const olderSum = olderDelta.reduce((s, d) => s + d.delta, 0);
    
    const priceChange = ((this.currentPrice - this.lastPrice) / this.lastPrice) * 100;
    
    if (recentSum > 500 && priceChange > 0) {
      this.trendData = { direction: 'UP', strength: Math.min(recentSum / 1000 * 100, 100), exhaustion: 0 };
    } else if (recentSum < -500 && priceChange < 0) {
      this.trendData = { direction: 'DOWN', strength: Math.min(Math.abs(recentSum) / 1000 * 100, 100), exhaustion: 0 };
    } else if (priceChange > 0.5 && recentSum < olderSum * 0.5) {
      this.trendData.exhaustion = Math.min((priceChange / (Math.abs(recentSum) + 1)) * 200, 100);
      if (this.trendData.exhaustion > 70) {
        this.emitSignal({
          type: 'TREND_EXHAUSTION',
          direction: 'SHORT',
          confidence: this.trendData.exhaustion,
          reason: `Agotamiento de tendencia alcista - divergencia delta/precio`,
          data: { priceChange, deltaChange: recentSum - olderSum, exhaustion: this.trendData.exhaustion }
        });
      }
    } else if (priceChange < -0.5 && recentSum > olderSum * 0.5) {
      this.trendData.exhaustion = Math.min((Math.abs(priceChange) / (Math.abs(recentSum) + 1)) * 200, 100);
      if (this.trendData.exhaustion > 70) {
        this.emitSignal({
          type: 'TREND_EXHAUSTION',
          direction: 'LONG',
          confidence: this.trendData.exhaustion,
          reason: `Agotamiento de tendencia bajista - divergencia delta/precio`,
          data: { priceChange, deltaChange: recentSum - olderSum, exhaustion: this.trendData.exhaustion }
        });
      }
    } else {
      this.trendData.exhaustion = Math.max(0, this.trendData.exhaustion - 5);
    }
  }

  detectPullback(depth) {
    const bids = depth.bids || [];
    const asks = depth.asks || [];
    
    if (bids.length === 0 || asks.length === 0) return;
    
    const nearestBuyWall = this.walls.buy.find(w => w.distance < 0.3 && w.strength > 40);
    const nearestSellWall = this.walls.sell.find(w => w.distance < 0.3 && w.strength > 40);
    
    const currentBid = bids[0][0];
    const currentAsk = asks[0][0];
    
    if (nearestBuyWall) {
      const distance = ((currentBid - nearestBuyWall.price) / currentBid) * 100;
      if (distance > 0 && distance < 0.1 && this.cumulativeDelta > 200) {
        this.emitSignal({
          type: 'PULLBACK_LONG',
          direction: 'LONG',
          confidence: Math.min(50 + this.cumulativeDelta / 50, 90),
          reason: `Pullback en buy wall - entrada estratégica LONG`,
          data: { wallPrice: nearestBuyWall.price, currentPrice: currentBid, delta: this.cumulativeDelta }
        });
      }
    }
    
    if (nearestSellWall) {
      const distance = ((nearestSellWall.price - currentAsk) / currentAsk) * 100;
      if (distance > 0 && distance < 0.1 && this.cumulativeDelta < -200) {
        this.emitSignal({
          type: 'PULLBACK_SHORT',
          direction: 'SHORT',
          confidence: Math.min(50 + Math.abs(this.cumulativeDelta) / 50, 90),
          reason: `Pullback en sell wall - entrada estratégica SHORT`,
          data: { wallPrice: nearestSellWall.price, currentPrice: currentAsk, delta: this.cumulativeDelta }
        });
      }
    }
  }

  processKline(kline) {
    if (!kline || !kline.isClosed) return;
    
    if (this.deltaHistory.length > 5) {
      const recentDeltas = this.deltaHistory.slice(-5);
      const totalDelta = recentDeltas.reduce((s, d) => s + d.delta, 0);
      
      if (totalDelta > 300 && kline.close > kline.open) {
        this.emitSignal({
          type: 'DELTA_CONFIRM_BULLISH',
          direction: 'LONG',
          confidence: 75,
          reason: `Delta positivo en cierre de vela - confirmación tendencia alcista`,
          data: { delta: totalDelta, candle: { o: kline.open, c: kline.close } }
        });
      } else if (totalDelta < -300 && kline.close < kline.open) {
        this.emitSignal({
          type: 'DELTA_CONFIRM_BEARISH',
          direction: 'SHORT',
          confidence: 75,
          reason: `Delta negativo en cierre de vela - confirmación tendencia bajista`,
          data: { delta: totalDelta, candle: { o: kline.open, c: kline.close } }
        });
      }
    }
  }

  getAnalysis() {
    return {
      price: this.currentPrice,
      cumulativeDelta: this.cumulativeDelta,
      recentDelta: this.deltaHistory.slice(-5).reduce((s, d) => s + d.delta, 0),
      avgVolume: this.avgVolume,
      buyWalls: this.walls.buy,
      sellWalls: this.walls.sell,
      trend: this.trendData,
      buyWallPressure: this.walls.buy.reduce((s, w) => s + w.strength, 0),
      sellWallPressure: this.walls.sell.reduce((s, w) => s + w.strength, 0)
    };
  }

  reset() {
    this.orderBookHistory = [];
    this.tradeHistory = [];
    this.deltaHistory = [];
    this.cumulativeDelta = 0;
    this.walls = { buy: [], sell: [] };
    this.trendData = { direction: 'neutral', strength: 0, exhaustion: 0 };
  }
}

module.exports = OrderFlowEngine;