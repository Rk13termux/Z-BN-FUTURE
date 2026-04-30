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
  
  // Brain events
  onBrainUpdate: (callback) => ipcRenderer.on('brain-update', (event, data) => callback(data)),
  
  // Event listeners
  onTriggerAnalysis: (callback) => ipcRenderer.on('trigger-analysis', callback),
  onSelectPair: (callback) => ipcRenderer.on('select-pair', (event, pair) => callback(pair)),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback)
});