import type { Logger } from '../utils/logger.js';
import type { PersistedEvent } from '../types/event.js';
import type { PriceService } from './price.service.js';
import type {
  PendingSnapshotsRepository,
  PriceSnapshotsRepository,
  SnapshotKind
} from '../db/snapshots.repo.js';

interface EffectivenessDeps {
  logger: Logger;
  priceService: PriceService;
  priceSnapshotsRepo: PriceSnapshotsRepository;
  pendingSnapshotsRepo: PendingSnapshotsRepository;
}

const KIND_OFFSETS_MS: Record<SnapshotKind, number> = {
  '1h': 60 * 60 * 1_000,
  '24h': 24 * 60 * 60 * 1_000,
  '7d': 7 * 24 * 60 * 60 * 1_000
};

export class EffectivenessService {
  constructor(private readonly deps: EffectivenessDeps) {}

  /** Called immediately after a successful Telegram delivery. */
  async trackBaseline(event: PersistedEvent): Promise<void> {
    const assets = (event.affectedAssets ?? [])
      .map((asset) => asset.trim().toUpperCase())
      .filter(Boolean);
    if (assets.length === 0) {
      return;
    }

    const baselineAt = new Date();

    for (const asset of assets) {
      const symbol = this.deps.priceService.toBinanceSymbol(asset);
      if (!symbol) {
        this.deps.logger.debug('Skipping baseline for unsupported asset', { eventId: event.id, asset });
        continue;
      }

      try {
        const price = await this.deps.priceService.fetchSpot(asset);
        if (price === null) {
          this.deps.logger.warn('Spot price unavailable for baseline', { eventId: event.id, asset });
          continue;
        }
        await this.deps.priceSnapshotsRepo.upsertBaseline({
          eventId: event.id,
          asset,
          baselinePrice: price,
          baselineAt
        });
        for (const [kind, offset] of Object.entries(KIND_OFFSETS_MS) as Array<[SnapshotKind, number]>) {
          await this.deps.pendingSnapshotsRepo.insert({
            eventId: event.id,
            asset,
            kind,
            dueAt: new Date(baselineAt.getTime() + offset)
          });
        }
      } catch (error) {
        this.deps.logger.warn('Failed to record baseline price', { eventId: event.id, asset, error });
      }
    }
  }

  async drainDuePending(batchSize = 50): Promise<{ processed: number; succeeded: number }> {
    const due = await this.deps.pendingSnapshotsRepo.listDue(batchSize);
    let succeeded = 0;
    for (const item of due) {
      try {
        const price = await this.deps.priceService.fetchAt(item.asset, item.dueAt.getTime());
        if (price === null) {
          await this.deps.pendingSnapshotsRepo.markFailed(item.id, 'unsupported or missing price');
          continue;
        }
        await this.deps.priceSnapshotsRepo.updateForKind({
          eventId: item.eventId,
          asset: item.asset,
          kind: item.kind,
          price,
          at: item.dueAt
        });
        await this.deps.pendingSnapshotsRepo.markDone(item.id);
        succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.deps.pendingSnapshotsRepo.markFailed(item.id, message);
      }
    }
    return { processed: due.length, succeeded };
  }
}
