# WP-02 — non-destructive real-Pi evidence, five standalone files

**State:** pending

**Owner role:** implementation worker

**Dependencies:** WP-01 committed and PASS; same worktrees intact at
`12fd6686` / `3fe340b4`; no unresolved challenge. This WP is
**non-destructive only**: it runs exactly the five standalone files below and
makes no destructive process claim of any kind.

## Objective and observable outcome

Execute the five authorized standalone wallclock files against real Pi plus
the controlled Alfie worktree (R evidence), proving T06-AC1–AC5 and AC7 at
the integrated boundary with full isolation and truthful diagnostics — and
explicitly NOT covering the destructive zero-owned-child leg, which belongs
to WP-03 alone.

## The five standalone files (complete and closed set)

```text
apps/server/src/provider/piSubagentRealPiAcceptance.test.ts
apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts
apps/server/src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts
apps/server/src/provider/piSubagentRestartAcceptance.test.ts
apps/server/src/provider/piSubagentResumeAcceptance.test.ts
```

Each file runs in its own standalone `vitest run` process per the wallclock
discipline. No other wallclock file is authorized; running the complete
manifest or adding files is scope drift.

## Bounded read set

- WP-01 evidence and matrix.
- The five test files and `piSubagentRealPiAcceptanceHelpers.ts`.
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`.
- `apps/server/vitest.config.ts`, `apps/server/scripts/wallclock-tests.ts`.
- PLAN §6–§8; inherited Decisions 0031–0034 (destructive boundary — to know
  what NOT to claim).

## Exact allowed write set

```text
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-realpi-provenance.txt
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-realpi-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-canonical-identity-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-lifecycle-containment-realpi.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-restart-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-resume-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-nondestructive-disposition.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
```

## Prohibited changes

Same as WP-01, plus: no destructive operation, no PID enumeration or
signalling outside what the five files themselves perform inside their own
isolated environment, no manual-run execution or recipe record (WP-03's), no
quality gate (WP-04's), no review/Supervisor artifact.

## Exact commands (cwd and env explicit)

All from `/tmp/symphony-t06/apps/server` with
`ALFIE_REPO_DIR=/tmp/alfie-t06`. Runner per file:

- `piSubagentRealPiAcceptance.test.ts` → **Node producer** (mandatory,
  `node:sqlite`; preserve any Bun pre-collection failure as environment
  evidence in the same log first if Bun was attempted):
  ```bash
  cd /tmp/symphony-t06/apps/server
  set -o pipefail
  ALFIE_REPO_DIR=/tmp/alfie-t06 \
  node ../../node_modules/vitest/vitest.mjs run \
    --project wallclock --maxWorkers=1 --no-file-parallelism \
    src/provider/piSubagentRealPiAcceptance.test.ts \
    2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-realpi-acceptance.log
  status=${PIPESTATUS[0]}; exit "$status"
  ```
- The other four files → Bun producer, identical shape, each in its own
  process, tee-ing to its own log:
  `src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` →
  `WP-02-canonical-identity-acceptance.log`;
  `src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts` →
  `WP-02-lifecycle-containment-realpi.log`;
  `src/provider/piSubagentRestartAcceptance.test.ts` →
  `WP-02-restart-acceptance.log`;
  `src/provider/piSubagentResumeAcceptance.test.ts` →
  `WP-02-resume-acceptance.log`.

If any file's full-run composition triggers prerequisite-dependent unrelated
stages, stop as an evidence gap; do not broaden the file set without a
renewed contract.

## Evidence artifact fields

- `WP-02-realpi-provenance.txt`: both worktree SHAs re-verified, Alfie clean
  status, fixture hashes 5/5, extension and Pi SDK versions, zero-delta gate,
  protected WIP hash, per-leg exits.
- `WP-02-nondestructive-disposition.md`: per-leg commands, isolation
  description, totals/durations/exits, per-assertion mapping to
  T06-AC1–AC5/AC7, evidence class R, and the explicit statements: destructive
  leg not run here; WP-03 sole authority for M evidence; H (2026-08-20)
  supporting-only.

## Verification contract

- Provenance exact; five legs exit 0 standalone.
- Isolation asserted (roots/home/state/workspace/ports); no user
  live-instance mutation.
- Evidence-class separation preserved; no destructive claim anywhere.
- Zero-delta and WIP-hash gates pass.

## Commit boundary

```text
test(pi): record Ticket 06 non-destructive real-Pi evidence
```

Stage only the eight allowed WP-02 paths that actually exist.

## Escalation

- `blocked`: missing runtime/Node engine, provenance drift, environment
  failure after bounded retry of infrastructure (not behavioral) issues —
  record each retry.
- `challenge`: real-Pi contradicts deterministic truth; any leg fails; a
  destructive claim seems needed; source/test change seems needed.
