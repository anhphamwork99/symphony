# Decision 0009 — reassessment: structured provider-unavailable preservation

## Status

**Binding Decision — accepted.** This record persists the Project Supervisor's
material reassessment of the diagnostic-contract choice exposed by the Ticket 06
WP-02 attempt. It is an implementation authorization and evidence-routing
decision; it is not Ticket 06 final acceptance and does not consume the reserved
integrated review or final Supervisor acceptance.

- **Date:** 2026-08-28
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Ticket:** 06 — integrated real-Pi acceptance
- **Consultation class:** Project Supervisor material reassessment; not final
  acceptance
- **Prior authority:** Decisions 0002, 0003, 0006, 0007, and 0008 remain
  authoritative except for the specific structured provider-unavailable
  preservation and downstream mapping settled by this record. None is edited in
  place.
- **Final acceptance renumbering:** Because this reassessment occupies the
  previously planned Decision 0009 number, the eventual Ticket 06 final
  Supervisor acceptance record is **Decision 0010**. This record cannot satisfy
  T06-AC8 or any final-acceptance criterion.

## Question

When the exact live provider path returns its structured
`pi_subagent_managed_execution_unavailable_live` marker before a managed control
has crossed the provider-owned acceptance boundary, how must the bounded
`provider_inactive` classification survive the containment and managed-routing
seams so that terminal-first control returns the established managed read-boundary
diagnostic without claiming an accepted effect, while preserving observation,
stale, timeout, and outcome-unknown semantics?

The answer must preserve exact tuple/session/registration authority, the
synchronous provider acceptance boundary, durable terminal precedence,
proof-before-fence, bounded diagnostics, no provider identity exposure, and the
prohibitions on retry, reconstruction, replay, Resume, bootstrap, parent
fallback, and provider-ID or PID authority.

## Governing references

- [Project Home](../PROJECT.md) — authoritative project router, candidate
  discipline, gate reservations, and status precedence.
- [Decision 0002](0002-canonical-execution-identity-and-result-read-contract.md)
  — canonical `executionId`, durable current-tuple resolution, bounded managed
  reads, exact authorization, and no automatic replay or Resume.
- [Decision 0003](0003-terminal-steer-race-linearization-contract.md) — the
  synchronous Pi SDK queue-insertion acceptance boundary and canonical
  terminal-first/enqueue-first control expectations.
- [Decision 0006](0006-live-lifecycle-containment-linearization-contract.md) —
  exact live containment, provider-owned acceptance, bounded unavailable and
  outcome-unknown diagnostics, exact callback/session authority, and no
  fallback or reconstruction.
- [Decision 0007](0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md)
  — fixture correction, candidate discipline, historical-attempt preservation,
  no-retry governance, and downstream authorization boundaries.
- [Decision 0008](0008-reassessment-live-control-post-await-retirement-classification.md)
  — the accepted post-await same-registration classification correction,
  candidate2 baseline, and its exact two-file correction boundary.
- Ticket 06 [PLAN](../plans/06-integrated-real-pi-acceptance/PLAN.md), WP-01,
  WP-02, their evidence and disposition records, and the canonical identity
  acceptance source at the frozen candidate.
- The exact WP-02 terminal-first trace at candidate2
  `2afef48b008527685658801d8f0d84c79e24827d`, which expected
  `pi_subagent_read_live_record_unavailable` and received the generic
  `pi_subagent_live_lifecycle_unavailable`.

Evidence classes remain distinct: planning/provenance (P), deterministic (D),
controlled real-Pi non-destructive (R), exactly-one owner-authorized manual
destructive (M), quality gate (Q), historical supporting-only (H), and review or
acceptance (A). No one class substitutes for another.

## Finding

The WP-02 attempt at candidate2 was correctly stopped and challenged. Its
terminal-first strand proved that the provider was no longer a live control
route, and it performed zero session-steer invocations and zero SDK insertions.
The provider returned the exact structured unavailable marker. The managed
binding recognized that marker and called `markUnavailable("provider_inactive")`
without calling `markAccepted`. The containment seam then returned the bounded
public code `pi_subagent_live_lifecycle_unavailable`, but discarded the internal
reason before the managed binding could apply the established managed
read-boundary mapping. The canonical acceptance therefore received the generic
lifecycle code instead of `pi_subagent_read_live_record_unavailable`.

