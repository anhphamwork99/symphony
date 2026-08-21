# Decision 0034 — Ticket 17 integrated real-Pi final acceptance and managed-child ownership reassessment closure

## Status

**ACCEPTED.** This is the one Ticket-17 final-acceptance consultation. It also
closes the narrow Ticket-16 managed-child Bash ownership reopening created by
Decision 0033; it does not restore or permit the former parent-supervisor
ownership premise.

## Date

2026-08-21

## Consultation class

Final acceptance.

## Question

Does the isolated candidate `9b6d06cb`, based on `46b32d71`, satisfy
T17-AC1 through T17-AC9 under the approved AC6 three-leg evidence boundary and
implement the exact managed-child ownership direction of Decision 0033
sufficiently to accept Ticket 17 and close Decision 0033's narrow reopening of
Ticket 16?

## Project home and governing references

Authoritative:

- `.planning/synara-pi-durable-subagents/PROJECT.md`
- `.planning/synara-pi-durable-subagents/issues/17-integrated-real-pi-acceptance.md`
- Decision 0030 — Ticket-16 final-acceptance reassessment
- Decision 0031 — T17-AC6 destructive-boundary evidence split
- Decision 0032 — T17-AC6 owner-approved testing seam
- Decision 0033 — managed-child Bash ownership reassessment

Supporting:

- `.planning/synara-pi-durable-subagents/reviews/17-integrated-real-pi-acceptance-review.md`
- `/tmp/symphony-t17-handoff.md`
- Candidate worktree `/private/tmp/symphony-t17-integration`, range
  `46b32d71..9b6d06cb`

Owner-approved decisions not reopened:

- Decision 0031's mandatory three-leg AC6 evidence split.
- Decision 0032's owner approval, including its prohibition on automated
  destructive real-Pi claims.
- Decision 0033's one-child/one-supervisor, opaque identity-fenced endpoint,
  no-parent-fallback, no-Synara-PID-authority, and proof-before-fence
  requirements.

## Candidate and provenance

- Symphony base: `46b32d71`
- Accepted candidate: `9b6d06cb`
- Candidate scope: six remediation commits; four changed Symphony files:
  - `apps/server/src/provider/Layers/PiAdapter.ts`
  - `apps/server/src/provider/piSubagentChildOwnerTeardownWiring.test.ts`
  - `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`
  - `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`
- Pinned Alfie provenance:
  `aa6fa4a8540644d2509b10d6df854486ddc67d1d`,
  `@alfie/pi-subagents@0.15.0-alfie.4`.
- The real-Pi harness rejects unpinned, dirty, or hash-mismatched Alfie
  extension provenance, including the child Bash supervisor and managed-child
  runner paths.
- The reviewed integration worktree was clean after verification. No
  candidate change was made in the main checkout, and its pre-existing dirty
  files remain outside this decision.

## Evidence considered

- Independent feature-level review: **PASS WITH NOTES**, with no actionable
  finding and no contradicted acceptance criterion.
- Focused child-owner and bridge verification: **62 passed, 0 failed**.
- Integrated real-Pi acceptance: **9 passed, 1 skipped, 0 failed**. The
  skipped test is solely the opt-in destructive manual AC6 leg.
- `bun fmt`: exited 0.
- `bun lint`: exited 0; 0 errors and 564 warnings.
- `bun typecheck`: 7/7 workspace tasks passed after Bun was placed on
  `PATH`; the earlier package-manager lookup failure was environmental and is
  not the final verification result.
- The formatter's unrelated temporary edits were reverted; they are not
  candidate changes.
- Recorded isolated manual real-Pi run from 2026-08-20:
  - 1 passed, 9 skipped, 32.33 seconds;
  - exact child Bash root PID `80696` and descendant PID `80728`;
  - both observed alive before teardown and absent from the parent-supervisor
    observer;
  - TERM observed for both before bounded KILL escalation;
  - no band 76 while either exact PID remained live;
  - durable bands `75 → 76`;
  - generation `1 → 2`;
  - both PIDs absent after teardown, with the card settled `cancelled`.

The destructive manual leg was not rerun in this consultation and is not
recast as CI evidence.

## Criterion-level verdict

