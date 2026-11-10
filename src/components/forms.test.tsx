/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FormResult } from '@/lib/domain';
import { UpdateForm } from './forms';

const SUBMISSION = '6f1c1a52-4f1b-4c55-9a56-2a0a6bb6b0f1';

function setup(answer: FormResult) {
  const action = jest.fn<Promise<FormResult>, [FormResult, FormData]>(async () => answer);
  const view = render(
    <UpdateForm
      incidentId={3}
      version={7}
      status="identified"
      submissionId={SUBMISSION}
      action={action}
    />,
  );
  const version = () =>
    view.container.querySelector<HTMLInputElement>('input[name=version]')!.value;
  return { action, version };
}

const conflict: FormResult = {
  kind: 'conflict',
  version: 9,
  latest: {
    id: '1',
    status: 'monitoring',
    body: 'Fix is rolling out.',
    author: 'Tomas',
    createdAt: '2026-06-15T12:00:00.000Z',
  },
};

async function post(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByLabelText('Update for the public page'), text);
  await user.click(screen.getByRole('button', { name: 'Post update' }));
}

it('sends the fields the server expects', async () => {
  const user = userEvent.setup();
  const { action } = setup({ kind: 'idle' });
  await user.selectOptions(screen.getByLabelText('Status'), 'monitoring');
  await post(user, 'Rolling out.');
  await waitFor(() => expect(action).toHaveBeenCalled());
  expect(Object.fromEntries(action.mock.calls[0]![1])).toEqual({
    incidentId: '3',
    version: '7',
    submissionId: SUBMISSION,
    status: 'monitoring',
    body: 'Rolling out.',
  });
});

it('keeps the draft and the chosen status after a conflict', async () => {
  const user = userEvent.setup();
  setup(conflict);
  await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
  await post(user, 'All clear.');
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Update for the public page')).toHaveValue('All clear.');
  expect(screen.getByLabelText('Status')).toHaveValue('resolved');
});

it('shows what the other operator wrote', async () => {
  const user = userEvent.setup();
  setup(conflict);
  await post(user, 'All clear.');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Fix is rolling out.');
  expect(alert).toHaveTextContent('Tomas');
});

it('moves to the version it was shown, so pressing again can succeed', async () => {
  const user = userEvent.setup();
  const { version } = setup(conflict);
  expect(version()).toBe('7');
  await post(user, 'All clear.');
  await screen.findByRole('alert');
  expect(version()).toBe('9');
});

it('keeps the draft when the database is unreachable', async () => {
  const user = userEvent.setup();
  setup({ kind: 'error', message: 'nothing was posted' });
  await post(user, 'Still looking.');
  await screen.findByText('nothing was posted');
  expect(screen.getByLabelText('Update for the public page')).toHaveValue('Still looking.');
});
