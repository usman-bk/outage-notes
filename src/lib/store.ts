import type { Pool, PoolClient } from 'pg';
import type {
  ComponentRow,
  IncidentView,
  NewIncidentInput,
  Status,
  UpdateInput,
  UpdateView,
} from './domain';

const iso = (value: Date | string) => new Date(value).toISOString();

async function inTransaction<T>(
  pool: Pool,
  begin: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export interface OperatorName {
  id: number;
  name: string;
}

interface IncidentRow {
  id: number;
  title: string;
  impact: IncidentView['impact'];
  status: Status;
  started_at: Date;
  resolved_at: Date | null;
  version: number;
  components: string[];
}

async function updatesFor(client: Pick<Pool, 'query'>, ids: number[]) {
  const { rows } = await client.query<{
    id: string;
    incident_id: number;
    status: Status;
    body: string;
    author: string;
    created_at: Date;
  }>(
    `SELECT id, incident_id, status, body, author, created_at FROM incident_updates
     WHERE incident_id = ANY($1) ORDER BY id DESC`,
    [ids],
  );
  const byIncident = new Map<number, UpdateView[]>();
  for (const row of rows) {
    const list = byIncident.get(row.incident_id) ?? [];
    list.push({
      id: row.id,
      status: row.status,
      body: row.body,
      author: row.author,
      createdAt: iso(row.created_at),
    });
    byIncident.set(row.incident_id, list);
  }
  return byIncident;
}

const INCIDENT_COLUMNS = `
  i.id, i.title, i.impact, i.status, i.started_at, i.resolved_at, i.version,
  COALESCE(array_agg(c.name ORDER BY c.position) FILTER (WHERE c.id IS NOT NULL), '{}') AS components`;
const INCIDENT_JOINS = `
  FROM incidents i
  LEFT JOIN incident_components ic ON ic.incident_id = i.id
  LEFT JOIN components c ON c.id = ic.component_id`;

function toView(row: IncidentRow, updates: UpdateView[]): IncidentView {
  return {
    id: row.id,
    title: row.title,
    impact: row.impact,
    status: row.status,
    startedAt: iso(row.started_at),
    resolvedAt: row.resolved_at ? iso(row.resolved_at) : null,
    components: row.components,
    updates,
  };
}

/**
 * Read in one repeatable-read snapshot. As separate autocommit reads, an update landing between
 * them could give a resolved incident whose timeline has not reached "resolved" yet.
 */
export async function loadBoardRows(
  pool: Pool,
  now: Date,
): Promise<{ components: ComponentRow[]; incidents: IncidentView[] }> {
  return inTransaction(pool, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', async (client) => {
    const components = await client.query<{ id: number; name: string; created_at: Date }>(
      'SELECT id, name, created_at FROM components ORDER BY position, id',
    );
    const incidents = await client.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} ${INCIDENT_JOINS}
       WHERE i.resolved_at IS NULL OR i.resolved_at > $1::timestamptz - interval '90 days'
       GROUP BY i.id ORDER BY i.started_at DESC, i.id DESC`,
      [now],
    );
    const updates = await updatesFor(
      client,
      incidents.rows.map(({ id }) => id),
    );
    return {
      components: components.rows.map(({ id, name, created_at }) => ({
        id,
        name,
        createdAt: iso(created_at),
      })),
      incidents: incidents.rows.map((row) => toView(row, updates.get(row.id) ?? [])),
    };
  });
}

export async function listComponents(pool: Pool) {
  const { rows } = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM components ORDER BY position, id',
  );
  return rows;
}

export async function listOpenIncidents(pool: Pool) {
  const { rows } = await pool.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} ${INCIDENT_JOINS}
     WHERE i.resolved_at IS NULL GROUP BY i.id ORDER BY i.started_at DESC, i.id DESC`,
  );
  return rows.map((row) => toView(row, []));
}

export interface EditableIncident extends IncidentView {
  version: number;
}