| Criterion | Verdict | Acceptance basis |
| --- | --- | --- |
| T17-AC1 | PASS | The production WebSocket path starts a compatible real Pi session, negotiates the pinned managed capability, admits one managed execution, and preserves its durable identity through the execution card. |
| T17-AC2 | PASS | A real slow child detaches within the bounded foreground budget; progress is bounded, and a new WebSocket client restores the running execution card from durable state. |
| T17-AC3 | PASS | The production card-cancel path reaches the real child and preserves `cancelling` until current-attempt terminal evidence; inaccessible-session failure diagnostics are stable. |
| T17-AC4 | PASS | Two real child completions produce one bounded parent follow-up and each result remains independently retrievable by execution identity. |
| T17-AC5 | PASS | Restart from the isolated durable root reconciles a real non-terminal execution honestly, without new admission, delegation replay, or automatic resume. |
| T17-AC6 | PASS, only through the binding three-leg split below | The terminal zero-owned-child assertion is derived exclusively from the recorded manual leg, not from fixtures or automated real-Pi execution. |
| T17-AC7 | PASS | Capability-absent and bridge-absent real Pi paths retain legacy semantics and are not represented as managed or recoverable. |
| T17-AC8 | PASS | The harness uses an isolated root, home, state database, workspace, agent directories, loopback model endpoint, and ephemeral non-default port; it restores environment state and leaves the user Pi home unchanged. |
| T17-AC9 | PASS | The harness composes the production server/WebSocket/real-Pi-adapter graph, asserts stage-scoped stable diagnostics, fails loudly, and cannot pass through provider fakes alone. |

## Explicit T17-AC6 disposition

T17-AC6 is accepted only because all three mandatory and separately labeled
evidence legs are present:

1. **Mandatory non-destructive real-Pi leg — PASS.** The integrated real-Pi
   test drove a deliberately wedged execution through watchdog bands 70–74,
   real provider-session stop, and the durable band-74 teardown handoff. It
   preserved the honest `cancelling` / `cleanup_uncertain` state and made no
   destructive-proof or terminal-process claim.
2. **Accepted deterministic Ticket-16 contract leg — PASS.** Decision 0030's
   accepted deterministic fixtures remain the authority for owned-only
   teardown, bands 75–78, bounded survivor evidence, uncertain retryability,
   escalation to `proven`, and proof-before-fence. The current 62-test
   child-owner/bridge suite additionally verifies exact identity routing;
   `proven` and `survivors`; stale, malformed, mismatched, unavailable,
   thrown, and timed-out endpoints; retry after durable-write failure;
   restart-empty behavior; sibling isolation; and no parent-supervisor
   fallback.
3. **Mandatory isolated manual real-Pi leg — RECORDED OPERATOR EVIDENCE,
   ACCEPTED FOR ITS SOLE PURPOSE.** The isolated 2026-08-20 operator run
   supplies the only accepted claim that the exact child-owned root and
   descendant were gone after proven teardown. It establishes TERM→KILL
   proof, prohibits band 76 while either exact PID is live, and observes
   bands `75 → 76`, `cancelled`, and generation advance. It is neither an
   automated destructive pass nor deterministic-fixture evidence.

No leg has been substituted for another, and no automated destructive
shared-CI claim is accepted.

## Decision 0033 invariant disposition

Decision 0033's narrow reassessment is implemented and verified on the accepted
candidate.

- A managed, capability-bearing session registers an opaque owner only when
  its live bridge exposes `teardownOwnedProcesses`.
- The retained owner is routed only with the exact `executionId`, `attemptId`,
  and generation.
- Missing, old, malformed, stale, mismatched, disposed, timed-out, thrown, or
  otherwise unavailable endpoint results fail closed to the non-terminal
  band-78 owner-unproven path.
- Invalid owner state cannot emit band 76, settle `cancelled`, advance
  generation, or invoke a parent-supervisor fallback.
- A validated `proven` response remains insufficient by itself: the opaque
  owner is retained until the durable band-76 settlement and fence
  transaction commits, permitting retry after durable-write failure.
- A valid current owner `survivors` result uses the existing band-77 path;
  owner unavailability is never relabeled as survivors.
- Symphony neither enumerates, caches, reconstructs, registers, nor signals
  child PIDs or process groups.
- The parent `PiBashProcessSupervisor` remains permitted only for processes it
  directly owns and is never a managed-child teardown fallback.
