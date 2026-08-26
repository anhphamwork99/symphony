# WP-05 — isolated real-Pi acceptance and Ticket 02 report

**State:** pending

**Owner role:** implementation/evidence worker

**Repository:** Symphony; Alfie is read-only at the WP-04 pin

**Baseline:** Symphony `93628e465866e9bf24610b4fca39b5c30f459221` plus WP-02/WP-03 SHAs, WP-04 source pin commit `29b41689c2ea74dfc45ca6c0c1e2deea05a8f964`, and WP-04 fixture reconciliation `14f3d2a4371a3ea4050b2e54fa026995fd81f706`; exact Alfie commit `73bc7744f8fbbd12206302de2df8230b29a49178`, version `0.15.0-alfie.5`, manifest hashes, and clean-tree/origin evidence are read-only inputs.

**Dependencies:** WP-04 complete. This is the final Ticket 02 work package; it does not accept the ticket or open Ticket 03.

**Authority:** Ticket 02 acceptance criteria and evidence obligations in [`../../issues/02-canonical-identity-and-result-continuity.md`](../../issues/02-canonical-identity-and-result-continuity.md), Decision 0002, binding Decision 0003 for WP-05/F5, and inherited controlled-artifact/real-Pi evidence rules.

## Objective

Exercise the actual controlled managed Pi composition at an isolated runtime boundary and complete Ticket 02's Implementation Report with criterion-level evidence. Separate deterministic repository/service proof, controlled pinned-Alfie proof, and real-Pi proof. Demonstrate canonical public identity, durable-first result continuity, exact live supplement/control, capability fail-closed behavior, eviction/restart continuity, terminal precedence, tuple fencing, bounded diagnostics, and no provider identity leakage.

## Inherited terminal-race evidence obligation (F5)

WP-03 review left F5 open by design. WP-05 must carry and close it with the
required synchronized unit-simulation strands and isolated real-Pi proofs
against the exact WP-04 artifact. The existing scripted `RaceState` cases are
unit simulations only: they may preserve deterministic diagnostic coverage but
must not be labeled Decision 0003 acceptance proof once the actual real-Pi
strands exist. The actual F5 acceptance proof must use the staged-module
instrumentation authorized below. This is evidence only; it does not authorize
a WP-03 or other production-source change. The settled contract is [Decision
0003](../../decisions/0003-terminal-steer-race-linearization-contract.md),
which clarifies but does not supersede Decision 0002.

A managed steer linearizes when the pinned Pi SDK
`AgentSession.steer`/`_queueSteer` synchronously inserts into the exact live
session queue. F5 must prove all three deterministic strands: terminal/live
retirement wins before insertion and returns bounded `unavailable-control` or
stale with zero provider insertion/send; synchronous queue insertion wins and
the request may be applied even when natural completion and durable terminal
commit happen before the call returns; and cancellation invalidates the
generation so post-await bookkeeping cannot mutate lifecycle truth. The
isolated real-Pi proof must separately exercise terminal-first and
enqueue-first
against the exact controlled artifact and SDK path.

Every strand must capture the ordered trace
`invocation -> tuple lookup -> live guard -> SDK insertion (when it occurs) ->
retirement/index removal -> durable commit -> bookkeeping -> return`, exact
current-tuple/terminal state, provider mutation and target observations, bounded
response/diagnostic, and post-race child/queue/replay/Resume/bootstrap/
reconstruction counters. Terminal truth remains durable authority; the exact
index stays retired; no post-terminal second send/requeue/replay/Resume/
bootstrap/reconstruction/new child is allowed; and no provider-local identity
may leak. An applied response is valid only with exactly one prior synchronous
SDK insertion. Late `activeDelegation` bookkeeping is acceptable only when it
cannot reopen status/index, override terminal truth, cause provider action, or
leak identity.

## Exact write set

WP-05 may change only active tracked test/helper fixtures whose positive pin,
capability, or expected-count assertions must follow the WP-04 artifact, plus
the new canonical acceptance suite and the Issue 02 report:

### New acceptance/report artifacts

