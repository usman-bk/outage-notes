import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSnapshot, resolveBoard, writeSnapshot } from './board-source';
import type { BoardData } from './domain';

const data: BoardData = {
  confirmedAt: '2026-06-15T12:00:00.000Z',
  overall: 'operational',
  components: [],
  active: [],
  recent: [],
};
const down = () => Promise.reject(new Error('connection refused'));

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'outage-notes-'));
  file = path.join(dir, 'nested', 'board.json');
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

it('returns live data and saves it', async () => {
  await expect(resolveBoard(async () => data, file)).resolves.toEqual({ state: 'live', data });
  await expect(readSnapshot(file)).resolves.toEqual(data);
});

it('falls back to the last reading, marked stale, when the database is down', async () => {
  await writeSnapshot(file, data);
  await expect(resolveBoard(down, file)).resolves.toEqual({ state: 'stale', data });
});

it('answers unknown, never an empty board, with no earlier reading', async () => {
  await expect(resolveBoard(down, file)).resolves.toEqual({ state: 'unknown' });
});

it.each([
  ['truncated JSON', '{"confirmedAt":"2026'],
  ['the wrong shape', '{"confirmedAt":"2026-06-15","components":"none"}'],
  ['JSON null', 'null'],
])('treats a snapshot of %s as no snapshot', async (_, content) => {
  await writeSnapshot(file, data);
  await writeFile(file, content);
  await expect(resolveBoard(down, file)).resolves.toEqual({ state: 'unknown' });
});

it('still serves live data when the snapshot cannot be written', async () => {
  const blocker = path.join(dir, 'blocker');
  await writeFile(blocker, '');
  const impossible = path.join(blocker, 'board.json');
  await expect(resolveBoard(async () => data, impossible)).resolves.toEqual({
    state: 'live',
    data,
  });
});

it('leaves no temporary files behind', async () => {
  await writeSnapshot(file, data);
  await writeSnapshot(file, { ...data, overall: 'major' });
  const folder = path.dirname(file);
  await expect(readdir(folder)).resolves.toEqual(['board.json']);
  expect(JSON.parse(await readFile(file, 'utf8')).overall).toBe('major');
});
