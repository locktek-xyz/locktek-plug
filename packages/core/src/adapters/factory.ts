import type { Chain, ChainFamily, NetworkConfig } from '../types/chain.js';
import type { ChainAdapter } from './interface.js';
import {
  getChainFamily,
  isValidChain,
  registerCustomChain,
  unregisterCustomChain,
  isRegisteredChain as isChainRegistered,
} from '../config/chains.js';
import { registerNetworkConfig } from '../config/networks.js';
import { LocktekError, ErrorCode } from '../types/common.js';
import { EvmAdapter, type EvmAdapterOptions } from './evm.adapter.js';
import { TronAdapter, type TronAdapterOptions } from './tron.adapter.js';

export type AdapterOptions = EvmAdapterOptions & TronAdapterOptions;

/** Builds an adapter for a chain registered via {@link registerChain}. */
export type AdapterConstructor = (chain: Chain, options: AdapterOptions) => ChainAdapter;

const customAdapters = new Map<string, AdapterConstructor>();

/**
 * Register support for a chain the SDK does not ship, without forking it.
 *
 * Registration fails rather than silently shadowing a built-in chain, so a typo in
 * a chain identifier cannot quietly replace a real network.
 */
export function registerChain(options: {
  chain: string;
  network: NetworkConfig;
  createAdapter: AdapterConstructor;
}): void {
  if (isValidChain(options.chain)) {
    throw new LocktekError(
      `Chain "${options.chain}" is built in and cannot be replaced by a custom adapter.`,
      ErrorCode.INVALID_CHAIN,
    );
  }

  if (customAdapters.has(options.chain)) {
    throw new LocktekError(
      `Chain "${options.chain}" is already registered.`,
      ErrorCode.INVALID_CHAIN,
    );
  }

  if (typeof options.createAdapter !== 'function') {
    throw new LocktekError(
      `registerChain("${options.chain}") requires a createAdapter function.`,
      ErrorCode.INVALID_CONFIG,
    );
  }

  registerNetworkConfig(options.chain, options.network);
  registerCustomChain(options.chain, options.network.chainFamily);
  customAdapters.set(options.chain, options.createAdapter);
}

/** Remove a custom chain registration. Built-in chains are unaffected. */
export function unregisterChain(chain: string): void {
  customAdapters.delete(chain);
  unregisterCustomChain(chain);
}

export function isRegisteredChain(chain: string): boolean {
  return isChainRegistered(chain);
}

export function createAdapter(chain: Chain, options: AdapterOptions | string = {}): ChainAdapter {
  const opts: AdapterOptions = typeof options === 'string' ? { rpcUrl: options } : options;

  const custom = customAdapters.get(chain);
  if (custom) return custom(chain, opts);

  const family: ChainFamily = getChainFamily(chain);

  switch (family) {
    case 'evm':
      return new EvmAdapter(chain, opts);
    case 'tron':
      return new TronAdapter(chain, opts);
    default:
      throw new LocktekError(
        `Unsupported chain family "${family}" for chain "${chain}". Supported families: evm, tron.`,
        ErrorCode.INVALID_CHAIN,
      );
  }
}
