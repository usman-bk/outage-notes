import Link from 'next/link';
import type { ReactNode } from 'react';

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:mt-2">
        Skip to content
      </a>
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-semibold text-ink no-underline">
          Service status
        </Link>
        <nav aria-label="Main" className="flex gap-4 text-sm">
          <Link href="/history" className="inline-flex min-h-11 items-center">
            History
          </Link>
          <a href="/feed.xml" className="inline-flex min-h-11 items-center">
            Feed
          </a>
        </nav>
      </header>
      <main id="main" className="flex-1 pb-10">
        {children}
      </main>
      <footer className="border-t border-line py-4 text-sm text-muted">
        <Link href="/admin" className="inline-flex min-h-11 items-center">
          Operator sign in
        </Link>
      </footer>
    </div>
  );
}
