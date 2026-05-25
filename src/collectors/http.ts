// Backwards-compatible thin wrappers kept for ad-hoc callers (e.g. rescore-events.ts).
// Real collectors now receive a per-source `SourceFetcher` via CollectorContext;
// see `fetcher.ts` and `services/collect.service.ts`.
import { getEnv } from '../config/env.js';

const defaultHeaders = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
};

async function fetchResponse(url: string): Promise<Response> {
  const env = getEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.httpTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: defaultHeaders,
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }

    return response;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetchResponse(url);
  return await response.text();
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchResponse(url);
  return (await response.json()) as T;
}
