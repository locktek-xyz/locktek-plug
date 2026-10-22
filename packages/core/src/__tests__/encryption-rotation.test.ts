import { describe, it, expect } from 'vitest';
import { AesGcmEncryptionProvider } from '../encryption/aes-gcm.js';
import { ErrorCode } from '../types/common.js';

const KEY_V1 = 'first-encryption-key-value';
const KEY_V2 = 'second-encryption-key-value';

describe('AesGcmEncryptionProvider — format', () => {
  it('uses a 96-bit IV, the GCM standard', async () => {
    const provider = new AesGcmEncryptionProvider(KEY_V1);
    const raw = Buffer.from(await provider.encrypt('hello'), 'base64');

    // [1b format][1b keyVersion][12b IV][16b tag][ciphertext]
    expect(raw.length).toBe(2 + 12 + 16 + 'hello'.length);
  });

  it('stamps the key version into every ciphertext', async () => {
    const provider = new AesGcmEncryptionProvider(KEY_V1, { version: 7 });
    const raw = Buffer.from(await provider.encrypt('hello'), 'base64');

    expect(raw[1]).toBe(7);
    expect(provider.keyVersion).toBe(7);
  });

  it('produces a distinct IV per operation', async () => {
    const provider = new AesGcmEncryptionProvider(KEY_V1);
    const [a, b] = await Promise.all([provider.encrypt('same'), provider.encrypt('same')]);
    expect(a).not.toBe(b);
  });
});

describe('AesGcmEncryptionProvider — rotation', () => {
  it('decrypts data written by a previous key', async () => {
    const oldProvider = new AesGcmEncryptionProvider(KEY_V1, { version: 1 });
    const ciphertext = await oldProvider.encrypt('wallet-secret');

    const rotated = new AesGcmEncryptionProvider(KEY_V2, {
      version: 2,
      previousKeys: [{ key: KEY_V1, version: 1 }],
    });

    await expect(rotated.decrypt(ciphertext)).resolves.toBe('wallet-secret');
  });

  it('writes new data under the new primary key', async () => {
    const rotated = new AesGcmEncryptionProvider(KEY_V2, {
      version: 2,
      previousKeys: [{ key: KEY_V1, version: 1 }],
    });

    const raw = Buffer.from(await rotated.encrypt('new'), 'base64');
    expect(raw[1]).toBe(2);
  });

  it('reports which ciphertexts still need rotating', async () => {
    const oldProvider = new AesGcmEncryptionProvider(KEY_V1, { version: 1 });
    const old = await oldProvider.encrypt('secret');

    const rotated = new AesGcmEncryptionProvider(KEY_V2, {
      version: 2,
      previousKeys: [{ key: KEY_V1, version: 1 }],
    });

    expect(rotated.needsRotation(old)).toBe(true);
    expect(rotated.needsRotation(await rotated.encrypt('secret'))).toBe(false);
  });

  it('re-encrypts under the primary key, preserving the plaintext', async () => {
    const oldProvider = new AesGcmEncryptionProvider(KEY_V1, { version: 1 });
    const old = await oldProvider.encrypt('wallet-secret');

    const rotated = new AesGcmEncryptionProvider(KEY_V2, {
      version: 2,
      previousKeys: [{ key: KEY_V1, version: 1 }],
    });

    const fresh = await rotated.rotate(old);
    expect(rotated.needsRotation(fresh)).toBe(false);
    await expect(rotated.decrypt(fresh)).resolves.toBe('wallet-secret');
  });

  it('is idempotent, so an interrupted rotation can simply be re-run', async () => {
    const provider = new AesGcmEncryptionProvider(KEY_V2, { version: 2 });
    const ciphertext = await provider.encrypt('secret');

    const once = await provider.rotate(ciphertext);
    const twice = await provider.rotate(once);

    expect(twice).toBe(once);
  });

  it('names the missing key version rather than reporting generic corruption', async () => {
    const oldProvider = new AesGcmEncryptionProvider(KEY_V1, { version: 1 });
    const ciphertext = await oldProvider.encrypt('secret');

    const withoutOldKey = new AesGcmEncryptionProvider(KEY_V2, { version: 2 });

    await expect(withoutOldKey.decrypt(ciphertext)).rejects.toMatchObject({
      code: ErrorCode.ENCRYPTION_KEY_REQUIRED,
      message: expect.stringContaining('key version 1'),
    });
  });

  it('refuses duplicate key versions in the keyring', () => {
    expect(
      () =>
        new AesGcmEncryptionProvider(KEY_V2, {
          version: 1,
          previousKeys: [{ key: KEY_V1, version: 1 }],
        }),
    ).toThrow(/Duplicate encryption key version/);
  });
});

describe('AesGcmEncryptionProvider — tenant isolation', () => {
  it('produces incompatible ciphertexts for different salts', async () => {
    const tenantA = new AesGcmEncryptionProvider(KEY_V1, { salt: 'tenant-a' });
    const tenantB = new AesGcmEncryptionProvider(KEY_V1, { salt: 'tenant-b' });

    const ciphertext = await tenantA.encrypt('a-secret');
    await expect(tenantB.decrypt(ciphertext)).rejects.toMatchObject({
      code: ErrorCode.ENCRYPTION_ERROR,
    });
  });
});
