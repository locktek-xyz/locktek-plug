import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptHidden, resolvePrivateKey } from '../utils/secret-input.js';

const KEY = `0x${'a'.repeat(64)}`;

describe('resolvePrivateKey', () => {
  let stderr = '';
  let writeErr: ReturnType<typeof vi.spyOn>;
  const originalTTY = process.stdin.isTTY;

  beforeEach(() => {
    stderr = '';
    delete process.env.LOCKTEK_PRIVATE_KEY;
    writeErr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((c: string | Uint8Array) => ((stderr += String(c)), true));
  });

  afterEach(() => {
    writeErr.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: originalTTY, configurable: true });
    delete process.env.LOCKTEK_PRIVATE_KEY;
  });

  it('uses an explicit flag but warns about shell history exposure', async () => {
    await expect(resolvePrivateKey(KEY)).resolves.toBe(KEY);
    expect(stderr).toContain('shell history');
  });

  it('prefers the environment variable when no flag is given', async () => {
    process.env.LOCKTEK_PRIVATE_KEY = KEY;

    await expect(resolvePrivateKey()).resolves.toBe(KEY);
    // No warning: the env var is the recommended path.
    expect(stderr).toBe('');
  });

  it('does not warn when the key comes from the environment even if a flag is absent', async () => {
    process.env.LOCKTEK_PRIVATE_KEY = KEY;
    await resolvePrivateKey(undefined);
    expect(stderr).not.toContain('shell history');
  });

  it('fails with actionable guidance in a non-interactive shell', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });

    // Must fail rather than hang waiting for input that will never arrive in CI.
    await expect(resolvePrivateKey()).rejects.toThrow(/LOCKTEK_PRIVATE_KEY/);
  });

  it('never echoes the key it was handed into the warning text', async () => {
    await resolvePrivateKey(KEY);
    expect(stderr).not.toContain('a'.repeat(64));
  });
});

describe('promptHidden', () => {
  it('never echoes a pasted key, which arrives as a single chunk', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = '';
    output.on('data', (chunk: Buffer) => (shown += chunk.toString()));

    const answer = promptHidden('Private key: ', input, output);
    input.write(`${KEY}\n`);

    await expect(answer).resolves.toBe(KEY);
    expect(shown).toContain('Private key:');
    expect(shown).not.toContain('a'.repeat(16));
  });
});
