# Decision 0063: Authorize Ticket 02 WP-OPERATION-TRANSPORT-OUTCOMES with the minimal operation-session seam

**Status:** Binding — bounded image-free production operation-session seam authorized
**Date:** 2026-08-27
**Trigger:** Material technical decision verification after source evidence showed that a web-only package cannot prove authoritative Take Over, containment, or final operation outcomes
**Prior decision disposition:** Decisions 0055, 0058, and 0062 remain binding. This record fulfills Decision 0062’s post-native-image-Gate reassessment.
**Supersedes:** None
**Final-acceptance consultation consumed:** No
**Owner-approved decisions reopened:** None

## Question

Must `WP-OPERATION-TRANSPORT-OUTCOMES` include the minimal contracts/server/WebSocket operation-session seam now, or may it remain web-only while deferring authoritative identity, Take Over, containment, and outcomes?

If the server seam is required, what identity, generation, sequencing, retry, Take Over, reconnect, outcome, write-set, and verification boundaries govern implementation?

## Governing references

Authoritative:

1. [Project Home](../PROJECT.md), which routes Ticket 02 to this reassessment.
2. [Decision 0055](0055-ticket-02-fallback-dual-history-contract-approved.md), governing dual-history and outcome semantics.
3. [Decision 0058](0058-ticket-02-native-image-gate-authorization.md), governing the ephemeral operation-session ownership architecture.
4. [Decision 0062](0062-ticket-02-native-image-drop-gate-passed-routing.md), governing the post-native-image-Gate boundary.

Supporting:

5. [Ticket 02](../issues/02-prove-ai-batch-undo-redo.md), especially AC2, AC8, and AC10.
6. [Decision 0047](0047-testing-strategy-governance-reassessment.md), governing verification seams.
7. [Fallback implementation plan](../plans/02-fallback-dual-history-implementation.md), especially §§4, 7, 11, and 12.
8. Source-grounded evidence that no Whiteboard operation schema, server operation-session authority, or production WebSocket route currently exists; the current harness drives `SynaraAiHistoryCoordinator` directly and can prove adapter correlation but not server containment.

## Evidence finding

The existing browser coordinator and Excalidraw adapter can prove that a synthetic write reached a correlated callback and semantically verified target. They cannot authoritatively establish admission, operation authority, producer ordering, Take Over dispatch, containment acknowledgement, retry prohibition, terminal outcome ownership, or same-authority reconnect.

Those are server-owned facts under Decisions 0058 and 0047. Treating a local UI unlock, browser-side generation increment, or adapter callback acknowledgement as any of those facts would be false success.

## Decision

Authorize exactly one bounded package:

```text
WP-OPERATION-TRANSPORT-OUTCOMES
```

It must include the minimal contracts/server/WebSocket operation-session seam now. A web-only split is rejected because it cannot produce PASSable evidence for authoritative Take Over, AC2 production outcome ownership, or AC8 containment.

The package is:

- production-shaped but image-free;
- ephemeral and in-memory only;
- additive to the existing typed WebSocket RPC transport;
- server-authoritative for admission, identity, sequence, retry, Take Over, containment, and outcomes;
- browser-authoritative only for adapter correlation and semantic application acknowledgement;
- coordinated with the existing browser AI-history owner without moving AI history to the server;
- dormant outside focused tests and the bridge until a later package mounts Whiteboard into production UI/provider flows.

Progressive Whiteboard operations remain outside durable orchestration events and projections.

Project and Ticket 02 routing advance to:

```text
active-operation-transport-outcomes
```

## 1. Ownership boundary

### Server operation-session service

The server owns operation-session admission; server authority; operation-session identity and epoch; batch and operation identity; operation generation; producer and session event sequence; dependency admission; acknowledgement admission; retry lineage; Take Over idempotency, immediate generation fencing, dispatch, timeout, and containment result; exactly one terminal outcome; and rejection of duplicate, conflicting, stale, out-of-order, post-terminal, and post-containment input.

The service is ephemeral. It writes no database row, orchestration journal event, snapshot projection, file, or restart record.

### Browser operation bridge

The browser bridge subscribes or resumes against the server-issued identity, forwards admitted image-free mutations to the coordinator/adapter, waits for adapter callback correlation, verifies the expected semantic target, sends one truthful semantic application acknowledgement, and keeps the coordinator/history lock consistent with server outcome and containment truth.

