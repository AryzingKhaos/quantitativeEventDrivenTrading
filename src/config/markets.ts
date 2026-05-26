import { sources } from './sources.js';
import type { MarketKind, SourceKey } from '../types/source.js';

const marketBySource = new Map<SourceKey, MarketKind>(
  sources.map((source) => [source.key, source.market ?? 'crypto'])
);

/** Which market a source feeds. Defaults to 'crypto' for any source without an explicit market. */
export function marketForSource(sourceKey: SourceKey): MarketKind {
  return marketBySource.get(sourceKey) ?? 'crypto';
}
