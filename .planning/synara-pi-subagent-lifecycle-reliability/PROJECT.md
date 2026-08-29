# Synara Pi subagent lifecycle reliability

## Routing metadata

- **Project slug:** `synara-pi-subagent-lifecycle-reliability`
- **Owner:** anhpham99
- **Primary repository:** Symphony, base `a7827cae7`
- **Conditional secondary repository:** `/Users/anhpham99/alfie`
- **Lifecycle:** completed
- **Triage status:** Tickets 01–06 accepted; no open project frontier. Decision 0010 is the Binding Final Acceptance for candidate `9b55649050b76feffdc4279ceaec92ac74a78686`; D/R/M/Q/A PASS; G-M and G-Q were each consumed exactly once
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

**Current frontier: none. Tickets 01–06 are accepted and the project is
complete.** Decision 0008 remains aspect-scoped **Authoritative** for
post-await same-registration retirement/replacement classification. Decision
0007 remains authoritative only for its historical fixture/rebaseline, erratum,
and gate-reset aspects. **Decision 0009 is aspect-scoped Authoritative** for
structured provider-unavailable preservation, managed `provider_inactive`
mapping, the exact four-file correction boundary, candidate rebaseline, and
fresh downstream route. None of these decisions accepts Ticket 06 or consumes
G-M/G-Q.

Historical base `12fd6686edc26a3fa0382e8bdeb83a1be8045539`, historical
`ffd45bd867e94c9003415f5f2e937cc9c616e399`, and candidate2
`2afef48b008527685658801d8f0d84c79e24827d` remain supporting only. Candidate2
is the sole-parent child of `ffd45bd`; the frozen candidate
`9b55649050b76feffdc4279ceaec92ac74a78686` is its exact sole-parent child.
The integration merge is `cecc9d8ae62bd97b9c81be07d0cfb473a9862cc7`, with
parents `0e828e0fe5daf273a6a0c04960494756ccdf204e` (planning) and the frozen
candidate; the merge is integration provenance only and is never a producer
identity.

The frozen candidate's correction delta from candidate2 is exactly these four
paths:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
```

Its total distinct acceptance-surface delta from `12fd6686` is exactly six
paths: the two Decision 0007 fixture paths plus the four correction paths above.
No fifth path, canonical expectation, coordinator, configuration,
contract/schema, lockfile, manifest, Alfie source, or unrelated test change is
allowed.

Focused implementation evidence is preserved in the four candidate3 logs:
initial red [log](plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-red.log), exit 1, 2 files, 49 tests (`45` passed / `4` failed), SHA-256 `4285cbdd33f6e4f76cc126133a6589396b8e133aca0522c6fdb1ef087115fbb9`; initial green [log](plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-green.log), exit 0, 2 files, `49/49`, SHA-256 `2e22b5879ea1bc16d199e277e8aaa52b334cf81e9fb540841842cc1d4cef5a47`; review-conflation red [log](plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-conflation-red.log), exit 1, 2 files, 49 tests with 1 failure, SHA-256 `363e2f7c3297f27a69425a13021cea0ea889cd8ac8161fc42e59a41268f4ffff`; final green [log](plans/06-integrated-real-pi-acceptance/evidence/candidate3-decision0009-conflation-green.log), exit 0, 2 files, `50/50`, SHA-256 `d9d1f4f351b0e4598b5699c1e5ca5e73919c49a82e39083c8ff964e8f8c106be`. The review fixed the route-inactive conflation and amended the candidate before this freeze. These remain focused implementation evidence, not current D, R, or Q acceptance.

Decision 0009's reason mapping is exact-marker-only: the exact structured
`pi_subagent_managed_execution_unavailable_live` marker yields internal
`unavailableReason: provider_inactive` only on an unavailable result; an
unaccepted control maps to `pi_subagent_read_live_record_unavailable`, while
observation and generic route-inactive (`provider_route_inactive`) remain
`pi_subagent_live_lifecycle_unavailable`. Provider text is never parsed; no
accepted effect, public reason, or acceptance lie is permitted.

Alfie remains pinned at
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. Protected owner WIP remains outside
this transaction with required aggregate diff hash
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`;
protected paths remain untouched and unstaged. WP-01 is **PASS** on the
unchanged closed 19-file set with actual count `19/19` files, `306/306` tests.
WP-02 is **PASS**: exactly one complete five-file non-destructive real-Pi
attempt ran serially at the frozen candidate without retry — integrated `10`
passed + `1` expected skip, canonical `9` passed with terminal-first steer
`0`/SDK `0` and enqueue-first steer `1`/SDK `1` applied, containment `1`,
restart `1`, resume `1`; aggregate `22` passed, `1` expected skip, all exits
`0`; fresh per-leg HOME cleanup proven; raw logs, hashes, provenance, and
disposition under `plans/06-integrated-real-pi-acceptance/evidence/` with the
`WP-02-decision0009-*` prefix.

