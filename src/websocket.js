'use strict';

const WebSocket = require('ws');

const WS_BASE_URL = 'wss://fstream.binance.com/ws';

class BinanceWebSocket {
  constructor() {
    this.ws = null;
    this.symbol = 'btcusdt';
    this.listeners = {
      ticker: [],
      depth: [],
      kline: [],
      trade: [],
      all: []
    };
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.isConnected = false;
    this.lastData = {
      ticker: null,
      depth: null,
      kline: null
    };
    this.heartbeat = null;
  }

  connect(symbol = 'btcusdt') {
    this.symbol = symbol.toLowerCase();
    
    const streams = [
      `${this.symbol}@ticker`,
      `${this.symbol}@depth20@100ms`,
      `${this.symbol}@kline_1m`,
      `${this.symbol}@trade`
    ].join('/');

    const url = `${WS_BASE_URL}/${streams}`;
    
    console.log('[WS] Conectando a:', url);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        console.log('[WS] ✓ Conexión establecida');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[WS] Error parse:', e.message);
        }
      });

      this.ws.on('close', () => {
        console.log('[WS] ✗ Conexión cerrada');
        this.isConnected = false;
        this.stopHeartbeat();
        this.attemptReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[WS] Error:', error.message);
      });

    } catch (e) {
      console.error('[WS] Error de conexión:', e.message);
      this.attemptReconnect();
    }
  }

  handleMessage(msg) {
    const eventType = msg.e;
    
    switch (eventType) {
      case '24hrTicker':
        this.lastData.ticker = this.formatTicker(msg);
        this.emit('ticker', this.lastData.ticker);
        this.emit('all', { type: 'ticker', data: this.lastData.ticker });
        break;
        
      case 'depthUpdate':
      case 'depth':
        this.lastData.depth = this.formatDepth(msg);
        this.emit('depth', this.lastData.depth);
        this.emit('all', { type: 'depth', data: this.lastData.depth });
        break;
        
      case 'kline':
        this.lastData.kline = this.formatKline(msg);
        this.emit('kline', this.lastData.kline);
        this.emit('all', { type: 'kline', data: this.lastData.kline });
        break;
        
      case 'trade':
        const trade = this.formatTrade(msg);
        this.emit('trade', trade);
        this.emit('all', { type: 'trade', data: trade });
        break;
    }
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
      timestamp: msg.E
    };
  }

  formatDepth(msg) {
    return {
      asks: msg.asks ? msg.asks.slice(0, 15).map(a => [parseFloat(a[0]), parseFloat(a[1])]) : [],
      bids: msg.bids ? msg.bids.slice(0, 15).map(b => [parseFloat(b[0]), parseFloat(b[1])]) : [],
      lastUpdateId: msg.lastUpdateId,
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
      isBuyerMaker: msg.m
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
          console.error('[WS] Error en listener:', e.message);
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
      console.log(`[WS] Reconectando... intento ${this.reconnectAttempts}`);
      setTimeout(() => this.connect(this.symbol), this.reconnectDelay);
    } else {
      console.error('[WS] Máximo de intentos alcanzado');
    }
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    console.log('[WS] Desconectado');
  }

  getLatestData() {
    return this.lastData;
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