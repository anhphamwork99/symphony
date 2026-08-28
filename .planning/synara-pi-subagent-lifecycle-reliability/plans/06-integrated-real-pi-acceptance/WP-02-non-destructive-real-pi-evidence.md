# WP-02 — non-destructive real-Pi evidence, five standalone files

**State:** renewed WP-02 attempt started exactly once and is **CHALLENGED**;
no current WP-02 PASS exists. Package C froze candidate
`ffd45bd867e94c9003415f5f2e937cc9c616e399`; renewed WP-01 passed 296/296.
The renewed integrated leg passed, the canonical-identity leg failed, and the
atomic attempt stopped before lifecycle-containment, restart, or resume. No
retry is authorized; source diagnosis is pending. WP-03 and WP-04 remain
blocked. This evidence transaction runs no producer.

Decision 0007 is aspect-scoped Authoritative for this rebaseline. Attempts 1–3
are supporting only. Attempt 3 ran its integrated leg exactly once and exited
1; its canonical/lifecycle legs did not run. The old WP-03/WP-04 authorizations
are unspent but non-transferable and not executable. Fresh owner authorization
is required after renewed WP-02 PASS and again after the newly authorized
WP-03 PASS. WP-05/WP-06 reservations are unused.

The detailed attempt-1/attempt-2 command records below are historical and
supporting only; the attempt-3 record is corrected by the erratum below. No
historical command or log is a current execution authorization.

**Attempt-3 erratum (2026-08-28):** line 1125 compared
`Set(dispatchBatchIds).size`; two acknowledged outboxes had two distinct
durable batch IDs. The test stopped before the later public follow-up
replay/count assertion. No duplicate follow-up count was observed. Preserve
exit 1 and the raw logs byte-for-byte.

**Package C candidate record:** base `12fd6686edc26a3fa0382e8bdeb83a1be8045539`
→ candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399` (sole parent, exact
two-file delta); integration merge `064b49f1d954b64343006da9240cdadf58bc0ff2`
(parents `8c9b8bcbb` and `ffd45bd867e`) is not a producer identity. Alfie is
pinned at `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`, with existing ext-local `node_modules`
ignored. Production coordinator/configuration are byte-identical to base;
protected WIP hash remains `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`
and unstaged. No current D/R PASS is claimed.

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

**Dependencies:** renewed WP-01 committed and PASS at candidate
`ffd45bd867e94c9003415f5f2e937cc9c616e399`; candidate worktree and Alfie pin
`3fe340b4` intact; no unresolved challenge. This WP is **non-destructive only**:
it runs exactly the five standalone files below and makes no destructive process
claim of any kind. Any behavioral producer must use `ffd45bd867e`, never merge
`064b49f1d954b64343006da9240cdadf58bc0ff2`.

## Objective and observable outcome

Execute the five authorized standalone wallclock files from the frozen
candidate worktree against real Pi plus the controlled Alfie worktree (R
evidence), proving T06-AC1–AC5 and AC7 at the integrated boundary with full
isolation and truthful diagnostics — and explicitly NOT covering the destructive
zero-owned-child leg, which belongs to WP-03 alone. The producer identity is
`ffd45bd867e94c9003415f5f2e937cc9c616e399`, never merge `064b49f1d`.

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

## Attempt 3 — process-HOME-isolated rerun authorization (historical; not Package C)

The commands and outcomes below are historical attempt-3 records at the old
candidate and are preserved only as supporting evidence. Package C ran no
producer and grants no retry. Any renewed five-file run must first use a fresh
worktree at candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399`; it must never
use merge `064b49f1d954b64343006da9240cdadf58bc0ff2` as its producer identity.

Owner authorization (current session, verbatim): **`Cho phép tất cả các
cổng`** (PLAN §7c item 1). Exactly one run of the three pending legs —
integrated, canonical-identity, lifecycle-containment — under the supported
Node runner with process-level temporary HOME isolation. This authorization
runs the producers only; it grants no source/test/harness/fixture/config/
manifest/lockfile/Alfie change and no retry. The two passing restart/resume
legs keep their attempt-1 canonical logs; they are NOT rerun.

**Executable producer pattern (mandatory, per producer; the exact shell
shape, not pseudocode):**

```bash
cd /tmp/symphony-t06/apps/server
set -o pipefail
T06_HOME=$(mktemp -d) || exit 125
trap 'rm -rf "$T06_HOME"' EXIT
env -u SYNARA_T17_MANUAL_TEARDOWN HOME="$T06_HOME" \
  ALFIE_REPO_DIR=/tmp/alfie-t06 \
  node ../../node_modules/vitest/vitest.mjs run \
    --project wallclock --maxWorkers=1 --no-file-parallelism \
    src/provider/piSubagentRealPiAcceptance.test.ts \
    2>&1 | tee /Users/anhpham99/symphony/.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/evidence/WP-02-realpi-acceptance.log
status=${PIPESTATUS[0]}; exit "$status"
```

