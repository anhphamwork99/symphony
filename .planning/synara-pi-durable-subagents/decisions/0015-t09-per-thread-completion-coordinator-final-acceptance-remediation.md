# Decision 0015 — Ticket 09 final acceptance: remediation required

## Status

**NEEDS REMEDIATION — NOT ACCEPTED**

This is the binding final-acceptance verdict for the reviewed Ticket 09
candidate. Decisions 0001–0014 remain authoritative and unchanged.

## Date

2026-08-18

## Accepted candidate

**None.**

Candidate evaluated but not accepted:

- Symphony `98b9e990`, `b4a9295b`, `80cfafa1`, `4fa55929`, `2c1b8d7f`,
  and `86052771`.
- Alfie `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`
  (`@alfie/pi-subagents@0.14.0-alfie.1`).
- Review artifact commit `179f8fc6`.

Uncommitted Ticket 13 changes were outside this decision and were not treated
as Ticket 09 evidence.

## Question

Does the committed Ticket 09 candidate satisfy T09-AC1 through T09-AC6 under
the owner-approved Testing Seams and Decisions 0001–0014, particularly Decision
0013's requirements to wire the production completion pump, consume the retry
policy, preserve at most one outstanding follow-up per thread, defer active
parents, and use stable outbox identity for at-least-once parent effects?

The consultation must also settle independent-review findings F1–F4 and
determine whether F1's `delivered`-before-effect crash window is compatible
with T09-AC4 and Decision 0013.

## Governing references

