import 'server-only';
import { Pool } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      // A status page has to give up on its database quickly and show what it last knew.
      connectionTimeoutMillis: 2000,
      query_timeout: 3000,
    });
    // Without a listener, an idle connection dying takes the whole process down with it.
    pool.on('error', (error) => console.error('database connection lost:', error.message));
  }
  return pool;
}