- `apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` — new isolated real-Pi acceptance suite.
- `apps/server/scripts/wallclock-tests.ts` — add only `src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` to `WALLCLOCK_TESTS`; do not alter runner semantics or register unrelated suites.
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/02-canonical-identity-and-result-continuity.md` — Implementation Report section only; fill from captured evidence and do not change status/frontier/acceptance disposition.

The wallclock manifest entry is required because this suite contains real-Pi
process/model timing and synchronized F5 barriers. The shared `vitest.config.ts`
unit exclusion and `scripts/run-tests.ts` standalone orchestration consume this
manifest; no separate unit-config edit is authorized by WP-05.

### Active apps/server pin/capability fixtures

- `apps/server/src/provider/Layers/PiAdapterDesktopArtifactGate.test.ts`
- `apps/server/src/provider/Layers/PiAdapterDesktopManagedBootstrap.test.ts`
- `apps/server/src/provider/piSubagentAdmissionProgressSaturation.test.ts`
- `apps/server/src/provider/piSubagentArtifactClosureRealLoad.test.ts`
- `apps/server/src/provider/piSubagentArtifactVerifier.test.ts`
- `apps/server/src/provider/piSubagentCancellationAcceptance.test.ts`
- `apps/server/src/provider/piSubagentCancellationCoordinator.test.ts`
- `apps/server/src/provider/piSubagentCompletionOwnershipAcceptance.test.ts`
- `apps/server/src/provider/piSubagentDesktopArtifactGate.test.ts`
- `apps/server/src/provider/piSubagentDesktopManagedRealPiAcceptance.test.ts`
- `apps/server/src/provider/piSubagentDesktopProductionCompositionAcceptance.test.ts` — production required-capability count and capability-name assertions.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts`
- `apps/server/src/provider/piSubagentIntegratedAcceptance.test.ts` — including its stripped-capability helper/copy fixture.
- `apps/server/src/provider/piSubagentManagedRuntimeBinding.test.ts` — managed capability names/counts and legacy profile fixtures.
- `apps/server/src/provider/piSubagentProgressAcceptance.test.ts`
- `apps/server/src/provider/piSubagentProgressObservation.test.ts`
- `apps/server/src/provider/piSubagentRealExtension.test.ts`
- `apps/server/src/provider/piSubagentRealPiAcceptance.test.ts`
- `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts` — real-Pi stripped-capability helper only.
- `apps/server/src/provider/piSubagentRestartAcceptance.test.ts`
- `apps/server/src/provider/piSubagentResumeAcceptance.test.ts`
- `apps/server/src/provider/piSubagentTerminalAcceptance.test.ts`
- `apps/server/src/provider/piSubagentWatchdogAcceptance.test.ts`

### Active packages/contracts fixture

- `packages/contracts/src/piSubagentArtifact.test.ts` — contract artifact pin/version fixture only.

The list deliberately includes the progress/cancel/restart/resume/terminal/
watchdog/completion/integrated acceptance consumers exposed by the exact
re-pin, not merely the two WP-04 provenance tests. It also includes artifact
verifier/gates, desktop bootstrap/gates, managed binding names/counts, the
real-Pi stripped-capability helper, and the contract artifact fixture.

No manifest update, production source change, contract source change, migration,
Alfie file, Project Home, decision, or other issue is in this WP's write set.
`apps/server/src/provider/Layers/PiAdapter.ts`,
`apps/server/src/provider/piSubagentManagedRuntimeBinding.ts`, and
`packages/contracts/src/piSubagents.ts` remain outside the write set even when
comments or shared constants mention the capability.

## Prohibited changes