Authoritative:

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/issues/09-per-thread-completion-coordinator.md`
- `.planning/synara-pi-durable-subagents/reviews/09-per-thread-completion-coordinator-review.md`
- `.planning/synara-pi-durable-subagents/decisions/0013-t08-durable-completion-outbox-final-acceptance.md`
- `.planning/synara-pi-durable-subagents/decisions/0014-t10-restart-reconciliation-final-acceptance.md`
- `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`
- `.planning/synara-pi-durable-subagents/decisions/0008-t22-real-bounded-foreground-attachment-final-acceptance-remediation.md`

Supporting candidate evidence:

- Symphony commits `98b9e990`, `b4a9295b`, `80cfafa1`, `4fa55929`,
  `2c1b8d7f`, and `86052771`.
- Alfie commit `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`.

Decision 0014 governs Ticket 10 only. Its acceptance is not reopened by this
Ticket 09 verdict.

## Lifecycle honored

The frontier advanced from Ticket 08 to Ticket 09 under Decision 0013 → the
complete Ticket 09 candidate was committed → the owner-approved Testing Seams
were used → the Implementation Report supplied criterion-level and failure
evidence → exactly one independent feature-level review completed with
PASS/HIGH confidence and findings F1–F4 → exactly one Project Supervisor
final-acceptance consultation was performed → **NEEDS REMEDIATION**.

The independent reviewer's PASS is evidence, not acceptance authority. This
rejection is based on F1's conflict with a binding inherited invariant and
T09-AC4, not on a second review or unrelated working-tree changes.

## Settled verdict

**Ticket 09 NEEDS REMEDIATION.**

| Criterion | Verdict | Basis |
|---|---|---|
| T09-AC1 | PASS | Per-thread windows produce one bounded follow-up containing summaries, execution identities, and stable outbox identities. |
| T09-AC2 | PASS | At most one outstanding follow-up exists per thread; later batches wait and threads remain isolated. |
| T09-AC3 | PASS | Parent activity is the sole delivery gate; busy deferral changes no delivery state or retry accounting. |
| T09-AC4 | **FAIL** | Process death after rows become `delivered` and before `sendFollowUp` reaches the parent leaves a delivered/unacknowledged row outside all recovery scans. The parent effect can be permanently lost. |
| T09-AC5 | PASS | Managed suppression requires negotiated ownership plus durable terminal/outbox acknowledgement; older hosts, timeout, and persistence failure retain legacy notification. |
| T09-AC6 | PASS | Generation fencing supersedes stale entries before parent effect while preserving readable evidence. |

## Evidence basis

The independent review returned PASS with HIGH confidence and reproduced:

- coordinator acceptance 10/10;
- real-Pi managed/legacy ownership acceptance 2/2;
- completion-outbox regression 11/11;
- Alfie touched suites 29/29;
- committed-baseline repository evidence 12/12;
- per-file standalone real-Pi/wallclock suites under Decision 0008;
- workspace 381 files / 4,603 passed / zero failed / 17 skipped;
- formatting pass, lint zero errors, seven of seven package typechecks; and
- byte-exact Alfie provenance at `489acd626`.

The blocking finding follows directly from the production ordering:

1. selected rows transition to `delivered`;
2. the coordinator then calls `sendFollowUp`;
3. recoverable scans select `pending` and within-budget `failed_retryable`;
4. Ticket 10 does not redrive `delivered` rows; therefore
5. process death between steps 1 and 2 can permanently suppress the effect.

Passing tests for explicit promise rejection do not prove this process-death
boundary because rejection handling cannot run after process death.

## Findings and dispositions

### F1 — BLOCKING: delivered-before-effect crash window

**Disposition: remediation required before Ticket 09 acceptance.**

F1 contradicts T09-AC4, which requires delivery failure to remain retryable,
and Decision 0013's stable-identity, at-least-once parent-effect obligation.
At-least-once permits redelivery attempts but not a durable state that
permanently loses an effect.

### Binding minimum remediation direction

Ticket 09 must establish a recoverable durable dispatch protocol:

1. A process crash before confirmed parent-effect acceptance leaves the batch
   durably eligible for recovery.
2. Recovery preserves the same stable outbox identities as parent-effect keys.
3. Redrive after uncertain dispatch cannot duplicate follow-up content. The
   parent boundary must enforce stable-identity idempotency or durably prove
   prior acceptance before retry/release.
4. Durable dispatch ownership may use a recoverable claim/lease or an
   outcome-equivalent standard mechanism. Owner loss makes unfinished work
   recoverable; it cannot strand work in `delivered`.
5. At most one outstanding managed follow-up per parent thread is preserved
   across recovery.
6. Active-parent deferral, generation fencing, retry-policy consumption,
   bounded summaries, execution/delivery separation, and evidence readability
   remain unchanged.
7. Recovery is wired on Ticket 09's production path and cannot silently expand
   accepted Ticket 10 behavior.

The schema/mechanism is not prescribed. A durable claim/lease plus idempotent
parent dispatch, or an outcome-equivalent stable-dedupe recovery rule, is
acceptable.

### Required remediation evidence

Deterministic fault injection must prove:

- owner loss after durable claim/state change but before dispatch → recovery
  finds the batch and exactly one effect is eventually accepted;
- owner loss after parent acceptance but before local finalization → recovery
  uses the same identity, creates no duplicate content, and settles;
- later same-thread completions remain parked until recovered work settles;
- another thread remains independently deliverable;
- busy parent deferral consumes no retry budget;
- stale generations supersede with zero parent effect;
- child outcomes remain unchanged through claim, retry, recovery,
  acknowledgement, and supersession;
- retry exhaustion preserves evidence;
- production startup/recovery invokes the remediated behavior; and
- coordinator, outbox, mixed-version real-Pi, and Decision 0008 standalone
  regressions remain green.

Merely rescanning `delivered` rows is insufficient unless already-accepted
effects are also proven nonduplicating.

### F2 — LOW: Implementation Report reverses the crash ordering

**Disposition:** confirmed; correct with remediation. Source is
`delivered` before parent effect, not parent effect before `delivered`. The
persisted review remains historical evidence and must not be rewritten.

### F3 — INFO: wallclock evidence remains method-sensitive

**Disposition:** no remediation. Decision 0008's clean-environment,
per-file standalone wallclock invocation remains mandatory. Do not widen the
timing envelope without re-adjudication.

### F4 — INFO: settle attribution is thread-level

**Disposition:** accepted on current evidence. Settlement releases later work
only after the managed prompt is submitted; one-outstanding remains enforced.
Reopen if thread-level settlement can acknowledge before acceptance, permit
concurrent batches, or duplicate content.

## Rejected alternatives

- Accepting F1 as a residual risk with a later owner: it violates a current
  criterion and inherited invariant.
- Treating an identity printed in follow-up text as sufficient: recovery and
  the effect boundary must enforce it.
- Only moving `delivered` after `sendFollowUp`: this creates a duplicate window
  after parent acceptance but before local persistence.
- Only rescanning delivered/unacknowledged rows: unconditional redrive can
  duplicate an already-accepted effect.
- Requiring speculative distributed infrastructure: only a recoverable claim
  and stable-idempotent boundary, or an outcome-equivalent mechanism, is
  required.
- Assigning remediation to Ticket 10: Ticket 10 is accepted and does not own
  Ticket 09's parent-effect dispatch protocol.
- Rejecting solely for F3 or F4: current governed evidence satisfies those
  constraints.
- Accepting solely because the reviewer returned PASS: reviewer evidence is
  not final acceptance and F1 explicitly required Supervisor adjudication.

## Assumptions and residual uncertainty

- Review evidence corresponds to the listed committed candidate.
- Alfie artifacts match the reviewed provenance pin.
- SQLite guarded transitions behave as exercised by focused tests.
- `sendFollowUp` has no undocumented atomic transaction with the outbox.
- Ticket 10 does not recover delivered/unacknowledged Ticket 09 dispatches.
- The provider prompt API's native idempotency capabilities remain unknown.
- The simplest identity (existing outbox IDs versus a deterministic batch ID)
  is not prescribed.
- Real-world crash probability does not alter the correctness obligation.

No publication, deployment, release, or external side effect is accepted or
authorized.

## Downstream effect and frontier

- Ticket 09 remains implemented but not accepted; T09-AC4 remains open.
- Ticket 11 remains blocked by Ticket 09.
- Ticket 10 remains accepted under Decision 0014 and is not reopened.
- Decisions 0001–0014 remain binding.
- Ticket 13 is neither reviewed nor accepted by this decision.
- No dependent work may cite Ticket 09 as accepted until remediation is
  accepted through the project lifecycle.

## Failure and rollback implications

The rejected candidate must not be represented as crash-safe at-least-once
completion delivery.

Rollback must preserve terminal/outbox evidence, must not claim undriven
entries delivered or acknowledged, and must not rewrite child outcomes.
Mixed-version fallback remains mandatory: legacy notifications are suppressed
only after negotiated capability and durable ownership acknowledgement.

Rolling Alfie back from `0.14.0-alfie.1` requires treating the extension as
lacking `completion-delivery-ownership`.

## Reopening conditions

Supersede this rejection only through a new numbered Decision Record after a
committed remediation proves:

- both crash positions around parent-effect acceptance are closed;
- unfinished ownership is recoverable after process loss;
- uncertain redrive uses stable identity without duplicate content;
- one outstanding managed follow-up per thread survives restart/recovery;
- active-parent deferral consumes no retry budget;
- retry policy remains consumed in production;
- stale generations produce no effect;
- execution outcome remains independent;
- evidence remains readable;
- managed/legacy ownership and provenance remain valid;
- focused, failure, real-Pi, and Decision 0008 evidence passes; and
- the Implementation Report accurately documents ordering and recovery.

Do not edit this record to convert rejection into acceptance.