WebSocket delivery, method return, scene-write invocation, or an unverified callback is never acknowledgement.

### Browser AI-history coordinator

`SynaraAiHistoryCoordinator` remains sole owner of immutable before/after AI snapshots, AI event append and cursor movement, Redo branching, native-history clear ordering, browser lock/fault state, and human-mutation invalidation. AI history must not move to contracts, server state, orchestration events, or persistence.

### Excalidraw adapter

The adapter remains owner of public Excalidraw writes, opaque synthetic scopes, callback correlation, canonical target verification, native-history clear execution, and adapter diagnostics.

## 2. Contract ownership and protocol surface

Create schema-only contracts in:

```text
packages/contracts/src/whiteboardOperation.ts
```

`packages/contracts` contains no timer, state machine, retry loop, mutation implementation, persistence logic, or Excalidraw runtime type.

Export through `packages/contracts/src/index.ts`; extend `packages/contracts/src/ws.ts` additively; and advertise optional capability:

```text
whiteboard.operation-session-v1
```

The bridge refuses to open a session when the capability is absent. The bounded browser RPC surface is:

```text
whiteboard.operation.attachSession
whiteboard.operation.subscribe
whiteboard.operation.acknowledgeApplication
whiteboard.operation.takeOver
whiteboard.operation.retry
whiteboard.operation.releaseSession
```

The service additionally exposes internal non-WebSocket producer methods for focused tests and later provider integration:

```text
admitOperation
publishProgress
completeOperation
failOperation
```

Those internal producer methods must not become browser-callable RPC methods.

## 3. Exact identity, generation, sequencing, and retry fields

Every applicable command or event carries:

```text
serverInstanceId
operationSessionId
sessionEpoch
projectId
documentKind
documentId
canvasIdentity
```

- `operationSessionId` is opaque, unguessable, and server-minted.
- `sessionEpoch` is a positive server-minted integer scoped to the session.
- Project/document/canvas identity is explicit and never inferred from an active tab or thread.
- Identity is immutable for one epoch and is correlation plus applicability, not authority by itself.
- Missing, mismatched, stale, cross-Project, unknown, or released identity fails closed.

Every admitted operation carries:

```text
batchId
operationId
generation
expectedDocumentRevision
retryOfOperationId
retryAttempt
```

- Initial `retryAttempt` is `0`.
- Retry creates a new opaque `operationId` and strictly greater generation.
- Retry names the immediate failed predecessor and never revives it.
- Take Over marks the lineage non-retryable.

Each progress mutation carries:

```text
operationId
generation
producerSequence
serverSequence
dependsOnProducerSequences
expectedBeforeRevision
expectedAfterRevision
expectedSemanticFingerprint
```

- `producerSequence` starts at `1` and is strictly contiguous per operation/generation.
- Identical duplicate producer input is idempotent; conflicting duplicate fails the operation.
- Skipped or out-of-order input is rejected before browser delivery.
- `serverSequence` is strictly monotonic for every emitted event in a session epoch.
- Dependencies are bounded, duplicate-free, and only reference lower admitted sequences.
- Invalid work is not delivered; dependent work stops; prior independently acknowledged work remains eligible for partial outcome.
- Payloads are strict, bounded, versioned, and image-free. Raw Excalidraw JSON, `Schema.Unknown`, binary data, data URLs, file IDs, image operations, and private package types are prohibited.

## 4. Truthful browser acknowledgement

`acknowledgeApplication` carries the full session and operation identity plus:

```text
producerSequence
serverSequence
adapterCorrelationId
applicationResult
resultingMutationRevision
verifiedSemanticFingerprint
diagnosticCode
```

`applicationResult` is exactly:

```text
applied-semantic
applied-no-op
rejected
```

- Semantic/no-op acknowledgement is legal only after correlated callback and canonical verification.
- `rejected` carries a bounded diagnostic code.
- Acknowledgements are idempotent only when equivalent after schema normalization.
- Conflicting duplicates and stale identities fail closed.
- Only `applied-semantic` counts as a valid semantic mutation.
- The coordinator exposes no AI event before server terminal outcome and required containment truth agree with browser evidence.

## 5. Take Over semantics

