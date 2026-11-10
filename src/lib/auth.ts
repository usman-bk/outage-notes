import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from './db';
import { createToken, readToken, SESSION_HOURS } from './session-token';
import { findActiveOperator, type OperatorName } from './store';

export const SESSION_COOKIE = 'session';

/**
 * The token says who you are. Whether you are still allowed comes from the database, so a removed
 * operator is locked out on their next action rather than when the token runs out.
 */
export async function currentOperator(): Promise<OperatorName | null> {
  const store = await cookies();
  const id = readToken(store.get(SESSION_COOKIE)?.value);
  return id === null ? null : findActiveOperator(getPool(), id);
}

export async function requireOperatorPage(): Promise<OperatorName> {
  const operator = await currentOperator();
  if (!operator) redirect('/login');
  return operator;
}

export async function startSession(operatorId: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createToken(operatorId), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
