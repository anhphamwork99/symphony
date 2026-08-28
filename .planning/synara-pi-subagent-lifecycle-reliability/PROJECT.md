# Synara Pi subagent lifecycle reliability

## Routing metadata

- **Project slug:** `synara-pi-subagent-lifecycle-reliability`
- **Owner:** anhpham99
- **Primary repository:** Symphony, base `a7827cae7`
- **Conditional secondary repository:** `/Users/anhpham99/alfie`
- **Lifecycle:** active
- **Triage status:** Tickets 01–05 accepted; Ticket 06 remains the sole frontier (`ready-for-agent`) under aspect-scoped Authoritative Decision 0009; candidate2 `2afef48b` is historical and the next candidate is an exact four-file correction child of it; WP-01 is ready for a fresh closed-19-file collection; G-M and G-Q remain pending and exactly one of each is reserved
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
   - [Decision 0002](decisions/0002-canonical-execution-identity-and-result-read-contract.md)
     governs Ticket 02's canonical identity and durable result-read boundary.
   - [Decision 0007](decisions/0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
     remains authoritative only for its historical fixture/rebaseline, erratum,
     and gate-reset aspects.
   - [Decision 0008](decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
     is aspect-scoped **Authoritative** for post-await same-registration
     retirement/replacement classification and the candidate2 baseline.
   - [Decision 0009](decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
     is aspect-scoped **Authoritative** for bounded internal
     `unavailableReason` preservation, managed control mapping, the exact
     four-file correction boundary, candidate rebaseline, and downstream gate
     reset. It is not final acceptance and does not consume G-M/G-Q.
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
(`ready-for-agent`).** Decision 0008 remains aspect-scoped **Authoritative** for
post-await same-registration retirement/replacement classification. Decision
0007 remains authoritative only for its historical fixture/rebaseline, erratum,
and gate-reset aspects. **Decision 0009 is aspect-scoped Authoritative** for
structured provider-unavailable preservation, managed `provider_inactive`
mapping, the exact four-file correction boundary, candidate rebaseline, and
fresh downstream route. None of these decisions accepts Ticket 06 or consumes
G-M/G-Q.

Historical base `12fd6686edc26a3fa0382e8bdeb83a1be8045539`, historical
candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399`, and the old WP-01/WP-02
records are supporting only. `ffd45bd` is the sole-parent child of `12fd6686`
and contains exactly the two Decision 0007 fixture files. The integrated merge
is `44249d81c49172e192dcf0f09ddfadc702a4b34c`, with parents
`50853a3b9774e7aa5462916056195ffa536dc491` (planning) and
`2afef48b008527685658801d8f0d84c79e24827d` (candidate); the merge is
integration provenance only and is never a producer identity.

Candidate2 `2afef48b008527685658801d8f0d84c79e24827d` is the sole-parent child
of `ffd45bd` and is historical-only for the new route. Decision 0009 authorizes
one new producer candidate as the exact sole-parent child of candidate2. Its
correction delta from candidate2 is exactly these four existing paths:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
```

The final candidate's total distinct acceptance-surface delta from `12fd6686`
is exactly six paths: the two Decision 0007 fixture paths plus the four paths
above. No fifth path, canonical expectation, coordinator, configuration,
contract/schema, lockfile, manifest, Alfie source, or unrelated test change is
allowed. The new candidate SHA must be recorded before fresh D or R evidence.

Focused containment evidence is preserved at
[red](plans/06-integrated-real-pi-acceptance/evidence/candidate2-containment-red.log)
(exit 1, 24 tests: 6 failed / 18 passed, SHA-256
`665e0bbaf0a9a25d1908c9767d2bd7ff2947d4e1844a6df80d84622300b16e3b`) and
[green](plans/06-integrated-real-pi-acceptance/evidence/candidate2-containment-green.log)
(exit 0, 24/24, SHA-256
`84feb4814b891ce69472c74dd5596f04c9bf753fa65de18c7d31b352dd95f43b`).
These are focused implementation evidence, not current D or R acceptance.
WP-01's historical candidate2 collection was `19/19`, `303/303`, but that
result is supporting-only. The new candidate requires a fresh actual count over
the same closed 19-file set; the set must not be broadened.

Alfie remains pinned at
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. Protected owner WIP remains outside
this transaction with required aggregate diff hash
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`;
protected paths are untouched and unstaged. There is no current D/R PASS.

The required serial route is: candidate2 `2afef48b` → exact four-file
correction child and freeze → WP-01 fresh same closed 19-file collection
(actual count to be recorded) → exactly one new full five-file WP-02 → fresh
owner authorization WP-03 → fresh owner authorization WP-04 after the new WP-03
PASS → WP-05 one integrated review → WP-06 one final Supervisor Decision 0010
→ WP-07 closure. Old WP-03/WP-04 authorizations are non-transferable and not
executable. G-M and G-Q remain pending and exactly one of each remains reserved.

| Ticket | Status | Current meaning |
|---|---|---|
| [01](issues/01-baseline-reproduction-and-decision-matrix.md) | **accepted** | accepted baseline and decision matrix |
| [02](issues/02-canonical-identity-and-result-continuity.md) | **accepted** | canonical identity/read contract accepted |
| [03](issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md) | **accepted** | Decision 0006 lifecycle contract accepted |
| [04](issues/04-cancellation-watchdog-and-teardown-settlement.md) | **accepted** | watchdog/cancellation/teardown evidence accepted |
| [05](issues/05-restart-reconnect-resume-and-crash-diagnostics.md) | **accepted** | restart/reconnect/Resume evidence accepted |
| [06](issues/06-integrated-real-pi-acceptance.md) | **ready-for-agent — sole frontier** | Decision 0009 correction route; fresh WP-01 required; no current D/R PASS |

The prior evidence-only/zero-source-delta execution contract is superseded only
for the Decision 0007 and Decision 0008 candidate aspects. This planning
package records the frozen candidate and focused red/green evidence but claims
no current D/R PASS and runs no producer.

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
- [Ticket 06 plan](plans/06-integrated-real-pi-acceptance/PLAN.md) — Decision 0009 correction router: exact four-file child of candidate2, six-path total from `12fd6686`, fresh closed-19-file WP-01, one full five-file WP-02, and final Decision 0010; no current D/R PASS.
- [issues/](issues/) — exact six-ticket decomposition.
- [research/](research/) — supporting evidence only.

## Handoff note

Tickets 01–05 are accepted. Ticket 06 remains the sole `ready-for-agent`
frontier. Decision 0009 is the aspect-scoped Authority for structured
unavailable-value preservation, managed mapping, exact four-file correction,
and rebaseline only; it is not final acceptance. Preserve candidate2's failure
details, raw bytes, hashes, provenance, and spent no-retry state. Do not treat
historical D/R records as new-candidate proof or retry them.

The next producer must create and freeze one sole-parent child of candidate2
with exactly the four listed correction paths and exactly six distinct paths
from `12fd6686`. Then WP-01 reruns the unchanged closed 19-file set and records
its actual count. Only a fresh WP-01 PASS permits exactly one complete fresh
five-file WP-02. Only that PASS permits fresh owner WP-03; only a new WP-03 PASS
permits fresh owner WP-04. WP-05, WP-06 Decision 0010, and WP-07 follow in
order. No source implementation, tests, producer, destructive run, review, or
acceptance is part of this planning transaction.
