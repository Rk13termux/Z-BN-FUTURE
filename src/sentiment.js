'use strict';

const axios = require('axios');

async function getFearGreed() {
  try {
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 8000 });
    const d = res.data.data[0];
    return {
      value: parseInt(d.value),
      label: d.value_classification,
    };
  } catch {
    return { value: null, label: 'No disponible' };
  }
}

async function getBTCDominance() {
  try {
    const res = await axios.get('https://api.coingecko.com/api/v3/global', { timeout: 8000 });
    const dom = res.data.data.market_cap_percentage.btc;
    return { btcDominance: dom.toFixed(2) + '%' };
  } catch {
    return { btcDominance: 'N/A' };
  }
}

async function getSentimentSummary() {
  const [fg, dom] = await Promise.all([getFearGreed(), getBTCDominance()]);
  return { fearGreed: fg, btcDominance: dom };
}

module.exports = { getSentimentSummary };