# @locktek/cli

Terminal wallet operations: create wallets, check balances, and send transactions.

> **Experimental. Testnet only.** Not audited and not yet published to npm — build from
> the [repository](https://github.com/locktek-xyz/locktek-plug). See its
> [Known limitations](../../README.md#known-limitations).

## Commands

| Command                                       | Description                                          |
| --------------------------------------------- | ---------------------------------------------------- |
| `locktek init`                                | Scaffold `locktek.config.ts`                         |
| `locktek chains`                              | List supported chains                                |
| `locktek wallet create [-c chain]`            | Create an HD wallet                                  |
| `locktek wallet balance <address> [-c chain]` | Check a native balance                               |
| `locktek send --to <addr> --amount <amt>`     | Build, sign, and broadcast                           |
| `locktek health`                              | Check whether configured RPC endpoints are reachable |

Add `--json` to any command for a single machine-readable document on stdout, suitable
for piping into `jq`. Progress messages are suppressed so stdout stays parseable, and a
failure is still exactly one JSON document (`{ "ok": false, "error": "..." }`).

`wallet create --json` reports `privateKeyIncluded` and a `warning`. Without
`--show-private-key` no key material is returned at all, which means the wallet cannot be
used — the JSON carries that fact so a script does not fund an address it cannot spend
from.

## Amounts are in whole units

```bash
locktek send --to 0xabc... --amount 0.5   # 0.5 ETH, not 0.5 wei
```

`send` shows the resolved amount and estimated fee and asks for confirmation before
signing. Pass `-y` to skip the prompt in a script.

## Private keys

`locktek send` takes the key from, in order:

1. `--key` — **warns**, because the key lands in shell history and `ps` output
2. `LOCKTEK_PRIVATE_KEY`
3. An interactive prompt with echo disabled

```bash
export LOCKTEK_PRIVATE_KEY=0x...
locktek send --to 0xabc... --amount 0.1 --idempotency-key payout-42 --wait
```

`--idempotency-key` makes a retry safe, including in a later run after a timeout or a
crash: the key is recorded under `~/.locktek` (or `LOCKTEK_STATE_DIR`) together with the
signed transaction, and reusing it resends that same transaction or returns its hash. It
never signs a second one. `--wait` reports whether the transaction
actually succeeded, rather than only that the broadcast was accepted.

`locktek wallet create` does **not** print the private key by default, so keys do not
end up in scrollback, logs, or CI artefacts. Pass `--show-private-key` when you want it.

## Configuration

`locktek.config.ts` in the working directory, overridden by environment variables:

```typescript
import type { LocktekOptions } from '@locktek/core';

export default {
  chains: ['ethereum-sepolia'],
  testnet: true,
  // Applied to every `send`, before anything is signed. Whole units, no asset attached.
  policy: { maxAmountPerTransaction: '0.1', allowedRecipients: ['0xabc...'] },
} satisfies LocktekOptions;
```

`chains`, `defaultChain`, `encryptionKey`, and `rpc` can be overridden by `LOCKTEK_*`
environment variables; `testnet`, `policy`, and `rpcPolicy` come from the file only.

The config file is executed to load it, so treat it as code you trust.

## License

MIT
