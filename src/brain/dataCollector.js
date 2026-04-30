'use strict';

const axios = require('axios');

const BASE_URL = 'https://fapi.binance.com';

class DataCollector {
  constructor() {
    this.isRunning = false;
    this.symbol = 'BTCUSDT';
    this.intervals = ['1m', '5m', '15m', '1h', '4h'];
    this.data = {
      klines: {},
      orderBook: null,
      ticker: null,
      funding: null,
      openInterest: null,
      longShort: null,
      markPrice: null,
      lastUpdate: null
    };
    this.listeners = [];
  }

  async start(symbol = 'BTCUSDT') {
    this.symbol = symbol;
    this.isRunning = true;
    console.log(`[CEREBRO] Iniciando recolección de datos para ${symbol}`);
    
    await this.collectAll();
    this.startLoop();
  }

  startLoop() {
    setInterval(async () => {
      if (!this.isRunning) return;
      await this.collectAll();
      this.notifyListeners();
    }, 5000);
  }

  stop() {
    this.isRunning = false;
    console.log('[CEREBRO] Recolección detenida');
  }

  onUpdate(callback) {
    this.listeners.push(callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => cb(this.data));
  }

  async collectAll() {
    try {
      const promises = [
        this.collectKlines(),
        this.collectOrderBook(),
        this.collectTicker(),
        this.collectFundingRate(),
        this.collectOpenInterest(),
        this.collectLongShortRatio(),
        this.collectMarkPrice()
      ];
      
      await Promise.all(promises);
      this.data.lastUpdate = new Date().toISOString();
    } catch (e) {
      console.error('[CEREBRO] Error en recolección:', e.message);
    }
  }

  async collectKlines() {
    for (const interval of this.intervals) {
      try {
        const res = await axios.get(`${BASE_URL}/fapi/v1/klines`, {
          params: { symbol: this.symbol, interval, limit: 500 },
          timeout: 10000
        });
        
        const klines = res.data.map(k => ({
          openTime: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
          quoteVolume: parseFloat(k[7]),
          trades: k[8]
        }));
        
        this.data.klines[interval] = klines;
      } catch (e) {
        console.error(`[CEREBRO] Error klines ${interval}:`, e.message);
      }
    }
  }

  async collectOrderBook() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/depth`, {
        params: { symbol: this.symbol, limit: 20 },
        timeout: 5000
      });
      
      this.data.orderBook = {
        asks: res.data.asks.slice(0, 20).map(a => [parseFloat(a[0]), parseFloat(a[1])]),
        bids: res.data.bids.slice(0, 20).map(b => [parseFloat(b[0]), parseFloat(b[1])]),
        lastUpdate: Date.now()
      };
    } catch (e) {
      console.error('[CEREBRO] Error OrderBook:', e.message);
    }
  }

  async collectTicker() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/ticker/24hr`, {
        params: { symbol: this.symbol },
        timeout: 5000
      });
      
      this.data.ticker = {
        price: parseFloat(res.data.lastPrice),
        priceChange: parseFloat(res.data.priceChange),
        priceChangePercent: parseFloat(res.data.priceChangePercent),
        high: parseFloat(res.data.highPrice),
        low: parseFloat(res.data.lowPrice),
        volume: parseFloat(res.data.volume),
        quoteVolume: parseFloat(res.data.quoteVolume),
        trades: parseFloat(res.data.count)
      };
    } catch (e) {
      console.error('[CEREBRO] Error Ticker:', e.message);
    }
  }

  async collectFundingRate() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/fundingRate`, {
        params: { symbol: this.symbol, limit: 1 },
        timeout: 5000
      });
      
      if (res.data.length > 0) {
        this.data.funding = {
          rate: parseFloat(res.data[0].fundingRate),
          time: res.data[0].fundingTime
        };
      }
    } catch (e) {
      console.error('[CEREBRO] Error Funding:', e.message);
    }
  }

  async collectOpenInterest() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/openInterest`, {
        params: { symbol: this.symbol },
        timeout: 5000
      });
      
      this.data.openInterest = {
        openInterest: parseFloat(res.data.openInterest),
        time: Date.now()
      };
    } catch (e) {
      console.error('[CEREBRO] Error OI:', e.message);
    }
  }

  async collectLongShortRatio() {
    try {
      const res = await axios.get(`${BASE_URL}/futures/data/globalLongShortAccountRatio`, {
        params: { symbol: this.symbol, period: '5m', limit: 5 },
        timeout: 5000
      });
      
      if (res.data.length > 0) {
        const latest = res.data[0];
        this.data.longShort = {
          longAccount: parseFloat(latest.longAccountRatio),
          shortAccount: parseFloat(latest.shortAccountRatio),
          timestamp: latest.timestamp
        };
      }
    } catch (e) {
      console.error('[CEREBRO] Error L/S:', e.message);
    }
  }

  async collectMarkPrice() {
    try {
      const res = await axios.get(`${BASE_URL}/fapi/v1/premiumIndex`, {
        params: { symbol: this.symbol },
        timeout: 5000
      });
      
      this.data.markPrice = {
        price: parseFloat(res.data.markPrice),
        indexPrice: parseFloat(res.data.indexPrice),
        estimatedSettlePrice: parseFloat(res.data.estimatedSettlePrice),
        lastUpdate: Date.now()
      };
    } catch (e) {
      console.error('[CEREBRO] Error MarkPrice:', e.message);
    }
  }

  getData() {
    return this.data;
  }

  getLatestData() {
    return {
      price: this.data.ticker?.price || 0,
      klines: this.data.klines,
      orderBook: this.data.orderBook,
      funding: this.data.funding,
      openInterest: this.data.openInterest,
      longShort: this.data.longShort,
      markPrice: this.data.markPrice?.price || 0,
      volume: this.data.ticker?.volume || 0,
      lastUpdate: this.data.lastUpdate
    };
  }
}

module.exports = new DataCollector();