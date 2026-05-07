const NEWS_KEY = '0a1472104e324eb3b0d3ed93108398bf';

const TAG_MAP = {
  'nvidia': 'ai', 'tsmc': 'ai', 'blackwell': 'ai', 'ai chip': 'ai',
  'export control': 'policy', 'sanctions': 'policy', 'ban': 'policy', '出口管制': 'policy',
  'supply chain': 'supply', 'shortage': 'supply', 'inventory': 'supply',
  'earnings': 'earnings', 'revenue': 'earnings', 'guidance': 'earnings',
  'memory': 'memory', 'hbm': 'memory', 'dram': 'memory', 'nand': 'memory',
  'foundry': 'foundry', 'wafer': 'foundry', 'fab': 'foundry',
};

function inferTags(title, desc) {
  const text = (title + ' ' + (desc||'')).toLowerCase();
  const tags = new Set();
  for (const [kw, tag] of Object.entries(TAG_MAP)) {
    if (text.includes(kw)) tags.add(tag);
  }
  if (tags.size === 0) tags.add('ai'); // default
  return [...tags].slice(0, 2);
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (h < 1) return '剛剛';
  if (h < 24) return `${h}小時前`;
  return `${d}天前`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const queries = [
    'semiconductor TSMC NVIDIA chips',
    'Taiwan semiconductor stock market',
    'chip shortage AI GPU supply chain',
  ];

  const allArticles = [];

  for (const q of queries) {
    try {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_KEY}`;
      const r = await fetch(url);
      if (!r.ok) continue;
      const data = await r.json();
      if (data.articles) allArticles.push(...data.articles);
    } catch(_) {}
  }

  // Deduplicate by title
  const seen = new Set();
  const unique = allArticles.filter(a => {
    if (!a.title || seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });

  // Sort by date, take top 10
  const sorted = unique
    .sort((a,b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 10);

  const articles = sorted.map(a => ({
    title: a.title,
    url: a.url,
    source: a.source?.name || '–',
    time: timeAgo(a.publishedAt),
    tags: inferTags(a.title, a.description),
  }));

  res.setHeader('Cache-Control','s-maxage=3600,stale-while-revalidate=600');
  return res.status(200).json({ articles, updatedAt: new Date().toISOString() });
}
