# Decision 0065 — Settle Ticket 02 ephemeral server authority and canonical WebSocket operation-session mechanics

**Status:** Binding  
**Date:** 2026-08-28  
**Trigger:** Material technical decision verification/escalation  
**Amends:** None  
**Supersedes:** None  
**Final-acceptance consultation consumed:** No  
**Owner-approved decisions reopened:** None

## Question

Within Decisions 0063 and 0064, what concrete stream admission, timing, memory-bound, acknowledgement, replay, request-admission, error-mapping, and idempotency rules govern the Ticket 02 server operation-session authority and production WebSocket slice?

## Governing references

Authoritative:

1. [Project Home](../PROJECT.md).
2. [Decision 0063](0063-ticket-02-operation-transport-outcomes-authorization.md), authorizing the minimal image-free, ephemeral, server-authoritative operation-session seam.
3. [Decision 0064](0064-ticket-02-canonical-rpc-write-set-reassessment.md), requiring all six browser methods in canonical `WsFeatureRpcGroup` and prohibiting supplemental RPC groups.
4. `packages/contracts/src/whiteboardOperation.ts`, containing the accepted strict wire identities, commands, events, errors, containment results, and terminal records.
5. `packages/contracts/src/rpc.ts`, containing the six accepted RPC descriptors and canonical group membership.

Supporting:

6. [WP1 evidence](../evidence/ticket-02/operation-transport-outcomes.md) at main evidence commit `612526fd0`.
7. Current server source evidence for `wsStreamAdmission.guard`, `bufferLiveUiStream`, request admission, Effect RPC streams, WebSocket composition, and the module-singleton negotiated server authority.

## Evidence scope

This decision settles only:

- the ephemeral server operation-session service;
- its internal producer-facing authority;
- the six already-accepted production WebSocket handlers;
- the bounded snapshot/replay/live subscription;
- focused service and actual canonical-route WebSocket tests.

It does not establish implementation correctness, package PASS, workspace completion, Ticket 02 acceptance, feature acceptance, or final acceptance.

## Binding decisions

### D1 — Subscription admission and stream identity

The Whiteboard subscription must use existing `wsStreamAdmission.guard` with exactly:

```text
key = whiteboard.operation.session:<operationSessionId>
```

It consumes one lease from `WS_STREAM_LIMITS.totalPerClient = 20`, supplies no `threadId`, and consumes no thread-stream budget. Existing same-client, same-key last-subscription-wins behavior is authoritative: the duplicate key atomically replaces and interrupts the previous lease. Different operation-session IDs are distinct keys.

The operation-session service must not depend on `ThreadDiagnosticsQuery`. Existing transport-level diagnostics may continue through already-composed `wsRpc.ts` infrastructure, but the service performs no diagnostic persistence. No Whiteboard-specific stream admission ledger, supplemental stream group, or thread-budget exception is authorized.

### D2 — Effect clock, containment dispatcher, deadline, and lifecycle

Containment timing uses Effect-native time through `Clock`, `Effect.sleep`, or an equivalent Effect timeout race. `Date.now`, native `setTimeout`, environment variables, and configuration additions are prohibited.

The service factory accepts production-grade dependency injection for:

```text
containmentDispatcher
containmentDeadline
serverInstanceId
```

This is a normal production/test construction seam, not a test-only API. The production deadline is exactly `2_000 ms`.

The default production dispatcher for this dormant slice fails closed as dispatch unavailable, producing `dispatch-failed`; it never synthesizes containment acknowledgement. A later provider package may inject a real dispatcher under separate authority.

Take Over lifecycle:

1. Atomically validate identity and expected generation.
2. Record the request.
3. Advance authoritative generation.
4. Mark lineage non-retryable.
5. Emit `take-over-pending`.
6. Only then start exactly one dispatcher fiber.
7. Race dispatcher completion against the Effect deadline.
8. Record exactly one `dispatch-failed`, `ack-timeout`, `containment-failed`, or `acknowledged` result.
9. Equivalent repeated Take Over requests observe the same pending deferred or recorded result and never launch another fiber.
10. Service-scope shutdown interrupts outstanding dispatcher/deadline fibers without manufacturing containment or terminal truth.

`wsRpc.ts` must supply the existing negotiated authority identity. It may obtain it once during RPC-layer construction through existing `negotiateWsCompatibility` using valid server-local input. It must not mint a second server instance ID or modify `wsCompatibility.ts`.

### D3 — Explicit in-memory limits, eviction, and reset behavior

Use fixed source constants with no configuration or environment surface:

