# Ticket 01 — baseline, reproduction, and decision matrix

**Status:** accepted
**Blocked by:** none
**Type:** accepted read-only grounding; no source edits
**Next unlock:** Ticket 02 only after the named Supervisor identity/read decision gate is discharged

## Objective

Reproduce the public/hidden identity mismatch and map the existing Symphony /
Alfie lifecycle seams, inherited decisions, failure modes, and material design
gates. Produce evidence that downstream implementation agents can use without
inventing architecture.

## Accepted Grounding Report

**Acceptance disposition:** T01-AC1 through T01-AC7 are accepted by the
orchestrator. This report records the baseline, the confirmed incident, the
current seams, the failure/diagnostic matrix, and the material decision gate;
it does not select or authorize an implementation.

### Criterion-level evidence

| Criterion | Grounding result                                                                                                                                                                                                                                                                                                                                                                                                     | Exact evidence locators                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T01-AC1   | **PASS.** Symphony base is `a7827cae7` (the Project Home routing base; this worktree was clean before the planning edit). Pinned Alfie is commit `aa6fa4a8540644d2509b10d6df854486ddc67d1d`, `@alfie/pi-subagents@0.15.0-alfie.4`; the isolated Alfie checkout was clean.                                                                                                                                            | Project Home routing metadata; `git rev-parse HEAD`; `/Users/anhpham99/alfie` `git rev-parse HEAD` and `git status --porcelain`; Symphony `apps/server/src/provider/Layers/PiAdapter.ts:4174-4235,4268-4435`.                                                                                                            |
| T01-AC2   | **PASS.** The detached public result exposes durable `executionId`, while hidden/provider details also retain provider-local `agentId`. Pinned Alfie `get_subagent_result` and `steer_subagent` use the strict `agentId`-keyed Manager map; passing the public execution identity therefore yields `Agent not found`. The child may continue, so this is an identity/read-continuity failure, not termination proof. | Alfie `agent/extensions/pi-subagents/src/index.ts:1284-1287,2080-2089,2227-2255,2333-2377`; `agent/extensions/pi-subagents/src/agent-manager.ts:326`; `agent/extensions/pi-subagents/src/agent-runner.ts:388-625`; supporting incident [research/001](../research/001-live-incident-and-current-seam-map.md).            |
| T01-AC3   | **PASS.** Durable admission, terminal/outbox, restart, watchdog, and owned teardown seams are mapped, including watchdog bands 70–74, teardown bands 75–78, and proof-before-fence.                                                                                                                                                                                                                                  | Symphony `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:715-1125`; `apps/server/src/provider/piSubagentRestartReconciliation.ts:21-56,183-482`; `apps/server/src/provider/piSubagentWatchdogEscalation.ts:21-59,196-238`; `apps/server/src/provider/piSubagentProcessTeardown.ts:15-65,205-265`. |
| T01-AC4   | **PASS.** The matrix below covers active progress, terminal success/failure, provider-record eviction, restart orphaning, stale evidence, unauthorized reads/controls, inactive-provider Resume, and cleanup uncertainty.                                                                                                                                                                                            | Matrix in [Failure and diagnostic matrix](#failure-and-diagnostic-matrix); durable identity/event contracts at `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:18-20,72-76,196-207,262-290,510-560,595-628,676-686`.                                                                              |
| T01-AC5   | **PASS.** Settled invariants are separated from open gates and the four candidate directions are retained without selection.                                                                                                                                                                                                                                                                                         | [Decision classification](#decision-classification); [research/002](../research/002-candidate-solution-contract.md).                                                                                                                                                                                                     |
| T01-AC6   | **PASS.** Ticket-02 delegation inputs, required decision questions, minimum test seams, and failure/diagnostic assertions are recorded below and in the named handoff.                                                                                                                                                                                                                                               | [Downstream delegation inputs](#downstream-delegation-inputs); [handoff](../handoffs/01-canonical-identity-decision-gate.md).                                                                                                                                                                                            |
| T01-AC7   | **PASS.** No Symphony source, test, configuration, Alfie, or other project file was edited.                                                                                                                                                                                                                                                                                                                          | [No-source scope audit](#no-source-scope-audit); final planning-only diff.                                                                                                                                                                                                                                               |

### Incident and identity finding

The accepted P0 finding is a namespace mismatch: Symphony mints and durably
persists `executionId`; Alfie’s detached output makes that public, but the
provider's result/control tools still resolve `agentId` through an in-memory
Manager map. `get_subagent_result` and `steer_subagent` therefore cannot be
assumed to resolve the public handle. The durable repository already accepts
`executionId` for admission, lifecycle, terminal, outbox, restart, watchdog,
and teardown records, but that durable read capability is not itself an
LLM-callable result tool. The detached record is not prematurely garbage
collected; a failed public read is not evidence of cleanup or child death.

The observed restart orphan / `owner_unproven` path is accepted fail-closed
behavior when owner or terminal proof is unavailable. The server-exit root
cause remains **unconfirmed** because no durable exit reason was captured.
Resume being offered while the provider runtime is inactive and then rejected
is a diagnostic/eligibility gap, not evidence that automatic Resume is safe.

#### Identity values recorded by the reproduction

The reproduction records the values by namespace rather than inventing a
transient live UUID: public detached `executionId` is the server-minted
`exec_<opaque>` value; hidden Alfie `agentId` is the provider-local
`record.id`/`handle.id`; the durable admission/journal row uses the same
`executionId`, with `attemptId` `att_<opaque>` and generation `1`. The focused
fixture asserts these exact value shapes and equality relationships at
`apps/server/src/provider/piSubagentForegroundAcceptance.test.ts:905-925`
and `:1127-1130`; its legacy split is at `:1614-1660`. The incident's
observable mismatch is therefore `public executionId != hidden/provider
agentId`, while `durable row.executionId == public executionId`. No literal
runtime identifier was retained in the planning artifacts, so none is
fabricated here.

### Current and target seam summary

| Concern             | Current seam / evidence                                                                                                      | Target contract input (not implementation)                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Public identity     | Detached result renders `executionId`; provider details retain `agentId`.                                                    | Bind one public logical identity, or an explicit bounded compatibility mapping, before Ticket 02 implementation.                               |
| Live result/control | Alfie `get_subagent_result` / `steer_subagent` look up `agentId` in the Manager map.                                         | Define whether provider calls alias/map to `executionId`, or whether Symphony exposes a durable LLM-callable read/control boundary.            |
| Durable continuity  | Symphony persists `executionId`, attempt, generation, lifecycle, terminal, outbox, restart, watchdog, and teardown evidence. | Authorized, bounded reads must survive provider-record eviction/restart when terminal evidence exists and must remain honest when it does not. |
| Terminal/cleanup    | Journal/outbox and bands 70–78 preserve uncertainty; restart is read-only and can settle orphan.                             | Keep terminal outcome separate from cleanup proof; preserve proof-before-fence and stale-generation diagnostics.                               |
| Resume/runtime      | Runtime inactivity can cause an offered Resume to reject.                                                                    | Explicit Resume must be authorized and eligibility-gated; no bootstrap/replay is implied by this report.                                       |

### Failure and diagnostic matrix

| Scenario                   | Evidence/current behavior                                                                                                                                                      | Required truth/diagnostic for downstream contract                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Active progress            | Live progress is reported through managed execution observations while the child remains active; a public result read can fail on identity mismatch without stopping progress. | Read/control failure must not be rendered as terminal; progress and identity must remain correlated by execution/attempt/generation. |
| Terminal success           | Terminal/outbox repository seam exists; provider result is available only while its Manager record is resolvable.                                                              | Durable terminal evidence must be readable by authorized `executionId` after provider eviction.                                      |
| Terminal failure           | Alfie runtime status/error is provider-local; Symphony terminal evidence is separately journaled.                                                                              | Preserve failure status and diagnostic; never fabricate successful output or cleanup proof.                                          |
| Provider record eviction   | Strict `manager.getRecord(agent_id)` returns `Agent not found` after the in-memory record is absent.                                                                           | Distinguish missing live record from missing durable evidence; bounded durable fallback is a decision gate.                          |
| Restart orphaning          | Restart reconciliation does not dispatch; without terminal or proven owner evidence it records an honest orphan/uncertainty path.                                              | Keep `owner_unproven` fail-closed and diagnostic; do not auto-replay or auto-Resume.                                                 |
| Stale evidence             | Attempt/generation are carried through durable records and stale-generation outcomes.                                                                                          | Reject stale reads/controls deterministically without changing the logical execution identity.                                       |
| Unauthorized read/control  | Authorization remains a required repository/service boundary; no public identity choice may weaken it.                                                                         | Stable bounded denial diagnostic; no identity alias may bypass auth or project/thread scope.                                         |
| Inactive provider Resume   | Resume can be offered and then rejected when provider runtime is inactive.                                                                                                     | Eligibility must be checked before offering/dispatching; absence must remain actionable and truthful.                                |
| Cleanup uncertainty        | Watchdog bands 70–74 and teardown bands 75–78 record uncertainty; proof-before-fence prevents treating it as termination proof.                                                | `cleanup_uncertain`, `survivors`, and `owner_unproven` stay separate from terminal `cancelled`/success.                              |
| Missing server exit reason | Incident evidence lacks a durable root exit reason.                                                                                                                            | Report unknown/unconfirmed, not a guessed cause; add diagnostics only through a later accepted contract.                             |

### Decision classification

**Confirmed / accepted facts**

- `executionId` is the intended durable public identity, with `attemptId` and
  generation for stale-event fencing.
- The public/hidden Alfie identity mismatch and strict GET_RESULT failure are
  confirmed; GET_RESULT and steer are `agentId`-Map operations.
- Durable admission, lifecycle, terminal/outbox, restart, watchdog, and teardown
  seams exist; bands 70–78 and proof-before-fence semantics remain in force.
- Detached records are not prematurely GC'd; provider-record absence is not
  terminal proof.
- Restart orphan / `owner_unproven` is the accepted fail-closed outcome when
  proof is unavailable; no automatic replay or Resume is accepted.

**Intentional / preserved boundaries**

- No source, Alfie, test, configuration, public API, or runtime behavior is
  changed by Ticket 01.
- Provider-local `agentId` remains a correlation detail unless a later decision
  binds a compatibility mapping.
- Terminal outcome, cleanup proof, owner proof, authorization, and runtime
  eligibility remain separate axes.
- One integrated review and exactly one Supervisor final acceptance govern the
  whole project; this report is not an architecture decision.

**Unconfirmed / material open questions**

- The server-exit root cause is unconfirmed because durable exit reason is
  missing.
- The exact public identity/read contract is not selected: minimal visible
  `agentId`/text fix, an `executionId` alias in Alfie, and/or a Symphony durable
  LLM-callable result tool remain alternatives for Supervisor consultation.
- The exact post-eviction result payload, partial-output semantics, live
  containment boundary, and inactive-runtime Resume eligibility remain open.
- Crash guardian, orphan-terminal exception, durable post-restart owner receipt,
  and provider-bootstrap Resume remain candidate directions only.

### Downstream delegation inputs

Ticket 02 must remain blocked until the Supervisor answers the named question
in [handoffs/01-canonical-identity-decision-gate.md](../handoffs/01-canonical-identity-decision-gate.md):
which public identity and result-read semantics are canonical, and which
repository/provider boundary owns the mapping. The implementation packet must
then include:

1. the selected identity contract and compatibility/version/observability rule;
2. authorized bounded live-versus-durable read behavior after Manager eviction
   and restart;
3. attempt/generation stale fencing and legacy unmanaged behavior;
4. stable diagnostics for missing live record, missing durable evidence,
   unauthorized access, oversized output, and inactive runtime;
5. deterministic repository tests, controlled Alfie tests if its surface
   changes, and an isolated integration proof; and
6. an explicit non-goal excluding automatic replay or Resume.

Minimum seam assertions are: public detached handle and hidden details resolve
the same logical execution (or a bounded mapping); terminal result survives
provider-record eviction when durable evidence exists; missing evidence remains
unknown/orphan; duplicate/stale/unauthorized/oversized/inactive cases are
bounded and diagnostic; and reconnect/restart never dispatches a child.

### No-source scope audit

- Changed/planned files for this acceptance: this Ticket 01 report,
  `PROJECT.md`, and the bounded Supervisor handoff only.
- Not changed: Symphony source/tests/configuration, Alfie source/package/pin,
  spec, decisions, research records, terms, design tree, or Tickets 02–06.
- No source implementation frontier is open. The only next action is the
  named planning decision consultation.

## Acceptance criteria

- **T01-AC1:** Confirm the Symphony base and Alfie pin, repository cleanliness
  for the assigned read-only worktree, and exact source locators.
- **T01-AC2:** Reproduce or deterministically demonstrate that public detached
  output exposes `executionId` while hidden details/provider lookup use
  `agentId`, and show the strict GET_RESULT failure behavior.
- **T01-AC3:** Map durable admission, terminal/outbox, restart, watchdog, and
  teardown seams, including bands 70–78 and proof-before-fence boundaries.
- **T01-AC4:** Build a matrix covering active progress, terminal success/fail,
  provider record eviction, restart orphaning, stale evidence, unauthorized
  reads/controls, inactive provider Resume, and cleanup uncertainty.
- **T01-AC5:** Separate settled invariants from open gates; explicitly record
  the four candidate directions without selecting them.
- **T01-AC6:** Produce delegation-ready inputs for Ticket 02 and identify the
  minimum testing seams and required failure/diagnostic assertions.
- **T01-AC7:** Make no source, test, configuration, Alfie, or existing-project
  edits; research remains supporting evidence.

## Testing / evidence seam

Read-only source inspection plus existing focused tests/fixtures. If a runtime
reproduction is required, use an isolated disposable fixture and record exact
commands/environment; do not use the user's live Synara/Pi instance. Do not
claim a real-Pi acceptance result from a fake or from source inspection alone.

## Required deliverables

- incident reproduction with public/hidden/durable identity values;
- source-evidence locator table;
- current seam map and failure matrix;
- settled/open decision table;
- downstream Ticket-02 delegation packet with dependencies and blocked gates.

## Implementation Report

Not applicable as source implementation. The accepted planning change is this
criterion-level report plus the Project Home routing update and named handoff.

- **Change surface:** planning only; no source edits.
- **Evidence:** exact locators and matrix above; Symphony base and pinned Alfie
  cleanliness checks recorded under T01-AC1.
- **Failure surface:** strict `Agent not found`, inactive-runtime Resume
  rejection, restart orphan/owner-unproven uncertainty, cleanup uncertainty,
  and missing server exit reason are recorded without relabeling.
- **Scope audit:** source diff empty; existing projects untouched.
- **Recommendation:** keep Ticket 02 blocked until the Supervisor binds the
  canonical public identity and durable result-read semantics.

## Guardrails

Do not implement an identity alias, durable read path, provider bootstrap,
crash guardian, orphan-terminal exception, owner receipt, or Resume change.
Those are downstream decision gates.
