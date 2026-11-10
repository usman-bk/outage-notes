import { cacheLife, cacheTag } from 'next/cache';
import { connection } from 'next/server';
import { resolveBoard } from './board-source';
import { getPool } from './db';
import { buildBoard, type Board } from './domain';
import { loadBoardRows } from './store';

export const BOARD_TAG = 'board';

const SNAPSHOT = process.env.SNAPSHOT_PATH ?? '.data/board.json';

async function cachedBoard(): Promise<Board> {
  'use cache';
  cacheTag(BOARD_TAG);
  // Publishing invalidates at once. The timer only decides how soon a recovered database is noticed.
  cacheLife({
    stale: 5,
    revalidate: Number(process.env.BOARD_REVALIDATE_SECONDS ?? 15),
    expire: 31_536_000,
  });

  return resolveBoard(async () => {
    const now = new Date();
    const { components, incidents } = await loadBoardRows(getPool(), now);
    return buildBoard(components, incidents, now.getTime());
  }, SNAPSHOT);
}

/**
 * Waiting for a request first keeps this out of the build. Otherwise the build runs the read, with
 * no database to reach, and ships "unknown" as the cached answer every visitor then gets.
 */
export async function getBoard(): Promise<Board> {
  await connection();
  return cachedBoard();
}
