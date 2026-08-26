# WP-04 — exact Alfie provenance re-pin

**State:** pending

**Owner role:** implementation worker

**Repositories:** Alfie `/Users/anhpham99/alfie` first; Symphony second

**Baseline:** Alfie `aa6fa4a8540644d2509b10d6df854486ddc67d1d` / `0.15.0-alfie.4`; Symphony `93628e465866e9bf24610b4fca39b5c30f459221`. WP-01, WP-02, and WP-03 implementation SHAs are required inputs.

**Dependencies:** WP-03 must pass its focused routing tests. WP-04 is the only package/version/provenance step and must happen before WP-05 real-Pi execution.

**Authority:** Project Home cross-repo/provenance policy and Decision 0002 compatibility/provenance section. A dirty, mutable, globally discovered, post-verification, or unpinned extension is not acceptance evidence.

## Objective

Freeze the exact Alfie runtime produced by WP-01, record its version/commit/hash/clean-tree boundary in Symphony's controlled provenance manifest, and verify that the managed capability and canonical routing surface are the artifact actually loaded by later real-Pi evidence. If WP-01 required no Alfie package version change, preserve the existing version and still refresh the commit/hash manifest to the exact implementation SHA.

## Exact write set

Alfie:

- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/package.json` — only the package version field when WP-01's accepted runtime change requires a new version; no dependency/script changes.

Symphony:

- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
- `apps/server/src/provider/piSubagentRealExtension.test.ts` — only exact expected-version/hash/managed-capability assertions needed to verify the new pin.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` — only narrow provenance expectation updates if its controlled real extension gate shares the manifest and otherwise fails on the new pin.

No source implementation, migration, Project Home, decision, issue status, or unrelated lockfile is in this write set.

## Prohibited changes

- No source changes to Alfie's `index.ts`, `agent-manager.ts`, or any implementation file; WP-01 owns runtime changes.
- No Symphony production source, contracts, DB/schema/migrations, or capability fallback changes.
- No dependency refresh, unpinned package, generated artifact, symlink-only proof, global fallback, or post-verification mutation.
- No repin to an unrelated commit, dirty tree, lookalike directory, or version whose hashes were not captured from the exact loaded checkout.

## Implementation contract

1. Confirm WP-01 Alfie commit is reachable, the repository origin matches the expected upstream, the extension path is clean, and package name/version are known. Capture `git rev-parse HEAD`, `git status --porcelain`, origin URL, package identity/version, and SHA-256 hashes for every manifest-owned file.
2. If a version bump is required, modify only the package version in the Alfie package manifest, commit it as part of the WP-01 runtime deliverable or a clearly paired provenance step, and re-run the complete WP-01 focused suite. Do not change dependencies.
3. Update the Symphony provenance manifest with the exact Alfie commit, package version, repository URL, relative manifest path, and file hashes. Keep the manifest a cryptographic assertion, not a mutable discovery mechanism.
4. Run the existing provenance helper and tests against `ALFIE_REPO_DIR=/Users/anhpham99/alfie`. Verify production extension loading, not a synthetic tool or on-disk lookalike. Preserve tests that reject lookalikes, stripped/mixed versions, dirty trees, and hash mismatch.
5. Record the capability equivalent to `execution-identity-routing-v1` and canonical-routing files in the provenance/evidence report. A missing capability or changed hash invalidates the pin; it must not fall back to legacy while claiming managed acceptance.

## Tests and evidence contract

Prove both positive and negative provenance:

- exact origin, commit, package name/version, clean extension path, and hashes pass;
- loaded production extension advertises and responds to the canonical-routing capability;
- synthetic replacement Agent, realistic lookalike, dirty extension, wrong commit, wrong version, and hash mutation fail verification;
- a stale/mixed managed capability fails closed;
- no `agentId` is present in managed output/details from the loaded artifact.

The report must distinguish the Alfie source commit from the Symphony pin commit and record both working-tree states.

## Verification commands

```bash
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
git rev-parse HEAD
git status --short
git remote get-url origin
node -e 'const p=require("./package.json"); console.log(p.name, p.version)'
bun run test test/canonical-identity-routing.test.ts \
  test/identity.test.ts test/extension-capabilities.test.ts

cd /path/to/symphony
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentForegroundAcceptance.test.ts

git diff --check
git status --short
```

Use the actual Symphony checkout path for the worker command. Never use `bun test`; do not run fmt/lint/typecheck for this planning packet. Capture exit codes, exact commit/version/hash output, and provenance negative-case results.

## Commit and self-review

Create one paired provenance commit in the repository that owns each changed file, with the Symphony commit message:

```text
chore(pi): repin canonical identity extension provenance
```

If the Alfie package version must change, its version edit must be committed before the Symphony manifest is committed. Do not push.

Self-review:

- manifest hashes are calculated after all Alfie files are final and before loading;
- extension checkout is clean and exact, with no symlink/lookalike substitution;
- package version and commit agree with manifest and test output;
- only the exact listed provenance files changed in Symphony and only package version changed in Alfie;
- no implementation, migration, status/frontier, or unrelated lockfile drift exists.

Report full Alfie and Symphony SHAs, package version, origin, hash list, clean-tree output, and focused provenance results to WP-05.

## Escalation

Return `challenge` if WP-01 needs an unapproved Alfie file/dependency, if the runtime cannot be pinned immutably, if the manifest's existing hash model is insufficient, or if a dirty/mutable artifact is the only way to load the managed composition. Do not weaken provenance checks to make a test pass.
