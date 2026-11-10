import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Board, BoardData } from './domain';

export async function writeSnapshot(file: string, data: BoardData): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // Rename is atomic, so a crash mid write cannot leave half a file to be read during an outage.
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(data));
  await rename(temporary, file);
}

export async function readSnapshot(file: string): Promise<BoardData | null> {
  try {
    const data = JSON.parse(await readFile(file, 'utf8')) as BoardData;
    const usable =
      typeof data.confirmedAt === 'string' &&
      Array.isArray(data.components) &&
      Array.isArray(data.active) &&
      Array.isArray(data.recent);
    return usable ? data : null;
  } catch {
    return null;
  }
}

/**
 * Three outcomes, on purpose. If the database cannot be read and nothing was saved, the answer is
 * "unknown". An empty board would render as "all systems operational" during an outage.
 */
export async function resolveBoard(load: () => Promise<BoardData>, file: string): Promise<Board> {
  let data: BoardData;
  try {
    data = await load();
  } catch (error) {
    console.error('board read failed:', error instanceof Error ? error.message : error);
    const saved = await readSnapshot(file);
    return saved ? { state: 'stale', data: saved } : { state: 'unknown' };
  }
  await writeSnapshot(file, data).catch((error: Error) =>
    console.error('snapshot write failed:', error.message),
  );
  return { state: 'live', data };
}