- The recorded real-Pi manual run confirms that the exact child root and
  descendant were absent from the parent supervisor's observer before
  child-owner teardown proof.

Accordingly, Decision 0030 is **not** restored in its former parent-supervisor
form for managed children. Instead, its accepted Ticket-16 teardown result is
now qualified by—and complete only with—the implemented Decision-0033
child-owner control. Decision 0033's downstream effect of narrowly reopening
Ticket 16 is closed.

## Final binding decision

**ACCEPT Ticket 17 at candidate `9b6d06cb`.**

All T17-AC1 through T17-AC9 pass. The accepted result includes the narrow
managed-child ownership reassessment: Ticket-16 managed-child teardown is now
accepted only under Decision 0033's exact child-scoped opaque-owner contract,
not under the superseded parent-supervisor premise.

## Rejected alternatives

- Reject Ticket 17 because the automated real-Pi run deliberately skips
  destructive teardown.
- Treat the deterministic fixtures as proof that the real managed-child
  process tree has no surviving owned process.
- Treat the recorded manual run as CI evidence or claim an automated
  destructive pass.
- Restore parent-supervisor fallback for a managed child.
- Allow Symphony to acquire PID or process-group authority to compensate for
  an unavailable child endpoint.
- Treat endpoint failure as `proven`, `survivors`, `cancelled`, or fenced.
- Require a second final-acceptance consultation for the same candidate.

## Residual nonblocking notes

- The manual teardown remains opt-in and must remain skipped unless an
  operator explicitly requests a fresh isolated run and records its
  environment and result.
- The final lint result has 564 warnings but zero errors; this is nonblocking
  for this candidate.
- `bun fmt` can alter unrelated workspace files. Its successful verification
  may be used, but it is not a scope-preserving staging operation.
- The Ticket-17 implementation report retains interim candidate/open-gate
  prose alongside its authoritative manual-run record. During the downstream
  status update, reconcile it to `9b6d06cb` and the final observed
  verification without changing the AC6 evidence labels or upgrading the
  manual record's status. This is documentation synchronization only, not an
  acceptance gap.

## Frontier and status consequence

After this record is persisted and tracked:

- Ticket 17 may be marked **complete**, with T17-AC1 through T17-AC9 checked.
- Decision 0033's narrow Ticket-16 reopening is closed; Ticket 16 remains
  complete subject to the now-implemented child-owner qualification.
- Project Home must be updated so Ticket 17 is no longer the active frontier.
- All listed implementation tickets 01–24 are then accepted; no successor
  implementation ticket is named by the supplied Project Home.
- This decision accepts the isolated candidate only. Any controlled transfer
  into the main checkout remains a separate git operation and must preserve
  its two pre-existing user changes.

## Failure and rollback implications

Reverting the child-owner endpoint wiring, allowing a child Bash to bypass its
supervisor, restoring parent fallback, granting Symphony child PID authority,
or turning an invalid endpoint into band 76/fencing immediately reopens the
managed-child ownership acceptance. A rollback may degrade only to band 78 for
an unavailable owner; it must not reinterpret uncertainty as proof or mutate
historical bands.

## Reopening conditions

Reassess this acceptance only on material evidence of one or more of the
following:

1. a managed child Bash bypasses its child-scoped supervisor;
2. owner/session identity can be reused, cross-routed, or applied to a stale
   generation;
3. an unavailable, invalid, or failed endpoint yields band 76, `cancelled`,
   or generation fencing;
4. a parent supervisor is used as a managed-child fallback, or Symphony gains
   PID/process-group authority;
5. loss of proof-before-fence, bands 75–78 semantics, bounded survivor
   evidence, retryability, or immutable journal behavior;
6. invalidation of the exact candidate, Alfie provenance, or recorded
   verification;
7. a material change to the approved AC6 evidence boundary or manual recipe;
   or
8. a later binding decision changes Decisions 0030–0033.

## Superseded or amended records

- Decision 0029 remains superseded by Decision 0030.
- Decision 0030 remains superseded only as to its former managed-child
  parent-supervisor ownership premise.
- Decision 0033 remains binding as the governing child-owner direction; this
  record closes its implementation/reopening gate.
- Decisions 0031 and 0032 remain unchanged.