- No synthetic replacement Agent, fake registry, on-disk lookalike, unpinned extension, or uncontrolled global Pi home.
- No changes to watchdog, teardown, cancellation, lifecycle containment, Resume, provider bootstrap, automatic replay, guardian, or unrelated public API.
- No changes to production source, contracts source, provenance manifest, or Alfie; fixture repair must stay within the exact list above.
- F5 instrumentation is test-only and must not be extracted into production code, the provider manager, the Pi adapter, the managed-tool wrapper, or shared runtime modules. It may wrap only the exact staged artifact module and exact live child session described below, and must restore every prototype/session method in `finally`.
- No blanket replacement of every `.4`/old-commit literal. A legacy, stale, mixed-version, wrong-hash, stripped-capability, or lookalike fixture may retain `.4` or the old commit only when it is an intentional negative/control script and the report classifies its path, test, and expected rejection. Positive active pin assertions must use the WP-04 exact pin.
- No claim that deterministic or controlled fixtures are real-Pi evidence; no claim of Ticket 02 acceptance or downstream-ticket completion.
- No new migration, database rewrite, or test that opens a second read-only SQLite connection while the live repository owns the WAL.

## Implementation contract

Use the existing real-extension/provenance harness patterns and isolated home/runtime configuration. The test must load the registered production Agent from the exact WP-04 artifact and negotiate the canonical-routing capability.

### Authorized synchronized real-Pi F5 instrumentation

After staging and verifying the controlled artifact, but before loading the
production Agent, import the exact staged module
`<artifact>/agent/extensions/pi-subagents/src/agent-manager.ts`. The suite must
prove same-module identity: the imported `AgentManager` constructor/prototype
is the module instance used by the registered production Agent, not a checkout,
global extension, or second module graph. Wrap only
`AgentManager.prototype.steer` from that exact staged module. For the exact
current `(executionId, attemptId, generation)` record selected by the observed
real parent session, temporarily wrap the actual child
`record.session.steer`, preserving the pinned SDK call and its synchronous
queue-insertion boundary. Barriers may hold the returned promise so the suite
can release insertion, retirement, durable commit, bookkeeping, and return in
controlled order; they must not replace or defer the SDK's synchronous
insertion itself.

Trigger the registered production `steer_subagent` tool from the observed real
parent session. Do not call a fabricated tool, synthetic Agent, fake provider,
provider-local global scan, or reconstructed child. Filter every observation to
the exact project/thread/execution/attempt/generation tuple. Observe live
retirement and exact-index removal through `bridgeActiveExecutions`, and observe
durable terminal settlement through the live repository journal. Capture the
required invocation, tuple lookup, live guard, SDK insertion when present,
retirement/index removal, durable commit, bookkeeping, and return trace,
including insertion/send/queue/replay/Resume/bootstrap/reconstruction/new-child
counts and bounded diagnostics. Restore the staged `AgentManager.prototype.steer`
and exact child `record.session.steer` in `finally`, even after timeout or
assertion failure, and assert that no active execution, wrapped method, child,
temporary artifact/home, or journal/test resource remains leaked.

The same-module proof, barrier synchronization, exact tuple filtering,
production-tool trigger, live-bridge retirement observation, journal-terminal
observation, and `finally` restoration are mandatory acceptance conditions;
module-resolution coincidence or a passing simulated race is insufficient.

Before implementation, perform a repository-wide census limited to tracked
`apps/server` and `packages/contracts` tests/helpers. Classify every remaining
old `.4`, pre-WP-04 commit, capability literal, and capability/count assertion
as either (a) an active positive pin-dependent fixture to update, or (b) an
intentional isolated synthetic/legacy negative to preserve. The census must
cover the exact write-set groups above. No active old-pin assertion may remain
unclassified, and no intentional negative may be changed merely to remove its
old version.

Fixture repair rules:

1. Positive provenance consumers, real-extension/real-Pi acceptance fixtures,
   progress/cancel/restart/resume/terminal/watchdog/completion/integrated
   acceptance fixtures, artifact/desktop gates, managed binding fixtures, the
   desktop production required-capability count, stripped-capability helpers,
   and the contract artifact fixture must agree on `73bc7744f8fbbd12206302de2df8230b29a49178`,
   `0.15.0-alfie.5`, and the WP-04 manifest hashes where they assert the pin.
2. Capability arrays, required-capability names, handshake fixtures, stripped
   copies, and expected counts must agree on the active
   `execution-identity-routing-v1` contract. Count changes must be intentional
   and visible in the diff; do not silently drop a capability to preserve an
   old count.
