'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let isQuitting = false;

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
  const klines = await binance.getKlines(symbol, '4h', 200);
  return marketStructure.analyzeMarketStructure(klines);
});

ipcMain.handle('generate-strategy-signal', async (event, { symbol }) => {
  const binance = require('./binance.js');
  const volatility = require('./volatility.js');
  const marketStructure = require('./marketStructure.js');
  const signals = require('./signals.js');
  const indicators = require('./indicators.js');
  
  const klines4h = await binance.getKlines(symbol, '4h', 200);
  const klines1h = await binance.getKlines(symbol, '1h', 168);
  
  const marketData = marketStructure.analyzeMarketStructure(klines4h);
  const ind = indicators.analyzeAll(klines1h);
  const volData = volatility.analyzeVolatility(klines1h, 30);
  
  return signals.generateSignal(marketData, ind, volData);
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