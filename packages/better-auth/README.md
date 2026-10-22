# @locktek/better-auth

BetterAuth plugin for embedded wallet provisioning — optionally auto-creating a wallet
when a user signs up.

> **Experimental. Testnet only.** Not audited and not yet published to npm — build from
> the [repository](https://github.com/locktek-xyz/locktek-plug). See its
> [Known limitations](../../README.md#known-limitations).

## Setup

```typescript
import { betterAuth } from 'better-auth';
import { locktekPlugin } from '@locktek/better-auth';

export const auth = betterAuth({
  database: /* your adapter */,
  emailAndPassword: { enabled: true },
  plugins: [
    locktekPlugin({
      chains: ['ethereum-sepolia'],
      encryptionKey: process.env.LOCKTEK_ENCRYPTION_KEY, // required, min 16 chars
      autoCreateWallet: true,
    }),
  ],
});
```

Then run your BetterAuth migration to create the `locktekWallet` table.

Client side:

```typescript
import { createAuthClient } from 'better-auth/client';
import { locktekClient } from '@locktek/better-auth/client';

export const authClient = createAuthClient({ plugins: [locktekClient()] });
```

## Automatic provisioning

`autoCreateWallet` registers a signup hook, so a wallet exists **before the signup
response returns**. That is what makes "every user has a wallet" an invariant rather
than something your application has to reconcile later.

```typescript
locktekPlugin({
  chains: ['ethereum-sepolia', 'base-sepolia'],
  encryptionKey: process.env.LOCKTEK_ENCRYPTION_KEY,
  autoCreateWallet: ['ethereum-sepolia', 'base-sepolia'], // one wallet per chain
  onWalletCreationError: 'fail', // or 'continue'
});
```

- `autoCreateWallet: true` provisions on the default chain.
- `autoCreateWallet: ['a', 'b']` provisions one wallet per listed chain.
- Omit it (the default) and wallets are created only via the endpoint.

**`onWalletCreationError`** decides what happens if provisioning fails:

| Value                | Behaviour                                                             |
| -------------------- | --------------------------------------------------------------------- |
| `'fail'` _(default)_ | Signup fails. No user is silently left without a wallet.              |
| `'continue'`         | Signup succeeds without a wallet. Your application must reconcile it. |

Provisioning is **idempotent**: a unique constraint on `(userId, chain)` means a
replayed hook, a double-clicked button, or two concurrent requests all produce exactly
one wallet.

`autoCreateWallet` requires `encryptionKey`. Without it the plugin throws at startup
rather than failing on every signup.

## Endpoints

| Endpoint                 | Method | Description                                       |
| ------------------------ | ------ | ------------------------------------------------- |
| `/locktek/create-wallet` | POST   | Create a wallet (idempotent per user and chain)   |
| `/locktek/wallets`       | GET    | List the session user's wallets                   |
| `/locktek/balance`       | POST   | Native balance, in whole units and base units     |
| `/locktek/export-wallet` | POST   | Opt-in: decrypt key material for a wallet you own |

All require an authenticated session and are scoped to the session user. Key material is
stripped from every response except `export-wallet`, which **does not exist unless you
enable it**.

```typescript
const { data } = await authClient.locktek.createWallet({ chain: 'ethereum-sepolia' });
console.log(data.wallet.address, data.created); // created === false if it already existed

const balance = await authClient.locktek.getBalance({ address: data.wallet.address });
console.log(balance.data.balanceFormatted, balance.data.symbol);
```

## Recovery

Both the encrypted private key and the encrypted **mnemonic** are stored. The mnemonic
is what lets a user restore their wallet in any standard wallet application, so losing
one ciphertext is not fatal.

Exporting a private key over HTTP is off by default. To offer it, enable it with an
audit hook:

```typescript
locktekPlugin({
  encryptionKey: process.env.LOCKTEK_ENCRYPTION_KEY,
  walletExport: {
    enabled: true,
    // Awaited before any key is returned. If it throws, nothing is returned.
    onExport: async ({ userId, walletId, address, chain }) => {
      await auditLog.write({ event: 'wallet.export', userId, walletId, address, chain });
    },
  },
});
```

```typescript
import { WALLET_EXPORT_ACKNOWLEDGEMENT } from '@locktek/better-auth/client';

// Send the acknowledgement only from an explicit user action, e.g. a ticked checkbox.
const exported = await authClient.locktek.exportWallet({
  walletId,
  acknowledgement: WALLET_EXPORT_ACKNOWLEDGEMENT,
});
// exported.data.privateKey, exported.data.mnemonic
```

The endpoint requires a **fresh session** (better-auth `session.freshAge`; a user who
signed in long ago must sign in again), the acknowledgement text, ownership of the
wallet, and a successful `onExport` call. It also checks that the decrypted key matches
the stored address. Never log the response.

With `autoCreateWallet`, a provisioning failure under the default
`onWalletCreationError: 'fail'` fails the signup request — but better-auth runs the hook
after the user row is committed, so the user remains, without a wallet. Create the
missing wallet on their next sign-in.

⚠️ **`locktekWallet.userId` cascades on delete.** Deleting a user destroys their only
copy of the key material. Offer an export before you delete an account that holds value.

## License

MIT
