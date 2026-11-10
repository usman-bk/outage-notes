import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import type { UpdateInput } from './domain';
import {
  clearLoginFailures,
  createIncident,
  listOpenIncidents,
  loadBoardRows,
  loadIncident,
  LOGIN_LIMIT,
  loginLocked,
  postUpdate,
  recordLoginFailure,
} from './store';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/outage_notes_test';
if (!new URL(url).pathname.endsWith('_test')) throw new Error('Tests only run against *_test');

const pool = new Pool({ connectionString: url, max: 8 });
const mina = { id: 1, name: 'Mina' };
const tomas = { id: 2, name: 'Tomas' };
let api: number;

beforeAll(async () => {
  await pool.query(await readFile('db/schema.sql', 'utf8'));
});

beforeEach(async () => {
  await pool.query(
    'TRUNCATE incident_updates, incident_components, incidents, components, login_failures RESTART IDENTITY CASCADE',
  );
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO components (name) VALUES ('API') RETURNING id",
  );
  api = rows[0]!.id;
});

afterAll(() => pool.end());

const open = (submissionId = randomUUID()) =>
  createIncident(
    pool,
    { title: 'API errors', impact: 'major', componentIds: [api], body: 'Looking.', submissionId },
    mina,
  );

const update = (incidentId: number, over: Partial<UpdateInput> = {}): UpdateInput => ({
  incidentId,
  expectedVersion: 1,
  status: 'identified',
  body: 'Found it.',
  submissionId: randomUUID(),
  ...over,
});

const updateCount = async (id: number) =>
  (await pool.query('SELECT 1 FROM incident_updates WHERE incident_id = $1', [id])).rowCount;

describe('createIncident', () => {
  it('stores the incident, its component and the first update', async () => {
    const { id } = await open();
    const incident = await loadIncident(pool, id);
    expect(incident).toMatchObject({
      title: 'API errors',
      status: 'investigating',
      version: 1,
      components: ['API'],
    });
    expect(incident!.updates.map(({ body, author }) => [body, author])).toEqual([
      ['Looking.', 'Mina'],
    ]);
  });

  it('returns the same incident when a submission is repeated', async () => {
    const submissionId = randomUUID();
    const first = await open(submissionId);
    const second = await open(submissionId);
    expect(second.id).toBe(first.id);
    expect((await pool.query('SELECT 1 FROM incidents')).rowCount).toBe(1);
  });

  it('leaves nothing behind when part of it fails', async () => {
    const submissionId = randomUUID();
    await pool.query(
      `INSERT INTO incidents (title, impact, status, submission_id) VALUES ('x', 'major', 'investigating', $1)`,
      [randomUUID()],
    );
    await pool.query(
      `INSERT INTO incident_updates (incident_id, status, body, author, submission_id)
       VALUES (1, 'investigating', 'x', 'x', $1)`,
      [submissionId],
    );
    await expect(open(submissionId)).rejects.toThrow(/duplicate key/);
    expect((await pool.query('SELECT 1 FROM incidents')).rowCount).toBe(1);
  });
});

describe('postUpdate', () => {
  it('posts, moves the status and bumps the version', async () => {
    const { id } = await open();
    await expect(postUpdate(pool, update(id), tomas)).resolves.toEqual({
      kind: 'posted',
      version: 2,
    });
    const incident = await loadIncident(pool, id);
    expect(incident).toMatchObject({ status: 'identified', version: 2 });
    expect(incident!.updates[0]).toMatchObject({ body: 'Found it.', author: 'Tomas' });
  });

  it('refuses a stale version and reports what got there first', async () => {
    const { id } = await open();
    await postUpdate(pool, update(id, { body: 'First.' }), mina);
    const result = await postUpdate(
      pool,
      update(id, { body: 'Second.', status: 'monitoring' }),
      tomas,
    );
    expect(result).toMatchObject({
      kind: 'conflict',
      version: 2,
      status: 'identified',
      latest: { body: 'First.', author: 'Mina' },
    });
    expect(await updateCount(id)).toBe(2);
    expect((await loadIncident(pool, id))!.status).toBe('identified');
  });

  it('lets exactly one of two truly simultaneous posts win', async () => {
    const { id } = await open();
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT 1 FROM incidents WHERE id = $1 FOR UPDATE', [id]);

    const racing = Promise.all([
      postUpdate(pool, update(id, { body: 'A' }), mina),
      postUpdate(pool, update(id, { body: 'B' }), tomas),
    ]);
    // Hold both behind the row lock until Postgres says both are waiting, so they really collide.
    for (let waited = 0; ; waited += 1) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (rows[0]!.n >= 2) break;
      if (waited > 200) throw new Error('the two posts never collided');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await blocker.query('COMMIT');
    blocker.release();

    const kinds = (await racing).map(({ kind }) => kind).sort();
    expect(kinds).toEqual(['conflict', 'posted']);
    expect(await updateCount(id)).toBe(2);
    expect((await loadIncident(pool, id))!.version).toBe(2);
  });

  it('treats a retry of a post that landed as done, not as a clash', async () => {
    const { id } = await open();
    const input = update(id);
    await postUpdate(pool, input, mina);
    await expect(postUpdate(pool, input, mina)).resolves.toEqual({ kind: 'duplicate' });
    expect(await updateCount(id)).toBe(2);
  });

  it('reports an incident that does not exist', async () => {
    await expect(postUpdate(pool, update(999), mina)).resolves.toEqual({ kind: 'not_found' });
  });

  it('rolls the status back if the update cannot be written', async () => {
    const { id } = await open();
    const other = await open();
    const used = randomUUID();
    await postUpdate(pool, update(other.id, { submissionId: used }), mina);
    await expect(postUpdate(pool, update(id, { submissionId: used }), mina)).rejects.toThrow(
      /duplicate key/,
    );
    expect(await loadIncident(pool, id)).toMatchObject({ status: 'investigating', version: 1 });
  });

  it('sets the resolved time, then clears it on reopening', async () => {
    const { id } = await open();
    await postUpdate(pool, update(id, { status: 'resolved' }), mina);
    expect((await loadIncident(pool, id))!.resolvedAt).not.toBeNull();
    await expect(listOpenIncidents(pool)).resolves.toHaveLength(0);

    await postUpdate(pool, update(id, { status: 'monitoring', expectedVersion: 2 }), mina);
    expect((await loadIncident(pool, id))!.resolvedAt).toBeNull();
    await expect(listOpenIncidents(pool)).resolves.toHaveLength(1);
  });

  it('keeps the first resolved time when a resolved incident gets a follow-up', async () => {
    const { id } = await open();
    await postUpdate(pool, update(id, { status: 'resolved' }), mina);
    const first = (await loadIncident(pool, id))!.resolvedAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await postUpdate(pool, update(id, { status: 'resolved', expectedVersion: 2 }), mina);
    expect((await loadIncident(pool, id))!.resolvedAt).toBe(first);
  });
});

