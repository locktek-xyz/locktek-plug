import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from '../cli.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function captureStdout(): { output: string; restore: () => void } {
  let captured = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  return {
    get output() {
      return captured;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

function captureStderr(): { output: string; restore: () => void } {
  let captured = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    return true;
  });
  return {
    get output() {
      return captured;
    },
    restore() {
      spy.mockRestore();
    },
  };
}

/** Strip ANSI escape codes for easier assertions. */
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/* ------------------------------------------------------------------ */
/*  1. Program (createProgram) Tests                                  */
/* ------------------------------------------------------------------ */

describe('createProgram', () => {
  it('returns a Commander Command instance', () => {
    const program = createProgram();
    expect(program).toBeInstanceOf(Command);
  });

  it('has name "locktek"', () => {
    const program = createProgram();
    expect(program.name()).toBe('locktek');
  });

  it('has version 0.1.0', () => {
    const program = createProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('registers the expected subcommands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('chains');
    expect(commandNames).toContain('wallet');
    expect(commandNames).toContain('send');
  });
});

/* ------------------------------------------------------------------ */
/*  2. chains Command Tests                                           */
/* ------------------------------------------------------------------ */

describe('chains command', () => {
  let stdoutCapture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    stdoutCapture = captureStdout();
  });

  afterEach(() => {
    stdoutCapture.restore();
  });

  it('lists all 12 chains', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'chains']);

    const output = stripAnsi(stdoutCapture.output);

    const expectedChains = [
      'ethereum',
      'ethereum-sepolia',
      'base',
      'base-sepolia',
      'polygon',
      'polygon-amoy',
      'arbitrum',
      'arbitrum-sepolia',
      'bsc',
      'bsc-testnet',
      'tron',
      'tron-shasta',
    ];

    for (const chain of expectedChains) {
      expect(output).toContain(chain);
    }
  });

  it('includes chain families (evm, tron)', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'chains']);

    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('evm');
    expect(output).toContain('tron');
  });

  it('includes testnet status', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'chains']);

    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('yes');
    expect(output).toContain('no');
  });

  it('includes table headers', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'chains']);

    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('Chain');
    expect(output).toContain('Family');
    expect(output).toContain('Testnet');
  });
});

/* ------------------------------------------------------------------ */
/*  3. wallet create Command Tests                                    */
/* ------------------------------------------------------------------ */

