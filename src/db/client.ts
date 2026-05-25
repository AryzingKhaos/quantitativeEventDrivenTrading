import { Pool } from 'pg';

import type { RuntimeEnv } from '../config/env.js';

export function createDbPool(env: RuntimeEnv): Pool {
  return new Pool({
    connectionString: env.databaseUrl
  });
}
