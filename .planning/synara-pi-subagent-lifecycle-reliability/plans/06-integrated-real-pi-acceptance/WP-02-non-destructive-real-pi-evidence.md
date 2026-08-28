# WP-02 — one fresh full non-destructive real-Pi attempt

**State:** BLOCKED until fresh WP-01 PASS at frozen candidate
`9b55649050b76feffdc4279ceaec92ac74a78686`. Candidate2's attempt is
**CHALLENGED — historical supporting evidence only**; there is no current WP-02
R PASS and no retry.

**Frozen candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`, the exact
sole-parent child of candidate2 and the producer identity for the next attempt.
**Candidate2:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`; it is historical producer
identity, never the integration merge.

**Authority:** [Decision 0009](../../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the exact four-file correction,
rebaseline, and fresh no-retry route.

## Attempt outcome

The serial candidate run began only after the passing WP-01 deterministic
collection. Two of the five closed wallclock producers ran:

| Producer | Environment | Result |
|---|---|---|
| `piSubagentRealPiAcceptance.test.ts` | fresh HOME `tmp.k0HG`; cleanup **PASS** | `10 passed, 1 expected skip`, exit **0** |
| `piSubagentCanonicalIdentityAcceptance.test.ts` | fresh HOME `tmp.Td4`; cleanup **PASS** | `8 passed, 1 failed`, exit **1** |

The integrated leg's one skip was the expected manual destructive test. No
unexpected skip was recorded. The first nonzero exit stopped the attempt. The
later three authorized legs — lifecycle containment, restart, and resume — were
**not run**. No destructive operation, PID enumeration/signalling, formatter,
lint, typecheck, review, or Supervisor consultation was performed.

## Completed trace and exact mismatch

The canonical terminal-first strand reached its assertion at
`piSubagentCanonicalIdentityAcceptance.test.ts:913`:

```text
expected: pi_subagent_read_live_record_unavailable
received: pi_subagent_live_lifecycle_unavailable
```

The completed enqueue-first strand independently passed with result
`applied`, `sessionSteerInvocations=1`, and `sdkInsertions=1`. Its ordered trace
included the production tool call, manager invocation, exact live tuple and
held-child observation, live-guard pass, session-steer invocation, one
synchronous SDK insertion, returned-promise hold/release, bridge-index
retirement, durable seq-40 commit, post-await generation pass, bookkeeping, and
settlement. The trace therefore proves the enqueue-first accepted-effect path,
but it does not repair the terminal-first diagnostic mismatch.

The source-grounded trace shows that containment discards the structured
provider classification. The failure is material: the expected read-boundary
classification is replaced by the generic live-lifecycle code. It is not
legitimate to relabel terminal-first as `applied` without provider acceptance.

## Decision 0009 correction contract

Decision 0009 selects internal `unavailableReason` preservation. The reason may
exist only on an internal `status: "unavailable"` result. The managed binding
maps unaccepted control `provider_inactive` to
`pi_subagent_read_live_record_unavailable`; observation and generic unavailable
remain `pi_subagent_live_lifecycle_unavailable`. The reason is never public,
durable, or parsed from provider text. The exact four-file correction and
six-path total from `12fd6686` must be implemented and frozen before renewal.

The exact correction paths are:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
apps/server/src/provider/piSubagentManagedRuntimeBinding.ts
apps/server/src/provider/piSubagentCanonicalRouting.test.ts
```

The frozen candidate is one sole-parent child of candidate2, with exactly these
four correction paths and exactly six distinct paths from `12fd6686`. No fifth
behavioral file or public/schema/configuration/Alfie change is authorized.

The attempted **applied-without-acceptance** interpretation is rejected:
terminal-first did not cross the provider-owned acceptance boundary, so it
cannot be reported as an accepted effect.

## Evidence and downstream state

The two raw owner-checkout logs are preserved byte-identically at:

- `evidence/WP-02-decision0008-realpi-acceptance.log`
- `evidence/WP-02-decision0008-canonical-identity-acceptance.log`

Their hashes, producer environment, cleanup, protected-WIP, and zero-delta
records are in `evidence/WP-02-decision0008-realpi-provenance.txt`; the full
classification and routing record is in
`evidence/WP-02-decision0008-nondestructive-disposition.md`.

This attempt is candidate-challenged historical evidence only. The frozen
candidate is ready for WP-01; candidate2's actual `303` tests plus five focused
implementation tests make `308` an estimate only, not WP-01 evidence. The
required route is: fresh WP-01 on the unchanged closed 19-file set with actual
count → exactly one complete five-file WP-02 → fresh owner WP-03 → fresh owner
WP-04 → WP-05 one integrated review → WP-06 one final Supervisor Decision 0010
→ WP-07 closure. WP-02 remains blocked until WP-01 PASS; WP-03 through WP-07
remain blocked after that boundary. No retry or missing-leg rerun is permitted.
The unauthorized heavyweight typecheck/lint/targeted-format incident is not
WP-04/Q evidence, not a gate, and was not rerun.

## Commit boundary

The four candidate3 focused logs are copied byte-identically and are supporting
implementation evidence only. This freeze modifies exactly the ten paths named
in PLAN §9 and does not modify source, tests, configuration, lockfiles, Alfie,
or protected owner WIP. The protected WIP remains unstaged with its exact
aggregate hash. No producer, test, quality command, retry, or gate is run here.
