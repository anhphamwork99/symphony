# Decision 0008 — reassessment: live-control post-await retirement classification

## Status

**Binding Reassessment accepted.** This record persists the Project
Supervisor's material reassessment after a Gate pass. It is binding only for
the post-await classification aspect stated below. It does not accept Ticket 06,
consume the integrated review, consume final Supervisor acceptance, authorize a
destructive run, or authorize any source change by itself.

- **Date:** 2026-08-28
- **Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
- **Ticket:** 06 — integrated real-Pi acceptance
- **Consultation class:** Project Supervisor material reassessment; not final
  acceptance
- **Prior decision:** [Decision 0006 — live lifecycle containment
  linearization contract](0006-live-lifecycle-containment-linearization-contract.md)
  remains authoritative except for the specific post-await classification aspect
  superseded by this record. Decision 0006 is not edited in place.

## Question

How must live-control and live-observation results be classified when the exact
registration retires, is cleared, or is replaced while an invocation is in
flight and its response resolves after an await, without conflating ordinary
same-registration terminal retirement with replacement, and while preserving
the canonical F5 expectations bound by Decisions 0003 and 0006?

The answer must preserve exact-tuple/session/registration authority, the
synchronous accepted-effect boundary, durable terminal precedence,
proof-before-fence, bounded diagnostics, and the prohibition on retry,
reconstruction, replay, Resume, bootstrap, parent fallback, and provider-ID or
PID authority.

## Trigger and reassessment finding

The renewed canonical F5 evidence and the exact source at the frozen candidate
show a material classification defect in the current containment seam. The
post-await `!isCurrent()` branch treats every loss of current active state as
`stale_ignored`. That combines two different events:

1. ordinary retirement of the same captured registration as part of the normal
   terminal lifecycle; and
2. replacement, invalidation, or loss of exact tuple/session/registration/epoch
   identity.

Those events are not semantically interchangeable. Ordinary retirement of the
same registration must preserve the accepted-effect result classification,
whereas replacement or invalidation must be stale and must not mutate or retry.
The current branch therefore violates the canonical F5 expectations and the
same-registration portions of Decisions 0003 and 0006.

The reassessment does not reopen observation, terminal persistence, batching,
watchdog timing, teardown proof, generation fencing, or the destructive
boundary. It corrects only the classification boundary named in this record.

## Authorities and evidence

The following authorities and evidence were considered:

- [Project Home](../PROJECT.md), including its exact candidate, evidence,
  protected-WIP, and one-review/one-final-acceptance governance.
- [Decision 0002](0002-canonical-execution-identity-and-result-read-contract.md),
  for canonical `executionId`, durable current-tuple resolution, exact live
  access, bounded public diagnostics, and no automatic replay or Resume.
- [Decision 0003](0003-terminal-steer-race-linearization-contract.md), for the
  synchronous Pi SDK queue-insertion boundary, terminal-first versus
  enqueue-first F5 expectations, and post-await generation fencing.
- [Decision 0006](0006-live-lifecycle-containment-linearization-contract.md),
  for exact live containment, provider-owned acceptance, durable terminal
  precedence, callback/session identity, bounded unavailable and
  outcome-unknown diagnostics, and no fallback or reconstruction. It remains
  binding except for the aspect expressly superseded here.
- [Decision 0007](0007-ticket-06-batching-fixture-causal-control-and-candidate-rebaseline.md),
  for the frozen candidate/evidence rebaseline, exact candidate discipline,
  historical-attempt preservation, no-retry governance, and downstream
  authorization boundaries.
- The current-session Project Supervisor reassessment result, which received a
  Gate pass and accepted the semantic correction recorded below.
- The renewed canonical raw log and its associated source evidence at candidate
  `ffd45bd867e94c9003415f5f2e937cc9c616e399`, including the production F5
  terminal-first and enqueue-first expectations.
