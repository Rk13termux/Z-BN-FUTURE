'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config.js');

console.log('[MAIN] Config cargada:', config.defaults);
console.log('[MAIN] Binance:', config.binance.usePublicEndpoints ? 'Endpoints públicos' : 'Con API Key');

let mainWindow;
let tray;
let isQuitting = false;
let dataManager = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0b0b0b',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false,
    frame: true
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('Binance Futures App started');
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

const createTray = () => {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  let trayIcon = nativeImage.createEmpty();
  
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Binance Futures Bot');
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { label: 'Analysis', click: () => mainWindow.webContents.send('trigger-analysis') },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
};

app.whenReady().then(() => {
  console.log('Creating window...');
  createWindow();
  createTray();
  console.log('App initialized');
  
  app.on('activate', () => {
    if (mainWindow === null) createWindow();
    else mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { isQuitting = true; });

// Binance API IPC handlers
ipcMain.handle('binance-get-klines', async (event, { symbol, interval, limit }) => {
  const binance = require('./binance.js');
  return await binance.getKlines(symbol, interval, limit);
});

ipcMain.handle('binance-get-ticker', async (event, { symbol }) => {
  const binance = require('./binance.js');
  return await binance.getTicker(symbol);
});

ipcMain.handle('binance-get-orderbook', async (event, { symbol, limit }) => {
  const binance = require('./binance.js');
  return await binance.getOrderBook(symbol, limit);
});

ipcMain.handle('binance-get-fundingrate', async (event, { symbol }) => {
  const binance = require('./binance.js');
  return await binance.getFundingRate(symbol);
});

ipcMain.handle('binance-get-openinterest', async (event, { symbol }) => {
  const binance = require('./binance.js');
  return await binance.getOpenInterest(symbol);
});

ipcMain.handle('binance-get-longshortratio', async (event, { symbol, period }) => {
  const binance = require('./binance.js');
  return await binance.getLongShortRatio(symbol, period);
});

ipcMain.handle('binance-get-markprice', async (event, { symbol }) => {
  const binance = require('./binance.js');
  return await binance.getMarkPrice(symbol);
});

ipcMain.handle('calculate-indicators', async (event, { klines }) => {
  const indicators = require('./indicators.js');
  return indicators.analyzeAll(klines);
});

ipcMain.handle('get-sentiment', async () => {
  const sentiment = require('./sentiment.js');
  return await sentiment.getSentimentSummary();
});

ipcMain.handle('analyze-with-ai', async (event, { symbol, indicators, futures, sentiment, history, apiKey }) => {
  const brain = require('./brain.js');
  return await brain.analyzeWithAI(symbol, indicators, futures, sentiment, history, apiKey);
});

ipcMain.handle('show-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
  return true;
});

ipcMain.handle('analyze-volatility', async (event, { symbol, days }) => {
  const binance = require('./binance.js');
  const volatility = require('./volatility.js');
  const klines = await binance.getKlines(symbol, '1h', days * 24);
  return {
    analysis: volatility.analyzeVolatility(klines, days),
    pattern: volatility.detectVolatilityPattern(volatility.analyzeVolatility(klines, days)),
    prediction: volatility.predictNextDayVolatility(volatility.analyzeVolatility(klines, days))
  };
});

ipcMain.handle('analyze-market-structure', async (event, { symbol }) => {
  const binance = require('./binance.js');
  const marketStructure = require('./marketStructure.js');
  const klines4h = await binance.getKlines(symbol, '4h', 200);
  const klines15m = await binance.getKlines(symbol, '15m', 200);
  
  const marketData4h = marketStructure.analyzeMarketStructure(klines4h);
  const marketData15m = marketStructure.analyzeMarketStructure(klines15m);
  
  return {
    ...marketData4h,
    trend15m: marketData15m?.trend || 'LATERAL',
    trendStrength15m: marketData15m?.trendStrength || 0,
    price15m: marketData15m?.price
  };
});

ipcMain.handle('generate-strategy-signal', async (event, { symbol }) => {
  const binance = require('./binance.js');
  const volatility = require('./volatility.js');
  const marketStructure = require('./marketStructure.js');
  const signals = require('./signals.js');
  const indicators = require('./indicators.js');
  const OrderFlow = require('./orderFlow.js');
  const orderFlowEngine = new OrderFlow();
  
  const klines4h = await binance.getKlines(symbol, '4h', 200);
  const klines15m = await binance.getKlines(symbol, '15m', 200);
  const klines1h = await binance.getKlines(symbol, '1h', 168);
  const klines1m = await binance.getKlines(symbol, '1m', 100);
  
  const ticker = await binance.getTicker(symbol);
  const depth = await binance.getOrderBook(symbol, 20);
  
  const marketData4h = marketStructure.analyzeMarketStructure(klines4h);
  const marketData15m = marketStructure.analyzeMarketStructure(klines15m);
  const marketData = {
    ...marketData4h,
    trend15m: marketData15m?.trend || 'LATERAL',
    trendStrength15m: marketData15m?.trendStrength || 0
  };
  
  const ind = indicators.analyzeAll(klines1h);
  const volData = volatility.analyzeVolatility(klines1h, 30);
  
  orderFlowEngine.processTicker({ price: parseFloat(ticker.lastPrice), volume: parseFloat(ticker.volume), buyVolume: parseFloat(ticker.buyVolume) || 0, sellVolume: (parseFloat(ticker.quoteVolume) - parseFloat(ticker.buyVolume)) || 0 });
  orderFlowEngine.processDepth(depth);
  if (klines1m && klines1m.length > 0) {
    orderFlowEngine.processKline(klines1m[klines1m.length - 1]);
  }
  const ofData = orderFlowEngine.getAnalysis();
  
  const signalData = signals.generateSignal(marketData, ind, volData);
  
  return {
    ...signalData,
    realtime: {
      price: parseFloat(ticker.lastPrice),
      priceChange: parseFloat(ticker.priceChangePercent),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume24h: parseFloat(ticker.volume),
      quoteVolume24h: parseFloat(ticker.quoteVolume),
      fundingRate: parseFloat(ticker.fundingRate || 0) * 100,
      orderFlow: ofData,
      buyVolume: parseFloat(ticker.buyVolume),
      sellVolume: parseFloat(ticker.quoteVolume) - parseFloat(ticker.buyVolume)
    },
    indicators: ind,
    marketData: marketData,
    volatility: volData
  };
});

// ==================== BRAIN MODULE ====================
ipcMain.handle('brain-start', async (event, { symbol }) => {
  const brain = require('./brain/index.js');
  await brain.start(symbol || 'BTCUSDT');
  return { success: true, message: 'Cerebro iniciado' };
});

ipcMain.handle('brain-stop', async () => {
  const brain = require('./brain/index.js');
  brain.stop();
  return { success: true, message: 'Cerebro detenido' };
});

ipcMain.handle('brain-get-status', async () => {
  const brain = require('./brain/index.js');
  return brain.getStatus();
});

ipcMain.handle('brain-get-analysis', async () => {
  const brain = require('./brain/index.js');
  return brain.getAnalysis();
});

ipcMain.handle('brain-change-symbol', async (event, { symbol }) => {
  const brain = require('./brain/index.js');
  brain.changeSymbol(symbol);
  return { success: true };
});

ipcMain.handle('brain-get-simulator-stats', async () => {
  const brain = require('./brain/index.js');
  return brain.getSimulatorStats();
});

ipcMain.handle('brain-get-simulator-trades', async (event, { count }) => {
  const brain = require('./brain/index.js');
  return brain.getSimulatorTrades(count || 20);
});

ipcMain.handle('brain-reset', async () => {
  const brain = require('./brain/index.js');
  brain.resetBrain();
  return { success: true, message: 'Cerebro reiniciado' };
});

ipcMain.handle('brain-update-config', async (event, { config }) => {
  const brain = require('./brain/index.js');
  brain.updateSimulatorConfig(config);
  return { success: true };
});

// ==================== REAL-TIME DATA MANAGER ====================
ipcMain.handle('realtime-start', async (event, { symbol }) => {
  try {
    const dataManager = require('./dataManager.js');
    await dataManager.start(symbol || 'BTCUSDT');
    
    dataManager.subscribe((data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('realtime-data', data);
      }
    });
    
    dataManager.onSignal((signal) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('trading-signal', signal);
      }
    });
    
    return { success: true, message: 'Datos en tiempo real activados' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('realtime-stop', async () => {
  if (dataManager) {
    dataManager.stop();
  }
  return { success: true, message: 'Datos en tiempo real detenidos' };
});

ipcMain.handle('realtime-get-latest', async () => {
  if (dataManager) {
    return dataManager.getLatestData();
  }
  return {};
});

ipcMain.handle('realtime-change-symbol', async (event, { symbol }) => {
  if (dataManager) {
    dataManager.changeSymbol(symbol);
  }
  return { success: true };
});

ipcMain.handle('get-config', async () => {
  return {
    symbol: config.defaults.symbol,
    timeframe: config.defaults.timeframe,
    hasGroqKey: !!config.groq.apiKey,
    hasBinanceKey: !!config.binance.apiKey
  };
});