This is a **diagnostic value-preservation defect across a bounded internal seam**,
not evidence of a provider acceptance, Pi SDK insertion, retry, duplicate action,
terminal-state defect, or production batching defect. The attempted
`applied-without-acceptance` interpretation remains rejected. The enqueue-first
strand remains valid evidence that a synchronous accepted insertion is preserved
through ordinary same-registration retirement; it does not cure the
terminal-first diagnostic mismatch.

The reassessment is narrow. It does not reopen the accepted post-await
same-registration classification in Decision 0008, observation's absence of an
acceptance boundary, terminal journal ordering, watchdog timing, teardown proof,
generation fencing, persistence, orchestration, Alfie, or the destructive
boundary.

## Binding decision — select Option B

Select **Option B: internal `unavailableReason` preservation**.

The implementation may add the bounded internal unavailable reason to the result
flow between containment and the managed runtime binding. This is an internal
value-preservation seam only. It is not a new public diagnostic vocabulary, a
provider error passthrough, a durable field, or permission to expose provider
internals. The existing public fixed-code diagnostics remain bounded and are
selected at the managed-routing boundary.

The exact structured `provider_inactive` classification must flow as follows:

1. Durable authorization resolves the canonical `(executionId, attemptId,
   generation)` tuple and the exact session-local registration before provider
   invocation.
2. The managed control binding invokes the exact provider tool. Only the
   structured pair `isError === true` and
   `diagnosticCode === "pi_subagent_managed_execution_unavailable_live"`
   identifies this condition. Human text such as `Agent not found` is never
   parsed.
3. The binding calls `markUnavailable("provider_inactive")` and does **not** call
   `markAccepted`. It then exits through the bounded unavailable path. No value,
   accepted effect, queue insertion, retry, or second provider action is claimed.
4. Containment retains the first closed unavailable reason through callback
   failure/return handling and post-response revalidation. Its internal result
   carries the equivalent of:

   ```ts
   {
     status: "unavailable",
     diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
     unavailableReason: "provider_inactive",
   }
   ```

   `unavailableReason` is internal-only metadata and must not be serialized to
   the operator, returned as arbitrary provider text, or added to durable state.
5. The managed binding consumes that internal reason without weakening exact
   registration, session, tuple, attempt, generation, or stale-response checks.
   For a **control** whose unaccepted provider result carries
   `provider_inactive`, it maps the public result to
   `pi_subagent_read_live_record_unavailable`, with bounded safe text and
   `isError: true`, matching the established managed read-boundary contract.
6. For an **observation**, the same provider-inactive condition remains a
   bounded `pi_subagent_live_lifecycle_unavailable` result while durable result
   evidence remains readable. Observation never gains an acceptance boundary
   and never becomes `outcome_unknown`.
7. Other unavailable reasons retain their existing containment meaning. A
   replaced or invalidated exact identity remains `stale_ignored`; a control
   that may have crossed acceptance remains `outcome_unknown`; a timeout is
   reachable only through the explicit timeout marker; and no internal reason is
   allowed to change an `applied` result into a guessed success.

The mapping is therefore a translation at the managed boundary, not a change to
lifecycle truth. `provider_inactive` means no provider-owned control acceptance
was established. The managed read-boundary diagnostic means that the live record
is unavailable for that control call; it does not mean terminal truth, cleanup
proof, cancellation, owner loss, or permission to Resume.

## Complete outcome mapping

