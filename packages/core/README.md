# @locktek/core

Wallet creation, HD derivation, signing, and chain adapters (EVM + Tron) for Node.js.

> **Experimental. Testnet only.** Not audited and not yet published to npm — build from
> the [repository](https://github.com/locktek-xyz/locktek-plug). See its
> [Known limitations](../../README.md#known-limitations).

## Quickstart

```typescript
import { createLocktek } from '@locktek/core';

const locktek = createLocktek({
  chains: ['ethereum-sepolia'],
  encryptionKey: process.env.LOCKTEK_ENCRYPTION_KEY,
});

// Create a wallet. Store BOTH ciphertexts — they are the only copy.
const wallet = await locktek.createAndEncryptWallet();
console.log(wallet.address, wallet.encryptedPrivateKey, wallet.encryptedMnemonic);

// Read a balance in whole units.
const { balanceFormatted, symbol } = await locktek.getBalanceFormatted(wallet.address);
console.log(`${balanceFormatted} ${symbol}`);
```

## Amounts are in whole units

`amount` means whole units everywhere in this SDK. `"1"` is **1 ETH**, not 1 wei.

```typescript
const tx = await locktek.buildTransaction({
  from: wallet.address,
  to: '0x0000000000000000000000000000000000000001',
  amount: '0.1', // 0.1 ETH
});

const { hash } = await locktek.signAndSend(tx, privateKey, undefined, {
  // Reusing the key, even after a timeout, resends this exact signed transaction.
  idempotencyKey: 'payout-42',
});

const receipt = await locktek.waitForConfirmation(hash);
console.log(receipt.status); // 'success' | 'reverted'
```

A transaction hash means the broadcast was accepted, not that the transfer succeeded.
Use `waitForConfirmation` when you need to know.

With an `idempotencyKey`, the transaction is signed once and its bytes are recorded
before the broadcast, so a retry resends the same transaction instead of signing a new
one. The default store is in memory; pass `idempotencyStore` with a durable
implementation to keep that guarantee across restarts and instances.

## Testnet is the default

`testnet` defaults to `true`: configuring a mainnet chain throws `MAINNET_BLOCKED`. EVM
transactions are signed with the configured chain ID, and Tron endpoints are checked
against their genesis block, so a mainnet RPC URL under a testnet chain name does not
produce mainnet transactions. Opt in to mainnet explicitly (this project is not ready
for it):

```typescript
createLocktek({ chains: ['ethereum'], testnet: false });
```

## Spend limits

Limits are evaluated in-process when the facade builds a transfer, before anything is
signed. Caps are whole-unit numbers with no asset attached, and raw `data`, a
caller-supplied `tokenDecimals`, direct adapter use, and fees are not covered — see the
repository's [Known limitations](../../README.md#known-limitations).

```typescript
const locktek = createLocktek({
  chains: ['ethereum-sepolia'],
  policy: {
    maxAmountPerTransaction: '0.5',
    maxAmountPerSession: '2',
    allowedRecipients: ['0xa614f803B6FD780986A42c78Ec9c7f77e6DeD13C'],
  },
});

// Check without committing to anything.
const preview = await locktek.simulateTransaction({ from, to, amount: '5' });
if (!preview.allowed) console.log(preview.rule, preview.reason);
```

## Reliability

Every network call has a timeout. Reads retry with exponential backoff and jitter, and
fail over across the configured RPC endpoints. Writes do neither — a broadcast that
timed out may already have landed, so retrying it is the caller's explicit decision,
made safe with `idempotencyKey`.

```typescript
createLocktek({
  chains: ['ethereum-sepolia'],
  rpc: { 'ethereum-sepolia': 'https://your-dedicated-endpoint' },
  rpcPolicy: { timeoutMs: 10_000, maxAttempts: 3 },
  logger: pino(),
});
```

## API

| Method                                                                | Description                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `createWallet(chain?)`                                                | Generate a new HD wallet                                                        |
| `createAndEncryptWallet(chain?)`                                      | Generate a wallet, returning encrypted key and mnemonic                         |
| `recoverWallet({ encryptedPrivateKey?, encryptedMnemonic?, chain? })` | Decrypt stored key material, and derive the address so recovery can be verified |
| `importWallet(privateKey, chain?)`                                    | Reconstruct a wallet from a private key                                         |
| `getBalance(address, chain?)`                                         | Native balance in base units                                                    |
| `getBalanceFormatted(address, chain?)`                                | Native balance in whole units, with symbol                                      |
| `getTokenBalance(address, tokenAddress, chain?)`                      | Token balance in base units                                                     |
| `getTokenBalanceFormatted(address, tokenAddress, chain?)`             | Token balance in whole units                                                    |
| `getTokenDecimals(tokenAddress, chain?)`                              | Decimals read from the token contract                                           |
| `buildTransaction(params, chain?)`                                    | Build an unsigned transaction (enforces policy)                                 |
| `simulateTransaction(params, chain?)`                                 | Evaluate a transfer without signing                                             |
| `estimateGas(params, chain?)`                                         | Estimate the fee                                                                |
| `signAndSend(tx, privateKey, chain?, options?)`                       | Sign and broadcast                                                              |
| `waitForConfirmation(hash, chain?, options?)`                         | Wait for the receipt                                                            |
| `signMessage(message, privateKey, chain?)`                            | Sign an arbitrary message                                                       |
| `validateAddress(address, chain?)`                                    | Validate; checks the EIP-55 checksum on mixed-case input                        |
| `healthCheck()`                                                       | Probe every configured chain's RPC endpoints                                    |
| `encrypt(text)` / `decrypt(text)`                                     | Use the configured encryption provider                                          |

## Supported chains

**EVM:** `ethereum`, `base`, `polygon`, `arbitrum`, `bsc` — each with a testnet variant
(`ethereum-sepolia`, `base-sepolia`, `polygon-amoy`, `arbitrum-sepolia`, `bsc-testnet`).

**Tron:** `tron`, `tron-shasta`.

Add your own without forking:

```typescript
import { registerChain } from '@locktek/core';

registerChain({
  chain: 'my-chain',
  network: {
    /* chainId, name, symbol, decimals, chainFamily, rpcUrls, explorerUrl, isTestnet */
  },
  createAdapter: (chain, options) => new EvmAdapter(chain, options),
});
```

## Key management

Keys are encrypted with AES-256-GCM using a 96-bit IV. Ciphertexts carry a key version,
so keys can be rotated without orphaning existing wallets:

```typescript
const provider = new AesGcmEncryptionProvider(NEW_KEY, {
  version: 2,
  previousKeys: [{ key: OLD_KEY, version: 1 }],
});

if (provider.needsRotation(ciphertext)) {
  ciphertext = await provider.rotate(ciphertext); // idempotent, safe to re-run
}
```

For a KMS or per-tenant isolation, implement `IEncryptionProvider` and pass it as
`encryptionProvider`.

⚠️ **`encryptedPrivateKey` and `encryptedMnemonic` are the only copies of a wallet's
keys.** Lose them, or the encryption key, and the funds are unreachable.

## License

MIT
