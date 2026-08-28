# Synara Pi subagent lifecycle reliability

## Routing metadata

- **Project slug:** `synara-pi-subagent-lifecycle-reliability`
- **Owner:** anhpham99
- **Primary repository:** Symphony, base `a7827cae7`
- **Conditional secondary repository:** `/Users/anhpham99/alfie`
- **Lifecycle:** active
- **Triage status:** Tickets 01–05 accepted; Ticket 06 is the sole frontier (`ready-for-agent`); G-M (integrated project review) and G-Q (Supervisor final acceptance) pending — exactly one of each reserved
- **Tracker:** Local Markdown under this Project Home

> **Router rule:** This `PROJECT.md` is the sole status and frontier router for
> this project. Ticket files may describe their own acceptance criteria and
> implementation-report placeholders, but they must not create a competing
> project status or frontier.

## Owner authorization

The owner approved creating this project for end-to-end subagent execution:
“okay, tạo 1 project trong planning để spawn các subagents thực hiện và xử lý
vấn đề 1 cách toàn trình đi”. The accepted project slug is the slug above.
This initial commit creates planning artifacts only; it does not authorize
source implementation, release, deployment, or push.

## Project objective and observable OKRs

This project addresses lifecycle truth failures when a Pi managed subagent is
visible to the public Agent surface but cannot be read, reconciled, stopped,
or resumed through one durable identity.

### OKR-1 — one durable identity is usable end to end

- **Objective:** A managed child has one durable public `executionId` from
  admission through result lookup, terminal settlement, reconnect, restart,
  and explicit control.
- **Key results:**
  1. No public detached result exposes an identity that the result-read path
     cannot resolve.
  2. A result lookup by `executionId` remains bounded, authorized, and useful
     after the provider's in-memory record is gone whenever terminal evidence
     is durable.
  3. `attemptId` and generation fence stale callbacks without changing the
     logical execution identity.

### OKR-2 — terminal truth precedes cleanup claims

- **Objective:** Lifecycle state, terminal outcome, and cleanup proof remain
  separate and truthful under races, watchdog escalation, teardown uncertainty,
  restart, and reconnect.
- **Key results:**
  1. Terminal evidence is journal-first and durable before any delivery or
     public terminal claim.
  2. `cleanup_uncertain`, `survivors`, and `owner_unproven` never become
     termination proof or `cancelled` by themselves.
  3. A same-generation terminal race and a stale-generation terminal race are
     both observable and deterministic.

### OKR-3 — restart and Resume are honest

- **Objective:** Restart/reconnect restores projection truth without replaying
  uncertain side effects, while explicit Resume is offered only when its
  authority and eligibility are proven.
- **Key results:**
  1. Restart settles to recovered terminal, proven live owner, or honest
     orphan/uncertainty with diagnostic evidence.
  2. No automatic replay or automatic Resume is introduced by reconciliation,
     hydration, watchdog, or cleanup.
  3. An unavailable provider runtime does not produce a misleading Resume
     success; the user receives an actionable, stable diagnostic.

### OKR-4 — evidence can be independently accepted

- **Objective:** The project reaches a single integrated feature-level review
  followed by exactly one Supervisor final acceptance for the whole project.
- **Key results:**
  1. Ticket 01 produces a read-only baseline/reproduction/decision matrix
     ready for downstream agents.
  2. Tickets 02–06 each have bounded ACs, failure evidence, testing seams,
     dependency gates, and implementation-report placeholders before becoming
     ready.
  3. The integrated real-Pi acceptance distinguishes mandatory real-Pi,
     deterministic fixture, and manual destructive evidence.

## Authority precedence

1. **Owner approval in the current task/context** governs project creation and
   scope, but does not silently rewrite accepted technical decisions.
2. **This Project Home** governs this project's routing, exact frontier,
   ticket status, dependency graph, and review lifecycle.
3. **Inherited accepted decisions** remain authoritative by aspect and are
   linked rather than copied or superseded: [durable-subagents Project Home](../synara-pi-durable-subagents/PROJECT.md)
   and [handshake-first Project Home](../synara-pi-subagent-handshake-first/PROJECT.md).
4. **Binding Supervisor decisions** persisted in this project's `decisions/`
   directory are authoritative for their named ticket and material question.
   [Decision 0002](decisions/0002-canonical-execution-identity-and-result-read-contract.md)
   governs Ticket 02's canonical identity and result-read boundary.