describe('wallet create command', () => {
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    stdoutCapture.restore();
    stderrCapture.restore();
    process.exitCode = undefined;
  });

  it('creates an EVM wallet with a valid 0x address for ethereum-sepolia', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const output = stripAnsi(stdoutCapture.output);
    // EVM addresses: 0x followed by 40 hex characters
    expect(output).toMatch(/0x[0-9a-fA-F]{40}/);
    expect(output).toContain('Wallet created');
    expect(output).toContain('ethereum-sepolia');
  });

  // In human mode the CLI warns that a wallet with no key is unusable. JSON mode
  // dropped that warning entirely — and the scripted caller is exactly the one likely
  // to fund an address it can never spend from.
  it('tells a --json caller that no key was returned', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      '--json',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const payload = JSON.parse(stripAnsi(stdoutCapture.output)) as Record<string, unknown>;

    expect(payload.ok).toBe(true);
    expect(payload.privateKeyIncluded).toBe(false);
    expect(String(payload.warning)).toMatch(/cannot be used|--show-private-key/i);
    expect(payload.privateKey).toBeUndefined();
  });

  it('marks the key as included when --show-private-key is passed in --json mode', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      '--json',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
      '--show-private-key',
    ]);

    const payload = JSON.parse(stripAnsi(stdoutCapture.output)) as Record<string, unknown>;

    expect(payload.privateKeyIncluded).toBe(true);
    expect(String(payload.privateKey)).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(payload.mnemonic).toBeTypeOf('string');
  });

  it('creates a Tron wallet with a valid T-address for tron-shasta', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'wallet', 'create', '--chain', 'tron-shasta']);

    const output = stripAnsi(stdoutCapture.output);
    // Tron addresses start with T and are base58 encoded
    expect(output).toMatch(/T[1-9A-HJ-NP-Za-km-z]{33}/);
    expect(output).toContain('Wallet created');
    expect(output).toContain('tron-shasta');
  });

  it('outputs an error for an invalid chain', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'wallet', 'create', '--chain', 'invalid-chain']);

    const errOutput = stripAnsi(stderrCapture.output);
    expect(errOutput).toContain('Unknown chain');
    expect(process.exitCode).toBe(1);
  });

  it('does not print the private key unless it is explicitly requested', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const output = stripAnsi(stdoutCapture.output);
    // A key printed by default ends up in scrollback, logs, and CI artefacts.
    expect(output).not.toContain('Private Key');
    expect(output).toContain('--show-private-key');
  });

  it('prints the private key and mnemonic when --show-private-key is passed', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
      '--show-private-key',
    ]);

    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('Private Key');
    expect(output).toMatch(/Private Key:\s+0x[0-9a-fA-F]{64}/);
  });

  it('emits a single JSON document on stdout in --json mode', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      '--json',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const parsed = JSON.parse(stdoutCapture.output);
    expect(parsed.ok).toBe(true);
    expect(parsed.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Progress chatter must not pollute stdout, or piping into jq breaks.
    expect(stdoutCapture.output.trimStart().startsWith('{')).toBe(true);
  });

  it('omits key material from --json output unless requested', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      '--json',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const parsed = JSON.parse(stdoutCapture.output);
    expect(parsed.privateKey).toBeUndefined();
    expect(parsed.mnemonic).toBeUndefined();
  });

  it('lists chains as JSON when asked', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', '--json', 'chains']);

    const parsed = JSON.parse(stdoutCapture.output);
    expect(parsed.chains).toHaveLength(12);
    expect(parsed.chains[0]).toMatchObject({
      name: expect.any(String),
      testnet: expect.any(Boolean),
    });
  });

  it('includes chain family in output', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      'wallet',
      'create',
      '--chain',
      'ethereum-sepolia',
    ]);

    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('Family');
    expect(output).toContain('evm');
  });
});

/* ------------------------------------------------------------------ */
/*  4. init Command Tests                                             */
/* ------------------------------------------------------------------ */

