'use strict';

const WebSocket = require('ws');

const WS_BASE_URL = 'wss://fstream.binance.com/ws';
const LIQUIDATION_URL = 'wss://fstream.binance.com/stream?streams=!forceOrder@arr';

class BinanceWebSocket {
  constructor() {
    this.ws = null;
    this.wsLiquidation = null;
    this.symbol = 'btcusdt';
    this.listeners = {
      ticker: [],
      depth: [],
      kline: [],
      trade: [],
      liquidation: [],
      aggressiveTrade: [],
      depthWalls: [],
      all: []
    };
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.isConnected = false;
    this.lastData = {
      ticker: null,
      depth: null,
      kline: null,
      trades: [],
      liquidations: []
    };
    this.heartbeat = null;
    this.heartbeatLiquidation = null;
    
    this.tradeBuffer = [];
    this.lastTradeEmit = 0;
    this.TRADE_THROTTLE_MS = 200;
    
    this.depthBuffer = null;
    this.lastDepthEmit = 0;
    this.DEPTH_THROTTLE_MS = 500;
    
    this.orderFlowData = {
      cumulativeDelta: 0,
      buyVolume24h: 0,
      sellVolume24h: 0,
      buyTrades24h: 0,
      sellTrades24h: 0,
      recentLiquidations: [],
      buyWalls: [],
      sellWalls: []
    };
    
    this.wallThresholdMultiplier = 2.5;
  }

  connect(symbol = 'btcusdt') {
    this.symbol = symbol.toLowerCase();
    this.connectMainStream();
    this.connectLiquidationStream();
  }