| Situation | Internal result | Public managed result | Required effect |
|---|---|---|---|
| Exact structured provider-unavailable marker on unaccepted control | `unavailable`, `unavailableReason: provider_inactive` | `pi_subagent_read_live_record_unavailable` | Zero accepted effect; zero SDK insertion; no value; no retry |
| Exact structured provider-unavailable marker on observation | `unavailable`, `unavailableReason: provider_inactive` | `pi_subagent_live_lifecycle_unavailable` while preserving bounded durable read evidence | No acceptance boundary; no `outcome_unknown` |
| Missing, disposed, mismatched, inactive, or unmarked pre-acceptance callback | `unavailable` with its closed internal reason | Existing bounded live-lifecycle unavailable mapping | No provider effect or accepted-effect claim |
| Explicit timeout before acceptance | `unavailable`, timeout reason | Existing bounded unavailable diagnostic | Timeout is not inferred from a bare throw |
| Control accepted, then response lost, throws, or times out | `outcome_unknown` with its closed reason | `pi_subagent_live_lifecycle_outcome_unknown` | No success/zero-effect claim and no retry |
| Tuple, session, registration, or epoch replacement/invalidation | `stale` | `pi_subagent_live_lifecycle_stale_ignored` | No current-state mutation, route restoration, second action, or replay |
| Same exact registration retires after accepted synchronous insertion and returns a value | `applied` | Existing applied control result | Preserve accepted effect; ordinary retirement is not stale |
| Same exact registration retires before unaccepted control completion | `unavailable` or the applicable preserved bounded reason | The applicable bounded mapping above | No accepted effect and no value exposure |

All rows preserve `executionId` as the public identity, attempt/generation as
fences, durable terminal precedence after commit, proof-before-fence, exact
opaque registration/session authority, and the ban on provider IDs, raw PIDs,
transcripts, arbitrary error text, replay, Resume, reconstruction, or fallback.

## Exact four-file correction boundary

The authorized behavioral write set is **exactly these four existing files**:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
```

The first two files may carry the bounded internal `unavailableReason` through
containment and prove its preservation. The managed binding may consume the
reason and perform the fixed public mapping. The canonical-routing test may prove
the terminal-first managed diagnostic and the unchanged observation/control
split. The correction must not touch PiAdapter, the completion coordinator,
contracts, persistence or migrations, orchestration, watchdog, teardown,
configuration, manifests, lockfiles, Alfie source or pin, any public schema, or
any unrelated test.

No fifth behavioral file, new public diagnostic code, provider text parser,
durable schema field, provider-ID/PID authority, production timing change, or
manual/destructive test harness change is authorized. A requirement for one is a
new material challenge requiring another Supervisor decision.

## Red/green and current evidence disposition

The current evidence is not acceptance and is not permission to skip the
rebaseline:

- WP-01 at candidate2 passed the same closed 19-file deterministic set,
  `19/19` files and `303/303` tests, zero failures and zero skips. Its actual
  count superseded the earlier `296 + 6 = 302` estimate; this PASS is D-class
  evidence at candidate2 only and must not be reused as proof for a new
  candidate.
- The candidate2 focused containment correction records are preserved as
  supporting red/green evidence: the red log was exit 1 with 24 tests, 6 failed
  and 18 passed, SHA-256
  `665e0bbaf0a9a25d1908c9767d2bd7ff2947d4e1844a6df80d84622300b16e3b`; the
  green log was exit 0 with 24/24 passed, SHA-256
  `84feb4814b891ce69472c74dd5596f04c9bf753fa65de18c7d31b352dd95f43b`.
- WP-02 at candidate2 is **CHALLENGED — historical supporting evidence only**.
  The integrated leg passed `10 passed, 1 expected skip`, exit 0. The
  canonical-identity leg then stopped the serial attempt at `8 passed, 1
  failed`, exit 1, at `piSubagentCanonicalIdentityAcceptance.test.ts:913`:
  expected `pi_subagent_read_live_record_unavailable`, received
  `pi_subagent_live_lifecycle_unavailable`. The later three legs were not run.
- The enqueue-first trace independently passed with `applied`, exactly one
  session steer and one SDK insertion. The terminal-first trace proved zero
  session-steer invocations and zero SDK insertions. Neither trace is relabeled
  or combined into a current R PASS.

The raw logs, hashes, provenance, and failed-attempt disposition remain
byte-identical and immutable. A derivative summary may describe the failure but
must not claim a duplicate action, a provider acceptance, two public follow-ups,
or a production lifecycle defect that the log did not establish.

## Candidate rebaseline and lineage

The correction is authorized as a new producer candidate whose sole parent is
candidate2:

- historical base: `12fd6686edc26a3fa0382e8bdeb83a1be8045539`;
- historical fixture candidate: `ffd45bd867e94c9003415f5f2e937cc9c616e399`,
  sole-parent child of the historical base;
- frozen candidate2: `2afef48b008527685658801d8f0d84c79e24827d`, sole-parent child of
  `ffd45bd`; candidate2 is the historical producer identity, not an integration
  merge;
- integration merge: `44249d81c49172e192dcf0f09ddfadc702a4b34c`, with planning
  parent `50853a3b9774e7aa5462916056195ffa536dc491` and candidate2 parent; the
  merge is integration provenance only;
- new correction candidate: an exact, recorded sole-parent child of candidate2,
  with a four-path acceptance-surface delta consisting only of the write set in
  this decision.

The new candidate SHA must be recorded before any new D or R evidence is
accepted. Its production coordinator/configuration and all unrelated source,
tests, lockfiles, and manifests must remain byte-identical to candidate2. The
Alfie pin remains
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. The merge commit, if any, is never a
producer identity.

## Required downstream sequence

After this decision is persisted and the exact four-file candidate is committed:

```text
candidate2 (2afef48b008527685658801d8f0d84c79e24827d)
  -> one exact four-file correction candidate (new recorded SHA)
  -> fresh WP-01 D collection at that SHA using the closed 19-file set
  -> only after WP-01 PASS, exactly one full five-file WP-02 R attempt
  -> fresh explicit owner authorization for WP-03 M
  -> only after WP-03 PASS, fresh explicit owner authorization for WP-04 Q
  -> complete Implementation Report and AC1–AC8 package
  -> exactly one WP-05 integrated review (G-M)
  -> exactly one WP-06 final Supervisor consultation, persisted as Decision 0010 (G-Q)
  -> WP-07 closure and routing
