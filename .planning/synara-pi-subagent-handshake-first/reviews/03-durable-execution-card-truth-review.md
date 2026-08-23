# Independent review — Ticket 03 durable execution-card truth

- **Date:** 2026-08-23
- **Verdict:** PASS
- **Candidate:** `236d4119b` on baseline `f31a93ab2`
- **Implementation report:** `40a41ad11`
- **Scope:** Ticket 03 AC1–AC5 only. This review does not accept Ticket 04.

## Review conclusion

No material criterion failure was found. Independent source inspection and
verification support AC1–AC5. The candidate preserves durable-state ownership,
backward event replay, current-generation fencing, non-terminal teardown
uncertainty, and honest card controls.

## Criterion verdicts

| Criterion | Independent evidence | Verdict |
| --- | --- | --- |
| AC1 | The shared contract adds closed attachment/teardown literals with old-event decoding defaults. One shared SQL fragment is used by all four repository/snapshot card reads and fences every journal lookup by execution, attempt, and generation. The diff contains no DDL, migration, historical rewrite, or new durable write. Contract 34/34 and server card-surface 17/17 reran successfully. | PASS |
| AC2 | `Running in background` requires observed `running` plus projected `detached`; attached and legacy-null cards remain `Running`. Server tests prove exact current seq-3/background admission and cross-identity isolation. | PASS |
| AC3 | Whole-card precedence places teardown uncertainty before cancellation intent and cancellation intent before detached running. Bands 77/78 remain journal-only non-terminal truth, produce `Cancellation unverified`, and expose no spinner, repeat Cancel, Resume, or stopped claim. Recorded 77/78 card publication occurs after commit; already-applied and stale outcomes do not publish falsely. | PASS |
| AC4 | Orphaned projects `Outcome unknown (orphaned)`, no spinner/Cancel, and explicit Resume only. The targeted ChatView journey proves no automatic Resume and one explicit resume dispatch. | PASS |
| AC5 | Resume and proven-teardown generation tests reject stale attachment/teardown evidence. The four server card reads use one mapper. Snapshot/event normalization passes the whole card unchanged, and strip/details call the same presentation helper. Store/reconnect tests prove fresh-field preservation and conservative old-null decoding. | PASS |

## Independent verification

- Contracts: 34/34 passed.
- Server durable card surface: 17/17 passed.
- Web whole-card, strip, store, and reconnect: 40/40 passed.
- Result/details browser boundary: 6/6 passed.
- Targeted ChatView orphan/Resume journey: 1/1 passed in five reviewer reruns.

The reviewer reproduced the pre-existing Issue-550 ChatView timing benchmark as
machine/load-sensitive: one isolated run failed and one passed. The only
Ticket-03 change in `ChatView.browser.tsx` is the orphan-label assertion, and
the Ticket-03 journey passed consistently. The benchmark result is therefore
not scope-related or acceptance-blocking.

## Durable replay and publication audit

Persisted orchestration events decode through the shared
`PiSubagentExecutionCard` schema. Missing Ticket-03 fields decode to `null`,
while malformed new values are rejected. Fresh row-to-card reads always emit
explicit values. Snapshot replacement and event upsert both move the complete
card rather than field-merging stale data; legacy `null` can only degrade to a
more conservative ordinary label.

For teardown uncertainty, the repository notification runs only after the base
transaction resolves with `recorded` for `survivors` or `owner_unproven`.
Bands 77 and 78 retain distinct deterministic journal sequences and bridge
command identities. Already-applied, stale-generation, and failed outcomes do
not create a new card publication. Band 76 remains outside current uncertainty
because proven teardown settles cancellation and advances the generation.

## Findings

1. **Low — no independent ordering guard in web card upsert.**
   `storeEventReducer` replaces a card by execution identity without comparing
   `journalSequence` or `updatedAt`. A genuinely out-of-order old-shape event
   after a fresh card could regress the two new fields to conservative `null`.
   Ordered replay and snapshot authority make this non-blocking and it predates
   Ticket 03. Consider a separate follow-up rather than changing the reviewed
   candidate.
2. **Low — verified-owner presentation uses existing durable authority.**
   The projection treats current non-terminal state plus authenticated
   current-generation seq-3/background admission as the owner evidence; the
   web does not independently re-derive lease freshness. This matches the
   approved Ticket-03 seam and avoids introducing a second liveness protocol.
3. **Informational — formatting.** The new uncertainty notification branch has
   a long single-line conditional. This is cosmetic; formatting was not run
   because the owner did not authorize the heavyweight pass.
4. **Informational — stale test comment.** One strip test comment still says
   the loader mock renders `null`, while the mock now renders a marker span.
   Assertions and behavior are correct.

## Scope and evidence limitations

- Ticket 02, the controlled artifact, Pi loader, bridge construction, desktop
  gate, Alfie, transcript scrolling, and Ticket 04 are unchanged.
- No survivor PID, raw journal metadata, path, credential, prompt, or provider
  configuration was added to the card.
- `bun fmt`, `bun lint`, and `bun typecheck` were not authorized or run; no
  result is inferred.
- The evidence package is sufficient for the one Ticket-03 Supervisor
  final-acceptance consultation, carrying the findings and missing heavyweight
  check evidence explicitly.
