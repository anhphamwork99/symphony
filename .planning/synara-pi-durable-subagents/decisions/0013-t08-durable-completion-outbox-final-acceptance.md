# Decision 0013 — Ticket 08 final acceptance (durable completion outbox)

## Status

**accepted** (binding; Decisions 0001–0012 remain authoritative and unchanged)

**Date:** 2026-08-18

## Accepted candidate

- Symphony implementation commit `78e58a6d` (`feat(server)+contracts: durable completion outbox for pi subagents (issue 08)`).
- Alfie unchanged at
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd`
  (`608c1c57d`; `@alfie/pi-subagents@0.13.0-alfie.1`).
- The existing Alfie provenance pin remains unchanged. Ticket 08 is a
  Symphony-side persistence and delivery-state change; it does not modify
  Alfie `package.json`, `src/index.ts`, or `src/agent-manager.ts`.
- The previously negotiated `terminal-outbox` optional capability is reused;
  no extension capability or package-version change is accepted or claimed by
  this decision.

## Question

Does the Ticket 08 candidate at Symphony `78e58a6d`, with Alfie unchanged at
`608c1c57d` / `0.13.0-alfie.1`, satisfy T08-AC1 through T08-AC6 under the
owner-approved Testing Seams, Decisions 0001, 0008, and 0012, and
Specification Implementation Decisions 21–24, such that Ticket 08 can be
accepted and the blocker-free frontier can advance to Ticket 09?

The decision must also settle whether independent-review findings F1 and F2
require Ticket 08 remediation, and whether F3's currently absent production
pump and startup-recovery drivers are valid downstream scope or an acceptance
defect.

## Governing references

- Project Home:
  `.planning/synara-pi-durable-subagents/PROJECT.md`.
- Normative Ticket 08, including T08-AC1 through T08-AC6, the owner-approved
  Testing Seams, complete Implementation Report, evidence matrix, and
  pre-review disclosures:
  `.planning/synara-pi-durable-subagents/issues/08-durable-completion-outbox.md`.
- Independent feature-level review:
  `.planning/synara-pi-durable-subagents/reviews/08-durable-completion-outbox-review.md`.
- Decision 0001, governing state-machine, orchestration, failure, diagnostic,
  idempotency, and forbidden success-equivalence evidence.
- Decision 0008, governing per-file standalone wallclock verification.
- Decision 0012, accepting Ticket 07 and requiring Ticket 08 to preserve:
  journal-first handoff at `onTerminalPersisted`; bounded terminal evidence in
  outbox content; symmetric defensive configuration bounds; and strict
  separation between execution outcome and delivery outcome.
- Specification Implementation Decisions 21 and 22, governing durable
  terminal-before-notification and separate execution/delivery state.
- Specification Implementation Decisions 23 and 24, assigning per-thread
  batching, one-outstanding-follow-up behavior, and safe-parent-boundary
  delivery to the downstream completion consumer.
- Tickets 09 and 10 for production pump/consumer and startup-recovery
  ownership.

The owner-approved Ticket 08 Testing Seams remain binding and are not reopened
by this decision. Ticket 09 owns production parent follow-up consumption,
including batching and safe-boundary behavior. Ticket 10 owns startup
reconciliation and invocation of journal-first outbox recovery.

## Lifecycle honored

Decision 0012 accepted Ticket 07 and advanced the blocker-free frontier to
Ticket 08 → Ticket 08 implementation completed at Symphony `78e58a6d`, with
Alfie unchanged → the ticket received a complete Implementation Report,
criterion-level evidence matrix, failure/diagnostic evidence, and explicit
scope disclosures → exactly one independent feature-level review completed on
2026-08-18, returning PASS with HIGH confidence for T08-AC1 through T08-AC6
and findings F1–F4 → exactly one Project Supervisor final-acceptance
consultation, activation class 2 → **ACCEPT**.

No second feature review is required or authorized by this acceptance
lifecycle.

## Settled verdict

**Accept Ticket 08. T08-AC1 through T08-AC6 all pass.**

No material evidence contradicts Decision 0012. Completion delivery is derived
from committed terminal journal truth; production terminal evidence remains
bounded when copied into the outbox; and delivery failures do not rewrite the
execution outcome.

### T08-AC1 — PASS

Terminal persistence and applicable outbox creation occur in the same
`recordTerminalEvent` transaction before `onTerminalPersisted` notification.
An outbox insertion failure rolls back journal, aggregate, and outbox changes
together. The journal-first recovery scan covers historical or equivalent
journal-without-outbox cases idempotently.

The independently reproduced AC1 evidence proves that the pending outbox entry
already exists with the same bounded summary and transcript reference when
`onTerminalPersisted` runs. The failure-direction test proves that a failed
terminal transaction leaves no terminal journal row, aggregate transition,
outbox entry, or notification.

### T08-AC2 — PASS

Completion delivery has an independently constrained state machine:
`pending`, `delivered`, `acknowledged`, `failed_retryable`, and `superseded`.
Its guarded transitions update the outbox only and do not mutate the execution
aggregate.

The independently reproduced state walk proves pending through acknowledgement,
retryable failure accounting, invalid-transition reporting, and byte-stable
execution outcome fields throughout delivery transitions and delivery
failures. This satisfies Decision 0001's prohibition on treating execution
success and delivery success as equivalent.

### T08-AC3 — PASS

The outbox uses a deterministic identity and a uniqueness constraint over
execution, attempt, and generation. Replayed terminal evidence, duplicate
outbox creation, recovery replay, and a second pump after acknowledgement
produce neither duplicate entries nor duplicate parent effects.

The independently reproduced tests also prove that a duplicate creation
attempt preserves the original terminal evidence rather than replacing it.

### T08-AC4 — PASS

A crash or interruption after terminal persistence but before delivery leaves
the execution terminal and its outbox entry durably pending. The recoverable
set includes pending and within-budget retryable entries.

The independently reproduced crash-before-delivery test proves that a later
pump can deliver and acknowledge the existing entry. The journal-first recovery
test proves that a terminal journal row lacking an outbox row is converted into
exactly one pending entry and that recovery replay creates nothing further.

### T08-AC5 — PASS

Every delivery attempt carries the stable outbox identity as its dedupe
identity. Delivery failure increments durable attempt accounting and remains
retryable within the configured budget without altering execution outcome.

The independently reproduced retry test proves two delivery requests but one
distinct parent effect, followed by acknowledgement. Retry-budget exhaustion
removes the entry from automatic recovery while preserving its delivery
evidence and the successful child outcome.

Production consumption of the configured retry limit is downstream work
because the production pump is owned by Ticket 09; resolving the configuration
now establishes the accepted policy surface without prematurely implementing
Ticket 09's consumer.

### T08-AC6 — PASS

Generation fencing occurs before delivery, with repository transition fencing
as a durable second line. A stale completion is marked superseded without a
parent delivery effect, while its terminal state, bounded summary, transcript
reference, journal row, and execution evidence remain readable.

The independently reproduced test proves zero parent requests for an entry
already stale when pumping begins, followed by normal independent delivery for
the newer attempt. Acknowledged and superseded entries cannot regress into
incompatible states.

## Evidence basis

The independent reviewer returned **PASS**, confidence **HIGH**, with all six
criteria passing and no blocking finding.

The reviewer independently reproduced:

- completion-outbox suite: 11/11;
- terminal-lifecycle suite: 13/13;
- all eight wallclock suites under Decision 0008's binding per-file standalone
  method:
  - ForegroundAcceptance 6/6;
  - ForegroundReopen 1/1;
  - ForegroundLifecycle 5/5;
  - RealExtension 11/11;
  - ProgressAcceptance 1/1;
  - IntegratedAcceptance 7/7;
  - CancellationAcceptance 2/2;
  - TerminalAcceptance 2/2;
- migration suites: 21/21, 4/4, and 3/3;
- execution-repository suite: 12/12;
- contracts: 19 files / 219 tests;
- configuration: 174/174;
- full server unit project: 4,529 passed, 7 failed, 17 skipped, with all seven
  failures confirmed as the documented pre-existing
  `CursorTextGeneration.test.ts` environment failures;
- server TypeScript checking with exit zero; and
- byte-exact Alfie provenance at `608c1c57d`.

The reviewer directly inspected the changed production surfaces and confirmed
that:

- outbox insertion is inside the terminal transaction;
- post-commit notification cannot precede durable terminal and outbox truth;
- outbox writes do not mutate the execution aggregate;
- delivery transitions are guarded and generation-fenced;
- evidence carried by current production terminal writers remains bounded;
- cancelled executions do not create completion entries;
- the Decision 0012 F3 maximum-guard follow-up is implemented; and
- the candidate introduces no Ticket 09 parent-consumer or Ticket 10 startup
  wiring outside the approved scope.

The reviewer did not repeat workspace-wide lint, formatting, or the full
seven-package typecheck. The Implementation Report records those checks as
passing; the reviewer repeated server TypeScript checking and all
criterion-bearing tests. This limitation does not create a material acceptance
gap for the changed surfaces.

## Recorded findings and dispositions

### F1 — LOW: recovery does not independently re-clamp journal metadata

`recoverCompletionOutbox` currently copies journal-extracted summary and
transcript-reference values without reapplying the terminal coordinator's
bounds.

**Disposition:** accepted as a nonblocking follow-up, not Ticket 08
remediation.

All current production writers of applicable `succeeded` or `failed` terminal
journal rows apply the accepted server-side bounds before persistence. Generic
production lifecycle writers do not currently write applicable terminal
states. Therefore, the accepted candidate does not expand bounded production
terminal evidence into unbounded outbox content and does not trigger Decision
0012's reopening condition.

**Follow-up owner:** Ticket 10. Before startup recovery is enabled in
production, Ticket 10 must explicitly disposition this hardening and should
apply the same server-side summary and transcript-reference bounds at the
journal-to-outbox recovery boundary. Any future generic terminal producer must
apply equivalent bounds before its journal content becomes recoverable outbox
content.

### F2 — LOW: recovery can transiently materialize stale terminal entries

The recovery anti-join can create a pending outbox row for a journaled stale
terminal that deliberately received no outbox row during ingest. The first
pump fences and supersedes that row with no parent effect and without changing
execution truth.

**Disposition:** accepted as a nonblocking follow-up, not Ticket 08
remediation.

T08-AC6 remains satisfied: stale evidence cannot affect the parent once it is
recognized as stale, and its original evidence remains readable. The current
behavior creates eventual superseded accounting rather than an incorrect
delivery effect.

**Follow-up owner:** Ticket 10. When startup recovery is wired, Ticket 10 must
explicitly disposition recovery applicability. The preferred simple direction
is to exclude inapplicable stale terminals in the recovery query. An
outcome-equivalent implementation is acceptable if it guarantees prompt
generation fencing, no parent effect, no outcome mutation, and no indefinitely
pending stale entries.

### F3 — INFO: no production driver invokes the pump or startup recovery

The accepted candidate supplies the durable state machine and injectable
delivery/recovery boundaries, but no production call site currently invokes
`processPendingCompletions` or `recoverCompletionOutbox`. Consequently,
completion entries remain pending and can accumulate until downstream wiring
is implemented.

**Disposition:** accepted as the binding downstream scope boundary, not a
Ticket 08 defect.

**Follow-up owners:**

- Ticket 09 must wire the production delivery pump and consume the resolved
  retry-limit policy while implementing per-thread batching, at most one
  outstanding follow-up turn per thread, and safe-parent-boundary delivery.
- Ticket 10 must invoke journal-first recovery during startup reconciliation
  and ensure recovered pending entries enter the fenced delivery path.

This dependency must be recorded in Project Home when the frontier advances.
Ticket 09 cannot be accepted if it leaves ordinary live-process pending
completions without a production pump. Ticket 10 cannot be accepted if restart
recovery remains uninvoked.

### F4 — INFO: fail-open aggregate read and at-least-once race window

The coordinator may proceed with delivery if its preliminary aggregate read
fails, while repository transition fencing remains authoritative. A resume
between the preliminary fence and the delivery call can allow an old request to
reach the parent boundary before the outbox entry settles as superseded.

**Disposition:** informational and nonblocking.

The durable state remains consistent, and every request carries the stable
dedupe identity. This is compatible with the accepted at-least-once delivery
model.

**Follow-up owner:** Ticket 09. The parent consumer must use the stable dedupe
identity as the effect key and must not infer exactly-once parent effects from
outbox delivery state alone. Any implementation that permits duplicate parent
content or treats a stale request as a fresh effect reopens this acceptance.

## Rejected alternatives

- **Require Ticket 08 remediation for F1:** rejected. No current production
  applicable-terminal writer bypasses the accepted bounds. The natural
  production exposure begins when Ticket 10 invokes startup recovery, where
  the recovery-boundary clamp can be added without reopening Ticket 08's
  complete state-machine work.

- **Ignore F1 permanently:** rejected. The recovery boundary is independently
  constructible and could become exposed to future generic terminal producers.
  Ticket 10 must disposition the hardening before enabling production startup
  recovery.

- **Require Ticket 08 remediation for F2:** rejected. Generation fencing already
  prevents parent effects and execution mutation. The transient row is an
  accounting inefficiency, not a failed acceptance criterion.

- **Leave F2 without a downstream disposition:** rejected. Startup recovery can
  make the behavior operationally recurring. Ticket 10 must either filter
  inapplicable stale terminals or establish an equivalent bounded settlement
  guarantee.

- **Reject because the pump and recovery have no production call sites:**
  rejected. The normative scope deliberately separates Ticket 08's durable
  mechanism from Ticket 09's batching/safe-boundary consumer and Ticket 10's
  startup reconciliation. Pulling those consumers into Ticket 08 would collapse
  the approved dependency order.

- **Treat the absence of production drivers as harmless after Ticket 08:**
  rejected. Until Ticket 09 and Ticket 10 wire their respective paths, pending
  entries accumulate and no parent completion is delivered. This is an
  explicit frontier dependency, not a completed end-to-end feature claim.

- **Treat delivery acknowledgement as execution success evidence:** rejected.
  The terminal journal and execution aggregate remain authoritative; Decisions
  0001 and 0012 prohibit coupling execution outcome to delivery outcome.

- **Require another independent review:** rejected. The exactly-one independent
  feature review supplied complete criterion-level evidence. A competing review
  would violate the accepted lifecycle.

- **Reassess Decision 0012:** rejected. The accepted production path begins
  completion delivery only from committed terminal journal truth, preserves
  bounded terminal evidence, and never rewrites execution outcome because
  delivery fails. None of Decision 0012's reopening conditions is met.

## Assumptions and residual uncertainty

- The independent reviewer's reproduced outputs and source inspection
  correspond to Symphony `78e58a6d`, as stated in the persisted review.
- Alfie remains clean and byte-identical to the existing
  `608c1c57d` provenance pin.
- SQLite transaction, uniqueness, and constraint behavior is the behavior
  exercised by the repository, migration, and integration suites.
- Current production applicable-terminal journal writers remain limited to the
  bounded Ticket 07 terminal-coordinator path. A future producer is not
  authorized to bypass equivalent bounds.
- Parent delivery consumers honor the stable dedupe identity. Ticket 09 must
  supply production evidence for this assumption before it is accepted.
- Startup reconciliation invokes recovery and then enters the generation-fenced
  delivery path. Ticket 10 must supply production evidence before it is
  accepted.
- The seven full-unit Cursor failures remain the documented environment
  failures and are unrelated to Ticket 08.
- Workspace-wide typecheck, lint, and formatting results are taken from the
  complete Implementation Report; the independent reviewer repeated the
  changed server type surface and criterion-bearing tests.
- All accepted commits remain local-only. Publication, deployment, release,
  and migration rollout are outside this decision.
- Long-term pruning or retention policy for acknowledged and superseded outbox
  rows is not settled by Ticket 08. Accumulation of undriven pending entries is
  instead addressed by the explicit Ticket 09/10 wiring obligations above.

## Downstream effect

- Ticket 08 is marked accepted/completed with Decision 0013 as its
  authoritative final acceptance.
- Project Home is updated to route Decision 0013 and record Tickets 01–08
  complete.
- **The blocker-free frontier advances to Ticket 09**, which must wire the
  production completion pump and implement Specification Decisions 23 and 24:
  bounded per-thread batching, at most one outstanding follow-up turn per
  thread, safe-boundary deferral, stable-dedupe parent effects, and retry-limit
  consumption.
- Ticket 10 retains ownership of startup reconciliation and must invoke
  journal-first outbox recovery. It also owns explicit disposition of F1 and
  F2 before enabling that recovery in production.
- Ticket 09 and Ticket 10 inherit the following accepted invariants:
  - completion delivery begins only from committed terminal journal truth;
  - execution outcome and completion delivery remain separate state machines;
  - delivery failure never rewrites a successful or failed child outcome;
  - bounded terminal evidence is not expanded into unbounded delivery content;
  - stable outbox identity is the parent-effect dedupe identity;
  - generation-fenced or superseded completions cannot create a fresh parent
    effect;
  - original terminal and delivery evidence remains readable after retry
    exhaustion or supersession; and
  - notification or temporary runtime absence is never execution-termination
    evidence.
- The standing lease-authority obligation from Decisions 0009–0012 remains
  unchanged for later lease consumers.
- Alfie remains pinned at
  `608c1c57d31151ae2b2c4ededd8036f56f9355cd` /
  `0.13.0-alfie.1`. No provenance manifest update is required for Ticket 08.
  Any later change to Alfie `package.json`, `src/index.ts`, or
  `src/agent-manager.ts` requires provenance re-pinning and hash recomputation.

## Failure and rollback implications

Ticket 08 is additive and migration-backed.

Rolling back the Symphony outbox repository or coordinator while retaining the
schema leaves existing outbox rows as durable but undriven data. The server
must not claim parent completion delivery or acknowledgement from those rows.

Rolling back or bypassing migration 102 while retaining Ticket 08's terminal
path removes the accepted durable outbox target. Terminal persistence must fail
closed rather than notify a parent without durable outbox truth.

Rolling back the atomic outbox insertion from `recordTerminalEvent`, or moving
notification before the transaction commits, reopens T08-AC1 and Decision
0012's journal-first guarantee.

A delivery failure, retry exhaustion, missing downstream driver, or rollback of
the consumer must never downgrade or rewrite an already-committed execution
outcome.

If Decision 0013 is reopened, Ticket 08 returns to needs-remediation and Tickets
09 and 10 become blocked wherever they depend on the accepted outbox contract.
Existing terminal and outbox evidence must be preserved during remediation or
rollback.

## Reopening conditions

Reopen through a new numbered decision, never by editing this record, only for
material evidence that:

- the accepted source differs materially from Symphony `78e58a6d` or the
  unchanged Alfie provenance differs from `608c1c57d`;
- an applicable terminal can notify a completion consumer before terminal
  journal, execution aggregate, and required outbox truth commit;
- terminal persistence can succeed without an outbox entry and without an
  idempotent journal-first recovery path;
- an outbox persistence failure can leave a notification-visible terminal
  result or avoid the required persistence failure surface;
- execution outcome and completion delivery cease to be independent state
  machines;
- delivery failure, retry exhaustion, acknowledgement, or supersession can
  rewrite execution outcome;
- a replayed terminal, duplicate outbox operation, or repeated pump can create
  duplicate outbox rows or duplicate parent content;
- delivery retries cease to carry a stable parent-effect dedupe identity;
- acknowledged or superseded delivery states can regress into deliverable
  states;
- a stale attempt or generation can create an unfenced fresh parent effect;
- supersession makes original terminal or delivery evidence unreadable;
- bounded terminal evidence is expanded into unbounded outbox, runtime-event,
  diagnostic, or parent-delivery content on a production path;
- Ticket 09's production consumer does not use the stable dedupe identity as
  its parent-effect key, permits more than one conflicting outstanding
  follow-up per thread, or interrupts an active parent instead of waiting for a
  safe boundary;
- Ticket 10's startup recovery can create indefinitely pending stale entries,
  deliver from inapplicable journal evidence, or expose unbounded recovered
  metadata;
- pending completion entries remain without a production pump after Ticket 09,
  or restart recovery remains uninvoked after Ticket 10;
- completion notification is treated as execution proof, execution success is
  treated as delivery proof, or temporary absence is treated as terminal
  evidence;
- the Alfie artifacts used by real-extension acceptance no longer match the
  accepted provenance pin;
- the binding per-file standalone wallclock suites reproducibly fail outside
  documented harness-environment noise; or
- new evidence materially contradicts Decisions 0001–0012, the owner-approved
  Testing Seams, or this record's criterion verdicts.
