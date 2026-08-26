# Ticket 02 — canonical identity and durable result-read continuity

**Status:** accepted
**Authoritative decision:** [Decision 0002 — Canonical execution identity and result-read continuity](../decisions/0002-canonical-execution-identity-and-result-read-contract.md)
**Dependencies:** Ticket 01 accepted; the named Supervisor identity/read gate is discharged by Decision 0002.
**Implementation:** authorized within this ticket's scope; no implementation is included in this planning update.

## Objective

Implement and prove the binding identity/result-read contract from Decision
0002. A managed execution has one public `executionId` from admission through
result lookup, live observation/control, terminal settlement, reconnect, and
restart. Provider-local Alfie `agentId` remains an internal correlation key and
never becomes a second managed public identity.

Ticket 02 is the sole source implementation frontier. It must not open or
implement Tickets 03–06.

## Authoritative contract

Decision 0002 binds the following requirements:

- `executionId` is the only managed public logical identity.
- `agentId` is provider-local and absent from managed public output/details.
- Symphony owns durable identity, authorization, result continuity, and the
  durable current tuple `(executionId, attemptId, generation)`.
- Alfie owns the exact live in-memory index
  `(executionId,attemptId,generation) -> agentId`.
- Managed tools use `execution_id`; a bounded deprecated `agent_id` syntactic
  alias carries `executionId` only and never accepts a provider `agentId`.
- Authorization, project/thread scope, and durable current-tuple resolution
  occur before provider access.
- Durable terminal truth wins over conflicting live nonterminal state.
- Exact live provider state may supplement nonterminal durable state.
- Missing live provider state returns applicable durable state and a bounded
  diagnostic, not `Agent not found` for a valid managed public handle.
- Steer is live-only for the exact authorized current tuple; it never targets
  queued, replayed, reconstructed, or bootstrap work.
- Capability equivalent to `execution-identity-routing-v1` is required for
  managed composition and missing/incompatible capability fails closed.
- Any required Alfie runtime change requires exact version/re-pin and
  controlled provenance evidence.
- No automatic replay, automatic Resume, provider bootstrap, watchdog,
  teardown, guardian, or unrelated lifecycle redesign is part of this ticket.

## Acceptance criteria

- **T02-AC1 — Canonical public identity:** Managed detached output, result
  payloads, details, and diagnostics use `executionId` as the only public
  logical identity; `agentId` is absent. The durable current tuple remains
  stable and `attemptId`/generation fence stale evidence without replacing
  `executionId`.
- **T02-AC2 — Exact routing and compatibility:** Managed result/control tools
  accept canonical `execution_id`. The deprecated `agent_id` alias is bounded,
  observable, and accepts only the same public `executionId`; a provider-local
  `agentId` is never accepted as a public handle. Alfie resolves live records
  only through the exact tuple-indexed in-memory mapping.
- **T02-AC3 — Durable-first authorized continuity:** Authorization, scope, and
  durable current-tuple resolution occur before provider access. Authorized
  terminal/result evidence remains readable by `executionId` after provider
  record eviction or restart, with bounded metadata; durable terminal state
  wins over any live nonterminal report.
- **T02-AC4 — Live supplement and control boundary:** An exact live provider
  record may supplement nonterminal durable state. Missing live state returns
  the applicable durable state rather than `Agent not found`. Steer is
  exact-live-only and returns a stable unavailable-control diagnostic when the
  exact live record is absent; it never queues, replays, bootstraps, or creates
  a child.
- **T02-AC5 — Failure, fencing, and legacy behavior:** Stale attempt/generation
  requests, unauthorized access, missing durable evidence, oversized payloads,
  unavailable live control, and missing/incompatible capability have bounded,
  stable diagnostics. Legacy/unmanaged sessions retain their existing bypass
  behavior. No automatic replay or Resume is introduced.
- **T02-AC6 — Evidence and provenance:** Deterministic contract/repository
  tests, the controlled pinned-Alfie suite when its surface changes, and an
  isolated real-Pi managed-composition proof cover normal and failure
  directions, including eviction/restart, capability fail-closed behavior,
  terminal precedence, tuple fencing, and no provider-identity leakage. Any
  Alfie runtime change has exact re-pin, version, hash, clean-tree, artifact,
  and paired Symphony/Alfie provenance evidence.