```text
MAX_LIVE_OPERATION_SESSIONS = 128
MAX_RELEASED_SESSION_TOMBSTONES = 128
MAX_REPLAY_EVENTS_PER_SESSION = 256
MAX_LIVE_SUBSCRIBERS_PER_SESSION = 8
MAX_LIVE_SUBSCRIBERS_TOTAL = 256
LIVE_SUBSCRIBER_QUEUE_CAPACITY = 256
MAX_REPLAY_BYTES_PER_SESSION = 16 MiB
MAX_REPLAY_BYTES_TOTAL = 128 MiB
```

Byte accounting uses the service’s canonical encoded representation of retained stream events. Subscriber queues may retain references to immutable event values and must not deep-copy payloads per subscriber.

A session is protected from eviction while it has a nonterminal operation, pending Take Over, unresolved containment, or any state whose removal could imply false terminal or containment truth. Protected state and required replay records are never evicted, truncated, or converted to success.

At capacity, attach may evict only the least-recently-used quiescent session. If all sessions are protected, attach fails closed with `sessionActive`. One live authority is allowed per exact `(projectId, documentKind, documentId, canvasIdentity)`; a competing attach fails with `sessionActive`.

Releasing a quiescent session removes the live record and creates a bounded released tombstone. Tombstones are oldest-first evictable at 128; after eviction the identity is unknown and is never silently recreated.

If adding an event would exceed a replay count or byte cap, quiescent non-subscribed history may compact to current snapshot metadata, latest terminal metadata, and immediate retry predecessor. Active or Take-Over-pending state is never compacted. If safe compaction cannot make room, reject the triggering transition before browser delivery, fence generation, mark lineage non-retryable, enter protected lost state, return `sessionLost`, and create no terminal, containment acknowledgement, or unlock claim.

Subscriber queues never use sliding/drop-oldest behavior. Queue exhaustion terminates only that subscription and requires replay/resubscription. If replay is available, resubscription may recover. If the cursor is outside retained history: quiescent session returns `resetRequired`; active or Take-Over-pending session returns `sessionLost`, preserving authority with no terminal claim.

### D4 — Acknowledgement identity, equivalence, stale, and conflict

The authoritative acknowledgement key is:

```text
(operationId, generation, producerSequence, serverSequence)
```

Admission order:

1. Validate complete session/document identity and server authority.
2. Find the admitted progress event by `serverSequence`.
3. Require the event to match all four key fields.
4. Require matching batch and session identity.
5. Apply generation, containment, and terminal fences.
6. Only then evaluate duplicate equivalence.

The first valid acknowledgement records the canonical value and updates counts once. An equivalent duplicate returns the previous result without incrementing counts.

`ackStale` covers older/fenced generation, Take-Over/containment-inapplicable work, post-terminal work, or retained identity no longer in the current admissible generation.

`ackConflict` covers non-equivalent evidence for the same four-field key, a different `serverSequence` for the same `(operationId, generation, producerSequence)`, or a different operation/generation/producer sequence for the same `serverSequence`.

`ackUnknown` applies only when no admitted progress event exists and retained evidence cannot classify it as stale. Session epoch, authority, document, project, and released-session errors retain their specific codes. Delivery, RPC completion, mutation invocation, and an unverified callback never create acknowledgement truth.

### D5 — Custom ephemeral snapshot/replay/live algorithm

Do not reuse `makeCursorSafeSnapshotLiveStream`, which is coupled to durable orchestration history and projector fences.

Implement a custom in-memory algorithm:

1. Strictly decode and validate `WhiteboardOperationSubscribeInput`.
2. Under the service atomic transition lock, validate exact authority/session identity.
3. Register the bounded live subscriber queue before capturing state.
4. Capture replay floor, high-water sequence `F`, current snapshot at `F`, and retained replay events where `lastServerSequence < event.serverSequence <= F`.
5. Reject a cursor greater than `F`.
6. Reject an unavailable replay gap using D3 reset/lost semantics.
7. Emit the current `session-snapshot` first.
8. Emit retained replay events in ascending `serverSequence`.
9. Continue queued/live events whose sequence is greater than `F`.
10. De-duplicate by `serverSequence` at the replay/live handoff.
11. Interrupt and release the subscriber on disconnect, duplicate-key replacement, service shutdown, or queue failure.

The snapshot sequence is a state fence; it does not instruct the client to discard retained replay items that follow. Replayed events retain original identities for truthful acknowledgement fencing.

An attached session starts with baseline sequence `1`. Later events are strictly increasing. Replayed events preserve original sequences.

