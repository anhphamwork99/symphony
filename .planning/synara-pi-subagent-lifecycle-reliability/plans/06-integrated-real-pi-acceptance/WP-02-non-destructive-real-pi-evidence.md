# WP-02 — non-destructive real-Pi evidence, five standalone files

**State:** pending — RUN EXECUTED (attempt 1, 2026-08-28), STOPPED AT
CHALLENGE; attempt-1 logs preserved as environment/runner evidence (not
behavioral PASS). A corrected attempt (attempt 2, §"Attempt 2 — corrected
runner/environment authorization", exactly one) is authorized but NOT yet
executed; this correction package was committed before any rerun.

Attempt 1 (2026-08-28 12:23–12:54 local): all five authorized standalone
producers ran exactly once each against the retained pinned worktrees
(`12fd6686` / `3fe340b4`), with full isolation records and
`env -u SYNARA_T17_MANUAL_TEARDOWN` on every producer. Outcome: legs 4–5
(restart, resume) PASSED exit 0; legs 1–3 (realpi integrated,
canonical-identity F5, lifecycle-containment) FAILED exit 1. Attempt-1 raw
logs are durably preserved under explicit `WP-02-attempt-01-*` filenames and
are classified as **environment/runner evidence** (pristine detached Alfie
worktree lacked gitignored ext-local `node_modules`, so the pinned extension
could not load; canonical/lifecycle legs additionally hit a Bun-only Effect
`SocketCloseError` schema failure). Attempt-1 logs must never be overwritten
or deleted. Per WP-02 §Escalation and PLAN §11 no completion was claimed and
Ticket 06 did not advance.

Corrected attempt (authorized): exactly one re-run of ONLY the three failed
legs after bounded `npm ci` environment preparation in
`/tmp/alfie-t06/agent/extensions/pi-subagents`, all three legs under the
supported Node v24.14.1 runner, within a no-concurrent-tool producer window
(details in §"Attempt 2" below). Final passing evidence retains the original
canonical WP-02 log names. Current attempt-1 evidence:
`evidence/WP-02-attempt-01-realpi-acceptance.log`,
`evidence/WP-02-attempt-01-canonical-identity-acceptance.log`,
`evidence/WP-02-attempt-01-lifecycle-containment-realpi.log` (failed legs),
`evidence/WP-02-restart-acceptance.log` and
`evidence/WP-02-resume-acceptance.log` (unchanged passing legs, reusable),
`evidence/WP-02-realpi-provenance.txt`, and
`evidence/WP-02-nondestructive-disposition.md` (attempt-1 classification and
the source-grounded correction).

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
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-attempt-01-realpi-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-attempt-01-canonical-identity-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-attempt-01-lifecycle-containment-realpi.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-canonical-identity-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-lifecycle-containment-realpi.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-restart-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-resume-acceptance.log
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-nondestructive-disposition.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
```

## Attempt 2 — corrected runner/environment authorization (exactly one)

The owner-resolved, source-grounded correction for the three failed legs is
**bounded environment preparation, not an Alfie source/pin change**:

1. **`npm ci` (exact command, cwd explicit)** — install the extension's
   own lockfile-pinned dependencies into the gitignored ext-local
   `node_modules` of the pristine detached Alfie worktree. The extension
   package ships `package-lock.json` and declares its entry via
   `"pi": {"extensions": ["./src/index.ts"]}`; the provenance verifier
   (`piSubagentRealPiAcceptanceHelpers.ts:561–580`) explicitly filters
   `node_modules` out of `git status --porcelain` output, so this step
   preserves every tracked hash, the fixture's 5/5 hashes, the pinned
   commits, and clean-status invariants:

   ```bash
   cd /tmp/alfie-t06/agent/extensions/pi-subagents && npm ci
   ```

   Post-`npm ci` zero-tracked-delta proof (must show only gitignored
   `node_modules/`; no tracked path may appear):
   `git -C /tmp/alfie-t06 status --porcelain` with any `node_modules` lines
   filtered — result must be EMPTY, and HEAD must still be `3fe340b401ca86bcbe8b55abd4de107e1d93482e`.
   If the proof fails, STOP: record and return the corrected-attempt package
   as failed environment preparation; do not retry npm ci a second time.
2. **Node runner for all three corrected legs** — attempt 1's canonical and
   lifecycle legs failed under Bun 1.3.12 with unhandled Effect
   `SocketCloseError` schema exceptions from the harness dispose path
   (`code` undefined under Bun's WebSocket close path). Use the supported
   Node v24.14.1 (satisfies root engines `node ^24.13.1` and
   `apps/server` `>=24.10`) for ALL THREE rerun legs, identical shape to
   §"Exact commands" but with `node ../../node_modules/vitest/vitest.mjs`
   as the runner for canonical-identity and lifecycle-containment too:

   ```bash
   cd /tmp/symphony-t06/apps/server
   set -o pipefail
   ALFIE_REPO_DIR=/tmp/alfie-t06 node ../../node_modules/vitest/vitest.mjs run \
     --project wallclock --maxWorkers=1 --no-file-parallelism \
     src/provider/piSubagentRealPiAcceptance.test.ts \
     2>&1 | tee <evidence>/WP-02-realpi-acceptance.log
   status=${PIPESTATUS[0]}; exit "$status"
   ```

   with `<file>`/`<log>` per the mapping above
   (canonical → `WP-02-canonical-identity-acceptance.log`, lifecycle →
   `WP-02-lifecycle-containment-realpi.log`), each leg in its own standalone
   serial process. The two already-passing legs (restart, resume) are NOT
   rerun; their attempt-1 PASS logs remain the final evidence unchanged.
3. **No-concurrent-tool producer window (mandatory)** — the attempt-1
   integrated leg's user-Pi-home digest failure was bounded to
   `~/.pi/agent/fff/frecency/data.mdb` (the Pi FFF frecency index —
   concurrent agent-tool state outside the harness). The corrected attempt's
   producer window must therefore run with NO concurrent FFF/semantic/search
   or other agent-tool activity by the executing worker: after launching each
   of the three commands above, ONLY wait for that command to exit; do not
   inspect, search, or run any other tool until it has exited. Record in the
   disposition that this window discipline was observed.
4. **Artifact naming (exact)** — attempt-1 raw logs of the three failed legs
   are durably preserved as `WP-02-attempt-01-realpi-acceptance.log`,
   `WP-02-attempt-01-canonical-identity-acceptance.log`, and
   `WP-02-attempt-01-lifecycle-containment-realpi.log` (never overwritten,
   never deleted). The corrected attempt's logs OVERWRITE the current
   originals at the canonical WP-02 names (`WP-02-realpi-acceptance.log`,
   `WP-02-canonical-identity-acceptance.log`,
   `WP-02-lifecycle-containment-realpi.log`) and become the final WP-02
   evidence if passing. The two passing restart/resume logs keep their
   canonical names unchanged throughout.
5. **Exactly one corrected attempt** — the three legs above run exactly once
   each. No retry of a corrected leg, no second `npm ci`, no further
   environment change. If any corrected leg fails: preserve its log at the
   canonical name, stop, and return a challenge package with the failing row
   — a further attempt requires a fresh owner decision.
6. **Stop gates (any one stops the corrected attempt immediately):**
   post-`npm ci` tracked-delta proof non-empty; any worktree pin drift
   (`12fd6686` / `3fe340b4`); protected WIP hash differs from
   `ab8f8f54…eaa8` or any protected file becomes staged; zero-delta gate on
   the named Pi acceptance surface non-empty; provenance verifier failure at
   any stage; an unexpected skip in any leg.

## Prohibited changes

Same as WP-01, plus: no destructive operation, no PID enumeration or
signalling outside what the five files themselves perform inside their own
isolated environment, no manual-run execution or recipe record (WP-03's), no
quality gate (WP-04's), no review/Supervisor artifact. Bounded `npm ci` per
§"Attempt 2" writes only gitignored ext-local `node_modules` inside the
`/tmp/alfie-t06` worktree; it does not authorize any tracked Alfie change,
any other install target, or any source/test/harness/fixture/config/manifest/
lockfile change anywhere.

## Exact commands (cwd and env explicit)

Attempt 1 executed these as written (attempt-1 runner column: leg 1 Node,
legs 2–5 Bun; see §"Attempt 2" for the corrected-attempt runner override).
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

- Provenance exact; five legs exit 0 standalone. Attempt-1 status: 2/5 exit 0
  (restart, resume); the corrected attempt (§"Attempt 2") must bring the
  three failed legs to exit 0 under the canonical names, with attempt-1
  failed-leg logs retained as `WP-02-attempt-01-*` environment/runner
  evidence. Attempt-1 as a whole is environment/runner evidence, NOT a
  behavioral PASS.
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
