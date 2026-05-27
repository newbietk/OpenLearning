import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('security', () => {
  const oldKey = process.env.ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
  });

  afterAll(() => {
    if (oldKey) process.env.ENCRYPTION_KEY = oldKey;
    else delete process.env.ENCRYPTION_KEY;
  });

  it('should encrypt and decrypt a string', async () => {
    const { encrypt, decrypt } = await import('../security');
    const plain = 'sk-test-api-key-1234567890';
    const encrypted = encrypt(plain);
    expect(encrypted).not.toBe(plain);
    expect(encrypted).toContain(':');
    expect(decrypt(encrypted)).toBe(plain);
  });

  it('should produce different ciphertext for same plaintext', async () => {
    const { encrypt, decrypt } = await import('../security');
    const plain = 'same-key';
    const a = encrypt(plain);
    const b = encrypt(plain);
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plain);
    expect(decrypt(b)).toBe(plain);
  });

  it('should throw when ENCRYPTION_KEY is wrong length', async () => {
    const old = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'short';
    const { encrypt } = await import('../security');
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be');
    process.env.ENCRYPTION_KEY = old;
  });
});
