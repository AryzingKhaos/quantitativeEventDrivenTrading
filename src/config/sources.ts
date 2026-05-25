import type { SourceConfig } from '../types/source.js';

export const sources: SourceConfig[] = [
  {
    key: 'binance',
    name: 'Binance',
    enabled: true,
    type: 'exchange',
    baseUrl: 'https://www.binance.com',
    listUrl: 'https://www.binance.com/zh-CN/support/announcement',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    key: 'okx',
    name: 'OKX',
    enabled: false,
    type: 'exchange',
    baseUrl: 'https://www.okx.com',
    listUrl: 'https://www.okx.com/zh-hans/help/section/announcements-new-listings',
    pollIntervalSec: 180,
    historicalLimit: 20
  },
  {
    key: 'bybit',
    name: 'Bybit',
    enabled: true,
    type: 'exchange',
    baseUrl: 'https://announcements.bybit.com',
    listUrl: 'https://announcements.bybit.com/zh-TW/',
    pollIntervalSec: 180,
    historicalLimit: 20
  },
  {
    key: 'coinbase',
    name: 'Coinbase',
    enabled: false,
    type: 'exchange',
    baseUrl: 'https://www.coinbase.com',
    listUrl: 'https://www.coinbase.com/zh-sg/blog',
    pollIntervalSec: 180,
    historicalLimit: 20
  },
  {
    key: 'bitget',
    name: 'Bitget',
    enabled: false,
    type: 'exchange',
    baseUrl: 'https://www.bitget.com',
    listUrl: 'https://www.bitget.com/zh-CN/support/sections/12508313443483/83',
    pollIntervalSec: 180,
    historicalLimit: 20
  },
  {
    key: 'panews',
    name: 'PANews',
    enabled: true,
    type: 'news',
    baseUrl: 'https://www.panewslab.com',
    listUrl: 'https://www.panewslab.com/zh',
    // Was 120s — too aggressive for a Cloudflare-fronted site behind bot detection.
    // 10 min keeps news fresh enough for our use case while reducing the bot signature.
    pollIntervalSec: 600,
    historicalLimit: 20,
    // Without this cookie the server hangs on /zh until our HTTP timeout fires.
    staticCookies: { 'panews-language': 'zh' }
  },
  {
    key: 'theblock',
    name: 'The Block',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.theblock.co',
    listUrl: 'https://www.theblock.co/rss.xml',
    pollIntervalSec: 300,
    historicalLimit: 20
  },
  {
    key: 'coindesk',
    name: 'CoinDesk',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.coindesk.com',
    listUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    pollIntervalSec: 300,
    historicalLimit: 20
  },
  {
    // SEC fair-access policy requires UA with identifying contact info; the rotating UA pool gets 403.
    // Enable after wiring a SEC-specific UA override (e.g. 'YourProject contact@example.com').
    key: 'sec_edgar',
    name: 'SEC EDGAR',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.sec.gov',
    listUrl: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&output=atom',
    pollIntervalSec: 600,
    historicalLimit: 20
  },

  // ---------- AI ecosystem: company official blogs ----------
  {
    key: 'openai_blog',
    name: 'OpenAI News',
    enabled: true,
    type: 'news',
    baseUrl: 'https://openai.com',
    listUrl: 'https://openai.com/news/rss.xml',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    key: 'nvidia_blog',
    name: 'NVIDIA Blog',
    enabled: true,
    type: 'news',
    baseUrl: 'https://blogs.nvidia.com',
    listUrl: 'https://blogs.nvidia.com/feed/',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    key: 'google_ai_blog',
    name: 'Google AI Blog',
    enabled: true,
    type: 'news',
    baseUrl: 'https://blog.google',
    listUrl: 'https://blog.google/technology/ai/rss/',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    // DeepMind RSS URL not officially documented — enable after verifying feed URL.
    key: 'deepmind_blog',
    name: 'Google DeepMind Blog',
    enabled: false,
    type: 'news',
    baseUrl: 'https://deepmind.google',
    listUrl: 'https://deepmind.google/blog/rss.xml',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    key: 'microsoft_ai_blog',
    name: 'Microsoft AI Blog',
    enabled: true,
    type: 'news',
    baseUrl: 'https://blogs.microsoft.com',
    listUrl: 'https://blogs.microsoft.com/ai/feed/',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    key: 'aws_ml_blog',
    name: 'AWS Machine Learning Blog',
    enabled: true,
    type: 'news',
    baseUrl: 'https://aws.amazon.com',
    listUrl: 'https://aws.amazon.com/blogs/machine-learning/feed/',
    pollIntervalSec: 900,
    historicalLimit: 20
  },
  {
    key: 'huggingface_blog',
    name: 'Hugging Face Blog',
    enabled: true,
    type: 'news',
    baseUrl: 'https://huggingface.co',
    listUrl: 'https://huggingface.co/blog/feed.xml',
    pollIntervalSec: 600,
    historicalLimit: 20
  },

  // ---------- AI ecosystem: Chinese tech media ----------
  {
    // /rss returns the SPA HTML page, not a feed — RSS appears to have been retired.
    // Needs HTML scraping of https://www.jiqizhixin.com/articles or category pages.
    key: 'jiqizhixin',
    name: '机器之心',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.jiqizhixin.com',
    listUrl: 'https://www.jiqizhixin.com/rss',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    // Connection hangs at the TLS layer — RSS endpoint likely deprecated. Needs HTML scrape.
    key: 'huxiu',
    name: '虎嗅',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.huxiu.com',
    listUrl: 'https://www.huxiu.com/rss/0.xml',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    // 36kr feed URL needs verification — they have changed feed paths in the past.
    key: 'kr36',
    name: '36氪',
    enabled: false,
    type: 'news',
    baseUrl: 'https://36kr.com',
    listUrl: 'https://36kr.com/feed',
    pollIntervalSec: 600,
    historicalLimit: 20
  },
  {
    // 量子位 has no official RSS; reserved for future HTML scraper or WeChat bridge.
    key: 'qbitai',
    name: '量子位',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.qbitai.com',
    listUrl: 'https://www.qbitai.com/feed',
    pollIntervalSec: 600,
    historicalLimit: 20
  },

  // ---------- AI ecosystem: research preprints ----------
  {
    // Intentionally rule-excluded (paper titles match too many generic terms),
    // so every fetched item scores 0 and never pushes. Disabled to stop ~2800
    // wasted fetches/week. Re-enable only alongside a dedicated arXiv rule.
    key: 'arxiv_cs_ai',
    name: 'arXiv cs.AI',
    enabled: false,
    type: 'news',
    baseUrl: 'https://arxiv.org',
    listUrl: 'http://export.arxiv.org/rss/cs.AI',
    pollIntervalSec: 3600,
    historicalLimit: 30
  },
  {
    key: 'arxiv_cs_cl',
    name: 'arXiv cs.CL',
    enabled: false,
    type: 'news',
    baseUrl: 'https://arxiv.org',
    listUrl: 'http://export.arxiv.org/rss/cs.CL',
    pollIntervalSec: 3600,
    historicalLimit: 30
  },
  {
    key: 'arxiv_cs_lg',
    name: 'arXiv cs.LG',
    enabled: false,
    type: 'news',
    baseUrl: 'https://arxiv.org',
    listUrl: 'http://export.arxiv.org/rss/cs.LG',
    pollIntervalSec: 3600,
    historicalLimit: 30
  },

  // ---------- AI ecosystem: regulatory / policy ----------
  {
    // /feed/ returns 404 under current site; new admin removed WordPress feed.
    // Verify and update to /news/feed/ or similar before enabling.
    key: 'whitehouse',
    name: 'The White House',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.whitehouse.gov',
    listUrl: 'https://www.whitehouse.gov/feed/',
    pollIntervalSec: 1800,
    historicalLimit: 20
  },

  // ---------- AI ecosystem: reverse / contrarian ----------
  {
    key: 'gary_marcus',
    name: 'Marcus on AI',
    enabled: true,
    type: 'news',
    baseUrl: 'https://garymarcus.substack.com',
    listUrl: 'https://garymarcus.substack.com/feed',
    pollIntervalSec: 1800,
    historicalLimit: 20
  },
  {
    key: 'ai_snake_oil',
    name: 'AI Snake Oil',
    enabled: true,
    type: 'news',
    baseUrl: 'https://www.aisnakeoil.com',
    listUrl: 'https://www.aisnakeoil.com/feed',
    pollIntervalSec: 1800,
    historicalLimit: 20
  },
  {
    key: 'pluralistic',
    name: 'Pluralistic (Cory Doctorow)',
    enabled: true,
    type: 'news',
    baseUrl: 'https://pluralistic.net',
    listUrl: 'https://pluralistic.net/feed/',
    pollIntervalSec: 1800,
    historicalLimit: 20
  },
  {
    key: 'media_404',
    name: '404 Media',
    enabled: true,
    type: 'news',
    baseUrl: 'https://www.404media.co',
    listUrl: 'https://www.404media.co/rss/',
    pollIntervalSec: 1800,
    historicalLimit: 20
  },
  {
    // /feed/ resolves to the Next.js [...slug] catch-all returning HTML, not a feed.
    // Site is Next.js/Sanity-backed and may not expose RSS; needs investigation.
    key: 'tech_policy_press',
    name: 'Tech Policy Press',
    enabled: false,
    type: 'news',
    baseUrl: 'https://www.techpolicy.press',
    listUrl: 'https://www.techpolicy.press/feed/',
    pollIntervalSec: 1800,
    historicalLimit: 20
  }
];

export const enabledSources = sources.filter((source) => source.enabled);
