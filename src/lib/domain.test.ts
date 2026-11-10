import {
  buildBoard,
  dayLevels,
  escapeXml,
  mergeIntervals,
  parseNewIncident,
  parseUpdate,
  uptimePercent,
  worst,
  type IncidentView,
} from './domain';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-06-15T12:00:00Z');
const UUID = '6f1c1a52-4f1b-4c55-9a56-2a0a6bb6b0f1';

describe('worst', () => {
  it('is operational with nothing to compare', () => {
    expect(worst([])).toBe('operational');
  });
  it('picks the most severe regardless of order', () => {
    expect(worst(['degraded', 'major', 'partial'])).toBe('major');
    expect(worst(['partial', 'degraded'])).toBe('partial');
  });
});

describe('mergeIntervals', () => {
  it('joins overlapping and touching outages', () => {
    expect(
      mergeIntervals([
        [5, 9],
        [1, 3],
        [3, 6],
      ]),
    ).toEqual([[1, 9]]);
  });
  it('keeps a contained outage from shortening the outer one', () => {
    expect(
      mergeIntervals([
        [0, 10],
        [2, 3],
      ]),
    ).toEqual([[0, 10]]);
  });
  it('keeps separate outages separate', () => {
    expect(
      mergeIntervals([
        [0, 1],
        [2, 3],
      ]),
    ).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });
});

describe('uptimePercent', () => {
  it('is 100 with no outages', () => {
    expect(uptimePercent([], 0, DAY)).toBe(100);
  });
  it('is 100 for an empty window', () => {
    expect(uptimePercent([[0, 10]], 5, 5)).toBe(100);
  });
  it('does not count the same hour twice for overlapping incidents', () => {
    expect(
      uptimePercent(
        [
          [0, HOUR],
          [0, HOUR],
        ],
        0,
        10 * HOUR,
      ),
    ).toBe(90);
  });
  it('rounds down, so a short outage cannot show as 100.00', () => {
    expect(uptimePercent([[0, 60_000]], 0, 90 * DAY)).toBe(99.99);
  });
  it('ignores time outside the window', () => {
    expect(uptimePercent([[-5 * HOUR, HOUR]], 0, 10 * HOUR)).toBe(90);
  });
});

describe('dayLevels', () => {
  const startOfToday = Date.parse('2026-06-15T00:00:00Z');

  it('returns one entry per day, today last', () => {
    const levels = dayLevels([{ impact: 'major', start: NOW - HOUR, end: NOW }], NOW, 3);
    expect(levels).toEqual(['operational', 'operational', 'major']);
  });
  it('marks both UTC days when an incident crosses midnight', () => {
    const levels = dayLevels(
      [{ impact: 'partial', start: startOfToday - HOUR, end: startOfToday + HOUR }],
      NOW,
      2,
    );
    expect(levels).toEqual(['partial', 'partial']);
  });
  it('does not mark a day an incident ended exactly at the start of', () => {
    const levels = dayLevels(
      [{ impact: 'major', start: startOfToday - HOUR, end: startOfToday }],
      NOW,
      2,
    );
    expect(levels).toEqual(['major', 'operational']);
  });
  it('keeps an unresolved incident on every day since it started', () => {
    const levels = dayLevels([{ impact: 'degraded', start: NOW - 2 * DAY, end: null }], NOW, 4);
    expect(levels).toEqual(['operational', 'degraded', 'degraded', 'degraded']);
  });
  it('shows the worst of several incidents on a day', () => {
    const levels = dayLevels(
      [
        { impact: 'degraded', start: NOW - HOUR, end: NOW },
        { impact: 'major', start: NOW - 2 * HOUR, end: NOW - HOUR },
      ],
      NOW,
      1,
    );
    expect(levels).toEqual(['major']);
  });
});

