# Decision 0007 — Ticket 06 batching fixture causal control and candidate rebaseline

## Status

**Binding Decision — accepted.**

This record persists the Project Supervisor's material technical decision. It is
not Ticket 06 final acceptance and does not consume the project's reserved final
Supervisor consultation.

## Date and trigger

- **Date:** 2026-08-28
- **Trigger:** Material technical decision verification after the owner requested
  `spawn supervisor để chốt các quyết định kỹ thuật nhé`.
- **Consultation class:** Technical decision verification/escalation, not final
  acceptance.

## Question

How Ticket 06 must respond to the WP-02 attempt-3 T17-AC4 failure: ownership of
the failure, the permitted correction, the Symphony candidate and evidence
rebaseline, correction of inaccurate derivative evidence, and authority for
subsequent WP-02 through final-acceptance gates.

## Governing references

- [Project Home](../PROJECT.md) — authoritative router and Project Contract.
- [Decision 0001](0001-project-charter-and-inherited-authority.md) — charter and
  inherited invariants.
- [Ticket 06 PLAN](../plans/06-integrated-real-pi-acceptance/PLAN.md) and
  [WP-02](../plans/06-integrated-real-pi-acceptance/WP-02-non-destructive-real-pi-evidence.md)
  — current execution contract, superseded only for the aspects settled here.
- Attempt evidence:
  `../plans/06-integrated-real-pi-acceptance/evidence/WP-02-attempt-03-realpi-acceptance.log`,
  `WP-02-nondestructive-disposition.md`, and `WP-02-realpi-provenance.txt`.
- Exact frozen-candidate source:
  `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`,
  `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`, and
  `apps/server/src/provider/piSubagentCompletionCoordinator.ts` at Symphony
  `12fd6686edc26a3fa0382e8bdeb83a1be8045539`.

## Evidence considered

1. Attempt 3 ran the integrated leg exactly once with Node and a fresh
   process-level HOME. It exited 1 with 8 passing tests, one failed test, and
   only the expected manual skip.
2. Exact source establishes that the failed assertion at line 1125 is:

   ```ts
   expect(new Set(dispatchBatchIds).size).toBe(1);
   ```

   It is not the later `expect(followUps).toHaveLength(1)` assertion.
3. Both completion outbox rows were acknowledged, but their durable
   `dispatchBatchId` values differed. The test stopped before reading a
   two-member batch and before replaying or counting public follow-up events.
4. Production opens a fixed 5,000 ms completion window when the first terminal
   completion becomes pending. A terminal arriving outside that window
   correctly forms a later batch.
5. Each deterministic slow child delays its response by 4,000 ms, while the
   second child starts only after the first admission and another parent-driver
   request with an approximately 2,000 ms delay. The fixture therefore does not
   causally guarantee that both terminal arrivals occur inside one 5,000 ms
   window.
6. The deterministic model helper already exposes pending-count inspection and
   idempotent release, but creation-time holding cannot be enabled on the shared
   harness because earlier stages require ordinary slow responses.
7. No evidence identifies a defect in production fixed-window batching,
   durable batch identity, retry, acknowledgement, or once-only delivery.

## Binding decisions

### D1 — Defect ownership

The attempt-3 T17-AC4 failure is a **deterministic acceptance-fixture
causal-control defect**, not a production batching-policy defect.

Two acknowledged outbox rows with two batch IDs are permissible when terminal
arrivals cross the fixed window boundary. Attempt 3 remains a valid failed
acceptance attempt, but it must not be described as proving duplicate parent
follow-ups or a production once-only delivery defect.

This does not weaken T17-AC4. The renewed fixture must still prove one durable
two-member batch and exactly one correlated public follow-up after causally
arranging both terminal arrivals inside one bounded window.

### D2 — Accepted correction and mandatory guards

Add a runtime `holdSlowResponses()` operation to `LoopbackModelServer` and its
deterministic implementation. T17-AC4 stage 4 must:

1. assert `pendingSlowResponseCount() === 0` before enabling the hold;
2. call `holdSlowResponses()` immediately before the first child-producing
   parent turn;
3. launch both children through the existing public real-Pi path without
   bypassing admission, extension, provider, or durable lifecycle processing;
