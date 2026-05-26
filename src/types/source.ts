export type SourceKey =
  | 'binance'
  | 'okx'
  | 'bybit'
  | 'coinbase'
  | 'bitget'
  | 'panews'
  | 'theblock'
  | 'coindesk'
  | 'sec_edgar'
  // AI ecosystem — official company blogs
  | 'openai_blog'
  | 'nvidia_blog'
  | 'google_ai_blog'
  | 'deepmind_blog'
  | 'microsoft_ai_blog'
  | 'aws_ml_blog'
  | 'huggingface_blog'
  // AI ecosystem — Chinese tech media
  | 'jiqizhixin'
  | 'huxiu'
  | 'kr36'
  | 'qbitai'
  // AI ecosystem — research / preprints
  | 'arxiv_cs_ai'
  | 'arxiv_cs_cl'
  | 'arxiv_cs_lg'
  // AI ecosystem — regulatory / policy
  | 'whitehouse'
  // AI ecosystem — reverse / contrarian
  | 'gary_marcus'
  | 'ai_snake_oil'
  | 'pluralistic'
  | 'media_404'
  | 'tech_policy_press';

export type SourceType = 'exchange' | 'news';

/** Which market a source feeds. Decides the rule set and LLM prompt used. */
export type MarketKind = 'crypto' | 'ashare';

export interface SourceConfig {
  key: SourceKey;
  name: string;
  enabled: boolean;
  type: SourceType;
  /** Defaults to 'crypto' when omitted (see config/markets.ts). A股 sources set 'ashare'. */
  market?: MarketKind;
  baseUrl: string;
  listUrl: string;
  pollIntervalSec: number;
  historicalLimit: number;
  /**
   * Cookies that must always be sent to this source. Some sites (e.g. PANews) refuse
   * to respond — they hang the connection rather than returning 4xx — until a language
   * preference cookie is present, which a browser would normally pick up from a 302
   * redirect we cannot replay because Node fetch drops Set-Cookie across redirects.
   */
  staticCookies?: Record<string, string>;
}
