import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Service status', template: '%s · Service status' },
  description: 'Current status, incident updates and 90-day uptime.',
  alternates: { types: { 'application/atom+xml': '/feed.xml' } },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
