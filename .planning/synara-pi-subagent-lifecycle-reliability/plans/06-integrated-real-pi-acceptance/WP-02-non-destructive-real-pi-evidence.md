# WP-02 — Decision 0008 candidate non-destructive real-Pi evidence

**State:** **CHALLENGED — historical supporting evidence only.** The candidate
attempt stopped at the first nonzero producer exit. There is no current WP-02 R
PASS and no retry.

**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`; candidate2 is the historical
producer identity, never the integration merge.

**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
remains binding for the canonical F5 classification. The completed trace below
exposes a material diagnostic-contract choice requiring Supervisor reassessment
before any source change.

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

## Required reassessment before source

Route this challenge to Supervisor reassessment before modifying source. The
reassessment must choose and authorize one of these bounded designs:

- **Option A — same two files:** extend the `PiSubagentLiveLifecycleDiagnosticCode`
  union/array in the existing containment source and focused test files, mapping
  an unaccepted `provider_inactive` control to
  `pi_subagent_read_live_record_unavailable`.
- **Option B — third binding file/value preservation:** explicitly authorize a
  third binding file or equivalent value-preservation seam required to carry
  the structured provider classification without loss.

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

This attempt is candidate-challenged historical evidence only. WP-03 manual
destructive evidence, WP-04 quality/report gate, WP-05 integrated review,
WP-06 final Supervisor acceptance, and WP-07 closure/routing are all blocked.
A future source correction, candidate freeze, renewed WP-01, and renewed
complete five-file WP-02 require the reassessment and the existing serial gates.

## Commit boundary

This planning/evidence transaction modifies exactly the six paths listed in
PLAN §9, including the two byte-identical copied logs. It does not modify
source, tests, configuration, lockfiles, Alfie, or protected owner WIP.
