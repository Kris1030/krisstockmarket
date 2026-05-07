const ALPHA_KEY = 'QZT6YZJL3LG5911S';

// Alpha Vantage symbol mapping
const SYMBOLS = {
  tw: [
    { ticker:'2330.TW', av:'2330.TW', name:'台積電', sector:'晶圓代工' },
    { ticker:'2303.TW', av:'2303.TW', name:'聯電', sector:'晶圓代工' },
    { ticker:'2454.TW', av:'2454.TW', name:'聯發科', sector:'IC設計' },
    { ticker:'2408.TW', av:'2408.TW', name:'南亞科', sector:'記憶體' },
    { ticker:'2379.TW', av:'2379.TW', name:'瑞昱', sector:'IC設計' },
    { ticker:'3711.TW', av:'3711.TW', name:'日月光', sector:'封測' },
    { ticker:'2337.TW', av:'2337.TW', name:'旺宏', sector:'記憶體' },
    { ticker:'3034.TW', av:'3034.TW', name:'聯詠', sector:'IC設計' },
  ],
  us: [
    { ticker:'NVDA', name:'輝達', sector:'GPU/AI' },
    { ticker:'AMD', name:'超微', sector:'CPU/GPU' },
    { ticker:'INTC', name:'英特爾', sector:'CPU' },
    { ticker:'ASML', name:'艾司摩爾', sector:'半導體設備' },
    { ticker:'AMAT', name:'應用材料', sector:'半導體設備' },
    { ticker:'LRCX', name:'拉姆研究', sector:'半導體設備' },
    { ticker:'MU', name:'美光', sector:'記憶體' },
    { ticker:'QCOM', name:'高通', sector:'IC設計' },
    { ticker:'TSM', name:'台積電ADR', sector:'晶圓代工' },
    { ticker:'KLAC', name:'科磊', sector:'半導體設備' },
  ],
  indices: [
    { ticker:'^TWII', name:'台灣加權' },
    { ticker:'^SOX', av:'SOXX', name:'費城半導體' }, // use ETF as proxy
    { ticker:'^IXIC', av:'QQQ', name:'那斯達克' },
    { ticker:'^GSPC', av:'SPY', name:'S&P 500' },
  ],
  forex: [
    { ticker:'TWD=X', av:'USD/TWD', name:'USD/TWD' },
    { ticker:'JPY=X', av:'USD/JPY', name:'USD/JPY' },
    { ticker:'EURUSD=X', av:'EUR/USD', name:'EUR/USD' },
    { ticker:'GC=F', av:'XAU', name:'黃金 XAU/USD' },
    { ticker:'CL=F', av:'WTI', name:'WTI 原油' },
  ]
};

async function fetchQuote(symbol) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`AV ${res.status}`);
  const data = await res.json();
  const q = data['Global Quote'];
  if (!q || !q['05. price']) return null;
  const price = parseFloat(q['05. price']);
  const chg = parseFloat(q['09. change']);
  const chgPct = parseFloat(q['10. change percent']?.replace('%',''));
  return { price, chg, chgPct };
}

async function fetchForex(fromCurrency, toCurrency) {
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=${fromCurrency}&to_currency=${toCurrency}&apikey=${ALPHA_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const rate = data['Realtime Currency Exchange Rate'];
  if (!rate) return null;
  return { price: parseFloat(rate['5. Exchange Rate']), chg: null, chgPct: null };
}

// Fallback: TWSE open API for Taiwan stocks
async function fetchTWSE() {
  try {
    const res = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL');
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const row of data) map[row.Code] = row;
    return map;
  } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const result = { tw:[], us:[], indices:[], forex:[], updatedAt: new Date().toISOString() };

  // Fetch all in parallel (Alpha Vantage free tier: 25 req/day, so batch wisely)
  // For free tier, fetch top stocks only to stay within limit
  // Priority: 台積電, NVDA, AMD, ASML, MU + indices
  const priorityUS = ['NVDA','AMD','ASML','MU','TSM','INTC','QCOM','AMAT'];
  const priorityTW = ['2330.TW','2303.TW','2454.TW'];

  const fetchTasks = [];

  // US stocks
  for (const s of SYMBOLS.us) {
    if (priorityUS.includes(s.ticker)) {
      fetchTasks.push(
        fetchQuote(s.ticker).then(q => {
          if (q) result.us.push({ ticker:s.ticker, name:s.name, sector:s.sector, market:'us', ...q });
        }).catch(()=>{})
      );
    }
  }

  // TW stocks - use TWSE as primary (unlimited)
  const twseTask = fetchTWSE().then(twMap => {
    for (const s of SYMBOLS.tw) {
      const code = s.ticker.replace('.TW','');
      const row = twMap[code];
      if (row) {
        const price = parseFloat(row.ClosingPrice) || null;
        result.tw.push({ ticker:s.ticker, name:s.name, sector:s.sector, market:'tw', price, chg:null, chgPct:null });
      }
    }
  }).catch(()=>{});

  fetchTasks.push(twseTask);

  // Forex - USD/TWD and USD/JPY
  fetchTasks.push(
    fetchForex('USD','TWD').then(q => {
      if (q) result.forex.push({ ticker:'TWD=X', name:'USD/TWD', ...q });
    }).catch(()=>{})
  );
  fetchTasks.push(
    fetchForex('USD','JPY').then(q => {
      if (q) result.forex.push({ ticker:'JPY=X', name:'USD/JPY', ...q });
    }).catch(()=>{})
  );
  fetchTasks.push(
    fetchForex('EUR','USD').then(q => {
      if (q) result.forex.push({ ticker:'EURUSD=X', name:'EUR/USD', ...q });
    }).catch(()=>{})
  );

  // Index proxies via ETF
  fetchTasks.push(
    fetchQuote('SOXX').then(q => {
      if (q) result.indices.push({ ticker:'^SOX', name:'費城半導體(SOXX)', ...q });
    }).catch(()=>{})
  );
  fetchTasks.push(
    fetchQuote('QQQ').then(q => {
      if (q) result.indices.push({ ticker:'^IXIC', name:'那斯達克(QQQ)', ...q });
    }).catch(()=>{})
  );
  fetchTasks.push(
    fetchQuote('SPY').then(q => {
      if (q) result.indices.push({ ticker:'^GSPC', name:'S&P 500(SPY)', ...q });
    }).catch(()=>{})
  );

  await Promise.allSettled(fetchTasks);

  res.setHeader('Cache-Control','s-maxage=1800,stale-while-revalidate=300');
  return res.status(200).json(result);
}
