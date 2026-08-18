# Decision 0019 — Ticket 11 reconnectable execution card final acceptance

## Status

**ACCEPT — Ticket 11 accepted.**

This is the exactly-one Project Supervisor final-acceptance consultation for the complete integrated Ticket 11 feature. No prior Supervisor acceptance consultation for Ticket 11 is superseded or reassessed.

## Date

2026-08-19

## Accepted candidate

The accepted Symphony source candidate consists of:

- Implementation commit `95b9e169231bbaa1c74623c6480a460e6812c3ed` (`95b9e169`).
- Review-remediation commit `339fcc04eb88cab434838516109b46d2d5bf5881` (`339fcc04`), closing R1, R2, R3, and R4.
- Post-re-review follow-up commit `c3bdbc78db8d3b2e1e519d09896e16f4a70358a7` (`c3bdbc78`), closing R4-N1.
- Planning frontier commit `1810cd469d1d9e42cb03eb5fbd21686177f938c0` records the remediation re-review PASS and pending Supervisor acceptance; it is planning evidence, not an additional behavioral candidate.

The Alfie extension is unchanged at:

- Commit `489acd6264eeedbb1a84e2ba2295af8d1b766b3b`.
- Package `@alfie/pi-subagents@0.14.0-alfie.1`.

The provenance manifest remains pinned to that Alfie commit, version, and source hashes. No Alfie contract, capability, or source change is accepted by this decision.

Uncommitted or unrelated parallel-session working-tree changes, including `apps/server/.pi/notifications.jsonl`, are excluded.

## Question

Does the complete integrated Ticket 11 candidate satisfy T11-AC1 through T11-AC8, deliver Decision 0018 finding F1, preserve Ticket 06 cancellation semantics through its single-execution refactor, and close the independent review findings sufficiently to accept Ticket 11 and unblock Ticket 12?

## Governing references

