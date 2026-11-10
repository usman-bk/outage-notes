'use client';

import Link from 'next/link';

export default function AdminError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-degraded bg-surface p-5">
      <h1 className="text-xl font-semibold">We can&apos;t reach the database</h1>
      <p className="mt-2">Nothing can be posted until it is back. The public page is still up.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="button" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className="button button-quiet no-underline">
          Public page
        </Link>
      </div>
    </div>
  );
}
