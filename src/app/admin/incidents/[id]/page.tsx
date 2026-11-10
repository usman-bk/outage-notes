import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { IncidentCard } from '@/components/board';
import { UpdateForm } from '@/components/forms';
import { requireOperatorPage } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { loadIncident } from '@/lib/store';
import { postUpdateAction } from '../../actions';

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  await requireOperatorPage();
  const { id } = await params;
  const { posted } = await searchParams;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const incident = await loadIncident(getPool(), Number(id));
  if (!incident) notFound();
  return (
    <>
      <p className="mb-2">
        <Link href="/admin" className="inline-flex min-h-11 items-center">
          All incidents
        </Link>
      </p>
      <div className="min-h-6 text-sm text-operational" role="status">
        {posted ? 'Posted. The public page has been updated.' : ''}
      </div>
      <div className="mt-2">
        <IncidentCard incident={incident} />
      </div>
      <section aria-labelledby="post" className="mt-6">
        <h2 id="post" className="mb-3 text-lg font-semibold">
          Post an update
        </h2>
        {/* A new version is a new form: the draft and its submission id must not carry over. */}
        <UpdateForm
          key={incident.version}
          incidentId={incident.id}
          version={incident.version}
          status={incident.status}
          submissionId={randomUUID()}
          action={postUpdateAction}
        />
      </section>
    </>
  );
}
