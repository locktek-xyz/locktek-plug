# Releasing

All four packages are versioned and published together. A strict semver tag
(`vX.Y.Z`) starts [`release.yml`](../.github/workflows/release.yml); a person approves
the publish; npm accepts it only from that workflow. **No npm token exists** — not as a
repository secret, not on anyone's machine.

```
tag vX.Y.Z ─► verify (read-only: install, build, typecheck, test, lint, pack)
          └─► publish  (environment `npm-publish`: waits for approval; OIDC; no project code runs)
          └─► GitHub release
```

## One-time setup

### GitHub (done when the repository was created)

- [x] Ruleset on `main`: no deletion, no force-push, linear history, signed commits,
      changes through pull requests, `CI` checks required.
- [x] Ruleset on `v*` tags: only repository admins may create, update, or delete them.
- [x] Environment `npm-publish`: required reviewer, and deployments allowed only from
      `v*` tags.
- [x] Private vulnerability reporting, secret scanning, and push protection enabled.

### npm (before the first release)

1. **Own the scope.** Create the npm organisation `locktek` (npmjs.com → Add
   organisation) from an account with 2FA, if it does not exist yet.
2. **First publish of each package.** npm configures trusted publishing per package, so
   each package must exist first. On a clean, trusted machine with 2FA:

   ```bash
   pnpm install --frozen-lockfile && pnpm build
   for p in core better-auth mcp-server cli; do
     (cd "packages/$p" && pnpm publish --access public --no-git-checks)
   done
   ```

   This one manual publish carries no provenance; every later release does.

3. **Add the trusted publisher** on each package (npmjs.com → package → Settings →
   Trusted publishing → GitHub Actions):

   | Field             | Value          |
   | ----------------- | -------------- |
   | Organisation/user | `locktek-xyz`  |
   | Repository        | `locktek-plug` |
   | Workflow filename | `release.yml`  |
   | Environment name  | `npm-publish`  |

   A new trusted-publisher configuration expires if no publish uses it within 48 hours.
   If that happens, recreate it.

4. **Disallow tokens** on each package: Settings → Publishing access → "Require
   two-factor authentication and disallow tokens". Trusted publishing keeps working,
   and a stolen token can no longer publish.

## Every release

1. **Confirm the tree is green.**

   ```bash
   pnpm install --frozen-lockfile
   pnpm build && pnpm typecheck && pnpm test:coverage && pnpm lint && pnpm format:check
   ```

2. **Confirm the packed artifact works, not just the source.** This catches a broken
   `files` list or an unresolved `workspace:*`, which no unit test can see.

   ```bash
   for p in core mcp-server better-auth cli; do
     pnpm -C "packages/$p" pack --pack-destination /tmp/lkpack
   done

   mkdir -p /tmp/consumer && cd /tmp/consumer
   npm init -y >/dev/null
   npm i /tmp/lkpack/*.tgz
   ./node_modules/.bin/locktek chains --json | head
   ```

3. **Bump every package to the same version** and move the `Unreleased` entries in
   `CHANGELOG.md` under a new heading. Merge that through a pull request.

4. **Tag the merged commit with a signed tag and push it.**

   ```bash
   git tag -s v0.1.0 -m "v0.1.0"
   git push origin v0.1.0
   ```

5. **Approve the deployment.** The `publish` job waits in the `npm-publish`
   environment. Check that the `verify` job ran on the commit you expect, then approve.
   Publishing goes in dependency order — `core` first — and skips any version already on
   the registry, so a partly failed release is safe to re-run.

6. **Check provenance** on npmjs.com: each version should show "Built and signed on
   GitHub Actions", linking to this repository and workflow run.

## If a release goes wrong

Do not unpublish. npm's unpublish window is narrow and removing a version breaks anyone
who already installed it. Publish a patch instead, and if the bad version is dangerous,
deprecate it:

```bash
npm deprecate @locktek/core@0.1.0 "Broken: use 0.1.1"
```

## Versioning

Semantic versioning, with one addition: **any change to signing, key derivation,
encryption, or the policy engine gets a minor bump at minimum, never a patch** — even
when it is backwards compatible. Consumers of a wallet SDK should never be surprised by
a change in that code arriving in a patch release.
