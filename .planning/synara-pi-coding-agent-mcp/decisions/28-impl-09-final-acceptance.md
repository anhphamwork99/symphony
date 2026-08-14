# Decision 28: impl-09 final acceptance

**Status:** Binding Rejection
**Trigger:** Final acceptance
**Date:** 2026-08-14

## Question

Does the complete integrated impl-09 candidate on branch
`impl-09-runtime-recovery`, at reviewed HEAD `8a8907ac` with base
`1eb2ea0b`, satisfy the authoritative ticket criteria, governing lifecycle and
authority decisions, testing strategy, and repository completion requirements
such that impl-09 may be finally accepted?

## Governing references

Authoritative:

- `../PROJECT.md`
- `../spec.md`
- `../issues/impl-09-runtime-recovery.md`
- `09-dormant-pi-mcp-lifecycle.md`
- `15-project-shared-activation-user-isolated-authority.md`
- `16-project-enable-rollback-propagation.md`
- `17-project-enable-awaits-all-sessions.md`
- `18-project-enable-wait-set.md`
- `19-future-session-waits-for-enable-operation.md`
- `20-testing-strategy-governance.md`
- `21-authenticated-mcp-session-authority.md`
- `27-impl-08-final-acceptance.md`
- Repository completion requirements in `AGENTS.md`

Supporting:

- Candidate range `1eb2ea0b..8a8907ac`.
- Clean working-tree assertion.
- Focused server, contracts, typecheck, lint, and full-suite evidence supplied
  for the candidate.
- Exactly one independent feature-level reviewer result:
  `PASS WITH GAPS`, recommendation `ACCEPT`.

## Evidence scope

The candidate is branch `impl-09-runtime-recovery`, base `1eb2ea0b`, at HEAD
`8a8907ac`, with a reported clean working tree. It includes the integrated
runtime-recovery implementation, ticket closure, and type corrections.

The supplied final verification is:

- focused server tests: 195/195 passed;
- contracts tests: 204/204 passed;
- workspace typecheck: 7/7 packages passed;
- lint: 0 errors and 434 warnings;
- full `bun run test`: all packages passed except two web React Compiler compile
  tests for `Sidebar.tsx` and `TraitsPicker.tsx`, each timing out at 240
  seconds; and
- no web files changed in the candidate.

The independent reviewer reproduced the focused, typecheck, and lint evidence.
It found no material unmet acceptance criterion and recommended acceptance. Its
reported findings were:

- F1, medium: startup recovery is tested through a fake orchestration seam
  rather than the real engine/server startup boundary;
- F2, low: a layering import;
- F3, low: a transient timeout timer that is not cleared after the competing
  operation wins;
- F4, low: per-turn read-model cost is not measured; and
- F5/F6: informational findings.

No successful `bun fmt` result was supplied.

## Criterion-by-criterion assessment

### AC1 — Durable startup/replay recovery

**Verdict: pass.**

The candidate recovers durable pending operations after projection bootstrap
and before command readiness. It uses the persisted operation identity and
absolute deadline without extending that deadline.

A pending enable is settled as a journal-first failed-disabled rollback because
pre-restart runtimes cannot safely be re-proven without activation replay. A
pending disable converges to succeeded-disabled because recreated runtimes begin
dormant. Recovery does not invoke provider or MCP activation.

Recovery re-reads durable state before settlement, ignores stale work, derives
deterministic command and activity identities, and makes a second recovery pass
a no-op. Legacy pending operations without sufficient recovery identity fail
startup with a bounded diagnostic rather than being guessed through.

This conforms to Decisions 16–18 and does not reopen impl-08’s accepted
wait-set, deadline, rollback, or exactly-once invariants.

### AC1 — Future-session behavior during a pending operation

**Verdict: pass.**

A newly ensured, resumed, or recreated session does not join or alter the
immutable operation wait-set. While either enable or disable is pending, Synara
MCP remains dormant and no activation is attempted. The normal coding-agent
turn may continue with its existing tool surface.

After the operation becomes terminal, convergence is retried at the next safe
session-ensure boundary. Only terminal succeeded-enabled state permits
activation. Failed, disabled, missing-project, and no-operation states remain
dormant.

This is consistent with Decision 19 when read together with Decision 09’s
safe-boundary and stable-tool-surface requirements. “Wait” applies to Synara MCP
activation; it does not require aborting or unnecessarily blocking unrelated
coding-agent work.

### AC2 — Fresh subject-bound authority and runtime generations