3. The real-Pi stripped-capability helper must remove the canonical capability
   only when the test is proving fail-closed behavior; it must not accidentally
   construct a positive artifact with a stale capability set.
4. Preserve synthetic lookalikes, dirty/wrong-commit/wrong-version/hash
   negatives, historical planning records, and legacy compatibility controls.
   Record each preserved old literal in the evidence/report classification.

Required legs:

1. **Normal identity:** admit one managed child, capture detached public output, read by `execution_id`, and compare the public `executionId` across admission, detached result, durable row/card, read response, live supplement, and terminal evidence. Recursively assert that managed output/details/diagnostics contain no provider `agentId`.
2. **Compatibility and capability:** use canonical `execution_id`; use deprecated equal `agent_id` and record bounded observable deprecation; reject a real provider `agentId`, conflicting alias, malformed/oversized ID, absent capability, incompatible capability, and capability not bound to the exact session.
3. **Durable-first continuity:** force/observe a nonterminal exact-live supplement, then a terminal durable result with a conflicting live nonterminal report. Prove durable terminal wins. Evict the provider record and reopen the durable repository/file as supported by the existing harness; prove the same authorized `executionId` returns bounded durable evidence rather than `Agent not found`. Missing durable evidence remains honest uncertainty.
4. **Fencing and authorization:** exercise stale attempt and generation, wrong project/thread, and unauthorized read/control. Verify rejection occurs before provider lookup and cannot reach another execution's live record.
5. **Exact-live control:** steer an authorized exact current tuple while live; after live-record eviction, return stable unavailable-control. Prove no queue, replay, bootstrap, reconstructed child, or new child occurs.
6. **Terminal steer race (F5), synchronized unit simulation:** retain separate
   terminal-first, enqueue-first, and cancellation strands for deterministic
   service/diagnostic coverage, including the required trace and zero/one
   insertion assertions. These scripted `RaceState` cases are explicitly unit
   simulations, not Decision 0003 acceptance proof, and must not be relabeled
   as real-Pi evidence.
7. **Terminal steer race (F5), isolated real-Pi terminal-first:** after the
   same-module proof and before the controlled artifact is loaded, install the
   test-only staged `AgentManager.prototype.steer` and exact child-session
   wrappers. Trigger the registered production `steer_subagent` tool from the
   observed parent, hold the returned promise with barriers, and win
   retirement/index removal before synchronous SDK insertion. Assert bounded
   `unavailable-control`/stale output, zero insertion/send, and no queue,
   replay, Resume/bootstrap, reconstruction, or new child.
8. **Terminal steer race (F5), isolated real-Pi enqueue-first:** use the same
   staged wrappers and barriers to release the pinned SDK
   `AgentSession.steer`/`_queueSteer` synchronous insertion first, then allow
   natural completion and durable journal terminal commit before the steer call
   returns. Assert exactly one prior insertion, an allowed applied response,
   durable terminal precedence, retired exact index, and no second provider
   action or reconstruction path.
9. **Terminal steer race (F5), real-Pi observations and cleanup:** for both
   actual strands, filter to the exact project/thread/execution/attempt/generation
   record, observe retirement through `bridgeActiveExecutions` and terminal
   truth through the live repository journal, capture the ordered trace,
   artifact/SDK versions, insertion/send/no-replay counters, and bounded
   diagnostics, then assert prototype/session restoration and isolated-runtime
   cleanup even on failure.
10. **Evidence boundaries:** run unit simulation, controlled-Alfie, and
    synchronized real-Pi commands separately; capture command, exit code, test
    count, exact pins, capability response, bounded diagnostics, ordered
    insertion/retirement/durable traces, cleanup/isolation assertions, and any
    timing/runtime caveat.

A real-Pi test may use a deterministic loopback model only as the model server, provided the registered production Pi/Agent path and controlled artifact are real. It must not replace the Agent or provider composition with a fake.

## Tests and evidence contract