`bufferLiveUiStream` must not be layered over this stream with a sliding policy. The service’s bounded lossless queue and explicit replay-gap failure are authoritative.

### D6 — Unary versus stream request admission

These five unary methods remain in existing standard request admission with the current limit of 12 concurrent standard requests per RPC client:

```text
whiteboard.operation.attachSession
whiteboard.operation.acknowledgeApplication
whiteboard.operation.takeOver
whiteboard.operation.retry
whiteboard.operation.releaseSession
```

`whiteboard.operation.subscribe` is a streaming RPC, bypasses unary admission under existing middleware, and must explicitly use D1 stream admission. No Whiteboard-specific admission, bypass, priority promotion, or configuration is authorized.

### D7 — Exact `WsRpcError` mapping

The service exposes a typed operation error whose code is a `WhiteboardOperationErrorCode`. `wsRpc.ts` maps it exactly:

```text
WsRpcError.code = serviceError.code
```

No new Whiteboard wire error string may be invented.

Retry mapping:

| Contract key | `retryable` | `retryAfterMs` |
|---|---:|---:|
| `sessionActive` | `true` | `250` |
| all other `WHITEBOARD_OPERATION_ERROR` values | `false` | absent |

Messages are bounded and actionable and contain no raw mutation payload, fingerprint body, adapter evidence, stack, or private state. Unknown defects use the existing generic `toWsRpcError` path without fabricated Whiteboard codes.

Containment outcomes are successful typed Take Over responses/events, not transport errors. `dispatch-failed`, `ack-timeout`, and `containment-failed` remain observable containment truth.

### D8 — Strict schema-normalized idempotency comparison

Idempotency comparison occurs only after strict schema decoding. Unknown keys fail decoding and are never stripped to make inputs equivalent.

Canonicalization rules:

1. Enumerate accepted schema fields explicitly.
2. Normalize absent optional fields to one representation.
3. Normalize negative zero to zero.
4. Preserve order for semantically ordered arrays, including progress elements, points, and mutation payload order.
5. Sort `dependsOnProducerSequences` ascending because it is duplicate-free and semantically a set.
6. Preserve decoded strings exactly; do not trim, case-fold, rewrite Unicode, or rewrite fingerprints beyond schema behavior.
7. Compare immutable canonical values structurally or through deterministic canonical encoding.

Idempotency identities:

- producer progress: `(operationId, generation, producerSequence)`;
- acknowledgement: D4’s four-field key;
- Take Over: `takeOverRequestId` plus equivalent full session, batch, operation, and expected generation;
- Retry: exact predecessor tuple `(batchId, failedOperationId, failedGeneration, failedRetryAttempt)`; an equivalent repeat returns the existing retry;
- release: exact session identity; an equivalent repeat returns the recorded result while its tombstone remains.

A matching idempotency key with non-equivalent canonical content is a conflict, never a new action.

## Atomicity and server authority invariant

All state-machine transitions are serialized through one service-owned Effect synchronization seam, such as a mutex or equivalent atomic `Ref.modify` discipline.

No handler may validate outside the authoritative transition and mutate later, advance generation after dispatcher invocation, increment acknowledgement counts before duplicate/conflict classification, publish before retaining an assigned sequence, emit multiple terminal or containment results, or remove protection merely because a WebSocket disconnects.

## Rejected alternatives

Rejected:

1. Supplemental Whiteboard RPC groups.
2. Thread-scoped stream admission.
3. A second independently minted `serverInstanceId`.
4. Environment/config containment deadlines.
5. Native timers bypassing Effect `Clock`.
6. Test-only production APIs or `__test` hooks.
7. `ThreadDiagnosticsQuery` or persistence from the service.
8. Reusing the durable orchestration cursor helper.
9. Sliding/drop-oldest mutation delivery.
10. Evicting active or Take-Over-pending sessions.
11. Silent replay-gap recovery, false terminal synthesis, or unlock.
12. Comparing raw undecoded objects or stripping unknown keys.
13. Treating dispatch completion as containment acknowledgement.
14. Promoting unary Whiteboard RPCs to control admission without evidence.

## Exact authorized write set for this slice

Create:

```text
apps/server/src/whiteboard/WhiteboardOperationSessionService.ts
apps/server/src/whiteboard/WhiteboardOperationSessionService.test.ts
apps/server/src/wsRpc.whiteboardOperation.test.ts
```

Modify additively:

```text
apps/server/src/wsRpc.ts
```

No other source or test path is authorized by this server slice.

## Prohibited and deferred paths

