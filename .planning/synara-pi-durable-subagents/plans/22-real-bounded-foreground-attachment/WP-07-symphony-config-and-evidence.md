# WP-07 — Symphony production config wiring and acceptance-evidence hardening

**State:** completed (commits `e2239c6e`..`40016836`); accepted in Decision 0008

**Owner role:** worker

**Repository:** `/Users/anhpham99/symphony`

**Dependencies:** none for config/evidence work; the provenance re-pin requires
the WP-06 Alfie commit hash

## Task

Fix the reopened T22-AC5 defect (production config wiring), strengthen the
acceptance evidence for AC1/AC2/AC5/AC6 to the owner-approved seams, and re-pin
the Alfie provenance manifest once WP-06 has committed. Produce focused local
commits. Do not push.

## Context and authority

The post-acceptance review reopened Decision 0007 for two production defects.
This package owns the Symphony half:

- **T22-AC5:** `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS` is resolved only inside
  `ServerConfig.layerTest` (`apps/server/src/config.ts` — the `layerTest`
  builder sets `piSubagentForegroundWaitMs: resolvePiSubagentForegroundWaitMs(
process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS)`). The production
  `ServerConfigLive` builder in `apps/server/src/main.ts` never sets the field,
  so `PiAdapter`'s `serverConfig.piSubagentForegroundWaitMs ?? DEFAULT`
  fallback always wins in a real server. Decision 0006 §5 makes this env key
  "the production configuration contract".
- Evidence-strength gaps (same review): integrated timing assertions use
  `budget + 2000 ms` / `3500 ms` instead of Decision 0006 §5's
  `budget + 500 ms`; AC6's legacy leg only probes a fixture bridge; AC1's
  production test does not assert a successful inline completion; the report
  narrative cites a 15000 ms budget while the committed test uses 30000 ms.

Authoritative requirements:

