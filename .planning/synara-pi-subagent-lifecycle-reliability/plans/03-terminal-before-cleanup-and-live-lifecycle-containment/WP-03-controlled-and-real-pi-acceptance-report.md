# WP-03 — controlled-Alfie, isolated real-Pi acceptance, and report

**State:** pending

**Owner role:** implementation/evidence worker

**Dependencies:** WP-01/WP-02 committed; focused deterministic tests pass; controlled Alfie `.6` clean.

## Objective

Prove integrated Ticket 03 behavior against unchanged controlled Alfie `.6`, run isolated real-Pi causal evidence, and complete the Ticket 03 Implementation Report. This package does not accept the ticket or change the frontier.

## Exact allowed write set

- `apps/server/src/provider/piSubagentLifecycleContainmentAcceptance.test.ts` — new
- `apps/server/src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts` — new
- `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts` — narrowly required test observations/cleanup only
- `apps/server/scripts/wallclock-tests.ts` — register only the new real-Pi suite
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md` — Implementation Report only

## Prohibited changes

No production/contracts/migration/config/API/provenance/Alfie/Project Home/decision/status/frontier change. No synthetic Agent replacing production Agent, mutable Pi home, default dev instance, PID/parent fallback, replay, bootstrap, Resume, new child, destructive process claim, or relabeling deterministic evidence as real-Pi.

## Controlled `.6` evidence

Prove exact tuple/live guard, sibling and replacement-session isolation, no global scan or `agentId`, fail-closed missing/non-running record, Decision 0003 one synchronous insertion, no managed queue/replay/bootstrap/Resume/reconstruction/new child, and unchanged commit/version/hash/clean tree.

## Isolated real-Pi legs

1. Journal-first terminal: sequence-2 activation; retirement before ingest; band-40 commit; notification afterward.
2. Retired route plus same-generation terminal: live access unavailable before commit; terminal remains applicable; route stays retired.
3. Inactive/missing callback: bounded unavailable, exact reason, zero provider effect, no lifecycle/cleanup claim.
4. Response loss after acceptance: outcome unknown, no retry/second action, later durable evidence settles independently.
5. Replacement/sibling isolation: stale old-session response ignored; no cross-session action.
6. Terminal persistence failure: no notification, degraded health, honest durable state, route retired, later valid retry without reconstruction.
7. Cleanup ordering: 74/75/77/78 remain nonterminal/unfenced; same-generation terminal applies before 76; after 76 old terminal is stale.
8. Forbidden fallback counters: zero replay, automatic Resume, bootstrap, reconstructed route, new child, parent fallback, PID lookup/kill, duplicate control.
9. Disposal: clear before runtime disposal; no leaked routes/timers/listeners; environment/root restored.

Use actual causal barriers, not elapsed-time-only assertions.

## Report contents

Candidate commits; unchanged Alfie/Pi SDK provenance; lifecycle ordering; owner/proof boundary; T03-AC1–AC5 normal/failure matrix; diagnostic/reason matrix; band compatibility; deterministic/controlled/real-Pi rows; forbidden counters; shortest review commands; residual uncertainty and reopening conditions.

## Verification

```bash
cd apps/server
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentLifecycleContainmentAcceptance.test.ts \
  src/provider/piSubagentRealExtension.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts

bun run test src/provider/piSubagentLiveLifecycleContainment.test.ts \
  src/provider/piSubagentLifecycleContainmentWiring.test.ts \
  src/provider/piSubagentLifecycleContainmentRace.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts

cd ../../packages/contracts
bun run test src/piSubagents.test.ts
```

Before closure, repository policy also requires `bun fmt`, `bun lint`, and `bun typecheck`. Obtain explicit owner authorization before running them, bundle them once, and record exit codes/warning/package counts. WP-05 remains blocked until they pass.

Then run `git diff --check` and record exact status, counts, wallclock duration, isolated paths, artifact hashes, and cleanup.

## Commit boundaries

```text
test(pi): prove live lifecycle containment with real Pi
docs(planning): complete Ticket 03 implementation report
```

## Handoff

Candidate/evidence/report SHAs; AC and diagnostic matrices; exact artifact/SDK; separate evidence classes; verification results; residual risks; reviewer commands; status.

## Escalation

Return `blocked` for unavailable controlled checkout/artifact/SDK/isolated environment. Return `challenge` if evidence needs Alfie modification, synthetic Agent, route replay, new bands/migration/API/PID authority/parent fallback, or later-ticket redesign.