`takeOver` carries full identity plus:

```text
expectedGeneration
takeOverRequestId
```

The server atomically:

1. verifies session and operation identity;
2. rejects stale or terminal operations;
3. records the request idempotently;
4. advances authoritative generation before dispatch;
5. marks the lineage non-retryable;
6. rejects later old-generation producer updates;
7. emits `take-over-pending`;
8. dispatches stop through an injected server-owned containment dispatcher;
9. waits for authoritative containment acknowledgement;
10. emits exactly one containment result and finalizes only on acknowledgement.

Default containment deadline:

```text
2_000 ms
```

Focused tests may inject a shorter deadline and fake clock. No config or environment variable is added.

Containment results:

```text
acknowledged
dispatch-failed
ack-timeout
containment-failed
```

Only `acknowledged` permits an `interrupted` terminal outcome and browser unlock. Dispatch is not acknowledgement. On other results the generation fence remains, the lineage remains non-retryable, no interrupted-success is claimed, and the browser remains protected with an actionable diagnostic.

Repeated equivalent `takeOverRequestId` returns recorded state; a different request cannot dispatch a second stop.

## 6. Reconnect and session epoch

A transient WebSocket reconnect does not reset the session.

The bridge compares `serverInstanceId` and presents session ID, epoch, and last processed `serverSequence`. Resume is allowed only when the same server authority owns the exact live session epoch. Subscription emits a current session snapshot followed by later events; duplicate replay is harmless and conflicting replay fails closed.

The snapshot contains operation identity/generation, Take Over and containment state, acknowledgement summary, terminal outcome, and latest sequence. It contains no scene, AI history snapshot, binary asset, or durable orchestration history.

Changed authority, unknown session, stale epoch, release, or unrecoverable replay gap is never silently resumed:

- with no active operation, report `operation-session-reset-required`;
- with an active or Take Over-pending operation, enter `operation-session-lost`, remain protected, create no terminal event, and make no containment claim.

Active session release is rejected. Durable recovery, server-restart restoration, close/eviction wiring, and AC7 lifecycle triggers remain deferred.

## 7. Terminal outcome taxonomy

The server records exactly one outcome:

```text
completed
interrupted
failed-partial
zero-valid
```

### Completed

Requires normal producer completion, all admitted work truthfully acknowledged, at least one semantic acknowledgement, and no unresolved sequence/dependency/application/Take Over/containment failure. It produces exactly one AI event after final verification and native-history clear.

### Interrupted

Requires acknowledged Take Over containment, at least one earlier semantic acknowledgement, and no accepted post-containment input. It produces exactly one AI event for the verified partial state.

### Failed-partial

Requires producer, validation, dependency, or browser application failure; acknowledged containment where work could still be active; at least one earlier semantic acknowledgement; and invalid/dependent work unapplied. It produces exactly one AI event for the verified valid partial state.

### Zero-valid

Used when no semantic mutation was acknowledged, with reason exactly one of:

```text
zero-mutation
semantic-no-op
pre-batch-capture-failed
invalid-first-operation
all-operations-rejected
application-rejected-before-first-valid
```

It produces no AI event, native-history clear, cursor movement, or silent success.

Terminal records include accepted semantic/no-op counts, last accepted producer sequence, terminal reason, and containment result. The browser supplies semantic application evidence; the server derives terminal taxonomy.

## 8. Assets explicitly deferred

This package is image-free and must not implement or claim image/file payloads, binary ownership, asset preflight, `addFiles`, image restore/export verification, missing asset handling, asset-reference mismatch, restore rollback, or asset-related locked-fault recovery.

Those remain exclusively assigned to:

```text
WP-AI-ASSETS-RESTORE-FAILURE
```

## 9. Exact authorized write set

### Production contracts and compatibility

Create:

```text
packages/contracts/src/whiteboardOperation.ts
```

Modify additively:

```text
packages/contracts/src/index.ts
packages/contracts/src/ws.ts
packages/contracts/src/wsCompatibility.ts
```

### Server authority and RPC wiring

Create:

```text
apps/server/src/whiteboard/WhiteboardOperationSessionService.ts
```

Modify additively:

```text
apps/server/src/wsRpc.ts
```

