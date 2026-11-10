import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_HOURS = 10;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return value;
}

const sign = (payload: string) =>
  createHmac('sha256', secret()).update(payload).digest('base64url');

export function createToken(operatorId: number, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: operatorId, exp: now + SESSION_HOURS * 3_600_000 }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      sub?: unknown;
      exp?: unknown;
    };
    if (typeof claims.sub !== 'number' || typeof claims.exp !== 'number') return null;
    return claims.exp > now ? claims.sub : null;
  } catch {
    return null;
  }
}
