import type { SourceKey } from '../types/source.js';
import type { StoredCookie } from '../db/source-state.repo.js';
import { pickUaProfile, type UaProfile } from './ua-pool.js';

export class FetchHttpError extends Error {
  readonly sourceKey: SourceKey;
  readonly url: string;
  readonly status: number;
  constructor(message: string, info: { sourceKey: SourceKey; url: string; status: number }) {
    super(message);
    this.name = 'FetchHttpError';
    this.sourceKey = info.sourceKey;
    this.url = info.url;
    this.status = info.status;
  }
}

export class FetchTransportError extends Error {
  readonly sourceKey: SourceKey;
  readonly url: string;
  readonly kind: 'timeout' | 'network' | 'unknown';
  readonly elapsedMs: number;
  readonly timeoutMs: number;
  readonly causeCode: string | null;
  constructor(
    message: string,
    info: {
      sourceKey: SourceKey;
      url: string;
      kind: 'timeout' | 'network' | 'unknown';
      elapsedMs: number;
      timeoutMs: number;
      causeCode: string | null;
      cause?: unknown;
    }
  ) {
    super(message, info.cause !== undefined ? { cause: info.cause } : undefined);
    this.name = 'FetchTransportError';
    this.sourceKey = info.sourceKey;
    this.url = info.url;
    this.kind = info.kind;
    this.elapsedMs = info.elapsedMs;
    this.timeoutMs = info.timeoutMs;
    this.causeCode = info.causeCode;
  }
}

function wrapFetchError(
  error: unknown,
  ctx: { url: string; sourceKey: SourceKey; timedOut: boolean; timeoutMs: number; elapsedMs: number }
): Error {
  if (error instanceof FetchHttpError || error instanceof FetchTransportError) {
    return error;
  }
  const cause = error instanceof Error ? error : new Error(String(error));
  const causeAny = cause as Error & { cause?: { code?: string }; code?: string };
  const causeCode = causeAny.code ?? causeAny.cause?.code ?? null;

  if (ctx.timedOut || cause.name === 'AbortError' || cause.name === 'TimeoutError') {
    return new FetchTransportError(
      `Timeout after ${ctx.elapsedMs}ms (limit ${ctx.timeoutMs}ms) GET ${ctx.url}`,
      {
        sourceKey: ctx.sourceKey,
        url: ctx.url,
        kind: 'timeout',
        elapsedMs: ctx.elapsedMs,
        timeoutMs: ctx.timeoutMs,
        causeCode,
        cause
      }
    );
  }

  return new FetchTransportError(
    `Network error after ${ctx.elapsedMs}ms GET ${ctx.url}: ${cause.message}`,
    {
      sourceKey: ctx.sourceKey,
      url: ctx.url,
      kind: causeCode ? 'network' : 'unknown',
      elapsedMs: ctx.elapsedMs,
      timeoutMs: ctx.timeoutMs,
      causeCode,
      cause
    }
  );
}

const V1_LEGACY_PROFILE: UaProfile = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  secChUa: '',
  secChUaMobile: '?0',
  secChUaPlatform: '"macOS"'
};

export interface FetchResult {
  status: number;
  text: string;
  headers: Headers;
}

export interface FetchJsonResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

export interface ConditionalCache {
  etag?: string | null;
  lastModified?: string | null;
}

export type ConditionalResult =
  | { kind: 'not-modified' }
  | { kind: 'fresh'; text: string; etag: string | null; lastModified: string | null };

export interface FetchOptions {
  referer?: string;
}

export interface SourceFetcher {
  readonly sourceKey: SourceKey;
  fetchText(url: string, opts?: FetchOptions): Promise<FetchResult>;
  fetchJson<T>(url: string, opts?: FetchOptions): Promise<FetchJsonResult<T>>;
  fetchConditional(url: string, prev: ConditionalCache, opts?: FetchOptions): Promise<ConditionalResult>;
  /** Returns a snapshot of cookies for persistence; null when jar is empty/disabled. */
  snapshotCookies(): StoredCookie[] | null;
}

interface InternalCookie extends StoredCookie {}

interface FetcherDeps {
  sourceKey: SourceKey;
  acceptLanguage: string;
  timeoutMs: number;
  v2: boolean;
  uaProfile: UaProfile;
  initialCookies: StoredCookie[];
  staticCookies: Record<string, string>;
}

