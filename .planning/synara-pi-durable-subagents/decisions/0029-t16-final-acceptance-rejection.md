# Decision 0029 — Ticket 16 final-acceptance rejection

## Status

rejected; remediation required before Reassessment

## Date

2026-08-19

## Consultation class

Ticket 16's first and only final-acceptance consultation. Any later evaluation
of a remediated candidate is a Reassessment of this rejection, not a second
final-acceptance consultation.

## Candidate

- `d5cb137a` — initial implementation
- `47388a98` — two-axis remediation
- `73173b9c` — Decision 0027
- `a119a865` — owner-approved Decision 0028
- `2da6aa03` — startup-order remediation
- `ec304d47` — single independent feature-level review package
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Does the complete Ticket-16 owned process-tree teardown and fencing candidate
satisfy T16-AC1 through T16-AC7 and permit Ticket 16 to become complete and
Ticket 17 to become unblocked?

## Governing references

- Project Home.
- Ticket 16.
- Decisions 0021 and 0025 — inherited proof-before-fence.
- Decision 0027 — bands `75–78`, live-supervisor-only kill authority, and
  restart ownership posture.
- Decision 0028 — owner-approved deterministic CI fixtures plus isolated
  manual real-Pi recipe.
- `reviews/16-owned-process-tree-teardown-review.md` — the single independent
  feature-level review package.

## Evidence

The independent reviewer reran six focused files with 76/76 tests passing and
found T16-AC1 through T16-AC7 supported, subject to its F1.

Source confirmation found:

- `PiBashProcessSupervisor.teardownAll()` gathers failures and throws an
  `AggregateError`.
- The production resolver extracts survivor PIDs only when the top-level cause
  directly satisfies `cause instanceof ProviderProcessExitUnprovenError`.
- Known `remainingDescendantPids` nested under `AggregateError.errors` are
  therefore discarded.
- The downstream diagnostic can report “0 captured survivors” despite known
  surviving PIDs.
- One Ticket-16 residual sentence and one production-source comment still
  describe the pre-Decision-0027 band allocation.
- The recorded formatting result predates `2da6aa03`.

## Decision

**REJECT.**

- T16-AC1 — pass.
- T16-AC2 — pass.
- T16-AC3 — pass.
- T16-AC4 — fail at the production diagnostic boundary.
- T16-AC5 — pass.
- T16-AC6 — pass.
- T16-AC7 — pass.

T16-AC4 requires explicit survivor reporting and operational visibility. A
known survivor hidden behind a misleading zero-count diagnostic does not meet
that contract. Accepting this as residual risk would relax an owner-approved
acceptance requirement and is outside Supervisor authority.

Ticket 16 must not be marked complete. Ticket 17 remains blocked.

## Required remediation

### F1 — survivor evidence through AggregateError

1. Traverse `AggregateError.errors`, including nested aggregate structure.
2. Collect survivor PIDs from every contained
   `ProviderProcessExitUnprovenError`.
3. Validate, deterministically deduplicate, and cap the list to the Ticket-16
   survivor-evidence limit of 16.
4. Preserve honest uncertainty for failures without PID evidence; do not
   describe missing evidence as proof of zero survivors.
5. Ensure band-77 metadata and operator diagnostics carry the same bounded PID
   evidence.
6. Add production-boundary coverage using the real resolver path and an
   aggregate shaped like `PiBashProcessSupervisor.teardownAll()`.

### F2 — allocation documentation

1. Correct the stale Ticket-16 `75/76` residual sentence to `75–78`.
2. Correct the stale production comment that assigns all teardown outcomes to
   band 76.
3. Audit allocation descriptions against Decision 0027: request 75, proven
   76, survivors 77, owner-unproven 78.

The manual recipe may continue to mention bands 75/76 where it intentionally
describes the successful proven path.

### F3 — final verification

1. Format the exact remediated candidate.
2. Obtain passing `bun fmt`, `bun lint`, and `bun typecheck` evidence.
3. Rerun affected resolver/wiring tests and the six-file Ticket-16 focused
   suite.
4. No destructive real-Pi CI run is required under Decision 0028.

## Accepted nonblocking notes

- The cosmetic fallback diagnostic vocabulary nuance is accepted because the
  outcome kind remains truthful.
- Decisions 0027/0028 are adequately routed from Project Home.
- SQL discovery materialization with a 64-execution processing cap is accepted
  under the current bounded model.
- Unrelated dirty-worktree files and runtime notification noise are excluded
  from the candidate.
- The manual real-Pi recipe may remain unexecuted and must remain labeled
  manual.

## Rejected alternatives

- Accepting F1 as residual risk.
- Treating the non-terminal `survivors` outcome alone as sufficient for AC4.
- Treating stale allocation descriptions as compliant with Decision 0027.
- Accepting formatting evidence that predates the final candidate.
- Requiring destructive real-Pi CI automation contrary to Decision 0028.

## Preserved invariants

Remediation must not weaken:

- owned-only kill authority;
- uncertain-to-proven retry;
- proof-before-fence;
- startup no-owner behavior;
- Ticket-10's subsequent non-terminal orphan fence;
- journal immutability; or
- bounded evidence.

Bands `75–78` must not be deleted, collapsed, or reinterpreted.

## Reopening evidence

A Reassessment requires:

1. a remediated candidate implementing bounded deterministic survivor
   extraction through `AggregateError`;
2. production-boundary tests proving nested survivor evidence reaches band-77
   metadata and operator diagnostics while the execution stays non-terminal;
3. corrected source and Ticket-16 allocation documentation;
4. passing affected resolver/wiring tests and the six-file Ticket-16 focused
   suite at the exact candidate;
5. passing `bun fmt`, `bun lint`, and `bun typecheck` at that exact candidate;
6. an independent remediation addendum to the existing review package
   confirming F1–F3 are closed with no invariant regression; and
7. Project Home, this rejection record, the remediated candidate, and the
   addendum supplied to Supervisor for a Reassessment.

No second feature-level review package or second final-acceptance consultation
is requested.

## Superseded record

None. This record preserves Decisions 0027 and 0028 and may be superseded only
by a recorded Reassessment based on the reopening evidence above.
