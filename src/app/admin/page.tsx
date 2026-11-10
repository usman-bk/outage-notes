import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { NewIncidentForm } from '@/components/forms';
import { requireOperatorPage } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { LEVEL_LABEL, STATUS_LABEL } from '@/lib/domain';
import { listComponents, listOpenIncidents } from '@/lib/store';
import { createIncidentAction, signOutAction } from './actions';

export default async function AdminPage() {
  const operator = await requireOperatorPage();
  const pool = getPool();
  const [open, components] = await Promise.all([listOpenIncidents(pool), listComponents(pool)]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Signed in as {operator.name}</h1>
        <form action={signOutAction}>
          <button type="submit" className="button button-quiet">
            Sign out
          </button>
        </form>
      </div>

      <section aria-labelledby="open" className="mt-8">
        <h2 id="open" className="mb-3 text-lg font-semibold">
          Open incidents
        </h2>
        {open.length === 0 ? (
          <p className="text-muted">Nothing open.</p>
        ) : (
          <ul className="rounded-lg border border-line bg-surface">
            {open.map((incident) => (
              <li key={incident.id} className="border-b border-line p-4 last:border-b-0">
                <Link href={`/admin/incidents/${incident.id}`} className="font-semibold">
                  {incident.title}
                </Link>
                <p className="text-sm text-muted">
                  {STATUS_LABEL[incident.status]} · {LEVEL_LABEL[incident.impact]}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="new" className="mt-8">
        <h2 id="new" className="mb-3 text-lg font-semibold">
          Open a new incident
        </h2>
        <NewIncidentForm
          components={components}
          submissionId={randomUUID()}
          action={createIncidentAction}
        />
      </section>
    </>
  );
}