- The current implementation of
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.ts`, whose
  post-await `!isCurrent()` result branch is the identified conflation seam,
  and its deterministic test
  `apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts`.

The evidence is classified separately. Canonical F5 evidence is authoritative
for the expected semantic result; deterministic and real-Pi records establish
whether a later bounded implementation proves that result. Evidence does not,
by itself, advance Ticket 06 status or consume an acceptance reservation.

## Binding decision

Canonical F5 expectations are authoritative. A result that arrives after normal
retirement of the same exact registration is not automatically stale. Stale
classification is reserved for an exact identity replacement or invalidation
that proves the invocation no longer belongs to the same registration epoch and
session. The provider-owned acceptance marker remains the only acceptance
boundary for control. A response that may have crossed that boundary but whose
outcome is lost remains unknown; it is never retried or guessed.

The implementation must retain enough bounded identity state to distinguish:

- the same registration, including its epoch, which has ordinarily retired or
  cleared; from
- a different registration/epoch, a different session, a different tuple, or an
  invalidated invocation.

No provider object, provider-local `agentId`, raw session, PID, process group,
transcript, or arbitrary error text may be exposed to make that distinction.

## Binding semantic outcomes

The following table is the complete semantic outcome contract for the corrected
post-await boundary. "Same registration" means the exact captured tuple,
opaque session, registration object, and registration epoch remain the identity
of the invocation even if ordinary lifecycle retirement has occurred. The
replacement rows are identity failures, not ordinary lifecycle retirement.

| # | Post-await situation | Binding result | Required effect and diagnostic meaning |
|---:|---|---|---|
| 1 | Same registration remains active and an observation resolves with a bounded snapshot | `applied` | Expose the bounded observation value. Observation has no provider acceptance boundary and cannot become `outcome_unknown`. |
| 2 | Same registration remains active and a control marks provider acceptance, then resolves successfully | `applied` | Expose the control result. The accepted effect linearized at the provider-owned acceptance boundary; exactly one accepted action remains the proof obligation. |
| 3 | Same registration retires before acceptance and the provider is unavailable, returns without acceptance, or fails before acceptance | `unavailable` | Return bounded `pi_subagent_live_lifecycle_unavailable`; expose no value and claim no accepted provider effect. This includes ordinary terminal retirement before an accepted control. |
| 4 | Same registration retires after acceptance and the accepted control resolves successfully with a value | `applied` | Preserve the accepted result even though normal terminal retirement occurred before the caller's promise returned. Do not relabel it as stale or undo the accepted effect. This is the canonical enqueue-first F5 outcome. |
| 5 | Same registration retires after acceptance and the control response is lost, times out, or throws after acceptance | `outcome_unknown` | Return `pi_subagent_live_lifecycle_outcome_unknown`; do not claim success, zero effect, or no effect, and do not retry or reconstruct. Later durable terminal/cleanup evidence remains independently authoritative. |
| 6 | The tuple, opaque session, registration object, or registration epoch is replaced or mismatched while the invocation is in flight | `stale_ignored` | Return `pi_subagent_live_lifecycle_stale_ignored`; perform no current aggregate, route, terminal, generation, provider, or notification mutation and no retry. |
| 7 | The same registration is invalidated or cleared in a way that proves this invocation is no longer authorized, rather than ordinary terminal retirement | `stale_ignored` | Treat explicit invalidation as an identity fence, not as ordinary retirement. Ignore the late response with no route reconstruction, reindexing, second action, replay, or Resume. |
| 8 | The same registration remains current but a control loses/times out/throws before acceptance, or an observation fails/ times out | `unavailable` | Use the bounded unavailable classification. Timeout is classified as timeout only when explicitly marked; an unmarked throw is not inferred to be a timeout. Observation never becomes outcome-unknown. |

Rows 3–5 are the ordinary same-registration lifecycle path. Rows 6–7 are
identity replacement/invalidation and are the only post-await stale path. The
classification must be determined from the exact captured registration and
bounded lifecycle state, not from generic `!isCurrent()` alone.

All rows retain these invariants:

- `executionId` is the managed public identity; attempt and generation remain
  fences.
- A durable terminal commit remains authoritative after it succeeds.
- No post-retirement second provider action, queue insertion, send, replay,
  Resume, bootstrap, reconstruction, or new child is permitted.
- A result classification cannot create terminal truth, cleanup proof, or a
  generation fence.
- Only proven band 76 can prove cleanup and advance the generation fence.
- Diagnostics remain fixed-code, bounded, and free of provider internals.

## Exact correction boundary

The exact future production correction write set is **only**:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
```

