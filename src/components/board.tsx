import {
  LEVEL_LABEL,
  STATUS_LABEL,
  type IncidentView,
  type Level,
  type ComponentView,
} from '@/lib/domain';
import { LocalTime } from './local-time';

const TEXT: Record<Level, string> = {
  operational: 'text-operational',
  degraded: 'text-degraded',
  partial: 'text-partial',
  major: 'text-major',
};

const FILL: Record<Level, string> = {
  operational: 'bg-operational',
  degraded: 'bg-degraded',
  partial: 'bg-partial',
  major: 'bg-major',
};

export function ComponentCard({ component }: { component: ComponentView }) {
  const incidentDays = component.days.filter((level) => level !== 'operational').length;
  return (
    <li className="border-b border-line p-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h3 className="font-semibold">{component.name}</h3>
        <p className={`text-sm font-medium ${TEXT[component.level]}`}>
          {LEVEL_LABEL[component.level]}
        </p>
      </div>
      <div aria-hidden="true" className="mt-3 flex h-7 gap-px">
        {component.days.map((level, index) => (
          // Ninety bars do not fit a phone, so narrow screens keep the most recent thirty.
          <span
            key={index}
            className={`min-w-0 flex-1 rounded-[1px] ${FILL[level]} ${index < 60 ? 'hidden sm:block' : ''}`}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-muted">
        {component.uptime.toFixed(2)}% uptime over 90 days
        {incidentDays > 0
          ? `, ${incidentDays} ${incidentDays === 1 ? 'day' : 'days'} with incidents`
          : ', no incidents'}
      </p>
    </li>
  );
}

export function IncidentCard({ incident }: { incident: IncidentView }) {
  return (
    <article
      id={`incident-${incident.id}`}
      className="rounded-lg border border-line bg-surface p-4"
    >
      <h3 className="font-semibold">{incident.title}</h3>
      <p className="mt-1 text-sm text-muted">
        <span className={`font-medium ${TEXT[incident.impact]}`}>
          {LEVEL_LABEL[incident.impact]}
        </span>
        {' · '}
        {incident.components.join(', ')}
      </p>
      <ol className="mt-3 space-y-3">
        {incident.updates.map((update) => (
          <li key={update.id} className="border-l-2 border-line pl-3">
            <p className="text-sm">
              <span className="font-semibold">{STATUS_LABEL[update.status]}</span>
              <span className="text-muted">
                {' · '}
                <LocalTime iso={update.createdAt} />
              </span>
            </p>
            <p className="mt-1 break-words whitespace-pre-wrap">{update.body}</p>
          </li>
        ))}
      </ol>
    </article>
  );
}
