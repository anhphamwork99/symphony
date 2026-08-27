# Ticket 03 independent implementation review — terminal-before-cleanup and live lifecycle containment

**Review package:** WP-04  
**Date:** 2026-08-27  
**Disposition:** **PASS**  
**WP-05 eligibility:** **may proceed**  

No BLOCKING finding and no unresolved MATERIAL REOPENING finding remains.
This is Ticket 03 review evidence only; it is not Ticket 03 acceptance, project
acceptance, release authority, or a Project Supervisor consultation.

## Reviewed candidate and scope

The frozen reviewed candidate is Symphony
`5a1ff1d429eac33d6725d2cbb9144c7667ab185b`.

Ticket 03 lineage reviewed:

| Aspect | Commit |
| --- | --- |
| Containment core | `b4eef14c7` |
| Containment causal remediation | `98927c8f6` |
| PiAdapter production composition | `648f5e569` |
| Wiring and terminal-persistence remediation | `0e5a48369` |
| Controlled and isolated real-Pi evidence | `1a92d1cfa504e27c27998f42c3c128cda0435388` |
| Implementation Report | `db27626b71cecf5894174515e123786393d11748` |
| Exact-tuple/type-boundary remediation | `1913a9a61860b3277036f44d3cdb711d4c7bbdfd` |
| Frozen candidate and final formatting gate | `5a1ff1d429eac33d6725d2cbb9144c7667ab185b` |

Workspace-gate-only Whiteboard fixes between `1913a9a61` and the frozen
candidate are `c6e3b0e1a`, `0b26d9ffe`, and `dd44ccc36`. They do not change
Ticket 03 lifecycle behavior. `5a1ff1d42` is formatter output; the final
formatter rerun produced no further diff.

The review covered Decision 0006, T03-AC1–AC5, the complete Ticket 03 source
and evidence lineage, inherited watchdog/teardown authority, controlled Alfie
provenance, failure diagnostics, and the final workspace gates. Unrelated
owner working-tree changes in `apps/web/package.json`, `apps/web/src/main.tsx`,
and `bun.lock` were not part of the reviewed candidate.

## Initial review blocker and disposition

The first audit could not pass while server typecheck reported 12 errors in
canonical-identity acceptance fixtures, managed-runtime exact-tuple
construction, and real-Pi helpers.

`1913a9a61` resolves them without weakening the contract:

- a nonterminal durable read missing `attemptId` or `generation` now returns
  `pi_subagent_read_missing_durable_evidence` before provider parameters or a
  live-lifecycle tuple are constructed;
- the focused regression proves the provider execute count remains zero;
- canonical acceptance fixtures use the closed contract diagnostic type;
- optional harness narrowing and helper `exactOptionalPropertyTypes` issues are
  resolved without changing runtime flow.

Server typecheck and the full workspace typecheck now pass. This closes the
initial BLOCKING closure finding and strengthens Decision 0006's exact-current-
tuple fail-closed boundary. It does not reopen the design.

## Authority and invariant audit

| Authority / invariant | Evidence | Verdict |
| --- | --- | --- |
| Public identity is `executionId`; provider `agentId` remains private | managed public results are recursively checked; controlled and real-Pi results contain no public `agentId` | PASS |
| Durable authorization/current tuple precede provider access | managed wrapper resolves the durable read first; incomplete tuple remediation returns before provider execution | PASS |
| Live route is exact `(executionId, attemptId, generation, providerSessionInstance)` | containment registration and entry/response revalidation use the exact tuple, registration identity/epoch, active state, and session object identity | PASS |
| Capture does not activate; durable sequence 2 activates | deterministic wiring and real-Pi sequence-2 gate prove zero provider effect before commit and availability after commit | PASS |
| Retirement is synchronous and precedes terminal ingress | controlled and real-Pi barriers observe the route unavailable before band 40 commit/failure | PASS |
| Session clear precedes runtime disposal | production composition and cleanup paths clear the exact containment session before disposing runtime resources | PASS |
| Band 40 alone creates terminal truth | repository transaction, held-commit, persistence-failure, notification, and outbox evidence | PASS |
| Band 76 alone proves cleanup and fences generation | repository and inherited teardown tests; 74/75/77/78 remain nonfencing | PASS |
| No replay, reconstruction, scan, bootstrap, automatic Resume, parent fallback, or Symphony PID authority | source scope plus provider/action counters and exact route tests | PASS |
| Alfie `.6` remains controlled and unchanged | commit/package/SDK verification and clean tracked tree | PASS |