The source correction may change only the local containment classification and
its focused deterministic coverage needed to distinguish the eight rows above.
It must not change the PiAdapter, completion coordinator, production
configuration, contracts, persistence schema, orchestration, watchdog,
teardown, Alfie source or pin, public identity, or any unrelated test.

The exact correction boundary is not permission to implement, test, rerun, or
gate in this decision-persistence transaction. Any need for a third production
or test file, an Alfie change, a provider timing change, a schema/migration
change, or a public API change is a material challenge requiring another
Supervisor reassessment before proceeding.

## Deterministic proof obligation

After the bounded correction, the deterministic containment suite must prove all
eight semantic rows with synchronized, causal barriers. It must assert, as
applicable:

1. same-registration active observation applies its bounded value;
2. same-registration accepted control applies its value;
3. same-registration pre-acceptance retirement/unavailability returns
   unavailable with no exposed value;
4. same-registration post-acceptance successful retirement returns applied;
5. same-registration post-acceptance loss, timeout, and throw return
   outcome-unknown without retry;
6. tuple/session/registration/epoch replacement returns stale_ignored;
7. explicit invalidation/clear is stale_ignored and cannot reopen a route; and
8. current pre-acceptance failure/timeout is unavailable, with timeout reasons
   reachable only through the explicit timeout marker and observations never
   classified as outcome-unknown.

The traces must identify callback entry, exact registration/epoch revalidation,
provider acceptance where applicable, retirement or replacement, response
classification, and return. Assertions must also prove no value exposure,
second provider action, mutation, retry, reconstruction, or route restoration
on the negative rows. Wall-clock delay alone is not causal proof.

## Real-Pi proof obligation

The renewed non-destructive real-Pi evidence must rerun the canonical F5
terminal-first and enqueue-first strands against the exact controlled artifact,
registered production tools, exact manager/session path, loopback model, and
isolated roots. The proof must show:

- terminal-first retirement before the manager live guard returns bounded
  unavailable with zero session invocation and zero SDK insertion;
- enqueue-first synchronous SDK insertion occurs exactly once, then ordinary
  same-registration retirement and durable terminal commit may occur before the
  caller returns, while the result remains applied;
- all trace events carry the exact public tuple;
- no replacement, stale tuple, or invalidated response mutates current state or
  triggers a second action;
- no replay, Resume, bootstrap, reconstruction, parent fallback, PID authority,
  or new child is introduced; and
- isolation, controlled Alfie provenance, environment restoration, and cleanup
  remain proven independently of semantic result assertions.

Real-Pi evidence is non-destructive. It does not authorize the manual
zero-owned-child run, PID enumeration/signalling, TERM/KILL, or a quality gate.
The deterministic and real-Pi evidence classes must remain separately reported;
a deterministic proof cannot be relabeled as real-Pi proof.

## Candidate and evidence rebaseline

The existing Package C candidate remains the behavioral baseline for this
reassessment:

- historical base: `12fd6686edc26a3fa0382e8bdeb83a1be8045539`;
- frozen candidate: `ffd45bd867e94c9003415f5f2e937cc9c616e399`, its sole-parent
  child, with the exact two-file Decision 0007 fixture correction; and
- integration merge `064b49f1d954b64343006da9240cdadf58bc0ff2` is integration
  provenance only, never a behavioral producer identity.

The new source-correction candidate must have:

1. an acceptance-surface delta from `ffd45bd867e94c9003415f5f2e937cc9c616e399`
   of exactly these two files:

   ```text
   apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
   apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
   ```

2. a total delta from `12fd6686edc26a3fa0382e8bdeb83a1be8045539` of exactly four
   files: the two Decision 0007 fixture files plus the two containment files
   above;
3. byte-identical production coordinator and configuration relative to the
   frozen candidate;
