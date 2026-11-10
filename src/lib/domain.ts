export const IMPACTS = ['degraded', 'partial', 'major'] as const;
export const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

export type Impact = (typeof IMPACTS)[number];
export type Status = (typeof STATUSES)[number];
export type Level = 'operational' | Impact;

export interface UpdateView {
  id: string;
  status: Status;
  body: string;
  author: string;
  createdAt: string;
}

export interface IncidentView {
  id: number;
  title: string;
  impact: Impact;
  status: Status;
  startedAt: string;
  resolvedAt: string | null;
  components: string[];
  updates: UpdateView[];
}

export interface ComponentRow {
  id: number;
  name: string;
  createdAt: string;
}

export interface ComponentView {
  id: number;
  name: string;
  level: Level;
  uptime: number;
  days: Level[];
}

export interface BoardData {
  confirmedAt: string;
  overall: Level;
  components: ComponentView[];
  active: IncidentView[];
  recent: IncidentView[];
}

export type Board =
  { state: 'live'; data: BoardData } | { state: 'stale'; data: BoardData } | { state: 'unknown' };

const RANK: Record<Level, number> = { operational: 0, degraded: 1, partial: 2, major: 3 };
const DAY_MS = 86_400_000;
export const WINDOW_DAYS = 90;

export function worst(levels: Iterable<Level>): Level {
  let result: Level = 'operational';
  for (const level of levels) if (RANK[level] > RANK[result]) result = level;
  return result;
}

export type Interval = readonly [start: number, end: number];

/** Overlapping outages must count once, or two incidents in the same hour read as two hours down. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const merged: [number, number][] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Rounds down. A short outage must never display as 100.00%, because the page would be
 * contradicting its own incident list.
 */
export function uptimePercent(
  down: readonly Interval[],
  windowStart: number,
  windowEnd: number,
): number {
  const span = windowEnd - windowStart;
  if (span <= 0) return 100;
  const clipped = down
    .map(([start, end]): Interval => [Math.max(start, windowStart), Math.min(end, windowEnd)])
    .filter(([start, end]) => end > start);
  const lost = mergeIntervals(clipped).reduce((total, [start, end]) => total + end - start, 0);
  return Math.floor(((span - lost) / span) * 10_000) / 100;
}

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Oldest first. The last entry is the current UTC day. */
export function dayLevels(
  incidents: readonly { impact: Impact; start: number; end: number | null }[],
  now: number,
  days = WINDOW_DAYS,
): Level[] {
  const today = startOfUtcDay(now);
  return Array.from({ length: days }, (_, index) => {
    const dayStart = today - (days - 1 - index) * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    return worst(
      incidents
        .filter(({ start, end }) => start < dayEnd && (end === null || end > dayStart))
        .map(({ impact }) => impact),
    );
  });
}

export function buildBoard(
  components: readonly ComponentRow[],
  incidents: readonly IncidentView[],
  now: number,
  recentLimit = 20,
): BoardData {
  const windowStart = now - WINDOW_DAYS * DAY_MS;
  const views = components.map((component): ComponentView => {
    const mine = incidents
      .filter((incident) => incident.components.includes(component.name))
      .map((incident) => ({
        impact: incident.impact,
        start: Date.parse(incident.startedAt),
        end: incident.resolvedAt ? Date.parse(incident.resolvedAt) : null,
      }));
    const since = Math.max(windowStart, Date.parse(component.createdAt));
    const outages = mine
      .filter(({ impact }) => impact === 'major')
      .map(({ start, end }): Interval => [start, end ?? now]);
    return {
      id: component.id,
      name: component.name,
      level: worst(mine.filter(({ end }) => end === null).map(({ impact }) => impact)),
      uptime: uptimePercent(outages, since, now),
      days: dayLevels(mine, now),
    };
  });
  return {
    confirmedAt: new Date(now).toISOString(),
    overall: worst(views.map(({ level }) => level)),
    components: views,
    active: incidents.filter(({ resolvedAt }) => resolvedAt === null),
    recent: incidents.filter(({ resolvedAt }) => resolvedAt !== null).slice(0, recentLimit),
  };
}

export const LEVEL_LABEL: Record<Level, string> = {
  operational: 'Operational',
  degraded: 'Degraded performance',
  partial: 'Partial outage',
  major: 'Major outage',
};

export const OVERALL_HEADLINE: Record<Level, string> = {
  operational: 'All systems operational',
  degraded: 'Some systems are slow',
  partial: 'Part of the service is down',
  major: 'Major outage',
};

export const STATUS_LABEL: Record<Status, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

export type FormResult =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; version: number; latest: UpdateView | null };

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const isStatus = (value: unknown): value is Status =>
  typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
const isImpact = (value: unknown): value is Impact =>
  typeof value === 'string' && (IMPACTS as readonly string[]).includes(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

export interface UpdateInput {
  incidentId: number;
  expectedVersion: number;
  status: Status;
  body: string;
  submissionId: string;
}

export function parseUpdate(form: Record<string, unknown>): Parsed<UpdateInput> {
  const incidentId = wholeNumber(form.incidentId);
  const expectedVersion = wholeNumber(form.version);
  const submissionId = text(form.submissionId);
  if (incidentId === null || expectedVersion === null || !UUID.test(submissionId)) {
    return { ok: false, message: 'This form is out of date. Reload the page and try again.' };
  }
  if (!isStatus(form.status)) return { ok: false, message: 'Choose a status.' };
  const body = text(form.body);
  if (!body) return { ok: false, message: 'Write what changed before posting.' };
  if (body.length > 2000) return { ok: false, message: 'Keep the update under 2,000 characters.' };
  return {
    ok: true,
    value: { incidentId, expectedVersion, status: form.status, body, submissionId },
  };
}

export interface NewIncidentInput {
  title: string;
  impact: Impact;
  componentIds: number[];
  body: string;
  submissionId: string;
}

export function parseNewIncident(
  form: Record<string, unknown>,
  componentIds: readonly unknown[],
): Parsed<NewIncidentInput> {
  const submissionId = text(form.submissionId);
  if (!UUID.test(submissionId)) {
    return { ok: false, message: 'This form is out of date. Reload the page and try again.' };
  }
  const title = text(form.title);
  if (title.length < 3 || title.length > 120) {
    return { ok: false, message: 'Give the incident a title of 3 to 120 characters.' };
  }
  if (!isImpact(form.impact)) return { ok: false, message: 'Choose an impact.' };
  const ids = [...new Set(componentIds.map(wholeNumber))];
  if (ids.length === 0 || ids.includes(null)) {
    return { ok: false, message: 'Choose at least one affected component.' };
  }
  const body = text(form.body);
  if (!body) return { ok: false, message: 'Write a first update for the public page.' };
  if (body.length > 2000) return { ok: false, message: 'Keep the update under 2,000 characters.' };
  return {
    ok: true,
    value: { title, impact: form.impact, componentIds: ids as number[], body, submissionId },
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
