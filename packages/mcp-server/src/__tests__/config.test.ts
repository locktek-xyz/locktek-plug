import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isPolicyUnbounded, loadConfigFromEnv } from '../config.js';

describe('loadConfigFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Clear all LOCKTEK_ env vars to start clean
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('LOCKTEK_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to ethereum-sepolia when no env vars are set', () => {
    const config = loadConfigFromEnv();

    expect(config.locktekOptions.chains).toEqual(['ethereum-sepolia']);
    expect(config.locktekOptions.defaultChain).toBe('ethereum-sepolia');
  });

  it('parses LOCKTEK_CHAINS into an array of chains', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia,base-sepolia';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.chains).toEqual(['ethereum-sepolia', 'base-sepolia']);
  });

  it('trims whitespace from chain names', () => {
    process.env['LOCKTEK_CHAINS'] = ' ethereum-sepolia , base-sepolia ';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.chains).toEqual(['ethereum-sepolia', 'base-sepolia']);
  });

  it('respects LOCKTEK_DEFAULT_CHAIN', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia,base-sepolia';
    process.env['LOCKTEK_DEFAULT_CHAIN'] = 'base-sepolia';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.defaultChain).toBe('base-sepolia');
  });

  it('defaults defaultChain to first chain when LOCKTEK_DEFAULT_CHAIN is not set', () => {
    process.env['LOCKTEK_CHAINS'] = 'base-sepolia,ethereum-sepolia';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.defaultChain).toBe('base-sepolia');
  });

  it('respects LOCKTEK_ENCRYPTION_KEY', () => {
    process.env['LOCKTEK_ENCRYPTION_KEY'] = 'my-super-secret-key-32chars!!';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.encryptionKey).toBe('my-super-secret-key-32chars!!');
  });

  it('parses LOCKTEK_RPC_<CHAIN> into rpc map', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_RPC_ETHEREUM_SEPOLIA'] = 'https://custom.rpc/v1';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.rpc).toEqual({
      'ethereum-sepolia': 'https://custom.rpc/v1',
    });
  });

  it('sets rpc to undefined when no RPC env vars are provided', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.rpc).toBeUndefined();
  });

  it('rejects invalid chain names with helpful error', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia,solana,avalanche';

    expect(() => loadConfigFromEnv()).toThrow(
      'Invalid chain(s) in LOCKTEK_CHAINS: solana, avalanche',
    );
  });

  it('rejects a single invalid chain name', () => {
    process.env['LOCKTEK_CHAINS'] = 'not-a-real-chain';

    expect(() => loadConfigFromEnv()).toThrow('Invalid chain(s) in LOCKTEK_CHAINS');
    expect(() => loadConfigFromEnv()).toThrow('not-a-real-chain');
  });

  it('filters out empty strings from chain list', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia,,base-sepolia,';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.chains).toEqual(['ethereum-sepolia', 'base-sepolia']);
  });

  it('rejects an invalid LOCKTEK_DEFAULT_CHAIN at startup rather than on first use', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_DEFAULT_CHAIN'] = 'not-a-real-chain';

    // A stdio MCP server that fails later is invisible inside the host, so
    // configuration problems have to surface at launch.
    expect(() => loadConfigFromEnv()).toThrow(/Invalid LOCKTEK_DEFAULT_CHAIN/);
  });

  it('rejects a default chain that is not among the configured chains', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_DEFAULT_CHAIN'] = 'base-sepolia';

    expect(() => loadConfigFromEnv()).toThrow(/not in LOCKTEK_CHAINS/);
  });

  it('rejects a too-short encryption key at startup', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_ENCRYPTION_KEY'] = 'short';

    expect(() => loadConfigFromEnv()).toThrow(/at least 16 characters/);
  });

  it('reads spend limits and recipient rules from the environment', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_MAX_AMOUNT_PER_TX'] = '0.5';
    process.env['LOCKTEK_MAX_AMOUNT_PER_SESSION'] = '2';
    process.env['LOCKTEK_ALLOWED_RECIPIENTS'] = '0xaaa, 0xbbb';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.policy).toMatchObject({
      maxAmountPerTransaction: '0.5',
      maxAmountPerSession: '2',
      allowedRecipients: ['0xaaa', '0xbbb'],
    });
  });

  it('defaults to testnet-only and no confirmation requirement', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.testnet).toBe(true);
    expect(config.requireConfirmation).toBe(false);
  });

  it('enables the confirmation flow when asked', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_REQUIRE_CONFIRMATION'] = 'true';

    expect(loadConfigFromEnv().requireConfirmation).toBe(true);
  });

  it('rejects a non-numeric timeout', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_RPC_TIMEOUT_MS'] = 'soon';

    expect(() => loadConfigFromEnv()).toThrow(/must be a positive number/);
  });

  it.each(['LOCKTEK_TESTNET', 'LOCKTEK_READ_ONLY', 'LOCKTEK_REQUIRE_CONFIRMATION'])(
    'refuses to start on an unrecognised %s value instead of treating it as false',
    (name) => {
      process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
      process.env[name] = 'required';

      expect(() => loadConfigFromEnv()).toThrow(new RegExp(name));
    },
  );

  it('accepts the usual spellings of true and false', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    process.env['LOCKTEK_READ_ONLY'] = 'YES';
    process.env['LOCKTEK_REQUIRE_CONFIRMATION'] = 'off';

    const config = loadConfigFromEnv();

    expect(config.locktekOptions.policy?.readOnly).toBe(true);
    expect(config.requireConfirmation).toBe(false);
  });

  it('reads the signing key from the environment, and is read-only without one', () => {
    process.env['LOCKTEK_CHAINS'] = 'ethereum-sepolia';
    expect(loadConfigFromEnv().signingKey).toBeUndefined();

    process.env['LOCKTEK_PRIVATE_KEY'] = `0x${'1'.repeat(64)}`;
    expect(loadConfigFromEnv().signingKey).toBe(`0x${'1'.repeat(64)}`);
  });
});

describe('isPolicyUnbounded', () => {
  it('is true with no limits and false once any limit applies', () => {
    expect(isPolicyUnbounded(undefined)).toBe(true);
    expect(isPolicyUnbounded({ readOnly: false })).toBe(true);
    expect(isPolicyUnbounded({ maxAmountPerTransaction: '1' })).toBe(false);
    expect(isPolicyUnbounded({ allowedRecipients: ['0x1'] })).toBe(false);
    expect(isPolicyUnbounded({ readOnly: true })).toBe(false);
  });
});
