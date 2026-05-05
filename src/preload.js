'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Binance API
  binanceGetKlines: (symbol, interval, limit) => ipcRenderer.invoke('binance-get-klines', { symbol, interval, limit }),
  binanceGetTicker: (symbol) => ipcRenderer.invoke('binance-get-ticker', { symbol }),
  binanceGetOrderBook: (symbol, limit) => ipcRenderer.invoke('binance-get-orderbook', { symbol, limit }),
  binanceGetFundingRate: (symbol) => ipcRenderer.invoke('binance-get-fundingrate', { symbol }),
  binanceGetOpenInterest: (symbol) => ipcRenderer.invoke('binance-get-openinterest', { symbol }),
  binanceGetLongShortRatio: (symbol, period) => ipcRenderer.invoke('binance-get-longshortratio', { symbol, period }),
  binanceGetMarkPrice: (symbol) => ipcRenderer.invoke('binance-get-markprice', { symbol }),
  
  // Indicators & Analysis
  calculateIndicators: (klines) => ipcRenderer.invoke('calculate-indicators', { klines }),
  getSentiment: () => ipcRenderer.invoke('get-sentiment'),
  analyzeWithAI: (symbol, indicators, futures, sentiment, history, apiKey) => ipcRenderer.invoke('analyze-with-ai', { symbol, indicators, futures, sentiment, history, apiKey }),
  
  analyzeVolatility: (symbol, days) => ipcRenderer.invoke('analyze-volatility', { symbol, days }),
  analyzeMarketStructure: (symbol) => ipcRenderer.invoke('analyze-market-structure', { symbol }),
  generateStrategySignal: (symbol) => ipcRenderer.invoke('generate-strategy-signal', { symbol }),
  
  // System
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
  
  // Brain Module
  brainStart: (symbol) => ipcRenderer.invoke('brain-start', { symbol }),
  brainStop: () => ipcRenderer.invoke('brain-stop'),
  brainGetStatus: () => ipcRenderer.invoke('brain-get-status'),
  brainGetAnalysis: () => ipcRenderer.invoke('brain-get-analysis'),
  brainChangeSymbol: (symbol) => ipcRenderer.invoke('brain-change-symbol', { symbol }),
  brainGetSimulatorStats: () => ipcRenderer.invoke('brain-get-simulator-stats'),
  brainGetSimulatorTrades: (count) => ipcRenderer.invoke('brain-get-simulator-trades', { count }),
  brainReset: () => ipcRenderer.invoke('brain-reset'),
  brainUpdateConfig: (config) => ipcRenderer.invoke('brain-update-config', { config }),
  
  // Real-time Data Manager
  realtimeStart: (symbol) => ipcRenderer.invoke('realtime-start', { symbol }),
  realtimeStop: () => ipcRenderer.invoke('realtime-stop'),
  realtimeGetLatest: () => ipcRenderer.invoke('realtime-get-latest'),
  realtimeChangeSymbol: (symbol) => ipcRenderer.invoke('realtime-change-symbol', { symbol }),
  
  // Event listeners
  onRealtimeData: (callback) => ipcRenderer.on('realtime-data', (event, data) => callback(data)),
  onTradingSignal: (callback) => ipcRenderer.on('trading-signal', (event, signal) => callback(signal)),
  onMarketDataUpdate: (callback) => ipcRenderer.on('market-data-update', (event, data) => callback(data)),
  onTradeReady: (callback) => ipcRenderer.on('trade-ready', (event, data) => callback(data)),
  onBrainUpdate: (callback) => ipcRenderer.on('brain-update', (event, data) => callback(data)),
  onTriggerAnalysis: (callback) => ipcRenderer.on('trigger-analysis', callback),
  onSelectPair: (callback) => ipcRenderer.on('select-pair', (event, pair) => callback(pair)),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
  onIndicatorsUpdate: (callback) => ipcRenderer.on('indicators-update', (event, data) => callback(data)),
  
  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  openDevTools: () => ipcRenderer.invoke('open-dev-tools')
});