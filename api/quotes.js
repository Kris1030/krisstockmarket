// Yahoo Finance proxy - handles cookie/crumb auth + TWSE fallback
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const TW  = ['2330.TW','2303.TW','2454.TW','2408.TW','2379.TW','3711.TW','2337.TW','3034.TW'];
  const US  = ['NVDA','AMD','INTC','ASML','AMAT','LRCX','MU','QCOM','TSM','KLAC','AVGO','ARM','MRVL','ON','TXN'];
  const IDX = ['^TWII','^SOX','^IXIC','^GSPC','^VIX'];
  const FX  = ['TWD=X','JPY=X','EURUSD=X','GC=F','CL=F'];
  const ALL = [...TW,...US,...IDX,...FX];

  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

  // ── Step 1: cookie ──
  let cookie = '';
  try {
    const r = await fetch('https://fc.yahoo.com', {
      headers:{'User-Agent':ua},
      redirect:'follow',
    });
    const sc = r.headers.get('set-cookie') || '';
    cookie = sc.split(';')[0];
  } catch(_){}

  // ── Step 2: crumb ──
  let crumb = '';
  try {
    const r = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers:{'User-Agent':ua,'Cookie':cookie}
    });
    if (r.ok) crumb = (await r.text()).trim();
  } catch(_){}

  // ── Step 3: quotes ──
  const sym = ALL.join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${sym}${crumb?'&crumb='+encodeURIComponent(crumb):''}`;

  try {
    const r = await fetch(url, {
      headers:{
        'User-Agent': ua,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finance.yahoo.com/',
        'Cookie': cookie,
      }
    });
    if (!r.ok) throw new Error(`Yahoo ${r.status}`);
    const data = await r.json();
    const quotes = data?.quoteResponse?.result || [];
    if (!quotes.length) throw new Error('empty');

    const result = { tw:[], us:[], indices:[], forex:[], vix:null, updatedAt:new Date().toISOString() };
    for (const q of quotes) {
      const item = {
        ticker: q.symbol,
        price:  q.regularMarketPrice,
        chg:    q.regularMarketChange,
        chgPct: q.regularMarketChangePercent,
        name:   q.shortName || q.longName || q.symbol,
        prevClose: q.regularMarketPreviousClose,
      };
      if (q.symbol === '^VIX') { result.vix = item; continue; }
      if (TW.includes(q.symbol))  result.tw.push(item);
      else if (US.includes(q.symbol))  result.us.push(item);
      else if (IDX.includes(q.symbol)) result.indices.push(item);
      else if (FX.includes(q.symbol))  result.forex.push(item);
    }

    res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
    return res.status(200).json(result);

  } catch(yahooErr) {
    // ── Fallback: TWSE for TW stocks only ──
    try {
      const twseR = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_AVG_ALL');
      const twseData = twseR.ok ? await twseR.json() : [];
      const twMap = {};
      for (const row of twseData) twMap[row.Code] = row;

      // Also try to get today's real-time data
      const rtR = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
      const rtData = rtR.ok ? await rtR.json() : [];
      const rtMap = {};
      for (const row of rtData) rtMap[row.Code] = row;

      const result = {
        tw: TW.map(t => {
          const code = t.replace('.TW','');
          const avg = twMap[code];
          const rt  = rtMap[code];
          if (!avg && !rt) return null;
          const price    = rt ? parseFloat(rt.ClosingPrice) : parseFloat(avg?.ClosingPrice);
          const prevClose= rt ? parseFloat(rt.OpeningPrice) : null;
          const chg      = (rt && prevClose) ? price - prevClose : null;
          const chgPct   = (chg && prevClose) ? (chg/prevClose)*100 : null;
          return { ticker:t, price, chg, chgPct, name: rt?.Name || avg?.Name || code, prevClose };
        }).filter(Boolean),
        us:[], indices:[], forex:[], vix:null,
        updatedAt: new Date().toISOString(),
        partial: true,
      };
      res.setHeader('Cache-Control','s-maxage=300');
      return res.status(200).json(result);
    } catch(twseErr) {
      return res.status(500).json({ error: yahooErr.message, tw:[], us:[], indices:[], forex:[], vix:null });
    }
  }
}