4. the same pinned Alfie commit
   `3fe340b401ca86bcbe8b55abd4de107e1d93482e` and
   `@alfie/pi-subagents@0.15.0-alfie.6`; and
5. an exact recorded Symphony commit SHA before any behavioral evidence is
   accepted.

The current failed attempt and its raw log remain immutable, preserved, and
supporting only. It cannot be rewritten as a pass, used as current proof for
the corrected candidate, or used to authorize a retry.

Following the bounded source correction and candidate freeze, the required
sequence is:

```text
new exact two-file source candidate
  -> rerun WP-01 at the new candidate
  -> exactly one full five-file WP-02
  -> fresh owner authorization for WP-03
  -> fresh owner authorization for WP-04 after the new WP-03 PASS
  -> WP-05 one integrated review
  -> WP-06 / final Supervisor Decision 0009
  -> WP-07 closure/routing
```

WP-01 must use its closed 19-file set and 296/296 requirement. WP-02 must use
its complete five-file set exactly once, serially, with exact candidate and
Alfie provenance, fresh process-HOME isolation, expected-skip and cleanup gates,
and no automatic retry. The prior failed attempt is not a substitute for either
rerun.

## Current attempt and downstream state

The current failed attempt remains a valid historical/supporting failure and
must retain its original exit, raw bytes, provenance, and classification. No
current WP-02 PASS, integrated review, or final acceptance may be claimed from
it. Its failure does not authorize a source change outside this decision's exact
two-file boundary and does not authorize a second run without the rebaseline
sequence above.

WP-03 and WP-04 remain blocked. Existing owner authorizations are unspent but
non-transferable and not executable; a new WP-02 PASS does not activate either
one automatically. Fresh explicit owner authorization is required for WP-03,
and fresh explicit owner authorization is required for WP-04 only after the new
WP-03 PASS. WP-05's one integrated-review reservation and WP-06's one final
Supervisor reservation remain unused.

No destructive run, PID enumeration/signalling, TERM-to-KILL operation,
formatter, lint, typecheck, implementation, test, rerun, or gate is authorized
by this record. The record only binds the decision and its downstream contract.

## Governance and Decision 0009

This reassessment is a material technical decision consultation, not final
acceptance. It does not consume the exactly-one integrated feature-level review
or the exactly-one final Supervisor acceptance reserved by Project Home.

Because the former route named Decision 0008 as the final Supervisor record,
the final acceptance record is renumbered **Decision 0009**. Decision 0008 is
this aspect-scoped reassessment; it cannot satisfy T06-AC8 or any equivalent
final-acceptance criterion. The single integrated review must occur first and
must cover the complete current candidate and all criterion-level evidence.
Only after that review passes may the one final Supervisor consultation persist
Decision 0009. No consultation, review, or evidence-only record may be counted
as final acceptance.

## Rejected alternatives

1. **Treat every `!isCurrent()` result as stale.** Rejected because it conflates
   ordinary same-registration terminal retirement with replacement and breaks
   canonical enqueue-first F5, including an accepted synchronous insertion whose
   terminal retirement occurs before call return.
2. **Always return applied after retirement.** Rejected because replacement,
   invalidation, and lost identity must remain stale_ignored, and an accepted
   response loss must remain outcome_unknown rather than success.
3. **Always return unavailable after retirement.** Rejected because it discards
   an accepted control that already crossed its provider-owned boundary.
4. **Infer acceptance from callback return or promise resolution.** Rejected;
   only the explicit provider-owned acceptance marker linearizes control.
5. **Retry or reconstruct after a stale or unknown result.** Rejected because a
   side effect may already have linearized and exact live control is not a
   recovery mechanism.
6. **Use tuple strings, provider IDs, scans, or mutable global state to recover
   identity.** Rejected by Decisions 0002, 0003, and 0006; exact opaque
   registration/session/epoch identity remains mandatory.
7. **Change PiAdapter, the completion coordinator, timing, persistence, or
   Alfie.** Rejected because the reassessment has an exact two-file correction
   boundary and no evidence requires a broader change.
