# Decision 0064: Reassess Decision 0063 canonical WsFeatureRpcGroup write authorization

**Status:** Binding — narrow write-set repair accepted; implementation unblocked after persistence
**Date:** 2026-08-27
**Trigger:** Material technical decision reassessment based on new repository evidence that canonical `WsFeatureRpcGroup` membership is assembled in an omitted source path
**Prior decision disposition:** Decision 0063 remains binding except for the exact write-set amendment recorded here
**Amends:** Decision 0063
**Supersedes:** Only Decision 0063’s omission of `packages/contracts/src/rpc.ts`; no semantic or architectural direction is superseded
**Final-acceptance consultation consumed:** No
**Owner-approved decisions reopened:** None

## Question

Decision 0063 requires six Whiteboard operation methods to join the existing canonical typed production WebSocket route, but the RPC descriptors and canonical `WsFeatureRpcGroup` membership are assembled in `packages/contracts/src/rpc.ts`, which Decision 0063 omitted.

What is the minimal repair that permits implementation without weakening the canonical-route requirement or inventing a parallel RPC group?

## Governing references

Authoritative:

1. [Project Home](../PROJECT.md), routing Ticket 02 to the active package.
2. [Decision 0063](0063-ticket-02-operation-transport-outcomes-authorization.md), governing the complete package contract.

Supporting source evidence:

3. `packages/contracts/src/rpc.ts`, defining typed RPC descriptors and canonical `WsFeatureRpcGroup` through `RpcGroup.make(...)`.
4. `apps/server/src/wsRpc.ts`, consuming `WsFeatureRpcGroup` for the admitted production handler layer.
5. `apps/web/src/wsTransport.ts`, consuming the same group for the typed browser RPC client.
6. Planner evidence that execution readiness fails only because `packages/contracts/src/rpc.ts` is absent from Decision 0063’s write set.

## Evidence finding

`packages/contracts/src/ws.ts` may own method-name constants and compatibility declarations, but it does not assemble canonical typed RPC membership. The production server and browser transport both consume the group assembled in `packages/contracts/src/rpc.ts`.

Therefore the six methods cannot become members of the typed production route solely through Decision 0063’s current paths. A separate supplemental group is not equivalent: it would create parallel route composition and contradict the requirement to extend and test the actual canonical production group.

This is a write-authorization omission, not evidence against the accepted operation-session architecture.

## Reassessment

Amend Decision 0063 narrowly by adding exactly:

```text
packages/contracts/src/rpc.ts
```

to its authorized production contracts and compatibility write set.

The amended Decision 0063 §9 subsection is:

```text
### Production contracts and compatibility

Create:

packages/contracts/src/whiteboardOperation.ts

Modify additively:

packages/contracts/src/index.ts
packages/contracts/src/ws.ts
packages/contracts/src/rpc.ts
packages/contracts/src/wsCompatibility.ts
```

No other write-set entry is added, removed, or broadened.

Within `packages/contracts/src/rpc.ts`, implementation may only:

1. import the schema-only Whiteboard operation contracts required by the six methods;
2. define the six corresponding typed Effect RPC descriptors;
3. add all six descriptors additively to canonical `WsFeatureRpcGroup`; and
4. make directly necessary additive formatting or import-order adjustments.

The six method names remain exactly:

```text
whiteboard.operation.attachSession
whiteboard.operation.subscribe
whiteboard.operation.acknowledgeApplication
whiteboard.operation.takeOver
whiteboard.operation.retry
whiteboard.operation.releaseSession
```

They must be members of the same `WsFeatureRpcGroup` consumed by:

```text
apps/server/src/wsRpc.ts
apps/web/src/wsTransport.ts
```

A supplemental, parallel, Whiteboard-specific, independently mounted, or dynamically merged RPC group is not authorized.

The internal producer methods remain non-WebSocket service methods and must not enter `WsFeatureRpcGroup`:

```text
admitOperation
publishProgress
completeOperation
failOperation
```

## Preserved boundaries

Every other provision of Decision 0063 remains binding and unchanged, including:

- the minimal image-free server seam;
- strict bounded payloads;
- ephemeral in-memory ownership;
- server authority over admission, sequencing, generation, retry, Take Over, containment, and terminal outcomes;
- browser authority over adapter correlation and semantic acknowledgement;
- separation from durable orchestration events and persistence;
- asset deferral;
- all existing production, browser, test, and evidence paths other than the one addition;
- protected package, main, provider, orchestration, persistence, migration, shared, lockfile, and concurrent-project paths;
- focused verification and actual production-route proof;
- `git diff --check` and changed-path audit;
- prohibition on `bun fmt`, `bun lint`, and `bun typecheck`;
- bounded-PASS limitations and return to governance.

No package, main composition, lockfile, browser configuration, persistence, provider, UI-mounting, asset, or workspace-gate authority is created.

## Rejected alternatives

Rejected:

1. leaving the write set unchanged, which makes canonical typed membership impossible;
2. defining method names only in `ws.ts`, which does not assemble the RPC group;
3. creating a supplemental or parallel Whiteboard group;
4. modifying server/web composition to merge another protocol topology;
5. broadening authorization beyond the one source path identified by evidence.

## Assumptions and residual uncertainty

Assumptions:

- `packages/contracts/src/rpc.ts` remains the single canonical assembly point;
- the six descriptors can use schemas from `whiteboardOperation.ts`;
- existing exports continue to expose the group to server and browser;
- no package, config, main composition, or compatibility epoch change is required.

If implementation disproves an assumption, Decision 0063’s existing stop/reopening conditions apply. This reassessment does not establish implementation correctness, bounded PASS, workspace completion, or Ticket 02 acceptance.

## Failure and rollback

If canonical membership proves impossible without another prohibited path or protocol-topology change, implementation stops and returns to governance. It must not create a supplemental group, move schemas into runtime packages, change package/lock files, or weaken production-route proof.

Rollback removes the additive descriptors and canonical membership; no migration or durable-state repair is involved.

## Downstream effect

After this record is persisted and tracked:

```text
WP-OPERATION-TRANSPORT-OUTCOMES: IMPLEMENTATION UNBLOCKED
```

Routing remains:

```text
active-operation-transport-outcomes
```

Implementation and review must audit that all six browser methods are in canonical `WsFeatureRpcGroup`; server and browser consume that same group; no supplemental group exists; internal producer methods are absent from browser-callable membership; and all paths remain inside Decision 0063 as amended.

After bounded PASS and one independent package review, return to governance exactly as Decision 0063 requires.

## Reopening conditions

Reassess only if material evidence shows canonical membership cannot be added through `rpc.ts`; server/browser do not derive their method set from that group; the methods require a protocol epoch, package, main-composition, or other prohibited change; the stream cannot support the bounded subscription; or canonical membership creates a concrete collision not visible now.

Absent such evidence, neither a supplemental group nor broader write-set expansion is authorized.