describe('init command', () => {
  let tmpDir: string;
  let originalCwd: string;
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'locktek-cli-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    stdoutCapture.restore();
    stderrCapture.restore();
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('creates a locktek.config.ts file', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init']);

    const configPath = join(tmpDir, 'locktek.config.ts');
    expect(existsSync(configPath)).toBe(true);
  });

  it('generated config contains chains and defaultChain', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init']);

    const configPath = join(tmpDir, 'locktek.config.ts');
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('chains');
    expect(content).toContain('defaultChain');
    expect(content).toContain('ethereum-sepolia');
  });

  it('--chains flag includes specified chains', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([
      'node',
      'locktek',
      'init',
      '--chains',
      'ethereum-sepolia,base-sepolia',
    ]);

    const configPath = join(tmpDir, 'locktek.config.ts');
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain('ethereum-sepolia');
    expect(content).toContain('base-sepolia');
    // defaultChain should be the first chain in the list
    expect(content).toContain("defaultChain: 'ethereum-sepolia'");
  });

  it('rejects invalid chains with an error', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init', '--chains', 'fake-chain']);

    const errOutput = stripAnsi(stderrCapture.output);
    expect(errOutput).toContain('Unknown chains');
    expect(errOutput).toContain('fake-chain');
    expect(process.exitCode).toBe(1);
    // Config file should NOT be created
    expect(existsSync(join(tmpDir, 'locktek.config.ts'))).toBe(false);
  });

  it('refuses to overwrite without --force', async () => {
    const program1 = createProgram();
    program1.exitOverride();
    await program1.parseAsync(['node', 'locktek', 'init']);

    // Reset captures for the second run
    stdoutCapture.restore();
    stderrCapture.restore();
    stderrCapture = captureStderr();
    stdoutCapture = captureStdout();

    const program2 = createProgram();
    program2.exitOverride();
    await program2.parseAsync(['node', 'locktek', 'init']);

    const errOutput = stripAnsi(stderrCapture.output);
    expect(errOutput).toContain('already exists');
  });

  // A dangling symlink is invisible to existsSync, so a check-then-write follows it and
  // creates the file wherever it points. The write itself must refuse an existing name.
  it('never writes through a symlink planted at locktek.config.ts', async () => {
    const target = join(tmpDir, 'elsewhere.ts');
    symlinkSync(target, join(tmpDir, 'locktek.config.ts'));
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init']);

    expect(existsSync(target)).toBe(false);
    expect(stripAnsi(stderrCapture.output)).toContain('already exists');
  });

  it('--force overwrites an existing config', async () => {
    writeFileSync(join(tmpDir, 'locktek.config.ts'), 'old');
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init', '--force']);

    expect(readFileSync(join(tmpDir, 'locktek.config.ts'), 'utf-8')).toContain('defaultChain');
  });

  it('generated config includes the LocktekOptions type import', async () => {
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(['node', 'locktek', 'init']);

    const configPath = join(tmpDir, 'locktek.config.ts');
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toContain("import type { LocktekOptions } from '@locktek/core'");
    expect(content).toContain('satisfies LocktekOptions');
  });
});

/* ------------------------------------------------------------------ */
/*  5. Config Loader Tests                                            */
/* ------------------------------------------------------------------ */

describe('loadConfig', () => {
  let tmpDir: string;
  let originalCwd: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'locktek-config-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);

    // Save relevant env vars
    savedEnv['LOCKTEK_CHAINS'] = process.env['LOCKTEK_CHAINS'];
    savedEnv['LOCKTEK_DEFAULT_CHAIN'] = process.env['LOCKTEK_DEFAULT_CHAIN'];
    savedEnv['LOCKTEK_ENCRYPTION_KEY'] = process.env['LOCKTEK_ENCRYPTION_KEY'];

    // Clear them
    delete process.env['LOCKTEK_CHAINS'];
    delete process.env['LOCKTEK_DEFAULT_CHAIN'];
    delete process.env['LOCKTEK_ENCRYPTION_KEY'];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('keeps the spend policy and testnet flag from the config file', async () => {
    writeFileSync(
      join(tmpDir, 'locktek.config.js'),
      `export default {
        chains: ['ethereum-sepolia'],
        testnet: true,
        policy: { maxAmountPerTransaction: '0.5', allowedRecipients: ['0x0000000000000000000000000000000000000001'] },
      };`,
    );
    const { loadConfig } = await import('../utils/config-loader.js');
    const config = await loadConfig(tmpDir);

    expect(config.testnet).toBe(true);
    expect(config.policy).toEqual({
      maxAmountPerTransaction: '0.5',
      allowedRecipients: ['0x0000000000000000000000000000000000000001'],
    });
  });

  it('defaults to ethereum-sepolia when nothing configured', async () => {
    // Dynamically import to avoid module caching issues
    const { loadConfig } = await import('../utils/config-loader.js');
    const config = await loadConfig(tmpDir);
    expect(config.chains).toEqual(['ethereum-sepolia']);
  });

  it('LOCKTEK_CHAINS env var overrides file config', async () => {
    process.env['LOCKTEK_CHAINS'] = 'base-sepolia,polygon-amoy';
    const { loadConfig } = await import('../utils/config-loader.js');
    const config = await loadConfig(tmpDir);
    expect(config.chains).toEqual(['base-sepolia', 'polygon-amoy']);
  });

  it('LOCKTEK_DEFAULT_CHAIN is respected', async () => {
    process.env['LOCKTEK_DEFAULT_CHAIN'] = 'tron-shasta';
    const { loadConfig } = await import('../utils/config-loader.js');
    const config = await loadConfig(tmpDir);
    expect(config.defaultChain).toBe('tron-shasta');
  });

  it('returns rpc overrides from LOCKTEK_RPC_ prefixed env vars', async () => {
    process.env['LOCKTEK_RPC_ETHEREUM_SEPOLIA'] = 'https://custom-rpc.example.com';
    const { loadConfig } = await import('../utils/config-loader.js');
    const config = await loadConfig(tmpDir);
    expect(config.rpc?.['ethereum-sepolia']).toBe('https://custom-rpc.example.com');
    delete process.env['LOCKTEK_RPC_ETHEREUM_SEPOLIA'];
  });
});