```

WP-01 is a fresh deterministic collection, not a reuse of candidate2's
`303/303` result. Its closed 19-file set must not be broadened merely because
this decision adds the managed binding and canonical-routing paths to the exact
four-file correction. The producer records the actual count, exact commands,
exit, skips, candidate SHA, provenance, and diagnostic coverage.

WP-02 is one complete five-file non-destructive attempt, serially, with no
automatic retry. It must use the new candidate SHA, exact Alfie provenance,
fresh process-HOME isolation, the established Node/standalone method, expected
skip and cleanup gates, and separate per-file R evidence. The five files must
all run exactly once; the first nonzero producer exit stops the attempt. A
nonzero exit, unexpected skip, cleanup failure, provenance drift, candidate
drift, or protected-WIP drift stops the attempt and preserves its raw evidence.

## Authorization reset

The prior WP-02 attempt-3 authority is **spent**. Its failure is historical and
cannot be retried, repaired by reinterpretation, or used as a current PASS.

The prior conditional WP-03 and WP-04 authorizations are **unspent but
non-transferable**. They did not activate because their predicates named a
passing attempt that did not occur; they cannot be satisfied retroactively by
this decision or by a renewed WP-02 PASS. Fresh explicit owner authorization is
required for exactly one WP-03 manual destructive run after the renewed full
five-file WP-02 PASS. Fresh explicit owner authorization is required for exactly
one WP-04 quality/report gate after that new WP-03 PASS.

This decision authorizes the four-file source correction, the new candidate
freeze, fresh WP-01, and the one conditional full five-file WP-02 route described
above. It authorizes no destructive run, PID enumeration or signalling,
TERM-to-KILL operation, formatter, lint, typecheck, integrated review, final
Supervisor acceptance, closure, push, release, or deploy.

## Rejected alternatives

1. **Option A — extend only the containment diagnostic union/array.** Rejected
   because the provider's structured `provider_inactive` reason must cross the
   containment-to-binding seam; changing only the containment public code would
   either lose the reason again or make a provider-specific mapping a false
   containment concern.
2. **Treat the generic `pi_subagent_live_lifecycle_unavailable` code as
   sufficient.** Rejected because the established managed terminal-first
   contract requires `pi_subagent_read_live_record_unavailable` and the
   canonical acceptance checks that distinction.
3. **Return `applied` because the provider returned a value or promise.**
   Rejected; only the explicit provider-owned acceptance marker linearizes a
   control, and the structured unavailable marker proves no such acceptance.
4. **Map every unavailable reason to the managed read-boundary code.** Rejected;
   exact callback absence, disposal, mismatch, timeout, observation failures,
   stale identity, and outcome-unknown conditions retain their bounded meanings.
5. **Parse `Agent not found`, arbitrary text, raw errors, or provider diagnostic
   strings.** Rejected; only the exact structured marker is authoritative.
6. **Expose `unavailableReason` publicly or persist it durably.** Rejected;
   internal reason metadata is bounded and non-authoritative, while public
   diagnostics remain fixed-code and redacted.
7. **Retry, reconstruct, Resume, bootstrap, fallback to a parent, or perform a
   second provider action.** Rejected by Decisions 0002, 0003, 0006, and 0008.
8. **Change PiAdapter, coordinator, persistence, timing, orchestration,
   configuration, Alfie, or the test harness outside the four files.** Rejected
   by the exact correction boundary.
9. **Reuse candidate2 WP-01 or WP-02 evidence as new-candidate proof.** Rejected;
   the full rebaseline must record fresh candidate SHA and fresh D/R evidence.
10. **Retry the spent WP-02 attempt or run only its missing legs.** Rejected;
    the renewed route is exactly one complete five-file attempt after fresh WP-01.
11. **Treat the enqueue-first PASS as repair of terminal-first.** Rejected;
    separate strands and evidence classes remain separately reported.
12. **Treat this reassessment as final acceptance or retain final Decision 0009.**
    Rejected; final acceptance is reserved for Decision 0010 after G-M and all
    required evidence.

## Assumptions and residual uncertainty

- The four existing files are sufficient to preserve one closed internal reason
  and perform the fixed managed-boundary mapping without a public contract,
  schema, migration, or unrelated source change.
- The pinned Alfie `.6` artifact and Pi SDK path continue to emit the exact
  structured unavailable marker used by the failing trace.
- Decision 0003's synchronous SDK insertion boundary and Decision 0008's
  same-registration post-await classification remain valid and unchanged.
- The internal reason is advisory classification metadata, not terminal truth,
  cleanup proof, owner proof, generation fencing, or authorization.
- No new candidate SHA, renewed WP-01 count, renewed WP-02 result, WP-03 M
  result, WP-04 Q result, integrated review, or final acceptance exists at the
  time of this decision. Design acceptance is not execution evidence.

## Rollback and reopening

If the correction leaks internal reason values, maps observations or other
failure classes incorrectly, claims acceptance without `markAccepted`, exposes
provider text or identity, changes the accepted same-registration/stale split,
causes a second action, or requires a fifth behavioral file, reject the candidate
and roll back the four-file correction. Rollback returns Ticket 06 to the
candidate2 challenged historical-evidence state; it does not authorize a
production timing, coordinator, Alfie, schema, or destructive-boundary change.

A renewed WP-01 or WP-02 failure must retain its raw bytes, hashes, provenance,
exit, and exact classification and must stop downstream work. A failed renewed
WP-02 has no automatic retry authority. WP-03 and WP-04 remain unactivated until
their fresh predicates and explicit owner authorizations are satisfied.

Reopen this decision only through a new numbered decision, never by editing this
record, for material evidence that: the exact four-file boundary is insufficient;
the structured marker differs at the pinned provider; a new public diagnostic or
durable field is required; the candidate delta is not exactly four paths; the
managed mapping causes an accepted-effect, stale, observation, timeout, or
outcome-unknown regression; the exact candidate/provenance drifts; a renewed
five-file R run fails reproducibly for a candidate-caused reason; or the owner
changes the reserved authorization, review, destructive, or final-acceptance
sequence.

## Downstream contract and non-authority

This record binds the Option B design, exact internal result flow, public outcome
mapping, four-file implementation boundary, candidate rebaseline, evidence
hierarchy, and gate reset. It does not itself modify source or tests, execute
WP-01/WP-02, authorize manual process teardown, consume G-M or G-Q, or establish
Ticket 06 acceptance.

Protected owner WIP remains outside this transaction, untouched and unstaged,
with the required aggregate diff hash:

```text
ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8
```
