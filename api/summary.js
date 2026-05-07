const FINNHUB_KEY = 'd7ubjthr01qnv95n08pgd7ubjthr01qnv95n08q0';

const NAME_MAP = {
  NVDA:'輝達', TSM:'台積電ADR', AMD:'超微', ASML:'艾司摩爾',
  MU:'美光', INTC:'英特爾', AVGO:'博通', QCOM:'高通',
  AMAT:'應材', LRCX:'拉姆', KLAC:'科磊', ARM:'安謀',
};

async function getQuotes(tickers) {
  const results = await Promise.allSettled(
    tickers.map(t =>
      fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${FINNHUB_KEY}`)
        .then(r => r.json())
        .then(d => ({ ticker:t, name:NAME_MAP[t]||t, price:d.c, chg:d.d, chgPct:d.dp }))
    )
  );
  return results
    .filter(r => r.status==='fulfilled' && r.value?.price)
    .map(r => r.value);
}

function generateSummary(stocks, vixPrice) {
  if (!stocks.length) return '今日市場資料載入中，請稍後刷新。';

  const up   = stocks.filter(s => s.chgPct >  0.5).sort((a,b) => b.chgPct - a.chgPct);
  const down = stocks.filter(s => s.chgPct < -0.5).sort((a,b) => a.chgPct - b.chgPct);
  const flat = stocks.filter(s => Math.abs(s.chgPct) <= 0.5);
  const avg  = stocks.reduce((s,x) => s+(x.chgPct||0),0) / stocks.length;

  // Sentiment
  let sentiment, sentimentDetail;
  if (avg >= 2)        { sentiment='強勢上漲';   sentimentDetail='AI需求強勁，資金積極進場'; }
  else if (avg >= 0.8) { sentiment='小幅上漲';   sentimentDetail='市場情緒偏樂觀，買氣溫和'; }
  else if (avg >= 0)   { sentiment='盤整偏多';   sentimentDetail='多空分歧，觀望情緒較重'; }
  else if (avg >= -0.8){ sentiment='小幅回落';   sentimentDetail='短線獲利了結壓力浮現'; }
  else if (avg >= -2)  { sentiment='明顯走弱';   sentimentDetail='市場風險偏好下降，資金保守'; }
  else                  { sentiment='大幅下跌';   sentimentDetail='恐慌情緒蔓延，避險需求升溫'; }

  // Top movers
  const topUp   = up.slice(0,3).map(s=>`${s.name}(+${s.chgPct.toFixed(1)}%)`).join('、');
  const topDown = down.slice(0,2).map(s=>`${s.name}(${s.chgPct.toFixed(1)}%)`).join('、');

  // Sector analysis
  const equipStocks = stocks.filter(s => ['ASML','AMAT','LRCX','KLAC'].includes(s.ticker));
  const memStocks   = stocks.filter(s => ['MU'].includes(s.ticker));
  const avgEquip    = equipStocks.length ? equipStocks.reduce((s,x)=>s+x.chgPct,0)/equipStocks.length : null;
  const avgMem      = memStocks.length ? memStocks.reduce((s,x)=>s+x.chgPct,0)/memStocks.length : null;

  // VIX comment
  let vixComment = '';
  if (vixPrice != null) {
    if (vixPrice > 30)      vixComment = `VIX 恐慌指數升至 ${vixPrice.toFixed(1)}，市場波動明顯放大，操作宜保守。`;
    else if (vixPrice > 20) vixComment = `VIX ${vixPrice.toFixed(1)} 顯示市場波動偏高，注意風險控管。`;
    else                    vixComment = `VIX ${vixPrice.toFixed(1)} 維持低位，市場情緒相對穩定。`;
  }

  // Build summary
  const parts = [];
  parts.push(`今日半導體板塊整體${sentiment}（平均 ${avg>=0?'+':''}${avg.toFixed(2)}%），${sentimentDetail}。`);
  if (topUp)   parts.push(`漲幅領先：${topUp}。`);
  if (topDown) parts.push(`相對落後：${topDown}。`);
  if (avgEquip !== null) {
    const trend = avgEquip >= 0 ? '走強' : '走弱';
    parts.push(`半導體設備族群${trend}（平均 ${avgEquip>=0?'+':''}${avgEquip.toFixed(1)}%），反映設備投資週期動向。`);
  }
  if (avgMem !== null) {
    const memTrend = avgMem >= 0 ? '回升' : '承壓';
    parts.push(`記憶體族群${memTrend}，HBM 供需動態持續牽動整體情緒。`);
  }
  if (vixComment) parts.push(vixComment);

  return parts.join('');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const tickers = ['NVDA','TSM','AMD','ASML','MU','INTC','AVGO','QCOM','AMAT','LRCX','KLAC','ARM'];

  // Fetch stocks + VIX in parallel
  const [stocks, vixRes] = await Promise.allSettled([
    getQuotes(tickers),
    fetch(`https://finnhub.io/api/v1/quote?symbol=VIX&token=${FINNHUB_KEY}`).then(r=>r.json()),
  ]);

  const stockData = stocks.status==='fulfilled' ? stocks.value : [];
  const vixPrice  = vixRes.status==='fulfilled' ? vixRes.value?.c : null;

  const summary = generateSummary(stockData, vixPrice);

  res.setHeader('Cache-Control','s-maxage=1800,stale-while-revalidate=300');
  return res.status(200).json({
    summary,
    stocks: stockData,
    vix: vixPrice,
    updatedAt: new Date().toISOString(),
  });
}
