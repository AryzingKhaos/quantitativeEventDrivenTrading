import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';

import { rules } from './config/rules.js';
import { FilterService } from './services/filter.service.js';
import type { PersistedEvent } from './types/event.js';
import type { SourceKey } from './types/source.js';

loadDotEnv();

interface Options {
  days: number;
  limit: number;
  examples: number;
  near: number;
  excl: number;
}

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const days = Number.parseInt(get('days') ?? '7', 10);
  const limit = Number.parseInt(get('limit') ?? '100000', 10);
  const examples = Number.parseInt(get('examples') ?? '0', 10);
  const near = Number.parseInt(get('near') ?? '0', 10);
  const excl = Number.parseInt(get('excl') ?? '0', 10);
  return { days, limit, examples, near, excl };
}

// Which sources are even targeted by at least one enabled rule. Sources outside
// every rule's `sources` array can never match (e.g. arXiv is intentionally excluded).
const sourcesWithRules = new Set<string>(
  rules.filter((r) => r.enabled).flatMap((r) => r.sources)
);

interface Bucket {
  total: number;
  matched: number;
  excluded: number;
  scoreSum: number;
  maxScore: number;
  nearMiss: number; // unmatched but score > 0
  excludeReasons: Map<string, number>;
}

function newBucket(): Bucket {
  return {
    total: 0,
    matched: 0,
    excluded: 0,
    scoreSum: 0,
    maxScore: 0,
    nearMiss: 0,
    excludeReasons: new Map()
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: readDatabaseUrl() });
  const filter = new FilterService();

  try {
    const { rows } = await pool.query<{
      id: number;
      source_key: SourceKey;
      title: string;
      summary: string | null;
      content: string | null;
    }>(
      `
        SELECT id, source_key, title, summary, content
        FROM events
        WHERE COALESCE(published_at, fetched_at) >= NOW() - make_interval(days => $1)
        ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC
        LIMIT $2
      `,
      [opts.days, opts.limit]
    );

    const buckets = new Map<string, Bucket>();
    const examplesBySource = new Map<string, string[]>();
    const nearBySource = new Map<string, Array<{ score: number; title: string; kw: string[] }>>();
    const exclBySource = new Map<string, Array<{ by: string; title: string }>>();

    for (const row of rows) {
      const ev = {
        sourceKey: row.source_key,
        title: row.title,
        summary: row.summary,
        content: row.content
      } as Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content'>;

      const res = filter.evaluate(ev);
      const b = buckets.get(row.source_key) ?? newBucket();
      b.total += 1;
      b.scoreSum += res.score;
      b.maxScore = Math.max(b.maxScore, res.score);
      if (res.matched) {
        b.matched += 1;
      } else if (res.excludedBy) {
        b.excluded += 1;
        b.excludeReasons.set(res.excludedBy, (b.excludeReasons.get(res.excludedBy) ?? 0) + 1);
        if (opts.excl > 0) {
          const arr = exclBySource.get(row.source_key) ?? [];
          arr.push({ by: res.excludedBy, title: row.title });
          exclBySource.set(row.source_key, arr);
        }
      } else if (res.score > 0) {
        b.nearMiss += 1;
        if (opts.near > 0) {
          const arr = nearBySource.get(row.source_key) ?? [];
          arr.push({ score: res.score, title: row.title, kw: res.matchedKeywords });
          nearBySource.set(row.source_key, arr);
        }
      }
      buckets.set(row.source_key, b);

      if (opts.examples > 0 && res.matched) {
        const arr = examplesBySource.get(row.source_key) ?? [];
        if (arr.length < opts.examples) {
          arr.push(`[${res.score}] ${row.title}`);
          examplesBySource.set(row.source_key, arr);
        }
      }
    }

    const entries = [...buckets.entries()].sort((a, b) => b[1].total - a[1].total);

    console.log(`\n过去 ${opts.days} 天 · 用当前 rules.ts 回放 · 共 ${rows.length} 条事件\n`);
    const header = ['source', 'total', 'matched', 'pass%', 'excluded', 'nearMiss', 'avgScore', 'maxScore', 'hasRule'];
    console.log(header.join('\t'));
    console.log('-'.repeat(90));

    let grandTotal = 0;
    let grandMatched = 0;
    for (const [src, b] of entries) {
      grandTotal += b.total;
      grandMatched += b.matched;
      const pct = b.total > 0 ? ((100 * b.matched) / b.total).toFixed(1) : '0.0';
      const avg = b.total > 0 ? (b.scoreSum / b.total).toFixed(2) : '0';
      console.log(
        [
          src,
          b.total,
          b.matched,
          `${pct}%`,
          b.excluded,
          b.nearMiss,
          avg,
          b.maxScore,
          sourcesWithRules.has(src) ? 'Y' : 'N (无规则)'
        ].join('\t')
      );
    }
    console.log('-'.repeat(90));
    const grandPct = grandTotal > 0 ? ((100 * grandMatched) / grandTotal).toFixed(1) : '0.0';
    console.log(`TOTAL\t${grandTotal}\t${grandMatched}\t${grandPct}%`);

    // 排除原因 top 列表（哪些 excludeKeywords 在拦截）
    console.log('\n=== 各源 excludeKeyword 拦截 top5 ===');
    for (const [src, b] of entries) {
      if (b.excludeReasons.size === 0) continue;
      const top = [...b.excludeReasons.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5);
      console.log(`${src}: ${top.map(([k, n]) => `${k}×${n}`).join(', ')}`);
    }

    if (opts.examples > 0) {
      console.log('\n=== 通过样例 ===');
      for (const [src, arr] of examplesBySource) {
        console.log(`\n[${src}]`);
        for (const line of arr) console.log(`  ${line}`);
      }
    }

    if (opts.near > 0) {
      console.log('\n=== 差一点没过 (score>0 但未达阈值)，按分数降序 ===');
      for (const [src, arr] of nearBySource) {
        const top = arr.sort((a, c) => c.score - a.score).slice(0, opts.near);
        console.log(`\n[${src}]`);
        for (const n of top) console.log(`  [${n.score}] ${n.title}  ← {${n.kw.join(', ')}}`);
      }
    }

    if (opts.excl > 0) {
      console.log('\n=== 被 excludeKeyword 拦截的样例 ===');
      for (const [src, arr] of exclBySource) {
        console.log(`\n[${src}]`);
        for (const e of arr.slice(0, opts.excl)) console.log(`  (${e.by}) ${e.title}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