/* ------------------------------------------------------------------ */
/*  6. Output Utility Tests                                           */
/* ------------------------------------------------------------------ */

describe('output utilities', () => {
  let stdoutCapture: ReturnType<typeof captureStdout>;
  let stderrCapture: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    stdoutCapture = captureStdout();
    stderrCapture = captureStderr();
  });

  afterEach(() => {
    stdoutCapture.restore();
    stderrCapture.restore();
  });

  it('success writes to stdout with checkmark', async () => {
    const { success } = await import('../utils/output.js');
    success('it worked');
    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('it worked');
  });

  it('error writes to stderr with cross mark', async () => {
    const { error } = await import('../utils/output.js');
    error('something broke');
    const output = stripAnsi(stderrCapture.output);
    expect(output).toContain('something broke');
  });

  it('label writes key-value pair to stdout', async () => {
    const { label } = await import('../utils/output.js');
    label('Name', 'Alice');
    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('Name:');
    expect(output).toContain('Alice');
  });

  it('heading writes bold text to stdout', async () => {
    const { heading } = await import('../utils/output.js');
    heading('My Heading');
    const output = stripAnsi(stdoutCapture.output);
    expect(output).toContain('My Heading');
  });
});

/* ------------------------------------------------------------------ */
/*  7. E2E Test — Built CLI                                           */
/* ------------------------------------------------------------------ */

describe('E2E: built CLI', () => {
  const cliRoot = join(import.meta.dirname, '..', '..');
  const distPath = join(cliRoot, 'dist', 'index.js');

  it('wallet create --chain ethereum-sepolia outputs a valid Ethereum address', () => {
    // Skip if dist does not exist (build required)
    if (!existsSync(distPath)) {
      console.warn('Skipping E2E: dist/index.js not found. Run `pnpm build` first.');
      return;
    }

    const result = execSync(`node "${distPath}" wallet create --chain ethereum-sepolia`, {
      encoding: 'utf-8',
      timeout: 30_000,
      env: {
        ...process.env,
        // Ensure no config file interferes
        LOCKTEK_CHAINS: 'ethereum-sepolia',
      },
    });

    const cleaned = stripAnsi(result);
    // Should contain a valid EVM address
    expect(cleaned).toMatch(/0x[0-9a-fA-F]{40}/);
    expect(cleaned).toContain('Wallet created');
  });

  it('chains command outputs a table with all chains', () => {
    if (!existsSync(distPath)) {
      console.warn('Skipping E2E: dist/index.js not found. Run `pnpm build` first.');
      return;
    }

    const result = execSync(`node "${distPath}" chains`, {
      encoding: 'utf-8',
      timeout: 10_000,
    });

    const cleaned = stripAnsi(result);
    expect(cleaned).toContain('ethereum-sepolia');
    expect(cleaned).toContain('tron-shasta');
    expect(cleaned).toContain('evm');
    expect(cleaned).toContain('tron');
  });
});
