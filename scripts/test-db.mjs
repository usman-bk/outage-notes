import pg from 'pg';

// Local Postgres can hold real databases, so these scripts only ever touch one exact name.
const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/outage_notes_test');
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+_test$/.test(name))
  throw new Error(`Refusing database "${name}": must end in _test`);

const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
const admin = new pg.Client({ connectionString: adminUrl.href });
await admin.connect();
const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (!rowCount) await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();
