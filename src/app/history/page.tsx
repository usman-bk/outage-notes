import type { Metadata } from 'next';
import { IncidentCard } from '@/components/board';
import { Shell } from '@/components/shell';
import { getBoard } from '@/lib/board';

export const metadata: Metadata = { title: 'History' };

export const instant = false;

export default async function HistoryPage() {
  const board = await getBoard();
  const incidents = board.state === 'unknown' ? null : board.data.recent;
  return (
    <Shell>
      <h1 className="mb-4 text-2xl font-semibold">Resolved incidents</h1>
      {incidents === null ? (
        <p>This page can&apos;t reach its data right now. Try again in a minute.</p>
      ) : incidents.length === 0 ? (
        <p className="text-muted">No incidents in the last 90 days.</p>
      ) : (
        <div className="space-y-3">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} />
          ))}
        </div>
      )}
    </Shell>
  );
}