This decision creates no authority to modify:

```text
packages/contracts/**
apps/server/src/wsCompatibility.ts
apps/server/src/wsStreamAdmission.ts
apps/server/src/wsRequestAdmission.ts
apps/server/src/wsStreamBackpressure.ts
apps/server/src/wsSnapshotLiveStream.ts
apps/server/src/main.ts
apps/server/src/serverLayers.ts
apps/server/src/provider/**
apps/server/src/orchestration/**
apps/server/src/diagnostics/**
apps/server/src/persistence/**
apps/server/src/migrations/**
packages/shared/**
apps/web/package.json
apps/web/src/main.tsx
bun.lock
```

Also deferred: browser bridge/coordinator, assets, persistence/restart restoration, provider/model producer mounting, production Whiteboard UI mounting, cap/lifecycle work outside the fixed local safety bounds, package PASS, workspace `fmt`/`lint`/`typecheck`, and Ticket/feature/final acceptance.

## Required focused verification

Run:

```bash
set -o pipefail
bun run --cwd apps/server test -- \
  src/whiteboard/WhiteboardOperationSessionService.test.ts \
  src/wsRpc.whiteboardOperation.test.ts \
  src/wsCompatibility.test.ts
```

The service suite must prove:

- exact session/document authority and cross-Project rejection;
- one live authority per document/canvas identity;
- all fixed count, byte, session, subscriber, queue, and tombstone limits;
- quiescent LRU eviction and no active/Take-Over eviction;
- fail-closed cap and replay-gap behavior;
- producer sequence/dependency admission;
- canonical producer duplicate/conflict behavior;
- acknowledgement stale/conflict/unknown/equivalent duplicate distinctions and exactly-once counters;
- generation advancement before dispatch and one dispatcher invocation;
- Effect-clock timeout and all four containment outcomes;
- no retry after Take Over, retry idempotency and lineage;
- exactly one terminal outcome;
- release/tombstone behavior;
- service shutdown with pending containment;
- no database, file, orchestration, or diagnostic writes.

The WebSocket suite must mount actual production `WsFeatureRpcGroup` with a real in-process WebSocket client, exercise all six canonical methods, prove total-but-not-thread stream admission, same-key replacement, gap-free and duplicate-free snapshot/replay/live handoff, exact error mapping, standard unary admission, stream admission, internal producer non-membership, and absence of a supplemental group.

Before completion:

```text
git diff --check
exact changed-path audit against the four authorized paths
```

No workspace-wide check or package PASS is inferred.

## Assumptions and residual uncertainty

Assumptions:

- existing Effect RPC stream cancellation closes handler scope and runs queue/subscriber finalizers;
- existing negotiation returns the process-authoritative singleton server ID;
- accepted contracts need no change;
- the dormant production dispatcher safely fails closed until provider integration is separately authorized;
- the browser can treat snapshot sequence as a state fence while processing the explicit replay range.

Residual uncertainty remains around measured production workload, provider containment integration, browser bridge behavior, lifecycle ownership, restart recovery, and assets. These remain deferred.

## Failure and rollback implications

The slice is additive and ephemeral. Rollback removes the service, handlers, and focused tests; no migration or durable repair is required.

Implementation stops and returns to governance if the negotiated authority cannot be supplied within authorized paths, Effect RPC cancellation cannot finalize stream scope, accepted contracts cannot express required fail-closed behavior, containment requires provider/orchestration changes, active state cannot remain bounded without false truth, or canonical-route mounting requires a supplemental group, package/config/main change, or other prohibited path.

No fallback to browser-owned authority, polling, durable operation events, unknown-key stripping, or dropped-event continuation is permitted.

## Downstream effect

After this record is persisted and tracked:

```text
WHITEBOARD TICKET 02 SERVER AUTHORITY/WEBSOCKET SLICE:
IMPLEMENTATION UNBLOCKED
```

Implementation remains restricted to the four authorized paths and focused verification above. This is not implementation PASS or final acceptance.

## Reopening conditions

Reassess only if material implementation evidence shows the existing stream guard cannot support exact session-key replacement; Effect RPC cancellation does not finalize scope; the negotiated singleton ID is inaccessible within authorized paths; accepted schemas make replay/acknowledgement fencing impossible; fixed bounds force false terminal/containment/unlock behavior; the dispatcher cannot remain fail-closed without protected provider changes; strict canonical comparison requires contract changes; or actual canonical WebSocket testing requires prohibited topology or paths.

Measured demand may justify later cap changes, but unsupported scale speculation does not reopen this decision.