describe('buildBoard', () => {
  const components = [
    { id: 1, name: 'API', createdAt: '2025-01-01T00:00:00Z' },
    { id: 2, name: 'Webhooks', createdAt: '2025-01-01T00:00:00Z' },
  ];
  const incident = (over: Partial<IncidentView>): IncidentView => ({
    id: 1,
    title: 'Trouble',
    impact: 'major',
    status: 'investigating',
    startedAt: new Date(NOW - HOUR).toISOString(),
    resolvedAt: null,
    components: ['API'],
    updates: [],
    ...over,
  });

  it('is operational with no incidents', () => {
    const board = buildBoard(components, [], NOW);
    expect(board.overall).toBe('operational');
    expect(board.components.map(({ uptime }) => uptime)).toEqual([100, 100]);
  });
  it('affects only the named component', () => {
    const board = buildBoard(components, [incident({})], NOW);
    expect(board.overall).toBe('major');
    expect(board.components.map(({ level }) => level)).toEqual(['major', 'operational']);
  });
  it('stops affecting the current level once resolved, and keeps the history', () => {
    const board = buildBoard(
      components,
      [incident({ status: 'resolved', resolvedAt: new Date(NOW - 60_000).toISOString() })],
      NOW,
    );
    expect(board.overall).toBe('operational');
    expect(board.components[0]!.days.at(-1)).toBe('major');
    expect(board.recent).toHaveLength(1);
    expect(board.active).toHaveLength(0);
  });
  it('counts only major outages against uptime', () => {
    const board = buildBoard(components, [incident({ impact: 'partial' })], NOW);
    expect(board.components[0]!.uptime).toBe(100);
    expect(board.components[0]!.level).toBe('partial');
  });
  it('measures a new component from when it was added', () => {
    const fresh = [{ id: 3, name: 'API', createdAt: new Date(NOW - 10 * HOUR).toISOString() }];
    const board = buildBoard(fresh, [incident({})], NOW);
    expect(board.components[0]!.uptime).toBe(90);
  });
});

describe('parseUpdate', () => {
  const good = {
    incidentId: '4',
    version: '2',
    status: 'monitoring',
    body: '  Fix deployed.  ',
    submissionId: UUID,
  };

  it('accepts and trims a valid update', () => {
    expect(parseUpdate(good)).toEqual({
      ok: true,
      value: {
        incidentId: 4,
        expectedVersion: 2,
        status: 'monitoring',
        body: 'Fix deployed.',
        submissionId: UUID,
      },
    });
  });
  it.each([
    ['a blank body', { body: '   ' }],
    ['a body over the limit', { body: 'x'.repeat(2001) }],
    ['an unknown status', { status: 'fine' }],
    ['a non-numeric version', { version: '1; DROP TABLE' }],
    ['a malformed submission id', { submissionId: 'abc' }],
    ['a missing incident', { incidentId: undefined }],
  ])('refuses %s', (_, change) => {
    expect(parseUpdate({ ...good, ...change }).ok).toBe(false);
  });
});

describe('parseNewIncident', () => {
  const good = {
    title: 'API errors',
    impact: 'major',
    body: 'Looking into it.',
    submissionId: UUID,
  };

  it('accepts a valid incident and removes repeated components', () => {
    const parsed = parseNewIncident(good, ['1', '2', '1']);
    expect(parsed.ok && parsed.value.componentIds).toEqual([1, 2]);
  });
  it('refuses no components', () => {
    expect(parseNewIncident(good, []).ok).toBe(false);
  });
  it('refuses a component id that is not a number', () => {
    expect(parseNewIncident(good, ['1', 'x']).ok).toBe(false);
  });
  it.each([
    ['a short title', { title: 'ab' }],
    ['a long title', { title: 'x'.repeat(121) }],
    ['an unknown impact', { impact: 'catastrophic' }],
    ['no first update', { body: '' }],
  ])('refuses %s', (_, change) => {
    expect(parseNewIncident({ ...good, ...change }, ['1']).ok).toBe(false);
  });
});

test('escapeXml covers the five reserved characters', () => {
  expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
    '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
  );
});