- [Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
  §5 (exact config contract, `budget + 500 ms` envelope, "must exercise at
  least the default, one valid short budget, and invalid fallback, with exact
  elapsed times recorded" on the actual Pi boundary), §7 (authorized
  `main.ts` + config surfaces), §8 non-goals.
- [Issue 22](../../issues/22-real-bounded-foreground-attachment.md) T22-AC1,
  AC2, AC5, AC6 wording and the reopened review disposition.
- [Decision 0001](../../decisions/0001-testing-strategy-governance.md) —
  actual-Pi boundary preference and evidence standards.
- [Decision 0003](../../decisions/0003-t19-real-pi-capability-final-acceptance.md)
  and [0007](../../decisions/0007-t22-real-bounded-foreground-attachment-final-acceptance.md)
  — provenance baseline and the pin being remediated.

## Allowed write set (nothing else)

- `apps/server/src/main.ts` (config wiring only)
- `apps/server/src/main.test.ts` (wiring test; note this file currently has
  unrelated uncommitted Antigravity edits in the shared checkout — see
  Execution notes)
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts`
- `apps/server/src/provider/piSubagentRealExtension.test.ts`
- `.planning/synara-pi-durable-subagents/issues/22-real-bounded-foreground-attachment.md`
  (Implementation Report refresh after verification)
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`
  (re-pin after WP-06 lands)

Forbidden: `config.ts` resolver changes (already correct — do not duplicate
resolution there), contracts, PiAdapter production logic, persistence,
migrations, UI, Alfie source.

## Implementation contract

### 1. Production config wiring (T22-AC5)

In `ServerConfigLive` (`main.ts`), populate
`piSubagentForegroundWaitMs: resolvePiSubagentForegroundWaitMs(
process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS)` alongside the other
resolved fields in the `ServerConfigShape` literal. Import the resolver from
`./config.ts`. Do not clamp, log raw values, or add a second resolution site.

Add a wiring test (in `main.test.ts` or the acceptance file if main.test is
occupied by unrelated work): boot `ServerConfigLive` with the env var set
(valid value, invalid value, unset) and assert the resolved
`piSubagentForegroundWaitMs` (30000 → 30000; `abc`/`99`/`60001`/unset →
10000). The test must exercise `ServerConfigLive`, not `layerTest`.

### 2. Timing envelope (AC2, Decision 0006 §5)

Tighten the integrated detach assertions from `budget + 2000 ms` (acceptance)
and `3500 ms` (real-extension) toward `budget + 500 ms`. Keep a modest CI
allowance only if repeated local runs genuinely exceed the envelope — if you
widen beyond +500 ms, you must stop and return `challenge` instead (changing
the envelope is a Decision-0006 reopening matter, not a test edit).

### 3. AC6 legacy-session leg

Replace the fixture-only `probePiSubagentBridge(makeLegacyPiSubagentExtension())`
leg with a real adjacent legacy execution: a second real Pi session whose
extension directory resolves to the pinned-but-older extension (or a copy of
the pinned extension with `bounded-foreground-attachment` removed from
`PI_SUBAGENT_CAPABILITIES` — a stripped-capability copy is acceptable since
the removal is the mixed-version condition under test, and document exactly
what was stripped), executing an actual Agent call concurrently with a managed
detach. Assert: legacy result is a normal inline completion (unbounded wait,
no detach), no journal rows exist for the legacy execution, no binding was
attached, and the managed execution's timers/journal are unaffected.

### 4. AC1 inline-completion assertion

The AC1 test must assert the inline result represents a successful completion
(contains the child's output text / `completed` status), not merely that a
result object came back with identities. Use a task/model pairing that
completes deterministically within the budget.

### 5. Report refresh

After verification, update the Issue 22 Implementation Report: corrected
measured elapsed times, corrected budget values (no more 15000 vs 30000
mismatch), the production-wiring evidence, the tightened envelope numbers, the
real legacy-session evidence, and honest per-AC status. Do not mark the ticket
accepted — that belongs to the re-review/final-acceptance lifecycle.

### 6. Provenance re-pin (blocked on WP-06)

Once WP-06 has committed its Alfie hash: update
`piSubagentExtensionProvenance.json` `pinnedCommit` and recompute SHA-256 for
`package.json`, `src/index.ts`, `src/agent-manager.ts` from the clean Alfie
checkout at that commit. Run the real-extension suites against that exact
checkout.

## Test-first sequence

1. Failing wiring test for `ServerConfigLive` env resolution (valid/invalid/
   unset), then the one-line fix.
2. Tightened timing assertions (watch them pass; challenge if they cannot).
3. Real legacy-session AC6 leg (red first against the current test-only leg).
4. AC1 completion assertion.
5. Re-pin + full focused suites; report refresh from captured outputs.

## Verification

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/anhpham99/symphony/apps/server
bun run test src/main.test.ts src/config.test.ts
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentForegroundAcceptance.test.ts \
  src/provider/piSubagentForegroundReopen.test.ts \
  src/provider/piSubagentRealExtension.test.ts \
  src/provider/piSubagentForegroundLifecycle.test.ts
bun run test
```

Clean `apps/server/.pi/` artifacts before reporting status. Record exact
commands, elapsed times, exit codes, and test counts.

## Execution notes

- The shared checkout currently contains uncommitted Antigravity work in
  `main.ts`, `main.test.ts`, and `AntigravityAdapter*` from another session.
  Do not revert, stage, or commit those unrelated changes. If your `main.ts`
  edit collides with their hunks, isolate your change to the config-shape
  literal and commit only your paths via explicit `git add <paths>`. If that
  is impossible without entangling their work, return `challenge`.
- Commit rule: focused local commits, e.g.
  `fix(pi): wire foreground budget env into production server config (issue 22 remediation)` and
  `test(pi): harden issue 22 acceptance evidence (issue 22 remediation)` and
  `chore(pi): re-pin alfie provenance for issue 22 remediation`. No push.

## Challenge conditions

Stop and return `challenge` if: the +500 ms envelope cannot be met on repeated
real runs; a real legacy session cannot be constructed from the pinned
extension; the Antigravity working-tree conflict cannot be avoided; or the
re-pin cannot reference a clean WP-06 commit.