The service may be instantiated once inside the existing WebSocket RPC layer composition. No server main/layer graph, provider manager, orchestration projector, persistence, migration, or database change is authorized.

### Browser transport and bridge

Create:

```text
apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.ts
```

Modify additively:

```text
apps/web/src/wsTransport.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
```

`wsTransport.ts` may add only the typed Whiteboard stream, reconnect/resubscribe behavior, and focused cleanup. The harness modification is test-only composition. No production Whiteboard route or UI mount is authorized.

### Focused tests

Create:

```text
packages/contracts/src/whiteboardOperation.test.ts
apps/server/src/whiteboard/WhiteboardOperationSessionService.test.ts
apps/server/src/wsRpc.whiteboardOperation.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraOperationTransportOutcomes.acceptance.browser.tsx
```

Modify additively:

```text
packages/contracts/src/ws.test.ts
apps/server/src/wsCompatibility.test.ts
apps/web/src/wsTransport.test.ts
apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
```

Existing tests may change only for new exhaustive unions, capability, or outcome coverage.

### Evidence

Create:

```text
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.md
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.focused.log
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-b.browser.log
```

No other path is authorized.

## 10. Prohibited paths and work

The package must not modify:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
packages/shared/**
apps/server/src/main.ts
apps/server/src/serverLayers.ts
apps/server/src/provider/**
apps/server/src/orchestration/**
apps/server/src/persistence/**
apps/server/src/migrations/**
apps/web/src/components/Sidebar.tsx
apps/web/src/components/chat/**
apps/web/src/rightDockStore*
apps/web/src/store*
.planning/synara-pi-*/**
```

It must not add/change packages, Excalidraw version, browser config, RightDock, status rail, launcher, tabs, Focus mode, persistence, Auto-save, File-canvas writes, cap, lifecycle, accessibility, education, production provider/model production, durable state/events, database schema, raw Excalidraw transport, private APIs, assets, or acceptance claims.

Adding the typed RPC method and stream to the already-mounted production WebSocket group is authorized; mounting Whiteboard UI or a production producer is not.

## 11. Focused verification protocol

Required focused suites:

```bash
set -o pipefail

bun run --cwd packages/contracts test -- \
  src/whiteboardOperation.test.ts \
  src/ws.test.ts

bun run --cwd apps/server test -- \
  src/whiteboard/WhiteboardOperationSessionService.test.ts \
  src/wsRpc.whiteboardOperation.test.ts \
  src/wsCompatibility.test.ts

bun run --cwd apps/web test -- \
  src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.test.ts \
  src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts \
  src/wsTransport.test.ts
```

Contracts/server tests must prove strict bounds, cross-Project rejection, sequence rules, duplicate semantics, dependency stop, acknowledgement counting, all terminal outcomes and zero-valid reasons, generation advancement before dispatch, old-generation rejection, one stop dispatch, all containment results including fake-clock timeout, retry identity/generation, no retry after Take Over, exactly one terminal outcome, reconnect replay, stale/lost/release failures, and absence of durable writes.

The WebSocket test must mount the actual production `WsFeatureRpcGroup` route and communicate through a real in-process WebSocket client. Service-only calls are insufficient.

Browser Run A and B use stable Chromium and the pinned real Excalidraw embed:

```bash
set -o pipefail

VITEST_BROWSER_API_PORT=<distinct-free-port-a> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraOperationTransportOutcomes.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-a.browser.log
run_a_status=${PIPESTATUS[0]}
test "$run_a_status" -eq 0

VITEST_BROWSER_API_PORT=<distinct-free-port-b> \
  bun run --cwd apps/web test:browser:stable -- \
  src/components/whiteboard/ticket02/SynaraOperationTransportOutcomes.acceptance.browser.tsx \
  2>&1 | tee .planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-b.browser.log
