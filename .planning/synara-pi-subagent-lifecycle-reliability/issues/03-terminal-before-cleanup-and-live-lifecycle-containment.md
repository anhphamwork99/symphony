# Ticket 03 — terminal-before-cleanup and live lifecycle containment

**Status:** ready-for-agent
**Dependencies:** Tickets 01–02 accepted
**Authoritative decision:** [Decision 0006 — live lifecycle containment linearization contract](../decisions/0006-live-lifecycle-containment-linearization-contract.md)
**Implementation:** authorized within Decision 0006's bounded source and evidence contract

## Objective

Make terminal outcome, live lifecycle observation, and cleanup proof compose
truthfully under races without weakening inherited journal-first, fencing, or
owned-only authority.

## Acceptance criteria

- **T03-AC1:** Terminal evidence is persisted before delivery/public terminal
  notification and remains bounded.
- **T03-AC2:** Terminal-before-cleanup, cleanup-before-terminal, same-generation
  race, and stale-generation race each have deterministic outcomes.
- **T03-AC3:** Watchdog handoff and cleanup uncertainty remain non-terminal and
  preserve bands 70–74; teardown proof remains bands 75–78.
- **T03-AC4:** Live lifecycle containment observes/control only the exact owned
  runtime; no PID guessing, parent fallback, or Symphony PID kill authority.
- **T03-AC5:** Provider inactivity, callback loss, persistence failure, and
  late callback diagnostics are stable and do not falsely claim liveness or
  cancellation.

## Testing seams

Repository transaction/state-machine fixtures; injected event ordering;
controlled live-bridge owner fixtures; watchdog/teardown deterministic seams;
real-Pi non-destructive lifecycle through teardown handoff where inherited
acceptance requires it.

## Implementation Report

### Candidate baseline and cross-repo pin

- Ticket 03 production lineage is unchanged:
  - WP-01 containment core: `b4eef14c7`;
  - WP-01 acceptance-boundary remediation: `98927c8f6`;
  - WP-02 production lifecycle composition: `648f5e569`;
  - WP-02 causal wiring and persistence-failure remediation: `0e5a48369`;
  - owner-authorized verification fixes: `feebc3e9c`;
  - pre-WP-03 source candidate: `020e767b1`.
- WP-03 evidence candidate:
  `1a92d1cfa504e27c27998f42c3c128cda0435388`
  (`test(pi): prove live lifecycle containment with real Pi`). Its parent is
  `3fd97eee665e7bcc2cfcf88b72170f80aa32d154`; intervening commits after
  `020e767b1` are unrelated Whiteboard/planning work and did not change the
  grounded Ticket 03 production seams.
- Controlled provider remained unchanged:
  - repository: `https://github.com/anhphamwork99/alfie.git`;
  - checkout: `/Users/anhpham99/alfie`;
  - commit: `3fe340b401ca86bcbe8b55abd4de107e1d93482e`;
  - package: `@alfie/pi-subagents@0.15.0-alfie.6`;
  - Pi SDK: `@earendil-works/pi-coding-agent@0.83.0`;
  - controlled extension tree: clean, excluding ignored `node_modules`.
- Verified controlled-artifact SHA-256 values:

  | File                                                         | SHA-256                                                            |
  | ------------------------------------------------------------ | ------------------------------------------------------------------ |
  | `agent/extensions/pi-subagents/package.json`                 | `954c5297446149d2e6a997c4f0eefac768611f92599cecab2a5f96255dafa22f` |
  | `agent/extensions/pi-subagents/src/index.ts`                 | `c843406cf94bffdfa7304e2c412766b7cbbcdbfc17fa2846046c77992288d1f9` |
  | `agent/extensions/pi-subagents/src/agent-manager.ts`         | `1f99fd0794c8c32a2229b4f7bc7f3da221ce50d69b221875ba7e8f0f8d879783` |
  | `agent/extensions/pi-subagents/src/agent-runner.ts`          | `98a4c592b14bd7b66b42ea26aabf337d01b6146e618e2c2d67852449a755b1d2` |
  | `agent/extensions/pi-subagents/src/child-bash-supervisor.ts` | `ef44dc6d91ba400187967568b18483792eef3715c616b56aea24e3bb0c48f3c0` |

No Alfie source, package, provenance, runtime, or pin changed.

### Lifecycle ordering contract

The integrated causal order observed by WP-03 is:

```text
durable admission sequence 1
  -> sequence-2 write enters a held causal gate
    -> exact live steer is unavailable
    -> pinned-extension steer emissions = 0
  -> sequence 2 commits
    -> exact route activates
    -> one exact owner steer is accepted
    -> pinned-extension steer emissions = 1
    -> sibling-thread steer is rejected before provider effect
  -> real child terminal callback begins
    -> exact route retires synchronously
    -> band 40 absent
    -> lifecycle notification absent
    -> completion outbox absent
  -> injected first terminal persistence attempt fails
    -> durable state remains nonterminal at [1, 2, 3]
    -> control health degrades with
       pi_subagent_terminal_persistence_failed
    -> exact route remains unavailable
  -> same-tuple repository retry commits band 40
    -> terminal lifecycle notification occurs after commit
    -> no provider callback/control retry or route reconstruction occurs
  -> exact sessions stop
    -> harness listener is released
    -> environment is restored
    -> isolated root is removed
```

The controlled-Alfie suite independently holds the band-40 transaction and
observes the same retire-before-commit boundary: the exact owner route is
already `pi_subagent_live_lifecycle_unavailable`, the extension steer-emission
count remains one, and only releasing the transaction permits sequence 40.

Terminal truth remains the repository sequence-band-40 transaction.
Notification remains post-commit. The direct retry used after the injected
failure is explicitly a **repository retry of the same current tuple and
sequence**, not a provider callback retry and not proof that a lost provider
callback can be reconstructed.

### Owner boundary and proof statement

- The public managed identity remains `executionId`; managed public tool
  results were recursively checked for no `agentId` key. This is a public
  exposure statement, not a claim that Alfie lacks private provider identity.
- One accepted owner steer produced exactly one observed pinned-extension
  `subagents:steered` event. Pre-sequence-2, sibling-thread, retired-route, and
  post-failure calls did not increase that count.
- One real managed admission produced one delegated loopback-model request.
  No second child admission or delegated request occurred.
- The harness observed zero Pi supervisor-backed custom-bash spawn PIDs. This
  proves that this non-destructive run did not enter that owned custom-bash
  operation; it is not a general zero-process or PID-discovery claim.
- No provider scan, parent fallback, callback queue/replay, route
  reconstruction, provider bootstrap, automatic Resume, or Symphony PID-kill
  seam was added. Runtime evidence is limited to the measured admission,
  delegated-request, extension-emission, journal, notification, outbox,
  health, and supervisor-spawn observations above; source boundaries and the
  deterministic containment suites remain the authority for paths that do not
  expose a runtime counter.
- Cleanup proof remains exclusively successful band 76. The band-76 fixture
  below supplies repository-seam `proven` input to verify settlement/fencing;
  it does not claim a real destructive teardown or zero owned children.

### AC evidence matrix and failure diagnostics

| Criterion                                                     | Normal-path evidence                                                                                                                                                   | Failure/race evidence                                                                                                                                                                                                                                                           | Disposition                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| T03-AC1 terminal persisted before notification                | Real-Pi terminal retry commits sequence 40 before exactly one lifecycle notification; terminal card/read truth follows durable state.                                  | Held terminal write has no sequence 40, notification, or outbox. First persistence failure leaves `[1,2,3]`, nonterminal state, and no notification/outbox.                                                                                                                     | Proven.                                         |
| T03-AC2 deterministic terminal/cleanup/current/stale outcomes | Controlled and real-Pi route retirement does not prevent the current same-generation band-40 retry from recording.                                                     | Live-repository fixtures record terminal before 76; after proven 76 increments generation, the old-generation terminal is `ignored_stale`. First-terminal ownership and stale/replaced response classification remain covered by the deterministic core/wiring suites.          | Proven across evidence classes.                 |
| T03-AC3 bands 70–78 preserve uncertainty/proof separation     | Dedicated fixtures on the same live repository observe bands 74, 75, 77, and 78 with `observedState=cancelling` and generation 1.                                      | Same-generation terminal before 76 is `recorded`; proven 76 settles `cancelled`, advances generation to 2, and makes the old terminal stale.                                                                                                                                    | Proven; no real destructive teardown claim.     |
| T03-AC4 exact owned runtime only                              | Exact owner call yields one extension steer emission; sibling call is `pi_subagent_read_unauthorized_or_out_of_scope`; public results expose no `agentId`.             | Pre-sequence-2 and retired calls are unavailable with zero additional extension steer emission; measured admissions/delegated requests remain one and supervisor custom-bash spawns remain zero.                                                                                | Proven at controlled/real-Pi boundary.          |
| T03-AC5 stable inactive/loss/persistence/late diagnostics     | Held sequence 2 gives `pi_subagent_live_lifecycle_unavailable`; terminal failure gives `pi_subagent_terminal_persistence_failed`; durable retry settles independently. | `pi_subagent_live_lifecycle_outcome_unknown` and `pi_subagent_live_lifecycle_stale_ignored` require injected post-acceptance loss/replaced-response barriers and remain causally proven by deterministic containment tests rather than fabricated with elapsed time in real Pi. | Proven with explicit evidence-class limitation. |