The acceptance suite must execute every leg in the implementation contract and preserve separate unit-simulation, controlled-Alfie, and synchronized real-Pi result rows. The scripted `RaceState` rows are diagnostic/unit evidence only and must be visibly excluded from Decision 0003 acceptance claims. The real-Pi rows must prove same-module staged instrumentation, barrier-controlled synchronous insertion, exact tuple filtering, production `steer_subagent` dispatch, `bridgeActiveExecutions` retirement, live-journal terminal truth, ordered traces, and cleanup/isolation assertions. The matrix below is the report shape, not a substitute for running the tests.

In addition, the evidence must include a fixture reconciliation ledger with:

- every active old `.4`/old-commit assertion found and its update, or an exact
  test/helper classification when intentionally retained as a negative;
- capability literal/name/count consistency, including the desktop production
  required-capability count, managed binding fixtures, and stripped-capability
  helpers;
- confirmation that no active positive old-pin assertion remains outside the
  repaired write set;
- confirmation that the WP-04 manifest itself was not rewritten by WP-05.

A full-workspace manifest run may expose stale fixtures outside the original
WP-04 three-file scope. Such failures are WP-05 fixture evidence, not permission
to edit production source or to relabel synthetic fixtures as real-Pi proof.

## Acceptance/report matrix

Populate the existing Issue 02 Implementation Report, without changing its status, with:

| Section | Required evidence |
| --- | --- |
| Candidate commits/pin | WP-02/WP-03 Symphony SHAs; WP-01 Alfie SHA/version; WP-04 manifest hash/clean-tree proof |
| Contract version | `execution-identity-routing-v1` capability request/response and compatibility result |
| Ownership split | Alfie exact live tuple index vs Symphony durable auth/current tuple/read boundary |
| AC1–AC2 | public identity comparisons, no-leak scan, canonical/alias/provider-ID matrix |
| AC3–AC4 | auth-before-provider trace, terminal precedence, eviction/restart durable fallback, exact-live steer unavailable case, and actual real-Pi F5 terminal-first plus enqueue-first traces with same-module proof, retirement/index removal, and durable commit ordering |
| AC5 | stale/unauthorized/missing/oversized/capability/legacy diagnostics; bounded real-Pi terminal-first unavailable/stale result; real-Pi enqueue-first applied result only after exactly one synchronous insertion; unit-simulation cancellation generation invalidation; and no queue/replay/Resume/bootstrap/reconstruction/new-child proof |
| AC6 | separate unit-simulation terminal-first/enqueue-first/cancellation rows (not Decision 0003 acceptance), controlled-Alfie capability/provenance row, and synchronized isolated real-Pi terminal-first/enqueue-first rows with same-module proof, exact artifact/SDK versions, ordered live/journal traces, and cleanup/isolation assertions |
| Non-goals | explicit watchdog/teardown/Resume/bootstrap/replay/guardian exclusions |
| Review handoff | deviations, untested cases, residual risks, and exact shortest reviewer reproductions |

Do not write claims before commands run. Distinguish an implementation failure from an evidence limitation; if a required leg cannot run, return `partial` or `blocked` rather than marking an AC passed.

## Verification commands

Run the focused manifest first, then the full manifest/workspace wrapper when
available; never use `bun test`:

```bash
# Controlled Alfie provenance/canonical capability (read-only exact pin)
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test test/canonical-identity-routing.test.ts \
  test/identity.test.ts test/extension-capabilities.test.ts

# Symphony focused provenance and canonical acceptance
cd /path/to/symphony/apps/server
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentForegroundAcceptance.test.ts
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentCanonicalIdentityAcceptance.test.ts

# Required standalone wallclock proof for the canonical suite. This is the
# wallclock project invocation, not the unit project and not a multi-file run.
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  ./node_modules/.bin/vitest run --project wallclock --maxWorkers=1 \
  --no-file-parallelism src/provider/piSubagentCanonicalIdentityAcceptance.test.ts

# Re-run deterministic routing/read evidence.
bun run test src/provider/piSubagentExecutionReadBoundary.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts

# Re-run active fixture groups as available; include packages/contracts fixture.
bun run test src/provider/Layers/PiAdapterDesktopArtifactGate.test.ts \
  src/provider/Layers/PiAdapterDesktopManagedBootstrap.test.ts \
  src/provider/piSubagentArtifactClosureRealLoad.test.ts \
  src/provider/piSubagentArtifactVerifier.test.ts \
  src/provider/piSubagentDesktopArtifactGate.test.ts \
  src/provider/piSubagentDesktopManagedRealPiAcceptance.test.ts \
  src/provider/piSubagentDesktopProductionCompositionAcceptance.test.ts \
  src/provider/piSubagentManagedRuntimeBinding.test.ts
cd ../../packages/contracts
bun run test src/piSubagentArtifact.test.ts

# Full workspace manifest, when available, to expose any remaining active fixture.
cd /path/to/symphony
bun run test

git diff --check
git status --short
```

