import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { APP_ENV, SNAPSHOT_PATH } from './env';
import {
  closeEverything,
  database,
  databaseDown,
  databaseUp,
  expect,
  messagesSeen,
  openIncident,
  operator,
  post,
  signIn,
  test,
  uniqueTitle,
} from './helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(45_000);

const headline = (page: Page) => page.getByRole('heading', { level: 1 });

async function eventually(page: Page, url: string, text: string | RegExp) {
  await expect(async () => {
    await page.goto(url);
    await expect(page.locator('body')).toContainText(text, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

test.afterEach(async () => {
  await databaseUp();
});

test('a fresh install reads operational and lists every component', async ({ page }) => {
  await page.goto('/');
  await expect(headline(page)).toHaveText('All systems operational');
  for (const name of ['API', 'Dashboard', 'Webhooks', 'File storage']) {
    await expect(page.getByRole('heading', { level: 3, name })).toBeVisible();
  }
});

test('the header link is the plain text colour, not a link colour', async ({ page }) => {
  await page.goto('/');
  const colour = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).color);
  expect(await colour('header a[href="/"]')).toBe(await colour('body'));
});

test('the whole status is in the HTML, with no JavaScript at all', async ({ browser, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(headline(page)).toHaveText('All systems operational');
  await expect(page.getByText('Loading')).toHaveCount(0);
  await context.close();
  expect(await (await request.get('/')).text()).toContain('All systems operational');
});

test('many visitors cost the database almost nothing', async ({ request }) => {
  await request.get('/');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await request.get('/');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const before = await messagesSeen();
  for (let n = 0; n < 30; n += 1) expect((await request.get('/')).ok()).toBe(true);
  // One regeneration is about 8 messages. Thirty uncached reads would be about 240.
  expect((await messagesSeen()) - before).toBeLessThan(20);
});

test('a published incident reaches another visitor at once', async ({ browser }) => {
  const mina = await operator(browser);
  const title = uniqueTitle('Slow API');

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto('/');
  await expect(headline(visitor)).toHaveText('All systems operational');

  await openIncident(mina, { title, body: 'First message for the public.' });

  await visitor.reload();
  await expect(headline(visitor)).toHaveText('Part of the service is down');
  await expect(visitor.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await expect(visitor.getByText('First message for the public.')).toBeVisible();
  await visitorContext.close();
  await mina.context().close();
  await closeEverything();
});

test('two operators: the second is told, loses nothing, and can post', async ({ browser }) => {
  const mina = await operator(browser);
  const tomas = await operator(browser, 'tomas@example.com');
  const title = uniqueTitle('Webhooks backing up');
  const url = await openIncident(mina, { title, components: ['Webhooks'] });
  await tomas.goto(url);
  await mina.goto(url);

  await post(mina, 'Mina says the queue is draining.', 'Monitoring');
  await expect(mina.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();
  await expect(
    mina.getByRole('article').getByText('Mina says the queue is draining.'),
  ).toBeVisible();

  await post(tomas, 'Tomas says it is all clear.', 'Resolved');
  const alert = tomas
    .getByRole('alert')
    .filter({ hasText: 'Someone posted while you were writing' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Mina says the queue is draining.');
  await expect(tomas.getByLabel('Update for the public page')).toHaveValue(
    'Tomas says it is all clear.',
  );
  await expect(tomas.getByLabel('Status')).toHaveValue('resolved');

  await tomas.getByRole('button', { name: 'Post update' }).click();
  await expect(tomas.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();
  await expect(tomas.getByLabel('Update for the public page')).toHaveValue('');

  const rows = await database(async (client) => {
    const { rows } = await client.query<{ author: string }>(
      `SELECT author FROM incident_updates u JOIN incidents i ON i.id = u.incident_id
       WHERE i.title = $1 ORDER BY u.id`,
      [title],
    );
    return rows.map(({ author }) => author);
  });
  expect(rows).toEqual(['Mina', 'Mina', 'Tomas']);
  await mina.context().close();
  await tomas.context().close();
});

test('a resolved incident leaves the front page and appears in history', async ({
  page,
  browser,
}) => {
  await closeEverything();
  const mina = await operator(browser);
  const title = uniqueTitle('Dashboard blank');
  await openIncident(mina, { title, impact: 'Major outage', components: ['Dashboard'] });

  await page.goto('/');
  await expect(headline(page)).toHaveText('Major outage');
  await post(mina, 'Fixed.', 'Resolved');
  await expect(mina.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();

  await page.reload();
  await expect(headline(page)).toHaveText('All systems operational');
  await expect(page.getByRole('heading', { level: 3, name: title })).toHaveCount(0);
  await page.goto('/history');
  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await mina.context().close();
});

test("times are UTC in the HTML and the reader's own after hydration", async ({ browser }) => {
  const mina = await operator(browser);
  const url = await openIncident(mina, { title: uniqueTitle('Clock check'), body: 'Clock body.' });
  expect(url).toContain('/admin/incidents/');
  await mina.context().close();

  const karachi = await browser.newContext({ timezoneId: 'Asia/Karachi' });
  const page = await karachi.newPage();
  const errors: string[] = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/');
  await expect(page.locator('main time').first()).toContainText('GMT+5');
  expect(errors).toEqual([]);
  await karachi.close();

  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    timezoneId: 'Asia/Karachi',
  });
  const plain = await noScript.newPage();
  await plain.goto('/');
  await expect(plain.locator('main time').first()).toContainText('UTC');
  await noScript.close();
  await closeEverything();
});

test('hostile text stays text on the page and in the feed', async ({ browser, page, request }) => {
  const mina = await operator(browser);
  const title = `<img src=x onerror="window.hacked=1"> & ${uniqueTitle('xss')}`;
  await openIncident(mina, { title, body: '<script>window.hacked=1</script>' });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await expect(page.getByText('<script>window.hacked=1</script>')).toBeVisible();
  expect(await page.evaluate(() => 'hacked' in window)).toBe(false);

  await expect(async () => {
    const response = await request.get('/feed.xml');
    expect(response.headers()['content-type']).toContain('application/atom+xml');
    const xml = await response.text();
    expect(xml).toContain('&lt;img src=x');
    expect(xml).not.toContain('<img src=x');
    const parsed = await page.evaluate(
      (source) =>
        new DOMParser().parseFromString(source, 'application/xml').querySelector('parsererror') ===
        null,
      xml,
    );
    expect(parsed).toBe(true);
  }).toPass({ timeout: 10_000 });
  await mina.context().close();
  await closeEverything();
});

test('a Server Action replayed with no session changes nothing', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const mina = await operator(browser);
  const url = await openIncident(mina, { title: uniqueTitle('Replay target') });
  const incidentId = Number(url.split('/').at(-1));

  let captured: { headers: Record<string, string>; body: Buffer } | undefined;
  await mina.route('**/admin/incidents/**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && !captured) {
      captured = { headers: await request.allHeaders(), body: request.postDataBuffer()! };
      await route.abort();
      return;
    }
    await route.continue();
  });
  await post(mina, 'Replayed body.', 'Monitoring');
  await expect.poll(() => captured).toBeDefined();

  const count = () =>
    database(async (client) => {
      const { rowCount } = await client.query(
        'SELECT 1 FROM incident_updates WHERE incident_id = $1',
        [incidentId],
      );
      return rowCount;
    });
  const replay = async (cookie?: string) => {
    const api = await playwright.request.newContext({ baseURL });
    const headers: Record<string, string> = {
      'next-action': captured!.headers['next-action']!,
      'content-type': captured!.headers['content-type']!,
      origin: baseURL!,
      accept: 'text/x-component',
    };
    if (cookie) headers.cookie = cookie;
    await api.post(url, { headers, data: captured!.body, maxRedirects: 0 });
    await api.dispose();
  };

  expect(await count()).toBe(1);
  await replay();
  expect(await count()).toBe(1);

  // Any cookie at all gets past proxy.ts, so this one is the case only the action itself can refuse.
  await replay('session=forged.value');
  expect(await count()).toBe(1);

  // The same bytes with a valid session do post, or the check above would prove nothing.
  const cookies = await mina.context().cookies();
  await replay(cookies.map(({ name, value }) => `${name}=${value}`).join('; '));
  expect(await count()).toBe(2);
  await mina.context().close();
  await closeEverything();
});

test('a removed operator is out on their next action', async ({ browser }) => {
  const tomas = await operator(browser, 'tomas@example.com');
  const url = await openIncident(tomas, { title: uniqueTitle('Removed operator') });
  await database((client) =>
    client.query("UPDATE operators SET active = false WHERE email = 'tomas@example.com'"),
  );
  try {
    await post(tomas, 'Should never land.');
    await expect(tomas).toHaveURL(/\/login$/);
    await tomas.goto(url);
    await expect(tomas).toHaveURL(/\/login$/);
  } finally {
    await database((client) =>
      client.query("UPDATE operators SET active = true WHERE email = 'tomas@example.com'"),
    );
  }
  const landed = await database(async (client) => {
    const { rowCount } = await client.query(
      "SELECT 1 FROM incident_updates WHERE body = 'Should never land.'",
    );
    return rowCount;
  });
  expect(landed).toBe(0);
  await tomas.context().close();
  await closeEverything();
});

test('with the database gone the page stays up and says so, then recovers', async ({
  browser,
  page,
  request,
}) => {
  await closeEverything();
  const mina = await operator(browser);
  const title = uniqueTitle('Database going away');
  const url = await openIncident(mina, { title });
  await mina.goto(url);
  await page.goto('/');
  await expect(headline(page)).toHaveText('Part of the service is down');

  await databaseDown();

  await eventually(page, '/', "We can't reach our status data");
  await expect(headline(page)).toHaveText('Last confirmed: Part of the service is down');
  await expect(page.getByRole('heading', { level: 3, name: title })).toBeVisible();
  const during = await request.get('/api/status');
  expect(during.status()).toBe(200);
  expect((await during.json()).state).toBe('stale');

  await post(mina, 'Written during the outage.');
  await expect(mina.getByText("We can't reach the database, so nothing was posted.")).toBeVisible();
  await expect(mina.getByLabel('Update for the public page')).toHaveValue(
    'Written during the outage.',
  );

  await databaseUp();
  await expect(async () => {
    await page.goto('/');
    await expect(headline(page)).toHaveText('Part of the service is down', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByText("We can't reach our status data")).toHaveCount(0);

  await mina.getByRole('button', { name: 'Post update' }).click();
  await expect(mina.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Written during the outage.')).toBeVisible();
  await mina.context().close();
  await closeEverything();
});

test('the operator error page recovers with Try again once the database is back', async ({
  browser,
}) => {
  // Its own page: the failed server render logs to the console on purpose while the database is out.
  const mina = await operator(browser);
  const url = await openIncident(mina, { title: uniqueTitle('Error page') });
  await databaseDown();
  await mina.goto(url);
  const failure = mina.getByRole('alert').filter({ hasText: "We can't reach the database" });
  await expect(failure).toBeVisible();
  await databaseUp();
  await mina.getByRole('button', { name: 'Try again' }).click();
  await expect(mina.getByRole('button', { name: 'Post update' })).toBeVisible({ timeout: 15_000 });
  await mina.context().close();
  await closeEverything();
});

function startApp(port: number, env: Record<string, string>) {
  const child = spawn('npx', ['next', 'start', '-p', String(port)], {
    env: { ...process.env, ...APP_ENV, ...env },
    stdio: 'ignore',
    detached: true,
  });
  return {
    stop: () => {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    },
  };
}

test('a restart during an outage still shows the last reading, not green', async ({ page }) => {
  await page.goto('/');
  await eventually(page, '/', /All systems operational|Part of the service/);
  await databaseDown();
  const app = startApp(3211, { SNAPSHOT_PATH });
  try {
    await expect(async () => {
      await page.goto('http://localhost:3211/');
      await expect(headline(page)).toContainText('Last confirmed:', { timeout: 500 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText("We can't reach our status data")).toBeVisible();
  } finally {
    app.stop();
  }
});

test('with no earlier reading the page says it does not know', async ({ page, request }) => {
  await databaseDown();
  const empty = path.join(mkdtempSync(path.join(os.tmpdir(), 'outage-notes-empty-')), 'board.json');
  const app = startApp(3212, { SNAPSHOT_PATH: empty });
  try {
    await expect(async () => {
      await page.goto('http://localhost:3212/');
      await expect(headline(page)).toHaveText("We can't confirm the current status", {
        timeout: 500,
      });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByText('All systems operational')).toHaveCount(0);
    const api = await request.get('http://localhost:3212/api/status');
    expect(api.status()).toBe(503);
  } finally {
    app.stop();
  }
});

test('publishing reaches visitors at once, even under a five minute cache', async ({ browser }) => {
  await closeEverything();
  const snapshot = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'outage-notes-long-')),
    'board.json',
  );
  const app = startApp(3214, { BOARD_REVALIDATE_SECONDS: '300', SNAPSHOT_PATH: snapshot });
  const baseURL = 'http://localhost:3214';
  try {
    const visitorContext = await browser.newContext({ baseURL });
    const visitor = await visitorContext.newPage();
    await expect(async () => {
      await visitor.goto('/');
      await expect(headline(visitor)).toHaveText('All systems operational', { timeout: 500 });
    }).toPass({ timeout: 20_000 });

    const mina = await operator(browser, undefined, baseURL);
    await openIncident(mina, { title: uniqueTitle('Long cache') });
    await visitor.reload();
    await expect(headline(visitor)).toHaveText('Part of the service is down');

    await post(mina, 'All clear.', 'Resolved');
    await expect(mina.getByRole('status').filter({ hasText: 'Posted.' })).toBeVisible();
    await visitor.reload();
    await expect(headline(visitor)).toHaveText('All systems operational');
    await visitorContext.close();
    await mina.context().close();
  } finally {
    app.stop();
  }
});

test('with no session, the operator area redirects before rendering anything', async ({
  request,
}) => {
  const response = await request.get('/admin', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/\/login$/);
});

test('sign in refuses wrong details, then locks, and sign out ends the session', async ({
  page,
}) => {
  await database((client) => client.query('DELETE FROM login_failures'));
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);

  const attempt = async (password: string) => {
    await page.getByLabel('Email').fill('mina@example.com');
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
  };
  for (let n = 1; n <= 5; n += 1) {
    await attempt(`wrong-${n}`);
    await expect(page.getByText('That email and password do not match.')).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('mina@example.com');
    await page.getByLabel('Password').fill('');
    await page.waitForTimeout(50);
  }
  await attempt('demo-password');
  await expect(page.getByText('Too many attempts.')).toBeVisible();

  await database((client) => client.query('DELETE FROM login_failures'));
  await attempt('demo-password');
  await expect(page.getByRole('heading', { name: 'Signed in as Mina' })).toBeVisible();
  const session = (await page.context().cookies()).find(({ name }) => name === 'session');
  expect(session).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login$/);
});

test('forms refuse bad input without moving the button', async ({ page }) => {
  await signIn(page);
  const button = page.getByRole('button', { name: 'Open incident' });
  // Playwright scrolls to click, and bounding boxes are relative to the viewport.
  await button.scrollIntoViewIfNeeded();
  const before = await button.boundingBox();
  await button.click();
  await expect(page.getByText('Give the incident a title of 3 to 120 characters.')).toBeVisible();
  expect(await button.boundingBox()).toEqual(before);

  await page.getByLabel('Title').fill('Valid title');
  await button.click();
  await expect(page.getByText('Choose at least one affected component.')).toBeVisible();
  expect(await button.boundingBox()).toEqual(before);
});

test.describe('layout and accessibility', () => {
  let incidentUrl: string;

  test.beforeAll(async ({ browser }) => {
    const mina = await operator(browser);
    incidentUrl = await openIncident(mina, {
      title: uniqueTitle('Layout check with a fairly long title to see how it wraps on a phone'),
      impact: 'Major outage',
      components: ['API', 'Dashboard', 'Webhooks'],
      body: 'A longer public message that has to wrap on narrow screens without pushing anything sideways.',
    });
    await mina.context().close();
  });

  test.afterAll(closeEverything);

  for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [320, 390, 1280]) {
      test(`no sideways scroll or accessibility faults, ${colorScheme}, ${width}px`, async ({
        browser,
      }) => {
        const context = await browser.newContext({ colorScheme, viewport: { width, height: 800 } });
        const page = await context.newPage();
        await signIn(page);
        for (const url of ['/', '/history', '/admin', incidentUrl]) {
          await page.goto(url);
          await expect(page.locator('main')).not.toContainText('Loading…');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `${url} at ${width}px`).toBeLessThanOrEqual(0);
          const { violations } = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
            .analyze();
          expect(violations.map(({ id, nodes }) => `${url} ${id} ${nodes[0]?.target}`)).toEqual([]);
        }
        await context.close();
      });
    }

    test(`the sign in page is accessible, ${colorScheme}`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme });
      const page = await context.newPage();
      await page.goto('/login');
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
        .analyze();
      expect(violations.map(({ id }) => id)).toEqual([]);
      await context.close();
    });
  }

  test('a phone shows the last 30 days and a desktop all 90', async ({ browser }) => {
    const visible = async (width: number) => {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto('/');
      const count = await page
        .locator('main ul li')
        .first()
        .locator('[aria-hidden] > span:visible')
        .count();
      await context.close();
      return count;
    };
    expect(await visible(390)).toBe(30);
    expect(await visible(1280)).toBe(90);
  });
});
