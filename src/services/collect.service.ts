import fs from 'node:fs/promises';
import path from 'node:path';

import type { CollectorDefinition, CollectorItem } from '../collectors/types.js';
import { createSourceFetcher, type SourceFetcher } from '../collectors/fetcher.js';
import type { SourceConfig, SourceKey } from '../types/source.js';
import type { SourceStateRepository, StoredCookie } from '../db/source-state.repo.js';
import type { Logger } from '../utils/logger.js';

interface CollectServiceDeps {
  collectors: CollectorDefinition[];
  sourceStateRepo?: SourceStateRepository;
  httpFetcherV2: boolean;
  httpTimeoutMs: number;
  profileDir: string;
  logger?: Logger;
}

interface SourceRuntime {
  fetcher: SourceFetcher;
  listConditional: { etag: string | null; lastModified: string | null };
}

interface ProfileFile {
  salt: string;
}

export class CollectService {
  private readonly collectorMap = new Map<SourceKey, CollectorDefinition>();
  private readonly runtimes = new Map<SourceKey, SourceRuntime>();
  private profileDirReady = false;

  constructor(private readonly deps: CollectServiceDeps) {
    for (const collector of deps.collectors) {
      this.collectorMap.set(collector.sourceKey, collector);
    }
  }

  async collect(source: SourceConfig, limit?: number, knownUrls?: Set<string>): Promise<CollectorItem[]> {
    const collector = this.collectorMap.get(source.key);
    if (!collector) {
      throw new Error(`No collector registered for source ${source.key}`);
    }

    const runtime = await this.getRuntime(source);
    const items = await collector.collect({
      source,
      fetcher: runtime.fetcher,
      limit,
      knownUrls,
      logger: this.deps.logger,
      listConditional: this.deps.httpFetcherV2 ? runtime.listConditional : undefined,
      onListConditional: this.deps.httpFetcherV2
        ? async (cache) => {
            runtime.listConditional = { etag: cache.etag, lastModified: cache.lastModified };
            if (this.deps.sourceStateRepo) {
              try {
                await this.deps.sourceStateRepo.setListPageCache(source.key, cache);
              } catch (error) {
                this.deps.logger?.warn('Failed to persist list-page cache', { sourceKey: source.key, error });
              }
            }
          }
        : undefined
    });

    if (this.deps.httpFetcherV2 && this.deps.sourceStateRepo) {
      const dirty = runtime.fetcher.snapshotCookies();
      if (dirty && dirty.length > 0) {
        try {
          await this.deps.sourceStateRepo.setCookies(source.key, dirty);
        } catch (error) {
          this.deps.logger?.warn('Failed to persist cookies', { sourceKey: source.key, error });
        }
      }
    }

    return items;
  }

  private async getRuntime(source: SourceConfig): Promise<SourceRuntime> {
    const cached = this.runtimes.get(source.key);
    if (cached) {
      return cached;
    }

    const salt = await this.loadOrCreateProfileSalt(source.key);

    let initialCookies: StoredCookie[] = [];
    let listConditional: { etag: string | null; lastModified: string | null } = {
      etag: null,
      lastModified: null
    };

    if (this.deps.sourceStateRepo) {
      try {
        const state = await this.deps.sourceStateRepo.get(source.key);
        if (state) {
          initialCookies = state.cookies ?? [];
          listConditional = { etag: state.listEtag, lastModified: state.listLastModified };
        }
      } catch (error) {
        this.deps.logger?.warn('Failed to load source_state', { sourceKey: source.key, error });
      }
    }

    const fetcher = createSourceFetcher({
      sourceKey: source.key,
      timeoutMs: this.deps.httpTimeoutMs,
      v2: this.deps.httpFetcherV2,
      profileSalt: salt,
      initialCookies,
      staticCookies: source.staticCookies
    });

    const runtime: SourceRuntime = { fetcher, listConditional };
    this.runtimes.set(source.key, runtime);
    return runtime;
  }

  private async ensureProfileDir(): Promise<void> {
    if (this.profileDirReady) {
      return;
    }
    try {
      await fs.mkdir(this.deps.profileDir, { recursive: true });
      this.profileDirReady = true;
    } catch (error) {
      this.deps.logger?.warn('Failed to ensure profile dir, falling back to in-memory salt', {
        profileDir: this.deps.profileDir,
        error
      });
      this.profileDirReady = true;
    }
  }

  private async loadOrCreateProfileSalt(sourceKey: SourceKey): Promise<string> {
    if (!this.deps.httpFetcherV2) {
      // v1 path doesn't matter what salt we pick; UA is overridden by the legacy default in fetcher.ts.
      return 'v1';
    }

    await this.ensureProfileDir();
    const filePath = path.join(this.deps.profileDir, `${sourceKey}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as ProfileFile;
      if (parsed.salt) {
        return parsed.salt;
      }
    } catch {
      // file missing or unreadable — generate
    }

    const salt = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fs.writeFile(filePath, JSON.stringify({ salt } satisfies ProfileFile), 'utf8');
    } catch (error) {
      this.deps.logger?.warn('Failed to persist fetcher profile, using in-memory salt for this run', {
        sourceKey,
        error
      });
    }
    return salt;
  }
}
