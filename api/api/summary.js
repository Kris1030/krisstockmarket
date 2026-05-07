const FINNHUB_KEY = 'd7ubjthr01qnv95n08pgd7ubjthr01qnv95n08q0';

async function getTopMovers() {
  try {
    const tickers = ['NVDA','TSM','AMD','ASML','MU','INTC','AVGO','QCOM'];
    const results = await Promise.allSettled(
      tickers.map(t =>
        fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${FINNHUB_KEY}`)
          .then(r => r.json())
          .then(d => ({ ticker:t, price:d.c, chg:d.d, chgPct:d.dp }))
      )
    );
    return results
      .filter(r => r.status === 'fulfilled' && r.value.price)
      .map(r => r.value);
  } catch { return []; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const stocks = await getTopMovers();

  // Build a market snapshot string for Claude to analyze
  const up   = stocks.filter(s => s.chgPct > 0).sort((a,b) => b.chgPct - a.chgPct);
  const down = stocks.filter(s => s.chgPct <= 0).sort((a,b) => a.chgPct - b.chgPct);
  const avgChg = stocks.length ? (stocks.reduce((s,x) => s + (x.chgPct||0), 0) / stocks.length).toFixed(2) : 0;
  const sentiment = parseFloat(avgChg) >= 1 ? '明顯偏多' : parseFloat(avgChg) >= 0 ? '小幅偏多' : parseFloat(avgChg) >= -1 ? '小幅偏空' : '明顯偏空';

  const snapshotLines = stocks.map(s =>
    `${s.ticker}: $${s.price?.toFixed(2)} (${s.chgPct >= 0 ? '+' : ''}${s.chgPct?.toFixed(2)}%)`
  ).join('\n');

  const today = new Date().toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric' });

  const prompt = `你是一位專業的半導體產業分析師。根據以下今日美股半導體個股資料，用繁體中文撰寫一段 80-100 字的市場摘要。

今日日期：${today}
整體情緒：${sentiment}（平均漲跌幅 ${avgChg}%）

個股資料：
${snapshotLines}

漲幅前段：${up.slice(0,3).map(s=>`${s.ticker}(+${s.chgPct?.toFixed(1)}%)`).join('、') || '無'}
跌幅前段：${down.slice(0,3).map(s=>`${s.ticker}(${s.chgPct?.toFixed(1)}%)`).join('、') || '無'}

請針對以上資料給出專業、具體的市場評論，提及主要驅動因素（AI需求、供應鏈、政策、法說等），語氣精準，不要泛泛而談。只需要輸出摘要段落本身，不需要標題或其他格式。`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{ role:'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}`);
    const claudeData = await claudeRes.json();
    const summary = claudeData.content?.[0]?.text || '';

    res.setHeader('Cache-Control','s-maxage=3600,stale-while-revalidate=600');
    return res.status(200).json({ summary, stocks, updatedAt: new Date().toISOString() });

  } catch(err) {
    // Fallback: generate simple summary without Claude
    const fallback = `今日半導體板塊整體${sentiment}，平均漲跌幅 ${avgChg}%。${up.length > 0 ? `漲幅領先個股為 ${up.slice(0,2).map(s=>s.ticker).join('、')}。` : ''}${down.length > 0 ? `${down.slice(0,2).map(s=>s.ticker).join('、')} 表現相對落後。` : ''}`;
    res.setHeader('Cache-Control','s-maxage=3600');
    return res.status(200).json({ summary: fallback, stocks, updatedAt: new Date().toISOString() });
  }
}
