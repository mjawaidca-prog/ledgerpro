// MFA-1: the login flow — MFA_REQUIRED after a correct password, TOTP
// verification, backup-code consumption, and no MFA-status leakage on wrong
// passwords. The authorize function is exercised through authOptions.

import { NextRequest } from 'next/server';

process.env.MFA_SECRET = Buffer.alloc(32, 7).toString('base64');

const mockUserFindUnique = jest.fn();
const mockUserUpdate = jest.fn();
jest.mock('@/lib/db', () => ({
  db: {
    user: {
      findUnique: (...a: unknown[]) => mockUserFindUnique(...a),
      update: (...a: unknown[]) => mockUserUpdate(...a),
    },
  },
}));
// The NextAuth adapter is not exercised by the authorize flow. The package
// is pure ESM, so it must be mocked virtually under CJS jest.
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }), { virtual: true });

import { authOptions } from '@/lib/auth';
import { createHash } from 'node:crypto';
import { hashSync } from 'bcryptjs';

// A real bcrypt hash for "password123", computed once per run.
const PASSWORD_HASH = hashSync('password123', 10);

const baseUser = (overrides: any = {}) => ({
  id: 'u-1',
  email: 'rosa@example.com',
  passwordHash: PASSWORD_HASH,
  memberships: [{ company: { id: 'co-1', name: 'Co' }, role: 'owner' }],
  mfaEnabled: false,
  mfaSecretEncrypted: null,
  mfaBackupCodes: [],
  ...overrides,
});

async function authorize(credentials: Record<string, string>) {
  const provider = authOptions.providers[0] as any;
  return provider.options.authorize(credentials, {} as any);
}

describe('MFA-1 login flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('wrong passwords never reveal MFA status', async () => {
    mockUserFindUnique.mockResolvedValue(baseUser({ mfaEnabled: true }));
    await expect(
      authorize({ email: 'rosa@example.com', password: 'wrong' })
    ).rejects.toThrow('Invalid email or password');
  });

  test('an MFA-enabled user with a correct password gets MFA_REQUIRED, not a session', async () => {
    const { encryptTotpSecret } = jest.requireActual('@/lib/mfa/secret-crypto');
    mockUserFindUnique.mockResolvedValue(baseUser({ mfaEnabled: true, mfaSecretEncrypted: encryptTotpSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567') }));
    await expect(
      authorize({ email: 'rosa@example.com', password: 'password123' })
    ).rejects.toThrow('MFA_REQUIRED');
  });

  test('a valid TOTP code completes the login', async () => {
    const { encryptTotpSecret } = jest.requireActual('@/lib/mfa/secret-crypto');
    const secret = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    mockUserFindUnique.mockResolvedValue(baseUser({ mfaEnabled: true, mfaSecretEncrypted: encryptTotpSecret(secret) }));

    const now = Math.floor(Date.now() / 1000);
    const { totpAt } = jest.requireActual('@/lib/mfa/totp');
    const code = totpAt(secret, now);

    const user = await authorize({ email: 'rosa@example.com', password: 'password123', code });
    expect(user.id).toBe('u-1');
    expect(user.email).toBe('rosa@example.com');
    expect(user.availableCompanies).toHaveLength(1);
  });

  test('an invalid code is rejected with a distinct message', async () => {
    const { encryptTotpSecret } = jest.requireActual('@/lib/mfa/secret-crypto');
    mockUserFindUnique.mockResolvedValue(baseUser({ mfaEnabled: true, mfaSecretEncrypted: encryptTotpSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567') }));
    await expect(
      authorize({ email: 'rosa@example.com', password: 'password123', code: '000000' })
    ).rejects.toThrow('Invalid authentication code');
  });

  test('a backup code works once and is consumed', async () => {
    const { encryptTotpSecret } = jest.requireActual('@/lib/mfa/secret-crypto');
    const code1 = 'abcd1234-efgh5678';
    const code2 = 'ijkl9012-mnop3456';
    const hashes = [code1, code2].map((c) => createHash('sha256').update(c).digest('hex'));
    mockUserFindUnique.mockResolvedValue(
      baseUser({ mfaEnabled: true, mfaSecretEncrypted: encryptTotpSecret('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'), mfaBackupCodes: hashes })
    );
    mockUserUpdate.mockResolvedValue({});

    const user = await authorize({ email: 'rosa@example.com', password: 'password123', code: code1 });
    expect(user.id).toBe('u-1');
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mfaBackupCodes: expect.arrayContaining([hashes[1]]) }) })
    );
    const remaining = mockUserUpdate.mock.calls[0][0].data.mfaBackupCodes;
    expect(remaining).toHaveLength(1);

    // Simulate persistence: the next fetch returns the consumed state.
    mockUserFindUnique.mockResolvedValue(baseUser({ mfaEnabled: true, mfaSecretEncrypted: mockUserFindUnique.mock.results[0].value.mfaSecretEncrypted, mfaBackupCodes: remaining }));

    // Replay of the consumed code fails.
    await expect(
      authorize({ email: 'rosa@example.com', password: 'password123', code: code1 })
    ).rejects.toThrow('Invalid authentication code');
  });

  test('non-MFA users log in without any code', async () => {
    mockUserFindUnique.mockResolvedValue(baseUser());
    const user = await authorize({ email: 'rosa@example.com', password: 'password123' });
    expect(user.id).toBe('u-1');
  });
});
