# @locktek/mcp-server

MCP server that gives an AI agent a wallet — with spend limits and recipient rules
checked by the server, a signing key the model never sees, and optional approval of
each transfer by a person.

> **Experimental. Testnet only.** Not audited, not yet on npm. Use a wallet holding only
> testnet funds you can afford to lose.

## Claude Desktop setup

Build the repository (`pnpm install && pnpm build`), then add to
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "locktek": {
      "command": "node",
      "args": ["/path/to/locktek-plug/packages/mcp-server/dist/bin.js"],
      "env": {
        "LOCKTEK_CHAINS": "ethereum-sepolia",
        "LOCKTEK_PRIVATE_KEY": "0x… (testnet wallet)",
        "LOCKTEK_MAX_AMOUNT_PER_TX": "0.1",
        "LOCKTEK_MAX_AMOUNT_PER_SESSION": "0.5",
        "LOCKTEK_ALLOWED_RECIPIENTS": "0xabc…",
        "LOCKTEK_REQUIRE_CONFIRMATION": "true"
      }
    }
  }
}
```

Configuration is validated at startup, so a mistake surfaces as a clear stderr message
rather than a server that silently never appears. At startup the server also says on
stderr which address it signs as, and warns if no spend limit is configured or mainnet
is enabled.

## The signing key stays on the server

The server signs with `LOCKTEK_PRIVATE_KEY` from its own environment. **No tool accepts a
private key as input or returns one**, so the key is never in the model's context or the
host's transcript, and a prompt-injected agent cannot exfiltrate it through the tools.

Without `LOCKTEK_PRIVATE_KEY` the server is read-only: `send_transaction`,
`confirm_transaction`, and `sign_message` are not offered at all.

## Tools

| Tool                    | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| `create_wallet`         | Create an HD wallet, returning its encrypted key and mnemonic            |
| `get_balance`           | Native balance in whole units and base units                             |
| `get_token_balance`     | Token balance, scaled by the contract's own decimals                     |
| `simulate_transaction`  | Show exactly what a transfer would do, and issue a single-use token      |
| `wait_for_confirmation` | Report whether a broadcast transaction succeeded or reverted             |
| `estimate_gas`          | Estimate the fee, flagging whether it came from live chain data          |
| `validate_address`      | Validate an address; checks the EIP-55 checksum on mixed-case input      |
| `list_chains`           | List the configured chains, plus everything the SDK supports             |
| `health_check`          | Probe each configured chain's RPC endpoint (API keys stripped from URLs) |
| `send_transaction`      | Sign and broadcast from the server's wallet _(needs a signing key)_      |
| `confirm_transaction`   | Send a previously simulated transfer via its token _(needs a key)_       |
| `sign_message`          | Sign text with the server's wallet _(needs a signing key)_               |

`sign_message` cannot broadcast a transaction, but a signature can still authorise
actions on services that accept signed messages — logins, off-chain orders, approvals.

## Amounts are in whole units

`"1"` means **1 ETH**, not 1 wei. The same is true of every tool and of the CLI.

## Spend limits

Limits are checked in the server before signing. A limit written into a system prompt
is a suggestion; this is a control.

| Variable                         | Description                                              |
| -------------------------------- | -------------------------------------------------------- |
| `LOCKTEK_MAX_AMOUNT_PER_TX`      | Largest single transfer, in whole units                  |
| `LOCKTEK_MAX_AMOUNT_PER_SESSION` | Cumulative cap for the server's lifetime, in whole units |
| `LOCKTEK_ALLOWED_RECIPIENTS`     | Comma-separated allowlist; everything else is refused    |
| `LOCKTEK_DENIED_RECIPIENTS`      | Comma-separated denylist, applied even with no allowlist |
| `LOCKTEK_READ_ONLY`              | Refuse every transfer                                    |

Caps are plain numbers with no asset attached: `LOCKTEK_MAX_AMOUNT_PER_TX=100` allows 100
of a stablecoin **or 100 of the native coin**. Prefer a recipient allowlist, and keep
only small amounts in the server's wallet.

## A person approves each transfer

With `LOCKTEK_REQUIRE_CONFIRMATION=true`, every `send_transaction`,
`confirm_transaction`, and `sign_message` waits for the **person using the MCP client**
to approve it. The server asks through the client's own UI using MCP
[elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation),
showing the amount, base units, sender, recipient, chain, and fee that it computed
itself — not the model's description of them.

- The model cannot answer the prompt; the client returns the person's answer straight to
  the server.
- A declined or dismissed prompt signs nothing.
- **A client without elicitation support is refused**, rather than allowed through.

`simulate_transaction` → `confirm_transaction` still works as a two-step flow: the token
is single-use, expires, carries the exact simulated transfer, and is only redeemable for
the server's own wallet. A token is not an approval by itself.

## Configuration

| Variable                       | Default            | Description                                         |
| ------------------------------ | ------------------ | --------------------------------------------------- |
| `LOCKTEK_PRIVATE_KEY`          | —                  | Signing key; without it the server is read-only     |
| `LOCKTEK_CHAINS`               | `ethereum-sepolia` | Comma-separated chains                              |
| `LOCKTEK_DEFAULT_CHAIN`        | first configured   | Must be one of `LOCKTEK_CHAINS`                     |
| `LOCKTEK_ENCRYPTION_KEY`       | —                  | Min 16 chars; required for `create_wallet`          |
| `LOCKTEK_TESTNET`              | `true`             | Set `false` to allow mainnet chains (don't)         |
| `LOCKTEK_REQUIRE_CONFIRMATION` | `false`            | Ask a person to approve each transfer and signature |
| `LOCKTEK_RPC_<CHAIN>`          | public RPC         | e.g. `LOCKTEK_RPC_ETHEREUM_SEPOLIA`                 |
| `LOCKTEK_RPC_TIMEOUT_MS`       | `15000`            | Per-call timeout                                    |
| `LOCKTEK_RPC_MAX_ATTEMPTS`     | `3`                | Retry attempts for reads                            |
| `LOCKTEK_CONFIRMATION_TTL_MS`  | `120000`           | Confirmation token lifetime                         |

Boolean flags accept `1/true/yes/on` and `0/false/no/off`. Anything else stops the
server at startup: these are safety switches, and a typo must not mean "off".

`idempotencyKey` on the signing tools makes a retry safe for the life of the server
process: reusing it resends the same signed transaction or returns its hash, and never
signs a second transfer.

## Security

The key lives in the server's environment, so anything that can read that environment
or the process memory can read the key. Error messages are scrubbed of key-shaped data
and RPC API keys before they are returned. See the repository's
[SECURITY.md](../../SECURITY.md) for the full threat model.

## License

MIT
