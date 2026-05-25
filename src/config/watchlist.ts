import fs from 'node:fs/promises';

export interface Watchlist {
  assets: string[];
  categories: string[];
  /** Optional natural-language description shown in the LLM system prompt. */
  description: string | null;
}

const EMPTY: Watchlist = { assets: [], categories: [], description: null };

interface WatchlistFile {
  assets?: string[];
  categories?: string[];
  description?: string;
}

export async function loadWatchlist(path: string): Promise<Watchlist> {
  try {
    const raw = await fs.readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as WatchlistFile;
    return {
      assets: (parsed.assets ?? []).map((value) => value.trim()).filter(Boolean),
      categories: (parsed.categories ?? []).map((value) => value.trim()).filter(Boolean),
      description: parsed.description?.trim() || null
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY;
    }
    throw error;
  }
}

export function watchlistAssetsSet(watchlist: Watchlist): Set<string> {
  return new Set(watchlist.assets.map((asset) => asset.toUpperCase()));
}
