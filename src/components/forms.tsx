'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { LocalTime } from './local-time';
import {
  IMPACTS,
  LEVEL_LABEL,
  STATUSES,
  STATUS_LABEL,
  type FormResult,
  type Status,
} from '@/lib/domain';

type Action = (previous: FormResult, form: FormData) => Promise<FormResult>;

const IDLE: FormResult = { kind: 'idle' };

/**
 * React resets a form after its action runs, and a controlled select comes back showing its first
 * option while state still holds the choice. After a refused post, pressing again would then send
 * the wrong status. Submitting from onSubmit skips that reset. The action prop stays, so a press
 * before hydration is still a POST rather than a GET with the fields in the URL.
 */
function submitWithoutReset(submit: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => submit(data));
  };
}

function Message({ result }: { result: FormResult }) {
  // The slot is always there, so a refusal does not move the button that was just pressed.
  return (
    <div className="min-h-6 text-sm" aria-live="polite">
      {result.kind === 'error' ? <p className="text-major">{result.message}</p> : null}
    </div>
  );
}

export function UpdateForm({
  incidentId,
  version,
  status,
  submissionId,
  action,
}: {
  incidentId: number;
  version: number;
  status: Status;
  submissionId: string;
  action: Action;
}) {
  const [result, submit, pending] = useActionState(action, IDLE);
  const [body, setBody] = useState('');
  const [nextStatus, setNextStatus] = useState<Status>(status);
  const currentVersion = result.kind === 'conflict' ? result.version : version;

  return (
    <form action={submit} onSubmit={submitWithoutReset(submit)} className="space-y-3">
      <input type="hidden" name="incidentId" value={incidentId} />
      <input type="hidden" name="version" value={currentVersion} />
      <input type="hidden" name="submissionId" value={submissionId} />
      <div>
        <label htmlFor="status" className="mb-1 block text-sm font-medium">
          Status
        </label>
        <select
          id="status"
          name="status"
          className="field"
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value as Status)}
        >
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="body" className="mb-1 block text-sm font-medium">
          Update for the public page
        </label>
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={2000}
          className="field"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        Post update
      </button>
      <Message result={result} />
      {result.kind === 'conflict' ? (
        <div role="alert" className="rounded-lg border border-degraded p-3">
          <p className="font-semibold">Someone posted while you were writing</p>
          {result.latest ? (
            <div className="mt-2 border-l-2 border-line pl-3">
              <p className="text-sm text-muted">
                {result.latest.author}, {STATUS_LABEL[result.latest.status]},{' '}
                <LocalTime iso={result.latest.createdAt} />
              </p>
              <p className="mt-1 break-words whitespace-pre-wrap">{result.latest.body}</p>
            </div>
          ) : null}
          <p className="mt-2 text-sm">
            Nothing of yours was posted and your text is still above. Read theirs, change yours if
            you need to, then press Post update again.
          </p>
        </div>
      ) : null}
    </form>
  );
}

export function NewIncidentForm({
  components,
  submissionId,
  action,
}: {
  components: { id: number; name: string }[];
  submissionId: string;
  action: Action;
}) {
  const [result, submit, pending] = useActionState(action, IDLE);
  const [title, setTitle] = useState('');
  const [impact, setImpact] = useState<string>('degraded');
  const [body, setBody] = useState('');
  const [chosen, setChosen] = useState<number[]>([]);

  return (
    <form action={submit} onSubmit={submitWithoutReset(submit)} className="space-y-3">
      <input type="hidden" name="submissionId" value={submissionId} />
      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">
          Title
        </label>
        <input
          id="title"
          name="title"
          className="field"
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="impact" className="mb-1 block text-sm font-medium">
          Impact
        </label>
        <select
          id="impact"
          name="impact"
          className="field"
          value={impact}
          onChange={(event) => setImpact(event.target.value)}
        >
          {IMPACTS.map((value) => (
            <option key={value} value={value}>
              {LEVEL_LABEL[value]}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium">Affected components</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {components.map(({ id, name }) => (
            <label key={id} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                name="componentIds"
                value={id}
                className="size-5"
                checked={chosen.includes(id)}
                onChange={(event) =>
                  setChosen((list) =>
                    event.target.checked ? [...list, id] : list.filter((item) => item !== id),
                  )
                }
              />
              {name}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="body" className="mb-1 block text-sm font-medium">
          First update for the public page
        </label>
        <textarea
          id="body"
          name="body"
          rows={3}
          maxLength={2000}
          className="field"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        Open incident
      </button>
      <Message result={result} />
    </form>
  );
}

export function LoginForm({ action }: { action: Action }) {
  const [result, submit, pending] = useActionState(action, IDLE);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form action={submit} onSubmit={submitWithoutReset(submit)} className="space-y-3">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="field"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        Sign in
      </button>
      <Message result={result} />
    </form>
  );
}
