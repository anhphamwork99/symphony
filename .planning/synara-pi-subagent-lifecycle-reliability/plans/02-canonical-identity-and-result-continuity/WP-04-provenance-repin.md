# WP-04 — Symphony provenance re-pin of exact Alfie commit

**State:** completed

**Owner role:** implementation worker

**Repository:** Symphony

**Baseline:** Alfie pre-WP-01 `aa6fa4a8540644d2509b10d6df854486ddc67d1d` / `0.15.0-alfie.4`; Symphony `93628e465866e9bf24610b4fca39b5c30f459221`. Completed against exact Alfie `73bc7744f8fbbd12206302de2df8230b29a49178` / `0.15.0-alfie.5` and integrated Symphony commits `29b41689c2ea74dfc45ca6c0c1e2deea05a8f964` and `14f3d2a4371a3ea4050b2e54fa026995fd81f706`.

**Required input:** `ALFIE_T02_COMMIT` is the full SHA of WP-01's single immutable Alfie commit, which must contain the runtime changes, tests, and the exact `0.15.0-alfie.5` package version.

**Dependencies:** WP-01 must produce and commit the exact Alfie runtime/version first, and WP-03 must pass its focused routing tests. WP-04 is Symphony-only, consumes `ALFIE_T02_COMMIT` and version read-only, and must happen before WP-05 real-Pi execution.

**Authority:** Project Home cross-repo/provenance policy and Decision 0002 compatibility/provenance section. A dirty, mutable, globally discovered, post-verification, or unpinned extension is not acceptance evidence.

## Objective

Freeze the exact Alfie runtime produced by WP-01, record its version/commit/hash/clean-tree boundary in Symphony's controlled provenance manifest, and verify that the managed capability and canonical routing surface are the artifact actually loaded by later real-Pi evidence. WP-04 performs only read-only verification of the exact `ALFIE_T02_COMMIT` and `0.15.0-alfie.5`; WP-01 owns the package version change and the Alfie commit.

## Exact write set

Symphony:

- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
- `apps/server/src/provider/piSubagentRealExtension.test.ts` — only exact expected-version/hash/managed-capability assertions needed to verify the new pin.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` — only narrow provenance expectation updates if its controlled real extension gate shares the manifest and otherwise fails on the new pin.

No Alfie file—including `package.json`—is in this write set. No source implementation, migration, Project Home, decision, issue status, or unrelated lockfile is in this write set.

## Prohibited changes

- No Alfie changes of any kind, including `package.json`; WP-01 owns the runtime and version commit.
- No Symphony production source, contracts, DB/schema/migrations, or capability fallback changes.
- No dependency refresh, unpinned package, generated artifact, symlink-only proof, global fallback, or post-verification mutation.
- No repin to an unrelated commit, dirty tree, lookalike directory, or version whose hashes were not captured from the exact loaded checkout.

## Implementation contract

1. Confirm `ALFIE_T02_COMMIT` is reachable, the Alfie repository origin matches the expected upstream, the extension path is clean, and the package identity/version are known. Capture `git rev-parse HEAD`, `git status --porcelain`, origin URL, package identity/version, and SHA-256 hashes for every manifest-owned file. Require the checked-out SHA to equal `ALFIE_T02_COMMIT` and the package version to equal exactly `0.15.0-alfie.5`.
2. Do not modify or commit anything in Alfie. If `ALFIE_T02_COMMIT` is missing, unreachable, dirty, or carries any version other than `0.15.0-alfie.5`, stop and return `challenge` rather than changing the package or selecting a replacement.
3. Update the Symphony provenance manifest with the exact `ALFIE_T02_COMMIT`, package version, repository URL, relative manifest path, and file hashes. Keep the manifest a cryptographic assertion, not a mutable discovery mechanism.
4. Run the existing provenance helper and tests against `ALFIE_REPO_DIR=/Users/anhpham99/alfie`. Verify production extension loading, not a synthetic tool or on-disk lookalike. Preserve tests that reject lookalikes, stripped/mixed versions, dirty trees, and hash mismatch.
5. Record the capability equivalent to `execution-identity-routing-v1` and canonical-routing files in the provenance/evidence report. A missing capability or changed hash invalidates the pin; it must not fall back to legacy while claiming managed acceptance.

## Completion record

WP-04 completed on Symphony main with the required exact provenance pin and a
bounded two-commit remediation:

1. `29b41689c2ea74dfc45ca6c0c1e2deea05a8f964` (`chore(pi): repin canonical identity extension provenance`)
   updated the controlled manifest and the narrow real-extension/foreground
   provenance expectations. It records Alfie origin
   `https://github.com/anhphamwork99/alfie.git`, exact commit
   `73bc7744f8fbbd12206302de2df8230b29a49178`, package
   `@alfie/pi-subagents@0.15.0-alfie.5`, and these SHA-256 manifest hashes:

   | Manifest-owned file | SHA-256 |
   | --- | --- |
   | `agent/extensions/pi-subagents/package.json` | `e10f46399233ecd2d9af4bd8ad369171a9234a88454e27b3ae96f2d7442f2289` |
   | `agent/extensions/pi-subagents/src/index.ts` | `4e33ef5ea36b249b41e63583ecb2c1cfa23bff5ecd73a05cedfc121eb3b00855` |
   | `agent/extensions/pi-subagents/src/agent-manager.ts` | `9c635818970b286d691fffaa0f01bb95ee0b6f9ee2a11a015036617494f29e1a` |
   | `agent/extensions/pi-subagents/src/agent-runner.ts` | `98a4c592b14bd7b66b42ea26aabf337d01b6146e618e2c2d67852449a755b1d2` |
   | `agent/extensions/pi-subagents/src/child-bash-supervisor.ts` | `ef44dc6d91ba400187967568b18483792eef3715c616b56aea24e3bb0c48f3c0` |

