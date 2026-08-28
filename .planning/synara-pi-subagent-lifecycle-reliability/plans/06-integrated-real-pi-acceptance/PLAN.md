# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** persisted and executing — WP-01 evidence committed
(9208e1728); WP-02 executed twice (attempt 1 and the authorized corrected
attempt 2, both 2026-08-28), stopped at challenge after each (see WP-02,
disposition §4c, provenance §11, and §7b below). The attempt-2 authorization
is SPENT. On 2026-08-28 the owner granted, in the current session and
verbatim (`Cho phép tất cả các cổng`), a fresh decision authorizing the
three remaining gates in a fixed conditional sequence — WP-02 attempt 3
(authorized, NOT yet executed), then conditionally WP-03, then
conditionally WP-04 (§7c). No Ticket 06 completion, review, or acceptance
exists.

**Project Home:** [`../../PROJECT.md`](../../PROJECT.md)

**Issue:** [`../../issues/06-integrated-real-pi-acceptance.md`](../../issues/06-integrated-real-pi-acceptance.md)

**Planning baseline:** actual Symphony HEAD at plan-commit time — `4bf368a492e42382c3e064ae7a5be5a6624bdbf0`

**Frozen behavioral candidate:** Symphony `12fd6686edc26a3fa0382e8bdeb83a1be8045539`
(`docs(planning): accept Ticket 05 lifecycle recovery`). Every behavioral
producer in this plan runs in an isolated Symphony worktree checked out at
this commit. The plan must produce **zero committed delta** on the named Pi
acceptance surface from `12fd6686` through the evidence package:

```text
apps/server/src/provider/**
apps/server/src/persistence/**
apps/server/src/orchestration/**
apps/server/scripts/wallclock-tests.ts
apps/server/vitest.config.ts
packages/contracts/src/piSubagents.ts
```

**Controlled provider boundary:** Alfie `3fe340b401ca86bcbe8b55abd4de107e1d93482e`
(`@alfie/pi-subagents@0.15.0-alfie.6`) via an isolated **detached Alfie
worktree** at that commit, selected with `ALFIE_REPO_DIR`. The user Alfie
checkout at `c6a27714b2e42351133aa5d8d35108e526f4ce13` remains untouched.