## Testing and evidence seams

### Deterministic contract and repository evidence

Use bounded fixtures to prove identity shapes, authorization ordering,
current-tuple fencing, durable/live precedence, terminal fallback after live
record eviction, missing-evidence diagnostics, alias rejection for a real
provider `agentId`, payload bounds, and exact-live-only steer. Include the
negative directions: conflicting live terminal/nonterminal state, stale tuple,
unauthorized project/thread, unavailable live record, and absent capability.

### Controlled-Alfie evidence

When the Alfie surface changes, exercise the exact pinned controlled extension
and prove:

- the in-memory
  `(executionId,attemptId,generation)->agentId` mapping is exact, bounded, and
  session-scoped;
- managed output/details do not expose `agentId`;
- `execution_id` and the deprecated `agent_id` syntactic alias route to the
  same public execution identity;
- stale tuples cannot reach another provider record;
- live result/control routing does not turn missing records into a public
  identity error; and
- an unrelated legacy or managed session cannot resolve this execution.

### Isolated real-Pi evidence

Exercise the actual controlled managed composition with isolated runtime
configuration and the negotiated capability equivalent to
`execution-identity-routing-v1`. Prove the public `executionId` path, durable
terminal precedence, live supplement, provider-record eviction/restart
continuity, and material diagnostics at the real provider boundary. Do not
relabel deterministic fixtures as real-Pi evidence, and do not claim watchdog,
teardown, Resume, guardian, or bootstrap behavior from this ticket.

Every evidence report must distinguish deterministic, controlled-Alfie, and
real-Pi results and must record the exact pin/provenance boundary used.

## Implementation Report

This is the Ticket 02 implementation candidate report. It does not change this
ticket's status, accept Ticket 02, or open Tickets 03–06.

### Candidate lineage and compatibility boundary

- Symphony durable read contract:
  `ad6f97e8e feat(pi): add durable canonical execution read contract`.
- Symphony managed canonical routing:
  `964d32f37 feat(pi): route managed tools through canonical execution identity`.
- Decision 0003 steer linearization:
  `c95fc1a1d`.
- Decision 0005 exact production-manager hook authorization:
  `73f117fcc`, with bridge-version correction `c97025b2f`.
- Final controlled-artifact re-pin:
  `390ef13fa test(pi): re-pin canonical race hook artifact`.
- Final synchronized real-Pi evidence:
  `cb023e587 test(pi): prove exact production steer linearization races`.
