# WP-01 — Alfie canonical live routing

**State:** completed (Alfie commit `73bc7744f`; Ticket 02 remains unaccepted)

**Owner role:** implementation worker

**Repository:** `/Users/anhpham99/alfie`

**Baseline:** `aa6fa4a8540644d2509b10d6df854486ddc67d1d` / `@alfie/pi-subagents@0.15.0-alfie.4`; clean status was confirmed before editing.

**Dependencies:** none. WP-02 consumes this contract; WP-04 later consumes the immutable WP-01 Alfie commit/version read-only. Do not wait for or edit Symphony.

**Authority:** [`../../decisions/0002-canonical-execution-identity-and-result-read-contract.md`](../../decisions/0002-canonical-execution-identity-and-result-read-contract.md), especially §§1–2 and §4. Ticket 02 is the only implementation frontier.

## Objective

Make the pinned extension's managed result/control boundary use the server-owned public `executionId` and exact current tuple while retaining Alfie `agentId` solely as private in-memory correlation. Remove provider identity leakage from managed output/details, support canonical `execution_id`, retain only a bounded equal-value deprecated `agent_id` alias, and make exact-live-only result/control resolution possible for Symphony's durable-first routing. WP-01 also owns the exact `0.15.0-alfie.4` → `0.15.0-alfie.5` package version bump, committed together with this runtime change.

## Exact write set

- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/index.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/src/agent-manager.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/identity.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/agent-tool-execute.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/extension-capabilities.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/synara-bridge.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/package.json` — only the package `version` field; bump exactly from `0.15.0-alfie.4` to `0.15.0-alfie.5`
- one new focused test under `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/` named `canonical-identity-routing.test.ts`
- `/Users/anhpham99/alfie/agent/extensions/pi-subagents/test/steering.test.ts` — accepted scope amendment; final hardening legitimately changed this existing test

The final exact write set therefore includes `test/steering.test.ts` in addition
to the originally listed paths. No dependencies or scripts may change. WP-01 owns the package version bump and must commit it together with the runtime implementation; WP-04 consumes the resulting immutable Alfie commit/version read-only.

## Prohibited changes

- No Symphony files, contracts, migrations, database/schema changes, or Project Home files.
- No global provider scan, cross-session lookup, durable storage in Alfie, or provider `agentId` acceptance as a public handle.
- No changes to watchdog, lifecycle terminal settlement, cleanup, teardown, Resume, bootstrap, replay, parent cancellation, or general Agent UX.
- No change to legacy/unmanaged behavior except tests proving it remains outside the managed contract.
- No synthetic result authority and no public diagnostic containing `agentId` or raw provider internals.

## Implementation contract

1. Update only the package `version` field from `0.15.0-alfie.4` to the exact required `0.15.0-alfie.5`. If that version is already present, reserved, or otherwise collides, stop and return `challenge`; do not select another version. Commit this manifest change in the same Alfie commit as the runtime implementation and tests.
2. Carry and validate the managed identity `{ executionId, attemptId, generation }` at the actual Agent result/control seam. Treat all three fields as one immutable tuple; do not resolve a record by `executionId` alone when a current tuple is available.
3. Add an exact session-scoped index keyed by `(executionId, attemptId, generation)` whose value is the private provider `agentId`/record reference. Register and remove entries with the existing managed record lifecycle. Bound the index to live managed records and ensure duplicate or stale tuples cannot resolve another record.
4. Change managed `get_subagent_result` and `steer_subagent` schemas to prefer `execution_id`. Keep `agent_id` only as a deprecated syntactic alias: normalize it to the public `executionId`, reject a value that is not the same public ID, and make alias use observable through a bounded deprecation marker/diagnostic. Never interpret an Alfie provider `agentId` as the alias value.
5. Keep provider lookup private and exact: after Symphony has authorized the tuple, Alfie may use the tuple index to obtain its local record. Missing exact live state returns a stable unavailable-live result/control outcome to the host, not a public `Agent not found` identity failure.
6. Ensure managed detached output, result payloads, details, and diagnostics expose `executionId` only as logical identity. `attemptId`/generation may be present where needed for fencing; `agentId` must not be serialized. Preserve existing bounded result/output limits.
7. Advertise the capability equivalent to `execution-identity-routing-v1` only when the implemented routing surface is complete. A malformed/incompatible managed binding must fail closed; absence of managed binding preserves legacy behavior.
8. Preserve existing exact-live-only steer behavior. Do not queue, reconstruct, bootstrap, replay, or create a child when the exact tuple is missing or non-live.

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
- `package.json` contains only the exact `0.15.0-alfie.5` version bump, with no dependency, script, or provenance change;
- the runtime implementation, tests, and package version are committed together in the one required Alfie commit;
- no managed public field contains `agentId` or raw provider errors;
- all provider accesses follow exact tuple resolution and never authorize identity;
- legacy tests remain green and the capability is not advertised on partial binding;
- no migration, lifecycle, cleanup, Resume, replay, or bootstrap behavior changed.

Report the full commit SHA, focused/full test exit codes and counts, tuple/index bounds, and any diagnostic wording. Do not claim Symphony integration or real-Pi evidence.

## Completion record

- **Outcome:** WP-01 is complete and the exact Alfie implementation was
  integrated on the primary Alfie `main` as commit `73bc7744f`.
- **Base/candidate/version:** base `aa6fa4a8540644d2509b10d6df854486ddc67d1d`
  / `@alfie/pi-subagents@0.15.0-alfie.4`; candidate
  `73bc7744f` / `@alfie/pi-subagents@0.15.0-alfie.5`.
- **Candidate tree:** `e48c0deb97c10323282712c89059ee4d299e8150`.
  The isolated reviewed candidate was carried into this primary commit/tree.
- **Final changed files:** exactly the two runtime files, package version,
  the four originally listed focused tests, the new canonical-identity test,
  and the amended `test/steering.test.ts`:
  `src/index.ts`, `src/agent-manager.ts`, `package.json` (version field only),
  `test/identity.test.ts`, `test/agent-tool-execute.test.ts`,
  `test/extension-capabilities.test.ts`, `test/synara-bridge.test.ts`,
  `test/canonical-identity-routing.test.ts`, and `test/steering.test.ts`.
- **Verification evidence supplied:** canonical identity suite **8/8**;
  focused steering suites **82/82** and **58/58**; full extension suite
  **36 files / 545 tests**; `git diff --check` passed. The Alfie primary
  checkout was clean after commit, and the Symphony checkout had no source
  or unrelated primary changes.

### Review findings and remediations

The independent review result was **PASS WITH GAPS**. Before integration, the
orchestrator completed the required hardening:

- made the `agent_id` schema optional;
- immediately unindexed all managed lifecycle transitions from the exact-live
  index;
- enforced the managed 2000-character bound with verbose omission;
- restored `durationMs`;
- fixed the managed error preview;
- delivered diagnostic redaction; and
- incorporated the review's recommendation to accept the existing
  `test/steering.test.ts` scope variance because final hardening legitimately
  changed that file.

### Scope audit and residual boundaries

The final Alfie commit is limited to the amended exact write set. The WP-01
implementation changed no Symphony source, contracts, migrations, Project Home
status/frontier, or other primary repository files; this record is the only
primary-checkout planning change for this closeout. The result proves only the
Alfie implementation and its controlled extension tests. It does **not** claim a controlled artifact,
Symphony integration, isolated real-Pi behavior, Ticket 02 acceptance, or
Project acceptance. WP-02 is the next package; WP-04 still owns the later
read-only provenance re-pin.

## Escalation

Return `challenge` if `0.15.0-alfie.5` is already present, reserved, or otherwise collides; if the existing Alfie record lifecycle cannot maintain an exact tuple index without a global scan; or if the host binding cannot carry the tuple without changing an unapproved protocol. Return `partial` only if the bounded Alfie seam is complete but a separately owned Symphony contract is genuinely pending.
