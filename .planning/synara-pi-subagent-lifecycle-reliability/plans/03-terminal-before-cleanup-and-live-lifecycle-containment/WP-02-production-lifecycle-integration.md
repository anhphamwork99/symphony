# WP-02 — production lifecycle integration and deterministic race proof

**State:** complete

**Owner role:** implementation worker

**Dependencies:** WP-01 committed and focused tests passing.

## Objective

Compose containment into the production Pi lifecycle and prove sequence-2 activation, synchronous pre-terminal retirement, pre-disposal clearing, journal-first notification, persistence failure truthfulness, and unchanged bands 70–78.

## Exact allowed write set

- `apps/server/src/provider/Layers/PiAdapter.ts`
- `apps/server/src/provider/piSubagentLifecycleContainmentWiring.test.ts` — new
- `apps/server/src/provider/piSubagentLifecycleContainmentRace.test.ts` — new
- `apps/server/src/provider/piSubagentTerminalLifecycle.test.ts`
- `apps/server/src/persistence/Layers/PiSubagentExecutionRepository.test.ts`

`piSubagentTerminalCoordinator.ts` is outside the write set. Stop for a plan amendment if it must change.

## Prohibited changes

No WP-01 files, contracts, Alfie, migration/schema/config/public API, watchdog, teardown, cancellation, Resume, provenance, report, or real-Pi helper change. No activation on admission alone, route reconstruction, new band/state, or generation fence outside successful band 76.

## Implementation contract

1. Compose one WP-01 instance per managed Pi session, bound to exact `runtime.session` identity.
2. Pass it to managed wrappers without weakening capability/session binding.
3. Activate the exact tuple only after durable sequence-2 `started` persistence succeeds.
4. Sequence-2 failure leaves no active route and preserves existing degraded-health/failure behavior.
5. Synchronously retire the exact route before `ingestPiSubagentTerminal`.
6. Persistence failure leaves the route retired, suppresses notification, preserves honest nonterminal state, and permits only existing bounded terminal retry—not route reconstruction.
7. Emit optional late-applied diagnostic only after a current first-applicable terminal commits after route retirement.
8. Preserve ordinary terminal owner-map release after durable terminal success and preserve cancelling/teardown owner mappings through band 76.
9. Clear the exact containment session before runtime disposal; late responses become stale ignored.
10. Add test-only causal traces; no lifecycle timer.

## Deterministic race matrix

- Terminal commits before cleanup; later uncertainty cannot overwrite it.
- Bands 74/75/77/78 before terminal remain nonterminal/current; same-generation terminal applies.
- Band 76 before terminal fences; late old-generation terminal is stale.
- First-applicable terminal ownership.
- Stale attempt/generation/replaced/disposed session causes no current mutation.
- Terminal persistence failure: zero notification, degraded health, honest state, successful bounded retry, no route/child recreation.
- Missing callback before dispatch: unavailable, zero provider effect.
- Response loss after acceptance: outcome unknown, zero retry.
- Late callback cannot reopen route or cause a second action.
- Session clear precedes disposal and isolates siblings.
- Managed steer terminal race preserves zero-vs-one insertion semantics.
- Bands 70–74 and 75/77/78 remain non-fencing; only 76 fences.

## Acceptance mapping

T03-AC1 through T03-AC5.

## Verification

```bash
cd apps/server
bun run test src/provider/piSubagentLifecycleContainmentWiring.test.ts \
  src/provider/piSubagentLifecycleContainmentRace.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts

git diff --check
```

Record ordered traces, journal/aggregate states, insertion/send/notification counts, route sizes, and proof that only band 76 advances generation for cleanup proof.

## Commit boundary

```text
feat(pi): linearize lifecycle containment with terminal ingress
```

## Handoff

Commit SHA, changed symbols, activation/retirement/disposal traces, complete deterministic AC matrix, unchanged terminal/watchdog/teardown/contracts/Alfie proof, and WP-03 reproductions.

## Escalation

Return `challenge` if activation cannot follow sequence 2, retirement cannot precede terminal ingest, clearing cannot precede disposal, retry requires route recreation, repository authority is contradicted, or repair would widen into later-ticket scope.

## Completion record

**Source commits**

- `648f5e569` — compose one exact-session containment instance into `PiAdapter`, capture at admission, activate after durable sequence 2, retire before terminal ingest, and clear before runtime disposal.
- `0e5a48369` — add production-composition evidence, reject handled terminal-persistence failures, and remove the non-causal ordinary-terminal late-applied warning.

**Causal evidence**

- Before sequence 2, steer returned
  `pi_subagent_live_lifecycle_unavailable` with zero provider calls.
- After sequence 2 committed, the exact tuple entered the provider once.
- An injected sequence-2 persistence failure left journal sequence `[1]`,
  kept the route inactive, and made no additional provider call.
- While `recordTerminalEvent` was held in flight, the exact route was already
  retired; steer returned unavailable before the band-40 commit.
- An injected terminal persistence failure produced no terminal notification
  and no completion-outbox row, left the route retired, and rejected the
  producer with `pi_subagent_terminal_persistence_failed`.
- The existing bounded terminal retry committed `[1, 2, 40]` and its outbox
  row without provider access or route reconstruction.
- Clearing the session before runtime disposal caused an in-flight provider
  response to revalidate as `pi_subagent_live_lifecycle_stale_ignored`; a
  post-stop call made no second provider action.

**Deterministic verification**

```text
piSubagentLifecycleContainmentWiring.test.ts: 4/4
focused affected unit suite: 7 files, 96/96
git diff --check: pass
```

The focused suite included the WP-01 containment tests and the existing
terminal, teardown, repository, foreground, progress, and canonical-routing
coverage. Those existing tests remain the lower-level authority for
first-applicable terminal ownership, stale generations, bands 74/75/77/78
remaining non-fencing, and band 76 alone advancing the cleanup fence. A
second duplicate race harness was therefore not added.

**Review disposition**

Independent review returned **PASS WITH GAPS** on the semantics. Its
fix-before-commit findings were closed:

- the new managed-tool results now have an explicit test result type instead
  of producing new `unknown` property-access errors;
- the sequence-2 failure seam is now exercised causally.

The optional `pi_subagent_terminal_late_applied` event was deliberately not
emitted. Pre-ingest retirement is the normal ordering for every terminal, so
the proposed condition would have warned on every ordinary terminal rather
than identify a distinct late callback. The diagnostic remains reserved in
the contract vocabulary for now; WP-05 must either document that reservation
or remove it under an explicit contracts write-set amendment.

The owner authorized the workspace checks after WP-02 completion:

- `bun fmt`: pass on 3,089 files; unrelated formatter churn was restored while
  retaining the formatted Ticket 03 files.
- `bun lint`: pass with 0 errors and 33 warnings; WP-02's two newly introduced
  warnings were removed.
- `bun typecheck`: remains blocked outside WP-02. The contracts package passes
  after correcting its diagnostic-code literal inference. Workspace
  typechecking stops on four pre-existing whiteboard errors in `apps/web`;
  standalone server typechecking additionally reports pre-existing Ticket 02
  acceptance/helper errors and WP-01 managed-binding tuple-narrowing errors.

Ticket 03 closure therefore remains blocked on the integrated workspace
typecheck gate even though WP-02's focused behavior and contracts checks pass.
