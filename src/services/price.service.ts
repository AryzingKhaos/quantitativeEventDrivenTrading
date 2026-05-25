// Stable-coin and quote tickers we never want to fetch a price for.
const SKIP_ASSETS = new Set(['USD', 'USDT', 'USDC', 'BUSD', 'DAI', 'TUSD', 'FDUSD', 'EUR', 'GBP', 'JPY', 'CNY']);

interface BinanceKlineRow extends Array<unknown> {
  0: number; // open time
  1: string; // open
  4: string; // close
}

export class PriceService {
  constructor(
    private readonly options: {
      baseUrl?: string;
      timeoutMs?: number;
    } = {}
  ) {}

  private get baseUrl(): string {
    return this.options.baseUrl ?? 'https://api.binance.com';
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? 10_000;
  }

  /** Fetch most recent close price (USDT pair) for an asset. Returns null if unsupported. */
  async fetchSpot(asset: string): Promise<number | null> {
    const symbol = this.toBinanceSymbol(asset);
    if (!symbol) {
      return null;
    }
    return this.fetchClose(symbol, Date.now());
  }

  /** Fetch close price for an asset at (or just after) the given timestamp. */
  async fetchAt(asset: string, atMs: number): Promise<number | null> {
    const symbol = this.toBinanceSymbol(asset);
    if (!symbol) {
      return null;
    }
    return this.fetchClose(symbol, atMs);
  }

  toBinanceSymbol(asset: string): string | null {
    const upper = asset.trim().toUpperCase();
    if (!upper || SKIP_ASSETS.has(upper)) {
      return null;
    }
    if (/[^A-Z0-9]/.test(upper)) {
      return null;
    }
    return `${upper}USDT`;
  }

  private async fetchClose(symbol: string, atMs: number): Promise<number | null> {
    const params = new URLSearchParams({
      symbol,
      interval: '1m',
      limit: '1',
      startTime: String(atMs - 60_000),
      endTime: String(atMs + 60_000)
    });
    const url = `${this.baseUrl}/api/v3/klines?${params.toString()}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 400) {
        // unsupported symbol — Binance returns 400 with code -1121
        return null;
      }
      if (!response.ok) {
        throw new Error(`Binance klines HTTP ${response.status}`);
      }
      const rows = (await response.json()) as BinanceKlineRow[];
      if (rows.length === 0) {
        return null;
      }
      const close = Number.parseFloat(rows[0][4]);
      return Number.isFinite(close) ? close : null;
    } finally {
      clearTimeout(timer);
    }
  }
}
