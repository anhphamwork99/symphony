# Decision 0027 — Ticket 16 teardown outcome bands and restart ownership posture

## Status

accepted technical direction; Ticket 16 remains not ready for independent
feature-level review pending implementation alignment and human-owner testing
approval

## Date

2026-08-19

## Candidate

- Symphony `d5cb137a` plus remediation `47388a98`
- Alfie unchanged at `489acd626` / `0.14.0-alfie.1`

## Question

Which durable journal identities must represent Ticket-16 teardown outcomes,
and what process-kill authority may startup reconciliation exercise after the
in-memory owning supervisor has been lost?

This record also identifies, without deciding, the owner-reserved question of
whether the conditional destructive real-Pi CI seam may be replaced by
deterministic fixtures plus an isolated manual verification recipe.

## Governing references

- Project Home and Ticket 16.
- Specification Implementation Decisions 5, 6, 7, 15, 25, 26, 27, and 29.
- Decision 0001 testing-strategy governance.
- Decision 0014 restart reconciliation and its non-terminal owner-loss fence.
- Decisions 0021–0025, especially Ticket 16's proof-before-fence obligation.
- Decision 0026's accepted disjoint resume sequence `80`.
- Ticket-16 implementation and deterministic evidence at Symphony
  `d5cb137a` + `47388a98`.

## Evidence

The lifecycle journal deduplicates by deterministic event identity and by
execution/attempt/generation/sequence. A shared outcome sequence therefore
causes an uncertain first pass to occupy the identity needed by a later proven
pass. Distinct event IDs alone do not remove that collision.

The remediated implementation assigns request `75`, proven `76`, survivors
`77`, and owner-unproven `78`. Focused repository/coordinator coverage proves
that a band-77 survivors row leaves the execution non-terminal and a later
band-76 proven row coexists, settles `cancelled`, and advances generation
atomically.

The owned teardown implementation requires a live supervisor holding the exact
spawned-process exit watcher and identity-captured process tree. It explicitly
avoids signalling potentially reused PIDs. No equivalent ownership proof is
persisted across a server restart.

Current startup ordering first runs Ticket-10 reconciliation, which records
`orphaned` and advances generation, and only then runs Ticket-16 discovery.
Ticket-16 discovery requires the band-74 handoff to match the current
generation. The current production ordering therefore makes the documented
restart `owner_unproven` path unreachable for the ordinary handed-off
execution, despite an isolated coordinator test covering that outcome.

Ticket 16 documents that its conditional destructive real-Pi CI seam is not
provably hermetic or deterministic and proposes existing deterministic
supervisor/repository fixtures plus an isolated manual recipe. Decision 0001
reserves approval of that material substitution to the human owner.

## Decision

1. Ticket 16 owns the following attempt-local journal allocation:
   - `75` — teardown request;
   - `76` — teardown proven;
   - `77` — teardown survivors;
   - `78` — teardown owner unproven.
2. Each outcome kind retains a distinct immutable sequence. Repeated
   observations of the same kind deduplicate, while a later proven outcome may
   coexist with earlier uncertain evidence and perform the proof-before-fence
   settlement.
3. Only a live identity-capturing owned process supervisor grants Ticket-16
   kill authority. Startup must not derive kill authority from raw PIDs,
   pid files, process names, transcripts, or the pre-restart aggregate.
4. When no live owned supervisor exists, Ticket 16 kills nothing and may record
   only bounded `owner_unproven` evidence. It must never claim teardown proof
   or settle `cancelled`.
5. Startup handling must make that `owner_unproven` evidence reachable for a
   current band-74 handoff before Ticket-10 owner-loss reconciliation advances
   the generation, or provide an equivalent atomic composition preserving both
   outcomes. Ticket-10 must subsequently retain its accepted non-terminal
   `orphaned` settlement, one-time generation fence, stale-event accounting,
   boundedness, and no-replay guarantees.
6. This decision does not approve the proposed real-Pi destructive-test
   substitution. Human-owner approval remains mandatory under Decision 0001.

## Rationale

Per-kind integer bands are the smallest standard mechanism compatible with the
existing journal schema. They preserve immutable bounded evidence, support
uncertain-to-proven retries, and require no migration.

Distinct event IDs with a shared sequence remain subject to the journal's
sequence identity. Updating an uncertain row into a proven row would erase
history. Changing sequence representation or uniqueness rules would add schema
complexity without improving correctness.

A raw PID is not durable process identity and may be reused. Killing from a
pid file could signal an unrelated process and violates the ticket's owned-only
boundary. Honest uncertainty is safer than invented authority.

