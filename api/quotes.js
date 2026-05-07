export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TW_TICKERS = ['2330.TW','2303.TW','2454.TW','2408.TW','2379.TW','3711.TW','2337.TW','3034.TW'];
  const US_TICKERS = ['NVDA','AMD','INTC','ASML','AMAT','LRCX','MU','QCOM','TSM','KLAC'];
  const INDEX_TICKERS = ['^TWII','^SOX','^IXIC','^GSPC','000001.SS'];
  const FOREX_TICKERS = ['TWD=X','JPY=X','EURUSD=X','GC=F','CL=F'];
  const allTickers = [...TW_TICKERS,...US_TICKERS,...INDEX_TICKERS,...FOREX_TICKERS];

  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  // Step 1: get cookie + crumb
  let cookie = '';
  let crumb = '';
  try {
    const r1 = await fetch('https://fc.yahoo.com', { headers:{'User-Agent':ua} });
    const sc = r1.headers.get('set-cookie') || '';
    cookie = sc.split(';')[0];

    const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers:{ 'User-Agent':ua, 'Cookie':cookie }
    });
    if (r2.ok) crumb = await r2.text();
  } catch(_) {}

  // Step 2: fetch quotes
  const sym = allTickers.join(',');
  const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb ? '&crumb='+encodeURIComponent(crumb) : ''}`;

  try {
    const response = await fetch(quoteUrl, {
      headers:{
        'User-Agent': ua,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com',
        'Cookie': cookie,
      }
    });

    if (!response.ok) throw new Error(`Yahoo ${response.status}`);
    const data = await response.json();
    const quotes = data?.quoteResponse?.result || [];
    if (!quotes.length) throw new Error('empty');

    const result = { tw:[], us:[], indices:[], forex:[], updatedAt: new Date().toISOString() };
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

    res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
    return res.status(200).json(result);

  } catch(err) {
    // Fallback: TWSE open API (台股only, 免登入)
    try {
      const twseRes = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL');
      if (twseRes.ok) {
        const twseData = await twseRes.json();
        const twMap = {};
        for (const row of twseData) twMap[row.Code] = row;

        const result = {
          tw: TW_TICKERS.map(t => {
            const code = t.replace('.TW','');
            const row = twMap[code];
            if (!row) return null;
            return { ticker:t, price:parseFloat(row.ClosingPrice)||null, chg:null, chgPct:null, name:row.Name||code };
          }).filter(Boolean),
          us:[], indices:[], forex:[],
          updatedAt: new Date().toISOString(),
          partial: true,
        };
        return res.status(200).json(result);
      }
    } catch(_) {}

    return res.status(500).json({ error: err.message, tw:[], us:[], indices:[], forex:[] });
  }
}