2. `14f3d2a4371a3ea4050b2e54fa026995fd81f706`
   (`test(pi): reconcile canonical capability probes`) was the necessary
   bounded follow-up after the exact repin exposed the active stripped-capability
   fixture and a structural capability snapshot assertion. It added
   `execution-identity-routing-v1` to the real mixed-version probe and changed
   the repeated capability observation from reference identity to structural
   equality. It changed no production source and did not weaken the stale,
   lookalike, dirty-tree, or hash-mutation rejection paths.

### Scope and clean-boundary evidence

The net WP-04 scope was exactly:

- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
- `apps/server/src/provider/piSubagentRealExtension.test.ts`
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts`

The Alfie checkout was read-only, exact, and origin-bound at the pin, with
`git status --porcelain` empty (clean tree); WP-04 made no Alfie changes. The managed capability recorded and exercised is
`execution-identity-routing-v1`. WP-04 focused evidence was: the controlled
Alfie suite ran **3 files / 22 tests, all passing**; the focused
`piSubagentRealExtension.test.ts` production-extension gate ran **1 test,
passing**; the focused `T22-AC6` foreground acceptance ran **1 test,
passing**; and there were **no WP-04-focused failures**. These are focused
provenance/pin results, not Ticket 02 final acceptance.

The initial single provenance commit therefore remains the canonical pin
commit, while the second commit is explicitly part of WP-04's completion
record rather than a scope expansion. WP-05 must consume both Symphony SHAs
and must repair any remaining active `.4`/old-commit/capability literal or
count fixture without changing the manifest or production source.

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
test -n "$ALFIE_T02_COMMIT"
test "$(git rev-parse HEAD)" = "$ALFIE_T02_COMMIT"
git rev-parse HEAD
git status --short
git remote get-url origin
node -e 'const p=require("./package.json"); if (p.version !== "0.15.0-alfie.5") process.exit(1); console.log(p.name, p.version)'
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

WP-04 was delivered in the two Symphony commits recorded above. Do not
create another WP-04 commit. Do not commit in Alfie; WP-01 owns the single
Alfie runtime/version commit. Do not push.

Self-review:

- manifest hashes are calculated after all Alfie files are final and before loading;
- extension checkout is clean and exact, with no symlink/lookalike substitution;
- package version and commit agree with manifest and test output;
- only the exact listed Symphony provenance files changed;
- the read-only Alfie checkout matches `ALFIE_T02_COMMIT` and exact version `0.15.0-alfie.5`;
- no implementation, migration, status/frontier, or unrelated lockfile drift exists.

Report full Alfie and Symphony SHAs, package version, origin, hash list, clean-tree output, and focused provenance results to WP-05.

## Escalation

Return `challenge` if `ALFIE_T02_COMMIT` is absent, unreachable, dirty, or does not contain exact version `0.15.0-alfie.5`; if WP-01 needs an unapproved Alfie file/dependency; if the runtime cannot be pinned immutably; if the manifest's existing hash model is insufficient; or if a dirty/mutable artifact is the only way to load the managed composition. WP-04 must never repair Alfie or weaken provenance checks to make a test pass.
