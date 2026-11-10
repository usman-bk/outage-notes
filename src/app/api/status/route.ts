import { getBoard } from '@/lib/board';

export async function GET() {
  const board = await getBoard();
  if (board.state === 'unknown') return Response.json({ state: 'unknown' }, { status: 503 });
  const { state, data } = board;
  return Response.json({
    state,
    overall: data.overall,
    confirmedAt: data.confirmedAt,
    components: data.components.map(({ name, level, uptime }) => ({ name, level, uptime })),
    active: data.active.map(({ id, title, status, impact }) => ({ id, title, status, impact })),
  });
}