Diagnostic/reason evidence:

| Diagnostic                                                                     | Causal boundary                                                                                                      | Evidence class                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pi_subagent_live_lifecycle_unavailable` / `provider_inactive`                 | exact registration captured but sequence 2 held; provider action not accepted; extension steer emissions remain zero | real Pi plus deterministic reason trace                                                                      |
| `pi_subagent_live_lifecycle_unavailable` / `callback_disposed`                 | route retired before terminal commit/failure; further control emits no second steer                                  | controlled Alfie and real Pi plus deterministic reason trace                                                 |
| `pi_subagent_live_lifecycle_outcome_unknown` / post-acceptance loss or timeout | accepted control loses/fails its response; no automatic retry                                                        | deterministic containment core                                                                               |
| `pi_subagent_live_lifecycle_stale_ignored`                                     | in-flight response loses exact tuple/session registration during replacement or clear                                | deterministic containment core and WP-02 wiring                                                              |
| `pi_subagent_terminal_persistence_failed`                                      | first real terminal repository attempt fails after route retirement                                                  | real Pi; degraded adapter-owned control health, no sequence 40/notification/outbox                           |
| `pi_subagent_terminal_stale_ignored`                                           | old generation terminal arrives after proven band 76 advances the fence                                              | live repository fixture                                                                                      |
| `pi_subagent_event_sequence_gap`                                               | invalid lifecycle sequencing                                                                                         | existing terminal/repository deterministic suites; no gap is intentionally created by the real-Pi happy path |

`pi_subagent_terminal_late_applied` is not claimed: WP-02 established that
ordinary pre-ingest route retirement is the normal terminal order and not a
causally distinct warning.

### Band allocation compatibility

| Band  | WP-03 observation                                             | Terminal?          | Fences generation? |
| ----- | ------------------------------------------------------------- | ------------------ | ------------------ |
| 40    | current same-tuple terminal transaction/retry                 | yes                | no                 |
| 70–73 | unchanged watchdog allocation; regression suites remain green | no                 | no                 |
| 74    | teardown handoff fixture stays `cancelling`, generation 1     | no                 | no                 |
| 75    | teardown request fixture stays `cancelling`, generation 1     | no                 | no                 |
| 76    | repository-seam `proven` settles `cancelled`, advances 1 → 2  | guarded settlement | yes                |
| 77    | survivors fixture stays `cancelling`, generation 1            | no                 | no                 |
| 78    | owner-unproven fixture stays `cancelling`, generation 1       | no                 | no                 |

No migration, band, state, public identity, API, or timeout configuration was
added.

### Evidence classes and verification

| Evidence class                               | Command/result                                                                                  | What it proves                                                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic containment/routing/repository | direct Node Vitest, 5 files, **73/73** in **3.41s**                                             | pre/post acceptance classification, inactive/missing/disposed/mismatched routes, outcome unknown, stale response, persistence failure/retry, first-terminal ownership, journal and fencing behavior                        |
| Controlled Alfie `.6`                        | `piSubagentLifecycleContainmentAcceptance.test.ts`, **1/1** in **27.84s**                       | exact owner/sibling routing, one real extension steer insertion, retire-before-band-40, no public `agentId`, unchanged provenance and isolated cleanup                                                                     |
| Controlled extension provenance              | `piSubagentRealExtension.test.ts -t 'T19-AC1, T19-AC7'`, **1 passed / 10 skipped** in **1.81s** | production session loads the pinned real extension and negotiates the controlled capability boundary                                                                                                                       |
| Isolated real Pi                             | Node Vitest `wallclock`, **1/1** in **28.12s** (test body **25.78s**)                           | public WS → production server/repository/PiAdapter → pinned extension → real child; sequence-2 gate, exact steer, sibling isolation, retire-before-failed terminal, degraded health, durable retry, band ordering, cleanup |
| Contracts                                    | `packages/contracts/src/piSubagents.test.ts`, **40/40** in **179ms**                            | shared protocol and public schema remain unchanged                                                                                                                                                                         |

The primary WP-03 matrix (deterministic + controlled + real Pi + contracts)
passed **115/115** tests. The supplemental focused extension-provenance witness
passed one additional selected test (10 unrelated tests skipped).
`git diff --check` passed.

The repository's `bun run test <files>` wrapper expands into the complete unit
project and all registered wall-clock files rather than preserving a strict
file-only invocation. During WP-03 it encountered one unrelated
`AntigravityAdapter.test.ts` cleanup flake, while the exact Antigravity test
passed on isolated retry. The full `piSubagentRealExtension.test.ts` also owns
an existing standalone wall-clock envelope and is not valid as a concurrent
multi-file timing witness; its focused controlled-provenance test passed.
Additionally, the package's original regression command named
`piSubagentLifecycleContainmentRace.test.ts`, which does not exist in this
checkout. WP-03 therefore records the direct Node Vitest commands below as the
shortest reproducible evidence:

```bash
cd /Users/anhpham99/symphony/apps/server

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project unit \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLifecycleContainmentAcceptance.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts

node ../../node_modules/vitest/vitest.mjs run --project unit \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentLiveLifecycleContainment.test.ts \
  src/provider/piSubagentLifecycleContainmentWiring.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/provider/piSubagentTerminalLifecycle.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentRealExtension.test.ts \
  -t 'T19-AC1, T19-AC7'

cd /Users/anhpham99/symphony/packages/contracts
node ../../node_modules/vitest/vitest.mjs run \
  --maxWorkers=1 --no-file-parallelism src/piSubagents.test.ts
```

The latest evidence-capture run used the owned root
`/var/folders/_v/54jgtd2x4nq1h94b1c5qnv400000gn/T/synara-realpi-t17-byhqHy`
and execution tuple
`(exec_97be0800-f934-42dc-991a-fc53f2c3ecd8,
att_049c92e8-c6ea-48d0-8854-37d4ba7f3b95, generation 1)`.
The tree contained isolated home, workspace, SQLite database, parent/child
agent directories, and Pi home with a loopback model endpoint and ephemeral
server port. The test asserted seven distinct real paths, restored
`PI_CODING_AGENT_DIR` and `PI_HOME`, preserved the user's Pi-home digest,
released the module-scope lifecycle listener and extension event listeners,
disposed idempotently, and removed the owned root
(`rootExists=false`, `envRestored=true`, `userPiDigestRestored=true`) after
25,775ms of test-body activity. No default development instance was started.

### Review findings/disposition

Pre-commit implementation review found six issues:

1. hard-coded forbidden counters;
2. insufficient real-Pi causal coverage;
3. controlled evidence overclaiming internal identity/dispatch absence;
4. potentially unbounded cleanup before `dispose`;
5. restored lifecycle listener dropping notification observation; and
6. a non-causal total-duration assertion.

All fixable findings were remediated before `1a92d1cfa`: counters now derive
only from observed events, real-Pi adds sequence-2/persistence/band gates,
identity language is public-surface-only, cleanup is bounded with unconditional
dispose, listener restoration reuses the observing callback, and the runtime
assertion was removed. Response-loss and replaced/stale-response
classification remain deliberately deterministic-only because WP-03 forbids
fabricating them with elapsed time or adding a production callback-injection
seam.

This report records implementation evidence only. WP-04 still owns the one
independent Ticket 03 review; this section does not accept Ticket 03 or change
the project frontier.

### Residual uncertainty and reopening conditions

- The real-Pi failure leg proves a real terminal callback reaches a
  test-decorated production repository and fails after route retirement. Its
  successful follow-up is a direct same-tuple repository retry, not a replayed
  provider callback. A future requirement for provider-originated terminal
  retry would need a separately accepted seam; WP-03 did not reconstruct one.
- Post-acceptance response loss and replaced-session late response are
  deterministic causal fixtures. No real network timeout/loss is used as a
  substitute.
- Bands 74–78 are exercised on the live harness repository with dedicated
  deterministic records. Band 76's `proven` input is not destructive
  exact-owner process proof and makes no zero-owned-child claim.
- No runtime observer exists for every prohibited source path. Negative claims
  are bounded to measured admissions, delegated model requests, extension
  steer emissions, journal bands, lifecycle notifications, outbox rows,
  control health, and supervisor-backed custom-bash spawns, plus the unchanged
  source boundary.
- Workspace `bun typecheck` remains a later Ticket 03 closure blocker from
  unrelated Whiteboard and pre-existing acceptance-helper typing described in
  the WP-03 handoff. WP-03 did not run or claim the final
  `bun fmt`/`bun lint`/`bun typecheck` gate. WP-05 must not close the ticket
  until that bundled gate passes.
- Reopen Decision 0006 only on its listed material triggers: inability to bind
  exact tuple/session identity against `.6`, inability to distinguish
  pre-acceptance absence from possible post-acceptance loss, violation of
  band-40/band-76 transaction ordering, weakened current/stale ownership,
  unbounded/ambiguous diagnostics, a later binding decision, or controlled
  provenance drift.

## Unlock gate

Discharged. Tickets 01–02 are accepted; binding Decision 0006 settles DG-3
through the exact-tuple Alternative A proxy and preserves the inherited closed
DG-4 owner boundary. Ticket 03 is the sole implementation frontier.
