import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { Shell } from '@/components/shell';

export const metadata: Metadata = { title: 'Operators', robots: { index: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>{children}</Suspense>
    </Shell>
  );
}
