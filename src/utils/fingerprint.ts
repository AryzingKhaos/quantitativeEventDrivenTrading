import { createHash } from 'node:crypto';

import { sanitizeTitle } from './text.js';

export function buildFingerprint(sourceKey: string, url: string, title: string): string {
  const payload = [sourceKey, url.trim(), sanitizeTitle(title).toLowerCase()].join('|');
  return createHash('sha256').update(payload).digest('hex');
}
