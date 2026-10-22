# Security Policy

Locktek Plug handles private keys. If you find a vulnerability, we want to hear about
it before anyone else does.

> **Status: experimental and testnet only.** Nothing here has been independently audited.
> Do not use it with real funds.

## Reporting a vulnerability

**Please do not open a public issue.** A public report on a wallet SDK is a zero-day
announcement.

Report privately through GitHub:
**[Report a vulnerability](https://github.com/locktek-xyz/locktek-plug/security/advisories/new)**
(the repository's **Security** tab → **Report a vulnerability**). Only the maintainers
can see the report. This is the only reporting channel; there is no security email.

Include what you can: affected package and version (or commit), reproduction steps, and
the impact you think it has.

### What to expect

| Stage                  | Target                           |
| ---------------------- | -------------------------------- |
| Acknowledgement        | within 3 working days            |
| Initial assessment     | within 7 working days            |
| Fix or mitigation plan | within 30 days for high severity |

We will credit you in the advisory unless you would rather stay anonymous.

## Supported versions

Nothing has been released yet. Until 1.0, only the latest minor release will receive
fixes.

| Version              | Supported         |
| -------------------- | ----------------- |
| `main`               | ✅                |
| any released version | latest minor only |

## Threat model

Being explicit about what this SDK does and does not defend against.

### What Locktek protects

- **Key material at rest** — private keys and mnemonics are encrypted with AES-256-GCM
  before storage. Ciphertexts are versioned, so keys can be rotated without orphaning
  existing wallets.
- **Key material and the model** — the MCP server holds its signing key in its own
  environment. No tool accepts a private key as input or returns one, so a
  prompt-injected agent cannot read or exfiltrate the key through the tools.
- **Key material in error paths** — invalid-key errors never echo the key, and MCP tool
  errors are scrubbed of key-shaped hex before they reach a model context.
- **RPC credentials** — RPC URLs, which often embed an API key, are reduced to scheme and
  host in errors, logs, and health checks.
- **Unbounded fund movement** — spend caps, recipient allow/deny lists, and read-only mode
  are evaluated in-process before the facade signs a transfer. With
  `LOCKTEK_REQUIRE_CONFIRMATION=true`, the MCP server also asks a **person** to approve
  each transfer and signature through the client's UI (MCP elicitation); the model cannot
  answer that prompt, and a client that cannot show it is refused.
- **Accidental mainnet use** — `testnet: true` is the default and mainnet chains must be
  opted into. EVM transactions are signed with the configured chain ID, so a mainnet node
  rejects them; Tron endpoints are checked against their genesis block before a
  transaction is built.
- **Double-spends on retry** — writes are never retried or failed over automatically.
  With an idempotency key, a transaction is signed once and its bytes recorded before
  broadcast, so a retry resends the same transaction instead of signing a new one.
- **Private-key export** — the BetterAuth `export-wallet` endpoint is disabled unless the
  application enables it, and then requires a fresh session, an explicit acknowledgement,
  ownership of the wallet, and a successful audit-hook call before anything is returned.

### What Locktek does not protect against

- **A compromised host.** Key material is decrypted in process memory to sign. Anything
  that can read that memory — or the MCP server's environment — can read the key.
- **A leaked encryption key.** One key protects every wallet encrypted with it. The scrypt
  salt is not secret, so a per-tenant salt does **not** contain a leak. Use a distinct key
  per tenant, or a custom `IEncryptionProvider` backed by a KMS.
- **An agent acting within its limits.** Without required confirmation, an agent can move
  funds up to the configured caps to any allowed recipient. Caps are whole-unit numbers
  with no asset attached, so a cap meant for a stablecoin also applies, unchanged, to the
  native coin.
- **Paths around the policy.** The policy is evaluated when the facade builds a transfer.
  Raw `data` calldata is not decoded, a caller-supplied `tokenDecimals` is trusted, a
  transaction can be changed between `buildTransaction` and `signAndSend`, the exported
  chain adapters bypass the facade entirely, and fees are not capped.
- **What a signature authorises.** `sign_message` cannot broadcast a transaction, but
  services that accept signed messages (logins, off-chain orders, approvals) will act on
  one.
- **A malicious dependency.** Actions are pinned to commit SHAs, the lockfile is
  committed, and CI audits the shipped dependency tree — but this is not zero risk.
- **Loss of your ciphertexts.** `encryptedPrivateKey` and `encryptedMnemonic` are the
  only copies. Lose them or your encryption key and the funds are unreachable. There is
  no backdoor, and we cannot recover them for you.

## Operational guidance

- Keep `testnet: true`. This project is not ready for real funds.
- Give the MCP server a dedicated wallet holding only what you can afford to lose, set
  `LOCKTEK_MAX_AMOUNT_PER_TX`, `LOCKTEK_MAX_AMOUNT_PER_SESSION` and
  `LOCKTEK_ALLOWED_RECIPIENTS`, and turn on `LOCKTEK_REQUIRE_CONFIRMATION`.
- Store `encryptedPrivateKey` **and** `encryptedMnemonic`. The mnemonic is what lets a
  user recover their wallet in any standard wallet application.
- Deleting a user cascades to their wallets. If you enable `walletExport`, wire
  `onExport` to an audit log you actually review.
- Use a dedicated RPC endpoint; public endpoints are rate-limited and unreliable.
- Never pass a private key with `--key` on a shared machine — it lands in shell history
  and `ps` output. Use `LOCKTEK_PRIVATE_KEY` or the interactive prompt.

## No formal audit

Locktek Plug has **not** had a third-party security audit. The cryptographic code is
open specifically so it can be inspected. Treat it accordingly.
