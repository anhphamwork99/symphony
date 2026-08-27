# Ticket 03 WP-03 agent handoff — controlled and real-Pi evidence

**Prepared:** 2026-08-27

**Repository:** `/Users/anhpham99/symphony`

**Current candidate:** `020e767b1`

**Project Home:** [`../PROJECT.md`](../PROJECT.md)

**Active package:** [`../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/WP-03-controlled-and-real-pi-acceptance-report.md`](../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/WP-03-controlled-and-real-pi-acceptance-report.md)

## Start here

Ticket 03 is the sole implementation frontier. WP-01 containment core and
WP-02 production lifecycle integration are complete. Continue with WP-03:
controlled-Alfie evidence, isolated real-Pi causal acceptance, and the Ticket
03 Implementation Report. Do not accept or route the ticket from WP-03.

Read in this order:

1. [`../PROJECT.md`](../PROJECT.md) — authoritative status and frontier router.
2. [`../decisions/0006-live-lifecycle-containment-linearization-contract.md`](../decisions/0006-live-lifecycle-containment-linearization-contract.md) — binding Ticket 03 contract.
3. [`../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/PLAN.md`](../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/PLAN.md) — serial package plan.
4. [`../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/WP-03-controlled-and-real-pi-acceptance-report.md`](../plans/03-terminal-before-cleanup-and-live-lifecycle-containment/WP-03-controlled-and-real-pi-acceptance-report.md) — exact WP-03 write set, legs, commands, and escalation rules.
5. [`../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md`](../issues/03-terminal-before-cleanup-and-live-lifecycle-containment.md) — T03-AC1–AC5 and the Implementation Report target.

## Accepted state and lineage

Ticket 02 is accepted against controlled Alfie
`3fe340b401ca86bcbe8b55abd4de107e1d93482e`,
`@alfie/pi-subagents@0.15.0-alfie.6`, and Pi SDK `0.83.0`.
Ticket 03 must not change that controlled provider.

Ticket 03 lineage:

```text
d48537ffc  Decision 0006 — live lifecycle containment contract
ea8caf183  Ticket 03 serial execution plan
b4eef14c7  WP-01 containment core
98927c8f6  WP-01 acceptance-boundary remediation
8d62bdb3a  WP-01 completion record
648f5e569  WP-02 PiAdapter production lifecycle composition
0e5a48369  WP-02 causal wiring tests and persistence-failure fix
a62650f70  WP-02 completion record and WP-03 routing
feebc3e9c  owner-authorized verification fixes
020e767b1  workspace lint warnings cleared
```

`648f5e569` captures one volatile containment instance per managed Pi
session, binds it to exact `runtime.session` identity, activates only after
durable sequence 2, retires before terminal ingest, and clears before runtime
disposal.

`0e5a48369` adds production-composition evidence and fixes a real failure
surface: `ingestPiSubagentTerminal` can return success-channel
`{ outcome: "failed" }`; `PiAdapter` now rejects that undurable terminal
instead of silently treating it as success. It also removes the proposed
ordinary-terminal `terminal-late-applied` warning because pre-ingest route
retirement is the normal ordering for every terminal and therefore was not a
causally distinct signal.

## Invariants that must not move

- `executionId` is the sole managed public identifier; Alfie `agentId` stays
  private.
- Durable authorization and current-tuple resolution precede provider access.
- Live access requires the exact current
  `(executionId, attemptId, generation, providerSessionInstance)`
  registration.
- Capture does not activate. Successful durable sequence 2 activates.
- Route retirement is synchronous and precedes terminal ingest. Retirement is
  permanent.
- Only the sequence-band-40 transaction creates terminal truth.
- Only successful band 76 proves cleanup and advances the generation fence.
- Bands 70–75, 77, and 78 remain nonterminal and non-fencing uncertainty.
- Missing/inactive callback before acceptance is
  `pi_subagent_live_lifecycle_unavailable` with zero provider effect.
- Possible loss after provider acceptance is
  `pi_subagent_live_lifecycle_outcome_unknown`; never retry automatically.
- Stale/replaced/disposed responses are
  `pi_subagent_live_lifecycle_stale_ignored` with no current mutation.
- No route reconstruction, global scan, queue, replay, provider bootstrap,
  automatic Resume, new child, PID guessing, parent fallback, or Symphony
  process kill.
- Terminal notification remains post-commit. Persistence failure suppresses
  notification/outbox publication and leaves the route retired.
- Clearing the exact containment session precedes runtime disposal.

## WP-02 evidence already available

`apps/server/src/provider/piSubagentLifecycleContainmentWiring.test.ts`
provides four production-composition tests:

1. pre-sequence-2 unavailable/zero provider, post-sequence-2 exact one call,
   plus injected sequence-2 failure leaving journal `[1]` and the route
   inactive;
2. route retired before a held `recordTerminalEvent` commit;
3. terminal persistence failure with no notification/outbox, route still
   retired, and bounded retry committing `[1, 2, 40]` without provider access
   or route reconstruction;
