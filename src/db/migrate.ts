import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getEnv } from '../config/env.js';
import { createDbPool } from './client.js';

export async function runMigrations(): Promise<void> {
  const env = getEnv();
  const pool = createDbPool(env);

  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(currentDir, '../../drizzle/migrations');
    const entries = await readdir(migrationsDir);
    const files = entries.filter((entry) => entry.endsWith('.sql')).sort();

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }
  } finally {
    await pool.end();
  }
}

const isMainModule = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (isMainModule) {
  runMigrations().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
