# WP-05 — isolated real-Pi acceptance and Ticket 02 report

**State:** pending

**Owner role:** implementation/evidence worker

**Repository:** Symphony; Alfie is read-only at the WP-04 pin

**Baseline:** Symphony `93628e465866e9bf24610b4fca39b5c30f459221` plus WP-02/WP-03 SHAs, WP-04 source pin commit `29b41689c2ea74dfc45ca6c0c1e2deea05a8f964`, and WP-04 fixture reconciliation `14f3d2a4371a3ea4050b2e54fa026995fd81f706`; exact Alfie commit `73bc7744f8fbbd12206302de2df8230b29a49178`, version `0.15.0-alfie.5`, manifest hashes, and clean-tree/origin evidence are read-only inputs.

**Dependencies:** WP-04 complete. This is the final Ticket 02 work package; it does not accept the ticket or open Ticket 03.

**Authority:** Ticket 02 acceptance criteria and evidence obligations in [`../../issues/02-canonical-identity-and-result-continuity.md`](../../issues/02-canonical-identity-and-result-continuity.md), Decision 0002, and inherited controlled-artifact/real-Pi evidence rules.

## Objective

Exercise the actual controlled managed Pi composition at an isolated runtime boundary and complete Ticket 02's Implementation Report with criterion-level evidence. Separate deterministic repository/service proof, controlled pinned-Alfie proof, and real-Pi proof. Demonstrate canonical public identity, durable-first result continuity, exact live supplement/control, capability fail-closed behavior, eviction/restart continuity, terminal precedence, tuple fencing, bounded diagnostics, and no provider identity leakage.

## Inherited terminal-race evidence obligation (F5)

WP-03 review left F5 open by design. WP-05 must carry and close it with both a
deterministic race proof and the isolated real-Pi proof against the exact WP-04
artifact. This is evidence only; it does not authorize a WP-03 or other
production-source change.

A steer that is already in flight when durable terminal evidence commits must
re-check the exact current tuple and the pinned Alfie exact-live/status guard.
The evidence must assert that the racing request cannot mutate or target a
stale, terminal, or non-live child, and returns a bounded
`unavailable-control`/stale result. The race must produce no queued work,
replay, Resume/bootstrap, reconstruction, or new child, and must not leak a
provider-local identity. Capture the ordering trace, terminal/current-tuple
state, provider mutation/target observation, bounded diagnostic/result, and
post-race child/queue/replay counters.

## Exact write set

WP-05 may change only active tracked test/helper fixtures whose positive pin,
capability, or expected-count assertions must follow the WP-04 artifact, plus
the new canonical acceptance suite and the Issue 02 report:

### New acceptance/report artifacts

- `apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` — new isolated real-Pi acceptance suite.
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/02-canonical-identity-and-result-continuity.md` — Implementation Report section only; fill from captured evidence and do not change status/frontier/acceptance disposition.

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
- No blanket replacement of every `.4`/old-commit literal. A legacy, stale, mixed-version, wrong-hash, stripped-capability, or lookalike fixture may retain `.4` or the old commit only when it is an intentional negative/control script and the report classifies its path, test, and expected rejection. Positive active pin assertions must use the WP-04 exact pin.
- No claim that deterministic or controlled fixtures are real-Pi evidence; no claim of Ticket 02 acceptance or downstream-ticket completion.
- No new migration, database rewrite, or test that opens a second read-only SQLite connection while the live repository owns the WAL.

## Implementation contract

Use the existing real-extension/provenance harness patterns and isolated home/runtime configuration. The test must load the registered production Agent from the exact WP-04 artifact and negotiate the canonical-routing capability.

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
6. **Terminal-during-flight steer race (F5):** start an authorized steer against a
   live exact current tuple, commit durable terminal evidence while the steer is
   in flight, and synchronize the completion at the pinned Alfie exact-live/status
   guard. Assert the request cannot mutate or target the now-terminal/stale or
   non-live child, returns bounded `unavailable-control`/stale output, and
   produces no queue, replay, Resume/bootstrap, reconstruction, or new child.
7. **Evidence boundaries:** run deterministic, controlled-Alfie, and real-Pi commands separately; capture command, exit code, test count, exact pins, capability response, bounded diagnostics, and any timing/runtime caveat.

A real-Pi test may use a deterministic loopback model only as the model server, provided the registered production Pi/Agent path and controlled artifact are real. It must not replace the Agent or provider composition with a fake.

## Tests and evidence contract

The acceptance suite must execute every leg in the implementation contract and preserve separate deterministic, controlled-Alfie, and real-Pi result rows. The matrix below is the report shape, not a substitute for running the tests.

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
| AC3–AC4 | auth-before-provider trace, terminal precedence, eviction/restart durable fallback, exact-live steer unavailable case, and the F5 terminal-during-flight steer race |
| AC5 | stale/unauthorized/missing/oversized/capability/legacy diagnostics, bounded unavailable/stale F5 race result, and no queue/replay/Resume/bootstrap proof |
| AC6 | separate deterministic, controlled-Alfie, and isolated real-Pi command/result rows |
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
default Synara instance. Record each command's exit code, elapsed time, test
count, exact pin/capability output, fixture ledger, model/runtime
configuration, provenance output, and database reopen discipline. If the full
wrapper is unavailable or blocked by unrelated workspace infrastructure, retain
focused evidence and report the limitation rather than claiming full
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
- durable terminal precedence, auth-before-provider, tuple fencing, exact-live steer, the F5 terminal-during-flight race, capability fail-closed, and legacy isolation are all demonstrated;
- no later-ticket behavior or DB migration was introduced;
- report states every deviation and untested limit honestly.

## Escalation

Return `blocked` for unavailable real-Pi dependencies, dirty/mismatched provenance, or an isolated-runtime failure that prevents required evidence. Return `challenge` if acceptance requires a source change outside prior WPs, a migration, provider bootstrap/replay, or a reinterpretation of Decision 0002. Do not relabel fixture evidence to complete the matrix.
