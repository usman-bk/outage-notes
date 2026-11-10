import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import pg from 'pg';
import { E2E_DATABASE_URL, SNAPSHOT_PATH } from './env';

export default async function globalSetup() {
  const env = {
    ...process.env,
    TEST_DATABASE_URL: E2E_DATABASE_URL,
    DATABASE_URL: E2E_DATABASE_URL,
  };
  execFileSync('node', ['scripts/test-db.mjs'], { env, stdio: 'inherit' });
  execFileSync('node', ['scripts/migrate.mjs'], { env, stdio: 'inherit' });
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  await client.query(
    'TRUNCATE incident_updates, incident_components, incidents, components, operators, login_failures RESTART IDENTITY CASCADE',
  );
  await client.end();
  execFileSync('node', ['scripts/seed.mjs'], { env, stdio: 'inherit' });
  rmSync(SNAPSHOT_PATH, { force: true });
}