5. **Ticket-level decisions** may refine a ticket only within those boundaries;
   material changes require a new decision record and owner/Supervisor route.
6. **Research records** in this project are supporting evidence only. They are
   not authority and cannot advance a status or frontier.
7. **Source and runtime evidence** can falsify a proposal or reopen a decision,
   but cannot itself accept architecture.

No artifact in this project authorizes a release, push, deploy, production
kill, PID guessing, or direct Symphony process-kill authority.

## Scope

In scope:

- reproduce and map the public/hidden identity mismatch;
- define canonical identity and durable result-read continuity;
- preserve journal-first terminal truth and cleanup-proof separation;
- bound lifecycle containment, cancellation, watchdog, and owned teardown
  retry settlement;
- define restart/reconnect/Resume truth and crash diagnostics;
- prove the integrated behavior against the pinned real-Pi boundary;
- update Symphony and, only when required by the accepted seam, the pinned
  Alfie extension with provenance re-pinning.

Out of scope:

- redesigning Pi's general Agent UX or replacing AgentManager;
- automatic replay, automatic Resume, or speculative recovery of side effects;
- accepting the designer's crash guardian, orphan-terminal exception, durable
  post-restart owner receipt, or provider-bootstrap Resume as architecture;
- raw PID discovery/guessing, PID files, process-name kills, or Symphony PID
  kill authority;
- release packaging, deployment, push, or unrelated planning projects;
- treating this project as a successor that silently supersedes prior accepted
  tickets or decisions.

## Cross-repo and provenance policy

- Symphony is the primary implementation and acceptance repository.
- Alfie is conditional: change it only when a contract seam cannot be made
  correct in Symphony alone and the ticket explicitly names the Alfie surface.
