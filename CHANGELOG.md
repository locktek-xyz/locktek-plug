# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

All four packages (`@locktek/core`, `@locktek/mcp-server`, `@locktek/better-auth`,
`@locktek/cli`) are versioned and released together.

## [Unreleased]

Nothing has been published to npm yet. Everything below will ship in the first release,
`0.1.0`. The project is **experimental and testnet only**.

### Security

Fixes from the pre-release review, before anything was published:

- **A retry can no longer double-spend.** `signAndSend` now signs once, records the
  signed bytes against the idempotency key _before_ broadcasting, and on a retry resends
  those same bytes instead of building a new transaction. Previously a timeout released
  the key, so a retry signed a second transfer with a new nonce and both could land.
  The key is released only when the node definitively refuses the first broadcast.
- **Idempotency keys are scoped per chain**, so one key reused on two chains cannot
  return the other chain's hash.
- **The CLI's `--idempotency-key` works across runs.** It is recorded on disk
  (`~/.locktek`, or `LOCKTEK_STATE_DIR`); before, the store lived in memory and every run
  started empty.
- **The MCP server no longer takes a private key as a tool argument.** It signs with
  `LOCKTEK_PRIVATE_KEY` from its own environment; no tool accepts or returns a key.
  Without a key the server is read-only and does not offer the signing tools.
- **Required confirmation now means a person.** With `LOCKTEK_REQUIRE_CONFIRMATION=true`
  the server asks the user through the MCP client (elicitation) to approve each
  transfer and signature, showing the amounts it resolved itself, and refuses clients
  that cannot ask. Before, the agent could complete the simulate → confirm flow alone.
- **A confirmation token only works for the server's own wallet.** It was not bound to
  the sender.
- **MCP safety flags fail closed.** An unrecognised value such as
  `LOCKTEK_TESTNET=fasle` or `LOCKTEK_READ_ONLY=required` stops the server at startup
  instead of meaning "off". The server warns on stderr when it has no spend limits.
- **BetterAuth wallet export is off by default.** `export-wallet` is offered only with
  `walletExport: { enabled: true, onExport }`, requires a fresh session, and records the
  export through `onExport` before returning anything — if the audit call fails, no key
  is returned. The client no longer sends the acknowledgement on the caller's behalf.
- **The CLI keeps `policy` and `testnet` from `locktek.config.ts`.** The loader dropped
  them, silently removing configured spend limits.
- **The CLI's key prompt no longer echoes a pasted key.**
- **Tron: a rejected broadcast is no longer reported as success.** TronWeb includes a
  `txid` even when the node refuses a transaction; only `result: true` now counts.
- **Tron: endpoints are checked against the configured network** (genesis block) before
  a transaction is built, so a mainnet URL configured under a testnet chain name is
  refused.
- **Nonces are tracked per chain.** One `NonceManager` shared across chains gave the
  same address on a second chain a nonce from the first.
- **Keys and RPC API keys stay out of errors.** An invalid private key is no longer
  echoed (ethers includes the value in its error); RPC URLs are reduced to scheme and
  host in errors, logs, and `health_check`.
- **Dependencies:** `@modelcontextprotocol/sdk` 1.32, better-auth peer `>=1.6.33`,
  vitest 3.2, and pinned overrides for vulnerable transitive packages. `pnpm audit
--prod` reports nothing high or critical.

### Changed

- Node.js 22 or later is required (18 and 20 are end-of-life). CI tests 22 and 24.
- The ethers provider is pinned to the configured network and cached per endpoint, so
  it no longer prints network-detection retries to stdout (which corrupts a stdio MCP
  stream) or creates a client per call.
- The BetterAuth plugin no longer calls the application's own database hooks from its
  signup hook; better-auth already runs them, so each ran twice.
- Releases publish through npm trusted publishing (OIDC) with provenance, behind a
  required human approval. No npm token is used.

### Added

**`@locktek/core`**

- HD wallet creation and recovery (BIP-39 mnemonic, BIP-44 derivation) for EVM
  (coin type 60) and Tron (coin type 195).
- Chain adapters for EVM and Tron behind a single `ChainAdapter` interface, with
  `registerChain()` so a new chain can be added without forking.
