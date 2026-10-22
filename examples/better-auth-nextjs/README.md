# BetterAuth + Locktek — Next.js Example

Minimal example showing `@locktek/better-auth` integration with Next.js 15 and BetterAuth.

Authenticated users can create HD wallets on Ethereum Sepolia and Base Sepolia, list their wallets, and check native token balances.

## Prerequisites

- Node.js 22+
- pnpm (for workspace resolution of `@locktek/*` packages)

## Setup

1. **Install dependencies** from the monorepo root:

   ```bash
   pnpm install
   ```

2. **Build the Locktek packages** (so workspace links resolve):

   ```bash
   pnpm --filter @locktek/core build
   pnpm --filter @locktek/better-auth build
   ```

3. **Copy the env template** and fill in values:

   ```bash
   cp .env.example .env
   ```

   Generate secrets:

   ```bash
   # BetterAuth secret
   openssl rand -hex 32

   # Locktek encryption key
   openssl rand -hex 32
   ```

4. **Start the dev server**:

   ```bash
   pnpm --filter better-auth-nextjs-example dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## What it does

1. **Sign Up / Sign In** — email + password auth powered by BetterAuth
2. **Create Wallet** — provisions an HD wallet on the default chain (Ethereum Sepolia), encrypts the private key at rest, and stores it via BetterAuth's database adapter
3. **Load Wallets** — fetches all wallets for the authenticated user
4. **Check Balance** — queries the native token balance for a wallet address

## Project structure

```
src/
  lib/
    auth.ts          — BetterAuth server config with locktekPlugin
    auth-client.ts   — BetterAuth client config with locktekClient
  app/
    layout.tsx       — Root layout
    page.tsx         — Main UI (auth form + wallet management)
    api/auth/
      [...all]/
        route.ts     — BetterAuth catch-all API route
```

## Production Notes

- **Database**: Use PostgreSQL or MySQL instead of SQLite. SQLite is single-writer and not suitable for concurrent production workloads.
- **BETTER_AUTH_SECRET**: Set a strong secret of at least 32 characters. Generate one with `openssl rand -hex 32`.
- **CSRF protection**: Configure BetterAuth's `advanced.csrfProtection` option to protect against cross-site request forgery attacks in production.
- **LOCKTEK_ENCRYPTION_KEY**: Must be kept secret and backed up securely. Losing it means losing access to all encrypted wallet private keys.

## Notes

- This is a **reference example**, not a production app.
- SQLite is used for simplicity. In production, use PostgreSQL or MySQL.
- The `@locktek/*` packages are resolved via pnpm workspace links.
- Wallet private keys are encrypted with AES-256-GCM before storage. The `LOCKTEK_ENCRYPTION_KEY` must be kept secret.