Authoritative:

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/issues/11-reconnectable-execution-card.md`
- `.planning/synara-pi-durable-subagents/reviews/11-reconnectable-execution-card-review.md`
- `.planning/synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md`
- `.planning/synara-pi-durable-subagents/decisions/0018-t09-crash-safe-per-thread-completion-coordinator-final-acceptance.md`
- Symphony commits `95b9e169231bbaa1c74623c6480a460e6812c3ed`, `339fcc04eb88cab434838516109b46d2d5bf5881`, and `c3bdbc78db8d3b2e1e519d09896e16f4a70358a7`

Aspect-scoped, unchanged boundaries:

- Decision 0006 remains authoritative for real-Pi wall-clock evidence handling.
- Decisions 0012 and 0013 remain authoritative for journal-first terminal truth and completion-outbox semantics.
- Decision 0016 remains authoritative for crash-safe parent-effect acceptance.
- Decision 0017 and Ticket 13 remain separately accepted and are not reassessed here.
- Decision 0018 remains authoritative for Ticket 09, including execution/delivery separation and F1's assignment to Ticket 11.
- Ticket 06 cancellation evidence, fencing, and acknowledgement rules remain authoritative and are not weakened by this ticket.

## Lifecycle honored

1. Ticket 11 was implemented at Symphony `95b9e169`.
2. The complete criterion-level Implementation Report and owner-approved Testing Seams were available.
3. One independent feature-level review was persisted. It returned NEEDS REMEDIATION based on reproduced blocking finding R1 and findings R2–R4.
4. Remediation `339fcc04` addressed R1–R4.
5. The same independent evidence package was appended with a clean-tree remediation re-review. It reproduced the fixes and returned PASS, with one new LOW freshness finding, R4-N1.
6. Follow-up `c3bdbc78` closed R4-N1 with a focused regression proving each changed delivery state publishes.
7. The accepted clean-tree verification ceiling includes server full suite 4696 passed at review time (4699 after R4-N1), zero failed, 17 skipped; web full suite 3892 passed; focused browser execution-card and auto-follow tests passing; typecheck 7/7 tasks; and formatting/lint checks clean.
8. This exactly-one Supervisor consultation independently adjudicates the criteria and returns ACCEPT. Reviewer PASS is evidence, not acceptance authority.

## Settled verdict

**Accept Ticket 11. Every required criterion and inherited obligation passes.**

### T11-AC1 — PASS

The existing snapshot surfaces a bounded managed-execution card aggregate containing execution, attempt, and generation identity; desired and observed lifecycle states; bounded latest-progress evidence and dropped-progress count; lease state; bounded terminal summary and opaque transcript reference; completion delivery state; and stable bounded diagnostics.

The per-thread card cap is 64, oldest records are omitted when the cap is exceeded, and card serialization excludes prompt content and raw progress JSON. Snapshot and repository reads share the same row-to-card mapping. Delivery state is joined from the unique execution/attempt/generation outbox identity without multiplying execution rows.

### T11-AC2 — PASS

Execution-card lifecycle events ride the existing thread-detail event stream and resume after the client cursor. Progress, heartbeat, and wall-time observations do not create lifecycle card events, so intermediate progress history is not replayed.

Duplicate lifecycle identities have one durable projection effect. Web projection upserts by execution identity and keeps the slice reference stable for duplicate content.

The original multi-execution defect is closed: the bridge now calls the identity-scoped `getExecutionCard(executionId)` seam rather than querying only the newest card in a thread. A real engine/repository regression proves a lifecycle transition on the older of two sibling executions publishes that execution's card.

### T11-AC3 — PASS

`thread.pi-subagent-execution-updated` is a first-class thread-detail event. It inherits the existing cursor-safe replay limit and explicit `ORCHESTRATION_RESNAPSHOT_REQUIRED` recovery path. Replay-window gaps therefore produce a visible resync diagnostic and fresh snapshot recovery rather than silent loss. Per-thread event isolation is pinned by the Ticket 11 surface test, while the generic gap and snapshot-fallback machinery is independently covered by the WebSocket snapshot/live-stream suite.

### T11-AC4 — PASS

The execution-card experience renders requested, accepted, queued, running, cancelling, cancelled, succeeded, failed, orphaned, and rejected presentation states as applicable. Tests cover all ticket-required lifecycle labels and the relevant diagnostics, terminal summary, delivery badge, cancellation affordance, acknowledgement-waiting copy, and orphan guidance.

### T11-AC5 — PASS

Thread-detail snapshot hydration and full read-model synchronization reconstruct cards from durable execution state without requiring a parent tool row or active provider session. Browser evidence proves the card renders from the snapshot and remains able to dispatch the durable execution-cancel command. Refresh and reconnect therefore recover current card truth and latest bounded progress.

### T11-AC6 — PASS

The card-cancel path is:

`thread.pi-subagent-execution.cancel` → orchestration decider → cancel-requested event → provider reactor → `ProviderService.cancelPiSubagentExecution` → Pi adapter → journal-first, generation-fenced single-execution cancellation coordinator.

Cancellation changes desired state to `cancelling` while observed state remains nonterminal until child acknowledgement or valid owner-death settlement. Duplicate cancellation is idempotent, sibling executions remain untouched, and cancel-request projection does not fabricate terminal UI state.

R1's fix ensures the live `cancelling` transition reaches the correct card even when the target is not the newest sibling execution. R2 is closed by engine-level tests proving exact identity routing with an active session and a visible `provider.subagent-execution.cancel.failed` activity with zero provider calls when no active session exists.

### T11-AC7 — PASS

Execution-card state, heartbeat-derived lease changes, resource usage, and nested tool/progress activity remain outside transcript message counting and do not trigger transcript auto-follow. The card strip is composer chrome rather than a timeline entry. Browser evidence proves repeated execution-card churn causes zero scroll re-sticks while real streaming assistant text retains the existing auto-follow behavior.

### T11-AC8 — PASS

Legacy execution is represented only by the execution-card experience's `Unmanaged (legacy)` label and never by a fabricated managed execution record. Unmanaged admission rejects before persistence.

R3 is closed: the strip now mounts when either managed cards exist or the legacy-active flag is true, making the label reachable in the live ChatView rather than only in an isolated component test. Managed cards suppress the legacy label.

The remaining legacy-detection heuristic—Pi provider plus running turn plus zero visible cards—can mislabel an unusual managed session whose cards are all cap-evicted. This is an honestly documented presentation limitation. It does not fabricate a managed record, alter durable truth, or violate T11-AC8 as accepted. A future client-visible negotiated-capability signal would be a more exact source.

### Decision 0018 F1 — PASS

Ticket 11 adds `pi_subagent_completion_delivery_succeeded` and maps receipt-correlated, accepted-and-acknowledged completion finalization to that success literal. Regression evidence proves the success path emits the success diagnostic and does not emit `pi_subagent_completion_delivery_failed`. Durable delivery state remains authoritative, preserving Decision 0018's execution/delivery separation.

### Ticket 06 cancellation-refactor equivalence — PASS

The extracted single-execution cancellation operation preserves the accepted parent-turn cancellation loop's journal-first ordering, attempt/generation fencing, acknowledgement requirements, stable command identity, bounded retry behavior, and per-child outcome ordering. The independent review found the change mechanical except for returning one result instead of pushing it into the enclosing collection. Coordinator and real-Pi cancellation suites remained green.

Ticket 11 adds single-execution targeting without weakening parent-turn cancellation or allowing one card's cancel to affect sibling executions.

## Independent review findings and dispositions

### R1 — BLOCKING: sibling execution masked by newest-only query

**Closed by `339fcc04`.**

The bridge now reads committed card truth by execution identity. The regression uses two sibling executions and proves lifecycle publication for the older sibling. This closes the original T11-AC2 and live T11-AC6 failure.

### R2 — LOW: card-cancel wiring lacked responsible-boundary coverage

**Closed by `339fcc04`.**

Engine-level tests prove exact cancel routing and the inactive-session denial activity. This satisfies Decision 0001's paired success/failure diagnostic requirement at the stable server boundary.

### R3 — LOW: legacy label unreachable in live UI

**Closed by `339fcc04`.**

ChatView mounts the strip for either managed cards or an active legacy indication. The isolated component behavior is now connected to production rendering.

### R4 — INFO: delivery-state transitions were not published

**Closed by `339fcc04`, with R4-N1 discovered during re-review.**

All four completion delivery transitions notify post-commit and re-read committed aggregate truth. Observation failure cannot fail or roll back the underlying delivery write.

### R4-N1 — LOW: later delivery transitions collided with the first sequence-zero command identity

**Closed by `c3bdbc78`.**

Delivery-band command IDs now include the committed delivery state:

`pisubcard_<execution>_<attempt>_gen<generation>_seq0_d_<deliveryState>`

A terminal → delivered → acknowledged regression proves both changed delivery states publish. Repeated same-state notifications retain one projection effect.

### R1-N2 — INFO: test title overstates deleted-row coverage

**Accepted as a cosmetic test-title limitation.**

The test proves the identity-scoped repository returns `None` for a missing execution and the bridge's `None` branch returns without dispatch. It does not synthesize a deletion notification and count events end to end. The branch is small, directly inspected, and not a material gap in lifecycle behavior.

### Environment-only ChatView failures

**Excluded as non-candidate evidence.**

Nine geometry/timing failures in the broader `ChatView.browser.tsx` file reproduce on clean pre-change trees. Ticket-specific execution-card and auto-follow browser tests pass. Reopen only if the failures become candidate-specific or the focused behavior begins failing.

No finding remains acceptance-blocking.

## Evidence basis

Independent clean-tree verification established:

- Server full suite: 4699 passed, 0 failed, 17 skipped, with `ALFIE_REPO_DIR=/Users/anhpham99/alfie`.
- Web full suite: 3892 passed.
- Focused browser execution-card and transcript auto-follow tests: passing.
- Root typecheck: 7/7 tasks.
- Formatting and lint checks: clean.
- Execution-card surface after R4-N1: 7/7.
- R4-N1 plus outbox and completion-coordinator regressions: 38/38.
- Provider reactor after R2: 135/135.
- Execution repository: 15/15.
- Cancellation coordinator: 14/14.
- Completion outbox: 11/11.
- Terminal lifecycle: 13/13.
- Completion coordinator at remediation re-review: 20/20.
- Completion dispatch batches: 13/13.

Direct source inspection confirms:

- identity-scoped `getExecutionCard` uses the same bounded card mapper and outbox join;
- bridge publication no longer uses a newest-only thread query;
- delivery-only command identities include the committed delivery state;
- cancel denial produces a visible failure activity and does not call the provider service;
- the legacy strip can mount with zero managed cards;
- the F1 success literal is asserted not to coexist with the failure literal;
- Alfie provenance remains pinned to `489acd626` / `0.14.0-alfie.1`.

## Rejected alternatives

- **Retain NEEDS REMEDIATION because the first review rejected the feature:** rejected. R1 was reproduced, remediated, and independently re-reproduced as closed; R2 and R3 were also closed.
- **Reject for R4-N1:** rejected. The finding was nonblocking freshness-only at re-review and is now behaviorally closed by `c3bdbc78`.
- **Reject for R1-N2:** rejected. It is a test-title/coverage precision issue, not contrary behavioral evidence.
- **Require a new public channel or projection mirror:** rejected. The existing bounded thread snapshot/replay surface and durable aggregate provide the required behavior with less duplicated state and fewer consistency boundaries.
- **Require a new per-thread principal authorization model:** rejected as outside Ticket 11's accepted scope. The ticket uses the existing decider and trusted provider-session boundary, matching current task-stop authorization semantics.
- **Require a new Alfie capability or extension release:** rejected. The feature is implemented entirely on the accepted host-side managed-execution surface; provenance is unchanged and independently verified.
- **Reject due to the legacy heuristic's cap-eviction edge case:** rejected. It is a bounded presentation limitation that neither fabricates managed durability nor corrupts execution truth. A negotiated capability signal is a future refinement.
- **Reject for the clean-tree ChatView geometry/timing failures:** rejected. They reproduce without the Ticket 11 candidate, while focused Ticket 11 browser behavior passes.
- **Reopen Decisions 0006, 0012, 0013, 0016, 0017, 0018, or Tickets 06/09/10:** rejected. No evidence shows that Ticket 11 weakens their accepted invariants.
- **Accept solely because the reviewer returned PASS:** rejected. Acceptance follows criterion-level adjudication, direct source inspection, committed lineage confirmation, and reproduced clean-tree evidence.
- **Require another independent review or another Supervisor consultation:** rejected. The project's exactly-one review and exactly-one final-acceptance lifecycle is complete.

## Assumptions and residual risks

- The reproduced evidence corresponds to the exact committed candidate named above and the unchanged Alfie provenance pin.
- SQLite transaction, uniqueness, and post-commit behavior remain as exercised by the suites.
- The existing generic cursor-safe stream continues to apply its explicit gap diagnostic and snapshot fallback uniformly to all members of `THREAD_DETAIL_EVENT_TYPES`.
- Card lifecycle publication is observational: dispatch failure cannot corrupt durable execution or delivery truth; a later snapshot remains authoritative.
- The 64-card per-thread bound intentionally omits older executions from the client snapshot. The legacy heuristic is not a negotiated-capability oracle and may be ambiguous in the documented all-cards-evicted edge case.
- The current authorization model has no distinct per-thread principal layer. Ticket 11 preserves the repository's existing trusted server/session boundary and does not claim a new principal model.
- The delivery-state suffix distinguishes changed delivery states. Same-state replay still has one projection effect; durable snapshot truth remains authoritative if an observational publication is rejected.
- R1-N2 remains a cosmetic test-description limitation.
- The nine clean-tree ChatView geometry/timing failures remain environment-only unless new evidence ties them specifically to the accepted candidate.
- No deployment, release, publication, schema deletion, or external side effect is authorized by this decision.

## Downstream effect

- Ticket 11 is accepted and complete at Symphony `95b9e169` + `339fcc04` + `c3bdbc78`.
- Decision 0018 F1 is delivered and no longer remains an open Ticket 11 follow-up.
- Ticket 06 cancellation semantics remain accepted and unchanged.
- Tickets 09 and 10 remain accepted and are not reopened.
- Alfie remains at `489acd626` / `0.14.0-alfie.1`.
- **Ticket 12's Ticket 11 dependency is satisfied; Ticket 12 is unblocked for production transcript/result reading.**
- Ticket 12 must preserve Decision 0018's execution-identity traceability and must not treat an opaque transcript reference as proof of execution liveness or successful delivery.
- Project Home should route Decision 0019, mark Ticket 11 complete, and advance the applicable frontier without disturbing the independently blocker-free Ticket 15 stream.

## Failure and rollback implications

Rolling back `c3bdbc78` reintroduces R4-N1: the first sequence-zero delivery publication can mask later changed delivery states through command-identity collision. Durable snapshot truth remains correct, but live delivery badges can become stale; Ticket 11 must no longer be represented as fully remediated.

Rolling back `339fcc04` reintroduces the blocking multi-execution publication defect, removes responsible-boundary cancel-denial coverage/behavior, makes the legacy label unreachable, and removes live delivery-transition publication. Ticket 11 must then return to NEEDS REMEDIATION and Ticket 12 must be treated as blocked.

Rolling back `95b9e169` removes the execution-card contract, snapshot/replay integration, durable card cancel path, web projection, auto-follow guard, and Decision 0018 F1 fix. Ticket 11 is no longer implemented.

A partial rollback must not:

- fabricate managed records for legacy executions;
- claim `cancelled` before Ticket 06 evidence settlement;
- weaken attempt/generation fencing;
- reinterpret completion delivery as execution success;
- delete terminal, cancellation, outbox, or dispatch-batch evidence;
- remove explicit replay-gap recovery while continuing to claim reconnect safety;
- allow card activity to count as transcript message arrival.

No schema rollback is needed because Ticket 11 adds no migration or projection mirror table. If host code is rolled below the accepted card surface, the unchanged Alfie extension may continue operating under its previously accepted capabilities, but Ticket 11's UI/reconnect guarantees no longer apply.

## Reopening conditions

Reopen Ticket 11 through a new numbered Decision or Reassessment if material evidence shows any of the following:

- the committed candidate differs materially from Symphony `95b9e169231bbaa1c74623c6480a460e6812c3ed`, `339fcc04eb88cab434838516109b46d2d5bf5881`, and `c3bdbc78db8d3b2e1e519d09896e16f4a70358a7`;
- Alfie provenance no longer matches `489acd6264eeedbb1a84e2ba2295af8d1b766b3b` / `0.14.0-alfie.1`;
- snapshot or push payloads become unbounded, expose prompts/full transcripts/raw progress JSON, or exceed the accepted per-thread card cap;
- lifecycle truth for any in-window sibling execution can commit without becoming recoverable through card event or authoritative snapshot;
- progress, heartbeat, wall-time, resource, card, or nested-tool churn becomes replayed as intermediate lifecycle history or triggers transcript auto-follow;
- duplicate event or command identity can create more than one projection effect;
- replay-window gaps can silently lose card changes without an explicit resync diagnostic and snapshot recovery;
- refresh or reconnect requires a live parent tool row or active provider session to reconstruct cards;
- any required lifecycle state or applicable diagnostic becomes unrenderable;
- cancellation targets the wrong execution, affects siblings, dispatches before durable intent, loses `cancelling` before evidence, repeats the underlying abort effect, or claims terminal cancellation without Ticket 06 evidence;
- an authorized cancel fails to reach the provider path, or a denial corrupts execution truth or becomes invisible;
- legacy execution is fabricated as managed, the legacy label again becomes unreachable, or managed sessions are systematically mislabeled;
- completion success again emits the failure diagnostic literal or begins driving incorrect retry/control behavior;
- delivery-state changes systematically stop publishing and stale live delivery state causes incorrect control behavior;
- Ticket 06 parent-turn cancellation behavior changes through the extracted single-execution seam;
- card activity becomes a transcript timeline entry or otherwise re-sticks the transcript;
- the focused Ticket 11 tests or clean-tree full suites reproducibly fail for candidate-specific reasons;
- accepted terminal, outbox, crash-safe completion, generation-fencing, or execution/delivery invariants are weakened;
- implementation of Ticket 12 requires changing an accepted Ticket 11 boundary materially; or
- material new evidence contradicts the ticket, owner-approved Testing Seams, independent review package, or this decision.

## Superseded records

None. The initial NEEDS REMEDIATION verdict is contained in the Ticket 11 independent review artifact and remains authoritative historical evidence of the pre-remediation candidate's defects. It is not a prior Supervisor Decision and therefore is not superseded as a numbered decision.