  connectMainStream() {
    // Usar streams individuales para cada tipo
    const streams = [
      `${this.symbol}@ticker`,
      `${this.symbol}@depth20@100ms`,
      `${this.symbol}@kline_1m`,
      `${this.symbol}@trade`
    ].join('/');

    const url = `${WS_BASE_URL}/${streams}`;
    console.log('[WS-LIVE] Conectando stream principal:', url);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        console.log('[WS-LIVE] ✓ Stream principal conectado');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[WS-LIVE] Error parse:', e.message);
        }
      });

      this.ws.on('close', () => {
        console.log('[WS-LIVE] ✗ Stream principal cerrado');
        this.isConnected = false;
        this.stopHeartbeat();
        this.attemptReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[WS-LIVE] Error stream principal:', error.message);
      });

    } catch (e) {
      console.error('[WS-LIVE] Error de conexión:', e.message);
      this.attemptReconnect();
    }
  }

  connectLiquidationStream() {
    console.log('[WS-LIVE] Conectando stream de liquidaciones...');
    
    try {
      this.wsLiquidation = new WebSocket(LIQUIDATION_URL);
      
      this.wsLiquidation.on('open', () => {
        console.log('[WS-LIVE] ✓ Stream de liquidaciones conectado');
      });

      this.wsLiquidation.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          if (msg.data && msg.stream === '!forceOrder@arr') {
            this.handleLiquidationEvent(msg.data);
          }
        } catch (e) {
          console.error('[WS-LIVE] Error parse liquidación:', e.message);
        }
      });

      this.wsLiquidation.on('close', () => {
        console.log('[WS-LIVE] ✗ Stream de liquidaciones cerrado');
        setTimeout(() => this.connectLiquidationStream(), 5000);
      });

      this.wsLiquidation.on('error', (error) => {
        console.error('[WS-LIVE] Error stream liquidaciones:', error.message);
      });

    } catch (e) {
      console.error('[WS-LIVE] Error conexión liquidaciones:', e.message);
    }
  }

  handleMessage(msg) {
    // Combined streams wrap messages as {stream: "...", data: {...}}
    if (msg.stream && msg.data) {
      msg = msg.data;
    }
    
    const eventType = msg.e;
    
    // Handle depth20 snapshots which have no 'e' field
    // They come with 'bids'/'asks' or 'lastUpdateId' directly
    if (!eventType && (msg.bids || msg.asks || msg.a || msg.b || msg.lastUpdateId !== undefined)) {
      this.processDepth(msg);
      return;
    }
    
    switch (eventType) {
      case '24hrTicker':
        console.log('[WS] ★★★ TICKER RECIBIDO');
        this.lastData.ticker = this.formatTicker(msg);
        this.emit('ticker', this.lastData.ticker);
        this.emit('all', { type: 'ticker', data: this.lastData.ticker });
        break;
      case '24hrMiniTicker':
        console.log('[WS] ★★★ MINI TICKER RECIBIDO');
        this.lastData.ticker = this.formatMiniTicker(msg);
        this.emit('ticker', this.lastData.ticker);
        this.emit('all', { type: 'ticker', data: this.lastData.ticker });
        break;
        
      case 'depthUpdate':
      case 'depth':
        this.processDepth(msg);
        break;
        
      case 'kline':
        this.lastData.kline = this.formatKline(msg);
        this.emit('kline', this.lastData.kline);
        this.emit('all', { type: 'kline', data: this.lastData.kline });
        break;
        
      case 'trade':
        this.processTrade(msg);
        break;
        
      default:
        break;
    }
  }

  processTrade(msg) {
    const trade = this.formatTrade(msg);
    this.lastData.trades.push(trade);
    if (this.lastData.trades.length > 100) {
      this.lastData.trades.shift();
    }
    
    if (trade.isBuyerMaker) {
      this.orderFlowData.sellVolume24h += trade.quantity;
      this.orderFlowData.sellTrades24h++;
      this.orderFlowData.cumulativeDelta -= trade.quantity;
    } else {
      this.orderFlowData.buyVolume24h += trade.quantity;
      this.orderFlowData.buyTrades24h++;
      this.orderFlowData.cumulativeDelta += trade.quantity;
    }
    
    const now = Date.now();
    if (now - this.lastTradeEmit > this.TRADE_THROTTLE_MS) {
      this.lastTradeEmit = now;
      
      const aggressiveTrade = {
        symbol: trade.symbol,
        price: trade.price,
        quantity: trade.quantity,
        direction: trade.isBuyerMaker ? 'SELL' : 'BUY',
        timestamp: trade.time,
        isAggressive: true,
        totalBuyVolume: this.orderFlowData.buyVolume24h,
        totalSellVolume: this.orderFlowData.sellVolume24h,
        cumulativeDelta: this.orderFlowData.cumulativeDelta
      };
      
      this.emit('aggressiveTrade', aggressiveTrade);
      this.emit('all', { type: 'aggressiveTrade', data: aggressiveTrade });
    }
    
    this.emit('trade', trade);
  }

  processDepth(msg) {
    const depth = this.formatDepth(msg);
    const walls = this.calculateWalls(depth);
    
    this.orderFlowData.buyWalls = walls.buyWalls;
    this.orderFlowData.sellWalls = walls.sellWalls;
    
    const now = Date.now();
    if (now - this.lastDepthEmit > this.DEPTH_THROTTLE_MS) {
      this.lastDepthEmit = now;
      
      const depthWalls = {
        symbol: this.symbol.toUpperCase(),
        buyWalls: walls.buyWalls,
        sellWalls: walls.sellWalls,
        spread: walls.spread,
        timestamp: Date.now(),
        totalBidVolume: depth.bids.reduce((s, b) => s + b[1], 0),
        totalAskVolume: depth.asks.reduce((s, a) => s + a[1], 0)
      };
      
      this.emit('depthWalls', depthWalls);
      this.emit('all', { type: 'depthWalls', data: depthWalls });
    }
    
    this.lastData.depth = depth;
    this.emit('depth', depth);
    this.emit('all', { type: 'depth', data: depth });
  }

  calculateWalls(depth) {
    const avgBidVol = depth.bids.reduce((s, b) => s + b[1], 0) / depth.bids.length;
    const avgAskVol = depth.asks.reduce((s, a) => s + a[1], 0) / depth.asks.length;
    
    const bidThreshold = avgBidVol * this.wallThresholdMultiplier;
    const askThreshold = avgAskVol * this.wallThresholdMultiplier;
    
    const buyWalls = depth.bids
      .filter(b => b[1] >= bidThreshold)
      .map(w => ({ price: w[0], volume: w[1], strength: (w[1] / avgBidVol).toFixed(2) }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
    
    const sellWalls = depth.asks
      .filter(a => a[1] >= askThreshold)
      .map(w => ({ price: w[0], volume: w[1], strength: (w[1] / avgAskVol).toFixed(2) }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
    
    const spread = depth.asks[0] && depth.bids[0] 
      ? ((depth.asks[0][0] - depth.bids[0][0]) / depth.asks[0][0] * 100).toFixed(3)
      : 0;
    
    return { buyWalls, sellWalls, spread };
  }

  handleLiquidationEvent(data) {
    if (!data || !data.o) return;
    
    const order = data.o;
    const symbol = order.s;
    const side = order.S === 'Buy' ? 'BUY' : 'SELL';
    const quantityUSD = order.q * order.p;
    const price = order.p;
    
    const liquidation = {
      symbol: symbol,
      side: side,
      quantity: parseFloat(order.q),
      price: parseFloat(price),
      quantityUSD: quantityUSD,
      timestamp: order.T,
      orderType: order.oF
    };
    
    this.orderFlowData.recentLiquidations.push(liquidation);
    if (this.orderFlowData.recentLiquidations.length > 20) {
      this.orderFlowData.recentLiquidations.shift();
    }
    
    const sideLabel = side === 'BUY' ? 'Long Liquidated' : 'Short Liquidated';
    const qtyLabel = quantityUSD >= 1000000 
      ? (quantityUSD / 1000000).toFixed(2) + 'M USD' 
      : (quantityUSD / 1000).toFixed(0) + 'K USD';
    
    console.log(`[WS-LIVE] ⚡ Liquidation Detected: ${symbol} | ${sideLabel} | ${qtyLabel} @ $${price}`);
    
    this.emit('liquidation', liquidation);
    this.emit('all', { type: 'liquidation', data: liquidation });
  }

  formatTicker(msg) {
    return {
      symbol: msg.s,
      price: parseFloat(msg.c),
      priceChange: parseFloat(msg.p),
      priceChangePercent: parseFloat(msg.P),
      high: parseFloat(msg.h),
      low: parseFloat(msg.l),
      volume: parseFloat(msg.v),
      quoteVolume: parseFloat(msg.q),
      openPrice: parseFloat(msg.o),
      trades: parseInt(msg.n),
      buyVolume: parseFloat(msg.V),
      sellVolume: parseFloat(msg.Q),
      timestamp: msg.E,
      fundingRate: parseFloat(msg.f) || 0
    };
  }

  formatMiniTicker(msg) {
    return {
      symbol: msg.s,
      price: parseFloat(msg.c),
      priceChange: parseFloat(msg.p),
      priceChangePercent: parseFloat(msg.P) || parseFloat(((parseFloat(msg.c) - parseFloat(msg.o)) / parseFloat(msg.o) * 100).toFixed(2)),
      high: parseFloat(msg.h),
      low: parseFloat(msg.l),
      volume: parseFloat(msg.v),
      quoteVolume: parseFloat(msg.q),
      openPrice: parseFloat(msg.o),
      trades: 0,
      buyVolume: 0,
      sellVolume: 0,
      timestamp: msg.E,
      fundingRate: 0
    };
  }

  formatDepth(msg) {
    const rawAsks = msg.asks || msg.a || [];
    const rawBids = msg.bids || msg.b || [];
    return {
      asks: rawAsks.slice(0, 20).map(a => [parseFloat(a[0]), parseFloat(a[1])]),
      bids: rawBids.slice(0, 20).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
      lastUpdateId: msg.lastUpdateId || msg.u,
      timestamp: Date.now()
    };
  }

  formatKline(msg) {
    const k = msg.k;
    return {
      symbol: k.s,
      interval: k.i,
      openTime: k.t,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closeTime: k.T,
      isClosed: k.x,
      timestamp: msg.E
    };
  }

  formatTrade(msg) {
    return {
      symbol: msg.s,
      price: parseFloat(msg.p),
      quantity: parseFloat(msg.q),
      time: msg.T,
      isBuyerMaker: msg.m,
      tradeId: msg.t
    };
  }

  getOrderFlowSummary() {
    const lf = this.orderFlowData.buyVolume24h + this.orderFlowData.sellVolume24h;
    const buyRatio = lf > 0 ? (this.orderFlowData.buyVolume24h / lf * 100).toFixed(1) : 50;
    
    return {
      cumulativeDelta: this.orderFlowData.cumulativeDelta.toFixed(2),
      buyVolume24h: this.orderFlowData.buyVolume24h.toFixed(2),
      sellVolume24h: this.orderFlowData.sellVolume24h.toFixed(2),
      buyTrades24h: this.orderFlowData.buyTrades24h,
      sellTrades24h: this.orderFlowData.sellTrades24h,
      buyRatio: buyRatio,
      buyWalls: this.orderFlowData.buyWalls,
      sellWalls: this.orderFlowData.sellWalls,
      recentLiquidations: this.orderFlowData.recentLiquidations.slice(-5),
      timestamp: Date.now()
    };
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
    return this;
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
    return this;
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        try {
          cb(data);
        } catch (e) {
          console.error('[WS-LIVE] Error en listener:', e.message);
        }
      });
    }
  }

  startHeartbeat() {
    this.heartbeat = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[WS-LIVE] Reconectando... intento ${this.reconnectAttempts}`);
      setTimeout(() => this.connect(this.symbol), this.reconnectDelay);
    } else {
      console.error('[WS-LIVE] Máximo de intentos alcanzado');
    }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wsLiquidation) {
      this.wsLiquidation.close();
      this.wsLiquidation = null;
    }
    this.isConnected = false;
    console.log('[WS-LIVE] Desconectado');
  }

  getLatestData() {
    return {
      ...this.lastData,
      orderFlow: this.getOrderFlowSummary()
    };
  }

  isReady() {
    return this.isConnected;
  }

  changeSymbol(symbol) {
    this.disconnect();
    setTimeout(() => this.connect(symbol), 1000);
  }
}

module.exports = BinanceWebSocket;