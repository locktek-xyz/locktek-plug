import type { Chain } from '../types/chain.js';
import { getNetworkConfig } from './networks.js';

/** The endpoint tried first for a chain. */
export function getDefaultRpcUrl(chain: Chain): string {
  return getNetworkConfig(chain).rpcUrls[0];
}

/**
 * Every configured endpoint for a chain, in preference order.
 *
 * Adapters use the whole list: a read that fails on one endpoint fails over to the
 * next rather than surfacing an error to the caller.
 */
export function getAllRpcUrls(chain: Chain): readonly string[] {
  return getNetworkConfig(chain).rpcUrls;
}