function parseSetCookie(header: string, requestUrl: string): InternalCookie | null {
  const segments = header.split(';').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const [nameValue, ...attrs] = segments;
  const eqIdx = nameValue.indexOf('=');
  if (eqIdx <= 0) {
    return null;
  }

  const name = nameValue.slice(0, eqIdx).trim();
  const value = nameValue.slice(eqIdx + 1).trim();
  if (!name) {
    return null;
  }

  const requestedAt = Date.now();
  let domain: string;
  let path = '/';
  let expiresAt: number | null = null;

  try {
    const parsed = new URL(requestUrl);
    domain = parsed.hostname;
    path = parsed.pathname.endsWith('/') ? parsed.pathname : parsed.pathname.replace(/\/[^/]*$/, '/') || '/';
  } catch {
    return null;
  }

  for (const attr of attrs) {
    const idx = attr.indexOf('=');
    const key = (idx === -1 ? attr : attr.slice(0, idx)).trim().toLowerCase();
    const val = idx === -1 ? '' : attr.slice(idx + 1).trim();

    if (key === 'domain' && val) {
      domain = val.replace(/^\./, '').toLowerCase();
    } else if (key === 'path' && val) {
      path = val;
    } else if (key === 'expires' && val) {
      const parsed = Date.parse(val);
      if (Number.isFinite(parsed)) {
        expiresAt = parsed;
      }
    } else if (key === 'max-age' && val) {
      const seconds = Number.parseInt(val, 10);
      if (Number.isFinite(seconds)) {
        expiresAt = requestedAt + seconds * 1_000;
      }
    }
  }

  return { name, value, domain: domain.toLowerCase(), path, expiresAt };
}

function cookieMatches(cookie: InternalCookie, requestUrl: string, now: number): boolean {
  if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  const cookieDomain = cookie.domain.toLowerCase();
  const domainOk = host === cookieDomain || host.endsWith(`.${cookieDomain}`);
  if (!domainOk) {
    return false;
  }

  const reqPath = parsed.pathname || '/';
  return reqPath === cookie.path || reqPath.startsWith(cookie.path);
}

class CookieJar {
  private readonly cookies = new Map<string, InternalCookie>();
  private dirty = false;

  constructor(initial: StoredCookie[]) {
    const now = Date.now();
    for (const cookie of initial) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        continue;
      }
      this.cookies.set(this.keyOf(cookie), { ...cookie });
    }
  }

  private keyOf(cookie: Pick<InternalCookie, 'name' | 'domain' | 'path'>): string {
    return `${cookie.domain}|${cookie.path}|${cookie.name}`;
  }

  ingest(setCookieHeaders: string[], requestUrl: string): void {
    for (const header of setCookieHeaders) {
      const parsed = parseSetCookie(header, requestUrl);
      if (!parsed) {
        continue;
      }
      this.cookies.set(this.keyOf(parsed), parsed);
      this.dirty = true;
    }
  }

  headerFor(requestUrl: string): string | null {
    const now = Date.now();
    const matched: InternalCookie[] = [];
    for (const cookie of this.cookies.values()) {
      if (cookieMatches(cookie, requestUrl, now)) {
        matched.push(cookie);
      }
    }
    if (matched.length === 0) {
      return null;
    }
    return matched.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  }

  takeDirtySnapshot(): StoredCookie[] | null {
    if (!this.dirty) {
      return null;
    }
    this.dirty = false;
    return [...this.cookies.values()];
  }

  snapshot(): StoredCookie[] {
    return [...this.cookies.values()];
  }

  size(): number {
    return this.cookies.size;
  }
}

function staticCookieHeader(deps: FetcherDeps): string | null {
  const entries = Object.entries(deps.staticCookies);
  if (entries.length === 0) {
    return null;
  }
  return entries.map(([name, value]) => `${name}=${value}`).join('; ');
}

function mergeCookieHeaders(...parts: Array<string | null | undefined>): string | null {
  const filtered = parts.filter((part): part is string => Boolean(part && part.length > 0));
  if (filtered.length === 0) {
    return null;
  }
  return filtered.join('; ');
}