WP-03 is **PASS** from the sole authorized manual destructive run, with exact
owned root/descendant TERM evidence, zero survivors, band-76 fencing, and no
retry. WP-04 is **PASS** under the owner-approved replacement contract: the
original formatter challenge remains preserved, exactly ten formatter-only
mutations were explicitly discarded, no formatter rerun occurred, and lint /
typecheck exited `0` with a clean candidate. The first G-M reviewer runtime
returned useful evidence but no valid `State / Result / Needs` verdict; it is
preserved as an invalid response, not inferred PASS. The operational fallback
review package is PASS for AC1–AC8 with no blocker. Decision 0010 consumed G-Q
exactly once and finally accepted Ticket 06 and the project candidate.

| Ticket | Status | Current meaning |
|---|---|---|
| [01](issues/01-baseline-reproduction-and-decision-matrix.md) | **accepted** | accepted baseline and decision matrix |
| [02](issues/02-canonical-identity-and-result-continuity.md) | **accepted** | canonical identity/read contract accepted |
| [03](issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md) | **accepted** | Decision 0006 lifecycle contract accepted |
| [04](issues/04-cancellation-watchdog-and-teardown-settlement.md) | **accepted** | watchdog/cancellation/teardown evidence accepted |
| [05](issues/05-restart-reconnect-resume-and-crash-diagnostics.md) | **accepted** | restart/reconnect/Resume evidence accepted |
| [06](issues/06-integrated-real-pi-acceptance.md) | **accepted** | Decision 0010 Binding Final Acceptance; D/R/M/Q/A PASS; G-M and G-Q consumed exactly once |

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
- [Ticket 06 plan](plans/06-integrated-real-pi-acceptance/PLAN.md) — completed D/R/M/Q/A route for frozen Decision 0009 candidate `9b556490`, finally accepted by Decision 0010.
- [decision 0010](decisions/0010-integrated-real-pi-acceptance-final-acceptance.md) — Binding Final Acceptance for Ticket 06 and the complete project candidate.
- [issues/](issues/) — exact six-ticket decomposition.
- [research/](research/) — supporting evidence only.

## Handoff note

Tickets 01–06 are accepted. There is no open frontier. Decision 0009 remains
the aspect-scoped Authority for structured
unavailable-value preservation, managed mapping, exact four-file correction,
and rebaseline only; it is not final acceptance. Candidate
`9b55649050b76feffdc4279ceaec92ac74a78686` is frozen as candidate2's exact
sole-parent child; preserve its focused logs, hashes, provenance, and all
non-authoritative incident details.

WP-01 D, WP-02 R, WP-03 M, and WP-04 Q are **PASS**. The original WP-04
formatter challenge and its owner-approved replacement are both preserved.
The first reviewer runtime returned no valid final verdict and is preserved
without inferred acceptance. The authorized operational fallback review passed
AC1–AC8 with no blocker. Decision 0010 then consumed the exactly-one final
Supervisor gate and accepted Ticket 06/project. WP-07 reconciled routing without
rerunning any producer or gate. No additional D/R/M/Q/review/final consultation
is authorized absent a material reopening condition.
