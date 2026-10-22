## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- Link the issue if there is one. If there isn't, explain the problem this solves. -->

Closes #

## How it was verified

<!-- Commands you ran, and what they printed. "Tests pass" is not verification; the
     output is. -->

```
pnpm build && pnpm typecheck && pnpm test:coverage && pnpm lint
```

## Checklist

- [ ] Tests cover the **failure path**, not only the happy path — retry, timeout, bad
      input, concurrent access. A test that only passes on the happy path is
      documentation, not a safety net.
- [ ] Coverage did not drop; new code is covered.
- [ ] No `console.log` or debug statements in `src/`.
- [ ] No secret, key, mnemonic, or `.env` value appears in the diff.
- [ ] Public API changes are reflected in the package README and `CHANGELOG.md`.
- [ ] `pnpm format` and `pnpm lint` are clean.

## Does this touch money or keys?

- [ ] This change can affect signing, broadcasting, key derivation, encryption, or the
      policy engine.

If checked, describe the blast radius if it is wrong, and what stops a retry from
double-spending:

<!-- Reviewers: for a checked box, review failure handling and idempotency before style. -->