**Protected owner WIP (must remain unstaged, aggregate diff hash exactly
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`):**

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
```

**Date:** 2026-08-28

## 1. Objective and planning conclusion

Prove the complete project candidate — Tickets 01–05 accepted seams — against
the pinned real-Pi composition with an evidence-only integrated acceptance,
then close the project through exactly one integrated review and exactly one
Supervisor final acceptance.

Planning conclusion: **evidence-only, no source change**. The five accepted
tickets already supply identity, lifecycle, failure, recovery, and control
evidence at their own boundaries; Ticket 06 integrates them at the pinned
boundary. No source/test/harness/fixture/config/migration/manifest/lockfile or
Alfie change is authorized anywhere in this plan. Any perceived need for one
stops at §11's challenge gate.

## 2. Binding authorities and invariants

This plan preserves:

- Local [Decision 0001](../../decisions/0001-project-charter-and-inherited-authority.md)
  (charter and inherited authority), [Decision 0002](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md)
  (`executionId` public identity, bounded authorized result read),
  [Decision 0006](../../decisions/0006-live-lifecycle-containment-linearization-contract.md)
  (exact-tuple live containment; DG-4 owner boundary closed).
- Inherited durable-subagents Decisions 0031–0034 — the authoritative
  destructive boundary: three-leg AC6 evidence split, owner-approved testing
  seam, no automated destructive real-Pi claim, and the recorded isolated
  manual operator run of 2026-08-20 accepted for its sole purpose only.
- Inherited Decision 0001 testing governance: highest stable boundary, paired
  success/failure evidence, wall-clock standalone discipline, no relabeling of
  fixture, real-Pi, or manual evidence classes.
- Project Home review governance: one integrated feature-level review, then
  exactly one Supervisor final acceptance for the full project.

Immutable constraints:

1. `executionId` public identity; `attemptId`/generation fencing;
   proof-before-fence; journal-first terminal truth.
2. `cleanup_uncertain`, `survivors`, `owner_unproven` remain non-terminal.
3. No automatic replay or Resume; no provider bootstrap; no crash guardian,
   durable owner receipt, or orphan-terminal exception.
4. No PID guessing, process-name kill, or Symphony PID kill authority. The
   manual destructive run operates only through the accepted operator recipe
   within its own isolated environment.
5. No push, release, deploy, or unrelated-project work.
6. No change of any kind on the named Pi acceptance surface from `12fd6686`
   through the evidence package.

## 3. Evidence classes

All Ticket 06 evidence is labeled with exactly one class. Classes are never
merged, substituted, or relabeled.

| Class | Name | Meaning | Producers |
|---|---|---|---|
| **P** | Planning/provenance | Router state, frozen candidate, worktree/pin provenance, zero-delta proofs | `git` records in WP-01+ workspace-state artifacts |
| **D** | Deterministic | Serialized deterministic unit/contracts suites at the frozen candidate in the isolated Symphony worktree | WP-01 vitest producers |
| **R** | Controlled real-Pi (non-destructive) | Real Pi + pinned controlled Alfie worktree, isolated roots/home/state/workspace/ports, no destructive process claim | WP-02 five standalone wallclock files |
| **M** | Manual destructive (operator) | The exactly-one owner-authorized isolated manual real-Pi destructive run; sole source of the zero-owned-child claim for AC6 | WP-03 operator recipe record |
| **Q** | Quality gate | Owner-authorized `bun fmt` / `bun lint` / `bun typecheck` final gate | WP-04 |
| **H** | Historical (supporting-only) | The inherited 2026-08-20 operator manual run and prior-ticket accepted evidence; context only, never Ticket 06 acceptance evidence by itself | Decision 0034 §Evidence; prior ticket reports |
| **A** | Acceptance artifacts | The integrated review verdict and the persisted Supervisor final-acceptance decision | WP-05, WP-06 |

### AC1–AC8 mapping (T06-AC1–AC8 from the issue)

| Criterion | Summary | Primary evidence classes | Owning WP |
|---|---|---|---|
| T06-AC1 | Pinned composition starts with exact provenance and full isolation | P, R | WP-01, WP-02 |
| T06-AC2 | Public `executionId` usable through detached output, durable read, terminal, reconnect, control | D, R | WP-01, WP-02 |
| T06-AC3 | Real lifecycle: progress, terminal-before-cleanup, cancellation, watchdog handoff, truthful diagnostics | D, R | WP-01, WP-02 |
| T06-AC4 | Restart/reconnect restores terminal/live-owner/orphan truth; no auto replay; explicit Resume proven or truthfully denied | D, R | WP-01, WP-02 |
| T06-AC5 | Stale attempt/generation and duplicate delivery/control fenced and bounded | D, R | WP-01, WP-02 |
| T06-AC6 | Destructive cleanup via inherited three-leg split | D, R, M (H supporting-only) | WP-01, WP-02, WP-03 |
| T06-AC7 | Every stage failure reports stage and stable diagnostic; mock-only success impossible | D, R | WP-01, WP-02 |
| T06-AC8 | Exactly one integrated review and exactly one Supervisor final acceptance recorded | A, Q | WP-04–WP-06 |

## 4. Plan-persistence transaction and routing

This transaction creates the plan files in this directory and changes only:

- `../../issues/06-integrated-real-pi-acceptance.md`
  - `blocked` → `ready-for-agent`;
  - remove the stale `Implementation: forbidden while blocked` line;
  - discharge the Tickets 01–05 dependency;
  - add this plan link and the evidence-only execution authorization;
  - preserve the Implementation Report placeholder and the Unlock gate.
- `../../PROJECT.md`
  - lifecycle stays `active`;
  - Ticket 06 remains the **sole frontier**, now `ready-for-agent`;
  - state that G-M (integrated project review) and G-Q (Supervisor final
    acceptance) are pending and that exactly one review and exactly one
    Supervisor consultation remain reserved;
  - state explicitly that no Ticket 06 evidence, review, or acceptance exists.

Exact plan-persistence write set (the only paths this transaction commits):

```text
.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md
.planning/synara-pi-subagent-lifecycle-reliability/issues/06-integrated-real-pi-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/PLAN.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-01-freeze-and-deterministic-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-03-manual-destructive-run.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-04-quality-gate-and-implementation-report.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-05-integrated-review.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-06-supervisor-final-acceptance.md
.planning/synara-pi-subagent-lifecycle-reliability/plans/06-integrated-real-pi-acceptance/WP-07-closure-and-routing.md
```

No source implementation is authorized in the plan-persistence transaction.

## 5. Serial dependency graph and Work Packages

```text
plan persistence + Ticket 06 ready-for-agent
  └──> WP-01 freeze at 12fd6686 + 19-file deterministic evidence (D)
        └──> WP-02 non-destructive real-Pi, five standalone files (R)
              └──> WP-03 exactly-one manual destructive run (M, owner-authorized)
                    └──> WP-04 quality gate + complete Implementation Report (Q)
                          └──> WP-05 exactly-one integrated review (A)
                                └──> WP-06 exactly-one Supervisor final acceptance (A)
                                      └──> WP-07 closure and routing
```

The graph is strictly serial. No package is parallel-safe. WP-02 consumes
WP-01's frozen worktree and isolation records; WP-03 requires WP-02's
non-destructive legs to have passed first; WP-04 consumes D+R+M evidence;
WP-05 reviews the complete evidence package; WP-06 issues the one Supervisor
decision from WP-05; WP-07 closes from all of the above.

| Package | Primary output | New production write authority | Gate |
|---|---|---|---|
| [WP-01](WP-01-freeze-and-deterministic-evidence.md) | frozen worktree at `12fd6686`, 19-file deterministic AC/diagnostic matrix | none | — |
| [WP-02](WP-02-non-destructive-real-pi-evidence.md) | controlled provenance + five standalone real-Pi legs, no destructive claim | none | — |
| [WP-03](WP-03-manual-destructive-run.md) | exactly one recorded operator destructive run; AC6 zero-owned-child leg | none | owner authorization required; no retry |
| [WP-04](WP-04-quality-gate-and-implementation-report.md) | fmt/lint/typecheck gate + complete Implementation Report | none | owner authorization required |
| [WP-05](WP-05-integrated-review.md) | one integrated feature-level review verdict | none | after WP-04 |
| [WP-06](WP-06-supervisor-final-acceptance.md) | one persisted Supervisor final-acceptance decision | none | after WP-05 |
| [WP-07](WP-07-closure-and-routing.md) | Ticket 06 + project closure, router final state | none | after WP-06 |

## 6. Isolated worktree lifecycle (Symphony and Alfie)

Behavioral producers never run in the user's main Symphony checkout or the
user Alfie checkout.

1. **Create** a fresh detached Symphony worktree outside the repository:
   `git worktree add --detach <tmp>/symphony-t06 12fd6686edc26a3fa0382e8bdeb83a1be8045539`.
2. **Install** dependencies inside it (`bun install` at the worktree root).
   Record lockfile-pinned resolution; the worktree must stay at exactly
   `12fd6686` (detached HEAD) for the whole lifecycle.
3. **Create** a fresh detached Alfie worktree:
   `git -C /Users/anhpham99/alfie worktree add --detach <tmp>/alfie-t06 3fe340b401ca86bcbe8b55abd4de107e1d93482e`.
   Verify clean status and provenance hashes against
   `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`.
4. **Run** all D and R producers from the Symphony worktree with
   `ALFIE_REPO_DIR=<tmp>/alfie-t06`.
5. **Verify after every producer** that the Symphony worktree's Pi acceptance
   surface is still exactly at `12fd6686` (zero working-tree delta on the
   named surface) and the Alfie worktree is clean.
6. **Freeze evidence** into this plan's `evidence/` directory in the main
   checkout (the only place commits happen).
7. **Remove** both worktrees with `git worktree remove` only after WP-03 (or
   at closure if the owner defers WP-03). Never `git worktree remove --force`
   over uncommitted evidence.

The main checkout keeps only planning/evidence writes; the three protected
owner WIP files stay modified-unstaged with hash `ab8f8f54…` at every record.

## 7. Runner and verification policy

- Never `bun test` and never `bun run test <paths>` for focused evidence (the
  package runner expands to the full project). Use repository-pinned Vitest
  directly:
  `bun run ../../node_modules/vitest/vitest.mjs run --project <project> --maxWorkers=1 --no-file-parallelism <file>`.
- Unit evidence: `--project unit`, one serialized invocation, from
  `<worktree>/apps/server`.
- Wallclock evidence: each file in its own standalone process with
  `--project wallclock`, exactly as the manifest in
  `apps/server/scripts/wallclock-tests.ts` requires.
- `piSubagentRealPiAcceptance.test.ts` imports `node:sqlite`. The supported
  Node engine (>=24.10) resolves it; Bun 1.3.12 does not. This file's
  behavioral producer must use
  `node ../../node_modules/vitest/vitest.mjs …`. A Bun pre-collection failure
  (0 tests) is environment evidence — preserve it in the same log, never
  relabel it as a behavior result.
- Real-Pi isolation: exact controlled Alfie provenance, isolated
  roots/home/state/workspace/agent directories, deterministic loopback model
  endpoint, non-default ports, no user live-instance mutation.
- Every criterion needs positive plus material failure/diagnostic evidence.
  No AC may pass from inherited totals (H), source comments, compile success,
  or an unexecuted command.

## 7a. Attempt-1 challenge and corrected-attempt authorization (2026-08-28)

WP-02 attempt 1 stopped at the §11 challenge gate: legs 4–5 (restart,
resume) PASSED exit 0; legs 1–3 (realpi integrated, canonical-identity F5,
lifecycle-containment) FAILED exit 1. Failure evidence is durably preserved
as `WP-02-attempt-01-*` logs in the plan's `evidence/` directory and is
classified as **environment/runner evidence, not behavioral PASS**. The
challenge package (disposition §4, provenance §6) records failing rows,
observed-vs-required, and the minimum gap. Source-grounded root cause: the
pristine detached Alfie worktree `/tmp/alfie-t06` at the exact pin
`3fe340b4` lacks the gitignored extension-local `node_modules` required by
the extension entry (`"pi": {"extensions": ["./src/index.ts"]}`), so the
pinned extension never loads in real sessions. Attempt 1's canonical and
lifecycle legs additionally failed on Bun-only Effect `SocketCloseError`
schema exceptions (`code` undefined) from the harness dispose path, and the
integrated leg's user-Pi-home digest was perturbed by concurrent Pi-FFF
frecency state (`~/.pi/agent/fff/frecency/data.mdb`) outside the harness.

Per the challenge decision, ONE corrected attempt of WP-02 is authorized,
bound to WP-02 §"Attempt 2" exactly:

- **Environment preparation (not an Alfie source/pin change):** exactly one
  `cd /tmp/alfie-t06/agent/extensions/pi-subagents && npm ci` before any
  rerun. This writes only the gitignored ext-local `node_modules` from the
  extension's own shipped `package-lock.json`; the provenance verifier
  (`piSubagentRealPiAcceptanceHelpers.ts:561–580`) explicitly ignores
  `node_modules` in `git status`, so pins, fixture hashes, and
  clean-status invariants are preserved. Zero-tracked-delta proof required
  after the install (WP-02 §"Attempt 2" item 1). This does not amend the
  §1/§11 no-Alfie-change constraint: no tracked Alfie byte changes.
- **Runner correction:** all three rerun legs use the supported Node
  v24.14.1 (`node ../../node_modules/vitest/vitest.mjs`), consistent with
  the root `engines.node ^24.13.1`, `apps/server` `>=24.10`, and the §7
  Node-for-`node:sqlite` policy; Bun's WebSocket close path is implicated in
  attempt-1's `SocketCloseError` dispose failures.
- **Producer-window rule:** the three rerun commands run with no concurrent
  FFF/semantic/search or other agent-tool activity by the executing worker —
  after launching each command, only wait for it; no other tool call until
  it exits (bounds the attempt-1 frecency-digest interference class).
- **Scope and naming:** only the three failed legs rerun; the passing
  restart/resume attempt-1 logs remain unchanged and reusable as final
  evidence; corrected-attempt logs take the original canonical WP-02 log
  names; attempt-1 failed-leg logs stay under their `WP-02-attempt-01-*`
  names, never overwritten.
- **Exactly once, with stop gates:** no retry of a corrected leg, no second
  `npm ci`; any listed stop-gate trigger (WP-02 §"Attempt 2" item 6) stops
  immediately into a fresh challenge package. WP-03–WP-07 remain gated
  behind a five-legs-exit-0 WP-02 record.

## 7b. Corrected-attempt (attempt 2) outcome and fresh owner-decision gate (2026-08-28)

The §7a authorization was consumed exactly once, in full conformance with its
stop gates. Outcome (details: disposition §4c, provenance §11):

- **Environment preparation PASS:** the exactly-one `npm ci` at
  `/tmp/alfie-t06/agent/extensions/pi-subagents` succeeded with zero tracked
  delta (gitignored `node_modules` only; HEAD still `3fe340b4`; invariants
  preserved).
- **Integrated corrected leg (Node):** `Tests  1 failed | 8 passed | 1
  skipped (10)`, exit 1, Duration 62.26s. ALL managed/non-manual behavioral
  stages now pass — the attempt-1 extension-load and Bun-runner failure
  classes are resolved by the npm ci + Node correction. The manual destructive
  test skipped exactly by design.
- **Sole failure — teardown user-Pi-home digest**
  (piSubagentRealPiAcceptance.test.ts:1877). Exact root cause: user
  `~/.pi/agent/settings.json` enables `npm:@ff-labs/pi-fff`; the harness
  snapshots `os.homedir()` before setting only `PI_CODING_AGENT_DIR` and
  `PI_HOME` (piSubagentRealPiAcceptanceHelpers.ts:1541–1553), and the digest
  walk is `os.homedir()/.pi`-anchored (helpers :488–549), so the outer Vitest
  process still discovered user Pi settings and Pi FFF wrote
  `~/.pi/agent/fff/frecency/data.mdb` (mtime = producer start) outside every
  harness-owned dir. External tool state — NOT a harness write-path
  violation; no destructive claim; `envWasRestored()` true.
- **Evidence:** corrected-attempt log preserved byte-identical as
  `evidence/WP-02-attempt-02-realpi-acceptance.log` (SHA-256
  `cf6db25f045030cb7be2949322820d283c9a32b5bf7459c44051b9ee12a9d1b0`),
  classified environment/isolation evidence — NOT a behavioral PASS.
- **Scope not covered:** the canonical-identity and lifecycle-containment
  corrected legs did NOT run in attempt 2 and remain pending.
- **GATE:** per WP-02 §"Attempt 2" item 5 and §11, a further attempt requires
  a fresh owner decision. The identified next correction is process-level
  HOME isolation for the Vitest process (a fresh temporary outer HOME,
  removing user Pi settings from discovery while `ALFIE_REPO_DIR` and
  harness-owned dirs remain explicit), covering the integrated leg plus the
  two pending corrected legs under Node. WP-03–WP-07 remain gated behind a
  five-legs-exit-0 WP-02 record. This section records the outcome only; it
  grants no authorization.

## 7c. Owner authorization for the remaining Ticket 06 gates (2026-08-28, current session)

The owner replied in the current session, verbatim: **`Cho phép tất cả các
cổng`** — authorizing all three previously enumerated gates. This section
records the authorization only; it executes nothing and claims no evidence.

1. **WP-02 attempt 3 (non-destructive, R) — authorized exactly once, no
   condition.** Exactly one run of the three pending legs (integrated,
   canonical-identity, lifecycle-containment) under the supported Node
   runner with process-level temporary HOME isolation. The executable
   contract is WP-02 §"Attempt 3": each producer gets a fresh `mktemp -d`
   outer HOME; `HOME` is set only for that Node/Vitest process; the
   temporary HOME is removed afterward via a shell `EXIT` trap;
   `ALFIE_REPO_DIR=/tmp/alfie-t06` stays explicit; the manual env stays
   unset; attempt-3 logs take the canonical WP-02 names while
   `WP-02-attempt-01-*` and `WP-02-attempt-02-realpi-acceptance.log` stay
   preserved byte-identical. The attempt-01 canonical/lifecycle logs are
   historical environment/runner evidence and must NOT be interpreted as
   current.
2. **WP-03 manual destructive run (M) — authorized exactly once,
   conditional on WP-02 attempt 3 PASS (five legs exit 0).** One isolated
   operator run under the existing accepted recipe, unmodified;
   TERM→KILL bounded to the exact child-owned process tree of the run's
   own isolated environment only; no PID guessing, no process-name kills,
   no external signalling, no retry (§8 no-retry rule).
3. **WP-04 quality gate (Q) — authorized exactly once, conditional on
   WP-03 PASS.** Exactly one `bun fmt`, `bun lint`, `bun typecheck` inside
   the isolated Symphony worktree; if the formatter touches out-of-scope
   paths, stop immediately with `challenge` (§8 fmt-hazard rule).

Stop gates for attempt 3 (any one stops immediately into a challenge
package, no retry): outer-HOME cleanup failure; worktree pin drift
(`12fd6686` / `3fe340b4`); protected WIP hash drift from
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`; a
non-empty zero-delta gate on the named Pi acceptance surface; an unexpected
skip in any leg; a nonzero producer exit.

No gate above authorizes a source, test, harness, fixture, config,
migration, manifest, lockfile, or Alfie change. WP-05–WP-07 keep their
existing gates (main-agent convening with the owner's go-ahead; exactly one
each).

## 8. Authorization gates and no-retry rule

| Gate | WP | Authorization wording (exact requirement) |
|---|---|---|
| Manual destructive run | WP-03 | Proceed only with explicit **current-session owner authorization** naming this plan's WP-03 and the destructive scope. No authorization → WP-03 stays pending; Ticket 06 cannot close (AC6 mandatory). |
| Quality gate | WP-04 | Proceed only with explicit **current-session owner authorization** for `bun fmt`, `bun lint`, `bun typecheck`. |
| Review / Supervisor | WP-05/06 | Convened by the main agent with the owner's current-session go-ahead; each is consumed exactly once. |

Authorization status (2026-08-28, current session): the owner's verbatim
reply `Cho phép tất cả các cổng` authorizes all three gates above in the
fixed conditional sequence of §7c — WP-02 attempt 3 first, then WP-03 only
on attempt-3 PASS, then WP-04 only on WP-03 PASS. Each gate remains
exactly-once and consumes its authorization only when its condition holds.

**No-retry rule (WP-03):** the manual destructive run is attempted **exactly
once**. If it aborts, fails, or produces ambiguous evidence, record the
outcome and return `challenge` — a rerun requires a fresh owner decision
(after material cause review), never an automatic or silent retry.

**fmt-hazard rule (WP-04):** if `bun fmt` modifies prohibited or unrelated
files in the isolated worktree, **stop with `challenge`**. Do not silently
restore files and continue; do not commit formatter drift. Restoration may
happen only as part of the challenge package with the owner informed.

## 9. Git and workspace safety

Protected unrelated owner work: `apps/web/package.json`,
`apps/web/src/main.tsx`, `bun.lock` — modified-unstaged, byte-identical
(aggregate diff hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`),
absent from every Ticket 06 index/commit.