Requirements bound into this pattern:

1. **Fresh temporary outer HOME per producer** — `mktemp -d` creates a new
   directory for EACH of the three producers; never share one across legs.
   The `EXIT` trap removes it afterward; the trap fires exactly once per
   producer process whether the leg passes or fails.
2. **HOME only for the Node/Vitest process** — `HOME="$T06_HOME"` is set in
   the producer's env only; no profile/rc file, shell state, worktree, or
   other file is modified; the harness-owned dirs and
   `ALFIE_REPO_DIR=/tmp/alfie-t06` remain explicit. The manual env stays
   unset (`env -u SYNARA_T17_MANUAL_TEARDOWN`). The temporary outer HOME
   removes user Pi settings (`~/.pi/agent/settings.json`, FFF frecency)
   from discovery, correcting attempt 2's sole failure class at
   piSubagentRealPiAcceptance.test.ts:1877.
3. **Legs and log mapping (canonical names, overwrite in place):**
   integrated → `WP-02-realpi-acceptance.log` (command above);
   canonical-identity →
   `src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` →
   `WP-02-canonical-identity-acceptance.log`; lifecycle-containment →
   `src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts` →
   `WP-02-lifecycle-containment-realpi.log`. Identical pattern, only the
   test path, tee target, and fresh `T06_HOME` differ per leg.
4. **Preserved logs (never overwritten/deleted):**
   `WP-02-attempt-01-realpi-acceptance.log`,
   `WP-02-attempt-01-canonical-identity-acceptance.log`,
   `WP-02-attempt-01-lifecycle-containment-realpi.log`,
   `WP-02-attempt-02-realpi-acceptance.log`, and the attempt-1
   restart/resume PASS logs. The attempt-01 canonical/lifecycle logs are
   historical environment/runner evidence and must NOT be interpreted as
   current results.
5. **No-concurrent-tool producer window** — after launching each producer,
   ONLY wait for it to exit; no other tool call until it exits (same
   discipline as §"Attempt 2" item 3; bounds the frecency-digest
   interference class).
6. **Exactly once, no retry** — the three legs run exactly once each under
   this authorization. Any failure preserves its log at the canonical name
   and stops into a challenge package; a further attempt requires a fresh
   owner decision.
7. **Stop gates (any one stops immediately, no retry):** outer-HOME
   cleanup failure (`mktemp -d` fails → exit 125 without running the
   producer, or the `EXIT` trap cannot remove the temporary HOME);
   worktree pin drift (`12fd6686` / `3fe340b4`); protected WIP hash drift
   from `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`
   or any protected file staged; non-empty zero-delta gate on the named Pi
   acceptance surface; provenance verifier failure; an unexpected skip in
   any leg; any nonzero producer exit.
8. **Post-attempt bookkeeping (before the WP-02 commit):** re-verify pin
   SHAs, Alfie clean status (node_modules-filtered), surface zero-delta,
   and protected WIP hash; record in the disposition that the fresh-HOME
   per-producer pattern and cleanup traps ran for all three legs; then
   commit under the existing WP-02 boundary
   (`test(pi): record Ticket 06 non-destructive real-Pi evidence`).

WP-03 (conditional on a five-legs-exit-0 WP-02 record), WP-04 (conditional
on WP-03 PASS), WP-05–WP-07 keep their own gates per PLAN §7c/§8.

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

- Historical attempt-1/attempt-2/attempt-3 artifacts remain immutable and
  supporting only. The renewed attempt is recorded by the two renewed logs,
  with integrated exit 0 and canonical-identity exit 1; it is NOT a five-leg
  behavioral PASS.
- Candidate and Alfie provenance remain exact; runner is Node v24.14.1 for
  both renewed legs; each leg used a fresh process-level temporary HOME and
  its cleanup was verified by post-run absence.
- No-concurrent-tool producer-window discipline was observed for the renewed
  legs. The manual env was unset; no destructive claim is made.
- Evidence-class separation is preserved; lifecycle-containment, restart, and
  resume were not run after the canonical failure, and no conclusion is
  inferred for them.
- Zero-delta and protected-WIP hash gates pass; protected WIP remains unstaged.

## Commit boundary

```text
test(pi): record renewed Ticket 06 canonical-identity challenge
```

Stage only these six paths, explicitly:

```text
PLAN.md
WP-02-non-destructive-real-pi-evidence.md
evidence/WP-02-renewed-realpi-provenance.txt
evidence/WP-02-renewed-realpi-acceptance.log
evidence/WP-02-renewed-canonical-identity-acceptance.log
evidence/WP-02-renewed-nondestructive-disposition.md
```

## Escalation

- `blocked`: missing runtime/Node engine, provenance drift, environment
  failure after bounded retry of infrastructure (not behavioral) issues —
  record each retry.
- `challenge`: real-Pi contradicts deterministic truth; any leg fails; a
  destructive claim seems needed; source/test change seems needed.
