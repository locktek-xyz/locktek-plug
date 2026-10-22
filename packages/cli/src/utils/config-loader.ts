import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createJiti } from 'jiti';
import type { LocktekOptions } from '@locktek/core';

interface LoadedConfig {
  readonly chains: string[];
  readonly defaultChain?: string;
  readonly encryptionKey?: string;
  readonly rpc?: Record<string, string>;
  readonly testnet?: boolean;
  readonly policy?: LocktekOptions['policy'];
  readonly rpcPolicy?: LocktekOptions['rpcPolicy'];
}

function loadFromEnv(): LoadedConfig {
  const chainsEnv = process.env['LOCKTEK_CHAINS'];
  const chains = chainsEnv ? chainsEnv.split(',').map((c) => c.trim()) : [];

  const defaultChain = process.env['LOCKTEK_DEFAULT_CHAIN'];
  const encryptionKey = process.env['LOCKTEK_ENCRYPTION_KEY'];

  const rpc: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('LOCKTEK_RPC_') && value) {
      const chain = key.slice('LOCKTEK_RPC_'.length).toLowerCase().replace(/_/g, '-');
      rpc[chain] = value;
    }
  }

  return {
    chains: chains.length > 0 ? chains : [],
    defaultChain,
    encryptionKey,
    ...(Object.keys(rpc).length > 0 ? { rpc } : {}),
  };
}

async function loadFromFile(cwd: string): Promise<LoadedConfig | null> {
  const tsPath = resolve(cwd, 'locktek.config.ts');
  const jsPath = resolve(cwd, 'locktek.config.js');

  const configPath = existsSync(tsPath) ? tsPath : existsSync(jsPath) ? jsPath : null;

  if (!configPath) {
    return null;
  }

  try {
    const jiti = createJiti(import.meta.url);
    const imported = (await jiti.import(configPath)) as Record<string, unknown>;
    const raw = imported['default'] ?? imported;

    if (raw === null || typeof raw !== 'object') {
      process.stderr.write(
        `\x1b[33m⚠\x1b[0m Config in ${configPath} must export a plain object, got ${typeof raw}\n`,
      );
      return null;
    }

    const config = raw as Record<string, unknown>;

    if (
      typeof config['createWallet'] === 'function' ||
      typeof config['createAndEncryptWallet'] === 'function'
    ) {
      process.stderr.write(
        `\x1b[33m⚠\x1b[0m Config in ${configPath} exports a Locktek class instance. Export a plain config object instead.\n`,
      );
      return null;
    }

    if ('chains' in config && !Array.isArray(config['chains'])) {
      process.stderr.write(
        `\x1b[33m⚠\x1b[0m Config in ${configPath}: "chains" must be an array.\n`,
      );
      return null;
    }

    return config as unknown as LoadedConfig;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[33m⚠\x1b[0m Could not load ${configPath}: ${message}\n`);
    return null;
  }
}

function mergeConfigs(fileConfig: LoadedConfig | null, envConfig: LoadedConfig): LocktekOptions {
  const base = fileConfig ?? { chains: [] };
  const chains =
    envConfig.chains.length > 0
      ? envConfig.chains
      : base.chains.length > 0
        ? base.chains
        : ['ethereum-sepolia'];

  // Safety settings come from the file only and are passed through untouched:
  // dropping `policy` here would silently remove the spend limits a user configured.
  return {
    chains,
    defaultChain: envConfig.defaultChain ?? base.defaultChain,
    encryptionKey: envConfig.encryptionKey ?? base.encryptionKey,
    rpc: { ...base.rpc, ...envConfig.rpc },
    ...(base.testnet !== undefined ? { testnet: base.testnet } : {}),
    ...(base.policy !== undefined ? { policy: base.policy } : {}),
    ...(base.rpcPolicy !== undefined ? { rpcPolicy: base.rpcPolicy } : {}),
  };
}

export async function loadConfig(cwd?: string): Promise<LocktekOptions> {
  const dir = cwd ?? process.cwd();
  const fileConfig = await loadFromFile(dir);
  const envConfig = loadFromEnv();
  return mergeConfigs(fileConfig, envConfig);
}
