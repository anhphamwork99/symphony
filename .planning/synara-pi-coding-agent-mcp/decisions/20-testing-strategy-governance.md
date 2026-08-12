# Decision 20: Testing strategy governance

Status: Accepted by owner
Date: 2026-08-12

## Scope

This record governs testing for the Synara–Pi MCP feature as a whole. Ticket-
specific implementation seams remain owned by their individual tickets.

## Strategy

Prefer the highest stable public boundary that proves the behavior, with as few
lower-level seams as necessary:

1. Contract and decider tests for project desired-state transitions, activation
   operation records, strict payload validation, CAS/version rules, and journal-
   first/idempotency behavior.
2. Server orchestration integration tests for command interception, project
   event fan-out, immutable wait-set aggregation, safe-boundary deferral,
   rollback-to-disabled, bounded timeout, restart recovery, and exactly-once
   terminal activities.
3. Provider/MCP boundary tests for subject binding, capability/ownership/turn
   enforcement, dormant zero-activity startup, activation discovery, disable
   fence/cancel/drain/revoke ordering, generation isolation, structured tool
   errors, cancellation, and no replay.
4. Web projection/work-log tests for live/replay equivalence, null-turn
   acknowledgement visibility, diagnostic rendering, and exclusion from
   assistant/sidebar state.
5. Paired runtime measurements for Pi standalone versus Synara default startup
   and per-component token overhead. Measurements must report real accounting;
   UI or accounting changes may not hide overhead.
6. One integrated manual smoke path covering enable, active-turn deferral,
   successful tool call, disable during an MCP call, reconnect/resume, and
   failed activation rollback.

## Required failure and diagnostic coverage

Every success test for a lifecycle or command transition must have a matching
failure test for malformed state, stale generation, missing/expired/mismatched
subject, authorization denial, timeout, cancellation, transport/discovery
failure, runtime reload/recreation failure, duplicate/replayed command, and
late callback where applicable.

No test may substitute a mocked UI-only acknowledgement for journal-first
server activity. No test may treat a partial catalog, stale credential, or
uncertain cleanup as success.

## Commands and constraints

Use focused Vitest tests during implementation and `bun run test` for the full
suite. Never use `bun test`. Do not run `bun fmt`, `bun lint`, or `bun typecheck`
unless the owner explicitly requests those checks in the current conversation;
when requested, run them together as one final verification pass.

## Exceptions

A ticket may justify a lower seam only when the stable public boundary cannot
reliably induce the failure or observe the invariant. The ticket must document
the reason, preserve the public-boundary test, and add the smallest lower-seam
test needed. A material strategy change requires a new owner-approved project
Decision Record.