run_b_status=${PIPESTATUS[0]}
test "$run_b_status" -eq 0
```

The browser test may use a deterministic contract-level transport fixture but must use the real coordinator, adapter, and Excalidraw embed. It proves completed, interrupted, failed-partial, zero-valid, truthful acknowledgement, replay/duplicate/stale fencing, Take Over pending lock, containment failure protection, acknowledged unlock/finalization, and post-containment rejection without image/file behavior.

Evidence records source SHA, Excalidraw version, exact commands/exits, log hashes, capability/method audit, identity/retry/outcome/reconnect matrices, Take Over traces, changed/prohibited path audit, and deferred claims.

Run `git diff --check` and audit changed paths before declaring evidence complete.

## 12. Workspace checks remain deferred

This package does not authorize or claim:

```text
bun fmt
bun lint
bun typecheck
```

Focused tests and browser evidence can pass this bounded package but do not establish final workspace completion or Ticket 02 acceptance. No package or lockfile operation is permitted.

## 13. Bounded PASS and failure semantics

A package PASS may claim only:

```text
WP-OPERATION-TRANSPORT-OUTCOMES: BOUNDED PASS
Contracts and identity fencing: PASS
Ephemeral server operation-session authority: PASS
Production WebSocket RPC/stream seam: PASS
Truthful browser semantic acknowledgement: PASS
Take Over dispatch/containment state machine: PASS
Completed/interrupted/failed-partial/zero-valid taxonomy: PASS
Same-authority reconnect and lost-session fail-closed behavior: PASS
AI assets/restore/failure: DEFERRED — NOT CLAIMED
Cap/lifecycle/accessibility/RightDock/persistence: DEFERRED — NOT CLAIMED
Integrated production Whiteboard/provider mounting: DEFERRED — NOT CLAIMED
Ticket 02 acceptance: NOT CLAIMED
```

Execution stops and returns to governance if an identity requires a prohibited path; transport requires package/config/main changes; generation cannot advance before Take Over dispatch; containment cannot be distinguished from dispatch; failure unlocks; delivery is treated as semantic acknowledgement; stale/post-containment work reaches canonical application; Retry revives identity or remains after Take Over; terminal outcome can be written twice; reconnect crosses authority silently; lost active session unlocks or creates an event; assets/persistence become necessary; or either browser run fails.

No scope expansion may turn failure into PASS.

## 14. Rejected alternatives

Rejected:

- web-only outcomes, because the browser cannot prove admission, producer containment, or server outcomes;
- durable orchestration events for progressive Whiteboard updates, because Decision 0058 binds ephemeral sessions;
- monolithic outcomes/assets package, because transport and binary restore have separate ownership/failure surfaces;
- poll-only unary transport, because the existing typed RPC stream supports bounded progressive delivery and reconnect;
- browser-owned generation or Take Over result, because local fencing is necessary but not authoritative;
- immediate provider/RightDock mounting, because it combines unrelated surfaces before the seam is proven;
- package upgrade or private Excalidraw integration.

## 15. Assumptions and residual uncertainty

Assumptions:

- the existing typed WebSocket stream supports one bounded additional subscription without package/config/protocol-epoch change;
- negotiated `serverInstanceId` is the server-authority discriminator;
- an injected containment dispatcher can prove deterministic success/failure/timeout without a real model;
- the existing synthetic-scope contract remains valid for image-free operations.

Deferred uncertainty includes production provider integration, RightDock mounting, restart/application lifecycle recovery, cap/reset triggers, assets/restore/rollback, full integrated application evidence, workspace checks, feature review, and final acceptance.

## 16. Failure and rollback

Changes are additive and reversible. If the package fails, do not mount the bridge, preserve failure evidence, and do not fall back to browser-owned Take Over, durable progress events, polling, raw Excalidraw transport, or a monolithic assets package. No migration or durable-state repair is required.

## 17. Downstream routing

After this record is persisted and tracked, implementation may begin within the exact write set.

After bounded PASS and one independent read-only package review, return to governance. The later decision may authorize `WP-AI-ASSETS-RESTORE-FAILURE` or require remediation. It must not infer cap/lifecycle, accessibility, RightDock, persistence, provider mounting, full integration, workspace gates, feature review, or final acceptance.

Ticket 02 final acceptance remains an exactly-once later consultation after the complete integrated ticket, full verification, and one independent feature-level review.

## Reopening conditions

Reassess only if material evidence shows the existing WebSocket transport cannot support the bounded stream within authorized paths; containment requires protected provider/orchestration changes; payloads cannot remain strict/bounded/image-free; `serverInstanceId` cannot distinguish authority changes; or focused failure exposes false unlock, duplicate terminal state, stale canonical admission, or unbounded leakage.

Absent such evidence, implementation must not reopen the web-only alternative.
