export default async function handler(req, res) {
  // Allow CORS from your own frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Tickers to fetch - edit this list anytime
  const TW_TICKERS = [
    '2330.TW', '2303.TW', '2454.TW', '2408.TW',
    '2379.TW', '3711.TW', '2337.TW', '3034.TW'
  ];
  const US_TICKERS = [
    'NVDA', 'AMD', 'INTC', 'ASML', 'AMAT',
    'LRCX', 'MU', 'QCOM', 'TSM', 'KLAC'
  ];
  const INDEX_TICKERS = [
    '^TWII',    // 台灣加權
    '^SOX',     // 費城半導體
    '^IXIC',    // 那斯達克
    '^GSPC',    // S&P 500
    '000001.SS' // 上證
  ];
  const FOREX_TICKERS = [
    'TWD=X',    // USD/TWD
    'JPY=X',    // USD/JPY
    'EURUSD=X', // EUR/USD
    'GC=F',     // 黃金
    'CL=F',     // WTI 原油
  ];

  const allTickers = [...TW_TICKERS, ...US_TICKERS, ...INDEX_TICKERS, ...FOREX_TICKERS];
  const symbols = allTickers.join(',');

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,shortName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned ${response.status}`);
    }

    const data = await response.json();
    const quotes = data?.quoteResponse?.result || [];

    // Structure the response
    const result = {
      tw: [],
      us: [],
      indices: [],
      forex: [],
      updatedAt: new Date().toISOString(),
    };

    for (const q of quotes) {
      const item = {
        ticker: q.symbol,
        price: q.regularMarketPrice,
        chg: q.regularMarketChange,
        chgPct: q.regularMarketChangePercent,
        name: q.shortName || q.symbol,
        prevClose: q.regularMarketPreviousClose,
      };

      if (TW_TICKERS.includes(q.symbol)) result.tw.push(item);
      else if (US_TICKERS.includes(q.symbol)) result.us.push(item);
      else if (INDEX_TICKERS.includes(q.symbol)) result.indices.push(item);
      else if (FOREX_TICKERS.includes(q.symbol)) result.forex.push(item);
    }

    // Cache for 5 minutes on Vercel edge
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.status(200).json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
