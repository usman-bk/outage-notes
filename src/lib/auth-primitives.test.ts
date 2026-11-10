import { DECOY_HASH, hashPassword, verifyPassword } from './password';
import { createToken, readToken } from './session-token';

const secret = 'a-test-secret-a-test-secret-a-test-secret';

beforeEach(() => {
  process.env.SESSION_SECRET = secret;
});

describe('session token', () => {
  it('round trips an operator id', () => {
    expect(readToken(createToken(7))).toBe(7);
  });
  it('refuses a missing token', () => {
    expect(readToken(undefined)).toBeNull();
  });
  it('refuses an edited payload', () => {
    const signature = createToken(7).split('.')[1];
    const forged = Buffer.from(JSON.stringify({ sub: 1, exp: Date.now() + 1e9 })).toString(
      'base64url',
    );
    expect(readToken(`${forged}.${signature}`)).toBeNull();
  });
  it('refuses a token with no signature', () => {
    expect(readToken(createToken(7).split('.')[0])).toBeNull();
  });
  it('refuses a token with extra parts', () => {
    expect(readToken(`${createToken(7)}.extra`)).toBeNull();
  });
  it('refuses an expired token', () => {
    const issued = Date.now() - 11 * 3_600_000;
    expect(readToken(createToken(7, issued))).toBeNull();
  });
  it('accepts a token just before it expires', () => {
    const issued = Date.now() - 9 * 3_600_000;
    expect(readToken(createToken(7, issued))).toBe(7);
  });
  it('refuses a token signed with another secret', () => {
    const token = createToken(7);
    process.env.SESSION_SECRET = 'another-secret-another-secret-another';
    expect(readToken(token)).toBeNull();
  });
  it('refuses to run with a short secret', () => {
    process.env.SESSION_SECRET = 'short';
    expect(() => createToken(7)).toThrow('SESSION_SECRET');
  });
});

describe('password', () => {
  it('verifies the right password', async () => {
    await expect(
      verifyPassword('correct horse', await hashPassword('correct horse')),
    ).resolves.toBe(true);
  });
  it('refuses the wrong password', async () => {
    await expect(verifyPassword('wrong', await hashPassword('correct horse'))).resolves.toBe(false);
  });
  it('salts, so two hashes of one password differ', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
  it('refuses everything against the decoy', async () => {
    await expect(verifyPassword('', DECOY_HASH)).resolves.toBe(false);
  });
  it.each(['', 'nocolon', 'ab:cd'])('refuses a malformed hash %j', async (stored) => {
    await expect(verifyPassword('x', stored)).resolves.toBe(false);
  });
});
