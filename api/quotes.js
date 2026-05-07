const FINNHUB_KEY = 'd7ubjthr01qnv95n08pgd7ubjthr01qnv95n08q0';

const TW_TICKERS = ['2330.TW','2303.TW','2454.TW','2408.TW','2379.TW','3711.TW','2337.TW','3034.TW','2382.TW','2317.TW','6669.TW','2308.TW'];
const US_TICKERS = ['NVDA','AMD','INTC','ASML','AMAT','LRCX','MU','QCOM','TSM','KLAC','AVGO','ARM','MRVL','ON','TXN','NXPI'];
const INDEX_TICKERS = ['^TWII','^SOX','^IXIC','^GSPC','^VIX'];
const FOREX_PAIRS = [
  { symbol:'USD/TWD', from:'USD', to:'TWD', ticker:'TWD=X', name:'USD/TWD' },
  { symbol:'USD/JPY', from:'USD', to:'JPY', ticker:'JPY=X', name:'USD/JPY' },
  { symbol:'EUR/USD', from:'EUR', to:'USD', ticker:'EURUSD=X', name:'EUR/USD' },
];

async function finnhubQuote(symbol) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  const r = await fetch(url, { headers:{ 'X-Finnhub-Token': FINNHUB_KEY } });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.c || d.c === 0) return null;
  return {
    price:  d.c,
    chg:    d.d,
    chgPct: d.dp,
    prevClose: d.pc,
  };
}

async function finnhubForex(from, to) {
  // Use OANDA format for real-time forex rates
  const symbol = `OANDA:${from}_${to}`;
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`;
  const r = await fetch(url, { headers:{ 'X-Finnhub-Token': FINNHUB_KEY } });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.c || d.c === 0) return null;
  return { price: d.c, chg: d.d, chgPct: d.dp };
}

// TWSE fallback for TW stocks
async function fetchTWSE() {
  try {
    const [avgR, dayR] = await Promise.all([
      fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL'),
      fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'),
    ]);
    const avgData = avgR.ok ? await avgR.json() : [];
    const dayData = dayR.ok ? await dayR.json() : [];
    const avgMap = {}, dayMap = {};
    for (const r of avgData) avgMap[r.Code] = r;
    for (const r of dayData) dayMap[r.Code] = r;
    return { avgMap, dayMap };
  } catch { return { avgMap:{}, dayMap:{} }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const result = { tw:[], us:[], indices:[], forex:[], vix:null, updatedAt:new Date().toISOString() };

  // Batch all fetches in parallel
  const tasks = [];

  // US stocks
  for (const ticker of US_TICKERS) {
    tasks.push(
      finnhubQuote(ticker).then(q => {
        if (q) result.us.push({ ticker, ...q });
      }).catch(()=>{})
    );
  }

  // Indices - Finnhub symbol mapping
  const idxList = [
    { yf:'^GSPC', fh:'SPX',  name:'S&P 500' },
    { yf:'^IXIC', fh:'COMP', name:'那斯達克' },
    { yf:'^DJI',  fh:'DJIA', name:'道瓊' },
    { yf:'^SOX',  fh:'SOX',  name:'費城半導體' },
    { yf:'^TWII', fh:'TWII', name:'台灣加權' },
    { yf:'^VIX',  fh:'VIX',  name:'VIX 恐慌' },
  ];
  for (const idx of idxList) {
    tasks.push(
      finnhubQuote(idx.fh).then(q => {
        if (!q) return;
        if (idx.yf === '^VIX') result.vix = { ticker:idx.yf, name:idx.name, ...q };
        else result.indices.push({ ticker:idx.yf, name:idx.name, ...q });
      }).catch(()=>{})
    );
  }

  // Forex
  for (const fx of FOREX_PAIRS) {
    tasks.push(
      finnhubForex(fx.from, fx.to).then(q => {
        if (q) result.forex.push({ ticker:fx.ticker, name:fx.name, ...q });
      }).catch(()=>{})
    );
  }

  /// Gold & Oil
  tasks.push(
    finnhubForex('XAU','USD').then(q => {
      if (q) result.forex.push({ ticker:'GC=F', name:'黃金 XAU/USD', ...q });
    }).catch(()=>{})
  );
  tasks.push(
    finnhubForex('XBR','USD').then(q => {
      if (q) result.forex.push({ ticker:'CL=F', name:'布蘭特原油', ...q });
    }).catch(()=>{})
  );

  // TW stocks - try Finnhub first, fallback to TWSE
  const twsePromise = fetchTWSE();
  for (const ticker of TW_TICKERS) {
    const fhSymbol = ticker.replace('.TW', '') + '.T'; // Finnhub TW format
    tasks.push(
      finnhubQuote(fhSymbol).then(q => {
        if (q) result.tw.push({ ticker, ...q });
      }).catch(()=>{})
    );
  }

  await Promise.allSettled(tasks);

  // Fill missing TW stocks from TWSE
  const missingTW = TW_TICKERS.filter(t => !result.tw.find(s => s.ticker === t));
  if (missingTW.length > 0) {
    const { avgMap, dayMap } = await twsePromise;
    for (const ticker of missingTW) {
      const code = ticker.replace('.TW','');
      const day = dayMap[code];
      const avg = avgMap[code];
      if (!day && !avg) continue;
      const price    = parseFloat(day?.ClosingPrice || avg?.ClosingPrice) || null;
      const open     = parseFloat(day?.OpeningPrice) || null;
      const chg      = (price && open) ? price - open : null;
      const chgPct   = (chg && open)   ? (chg/open)*100 : null;
      result.tw.push({ ticker, price, chg, chgPct, name: day?.Name || avg?.Name || code });
    }
  }

  res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
  return res.status(200).json(result);
}