Before and after each package record:

```bash
git rev-parse HEAD
git status --short
git diff --name-status 12fd6686edc26a3fa0382e8bdeb83a1be8045539..HEAD -- apps/server/src/provider apps/server/src/persistence apps/server/src/orchestration apps/server/scripts/wallclock-tests.ts apps/server/vitest.config.ts packages/contracts/src/piSubagents.ts
git diff --name-only
git diff --cached --name-only
git diff -- apps/web/package.json apps/web/src/main.tsx bun.lock | shasum -a 256
```

The zero-delta gate requires the surface diff to be **empty** at every record
through the evidence package. Explicit staging only — never `git add .` or
`git add -A`. No reset, clean, checkout of protected paths, push, release,
deploy, default dev instance, or destructive process operation is authorized.
PID discovery is bounded to the operator recipe's own isolated child tree in
WP-03; no guessing, no process-name kills, nothing outside that tree.

## 10. Commit boundaries

Each WP commits its own artifacts with explicit paths:

```text
WP-01: test(pi): record Ticket 06 deterministic integrated evidence
WP-02: test(pi): record Ticket 06 non-destructive real-Pi evidence
WP-03: docs(planning): record Ticket 06 manual destructive run
WP-04: docs(planning): record Ticket 06 quality gate and implementation report
WP-05: docs(planning): record Ticket 06 integrated review
WP-06: docs(planning): record Ticket 06 supervisor final acceptance
WP-07: docs(planning): accept Ticket 06 and close project
```

