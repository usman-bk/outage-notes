import os from 'node:os';
import path from 'node:path';

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgres://localhost:5432/outage_notes_e2e_test';
if (!new URL(E2E_DATABASE_URL).pathname.endsWith('_test')) {
  throw new Error('End-to-end tests only run against a database ending in _test');
}

export const APP_PORT = 3210;
export const CONTROL_URL = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT ?? 55434}`;
export const SNAPSHOT_PATH = path.join(os.tmpdir(), 'outage-notes-e2e', 'board.json');

const proxied = new URL(E2E_DATABASE_URL);
proxied.hostname = '127.0.0.1';
proxied.port = process.env.E2E_PROXY_PORT ?? '55433';

export const APP_ENV = {
  DATABASE_URL: proxied.href,
  SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-e2e',
  SNAPSHOT_PATH,
  BOARD_REVALIDATE_SECONDS: '2',
  COOKIE_SECURE: 'false',
  PUBLIC_URL: `http://localhost:${APP_PORT}`,
};