export async function loadIncident(pool: Pool, id: number): Promise<EditableIncident | null> {
  const { rows } = await pool.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS} ${INCIDENT_JOINS} WHERE i.id = $1 GROUP BY i.id`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const updates = await updatesFor(pool, [id]);
  return { ...toView(row, updates.get(id) ?? []), version: row.version };
}

/** A repeated submission gives back the incident it already created. */
export async function createIncident(
  pool: Pool,
  input: NewIncidentInput,
  author: OperatorName,
): Promise<{ id: number }> {
  return inTransaction(pool, 'BEGIN', async (client) => {
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO incidents (title, impact, status, submission_id)
       VALUES ($1, $2, 'investigating', $3)
       ON CONFLICT (submission_id) DO NOTHING RETURNING id`,
      [input.title, input.impact, input.submissionId],
    );
    const created = inserted.rows[0];
    if (!created) {
      const existing = await client.query<{ id: number }>(
        'SELECT id FROM incidents WHERE submission_id = $1',
        [input.submissionId],
      );
      return { id: existing.rows[0]!.id };
    }
    await client.query(
      `INSERT INTO incident_components (incident_id, component_id)
       SELECT $1, id FROM components WHERE id = ANY($2)`,
      [created.id, input.componentIds],
    );
    await client.query(
      `INSERT INTO incident_updates (incident_id, status, body, author, submission_id)
       VALUES ($1, 'investigating', $2, $3, $4)`,
      [created.id, input.body, author.name, input.submissionId],
    );
    return created;
  });
}

export type PostResult =
  | { kind: 'posted'; version: number }
  | { kind: 'duplicate' }
  | { kind: 'conflict'; version: number; status: Status; latest: UpdateView | null }
  | { kind: 'not_found' };

/**
 * The version in the WHERE clause is the whole concurrency story. Under READ COMMITTED the second
 * writer blocks on the row lock, then re-evaluates the WHERE against the row the first one wrote,
 * matches nothing, and is told someone else got there first.
 */
export async function postUpdate(
  pool: Pool,
  input: UpdateInput,
  author: OperatorName,
): Promise<PostResult> {
  return inTransaction(pool, 'BEGIN', async (client): Promise<PostResult> => {
    const updated = await client.query<{ version: number }>(
      `UPDATE incidents
       SET status = $1,
           resolved_at = CASE WHEN $1 = 'resolved' THEN COALESCE(resolved_at, now()) END,
           version = version + 1
       WHERE id = $2 AND version = $3
       RETURNING version`,
      [input.status, input.incidentId, input.expectedVersion],
    );
    const row = updated.rows[0];
    if (row) {
      await client.query(
        `INSERT INTO incident_updates (incident_id, status, body, author, submission_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.incidentId, input.status, input.body, author.name, input.submissionId],
      );
      return { kind: 'posted', version: row.version };
    }

    // A retry of a post that already landed also misses on version, and must not read as a clash.
    const repeat = await client.query('SELECT 1 FROM incident_updates WHERE submission_id = $1', [
      input.submissionId,
    ]);
    if (repeat.rowCount) return { kind: 'duplicate' };

    const current = await client.query<{ version: number; status: Status }>(
      'SELECT version, status FROM incidents WHERE id = $1',
      [input.incidentId],
    );
    const incident = current.rows[0];
    if (!incident) return { kind: 'not_found' };
    const latest = (await updatesFor(client, [input.incidentId])).get(input.incidentId)?.[0];
    return {
      kind: 'conflict',
      version: incident.version,
      status: incident.status,
      latest: latest ?? null,
    };
  });
}

export interface OperatorRecord {
  id: number;
  email: string;
  name: string;
  password_hash: string;
  active: boolean;
}

export async function findOperatorByEmail(pool: Pool, email: string) {
  const { rows } = await pool.query<OperatorRecord>(
    'SELECT id, email, name, password_hash, active FROM operators WHERE email = $1',
    [email],
  );
  return rows[0] ?? null;
}

export async function findActiveOperator(pool: Pool, id: number): Promise<OperatorName | null> {
  const { rows } = await pool.query<OperatorName>(
    'SELECT id, name FROM operators WHERE id = $1 AND active',
    [id],
  );
  return rows[0] ?? null;
}

export const LOGIN_LIMIT = 5;

export async function loginLocked(pool: Pool, email: string): Promise<boolean> {
  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM login_failures
     WHERE email = $1 AND at > now() - interval '15 minutes'`,
    [email],
  );
  return (rows[0]?.n ?? 0) >= LOGIN_LIMIT;
}

export async function recordLoginFailure(pool: Pool, email: string): Promise<void> {
  await pool.query('INSERT INTO login_failures (email) VALUES ($1)', [email]);
}

export async function clearLoginFailures(pool: Pool, email: string): Promise<void> {
  await pool.query('DELETE FROM login_failures WHERE email = $1', [email]);
}