- `AesGcmEncryptionProvider`: AES-256-GCM with a 96-bit IV, scrypt key derivation,
  versioned ciphertexts, and multi-key rotation via `previousKeys`.
- Reliability primitives on every network call — `withTimeout`, retry with
  exponential backoff **and jitter**, and `EndpointPool` failover with per-endpoint
  cooldown.
- `NonceManager` and `InMemoryIdempotencyStore`, so a retried `signAndSend` with the
  same `idempotencyKey` resends one signed transaction rather than signing another.
- `PolicyEngine`: per-transaction and per-session spend caps, recipient allow/deny
  lists, and a read-only mode, evaluated before the facade signs a transfer. Caps are
  whole-unit numbers with no asset attached.
- `safeLogger` with field redaction, so private keys and mnemonics cannot reach a log
  sink through the SDK.

**`@locktek/mcp-server`**

- Twelve MCP tools covering wallet creation, balance reads, gas estimation, signing,
  simulation, and transfers.
- A `simulate_transaction` → `confirm_transaction` flow with single-use, expiring tokens
  that carry the exact simulated transfer, so a token cannot be redeemed for different
  parameters.
- Error sanitisation that redacts 64- and 128-character hex from every error path.

**`@locktek/better-auth`**

- A BetterAuth plugin that provisions a wallet on signup via a `databaseHooks` hook
  contributed through `init`.
- Idempotent provisioning backed by a unique `walletKey` (`${userId}:${chain}`)
  constraint, so concurrent signups cannot create two wallets for the same user.
- Persisted encrypted mnemonic alongside the encrypted private key, making a
  provisioned wallet recoverable in any standard wallet application.
- Endpoints to create a wallet, list wallets, and get a balance, each scoped to the
  session user, plus an opt-in export endpoint.

**`@locktek/cli`**

- `locktek init`, `chains`, `wallet create`, `wallet balance`, `send`, and `health`.
- `--json` mode that emits exactly one JSON document on stdout, including on failure.
- Private key resolution that prefers a non-echoing prompt over `--key`, and warns when
  a key is passed on the command line where it lands in shell history and `ps`.

### Fixed

Also found before the first publish, by packing the release artifacts and running them as a consumer would, before
the first publish:

- **`defaultChain` no longer defaults to a hardcoded chain.** It fell back to
  `ethereum-sepolia`, so _any_ configuration not containing that chain — including the
  documented mainnet setup — failed at construction with a confusing error about a
  `defaultChain` the caller never set. It is now the first configured chain, which also
  lets the testnet guard surface its own `MAINNET_BLOCKED` message.
- **`signAndSend(tx, key, undefined, options)` no longer discards the options.** Passing
  `undefined` for the optional chain silently dropped the `idempotencyKey` — the one
  argument whose absence causes a double broadcast.
- **`authClient.locktek.*` now exists.** The client plugin returned its actions
  un-namespaced and annotated its return type with the base interface, which erased
  every action type. The documented call site did not compile.
- **`exportWallet` verifies what it recovered.** Decryption succeeding only proves the
  ciphertext matches the key; a ciphertext stored against the wrong record decrypts just
  as cleanly. The endpoint now derives the address and refuses to return a key that does
  not match the record.
- **`locktek wallet create --json` reports that no key was returned.** The human-readable
  path warned that such a wallet is unusable; the JSON path dropped the warning, leaving
  a scripted caller to fund an address it could never spend from.
- **The example app is in the workspace.** It declared `workspace:*` dependencies while
  sitting outside `pnpm-workspace.yaml`, so `pnpm install` never installed it and nothing
  ever compiled it. It now type-checks and builds in CI.
- Base-unit rejection suggests `"1"` rather than `"1.000000000000000000"`.
- `@locktek/mcp-server` no longer claims the generic global binary name `mcp-server`.

### Design

- Amounts are whole units across every public surface. `"1"` means 1 ETH, never 1 wei.
  For 18-decimal assets, a value that looks like base units is rejected as ambiguous.
- Testnet mode: configuring a mainnet chain while `testnet: true` throws
  `MAINNET_BLOCKED` at construction.
- Writes never retry and never fail over between endpoints, because a broadcast that
  timed out may already have landed on chain.

[Unreleased]: https://github.com/locktek-xyz/locktek-plug/commits/main
