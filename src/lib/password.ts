import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== 64) return false;
  return timingSafeEqual(await scrypt(password, Buffer.from(salt, 'hex'), 64), expected);
}

/** Checked when the email is unknown, so a missing account takes as long as a wrong password. */
export const DECOY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;
