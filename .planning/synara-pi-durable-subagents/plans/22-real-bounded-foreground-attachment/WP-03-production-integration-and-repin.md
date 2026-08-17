# WP-03 — Symphony production integration and Alfie provenance re-pin

**State:** blocked until WP-01 and WP-02 complete

**Owner role:** worker

**Repository:** `/Users/anhpham99/symphony`

**Dependencies:** committed WP-01 Alfie hash; integrated WP-02 Symphony commit

## Task

Require the new capability, bind validated policy and a repository-backed
per-invocation lifecycle reporter into the real Agent call, implement the
Ticket-21 health-degradation response to lifecycle-write failure, preserve the
unbounded Symphony `originalExecute` await, and pin the exact committed WP-01
Alfie source.

## Context and authority

The authoritative production order is:

```text
actual Agent invocation
  → atomic admission / accepted sequence 1
  → immutable per-invocation managed binding
  → actual Alfie child start
  → running/started sequence 2
  → inline result OR running/detached sequence 3 + handle
```

Decision 0004 owns admission and identity. Decision 0005 owns shared control
health. [Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
owns the new attachment and failure contract. None may be reopened locally.

Supporting source:

- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/piSubagentBridge.ts`
- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts`
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.ts`
- `apps/server/src/provider/piSubagentControlHealth.ts`
- `apps/server/src/provider/piSubagentRealExtension.test.ts`
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`

## Allowed write set

- `apps/server/src/provider/piSubagentBridge.ts`
- `apps/server/src/provider/piSubagentBridge.test.ts`
- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/Layers/PiAdapter.test.ts`
- `apps/server/src/main.ts` only if existing composition requires explicit
  config forwarding
- `apps/server/src/provider/piSubagentForegroundLifecycle.test.ts` — new
  focused provider test for lifecycle reporter behavior
- `apps/server/src/provider/piSubagentRealExtension.test.ts`
- `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`

Do not edit contracts/config settled by WP-02, repository implementation,
migrations, UI, Alfie source, or any downstream-ticket surface.

## Grounding note

This package touches the production provider path and durable lifecycle:

- **Change surface:** capability negotiation, PiAdapter managed Agent wrapper,
  existing repository service calls, real-extension provenance.
- **Callers/impact:** compatible Pi sessions only; legacy sessions must bypass
  managed admission exactly as before.
- **Invariants:** admission commits before child start; identities come from
  server truth; no Symphony timeout; shared health degradation is transition
  only; existing durable truth is preserved.
- **Verify path:** bridge and PiAdapter focused tests, repository-backed
  failure injection, exact real-extension provenance test.

## Implementation contract

### Capability flip

Add `bounded-foreground-attachment` to the required managed capability set.
An absent, malformed, incompatible, or capability-missing bridge remains
legacy unmanaged: no managed admission, binding, bounded label, or durability
claim.

### Reporter closure

After `accepted` admission and before invoking `originalExecute`, construct one
immutable binding for that accepted execution and attach it to a copied
`effectiveCtx`.

The Symphony-owned `reportObservation` closure:

- accepts only `started` then `detached`;
- supplies trusted execution/attempt/generation and server correlation;
- maps `started` to sequence 2, `state: "running"`;
- maps `detached` to sequence 3, `state: "running"`;
- uses deterministic retry-stable event IDs derived from trusted identities and
  phase;
- records bounded metadata containing phase, occurrence time, attachment mode,
  and resolved budget only;
- serializes observations so sequence 2 settles before sequence 3;
- treats duplicate retry-stable events as convergence, not a second transition;
- rejects on repository failure with the existing
  `pi_subagent_lifecycle_persistence_failed` diagnostic.

On returned repository failure, transition the existing adapter-lifetime
control health to degraded through the accepted Ticket-21 mechanism and emit
only the fixed safe transition warning. Alfie receives the rejection and owns
exact-child containment. Preserve sequence 1 and any earlier lifecycle truth;
make no terminal claim.

Keep the call to `originalExecute` as a normal await. Do not race it with a
Symphony timer.

### Concurrency and cleanup

Each accepted invocation receives a distinct context and reporter state.
Reporter completion removes its local closure state. One execution's write
failure must not mutate another aggregate or binding. Shared-health
degradation may block later fresh managed admission as already defined by
Decision 0005; it must not label or stop a legacy child.

### Provenance

After WP-01 is committed:

- update the pinned Alfie commit to its exact full hash;
- recompute the existing manifest hashes for `package.json`, `src/index.ts`,
  and `src/agent-manager.ts`;
- keep package identity/version equal to the actual committed package;
- do not add or remove tracked artifacts unless the existing provenance gate
  cannot cover a materially changed authoritative file—in that case return
  `challenge`;
- verify origin, exact HEAD, clean extension path, package identity, and every
  hash against `/Users/anhpham99/alfie`.

## Test-first sequence

1. Required capability accepts new Alfie and sends older compatible extension
   to legacy behavior.
2. Accepted invocation receives one immutable trusted binding before the real
   tool executes; concurrent contexts remain isolated.
3. Reporter writes exact seq2/seq3 order and bounded metadata.
4. Duplicate observation converges idempotently.
5. Sequence-2 and sequence-3 returned failures each degrade health, preserve
   prior truth, return stable diagnostic through the tool path, and leave an
   unrelated execution unchanged.
6. Fresh managed admission follows existing degraded/recovery behavior; an
   adjacent legacy Agent remains usable and unlabeled.
7. No test or source adds a Symphony race around `originalExecute`.
8. Real-extension smoke confirms new capability and binding on the exact pin.

## Verification

```bash
cd /Users/anhpham99/symphony/apps/server
bun run test src/provider/piSubagentBridge.test.ts \
  src/provider/Layers/PiAdapter.test.ts \
  src/provider/piSubagentForegroundLifecycle.test.ts \
  src/provider/piSubagentAdmissionCoordinator.test.ts \
  src/provider/piSubagentControlHealth.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts

bun run test
```

Also run the contracts package's normal suite once after integration. Record
commands, exit codes, counts, exact commit/hash table, and failure diagnostics.

## Completion and commit rule

- WP-01 hash is committed, exact, and clean.
- Focused and full server verification passes.
- No write outside the allowed set.
- Create one local Symphony commit:
  `feat(pi): integrate bounded foreground attachment (issue 22)`.
- Record Symphony commit and Alfie pin. Do not push.

## Challenge conditions

Stop if the reporter cannot preserve sequence order and idempotency with the
existing repository, if a Symphony timeout appears necessary, if a schema
change appears necessary, if lifecycle persistence can hang in the tested
path, or if provenance cannot prove the exact source.
