# WP-02 — one fresh full non-destructive real-Pi attempt

**State:** **PASS** — exactly one complete five-file non-destructive attempt
ran at frozen candidate `9b55649050b76feffdc4279ceaec92ac74a78686`, after the
WP-01 PASS. Candidate2's attempt is **CHALLENGED — historical supporting
evidence only**. No retry was used or permitted.

**Frozen candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`, the exact
sole-parent child of candidate2 and the producer identity of the PASS attempt.
**Candidate2:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`; it is historical producer
identity, never the integration merge.

**Authority:** [Decision 0009](../../decisions/0009-reassessment-structured-provider-unavailable-preservation.md)
is aspect-scoped **Authoritative** for the exact four-file correction,
rebaseline, and fresh no-retry route.

## Attempt outcome

The serial five-leg attempt ran exactly once at the frozen candidate from the
detached clean `/private/tmp/symphony-t06` worktree with pinned Alfie. Every
leg used a fresh temporary outer HOME, removed by an EXIT trap and verified
absent, with Vitest under Node:

| # | Producer | Environment | Result |
|---|---|---|---|
| 1 | `piSubagentRealPiAcceptance.test.ts` | fresh HOME `tmp.WfAj2PybL7`; removed, verified | `10 passed, 1 expected skip` (11), exit **0** |
| 2 | `piSubagentCanonicalIdentityAcceptance.test.ts` | fresh HOME `tmp.CHRvDmDLOy`; removed, verified | `9 passed` (9), exit **0** |
| 3 | `piSubagentLifecycleContainmentRealPiAcceptance.test.ts` | fresh HOME `tmp.fgpJHimM0P`; removed, verified | `1 passed` (1), exit **0** |
| 4 | `piSubagentRestartAcceptance.test.ts` | fresh HOME `tmp.WnD69a22rc`; removed, verified | `1 passed` (1), exit **0** |
| 5 | `piSubagentResumeAcceptance.test.ts` | fresh HOME `tmp.7abYq0LzdT`; removed, verified | `1 passed` (1), exit **0** |

Aggregate: **22 passed, 1 expected skip; all five legs exit 0.** The single
skip is exactly the expected manual destructive test; no unexpected skip was
recorded. The candidate source surface stayed zero-delta for the whole
attempt, and the protected-WIP aggregate hash
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8` is
unchanged. No destructive operation, PID enumeration/signalling, formatter,
lint, typecheck, review, or Supervisor consultation was performed.

## Control truth observed

The canonical-identity producer closed the Decision 0008 challenge. The
terminal-first strand's causal trace shows the exact live tuple and held child
observed at the manager barrier, slow-child release, bridge-index retirement,
and the durable seq-40 commit, with action counters
`sessionSteerInvocations=0` and `sdkInsertions=0` and resume, bootstrap,
reconstruction, queue-replay, and new-child structurally absent. The
enqueue-first strand independently recorded result `applied` with exactly
`sessionSteerInvocations=1` and `sdkInsertions=1` across the full ordered
live-guard → steer → SDK-insertion → hold/release → retire → durable-commit →
post-await-generation → bookkeeping trace.

The Decision 0008 mismatch at
`piSubagentCanonicalIdentityAcceptance.test.ts:913`
(`received: pi_subagent_live_lifecycle_unavailable`) no longer reproduces: the
frozen candidate preserves internal `unavailableReason` on unavailable results
and maps control `provider_inactive` to
`pi_subagent_read_live_record_unavailable` at the managed boundary, exactly as
Decision 0009 requires. Both strands' isolated and ambient provider-catalogue
cache diagnostics classified `non-causal-provider-catalogue-cache`.

## Decision 0009 correction contract

Decision 0009 selects internal `unavailableReason` preservation. The reason may
exist only on an internal `status: "unavailable"` result. The managed binding
maps unaccepted control `provider_inactive` to
`pi_subagent_read_live_record_unavailable`; observation and generic unavailable
remain `pi_subagent_live_lifecycle_unavailable`. The reason is never public,
durable, or parsed from provider text. The exact four-file correction and
six-path total from `12fd6686` were implemented and frozen as
`9b55649050b76feffdc4279ceaec92ac74a78686` before this attempt.

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
cannot be reported as an accepted effect. The PASS above rests on the
terminal-first strand asserting the unaccepted read-boundary classification
and the enqueue-first strand asserting the accepted applied effect — two
different strands, neither relabeled.

## Evidence and downstream state

Current PASS evidence, preserved byte-identically:

- `evidence/WP-02-decision0009-realpi-acceptance.log`
- `evidence/WP-02-decision0009-canonical-identity-acceptance.log`
- `evidence/WP-02-decision0009-lifecycle-containment-realpi-acceptance.log`
- `evidence/WP-02-decision0009-restart-acceptance.log`
- `evidence/WP-02-decision0009-resume-acceptance.log`

Their hashes, producer environments, HOME cleanup proofs, protected-WIP, and
zero-delta records are in
`evidence/WP-02-decision0009-realpi-provenance.txt`; the classification and
routing record is
`evidence/WP-02-decision0009-nondestructive-disposition.md`.

The historical Decision 0008 challenge evidence remains supporting only:

- `evidence/WP-02-decision0008-realpi-acceptance.log`
- `evidence/WP-02-decision0008-canonical-identity-acceptance.log`

with its own records in `evidence/WP-02-decision0008-realpi-provenance.txt`
and `evidence/WP-02-decision0008-nondestructive-disposition.md`.

WP-02 is **PASS**. WP-03 — the exactly-one manual destructive M leg — is **not
authorized** and requires fresh owner authorization before it may run. WP-04
requires fresh owner authorization after WP-03 PASS. WP-05 one integrated
review, WP-06 one final Supervisor Decision 0010, and WP-07 closure follow in
order. No retry or missing-leg rerun is permitted. The unauthorized heavyweight
typecheck/lint/targeted-format incident is not WP-04/Q evidence, not a gate,
and was not rerun.

## Commit boundary

This evidence transaction copies the five `WP-02-decision0009-*` logs
byte-identically, adds the provenance and disposition, and minimally updates
PLAN.md, this WP file, the Ticket 06 issue, and PROJECT.md. It does not modify
source, tests, configuration, lockfiles, Alfie, or protected owner WIP. The
protected WIP remains unstaged with its exact aggregate hash. No producer,
test, quality command, retry, or gate is run here.
