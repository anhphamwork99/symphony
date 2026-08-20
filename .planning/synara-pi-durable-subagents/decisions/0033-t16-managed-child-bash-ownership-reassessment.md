# Decision 0033 — Ticket 16 managed-child Bash ownership reassessment

## Status

Accepted technical direction. This is a narrow reassessment of Decision 0030,
not a final-acceptance consultation.

## Date

2026-08-20

## Consultation class

Material technical decision verification. The opt-in isolated T17-AC6
real-Pi run demonstrated a production ownership defect after Ticket 16's
final acceptance.

## Question

Must Ticket 16's parent-session `PiBashProcessSupervisor` teardown proof be
superseded for Bash processes created by an Alfie-managed child
`AgentSession`, and what ownership/failure behavior is required before the
cross-repository remediation begins?

## Governing references

- Project Home.
- Decision 0027 — Ticket-16 bands 75–78, live-owned-only authority,
  proof-before-fence, and restart `owner_unproven`.
- Decision 0028 — destructive real-Pi verification remains isolated/manual;
  deterministic fixtures remain CI evidence.
- Decision 0030 — accepted Ticket-16 baseline, reassessed only as specified
  here.
- Decision 0031 and Decision 0032 — T17-AC6's mandatory three-leg evidence
  boundary and owner-approved seam.
- [Ticket-17 child Bash ownership handoff](../handoffs/17-child-bash-supervisor-ownership-gap.md).

## Evidence reconciliation

- The isolated real-Pi T17-AC6 discovery run established that an Alfie child
  `AgentSession` uses SDK builtin raw-spawn Bash, not the parent-session
  `PiBashProcessSupervisor`.
- Symphony's `PiAdapter` supplies its supervisor only to the parent custom
  Bash tool. `piSubagentProcessTeardown` then treats a successful
  parent-supervisor teardown as sufficient for band 76 and proof-before-fence.
- Alfie's child `AgentSession` has no corresponding custom Bash supervisor.
  A TERM-ignoring child Bash was therefore live after the parent supervisor
  reported success, Ticket 16 wrote band 76, the card settled `cancelled`,
  and the generation advanced.
- The child PID was absent from the parent supervisor's spawn observer before
  teardown. This is a production ownership mismatch, not PID reuse, a zombie,
  or a test-fixture defect.

## Finding

Decision 0030's parent-session supervisor proof covers only processes the
parent supervisor actually observes and owns. It does not cover a Bash process
created by a managed Alfie child session.

## Binding decision

1. Decision 0030 is superseded **only** for its managed-child Bash ownership
   premise. Its accepted bands 75–78, bounded survivor evidence, immutable
   journal behavior, restart posture, and proof-before-fence rule remain
   binding.
2. Each managed Alfie child execution must own exactly one child-scoped
   process supervisor. Every Bash spawn in that child must pass through it;
   parallel builtin raw-spawn Bash is prohibited for that session.
3. Alfie must retain that supervisor as the sole owner of the child process
   tree and expose an additive, opaque, identity-fenced child-owner endpoint
   through the managed-subagent bridge.
4. The endpoint must bind a request to the exact `executionId`, `attemptId`,
   `generation`, and a non-reusable owner/session instance identity. It may
   return only authenticated owner outcomes: `proven`, `survivors` with
   bounded evidence, or unavailable/owner-unproven.
5. Symphony may invoke only this endpoint for managed-child Ticket-16
   teardown. It may journal the validated result but may not enumerate, cache,
   reconstruct, register, or signal child PIDs/process groups.
6. A missing old/capability-absent, malformed, stale, mismatched, disposed,
   timed-out, or failed endpoint is non-terminal `owner_unproven` / band 78:
   no signal, no band 76, no `cancelled`, and no generation fence.
7. Band 77 is allowed only when the current identity-matched child owner
   reports teardown attempted but survivor evidence remains. It may not be
   inferred from an unavailable owner.