function buildHeaders(
  deps: FetcherDeps,
  url: string,
  opts: FetchOptions,
  jar: CookieJar | null,
  conditional?: ConditionalCache
): Record<string, string> {
  if (!deps.v2) {
    const headers: Record<string, string> = {
      'accept-language': deps.acceptLanguage,
      'user-agent': deps.uaProfile.userAgent
    };
    const staticCookie = staticCookieHeader(deps);
    if (staticCookie) {
      headers.cookie = staticCookie;
    }
    return headers;
  }

  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': deps.acceptLanguage,
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': deps.uaProfile.userAgent,
    'sec-ch-ua': deps.uaProfile.secChUa,
    'sec-ch-ua-mobile': deps.uaProfile.secChUaMobile,
    'sec-ch-ua-platform': deps.uaProfile.secChUaPlatform,
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1'
  };

  if (opts.referer) {
    headers.referer = opts.referer;
    try {
      const refOrigin = new URL(opts.referer).origin;
      const reqOrigin = new URL(url).origin;
      headers['sec-fetch-site'] = refOrigin === reqOrigin ? 'same-origin' : 'cross-site';
      headers['sec-fetch-dest'] = 'document';
      headers['sec-fetch-mode'] = 'navigate';
    } catch {
      // ignore malformed urls
    }
  }

  const jarCookie = jar ? jar.headerFor(url) : null;
  const merged = mergeCookieHeaders(staticCookieHeader(deps), jarCookie);
  if (merged) {
    headers.cookie = merged;
  }

  if (conditional?.etag) {
    headers['if-none-match'] = conditional.etag;
  }
  if (conditional?.lastModified) {
    headers['if-modified-since'] = conditional.lastModified;
  }

  return headers;
}

class SourceFetcherImpl implements SourceFetcher {
  readonly sourceKey: SourceKey;
  private readonly jar: CookieJar | null;

  constructor(private readonly deps: FetcherDeps) {
    this.sourceKey = deps.sourceKey;
    this.jar = deps.v2 ? new CookieJar(deps.initialCookies) : null;
  }

  private async raw(url: string, headers: Record<string, string>): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.deps.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
      if (this.jar) {
        const setCookies = response.headers.getSetCookie?.() ?? [];
        if (setCookies.length > 0) {
          this.jar.ingest(setCookies, response.url || url);
        }
      }
      return response;
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      throw wrapFetchError(error, { url, sourceKey: this.deps.sourceKey, timedOut, timeoutMs: this.deps.timeoutMs, elapsedMs });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchText(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const headers = buildHeaders(this.deps, url, opts, this.jar);
    const response = await this.raw(url, headers);
    if (!response.ok) {
      throw new FetchHttpError(`HTTP ${response.status} for ${url}`, {
        sourceKey: this.deps.sourceKey,
        url,
        status: response.status
      });
    }
    const text = await response.text();
    return { status: response.status, text, headers: response.headers };
  }

  async fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<FetchJsonResult<T>> {
    const headers = buildHeaders(this.deps, url, opts, this.jar);
    headers.accept = 'application/json, text/plain, */*';
    if (this.deps.v2) {
      headers['sec-fetch-dest'] = 'empty';
      headers['sec-fetch-mode'] = 'cors';
      if (!opts.referer) {
        // 站内 API 至少给一个同站 Referer
        try {
          const origin = new URL(url).origin;
          headers.referer = `${origin}/`;
          headers['sec-fetch-site'] = 'same-origin';
        } catch {
          // ignore
        }
      }
    }
    const response = await this.raw(url, headers);
    if (!response.ok) {
      throw new FetchHttpError(`HTTP ${response.status} for ${url}`, {
        sourceKey: this.deps.sourceKey,
        url,
        status: response.status
      });
    }
    const data = (await response.json()) as T;
    return { status: response.status, data, headers: response.headers };
  }

  async fetchConditional(url: string, prev: ConditionalCache, opts: FetchOptions = {}): Promise<ConditionalResult> {
    const headers = buildHeaders(this.deps, url, opts, this.jar, prev);
    const response = await this.raw(url, headers);
    if (response.status === 304) {
      return { kind: 'not-modified' };
    }
    if (!response.ok) {
      throw new FetchHttpError(`HTTP ${response.status} for ${url}`, {
        sourceKey: this.deps.sourceKey,
        url,
        status: response.status
      });
    }
    const text = await response.text();
    return {
      kind: 'fresh',
      text,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    };
  }

  snapshotCookies(): StoredCookie[] | null {
    return this.jar?.takeDirtySnapshot() ?? null;
  }
}

export interface CreateFetcherOptions {
  sourceKey: SourceKey;
  acceptLanguage?: string;
  timeoutMs: number;
  v2: boolean;
  profileSalt: string;
  initialCookies?: StoredCookie[];
  staticCookies?: Record<string, string>;
}

export function createSourceFetcher(opts: CreateFetcherOptions): SourceFetcher {
  const uaProfile = opts.v2 ? pickUaProfile(opts.sourceKey, opts.profileSalt) : V1_LEGACY_PROFILE;
  return new SourceFetcherImpl({
    sourceKey: opts.sourceKey,
    acceptLanguage: opts.acceptLanguage ?? 'zh-CN,zh;q=0.9,en;q=0.8',
    timeoutMs: opts.timeoutMs,
    v2: opts.v2,
    uaProfile,
    initialCookies: opts.initialCookies ?? [],
    staticCookies: opts.staticCookies ?? {}
  });
}