8. **Reopen observation or terminal/cleanup semantics.** Rejected because the
   material finding is limited to post-await classification and does not alter
   observation's no-acceptance rule, journal-first terminal truth, or
   proof-before-fence.
9. **Treat the failed attempt as a retryable or current PASS basis.** Rejected;
   its raw log and failure remain supporting only, with no automatic retry.
10. **Use this consultation as final acceptance or renumber it away.**
    Rejected; the final Supervisor record is reserved and is now Decision 0009.

## Assumptions and residual uncertainty

- The exact captured registration/session/epoch can be distinguished from
  ordinary retirement using bounded in-memory state without exposing provider
  internals or adding durable owner receipts.
- The pinned Alfie `.6` artifact and existing production manager path do not
  require a third behavioral file or an Alfie change to exercise the corrected
  classification.
- Decision 0003's synchronous SDK insertion boundary remains true for the
  pinned Pi SDK `.83.0`.
- Existing journal-first terminal and proof-before-fence transactions remain
  unchanged and authoritative.
- The renewed canonical log establishes the expected F5 semantics; it does not
  prove that the future two-file correction passes deterministic or real-Pi
  execution until those evidence packages are rerun.
- The exact new candidate SHA, renewed WP-01 output, and renewed five-file
  WP-02 outcome are unknown until the authorized future producers run.
- No current real-Pi proof is inferred from the deterministic suite, and no
  destructive proof is inferred from non-destructive evidence.

## Rollback and reopening

If the two-file correction cannot distinguish same-registration retirement from
replacement without broadening scope, roll it back and reopen this decision
with the exact failing trace and source evidence. Rollback must preserve all
historical raw logs, durable records, accepted decisions, candidate provenance,
and protected owner WIP; it must not silently restore a generic stale branch and
call that acceptance.

Reassessment is required if any of the following occurs:

- a third source/test file, PiAdapter change, coordinator/configuration change,
  schema change, public API change, or Alfie change is necessary;
- deterministic tests cannot causally prove all eight rows, or reveal a
  different identity/acceptance boundary;
- real-Pi F5 contradicts the bound terminal-first or enqueue-first outcomes;
- an accepted control is retried, duplicated, exposed as both applied and
  unknown, or otherwise causes a second provider effect;
- a replacement, stale tuple, or invalidated response mutates current state,
  restores a route, sends again, or changes terminal/generation truth;
- terminal durability, notification ordering, cleanup proof, or generation
  fencing changes are required;
- the candidate/evidence delta is not exactly two new source files from
  `ffd45bd` and four total files from `12fd`; or
- protected owner WIP, pinned provenance, raw logs, expected skips, or the
  no-retry/destructive boundaries drift.

A test inconvenience, a late return by itself, ordinary same-registration
retirement, or provider inactivity without contrary causal evidence does not
reopen this decision.

## Protected workspace and transaction boundary

The protected owner WIP is outside this decision and must remain unstaged and
byte-identical:

```text
apps/web/package.json
apps/web/src/main.tsx
bun.lock
```

Its required aggregate diff hash is:

```text
ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8
```

No protected path may be staged, restored, formatted, cleaned, or modified.
Canonical raw logs, evidence files, Decision 0006, Project Home, Ticket 06
PLAN/WP files, source files, tests, configuration, and Alfie content are also
outside this persistence transaction.

## Downstream effect

Once tracked, this record is aspect-scoped Authoritative for live-control
post-await retirement classification. It supersedes Decision 0006 only on
that named aspect and preserves every other Decision 0006 invariant. It also
amends the downstream route established by Decision 0007: the exact containment
correction must be implemented as a two-file candidate, then WP-01 and the one
full five-file WP-02 must rerun before fresh WP-03/WP-04 authorization can be
considered.

The record authorizes no implementation, test execution, real-Pi producer,
destructive operation, quality gate, review, final acceptance, closure, push,
release, or deploy. It prohibits automatic retry, source-surface expansion,
planning edits in this transaction, modification of historical logs, editing
Decision 0006 in place, and any use of the old authorization as transferable
authority. The final acceptance remains reserved for Decision 0009 after one
integrated review.
