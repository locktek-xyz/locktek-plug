import { describe, it, expect, expectTypeOf } from 'vitest';
import * as pkg from '../index.js';
import * as clientPkg from '../client.js';
import type {
  LocktekPluginOptions,
  WalletResponse,
  LocktekWalletRecord,
  CreateWalletInput,
  GetBalanceInput,
  BalanceResponse,
} from '../types.js';

/**
 * The public surface of a published package is a contract. Removing an export is a
 * breaking change for every consumer, and it is the kind of change that slips through
 * a refactor unnoticed — nothing inside the package fails when an export disappears.
 */
describe('public exports', () => {
  it('exports the runtime entry points', () => {
    expect(Object.keys(pkg).sort()).toEqual(
      [
        'WALLET_EXPORT_ACKNOWLEDGEMENT',
        'locktekPlugin',
        'locktekWalletSchema',
        'provisionWallet',
        'resolveAutoChains',
        'toResponse',
        'walletKeyFor',
      ].sort(),
    );
  });

  it('exports the client plugin from the /client entry point', () => {
    expect(Object.keys(clientPkg).sort()).toEqual([
      'WALLET_EXPORT_ACKNOWLEDGEMENT',
      'locktekClient',
    ]);
  });

  it('keeps the documented option and response types in the public surface', () => {
    expectTypeOf<LocktekPluginOptions>().toBeObject();
    expectTypeOf<WalletResponse>().toBeObject();
    expectTypeOf<LocktekWalletRecord>().toBeObject();
    expectTypeOf<CreateWalletInput>().toBeObject();
    expectTypeOf<GetBalanceInput>().toBeObject();
    expectTypeOf<BalanceResponse>().toBeObject();
  });
});
