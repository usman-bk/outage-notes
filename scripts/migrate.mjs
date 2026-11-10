import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await client.end();