Use an isolated Pi home and runtime configuration; never start the user's
default Synara instance. The canonical acceptance command must run the
synchronized unit-simulation terminal-first, enqueue-first, and cancellation
strands separately, while the required standalone wallclock invocation above
must run the actual real-Pi terminal-first and enqueue-first cases in the
wallclock project and keep this suite out of unit discovery through the shared
manifest. Record each command's exit code, elapsed time, test count, exact
pin/capability output, exact artifact and Pi SDK versions
(`@alfie/pi-subagents@0.15.0-alfie.5` and
`@earendil-works/pi-coding-agent@0.83.0`), same-module proof, ordered
live-bridge/journal trace, insertion/send/no-replay counts, prototype/session
restoration, cleanup/isolation assertions, fixture ledger, model/runtime
configuration, provenance output, and database reopen discipline. If the full
wrapper is unavailable or blocked by unrelated workspace infrastructure,
retain focused evidence and report the limitation rather than claiming full
acceptance. Do not run fmt/lint/typecheck for this planning packet.

## Commit and self-review

Create at most two Symphony commits:

```text
test(pi): prove canonical identity and durable result continuity

docs(planning): complete Ticket 02 implementation report
```

The first contains only acceptance-test/helper changes; the second contains only the Issue 02 Implementation Report. Do not commit a status/frontier update and do not push.

Self-review:

- exact repaired write set and two-commit boundary are clean; every changed
  fixture is one of the listed active pin/capability helpers or the new suite;
  the WP-04 manifest remains unchanged;
- real-Pi path used the registered production Agent and exact WP-04 artifact;
- every T02-AC1–AC6 row has normal plus failure evidence and a command/result;
- the fixture reconciliation ledger has zero unclassified active old-pin
  assertions, capability literal/count consistency, and explicit retained
  synthetic/legacy negatives;
- no provider `agentId` leaked; no valid public handle becomes `Agent not found` solely due to live eviction;
- durable terminal precedence, auth-before-provider, tuple fencing, exact-live steer, and both F5 terminal-first and enqueue-first race strands are demonstrated; terminal-first has zero insertion/send, enqueue-first has exactly one prior synchronous insertion, and cancellation invalidates generations and fences post-await bookkeeping;
- every actual real-Pi F5 trace contains invocation, tuple lookup, live guard, SDK insertion when applicable, retirement/index removal, durable commit, bookkeeping, and return, with no post-terminal second action or identity leak; scripted `RaceState` traces are labeled unit simulations only and are not used as Decision 0003 acceptance;
- isolated real-Pi terminal-first and enqueue-first evidence proves same-module staged instrumentation, uses the registered production Agent, exact WP-04 artifact, and exact Pi SDK version rather than a synthetic Agent, and records live-bridge retirement plus live-journal terminal truth;
- the wallclock manifest registers only the canonical suite, unit discovery excludes it through shared config, and the standalone command passes with prototype/session restoration and cleanup/isolation assertions;
- no later-ticket behavior or DB migration was introduced;
- report states every deviation and untested limit honestly.

## Escalation

Return `blocked` for unavailable real-Pi dependencies, dirty/mismatched provenance, or an isolated-runtime failure that prevents required evidence. Return `challenge` if acceptance requires a source change outside prior WPs, a migration, provider bootstrap/replay, or a reinterpretation of Decision 0002. Do not relabel fixture evidence to complete the matrix.
