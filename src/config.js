'use strict';

const fs = require('fs');
const path = require('path');

let config = {};

try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          config[key.trim()] = valueParts.join('=').trim();
        }
      }
    });
    console.log('[CONFIG] Archivo .env cargado');
  }
} catch (e) {
  console.log('[CONFIG] Sin archivo .env - usando valores por defecto');
}

module.exports = {
  get: (key, defaultValue = null) => config[key] || defaultValue,
  
  binance: {
    apiKey: config.BINANCE_API_KEY || '',
    secretKey: config.BINANCE_SECRET_KEY || '',
    baseUrl: 'https://fapi.binance.com',
    usePublicEndpoints: !config.BINANCE_API_KEY
  },
  
  groq: {
    apiKey: config.GROQ_API_KEY || ''
  },
  
  defaults: {
    symbol: config.DEFAULT_SYMBOL || 'BTCUSDT',
    timeframe: config.DEFAULT_TIMEFRAME || '1m'
  }
};