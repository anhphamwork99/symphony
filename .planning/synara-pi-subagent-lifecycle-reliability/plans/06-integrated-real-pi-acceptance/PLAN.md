# Ticket 06 Plan — integrated real-Pi acceptance

**Plan state:** reassessed under binding [Decision 0007](../../decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md), aspect-scoped Authoritative for fixture correction, candidate rebaseline, attempt-3 evidence erratum, and downstream gate status. Historical evidence is preserved; renewed evidence has not started.

**Historical base:** `12fd6686edc26a3fa0382e8bdeb83a1be8045539`. Historical WP-01 `9208e1728` and attempts 1–3 are supporting only. The future candidate is an exact two-file child of that base, with its SHA frozen before renewed evidence.

**Exact candidate correction scope:**

```text
apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts
apps/server/src/provider/piSubagentRealPiAcceptance.test.ts
```

The base→candidate delta is exactly those two files. A third behavioral file,
production/configuration/manifest/lockfile change, or Alfie change is forbidden.
After candidate freeze, all renewed evidence commits have zero source delta.

**Protected owner WIP:** `apps/web/package.json`, `apps/web/src/main.tsx`, and
`bun.lock`, aggregate diff hash exactly
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`, unstaged.

**Date:** 2026-08-28

## 1. Objective and planning conclusion

Prove the complete project candidate — Tickets 01–05 accepted seams — against
the pinned real-Pi composition with a corrected-candidate integrated acceptance,
then close the project through exactly one integrated review and exactly one
Supervisor final acceptance.

Planning conclusion: **bounded two-file correction rebaseline** under Decision 0007; the old zero-source-delta assumption is superseded only for the exact helper/test correction. The five accepted
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
6. Base→candidate acceptance-surface delta is exactly the two Decision 0007
   files; from the frozen candidate through the evidence package, source delta
   is empty and all other production/Alfie paths remain zero-delta.

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
  - add this plan link and the bounded Decision 0007 rebaseline authorization;
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
12fd6686 historical base
  └──> exact two-file child candidate + freeze
       └──> renewed WP-01: same 19 files, 296/296 (D)
            └──> one renewed full five-file WP-02 (R)
                 └──> fresh owner authorization, WP-03 (M)
                      └──> fresh owner authorization after new WP-03 PASS, WP-04 (Q)
                           └──> WP-05 one integrated review (A)
                                └──> WP-06 final Supervisor Decision 0008 (A)
                                     └──> WP-07 closure and routing
```

The historical WP-01 `9208e1728` and attempts 1–3 remain supporting only. The
old WP-03/WP-04 authorizations are unspent but non-transferable and not
executable. WP-05/WP-06 reservations remain unused. Fresh owner authorization
is required after renewed WP-02 PASS and again after the newly authorized WP-03
PASS.


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

## 7a. Historical attempts and Decision 0007 reassessment (2026-08-28)

Attempts 1–3 are historical supporting evidence only and their raw logs remain
immutable. Decision 0007 classifies attempt 3 as an acceptance-fixture causal-
control defect and authorizes only the exact two-file correction and candidate
rebaseline; it does not authorize production, Alfie, destructive, or quality-
gate changes.

## 7b. Historical attempt outcome (supporting only)

Attempt 2 remains an environment/isolation challenge and attempt 3 remains a
failed historical run. Neither supplies current D/R evidence. No renewed run
has started in this reassessment.

## 7c. Current downstream gate status

The prior WP-03/WP-04 owner authorizations are **unspent but non-transferable**
and not executable. Renewed WP-02 PASS does not activate WP-03 automatically:
fresh explicit owner authorization is required for exactly one WP-03 run after
renewed WP-02 PASS, and fresh explicit owner authorization is required for WP-04
only after the newly authorized WP-03 PASS. WP-05 and WP-06 remain unused.

## 7d. Attempt-3 dated erratum (2026-08-28)

> Attempt 3 failed at `piSubagentRealPiAcceptance.test.ts:1125`, where the test
> required the two acknowledged outbox rows to share one durable
> `dispatchBatchId`. The rows instead had two distinct batch IDs. The test
> stopped before the later public follow-up replay/count assertion, so attempt 3
> did not observe or establish that two public follow-up message events were
> emitted.

Line 1125 compared `Set(dispatchBatchIds).size`; the observed values were two
distinct durable batch IDs among acknowledged outboxes. No duplicate follow-up
count was observed. Preserve exit 1, the stopped status, and all raw attempt
logs byte-for-byte unchanged. Do not infer a production duplicate-follow-up
defect from this failure.

## 8. Authorization gates and no-retry rule

| Gate | Current status |
|---|---|
| Renewed WP-02 | blocked until exact candidate freeze and renewed WP-01 296/296; one full five-file run only |
| WP-03 | blocked; fresh owner authorization required after renewed WP-02 PASS; old authorization unspent/non-transferable/not executable |
| WP-04 | blocked; fresh owner authorization required after the newly authorized WP-03 PASS; old authorization unspent/non-transferable/not executable |
| WP-05 | one integrated review reservation unused; after complete current package |
| WP-06 | one final Supervisor reservation unused; persists Decision 0008 after WP-05 PASS |

WP-03 retains the exactly-one/no-retry manual rule. WP-04 retains the
formatter-hazard rule. Package A authorizes none of these executions.

## 9. Git and workspace safety

Protected unrelated owner work: `apps/web/package.json`,
`apps/web/src/main.tsx`, `bun.lock` — modified-unstaged, byte-identical
(aggregate diff hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`),
absent from every Ticket 06 index/commit.

Before and after each package record:

```bash
git rev-parse HEAD
git status --short
git diff --name-status <CANDIDATE_SHA>..HEAD -- apps/server/src/provider apps/server/src/persistence apps/server/src/orchestration apps/server/scripts/wallclock-tests.ts apps/server/vitest.config.ts packages/contracts/src/piSubagents.ts
git diff --name-only
git diff --cached --name-only
git diff -- apps/web/package.json apps/web/src/main.tsx bun.lock | shasum -a 256
```

The candidate gate allows exactly the two Decision 0007 files in
`12fd6686..CANDIDATE_SHA`; from the candidate through the evidence package the
source-surface diff must be **empty** at every record. Explicit staging only — never `git add .` or
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