4. wait with the existing bounded `waitFor` discipline until two distinct
   non-rejected admissions exist and the pending slow-response count is exactly
   two;
5. fail immediately when the pending count exceeds two;
6. release only after the exact-two barrier;
7. assert with a bounded diagnostic wait that the pending set drains to zero;
8. call idempotent `releaseSlowResponses()` unconditionally in `finally` before
   closing the stage client;
9. keep runtime holding disabled by default and apply it only to future slow
   requests after explicit activation; and
10. include the stage label and observed pending count in failure diagnostics.

Release semantics remain: clear holding before release, release every currently
pending response, remove each exactly once, and make subsequent releases no-ops.

### D3 — Exact correction scope

The behavioral correction write set is exactly:

```text
apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts
apps/server/src/provider/piSubagentRealPiAcceptance.test.ts
```

No change is authorized to the completion coordinator, the 5,000 ms window,
production batching or parent-effect semantics, contracts, persistence,
orchestration, schemas, configuration, manifests, lockfiles, migrations,
unrelated tests, or Alfie source/pin/tracked content.

The existing lockfile-driven, gitignored Alfie dependency preparation may be
reused as environment preparation. Planning, decision, and evidence records may
be amended separately without enlarging the behavioral write set.

Any need for a third behavioral file, production timing change, or Alfie change
is a new material challenge requiring reassessment.

### D4 — Candidate and evidence rebaseline

The Ticket 06 frozen Symphony candidate `12fd6686` is superseded by a new
candidate containing only the D3 correction.

The new candidate must:

