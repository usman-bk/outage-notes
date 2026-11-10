'use client';

import { useSyncExternalStore } from 'react';

const never = () => () => undefined;
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function format(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

/** UTC in the HTML, the reader's own clock once React is running. No JavaScript still reads true. */
export function LocalTime({ iso }: { iso: string }) {
  const zone = useSyncExternalStore(never, viewerZone, () => 'UTC');
  return (
    <time dateTime={iso} className="tabular-nums">
      {format(iso, zone)}
    </time>
  );
}