- Current pin: Alfie commit
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e`,
  `@alfie/pi-subagents@0.15.0-alfie.6`.
- Any change to Alfie `package.json`, `src/index.ts`,
  `src/agent-manager.ts`, or equivalent runtime ownership surfaces requires
  exact provenance re-pin, hash/dirty-tree verification, and a paired
  Symphony/Alfie implementation report. A dirty or unpinned extension is not
  acceptance evidence.
- No ticket may claim a production composition it did not build and verify.
  Controlled artifact and runtime configuration boundaries remain governed by
  the handshake-first project.

## Current frontier and statuses

**Current frontier: Ticket 06 is the sole project frontier
(`ready-for-agent`) under its accepted evidence-only plan at
[`plans/06-integrated-real-pi-acceptance/PLAN.md`](plans/06-integrated-real-pi-acceptance/PLAN.md)**
(planning baseline `4bf368a492e42382c3e064ae7a5be5a6624bdbf0`; frozen
behavioral candidate `12fd6686edc26a3fa0382e8bdeb83a1be8045539`; controlled
Alfie worktree `3fe340b401ca86bcbe8b55abd4de107e1d93482e` via
`ALFIE_REPO_DIR`). Tickets 01–05 are accepted. Ticket 01 is accepted
as the read-only grounding report. Ticket 02 is accepted at Symphony
candidate `cb023e587` plus Implementation Report `d77a566e0`, against
controlled Alfie
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. Its deterministic,
controlled-Alfie, and isolated real-Pi evidence passed independent review; the
report-only closure introduced no material reopening, so no second review or
ticket-level Supervisor final-acceptance consultation is required. Binding
[Decision 0006](decisions/0006-live-lifecycle-containment-linearization-contract.md)
settles DG-3 through an exact-tuple live lifecycle proxy and preserves the
already-closed DG-4 owner boundary. Ticket 03 is accepted at frozen Symphony
candidate `5a1ff1d42`, including exact-tuple remediation `1913a9a61`,
controlled/real-Pi evidence `1a92d1cfa`, Implementation Report `db27626b7`,
and independent PASS review `c3dbc328a`. Its final gate passed `bun fmt`,
`bun lint` with 0 warnings/0 errors, and `bun typecheck` 7/7. Ticket 04 is
accepted at frozen candidate
`08b65ebb466470d71814c4467d74e68f43991138` from evidence-only execution:
WP-01 evidence `bab07af82d31c7fc128fd561fc0dc06eed0f7300` passed 11/11
files and 177/177 tests; WP-02 report
`e160ccd8c6bfbd9839b67618ffdbaf7d85ee8e11` verified the exact clean
Alfie pin and recorded non-destructive real-Pi cancellation 2/2 plus
watchdog 2/2 PASS. No Ticket 04 source, test, contract, manifest, lockfile,
or Alfie change exists; no destructive manual run was run or claimed. Its
final gate passed `bun fmt`, `bun lint` with 0 warnings/0 errors, and
`bun typecheck` 7/7 with non-failing console advisories recorded. Ticket-level
review and Supervisor acceptance were intentionally unused. Ticket 05 is
accepted from evidence-only execution under its accepted plan at
[`plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md`](plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md):
WP-01 evidence `4090ccee8cf39b9164a9653fc41b239bc59b5173` passed 9/9 files
and 118/118 deterministic tests at frozen candidate
`7521b92c7cb8a614346f994e963aa379175f540b`; runner correction
`d12e1a2e071afcdc63f630fbff467b76779e7d42` authorized the Node producer;
WP-02 evidence and Implementation Report
`b5d0feefc26bf88d59d1759132c9a8b051c54865` verified the exact clean Alfie
pin and Pi SDK 0.83.0 (5/5 fixture hashes) and recorded non-destructive real-
Pi restart 1/1, explicit Resume 1/1, and fresh production boot 1 passed/9
skipped under the supported Node producer, with the Bun 1.3.12 `node:sqlite`
pre-collection failure preserved as environment evidence only. Provider-
inactive Resume fails closed at `ProviderService.resumePiSubagentExecution`
with `allowRecovery: false` — a truthful denial without provider bootstrap.
No Ticket 05 source, test, contract, configuration, migration, manifest,
lockfile, or Alfie change exists (`7521b92c7..HEAD` apps/packages delta is
empty); no Ticket 05 destructive manual run was claimed or executed. Its owner-
authorized final gate passed `bun fmt` (exit 0), `bun lint` with 0 warnings/
0 errors, and `bun typecheck` 7/7 (0 cached) with non-failing console
advisories recorded. Ticket-level review and Supervisor acceptance were
intentionally unused. Ticket 06 is now the sole project frontier,
`ready-for-agent`, with Tickets 01–05 accepted and all
provenance/evidence gates available; no Ticket 06 implementation, review, or
acceptance has occurred. One integrated
project review and exactly one Supervisor final-acceptance consultation
remain reserved for the complete integrated candidate. The Ticket 06 plan is
now persisted: WP-01 freezes deterministic evidence (D), WP-02 runs the five
standalone non-destructive real-Pi files (R), WP-03 is the exactly-one
owner-authorized manual destructive run (M, mandatory for AC6; no retry),
WP-04 is the owner-authorized quality gate plus Implementation Report (Q),
WP-05 is the exactly-one integrated review (A), WP-06 is the exactly-one
Supervisor final acceptance (A), WP-07 closes. **No Ticket 06 evidence,
review, or acceptance exists yet** — the plan only authorizes execution; no
producer has been run under it and no gate has been consumed.

| Ticket                                                                    | Status                                 | Dependency / unlock                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [01](issues/01-baseline-reproduction-and-decision-matrix.md)              | **accepted**                           | grounding report accepted; no source edits                                                                    |
| [02](issues/02-canonical-identity-and-result-continuity.md)               | **accepted**                           | canonical identity/read contract implemented, evidenced, reviewed, and reported against controlled Alfie `.6` |
| [03](issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md) | **accepted**                           | Decision 0006 implemented, evidenced, reviewed, and closed at frozen candidate `5a1ff1d42`                    |
| [04](issues/04-cancellation-watchdog-and-teardown-settlement.md)          | **accepted**                           | T04-AC1–AC5 deterministically evidenced and reported; no source change                                        |
| [05](issues/05-restart-reconnect-resume-and-crash-diagnostics.md)         | **accepted**                           | T05-AC1–AC6 evidenced and reported; no source change                                                          |
| [06](issues/06-integrated-real-pi-acceptance.md)                          | **ready-for-agent — sole frontier**   | Tickets 01–05 accepted; evidence-only plan persisted; no evidence/acceptance yet                            |

Ticket 04's evidence-first plan executed in full: WP-01 froze deterministic
criterion evidence, WP-02 verified controlled provenance and completed the
Implementation Report, and WP-03 closed the ticket from that evidence only.
Ticket 05's evidence-first plan likewise executed in full: WP-01
(`4090ccee8`) froze deterministic criterion evidence at frozen candidate
`7521b92c7`, WP-02 (`b5d0feefc`) verified controlled provenance and completed
the Implementation Report, and WP-03 closed the ticket from that evidence
only. Under the Router rule, this Project Home remains the sole status and
frontier authority. Ticket 06 is the sole `ready-for-planning` frontier; its
plan does not yet exist and no implementation, review, or acceptance is
claimed. It does not authorize source remediation or claim Ticket 06 or the
integrated project accepted.

The [canonical identity decision gate](handoffs/01-canonical-identity-decision-gate.md)
is discharged by Decision 0002. It remains a historical consultation link;
the decision record is now the authoritative contract for Ticket 02.

Ticket 06's plan is evidence-only and strictly serial (WP-01→WP-07). It
requires zero committed delta on the Pi acceptance surface (`apps/server/src/
provider/**`, `apps/server/src/persistence/**`, `apps/server/src/
orchestration/**`, `apps/server/scripts/wallclock-tests.ts`,
`apps/server/vitest.config.ts`, `packages/contracts/src/piSubagents.ts`) from
`12fd6686` through the evidence package, runs all behavioral producers in an
isolated Symphony worktree at `12fd6686` with the controlled Alfie detached
worktree `3fe340b4` selected by `ALFIE_REPO_DIR` (user Alfie checkout
`c6a27714` untouched), defines evidence classes P/D/R/M/Q/H/A, and reserves
the destructive manual leg (WP-03) and the quality gate (WP-04) behind
explicit current-session owner authorization with a strict no-retry rule for
the manual run.

Dependency graph:

```text
01 baseline/reproduction/decision matrix
 └──> 02 canonical identity + durable result-read continuity
       └──> 03 terminal-before-cleanup + live lifecycle containment
             └──> 04 cancellation/watchdog/owned teardown retry settlement
                   └──> 05 restart/reconnect/Resume/projection truth + crash diagnostics
                         └──> 06 integrated real-Pi acceptance
```

Parallel research is allowed as supporting evidence only; it does not change
this serial frontier.

## Settled invariants and open design points

Settled and inherited:

- `executionId` is the only managed public identity; `agentId` is provider-local
  and absent from managed public output/details, as bound by [Decision 0002](decisions/0002-canonical-execution-identity-and-result-read-contract.md).
- `attemptId` and generation provide stale-event fencing and form the durable
  current tuple with `executionId`.
- proof-before-fence; no PID guessing or Symphony PID kill authority.
- terminal outcome and cleanup proof are separate.
- journal-first terminal/outbox truth.
- no automatic replay/Resume of uncertain side effects.
- bounded payloads and authorization remain mandatory.
- watchdog bands 70–74 and teardown bands 75–78 retain their accepted
  semantics unless a binding reassessment changes them.
- controlled extension/pin/provenance and production composition remain under
  handshake-first authority.

Open, material design points:

- the truthful Resume eligibility and provider-bootstrap boundary;
- whether any crash guardian or durable owner receipt is needed at all.

The following are **candidate directions and decision gates, not accepted
architecture**: designer crash guardian; orphan-terminal exception; durable
post-restart owner receipt; provider-bootstrap Resume.

## Review and acceptance governance

Each implementation ticket must include a complete Implementation Report and
criterion-level evidence before review. The project governance is:

1. one integrated feature-level review covering the complete project candidate;
2. exactly one Supervisor final-acceptance consultation for the full project;
3. reviews are evidence, not authority; only the accepted decision advances
   the project;
4. no second review or hidden acceptance loop without a material reopening;
5. no push, release, or deploy authority is granted by this project.

The inherited testing strategy, wall-clock isolation, real-Pi evidence rules,
manual destructive boundary, and review cadence are linked in [Decision 0001](../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
and applicable decisions, especially durable-subagents Decisions 0027–0034.

## Source-evidence index

Supporting locators used to ground Ticket 01 and downstream gates:

- Symphony managed Agent wrapper/admission and detached identity projection:
  `apps/server/src/provider/Layers/PiAdapter.ts:4268-4435` and
  `:4174-4235`.
- Symphony durable repository contracts for admission, terminal, restart, and
  teardown evidence: `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:715-1125`.
- Symphony restart reconciliation's read-only/no-dispatch posture and orphan
  path: `apps/server/src/provider/piSubagentRestartReconciliation.ts:21-56,183-482`.
- Symphony watchdog stage bands and non-terminal handoff semantics:
  `apps/server/src/provider/piSubagentWatchdogEscalation.ts:21-59,196-238`.
- Symphony proof-before-fence and owned-only teardown bands:
  `apps/server/src/provider/piSubagentProcessTeardown.ts:15-65,205-265`.
- Symphony real detached identity/reproduction seams:
  `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts:905-940,1127-1128,1614-1660`.
- Pinned Alfie GET_RESULT strict lookup:
  `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:2219-2255`.
- Pinned Alfie public/hidden result construction and detached rendering:
  `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts:1265-1347,1948-2219`.
- Pinned Alfie AgentManager record identity:
  `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-manager.ts:326` and
  `src/agent-runner.ts:388-625`.

Detailed supporting narratives are [research/001](research/001-live-incident-and-current-seam-map.md)
and [research/002](research/002-candidate-solution-contract.md).

## Artifact map

- [spec.md](spec.md) — normative project contract and OKRs.
- [terms.md](terms.md) — project vocabulary and evidence language.
- [design-tree.md](design-tree.md) — decision tree, gates, and evidence map.
- [decision 0001](decisions/0001-project-charter-and-inherited-authority.md) — project charter and inherited authority.
- [decision 0002](decisions/0002-canonical-execution-identity-and-result-read-contract.md) — binding canonical identity and durable result-read contract for Ticket 02.
- [decision 0006](decisions/0006-live-lifecycle-containment-linearization-contract.md) — binding live lifecycle observation/control linearization contract for Ticket 03 DG-3; preserves DG-4.
- [Ticket 03 plan](plans/03-terminal-before-cleanup-and-live-lifecycle-containment/PLAN.md) — completed serial implementation, evidence, review, and closure packages.
- [Ticket 03 review](reviews/03-terminal-before-cleanup-and-live-lifecycle-containment-review.md) — independent criterion-level PASS review of frozen candidate `5a1ff1d42`.
- [Ticket 03 WP-03 handoff](handoffs/03-wp03-controlled-real-pi-evidence-handoff.md) — historical evidence-package handoff, superseded by Ticket 03 closure.
- [Ticket 04 plan](plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md) — completed evidence-first plan with WP-01 deterministic evidence (`bab07af82`), WP-02 controlled-provider report (`e160ccd8c`), and WP-03 closure.
- [Ticket 05 plan](plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md) — completed evidence-first plan: WP-01 deterministic evidence (`4090ccee8`), runner correction (`d12e1a2e0`), WP-02 controlled real-Pi evidence and Implementation Report (`b5d0feefc`), and WP-03 evidence-only closure.
- [Ticket 06 plan](plans/06-integrated-real-pi-acceptance/PLAN.md) — persisted evidence-only integrated acceptance plan (WP-01–WP-07); not yet executed; no evidence, review, or acceptance exists.
- [issues/](issues/) — exact six-ticket decomposition.
- [research/](research/) — supporting evidence only.

## Handoff note

Tickets 01–05 are accepted. Ticket 03 implements Decision 0006's exact-tuple
Alternative A proxy, preserves the inherited closed DG-4 owner boundary, and
is closed at frozen candidate `5a1ff1d42` with PASS review `c3dbc328a`.
Ticket 04 is accepted at frozen candidate `08b65ebb4` from evidence-only
execution with no source or Alfie change; its cancellation/watchdog/owned
teardown evidence preserves bands 70–78, proof-before-fence, and
exact-owner-only authority. Ticket 05 is accepted at frozen candidate
`7521b92c7` from evidence-only execution with no source or Alfie change; its
reconnect/restart/Resume/no-replay evidence preserves identity, restart,
Resume, owner, cleanup, and no-replay authority, and provider-inactive
Resume remains a truthful fail-closed denial. Ticket 06 is the sole
`ready-for-agent` frontier under its persisted evidence-only plan; no Ticket
06 producer has run and no evidence or acceptance exists. The one integrated
project review (G-M) and exactly one Supervisor final-acceptance consultation
(G-Q) remain pending and reserved for the complete project candidate; each is
to be consumed exactly once by WP-05/WP-06 of the Ticket 06 plan.
