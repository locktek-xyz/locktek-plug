import { isAddress } from 'ethers';
import type { Chain } from '../types/chain.js';
import { getChainFamily } from '../config/chains.js';
import { TronAddress } from './tron-address.js';

const EVM_ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Validate an EVM address, including its EIP-55 checksum when one is present.
 *
 * All-lowercase and all-uppercase addresses carry no checksum information and are
 * accepted. A mixed-case address with a bad checksum is rejected — that is almost
 * always a typo, and sending to a mistyped address is unrecoverable.
 */
export function validateEvmAddress(address: string): boolean {
  // ethers accepts a bare 40-hex string; Locktek requires the 0x prefix so the
  // shape check stays strict, then defers to ethers for the EIP-55 checksum.
  return EVM_ADDRESS_SHAPE.test(address) && isAddress(address);
}

/** Validate a Tron base58check address, including its checksum. */
export function validateTronAddress(address: string): boolean {
  return TronAddress.isValid(address);
}

/** Validate an address for the given chain, dispatching on chain family. */
export function validateAddress(address: string, chain: Chain): boolean {
  return getChainFamily(chain) === 'tron'
    ? validateTronAddress(address)
    : validateEvmAddress(address);
}