**Verdict: pass.**

Terminal enabled convergence derives the expected generation from the newly
ensured session’s own `threadId` and `updatedAt`, rather than reusing a captured
wait-set generation. Activation travels through the established provider
enable boundary, where fresh session-local subject authority, credentials, and
generation checks remain mandatory.

Recreated sessions begin dormant. No candidate evidence shows reuse of an old
credential, callback, catalog, transport, or runtime-generation authority.

This conforms to Decisions 09, 15, and 21.

### AC2 — Stale work, duplicate terminals, and replay suppression

**Verdict: pass.**

Recovery is guarded by project, request, operation-generation, recovery
identity, aggregate status, and deterministic receipt-backed command/activity
identity. Stale settlement stops without journaling, repeated recovery does not
duplicate terminal activity, and no provider/MCP activation call is replayed.

Session convergence is read-only with respect to project state, so stale or
duplicate convergence cannot restore enabled state or settle an operation.

### Approved testing seams

**Verdict: pass with a non-blocking evidence gap.**

Focused tests exercise the recovery decider/orchestration seam, durable identity
and CAS rules, stale and duplicate settlement, persisted-deadline handling,
pending enable and disable outcomes, future-session states, fresh generation
selection, degraded activation, and ProviderCommandReactor ordering.

F1 remains a meaningful medium-confidence gap: startup recovery is not exercised
through a real engine/server-start integration fixture. The source wiring,
readiness ordering, focused behavior tests, typecheck, and independent review
provide enough evidence that this gap does not independently disprove an
acceptance criterion. It remains a reassessment trigger if real startup
execution differs from the tested seam.

The existing provider-boundary generation and authority tests remain applicable
because impl-09 uses the established public provider activation boundary rather
than introducing a replacement authority path.

### Governing lifecycle and authority invariants

**Verdict: pass.**

The candidate starts recreated runtimes dormant, performs no recovery activation
replay, does not share authority between sessions, does not add future sessions
to an immutable wait-set, preserves safe-boundary activation, and cannot use a
stale operation to restore enabled state.

No material evidence requires Decisions 09, 15–21, or impl-08 Acceptance
Decision 27 to be reopened.

### Focused verification, type safety, and lint

**Verdict: pass.**

The supplied focused server and contracts suites pass. Workspace typecheck
passes all seven packages. Lint exits with zero errors; its 434 warnings are
repository debt rather than a failed lint gate.

### Full-suite attribution

**Verdict: pass for candidate attribution.**

The two remaining full-suite failures are 240-second timeouts in web React
Compiler compile tests for `Sidebar.tsx` and `TraitsPicker.tsx`. The candidate
has no web changes, and no evidence connects server-side recovery behavior to
those compiler tests.

They are therefore classified as unrelated full-suite timeouts, not impl-09
candidate failures. This classification must be reassessed if dependency or
reproduction evidence later links either timeout to `1eb2ea0b..8a8907ac`.

### Repository completion requirements

**Verdict: reject.**

The repository contract requires all of `bun fmt`, `bun lint`, and
`bun typecheck` to pass before a task is considered completed. Lint and
typecheck evidence was supplied, but no successful `bun fmt` result was
provided.

A clean working tree proves only that no uncommitted files remain. It does not
prove that running the repository formatter would leave the candidate
unchanged. Lint success is likewise not a substitute for the separately
required formatter pass.

Final acceptance cannot pass with this mandatory evidence missing.

## Decision

Reject final acceptance of impl-09 at reviewed HEAD `8a8907ac`.

The implementation evidence satisfies the substantive impl-09 behavior and
approved AC1/AC2 seams. The rejection is based solely on the missing mandatory
`bun fmt` completion evidence. The two web React Compiler timeouts are unrelated
to the candidate and are not grounds for this rejection.

This is a binding rejection of the supplied final-acceptance package, not a
finding that the recovery design or implementation must be rewritten.

## Non-blocking findings and residual risks

1. Startup recovery lacks a test through the real engine/server-start boundary.
   Focused fake-seam coverage verifies the recovery behavior but leaves wiring,
   layer construction, and actual readiness failure propagation less directly
   proven.

2. The reported low-severity layering import adds coupling but does not
   presently violate an accepted runtime invariant.

3. The convergence timeout uses a transient timer that is not cleared when
   activation wins first. This may keep one short-lived timer alive for up to
   the 30-second bound, but supplied evidence does not show unbounded growth,
   duplicate activation, state mutation, or correctness failure.