## Acceptance-criteria matrix

| Criterion | Normal-path evidence | Failure/race evidence | Verdict |
| --- | --- | --- | --- |
| **T03-AC1** journal-first bounded terminal truth | band 40 commits before exactly one lifecycle notification; durable result/card truth follows repository state | held or failed terminal persistence has no band 40, terminal notification, or completion outbox | PASS |
| **T03-AC2** deterministic terminal/cleanup/current/stale outcomes | current same-generation terminal before proven cleanup records normally | proven band 76 advances generation; the old-generation terminal is `ignored_stale`; first-terminal ownership remains guarded | PASS |
| **T03-AC3** bands 70–78 preserve uncertainty/proof separation | watchdog and teardown regression plus real repository fixtures preserve nonterminal 74/75/77/78 | only validated `proven` band 76 settles/fences; old terminal becomes stale only after that commit | PASS |
| **T03-AC4** exact owned runtime only | exact owner steer yields one pinned-extension emission | pre-sequence-2, sibling-thread, retired-route, and post-failure calls yield no additional provider effect; no public provider identity or PID authority | PASS |
| **T03-AC5** stable inactive/loss/persistence/late diagnostics | provider inactive/disposed and terminal persistence failure return fixed bounded diagnostics | post-acceptance loss is outcome-unknown without retry; replaced/stale response is ignored after revalidation; stale terminal is durably accounted | PASS |

## Lifecycle and race audit

### Activation, revalidation, retirement, and disposal

The containment registry is volatile and session-scoped. Capture alone is
inactive. Successful durable sequence 2 activates the exact registration.
Invocation entry and the response path revalidate tuple, registration identity
and epoch, active state, and provider-session object identity. Replacement or
clear makes the response stale rather than current.

Terminal handling retires the route synchronously before terminal ingest. A
failed terminal transaction does not restore that route. Session clear occurs
before runtime disposal and cleanup releases event listeners, restores the
environment, preserves the user's Pi-home digest, and removes the isolated
root.

### Decision 0003 steer acceptance

The accepted steer linearizes at the provider-owned synchronous queue-insertion
boundary. One owner steer produced one `subagents:steered` emission. Calls made
before activation, from a sibling thread, or after retirement did not increase
the emission count. No automatic retry occurs after acceptance may have
happened.

### Terminal, cleanup, and bands

- band 40 remains the journal-first terminal transaction;
- bands 70–74 remain watchdog uncertainty/handoff evidence;
- band 75 is teardown request evidence, not cleanup proof;
- band 76 is the only successful cleanup-proof settlement and generation
  fence;
- bands 77 and 78 remain survivors/owner-unproven uncertainty and do not fence.

A current terminal before 76 records. A terminal after 76 from the old
generation is stale. Cleanup evidence cannot overwrite an existing terminal
owner.

### Persistence failure and retry

The real-Pi failure leg retires the exact route, then injects failure in the
first terminal repository attempt. Durable state remains nonterminal at
sequences `[1, 2, 3]`, health degrades with
`pi_subagent_terminal_persistence_failed`, and no notification/outbox is
published. A bounded same-tuple **repository retry** records band 40 and only
then permits notification. This is not represented as a reconstructed or
replayed provider callback.

## Diagnostics, boundedness, and security

| Diagnostic | Reviewed meaning |
| --- | --- |
| `pi_subagent_read_missing_durable_evidence` | exact nonterminal tuple is incomplete; provider execution is zero |
| `pi_subagent_live_lifecycle_unavailable` | provider acceptance is proven absent; no alternate lookup or fallback |
| `pi_subagent_live_lifecycle_outcome_unknown` | provider acceptance may have occurred; no retry or zero-effect claim |
| `pi_subagent_live_lifecycle_stale_ignored` | tuple/session/registration response revalidation failed; no current mutation |
| `pi_subagent_terminal_persistence_failed` | band-40 transaction failed; terminal notification/outbox suppressed |
| `pi_subagent_terminal_stale_ignored` | old generation terminal arrived after the proven fence |
| `pi_subagent_event_sequence_gap` | invalid durable lifecycle sequencing |

