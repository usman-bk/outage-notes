import { defineConfig, devices } from '@playwright/test';
import { APP_ENV, APP_PORT, CONTROL_URL, E2E_DATABASE_URL } from './e2e/env';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // One app, one database, and tests that cut the database for everybody.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${APP_PORT}`, ...devices['Desktop Chrome'] },
  webServer: [
    {
      command: 'node e2e/db-proxy.mjs',
      url: `${CONTROL_URL}/up`,
      env: { E2E_DATABASE_URL },
      reuseExistingServer: false,
    },
    {
      command: `npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/login`,
      env: APP_ENV,
      reuseExistingServer: false,
    },
  ],
});