4. Per-turn read-model cost has not been measured. No evidence currently shows
   unacceptable latency or load behavior, but the project’s performance-first
   priority makes material cost growth a reassessment trigger.

5. F5 and F6 remain informational as classified by the independent reviewer.
   Their detailed substance was not supplied in this consultation, so this
   record does not reinterpret them or elevate them without contrary evidence.

6. Startup recovery dispatches the durable project terminal state before its
   terminal activity. A crash in that interval may leave the work log without
   the corresponding terminal activity. This documented crash window is not an
   impl-09 AC failure on the evidence reviewed, but concrete duplicate or
   missing-terminal behavior should reopen the decision.

## Rejected alternatives

- Accepting the ticket without the mandatory formatter result merely because
  the tree is clean.
- Treating successful lint as proof that the separate formatter command passes.
- Treating the two off-surface web compiler timeouts as impl-09 regressions
  without dependency or reproduction evidence.
- Reopening the owner-approved dormant lifecycle, immutable wait-set,
  rollback, future-session, testing, or subject-authority decisions without
  contrary material evidence.
- Requiring a source redesign solely for reviewer findings F1–F6 when the
  supplied reviewer and focused evidence identify no material behavioral
  failure.
- Issuing a conditional acceptance. Final acceptance must be an unconditional
  pass or reject.

## Assumptions

- The supplied branch, base, HEAD, and clean-tree identity are accurate.
- All reported verification results refer to exactly HEAD `8a8907ac`.
- The independent reviewer examined the complete integrated ticket candidate
  and is independent of its implementation.
- The two web compiler timeout tests do not consume or depend on the changed
  server recovery modules.
- The focused count of 195/195 is the final reviewed server test scope. The
  larger historical focused count recorded in the ticket represents a
  differently composed earlier verification set rather than a contradictory
  failure count.
- Existing provider tests establishing fresh credential, callback, catalog, and
  runtime-generation isolation remain valid at this HEAD.

## Residual uncertainty

No formatter result is available, so formatter conformance at `8a8907ac` is
unknown.

F1 leaves actual server startup/readiness integration less directly proven than
the recovery function itself. F3 and F4 leave bounded resource-lifetime and
performance uncertainty. No supplied evidence demonstrates a current accepted-
invariant violation from those findings.

The exact content of reviewer findings F5 and F6 was not supplied; only their
informational classification was available.

## Downstream effect

- Persist and track this record as
  `.planning/synara-pi-coding-agent-mcp/decisions/28-impl-09-final-acceptance.md`.
- Do not represent impl-09 as finally accepted at `8a8907ac`.
- Do not reopen or rewrite the accepted impl-08 behavior or Decisions 09 and
  15–21 based on this rejection.
- Obtain a successful `bun fmt` result against the exact candidate.
- If `bun fmt` completes without changing the candidate, the new evidence may
  trigger a reassessment of this rejection.
- If formatting changes are required, the resulting commit is a new candidate
  and must receive verification proportionate to its changed surface.
- No behavioral implementation correction is required unless new evidence
  disproves one of the criteria assessed above.

## Failure or rollback implications

This rejection does not authorize source changes and does not roll back any
existing commit. It only prevents the reviewed candidate from receiving final
acceptance under the current evidence package.

If the candidate is changed, reverted, or rebuilt at another HEAD, the
behavioral findings in this record may be used as supporting evidence but do
not automatically accept the altered candidate.

## Reopening conditions

Reassess this decision if:

- `bun fmt` passes at exactly HEAD `8a8907ac` without modifying the candidate;
- formatter-required changes produce a new candidate with appropriate
  verification;
- focused server, contracts, typecheck, or lint evidence is shown to be stale or
  inaccurate;
- either web React Compiler timeout is shown to depend on the impl-09 changes;
- real server startup fails to run recovery before command readiness;
- a pending operation extends its persisted absolute deadline;
- recovery replays provider or MCP activation;
- a future session joins or changes the immutable operation wait-set;
- a stale credential, callback, catalog, or runtime generation can reattach;
- stale work restores enabled state or produces duplicate terminal activity;
- the transient timeout timer causes material resource retention under load;
- measured read-model cost violates evidenced operational requirements; or
- any governing evidence used by this decision is shown to be contradictory or
  inaccurate.

## Superseded records

None.

Decision 27 remains authoritative for impl-08. Decisions 09 and 15–21 remain
authoritative and are not reopened or superseded by this rejection.