1. have an acceptance-surface delta from `12fd6686` of exactly the two D3 files;
2. contain only the runtime hold operation and bounded T17-AC4 barrier/cleanup;
3. leave production coordinator and configuration byte-identical to `12fd6686`;
4. keep Alfie pinned at
   `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
   `@alfie/pi-subagents@0.15.0-alfie.6`; and
5. record its exact Symphony commit SHA before accepting behavioral evidence.

Attempts 1–3 and candidate `12fd6686` remain historical provenance.

WP-01 must rerun first at the new candidate using the same closed 19-file set
and must pass 296/296 with the same evidence and diagnostic discipline. The set
must not be broadened merely because the fixture changed.

After renewed WP-01 passes, exactly one renewed full WP-02 attempt is authorized
at the new candidate. It is a new rebaselined attempt, not a retry under spent
attempt-3 authority. It must run all five WP-02 files exactly once so final R
evidence is not mixed across candidate SHAs; use fresh process-HOME isolation,
Node where established, standalone serial execution, no concurrent tools,
expected-skip and cleanup gates, exact provenance, and no automatic retry.
Historical attempt logs remain immutable.

A nonzero exit, unexpected skip, cleanup failure, provenance drift, candidate
drift, or protected-WIP drift stops the renewed attempt.

### D5 — Evidence erratum and history preservation

Derivative evidence must be corrected to state:

> Attempt 3 failed at `piSubagentRealPiAcceptance.test.ts:1125`, where the test
> required the two acknowledged outbox rows to share one durable
> `dispatchBatchId`. The rows instead had two distinct batch IDs. The test
> stopped before the later public follow-up replay/count assertion, so attempt 3
> did not observe or establish that two public follow-up message events were
> emitted.

All raw attempt logs and their hashes remain byte-for-byte unchanged. Add a
dated erratum to disposition/provenance, correct PLAN and WP-02 summaries, and
supersede claims such as “received two follow-ups,” “one accepted batch,” or
“duplicate follow-up production defect.” Preserve exit 1 and the fact that the
authorized attempt stopped. Do not fabricate a public follow-up count.

### D6 — WP-03 and WP-04 authorization status

The prior conditional WP-03 and WP-04 owner authorizations are **unspent but
non-transferable**. They did not activate, but their predicates explicitly
named attempt-3 WP-02 PASS and then WP-03 PASS. Attempt 3 is spent and cannot
later satisfy that condition.

A renewed WP-02 PASS does not activate WP-03 automatically. Fresh explicit owner
authorization is required for exactly one WP-03 manual destructive run after
renewed WP-02 PASS. Fresh explicit owner authorization is also required for
WP-04, conditional on the newly authorized WP-03 passing.

This Decision authorizes no destructive run, PID enumeration/signalling,
TERM→KILL operation, formatter, lint, or typecheck command.

### D7 — Review and final Supervisor reservations

This consultation does not consume either the project's exactly-one integrated
review or exactly-one final Supervisor acceptance reservation. It is not WP-06
and cannot satisfy T06-AC8.

The reservations remain unavailable until this Decision is persisted, the
plan/router is reassessed, the exact candidate is frozen, renewed WP-01 and the
one renewed WP-02 pass, fresh owner-authorized WP-03 passes, fresh
authorized WP-04 passes, and a complete Implementation Report and AC1–AC8
package exist. WP-05 then consumes the one integrated review; only afterward
may WP-06 consume the one final Supervisor consultation.

## Rejected alternatives

1. Increasing or dynamically extending the production 5,000 ms window.
2. Accepting two durable batches or weakening the assertion.
3. Enabling creation-time holding for the shared harness.
4. Using sleeps, larger fixed delays, or hoping scheduler timing aligns.
5. Changing Alfie or using the user Alfie checkout.
6. Reusing old WP-01 evidence without rerunning at the new candidate.
7. Mixing old-candidate restart/resume logs into renewed final WP-02 evidence.
8. Deleting or rewriting raw failed logs.
9. Treating prior conditional WP-03/WP-04 authorization as transferable.
10. Counting this consultation as final acceptance.

## Assumptions and residual uncertainty

The correction has not yet been implemented or executed. Acceptance of its
design is not evidence that it passes. A renewed real-Pi run may still reveal a
genuine production defect after the causal precondition is deterministic; such
a result stops at challenge and may trigger reassessment. The exact new
Symphony candidate SHA is unknown until the bounded implementation commit
exists.

## Failure and rollback implications

If runtime holding changes earlier stages, leaks pending responses, strands a
response, admits extra slow requests, or makes release non-idempotent, reject
the candidate and roll back the two-file correction. Rollback returns Ticket 06
to the challenged `12fd6686` evidence state and does not authorize production
timing changes.

Any renewed WP-01 or WP-02 failure must be preserved and stops downstream work.
A failed renewed WP-02 has no automatic retry authority. No failure authorizes
production coordinator, Alfie, or destructive-boundary changes without another
material reassessment.

## Precise downstream authorization and write boundaries

After this record is tracked, downstream coordination may perform:

1. Planning reassessment writes to this Decision, Project Home/Ticket 06 router,
   PLAN, WP-01/WP-02, and affected disposition/provenance summaries.
2. The exact two-file behavioral correction in D3.
3. Renewed WP-01 and WP-02 evidence writes under the existing Ticket 06 evidence
   directory while preserving historical logs.

Not authorized:

- a third behavioral source/test file;
- production coordinator/config changes;
- Alfie changes;
- WP-03 execution;
- `bun fmt`, `bun lint`, or `bun typecheck`;
- WP-05 before the complete package;
- WP-06 final acceptance;
- closure, push, release, or deploy; or
- modification, staging, restoration, or cleanup of protected owner WIP.

Protected owner WIP must remain unstaged with aggregate diff hash:

```text
ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8
```

## Downstream effect

This record supersedes Ticket 06's evidence-only/zero-source-delta plan only for
the exact two-file fixture correction and corresponding candidate/evidence
rebaseline. Durable identity, journal-first truth, proof-before-fence, fixed
bounded batching, no automatic replay/Resume, no PID guessing or external
signalling, and the integrated-review/final-acceptance cadence remain unchanged.

Dependent implementation or renewed evidence production must not start until
this record exists, is tracked, and is cited as aspect-scoped Authoritative by
the amended Ticket 06 plan.

## Reopening conditions

Reassessment is required if implementation needs a third behavioral file; the
pending barrier cannot deterministically reach exactly two; the corrected
fixture still produces two batch IDs after simultaneous release; duplicate
public follow-ups are actually observed after the batch assertion passes;
production coordinator/config or Alfie changes appear necessary; renewed WP-01
or WP-02 contradicts accepted deterministic truth; material contrary review
evidence appears; or owner authorization changes destructive/quality-gate
boundaries.
