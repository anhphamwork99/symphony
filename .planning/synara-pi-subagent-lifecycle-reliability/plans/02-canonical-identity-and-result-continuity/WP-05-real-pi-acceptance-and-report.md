# WP-05 — isolated real-Pi acceptance and Ticket 02 report

**State:** pending

**Owner role:** implementation/evidence worker

**Repository:** Symphony; Alfie is read-only at the WP-04 pin

**Baseline:** Symphony `93628e465866e9bf24610b4fca39b5c30f459221` plus WP-02/WP-03 SHAs; exact Alfie commit/version/hash/clean-tree evidence from WP-04.

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

- `apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts` (new isolated real-Pi acceptance suite)
- `apps/server/src/provider/piSubagentRealExtension.test.ts` (narrow additive helper/assertion only if the existing provenance harness must expose a stable real-extension helper; avoid edits otherwise)
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` (narrow additive assertion only if needed to preserve the accepted identity-shape/provenance split)
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/02-canonical-identity-and-result-continuity.md` — Implementation Report section only; fill from captured evidence and do not change status/frontier/acceptance disposition.

No production source, migration, contracts, Alfie files, Project Home, decision, or other issue is in this WP's write set.

## Prohibited changes

- No synthetic replacement Agent, fake registry, on-disk lookalike, unpinned extension, or uncontrolled global Pi home.
- No changes to watchdog, teardown, cancellation, lifecycle containment, Resume, provider bootstrap, automatic replay, guardian, or unrelated public API.
- No claim that deterministic or controlled fixtures are real-Pi evidence; no claim of Ticket 02 acceptance or downstream-ticket completion.
- No new migration, database rewrite, or test that opens a second read-only SQLite connection while the live repository owns the WAL.

## Implementation contract

Use the existing real-extension/provenance harness patterns and isolated home/runtime configuration. The test must load the registered production Agent from the exact WP-04 artifact and negotiate the canonical-routing capability.

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

```bash
cd apps/server
bun run test src/provider/piSubagentCanonicalIdentityAcceptance.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentRealExtension.test.ts

ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run test src/provider/piSubagentCanonicalIdentityAcceptance.test.ts

# Re-run the deterministic suites whose evidence is cited by the report.
bun run test src/provider/piSubagentExecutionReadBoundary.test.ts \
  src/provider/piSubagentCanonicalRouting.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts

git diff --check
git status --short
```

Use an isolated Pi home and runtime configuration; never start the user's default Synara instance. Never use `bun test`; do not run fmt/lint/typecheck for this planning packet. Record elapsed times, exit codes, test counts, model/runtime configuration, provenance output, and database reopen discipline.

## Commit and self-review

Create at most two Symphony commits:

```text
test(pi): prove canonical identity and durable result continuity

docs(planning): complete Ticket 02 implementation report
```

The first contains only acceptance-test/helper changes; the second contains only the Issue 02 Implementation Report. Do not commit a status/frontier update and do not push.

Self-review:

- exact write set and two-commit boundary are clean;
- real-Pi path used the registered production Agent and exact WP-04 artifact;
- every T02-AC1–AC6 row has normal plus failure evidence and a command/result;
- no provider `agentId` leaked; no valid public handle becomes `Agent not found` solely due to live eviction;
- durable terminal precedence, auth-before-provider, tuple fencing, exact-live steer, the F5 terminal-during-flight race, capability fail-closed, and legacy isolation are all demonstrated;
- no later-ticket behavior or DB migration was introduced;
- report states every deviation and untested limit honestly.

## Escalation

Return `blocked` for unavailable real-Pi dependencies, dirty/mismatched provenance, or an isolated-runtime failure that prevents required evidence. Return `challenge` if acceptance requires a source change outside prior WPs, a migration, provider bootstrap/replay, or a reinterpretation of Decision 0002. Do not relabel fixture evidence to complete the matrix.
