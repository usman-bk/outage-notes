'use server';

import { updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { endSession, currentOperator, startSession } from '@/lib/auth';
import { BOARD_TAG } from '@/lib/board';
import { getPool } from '@/lib/db';
import { parseNewIncident, parseUpdate, type FormResult } from '@/lib/domain';
import { DECOY_HASH, verifyPassword } from '@/lib/password';
import {
  clearLoginFailures,
  createIncident,
  findOperatorByEmail,
  loginLocked,
  postUpdate,
  recordLoginFailure,
  type OperatorName,
} from '@/lib/store';

const UNAVAILABLE: FormResult = {
  kind: 'error',
  message:
    "We can't reach the database, so nothing was posted. Your text is still here. Try again.",
};

// A Server Action is a public POST endpoint, and proxy.ts does not guard it. The check lives here.
async function operatorOrLogin(): Promise<OperatorName> {
  const operator = await currentOperator();
  if (!operator) redirect('/login');
  return operator;
}

export async function postUpdateAction(_: FormResult, form: FormData): Promise<FormResult> {
  let target: string;
  try {
    const operator = await operatorOrLogin();
    const parsed = parseUpdate(Object.fromEntries(form));
    if (!parsed.ok) return { kind: 'error', message: parsed.message };

    const result = await postUpdate(getPool(), parsed.value, operator);
    if (result.kind === 'not_found') {
      return { kind: 'error', message: 'This incident no longer exists.' };
    }
    if (result.kind === 'conflict') {
      return { kind: 'conflict', version: result.version, latest: result.latest };
    }
    // Only after the commit. Invalidating earlier lets a reader cache the old row again.
    updateTag(BOARD_TAG);
    target = `/admin/incidents/${parsed.value.incidentId}?posted=1`;
  } catch (error) {
    rethrowNavigation(error);
    return UNAVAILABLE;
  }
  redirect(target);
}

export async function createIncidentAction(_: FormResult, form: FormData): Promise<FormResult> {
  let target: string;
  try {
    const operator = await operatorOrLogin();
    const parsed = parseNewIncident(Object.fromEntries(form), form.getAll('componentIds'));
    if (!parsed.ok) return { kind: 'error', message: parsed.message };
    const { id } = await createIncident(getPool(), parsed.value, operator);
    updateTag(BOARD_TAG);
    target = `/admin/incidents/${id}?posted=1`;
  } catch (error) {
    rethrowNavigation(error);
    return UNAVAILABLE;
  }
  redirect(target);
}

export async function loginAction(_: FormResult, form: FormData): Promise<FormResult> {
  const email = String(form.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(form.get('password') ?? '');
  const refused: FormResult = { kind: 'error', message: 'That email and password do not match.' };
  try {
    const pool = getPool();
    if (await loginLocked(pool, email)) {
      return { kind: 'error', message: 'Too many attempts. Wait 15 minutes and try again.' };
    }
    const operator = await findOperatorByEmail(pool, email);
    const matches = await verifyPassword(password, operator?.password_hash ?? DECOY_HASH);
    if (!operator || !operator.active || !matches) {
      await recordLoginFailure(pool, email);
      return refused;
    }
    await clearLoginFailures(pool, email);
    await startSession(operator.id);
  } catch {
    return { kind: 'error', message: "We can't reach the database. Try again in a minute." };
  }
  redirect('/admin');
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}

function rethrowNavigation(error: unknown): void {
  if (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string' &&
    error.digest.startsWith('NEXT_REDIRECT')
  ) {
    throw error;
  }
}