8. The parent `PiBashProcessSupervisor` may still tear down Bash processes it
   directly owns, but is never a fallback for a managed child.

## Preserved invariants

- Bands remain: request 75, proven 76, survivors 77, owner-unproven 78.
- Proof-before-fence remains absolute.
- Uncertain outcomes remain immutable, non-terminal, and retryable.
- Only the live actual owner discovers or signals processes.
- Restart, stale generation, and owner loss fail closed.
- Survivor evidence remains positive safe-integer, sorted, deduplicated, and
  capped at 16; it is evidence, not host-side kill authority.
- Decision 0031's three-leg AC6 evidence split remains unchanged. The isolated
  manual procedure remains the sole zero-owned-child claim; no destructive
  shared-CI claim is authorized.

## Compatibility

The endpoint is additive. New Symphony paired with old Alfie remains able to
run the ordinary child path, but it cannot prove destructive managed-child
teardown: Ticket-16 handoff yields band 78. Compatibility must never expose
PID authority or silently translate endpoint-integrity failure into
cancellation/fencing.

## Required evidence before remediation acceptance

1. Alfie: every managed child Bash spawn is observed by its child supervisor,
   not the parent supervisor; stale/mismatched/disposed endpoints have no
   process-side effect; child siblings are isolated; endpoint lifecycle is
   retained across an eligible handoff and released safely.
2. Shared contract/Symphony: capability negotiation and schema validation;
   every unavailable/invalid endpoint path produces band 78 without a parent
   supervisor call, band 76, `cancelled`, or fence; valid survivor and proven
   paths preserve bands 77 and 76 respectively.
3. Regression: a managed child launches a TERM-ignoring Bash. Its child
   supervisor observes and proves teardown; only then is band 76 emitted.
4. T17-AC6: retain the real-Pi-to-band-74 leg and Ticket-16 fixtures; rerun
   the isolated manual real-Pi leg to show the child owner, not the parent
   observer, owns the process before its term-to-kill proof.
5. Complete one feature-level independent review followed by a Supervisor
   reassessment of this decision and Decision 0030.

## Owner approval

The project owner's 2026-08-20 chat reply, `Đồng ý, triển khai đi`, approved
the exact remediation described in the preceding handoff: one supervisor per
managed child, an identity-fenced opaque endpoint, no parent fallback, and no
Synara direct PID-kill authority. This is sufficient approval to implement
and test this exact seam.

It does not authorize a change to the isolated manual-test boundary, its
isolation model, or the mandatory three-leg evidence split. Such a material
change requires fresh owner approval under Decisions 0031 and 0032.

## Prohibited alternatives

- Parent-supervisor fallback for child teardown.
- Direct Symphony PID/process-group discovery, registration, or signalling.
- One shared supervisor for multiple executions or endpoint reuse across
  identities/generations.
- Treating unknown endpoint state as proven, cancelled, fenced, or terminal.
- Collapsing bands 76–78 or broadening destructive automation.

## Downstream effect

Ticket 16 is reopened narrowly for managed-child process-tree ownership.
Ticket 17 cannot rely on Decision 0030 for AC6's manual proof until the
remediation and rerun evidence exist. All other Decision-0030 findings remain
accepted. Dependent implementation may begin only after this record is
persisted and cited as authoritative.

## Failure and rollback

A partial rollout or rollback may yield only band 78 for a child with no
current validated owner endpoint. It must not restore parent fallback or
Synara PID authority. Existing bands remain immutable and cannot be
retroactively strengthened.

## Reopening conditions

Reassess on evidence that a child Bash bypasses its supervisor; endpoint
identity can be reused; Symphony gains child PID authority; invalid endpoint
handling produces band 76/fencing; the AC6 manual boundary changes; or another
binding decision changes owned-only authority, proof-before-fence, or bands
75–78.

## Superseded record

Decision 0030 only as to its implicit managed-child Bash ownership premise.
No other Decision-0030 acceptance finding is superseded.
