# Synara Pi subagent lifecycle reliability

## Routing metadata

- **Project slug:** `synara-pi-subagent-lifecycle-reliability`
- **Owner:** anhpham99
- **Primary repository:** Symphony, base `a7827cae7`
- **Conditional secondary repository:** `/Users/anhpham99/alfie`
- **Lifecycle:** active
- **Triage status:** Tickets 01–04 accepted; Ticket 05 is the sole frontier (`ready-for-agent` under its accepted evidence-first plan)
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

**Current frontier: Ticket 05 is the sole project frontier.** Ticket 01 is
accepted as the read-only grounding report. Ticket 02 is accepted at Symphony
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
review and Supervisor acceptance were intentionally unused. Ticket 05's
accepted evidence-first plan at
[`plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md`](plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md)
now routes it as the sole `ready-for-agent` frontier. Initial execution
authorizes deterministic and controlled-provider evidence plus the issue
Implementation Report only; it authorizes no source, test, contract,
configuration, migration, manifest, lockfile, or Alfie change. Any criterion
failure must stop at the plan's challenge/replan gate. Ticket 06 remains
blocked. One integrated project review and exactly one Supervisor
final-acceptance consultation remain reserved for the complete integrated
candidate.

| Ticket                                                                    | Status                                 | Dependency / unlock                                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [01](issues/01-baseline-reproduction-and-decision-matrix.md)              | **accepted**                           | grounding report accepted; no source edits                                                                    |
| [02](issues/02-canonical-identity-and-result-continuity.md)               | **accepted**                           | canonical identity/read contract implemented, evidenced, reviewed, and reported against controlled Alfie `.6` |
| [03](issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md) | **accepted**                           | Decision 0006 implemented, evidenced, reviewed, and closed at frozen candidate `5a1ff1d42`                    |
| [04](issues/04-cancellation-watchdog-and-teardown-settlement.md)          | **accepted**                           | T04-AC1–AC5 deterministically evidenced and reported; no source change                                        |
| [05](issues/05-restart-reconnect-resume-and-crash-diagnostics.md)         | **ready-for-agent — sole frontier**    | accepted evidence-first plan; Tickets 02–04 accepted seams                                                     |
| [06](issues/06-integrated-real-pi-acceptance.md)                          | blocked                                | Tickets 01–05 accepted; all provenance and evidence gates                                                     |

Ticket 04's evidence-first plan executed in full: WP-01 froze deterministic
criterion evidence, WP-02 verified controlled provenance and completed the
Implementation Report, and WP-03 closed the ticket from that evidence only.
Under the Router rule, this Project Home remains the sole status and frontier
authority. Ticket 05's accepted plan now advances execution authority to its
serial evidence-only WPs. It does not authorize source remediation or claim
Ticket 05, Ticket 06, or the integrated project accepted.

The [canonical identity decision gate](handoffs/01-canonical-identity-decision-gate.md)
is discharged by Decision 0002. It remains a historical consultation link;
the decision record is now the authoritative contract for Ticket 02.

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
- [Ticket 05 plan](plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md) — accepted evidence-first plan with serial deterministic, controlled real-Pi/report, and closure/routing packages; initially authorizes no source change.
- [issues/](issues/) — exact six-ticket decomposition.
- [research/](research/) — supporting evidence only.

## Handoff note

Tickets 01–04 are accepted. Ticket 03 implements Decision 0006's exact-tuple
Alternative A proxy, preserves the inherited closed DG-4 owner boundary, and
is closed at frozen candidate `5a1ff1d42` with PASS review `c3dbc328a`.
Ticket 04 is accepted at frozen candidate `08b65ebb4` from evidence-only
execution with no source or Alfie change; its cancellation/watchdog/owned
teardown evidence preserves bands 70–78, proof-before-fence, and
exact-owner-only authority. Ticket 05 is the sole `ready-for-agent` frontier
under its accepted evidence-first plan: initial execution is limited to
deterministic and controlled-provider evidence plus its Implementation Report,
with no source/Alfie change. Ticket 06 remains blocked. The one integrated
project review and exactly one Supervisor final-acceptance consultation remain
reserved for the complete project candidate.