Evidence files live only under
`plans/06-integrated-real-pi-acceptance/evidence/`; WPs update their own file
plus the shared files their contract names. No WP stages another WP's files.

## 11. Diagnostic and challenge gates

Stop with `challenge` before continuing when:

- any criterion (D or R evidence) fails or cannot produce its failure-leg
  proof;
- controlled real-Pi contradicts deterministic truth;
- provenance is dirty, unpinned, or mismatched (Symphony worktree hash,
  Alfie worktree hash, extension version, Pi SDK, fixture hashes);
- the Pi acceptance-surface zero-delta gate fails at any record;
- the protected WIP hash changes or any protected file gets staged;
- a source/test/contract/configuration/migration/manifest/lockfile/Alfie
  change appears necessary for any reason;
- an automated destructive real-Pi claim is proposed (Decisions 0031–0032
  prohibit it);
- WP-03 cannot complete within its exactly-one authorization, or its evidence
  is ambiguous;
- `bun fmt` touches prohibited/unrelated files in the isolated worktree
  (§8 fmt-hazard rule — no silent restore-and-continue);
- a reviewer or Supervisor finding requires a material decision.

The challenge package must record the frozen candidate, exact command/exit,
failing row, observed vs required behavior, minimum gap, and the exact
material question. Do not advance Ticket 06 across a challenge.

## 12. Completion and routing

Ticket 06 closes only when all hold:

1. WP-01 19-file deterministic evidence passes with failure legs (D);
2. WP-02 five standalone real-Pi legs pass with exact provenance (R);
3. WP-03's recorded operator run exists and supports AC6 (M) — no retry;
4. WP-04's gate passes and the Implementation Report is complete with the
   AC1–AC8 matrix (Q);
5. WP-05's integrated review verdict is PASS (A) — exactly one review;
6. WP-06's Supervisor decision is persisted and accepted (A) — exactly one;
7. zero-delta, WIP-hash, and staging-safety gates hold at every record;
8. no unresolved challenge remains.

WP-07 then marks Ticket 06 accepted, records the project-closure state in
Project Home, and preserves the full commit lineage. No further review or
Supervisor consultation exists or may be created without a material
reopening.

## 13. Reopening conditions

Reopen only for: an AC failure at any class; provenance divergence; measured
source contradicting a grounding assumption of Tickets 01–05; evidence-class
contamination discovered post-hoc; or a new binding decision that changes
identity, lifecycle, owner, cleanup, Resume, or destructive-boundary
authority. Reopening a closed review/Supervisor gate requires a material
reopening decision, never a second routine consultation.
