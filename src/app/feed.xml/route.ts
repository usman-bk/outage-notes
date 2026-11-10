import { getBoard } from '@/lib/board';
import { escapeXml, STATUS_LABEL } from '@/lib/domain';

export async function GET() {
  const board = await getBoard();
  if (board.state === 'unknown') return new Response('Status unavailable', { status: 503 });
  const site = (process.env.PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const incidents = [...board.data.active, ...board.data.recent];
  const entries = incidents
    .map((incident) => {
      const latest = incident.updates[0];
      const updated = latest?.createdAt ?? incident.startedAt;
      const summary = latest ? `${STATUS_LABEL[latest.status]}: ${latest.body}` : incident.title;
      return `<entry>
<id>${site}/history#incident-${incident.id}</id>
<title>${escapeXml(incident.title)}</title>
<updated>${updated}</updated>
<link href="${site}/history#incident-${incident.id}"/>
<summary>${escapeXml(summary)}</summary>
</entry>`;
    })
    .join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${site}/</id>
<title>Service status</title>
<updated>${board.data.confirmedAt}</updated>
<link rel="self" href="${site}/feed.xml"/>
${entries}
</feed>
`;
  return new Response(xml, { headers: { 'content-type': 'application/atom+xml; charset=utf-8' } });
}
