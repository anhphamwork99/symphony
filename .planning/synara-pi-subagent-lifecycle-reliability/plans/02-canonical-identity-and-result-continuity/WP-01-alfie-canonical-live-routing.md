# WP-01 — Alfie canonical live routing

**State:** pending

**Owner role:** implementation worker

**Repository:** `/Users/anhpham99/alfie`

**Baseline:** `aa6fa4a8540644d2509b10d6df854486ddc67d1d` / `@alfie/pi-subagents@0.15.0-alfie.4`; confirm clean status before editing.

**Dependencies:** none. WP-02 consumes this contract; do not wait for or edit Symphony.

**Authority:** [`../../decisions/0002-canonical-execution-identity-and-result-read-contract.md`](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md), especially §§1–2 and §4. Ticket 02 is the only implementation frontier.

## Objective

Make the pinned extension's managed result/control boundary use the server-owned public `executionId` and exact current tuple while retaining Alfie `agentId` solely as private in-memory correlation. Remove provider identity leakage from managed output/details, support canonical `execution_id`, retain only a bounded equal-value deprecated `agent_id` alias, and make exact-live-only result/control resolution possible for Symphony's durable-first routing.

## Exact write set

- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-manager.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/identity.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/agent-tool-execute.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/extension-capabilities.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/synara-bridge.test.ts`
- one new focused test under `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/` named `canonical-identity-routing.test.ts`

Do not edit `package.json` or dependencies in this WP; WP-04 owns version/provenance repinning.

## Prohibited changes

- No Symphony files, contracts, migrations, database/schema changes, or Project Home files.
- No global provider scan, cross-session lookup, durable storage in Alfie, or provider `agentId` acceptance as a public handle.
- No changes to watchdog, lifecycle terminal settlement, cleanup, teardown, Resume, bootstrap, replay, parent cancellation, or general Agent UX.
- No change to legacy/unmanaged behavior except tests proving it remains outside the managed contract.
- No synthetic result authority and no public diagnostic containing `agentId` or raw provider internals.

## Implementation contract

1. Carry and validate the managed identity `{ executionId, attemptId, generation }` at the actual Agent result/control seam. Treat all three fields as one immutable tuple; do not resolve a record by `executionId` alone when a current tuple is available.
2. Add an exact session-scoped index keyed by `(executionId, attemptId, generation)` whose value is the private provider `agentId`/record reference. Register and remove entries with the existing managed record lifecycle. Bound the index to live managed records and ensure duplicate or stale tuples cannot resolve another record.
3. Change managed `get_subagent_result` and `steer_subagent` schemas to prefer `execution_id`. Keep `agent_id` only as a deprecated syntactic alias: normalize it to the public `executionId`, reject a value that is not the same public ID, and make alias use observable through a bounded deprecation marker/diagnostic. Never interpret an Alfie provider `agentId` as the alias value.
4. Keep provider lookup private and exact: after Symphony has authorized the tuple, Alfie may use the tuple index to obtain its local record. Missing exact live state returns a stable unavailable-live result/control outcome to the host, not a public `Agent not found` identity failure.
5. Ensure managed detached output, result payloads, details, and diagnostics expose `executionId` only as logical identity. `attemptId`/generation may be present where needed for fencing; `agentId` must not be serialized. Preserve existing bounded result/output limits.
6. Advertise the capability equivalent to `execution-identity-routing-v1` only when the implemented routing surface is complete. A malformed/incompatible managed binding must fail closed; absence of managed binding preserves legacy behavior.
7. Preserve existing exact-live-only steer behavior. Do not queue, reconstruct, bootstrap, replay, or create a child when the exact tuple is missing or non-live.

## Tests and evidence contract

Add normal and negative coverage for:

- detached output/details/result contain the same `executionId` and no `agentId`;
- exact tuple maps to one record, duplicate tuple cannot cross records, and session isolation prevents another session from resolving it;
- canonical `execution_id` and equal deprecated `agent_id` reach the same public identity;
- a real provider `agentId`, conflicting alias, empty/oversized input, and stale attempt/generation are rejected without provider access;
- missing live tuple returns a bounded host diagnostic rather than `Agent not found` and does not queue/dispatch;
- exact-live steer succeeds only for the authorized live tuple and is unavailable after eviction;
- absent/incompatible capability fails closed for managed use while legacy/unmanaged invocation retains current behavior;
- provider identity never appears in managed output, details, diagnostics, or error text.

Use actual extension manager/tool seams, not a fake global registry. Record exact test names and counts.

## Verification commands

Run before and after the change:

```bash
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents

git rev-parse HEAD
git status --short
bun run test test/canonical-identity-routing.test.ts
bun run test test/identity.test.ts test/agent-tool-execute.test.ts \
  test/extension-capabilities.test.ts test/synara-bridge.test.ts
bun run test

git diff --check
git status --short
```

Do not run `bun test`; do not run workspace `bun fmt`, `bun lint`, or `bun typecheck` for this packet. If a focused test exposes a source contract conflict, stop and report `challenge` rather than widening the write set.

## Commit and self-review

Create exactly one Alfie commit:

```text
feat(pi-subagents): route managed identity by execution tuple
```

Self-review checklist:

- `git diff --name-only` is a subset of the exact write set;
- no package/version/provenance change slipped into WP-01;
- no managed public field contains `agentId` or raw provider errors;
- all provider accesses follow exact tuple resolution and never authorize identity;
- legacy tests remain green and the capability is not advertised on partial binding;
- no migration, lifecycle, cleanup, Resume, replay, or bootstrap behavior changed.

Report the full commit SHA, focused/full test exit codes and counts, tuple/index bounds, and any diagnostic wording. Do not claim Symphony integration or real-Pi evidence.

## Escalation

Return `challenge` if the existing Alfie record lifecycle cannot maintain an exact tuple index without a global scan or if the host binding cannot carry the tuple without changing an unapproved protocol. Return `partial` only if the bounded Alfie seam is complete but a separately owned capability/version or Symphony contract is genuinely pending.