describe('the schema itself', () => {
  const insert = (status: string, resolved: string | null, started = 'now()') =>
    pool.query(
      `INSERT INTO incidents (title, impact, status, started_at, resolved_at, submission_id)
       VALUES ('x', 'major', $1, ${started}, $2, $3)`,
      [status, resolved, randomUUID()],
    );

  it('refuses a resolved incident with no resolved time', async () => {
    await expect(insert('resolved', null)).rejects.toThrow(/resolved_means_resolved_at/);
  });
  it('refuses a resolved time on an open incident', async () => {
    await expect(insert('monitoring', '2099-01-01')).rejects.toThrow(/resolved_means_resolved_at/);
  });
  it('refuses an incident that ends before it starts', async () => {
    await expect(insert('resolved', '2026-01-01', "'2026-06-01'")).rejects.toThrow(
      /ends_after_it_starts/,
    );
  });
});

describe('loadBoardRows', () => {
  it('returns newest updates first', async () => {
    const { id } = await open();
    await postUpdate(pool, update(id, { body: 'Later.' }), mina);
    const { incidents } = await loadBoardRows(pool, new Date());
    expect(incidents[0]!.updates.map(({ body }) => body)).toEqual(['Later.', 'Looking.']);
  });

  it('drops incidents resolved more than 90 days ago and keeps open ones of any age', async () => {
    const add = (status: string, started: string, resolved: string | null) =>
      pool.query(
        `INSERT INTO incidents (title, impact, status, started_at, resolved_at, submission_id)
         VALUES ($1, 'major', $1, now() - $2::interval, now() - $3::interval, $4)`,
        [status, started, resolved, randomUUID()],
      );
    await add('resolved', '200 days', '100 days');
    await add('monitoring', '200 days', null);
    const { incidents } = await loadBoardRows(pool, new Date());
    expect(incidents.map(({ status }) => status)).toEqual(['monitoring']);
  });
});

describe('login limit', () => {
  const email = 'mina@example.com';

  it('locks at the limit and not before', async () => {
    for (let n = 1; n < LOGIN_LIMIT; n += 1) await recordLoginFailure(pool, email);
    await expect(loginLocked(pool, email)).resolves.toBe(false);
    await recordLoginFailure(pool, email);
    await expect(loginLocked(pool, email)).resolves.toBe(true);
  });
  it('locks one email without touching another', async () => {
    for (let n = 0; n < LOGIN_LIMIT; n += 1) await recordLoginFailure(pool, email);
    await expect(loginLocked(pool, 'tomas@example.com')).resolves.toBe(false);
  });
  it('forgets failures older than 15 minutes', async () => {
    for (let n = 0; n < LOGIN_LIMIT; n += 1) {
      await pool.query(
        `INSERT INTO login_failures (email, at) VALUES ($1, now() - interval '16 minutes')`,
        [email],
      );
    }
    await expect(loginLocked(pool, email)).resolves.toBe(false);
  });
  it('clears after a successful sign in', async () => {
    for (let n = 0; n < LOGIN_LIMIT; n += 1) await recordLoginFailure(pool, email);
    await clearLoginFailures(pool, email);
    await expect(loginLocked(pool, email)).resolves.toBe(false);
  });
});