4. session clear making an in-flight response stale, with no second provider
   action.

Focused WP-02 evidence passed:

```text
piSubagentLifecycleContainmentWiring.test.ts  4/4
affected server unit suite                    7 files, 96/96
packages/contracts piSubagents               40/40
git diff --check                             pass
independent WP-02 semantics review           PASS WITH GAPS
```

The review's fix-before-commit gaps were closed: explicit managed-tool result
typing and causal sequence-2 failure coverage. Existing terminal/teardown
repository tests remain the lower-level authority for first-terminal
ownership, stale generations, bands 74/75/77/78 remaining non-fencing, and
band 76 alone advancing the fence.

## Current verification state

Owner-authorized workspace verification was run:

```text
bun fmt       PASS — 3,093 files on the latest formatting pass
bun lint      PASS — 0 warnings, 0 errors on 2,655 files
git diff --check
              PASS
```

Focused lint-remediation regressions:

```text
server selected suite                 187/188 on first run
Antigravity cleanup timing retry      1/1 pass
artifact-cache tests                  25 pass, 1 skipped
runtime activity projection           16/16
web unit tests                        19/19
Pi execution rail browser             3/3
Ticket 01 Excalidraw browser          9/9
Ticket 02 history-gate browser        4/4
ChatView focused browser              2/2
```

The one initial Antigravity failure was
`natural-close run directory was not cleaned up`; the exact test passed on
immediate isolated retry. The lint change only hoisted pure helpers and did
not alter cleanup or timer behavior.

`bun typecheck` is still red and remains a Ticket 03 closure blocker. The
latest workspace run reached `@synara/web` and failed on unrelated whiteboard
work:

- `ExcalidrawTicket01Harness.tsx` missing `clearNativeHistory` and
  `restoreScene` on its handle;
- `SynaraHistoryGate.acceptance.browser.tsx` file-map type incompatible with
  `JsonObject`;
- two `SynaraSceneUpdate` fixtures missing required `elements`.

A standalone server typecheck also reports pre-existing Ticket 02/WP-01
acceptance/helper typing issues in:

- `piSubagentCanonicalIdentityAcceptance.test.ts`;
- `piSubagentManagedRuntimeBinding.ts`;
- `piSubagentRealPiAcceptanceHelpers.ts`.

Do not report Ticket 03 closure until the integrated workspace typecheck gate
passes. Re-run the bundled final checks only after WP-03 evidence/report and
the later closure package are ready, unless a focused type fix needs earlier
proof.

## Next agent assignment

Execute WP-03 exactly as written. Expected new evidence files:

```text
apps/server/src/provider/piSubagentLifecycleContainmentAcceptance.test.ts
apps/server/src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts
```

The real-Pi suite must run through Node Vitest, not Bun, because the required
path uses `node:sqlite`. Use:

```bash
cd /Users/anhpham99/symphony/apps/server

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentLifecycleContainmentAcceptance.test.ts \
  src/provider/piSubagentRealExtension.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts
```

Keep deterministic, controlled-Alfie, and synchronized real-Pi evidence as
three separate evidence classes. Do not claim a real provider boundary from
scripted fixtures.

WP-03 must prove or record all nine legs listed in its package, especially:

- actual causal barriers around sequence 2, route retirement, band 40, and
  notification;
- pre-acceptance unavailable versus post-acceptance outcome unknown;
- replacement/sibling session isolation;
- terminal persistence failure and retry without reconstruction;
- bands 74/75/77/78 versus band 76 fencing;
- zero forbidden fallback/action counters;
- exact environment, listener, route, timer, and root cleanup.

Complete the Ticket 03 Implementation Report in the issue file, with candidate
SHAs, exact provenance/hashes, AC and diagnostic matrices, ordered traces,
wallclock duration, isolated paths, cleanup evidence, limitations, and shortest
review commands.

## Governance after WP-03

The serial sequence remains:

```text
WP-03 evidence/report
  -> WP-04 one independent Ticket 03 review
    -> WP-05 Ticket 03 closure/routing
```

Do not invoke the Project Supervisor for Ticket 03. The project reserves
exactly one Supervisor final-acceptance consultation for the complete
integrated six-ticket project after one project-level reviewer evidence
package.

If WP-03 exposes a material technical decision contradicting Decision 0006,
stop with `challenge`; do not silently alter the design. If the controlled
checkout, exact artifact, SDK, or isolated environment is unavailable, return
`blocked` with exact evidence.

## Working-tree and operational safety

Current unrelated owner changes must be preserved and excluded from Ticket 03
commits:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
```

There may also be concurrent `.planning/synara-whiteboard/` work. Do not stage,
restore, reformat, or commit it as part of this project.

No push, release, deployment, default `bun run dev`, or interaction with the
old runtime `acdad0ab` is authorized. Never kill a process without proven
ownership.
