# Contributing to Locktek Plug

Thanks for taking the time. This guide should get you from a fresh clone to a passing
test run in a few minutes.

## Prerequisites

- **Node.js 22 or 24** — the versions CI runs. `.nvmrc` pins 22; run `nvm use`.
- **pnpm 9.15.0** — pinned via `packageManager`. Run `corepack enable` and it is
  handled for you.

## Setup

```bash
git clone https://github.com/locktek-xyz/locktek-plug.git
cd locktek-plug
pnpm install
pnpm build      # packages depend on each other's dist output, so build before testing
pnpm test
```

If `pnpm test` fails immediately with a `@rollup/rollup-*` load error, your install is
missing an optional native binary: `pnpm install --force` restores it.

## Working on one package

Turborepo handles the dependency order. To narrow the loop:

```bash
pnpm --filter @locktek/core test
pnpm --filter @locktek/core test:watch
pnpm --filter @locktek/core typecheck
pnpm --filter @locktek/core build

# Rebuild core after changing it, or dependents will typecheck against stale types.
pnpm --filter @locktek/core build && pnpm --filter @locktek/mcp-server test
```

## Before you push

The pre-commit hook runs lint, formatting, and typecheck. CI additionally runs the full
test suite with coverage:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test:coverage
```

To bypass the hook in an emergency: `git commit --no-verify`.

## Tests

**No test may touch the network.** Adapter tests inject a fake provider through
`providerFactory` (EVM) or `clientFactory` (Tron); see
`packages/core/src/__tests__/helpers/`. A test that reaches a public RPC is
non-deterministic and will eventually fail for reasons unrelated to your change.

Coverage thresholds are 70% per package and are enforced in CI.

### What a good test looks like here

Happy-path assertions describe a demo. This is wallet software, so the failure path is
the product:

- What happens on timeout?
- What happens when the call is retried — does the effect occur twice?
- What happens on a partial write, or a crash between two steps?
- What happens under concurrency?

If a change adds a utility, add the test that proves something **calls** it. Several of
this codebase's worst bugs were correct helpers that nothing was wired to.

## Code style

- Prettier and ESLint are authoritative; `pnpm format` fixes most things.
- Public APIs get explicit parameter and return types, plus TSDoc.
- Prefer immutable updates; avoid mutating inputs.
- Never swallow an error. Catch to handle, recover, or rethrow with context.
- Every external call needs a timeout, and a retry policy that is safe for that call.

## Commits and pull requests

Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

In the PR, say what changed, why, and how you verified it. Mention any behaviour change
explicitly — this SDK moves money, so a silent semantic change is worse than a loud
breaking one.

## Security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Releasing

Maintainers: see [docs/RELEASING.md](./docs/RELEASING.md).
