import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const hash = (password) => {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
};

const client = new pg.Client({ connectionString: url });
await client.connect();

const names = ['API', 'Dashboard', 'Webhooks', 'File storage'];
for (const [position, name] of names.entries()) {
  await client.query(
    `INSERT INTO components (name, position, created_at) VALUES ($1, $2, now() - interval '120 days')
     ON CONFLICT (name) DO NOTHING`,
    [name, position],
  );
}

for (const [email, name] of [
  ['mina@example.com', 'Mina'],
  ['tomas@example.com', 'Tomas'],
]) {
  await client.query(
    `INSERT INTO operators (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [email, name, hash('demo-password')],
  );
}

const { rows } = await client.query('SELECT count(*)::int AS n FROM incidents');
if (rows[0].n === 0 && process.argv.includes('--history')) {
  const past = [
    [
      'Webhook deliveries delayed',
      'degraded',
      41,
      95,
      ['Webhooks'],
      'Deliveries were queued for up to nine minutes.',
    ],
    [
      'API returning 503 errors',
      'major',
      17,
      38,
      ['API', 'Dashboard'],
      'A failed database primary took the API down until the replica was promoted.',
    ],
    [
      'Uploads failing in one region',
      'partial',
      6,
      52,
      ['File storage'],
      'Uploads to one storage region failed and were retried elsewhere.',
    ],
  ];
  for (const [title, impact, daysAgo, minutes, affected, body] of past) {
    const { rows: created } = await client.query(
      `INSERT INTO incidents (title, impact, status, started_at, resolved_at, submission_id)
       VALUES ($1, $2, 'resolved', now() - make_interval(days => $3),
               now() - make_interval(days => $3) + make_interval(mins => $4), $5)
       RETURNING id, resolved_at`,
      [title, impact, daysAgo, minutes, randomUUID()],
    );
    await client.query(
      `INSERT INTO incident_components (incident_id, component_id)
       SELECT $1, id FROM components WHERE name = ANY($2)`,
      [created[0].id, affected],
    );
    await client.query(
      `INSERT INTO incident_updates (incident_id, status, body, author, created_at, submission_id)
       VALUES ($1, 'resolved', $2, 'Mina', $3, $4)`,
      [created[0].id, body, created[0].resolved_at, randomUUID()],
    );
  }
}

await client.end();
