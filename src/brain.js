'use strict';

const axios = require('axios');

async function analyzeWithAI(symbol, indicators, futures, sentiment, recentHistory, apiKey) {
  const groqKey = (apiKey && apiKey !== 'demo') ? apiKey : process.env.GROQ_API_KEY;
  const hasValidKey = groqKey && groqKey.length > 10;
  
  if (!hasValidKey) {
    console.log('[BRAIN] Sin API key - usando análisis técnico local');
    const price = parseFloat(indicators.price) || 0;
    const rsi = parseFloat(indicators.rsi) || 50;
    const macdHist = parseFloat(indicators.macd?.histogram) || 0;
    const ema9 = parseFloat(indicators.emas?.ema9) || price;
    const ema21 = parseFloat(indicators.emas?.ema21) || price;
    
    let direction = 'NEUTRAL';
    let confidence = 50;
    let reasons = [];
    let risks = ['Sin validación AI'];
    
    if (rsi < 30) { direction = 'LONG'; confidence = 75; reasons.push('RSI sobrevendido'); }
    else if (rsi > 70) { direction = 'SHORT'; confidence = 75; reasons.push('RSI sobrecomprado'); }
    else if (macdHist > 0 && ema9 > ema21) { direction = 'LONG'; confidence = 70; reasons.push('MACD y EMAs alcistas'); }
    else if (macdHist < 0 && ema9 < ema21) { direction = 'SHORT'; confidence = 70; reasons.push('MACD y EMAs bajistas'); }
    
    return {
      direction,
      confidence,
      entry: price.toFixed(2),
      stopLoss: direction === 'LONG' ? (price * 0.99).toFixed(2) : (price * 1.01).toFixed(2),
      takeProfit: direction === 'LONG' ? (price * 1.02).toFixed(2) : (price * 0.98).toFixed(2),
      riskReward: '2:1',
      timeframe: '1h',
      topReasons: reasons,
      risks,
      sentiment: direction === 'LONG' ? 'BULLISH' : direction === 'SHORT' ? 'BEARISH' : 'NEUTRAL',
      summary: 'Análisis técnico local (sin API key configurada)'
    };
  }

  const historyContext = recentHistory && recentHistory.length > 0
    ? `\nHistorial:` + recentHistory.map(h => `${h.signal} ${h.confidence}%`).join(', ')
    : '';

  const prompt = `Eres trader profesional de Binance Futures. Analiza y genera señal.

PAR: ${symbol}
PRECIO: $${indicators.price}

--- INDICADORES ---
RSI: ${indicators.rsi} (${indicators.rsiStatus})
MACD: ${indicators.macd?.histogram > 0 ? '↑' : '↓'}
EMAs: ${indicators.emas?.ema9}/${indicators.emas?.ema21}/${indicators.emas?.ema50}/${indicators.emas?.ema200}
BB: ${indicators.bollingerBands?.upper}/${indicators.bollingerBands?.middle}/${indicators.bollingerBands?.lower}
ATR: ${indicators.atr}
Stoch: K=${indicators.stoch?.k} D=${indicators.stoch?.d}
VWAP: ${indicators.vwap}
CCI: ${indicators.cci}
Soporte: ${indicators.supportResistance?.support} | Resistencia: ${indicators.supportResistance?.resistance}
Patrones: ${indicators.candlePatterns?.join(', ')}
Volumen: ${indicators.volume?.trend}
Sesgo: ${indicators.bias?.signal} (${indicators.bias?.bullPct}% bullish)

--- FUTUROS ---
Funding: ${futures?.fundingRate}%
OI: ${futures?.openInterest}
L/S: ${futures?.longShortRatio}
Mark: ${futures?.markPrice}

--- SENTIMIENTO ---
Fear&Greed: ${sentiment?.fearGreed?.value}/100 (${sentiment?.fearGreed?.label})
BTC Dom: ${sentiment?.btcDominance?.btcDominance}${historyContext}

Responde JSON:
{
  "direction": "LONG" | "SHORT" | "NEUTRAL",
  "confidence": 0-100,
  "entry": "precio",
  "stopLoss": "precio",
  "takeProfit": "precio",
  "riskReward": "ratio",
  "timeframe": "duración",
  "topReasons": ["razón1", "razón2", "razón3"],
  "risks": ["riesgo1", "riesgo2"],
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "summary": "resumen"
}`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      },
      {
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      }
    );

    const raw = response.data.choices[0].message.content.trim();
    try {
      return JSON.parse(raw);
    } catch {
      return {
        direction: indicators.bias.signal,
        confidence: indicators.bias.bullPct,
        entry: indicators.price,
        stopLoss: (parseFloat(indicators.price) * (indicators.bias.signal === 'LONG' ? 0.98 : 1.02)).toFixed(4),
        takeProfit: (parseFloat(indicators.price) * (indicators.bias.signal === 'LONG' ? 1.02 : 0.98)).toFixed(4),
        riskReward: '1:1',
        timeframe: '4h',
        topReasons: ['Sesgo técnico: ' + indicators.bias.signal],
        risks: ['Volatilidad'],
        sentiment: indicators.bias.signal === 'LONG' ? 'BULLISH' : indicators.bias.signal === 'SHORT' ? 'BEARISH' : 'NEUTRAL',
        summary: 'Análisis basado en indicadores técnicos.'
      };
    }
  } catch (err) {
    throw new Error(`Groq: ${err.response?.data?.error?.message || err.message}`);
  }
}

module.exports = { analyzeWithAI };