Metadata remains closed-vocabulary and bounded. Public tuple identity is
allowed; provider ids, raw sessions, PIDs, transcripts, stacks, and arbitrary
high-cardinality error text are not exposed. No migration, new lifecycle
state, band, timeout configuration, or public API/identity was introduced.

## Controlled provenance and evidence-class separation

Controlled provider evidence remains:

- Alfie commit `3fe340b401ca86bcbe8b55abd4de107e1d93482e`;
- `@alfie/pi-subagents@0.15.0-alfie.6`;
- Pi SDK `@earendil-works/pi-coding-agent@0.83.0`;
- tracked Alfie tree clean.

Evidence classes remain honestly separate:

1. deterministic fixtures prove post-acceptance loss, replaced/stale response,
   first-terminal ownership, exact diagnostic classification, and repository
   races;
2. controlled Alfie proves the pinned extension, exact owner/sibling routing,
   one real steer insertion, and retire-before-band-40 behavior;
3. isolated real Pi proves the public WS → production composition → pinned
   extension → real child path, sequence-2 activation, persistence failure,
   repository retry, notification order, band ordering, and cleanup.

No deterministic fixture is mislabeled as real-Pi evidence. No real timeout is
used as a substitute for a causal post-acceptance-loss barrier.

## Reproduced verification

| Verification | Result |
| --- | --- |
| Relevant deterministic containment/routing/terminal/repository set after remediation | 5 files, **74/74** passed |
| Controlled Alfie lifecycle containment | **1/1** passed, 27.83s |
| Isolated real-Pi lifecycle containment | **1/1** passed, 26.37s; cleanup root removed and environment/digest restored |
| Inherited watchdog + process teardown regression | `piSubagentWatchdogEscalation.test.ts` + `piSubagentProcessTeardown.test.ts`: 2 files, **35/35** passed, 4.48s |
| Server typecheck after exact-tuple remediation | PASS |
| Final `bun fmt` on frozen candidate | PASS; no resulting diff |
| Final `bun lint` | PASS; 0 warnings, 0 errors on 2,658 files |
| Final `bun typecheck` | PASS; 7/7 tasks |
| `git diff --check` | PASS |

The final gates were run in an isolated clean worktree at the exact frozen
candidate so unrelated owner working-tree files could not affect the result.

## Findings

### BLOCKING

None.

### MATERIAL REOPENING

None.

### NONBLOCKING

None requiring remediation before closure.

### NOTE

1. Post-acceptance response loss and replaced-session late-response behavior is
   intentionally deterministic causal evidence, not elapsed-time real-Pi
   evidence.
2. The successful terminal follow-up in the real-Pi failure leg is a same-tuple
   repository retry, not provider callback reconstruction.
3. The band-76 repository fixture proves settlement/fencing semantics but is
   not destructive teardown or a general zero-owned-child claim.
4. `5a1ff1d42` applies workspace formatter output and introduces no intentional
   Ticket 03 behavior; the subsequent formatter rerun is clean and all focused
   and workspace verification passes.

## Residual risk and reopening conditions

Residual uncertainty is bounded to the limitations above. Reopen only on the
Decision 0006 triggers: inability to bind exact tuple plus provider session,
inability to distinguish pre-acceptance failure from possible post-acceptance
loss, violation of band-40 or band-76 transaction ordering, weakened current/
stale ownership, unbounded/ambiguous diagnostics, material controlled-artifact
provenance drift, or a later binding decision changing the authority boundary.

## Final review disposition

**PASS.** Every T03 acceptance criterion has normal and failure evidence; the
initial typecheck/exact-tuple blocker is closed; controlled Alfie remains
unchanged; real-Pi and inherited band evidence pass; and the final workspace
gates pass on the frozen candidate. WP-05 may reconcile this review and route
Ticket 04, provided no source change occurs after this review.
