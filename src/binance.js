'use strict';

const axios = require('axios');

const BASE_URL = 'https://fapi.binance.com';

async function publicGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${query ? '?' + query : ''}`;
  const res = await axios.get(url, { timeout: 15000 });
  return res.data;
}

async function getKlines(symbol, interval = '15m', limit = 100) {
  const data = await publicGet('/fapi/v1/klines', { symbol, interval, limit });
  return data.map(k => ({
    openTime: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
    closeTime: k[6],
  }));
}

async function getTicker(symbol) {
  return publicGet('/fapi/v1/ticker/24hr', { symbol });
}

async function getOrderBook(symbol, limit = 20) {
  return publicGet('/fapi/v1/depth', { symbol, limit });
}

async function getFundingRate(symbol) {
  const data = await publicGet('/fapi/v1/fundingRate', { symbol, limit: 1 });
  return data[0] || null;
}

async function getOpenInterest(symbol) {
  return publicGet('/fapi/v1/openInterest', { symbol });
}

async function getLongShortRatio(symbol, period = '15m') {
  return publicGet('/futures/data/globalLongShortAccountRatio', { symbol, period, limit: 1 });
}

async function getMarkPrice(symbol) {
  return publicGet('/fapi/v1/premiumIndex', { symbol });
}

module.exports = {
  getKlines,
  getTicker,
  getOrderBook,
  getFundingRate,
  getOpenInterest,
  getLongShortRatio,
  getMarkPrice,
};