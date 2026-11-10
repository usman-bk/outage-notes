import { randomUUID } from 'node:crypto';
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { CONTROL_URL, E2E_DATABASE_URL } from './env';

export const PASSWORD = 'demo-password';

export async function database<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export const databaseDown = () => fetch(`${CONTROL_URL}/down`);
export const databaseUp = () => fetch(`${CONTROL_URL}/up`);
export async function messagesSeen(): Promise<number> {
  return ((await (await fetch(`${CONTROL_URL}/stats`)).json()) as { messages: number }).messages;
}

export async function signIn(page: Page, email = 'mina@example.com') {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /^Signed in as/ })).toBeVisible();
}

export async function operator(browser: Browser, email?: string, baseURL?: string) {
  const context = await browser.newContext(baseURL ? { baseURL } : {});
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

export async function openIncident(
  page: Page,
  {
    title,
    impact = 'Partial outage',
    components = ['API'],
    body = 'We are looking into it.',
  }: {
    title: string;
    impact?: string;
    components?: string[];
    body?: string;
  },
) {
  await page.goto('/admin');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Impact').selectOption({ label: impact });
  for (const name of components) await page.getByRole('checkbox', { name }).check();
  await page.getByLabel('First update for the public page').fill(body);
  await page.getByRole('button', { name: 'Open incident' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();
  // Leave the ?posted=1 behind, so a later "Posted." can only mean the later post worked.
  const incidentPath = new URL(page.url()).pathname;
  await page.goto(incidentPath);
  return incidentPath;
}

export async function post(page: Page, body: string, status?: string) {
  if (status) await page.getByLabel('Status').selectOption({ label: status });
  await page.getByLabel('Update for the public page').fill(body);
  await page.getByRole('button', { name: 'Post update' }).click();
}

export async function closeEverything() {
  await database((client) =>
    client.query(
      `UPDATE incidents SET status = 'resolved', resolved_at = now(), version = version + 1
       WHERE resolved_at IS NULL`,
    ),
  );
}

export const uniqueTitle = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

/** Fails a test on any browser console error or uncaught exception, which is how hydration errors show up. */
export const test = base.extend<{ cleanConsole: void }>({
  cleanConsole: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        if (message.text().startsWith('Failed to load resource')) return;
        problems.push(message.text());
      });
      page.on('pageerror', (error) => problems.push(error.message));
      await use();
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