- Controlled Alfie:
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e`,
  `@alfie/pi-subagents@0.15.0-alfie.6`.
- Pi SDK:
  `@earendil-works/pi-coding-agent@0.83.0`.
- Required managed capability:
  `execution-identity-routing-v1`. Production negotiation requested and
  returned this capability together with every required controlled-artifact
  capability; missing, stripped, mixed-version, wrong-hash, and legacy
  fixtures remain fail-closed negative evidence.

### Ownership and changed surfaces

Alfie owns the exact live in-memory
`(executionId, attemptId, generation) -> agentId` index, exact-session lookup,
the synchronous `AgentSession.steer` insertion point, retirement of live index
entries, and provider-local `agentId`. Symphony owns authorization,
project/thread binding, durable current-tuple resolution, durable-first result
reads, terminal precedence, bounded public diagnostics, and the managed tool
wrapper. `executionId` is the only managed public logical identity.

The final real-Pi evidence commit changes only:

- `apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts`;
- `apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts`.

The exact-instance hook remains Alfie evidence infrastructure only. It is gated
by `SYNARA_PI_SUBAGENT_INTERNAL_TEST_HOOKS=canonical-steer-race-v1`, a unique
`SYNARA_PI_SUBAGENT_INTERNAL_TEST_RUN_ID`, and
`Symbol.for("pi-subagents:internal-test:canonical-steer-race-v1")`. It exposes
no manager, record, session, provider ID, tool, capability, or public API.

### Durable authorization and live routing evidence

The production Symphony managed wrapper awaits the authorized durable
`readService.readResult` before invoking the provider tool. This is
source-level happens-before evidence, not an event emitted by the Alfie hook.
The read service authorizes project/thread scope, resolves the durable current
tuple, rejects stale tuples, returns terminal truth without provider access,
and permits provider access only for an authorized current nonterminal tuple.

The production Pi adapter wraps the registered controlled
`steer_subagent`/`get_subagent_result` tools, requires
`execution-identity-routing-v1`, passes the exact durable tuple, rejects
provider-local identity fields recursively, bounds provider content, and
redacts provider identity. Terminal result/steer paths make zero provider
calls. Missing exact live steer returns
`pi_subagent_read_live_record_unavailable`, not `Agent not found`.

### Acceptance matrix

| Criterion | Normal direction | Failure/diagnostic direction | Result |
| --- | --- | --- | --- |
| T02-AC1 | Admission, detached output, result reads, hook observations, and durable journal use one `executionId`; attempt/generation remain fences. | Recursive no-provider-identity scans cover managed payloads, diagnostics, and hook events; older replay cards remain compatible. | PASS |
| T02-AC2 | Canonical `execution_id` and the deprecated public-ID `agent_id` alias resolve the same exact tuple-indexed live record. | Provider-local IDs, conflicting aliases, stale attempt/generation, another session, and another tuple fail closed. | PASS |
| T02-AC3 | Authorized durable reads survive live eviction/restart; exact sequence-40 terminal truth wins over live nonterminal fallback. | Unauthorized scope, missing durable evidence, stale tuple, incoherent snapshot, and oversized diagnostics return bounded stable results before provider access. | PASS |
| T02-AC4 | Exact live state supplements nonterminal durable state; enqueue-first steer performs exactly one synchronous SDK insertion and returns `applied`. | Terminal-first retirement before the manager guard returns bounded unavailable control with zero session call/insertion; no valid handle becomes `Agent not found`. | PASS |
| T02-AC5 | Legacy/unmanaged bypass behavior remains covered; controlled Alfie proves cancellation fencing and post-await generation validation. | Capability absence/mismatch, stale tuple, unavailable live control, provider-ID input, oversized output, and invalid cancellation are bounded. Resume/bootstrap/reconstruction/queue-replay/new-child are source-structurally absent from the exact manager steer path, not claimed as runtime-observed counters. | PASS |
| T02-AC6 | Deterministic, controlled-Alfie, and isolated real-Pi evidence are reported separately against the exact `.6` artifact and Pi SDK `.83.0`. | Negative fixtures remain intentional; user configuration, ambient resources, controlled artifact, paths, environment, hook/session state, and roots are checked and cleaned fail-closed. | PASS; project-level T06 final acceptance remains pending |

### Synchronized real-Pi F5 evidence

Both strands use distinct isolated roots, the release-built controlled
artifact, production registered `Agent` and `steer_subagent` tools, the exact
extension-closure manager/session, a loopback model service, and a one-way
slow-response latch. At the manager's actual pre-live-guard barrier the test
observes both the exact active bridge tuple and one still-held child response.
Only then is natural completion released.

Terminal-first ordered trace:

```text
production-tool-call-promise-created
hook:manager-invocation
hook:before-live-guard
exact-live-tuple-and-held-child-observed-at-manager-barrier
slow-child-response-released
bridge-index-retired
durable-exact-seq40-committed
manager-guard-released
hook:live-guard-rejected-not-running
hook:manager-return-rejected
production-tool-call-settled
```

Observed terminal-first counters:

```text
managedAdmissions=1
delegatedModelRequests=1
activeExactTuples=0
sessionSteerInvocations=0
sdkInsertions=0
```

Enqueue-first ordered trace:

```text
production-tool-call-promise-created
hook:manager-invocation
hook:before-live-guard
exact-live-tuple-and-held-child-observed-at-manager-barrier
manager-guard-released
hook:live-guard-pass
hook:session-steer-invocation
hook:sdk-insertion
hook:returned-promise-held
slow-child-response-released
bridge-index-retired
durable-exact-seq40-committed
session-promise-released
hook:returned-promise-released
hook:post-await-generation-pass
hook:bookkeeping-commit
hook:manager-return-sent
production-tool-call-settled
```

Observed enqueue-first counters:

```text
managedAdmissions=1
delegatedModelRequests=1
activeExactTuples=0
sessionSteerInvocations=1
sdkInsertions=1
```

`resume`, `bootstrap`, `reconstruction`, `queue-replay`, and `new-child` have
no runtime counter in this hook. Their absence is source-structural: the exact
live manager path calls only the already-owned `record.session.steer` and has
no admission, Resume, bootstrap, reconstruction, replay, or child-creation
branch. They are deliberately not reported as observed zero counters.

### Isolation and Decision 0004 witness

Each strand inventories the controlled artifact, writable user agent,
`auth.json`, `models.json`, `settings.json`, exact `models-store.json`,
managed agent and extension, harness root, home, database/state, workspace,
parent agent, child agent, and isolated Pi home using `lstat` and canonical
`realpath`. Existing entries must not be symlinks; canonical paths must be
distinct, contained by their intended isolated roots, and outside real
`~/.pi`. The registered extension path resolves under the controlled managed
extension and outside the writable user agent.

The complete artifact tree is hashed before/after, reverified, and required to
contain no auth/models/model-store/settings files. Sensitive auth, models, and
settings snapshots are strict. Ambient extension/skill resources and the broad
non-excluded Pi-home digest are strict. Only `agent/sessions/**` and exact
`agent/models-store.json` are excluded from that broad digest.

Bounded cache diagnostics from the final run:

| Strand/location | Before | After | Classification |
| --- | --- | --- | --- |
| terminal-first isolated writable agent | absent | regular, SHA-256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, 2 bytes, mtime `1787779274333.2708` | non-causal provider-catalogue cache |
| enqueue-first isolated writable agent | absent | regular, SHA-256 `44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a`, 2 bytes, mtime `1787779311074.8462` | non-causal provider-catalogue cache |
| ambient `~/.pi`, both strands | regular, SHA-256 `2fad69a78eb3ba73000c29d2dd94e516b57e67d0af1f3b7d22f7f7b5ce362985`, 97,088 bytes, mtime `1787771966420.924` | unchanged | non-causal provider-catalogue cache |

Cleanup unconditionally releases both barriers, disposes the first-owner hook,
restores the exact wrapped session method, disposes the harness/listeners,
bounds parent-turn settlement, restores environment variables, verifies the
ambient snapshot, removes both isolated roots, and aggregates cleanup errors.

### Verification results

Deterministic Symphony evidence:

- WP-02 durable repository/read boundary: 68 tests passed.
- WP-03 managed routing plus contracts: 106 server tests and 38 contract tests
  passed (144 total).
- Final deterministic canonical routing/read groups: 41 tests passed.
- Final controlled-artifact positive fixtures: 8 files / 159 tests passed.
- Contracts provenance fixture: 8/8 passed.
- Production capability negotiation: 2 passed, 9 intentionally skipped.
- Focused detach control: 1 passed, 10 intentionally skipped.

Controlled Alfie evidence:

```bash
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test test/canonical-steer-race-hook.test.ts
```

- Exact-manager hook: 9/9 passed.
- Synara bridge: 22/22 passed.
- Focused canonical regression: 122/122 passed.
- Full Alfie suite: 37 files / 554 tests passed.
- Alfie typecheck, `git diff --check`, and `./bin/install-home` passed.
- Cancellation-before-insertion and cancellation-after-insertion/post-await
  generation fencing remain controlled-Alfie evidence, separate from real-Pi
  race evidence.

Final isolated real-Pi command:

```bash
cd apps/server
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  node ../../node_modules/vitest/vitest.mjs run \
  --project wallclock --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentCanonicalIdentityAcceptance.test.ts
```

- Exit 0; 1 file / 9 tests passed; duration 82.22 seconds.
- Required Node Vitest runtime was used. Bun Vitest is not evidence because it
  cannot resolve the required `node:sqlite` implementation in this path.
- Existing real-Pi helper suite: 9 passed, 1 intentionally skipped.
- Desktop managed AC4 focused regression: 1 passed, 8 intentionally skipped;
  observed detach attachment was 471 ms for a 300 ms foreground budget and
  post-detach progress/heartbeat preceded the one sequence-40 terminal commit.
- Earlier full real-extension detach timing failures (`3246 ms < 800 ms`, then
  `1115 ms < 800 ms`) are classified as load-sensitive wallclock failures, not
  provenance/capability failures; the focused T22 detach control passed.
- No full workspace `bun run test` was run for this report. Focused governed
  suites were used, and unrelated dirty web/package-lock work was preserved.

### Provenance and fixture ledger

Final controlled Alfie hashes:

```text
package.json
954c5297446149d2e6a997c4f0eefac768611f92599cecab2a5f96255dafa22f

src/index.ts
c843406cf94bffdfa7304e2c412766b7cbbcdbfc17fa2846046c77992288d1f9

src/agent-manager.ts
1f99fd0794c8c32a2229b4f7bc7f3da221ce50d69b221875ba7e8f0f8d879783

src/agent-runner.ts
98a4c592b14bd7b66b42ea26aabf337d01b6146e618e2c2d67852449a755b1d2

src/child-bash-supervisor.ts
ef44dc6d91ba400187967568b18483792eef3715c616b56aea24e3bb0c48f3c0
```

The package version, production bridge `EXTENSION_VERSION`, active bridge
test, provenance manifest, and positive fixtures agree on `.6`. Intentional
`.4`, mixed-version, stripped-capability, wrong-hash, and legacy negative
fixtures were not rewritten. No active positive old-pin assertion remains in
the repaired fixture set. The WP-04 manifest schema was not rewritten by
WP-05. Alfie extension status was clean for the pinned commit. Symphony
`git diff --check` passed; unrelated dirty files
`apps/web/package.json`, `apps/web/src/main.tsx`, and `bun.lock` remain outside
the candidate commits.

### Independent review and disposition

The first independent review rejected `9360d8b14` as an evidence package
because live-at-manager-entry, merged traces, the complete Decision 0004 path
witness, and one cleanup path were incomplete. Those findings were repaired.
Independent re-review of the substantive amended candidate returned
**PASS WITH GAPS**: both F5 strands and Decision 0004 may be marked passed, the
commit is safe to retain, and no material implementation/evidence defect
remains. The only gaps were this report and accurate wording of source-level
limitations. The final candidate additionally emits the already-asserted
bounded traces, counters, and cache metadata used above; it does not change
production behavior or race semantics.

Ticket 02 is accepted and WP-05 is complete. The phrase “Supervisor
acceptance” refers only to the single project-level final consultation reserved
for the complete T06 integrated candidate; no ticket-level Supervisor final
acceptance was invoked or required.

### Explicit non-goals preserved

This ticket does not implement watchdog stages, teardown ownership/proof,
process killing, Resume eligibility, restart/reconnect policy, provider
bootstrap, automatic replay, guardian behavior, durable post-restart owner
receipt, orphan-terminal exceptions, or Tickets 03–06. No default Synara
instance was started, no user runtime configuration was written into the
controlled artifact, no unproven process was killed, and no push, release, or
deployment occurred.

## Scope and non-goals

### In scope

- Symphony durable identity, authorization, current-tuple, and bounded
  result-read continuity;
- Alfie exact live tuple mapping and managed result/control routing when the
  cross-repository seam requires it;
- managed public output/details and `execution_id` compatibility behavior;
- capability negotiation/fail-closed behavior;
- bounded diagnostics and deterministic, controlled-Alfie, and real-Pi
  evidence for this contract; and
- exact Alfie version/provenance re-pin when an owned runtime surface changes.

### Not in scope

- watchdog stages or escalation;
- owned process-tree teardown, proof-before-fence, or teardown bands;
- explicit Resume eligibility, restart/reconnect policy, or provider bootstrap;
- crash guardian, durable post-restart owner receipt, orphan-terminal
  exception, or automatic replay/Resume;
- raw PID discovery/guessing, PID files, process-name kills, or new Symphony
  kill authority;
- general Pi Agent UX redesign, unrelated public API changes, or opening
  Tickets 03–06; and
- Ticket 02 final acceptance or the project's final acceptance.

## Status and unlock

Decision 0002 remains authoritative. Ticket 02 is **accepted** at Symphony
`cb023e587` plus report `d77a566e0`, against controlled Alfie
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`. Project Home routes Ticket 03 as the next
frontier; Tickets 04–06 remain blocked.