Ticket-10's owner-loss generation fence and Ticket-16's proof-before-fence
settlement have different meanings. The former prevents late owner-lost events
while retaining non-terminal `orphaned`; the latter may settle `cancelled` only
after owned process-tree death is proved. Startup must preserve both meanings
and order their durable evidence coherently.

## Obligations

Before independent Ticket-16 feature review:

1. Persist and route this Decision Record from Project Home.
2. Align Ticket 16, repository comments, constants, tests, telemetry filters,
   and its acceptance matrix with the registered `75–78` allocation. Remove
   stale references that describe survivors as band `76` or describe only a
   `75/76` teardown range.
3. Remediate startup ordering or composition so a handed-off execution can
   durably record `owner_unproven` before Ticket-10 advances generation.
4. Add an integrated startup-order regression proving:
   - a current band-74 handoff;
   - no live owned supervisor;
   - no kill dispatch;
   - one bounded band-78 owner-unproven row;
   - subsequent non-terminal orphan settlement and generation advance;
   - no `cancelled` or teardown-proven claim;
   - replay/idempotency and stale-event fencing remain intact.
5. Obtain a separate explicit human-owner decision on the conditional
   destructive real-Pi substitution. Do not represent the proposal itself as
   approval.
6. After those gates close, run the independent feature-level review and then
   exactly one Supervisor final-acceptance consultation.

## Rejected alternatives

- One shared outcome sequence with distinct event IDs: rejected because the
  sequence uniqueness identity still collides.
- Replacing or updating uncertain rows with proven truth: rejected because it
  destroys immutable lifecycle evidence.
- Fractional/sub-numbered sequences or a uniqueness-schema change: rejected as
  unnecessary migration and representation complexity.
- Treating `survivors` or `owner_unproven` as termination proof: rejected by
  proof-before-fence.
- Killing a pid-file process after restart: rejected because PID presence does
  not prove ownership or identity and creates unrelated-process kill risk.
- Silently omitting the conditional real-Pi seam: rejected by Decision 0001.
- Treating the isolated coordinator restart fixture as proof of production
  startup behavior: rejected because it does not include Ticket-10's preceding
  generation advance.

## Assumptions

- The journal uniqueness and repository behavior inspected at the candidate
  are the production persistence authority.
- No undisclosed accepted decision allocates sequences `75–78`.
- Alfie remains unchanged at the stated pin.
- No durable process-identity record equivalent to the live supervisor's
  captured tree and exact exit watcher exists.

## Residual uncertainty

- The safest mechanical placement of Ticket-16 discovery relative to outbox
  recovery and Ticket-10 reconciliation requires implementation-level review.
  The semantic order is settled: no-owner teardown evidence must be recorded
  while the handed-off generation is current, and Ticket-10 owner-loss fencing
  must still follow.
- The human owner may approve or reject the testing substitution. This record
  does not predict that decision.
- Execution commands and tests reported in the Ticket-16 implementation report
  were not independently rerun in this read-only consultation.

## Downstream effect

- Bands `75–78` become reserved to Ticket 16 and must not be reused
  incompatibly.
- Ticket 16 remains the active frontier.
- Ticket 17 remains blocked by Ticket 16.
- Independent Ticket-16 review must wait for startup-order evidence and the
  owner testing decision.
- Final acceptance remains inapplicable until implementation remediation,
  owner testing approval, and one independent feature-level review are
  complete.

## Failure and rollback implications

If per-kind sequences are collapsed, uncertain-to-proven escalation can again
be structurally suppressed while the coordinator reports false settlement.

If startup kills from reconstructed PID data, unrelated processes may be
signalled without ownership proof.

If startup keeps the current ordering unchanged, the claimed band-78 restart
evidence remains unreachable for ordinary handed-off executions; Ticket 16
cannot claim T16-AC7 as implemented.

Rollback must preserve existing journal rows. Persisted bands `75–78` must not
be deleted or reinterpreted as stronger lifecycle truth.

## Reopening conditions

Reassess this direction only if material evidence shows that:

1. the production journal no longer has an attempt/generation/sequence
   uniqueness identity;
2. a simpler mechanism preserves immutable uncertain evidence and permits
   later proof without collision;
3. a durable, PID-reuse-safe process-identity capability survives restart and
   is accepted by the owner;
4. startup ordering differs from the inspected source or an integrated test
   proves the band-78 path is currently reachable after Ticket-10
   reconciliation; or
5. a later accepted project decision changes proof-before-fence or restart
   owner-loss semantics.

## Superseded record

None. This record extends the accepted journal-band registry and preserves,
rather than supersedes, Decisions 0001, 0014, and 0021–0026.
