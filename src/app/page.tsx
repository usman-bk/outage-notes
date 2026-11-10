import { ComponentCard, IncidentCard } from '@/components/board';
import { LocalTime } from '@/components/local-time';
import { Shell } from '@/components/shell';
import { getBoard } from '@/lib/board';
import { OVERALL_HEADLINE, type Level } from '@/lib/domain';

const BAND: Record<Level, string> = {
  operational: 'bg-operational',
  degraded: 'bg-degraded',
  partial: 'bg-partial',
  major: 'bg-major',
};

// Blocking, not streamed. A streamed section needs JavaScript to appear, and a status page has
// to read correctly in whatever browser someone has during an outage.
export const instant = false;

export default async function HomePage() {
  const board = await getBoard();

  if (board.state === 'unknown') {
    return (
      <Shell>
        <section className="rounded-lg border border-line bg-surface p-5">
          <h1 className="text-2xl font-semibold">We can&apos;t confirm the current status</h1>
          <p className="mt-2 text-muted">
            This page can&apos;t reach its data right now and has no earlier reading to show. That
            does not mean everything is working. Try again in a minute.
          </p>
        </section>
      </Shell>
    );
  }

  const { data, state } = board;
  const live = state === 'live';
  return (
    <Shell>
      {live ? null : (
        <p role="status" className="mb-4 rounded-lg border border-degraded bg-surface p-4">
          We can&apos;t reach our status data, so this may be out of date. Last confirmed{' '}
          <LocalTime iso={data.confirmedAt} />.
        </p>
      )}
      {/* An old reading keeps its words but loses the colour: it must not look like a green light. */}
      <section className="rounded-lg border border-line bg-surface">
        <div
          aria-hidden="true"
          className={`h-2 rounded-t-lg ${live ? BAND[data.overall] : 'bg-unknown'}`}
        />
        <div className="p-5">
          <h1 className="text-2xl font-semibold">
            {live
              ? OVERALL_HEADLINE[data.overall]
              : `Last confirmed: ${OVERALL_HEADLINE[data.overall]}`}
          </h1>
          {live ? (
            <p className="mt-1 text-sm text-muted">
              Checked <LocalTime iso={data.confirmedAt} />
            </p>
          ) : null}
        </div>
      </section>

      {data.active.length > 0 ? (
        <section aria-labelledby="active" className="mt-8">
          <h2 id="active" className="mb-3 text-lg font-semibold">
            Current incidents
          </h2>
          <div className="space-y-3">
            {data.active.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="components" className="mt-8">
        <h2 id="components" className="mb-3 text-lg font-semibold">
          Components
        </h2>
        <ul className="rounded-lg border border-line bg-surface">
          {data.components.map((component) => (
            <ComponentCard key={component.id} component={component} />
          ))}
        </ul>
      </section>
    </Shell>
  );
}
