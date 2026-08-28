# WP-02 Decision 0009 five-leg non-destructive disposition

**Date:** 2026-08-28 (local, UTC+7)
**Disposition:** **PASS — exactly one complete five-file R attempt**
**Candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`
**No retry. No rerun.**

## 1. Executed scope and exact outcome

The serial five-leg attempt ran exactly once at the frozen candidate, after
the WP-01 PASS collection, from the detached clean `/private/tmp/symphony-t06`
worktree with pinned Alfie. Every leg used a fresh temporary outer HOME,
removed by an EXIT trap and verified absent, with Vitest under Node.

| # | Producer | HOME / cleanup | Result |
|---|---|---|---|
| 1 | `piSubagentRealPiAcceptance.test.ts` | `tmp.WfAj2PybL7`; removed, verified | 10 passed, 1 expected skip (11); exit **0** |
| 2 | `piSubagentCanonicalIdentityAcceptance.test.ts` | `tmp.CHRvDmDLOy`; removed, verified | 9 passed (9); exit **0** |
| 3 | `piSubagentLifecycleContainmentRealPiAcceptance.test.ts` | `tmp.fgpJHimM0P`; removed, verified | 1 passed (1); exit **0** |
| 4 | `piSubagentRestartAcceptance.test.ts` | `tmp.WnD69a22rc`; removed, verified | 1 passed (1); exit **0** |
| 5 | `piSubagentResumeAcceptance.test.ts` | `tmp.7abYq0LzdT`; removed, verified | 1 passed (1); exit **0** |

Aggregate: **22 passed, 1 expected skip; all five legs exit 0.** The single
skip is exactly the expected manual destructive test; no unexpected skip was
recorded. No destructive operation, PID enumeration/signalling, formatter,
lint, typecheck, review, or Supervisor consultation ran.

## 2. Control truth observed

The canonical-identity producer closed the Decision 0008 challenge:

- **Terminal-first** strand: causal trace with the exact live tuple and
  held child observed at the manager barrier, slow-child release,
  bridge-index retirement, and durable seq-40 commit; action counters
  `sessionSteerInvocations=0`, `sdkInsertions=0`; resume, bootstrap,
  reconstruction, queue-replay, and new-child structurally absent.
- **Enqueue-first** strand: applied with exactly
  `sessionSteerInvocations=1`, `sdkInsertions=1`, and the full ordered
  live-guard → steer → SDK-insertion → hold/release → retire → durable-commit
  → post-await-generation → bookkeeping trace.
- The prior mismatch at `piSubagentCanonicalIdentityAcceptance.test.ts:913`
  no longer reproduces: the terminal-first expected classification
  `pi_subagent_read_live_record_unavailable` is now produced by the frozen
  candidate's exact-marker-only mapping (internal `unavailableReason`
  preserved only on unavailable results; control `provider_inactive` mapped
  at the managed boundary; observation and generic route-inactive remain
  generic; provider text never parsed).
- Both strands' isolated and ambient provider-catalogue cache diagnostics
  classified `non-causal-provider-catalogue-cache`.

Raw logs and hashes, producer environment, cleanup proofs, protected-WIP,
and zero-delta records: `evidence/WP-02-decision0009-realpi-provenance.txt`.

## 3. Preservation boundary

The five raw owner-checkout logs are preserved byte-identically under their
`WP-02-decision0009-*` names. This disposition does not rewrite raw logs,
source, tests, configuration, lockfiles, Alfie, protected owner WIP, or
runtime artifacts. Protected WIP remains unstaged with aggregate hash
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`; the
candidate surface stayed zero-delta for the whole attempt.

## 4. Downstream state

WP-02 is **PASS**. WP-03 — the exactly-one manual destructive M leg — is
**not authorized**; it requires fresh owner authorization before it may run.
WP-04 requires fresh owner authorization after WP-03 PASS. WP-05 one
integrated review (G-M), WP-06 one final Supervisor Decision 0010 (G-Q), and
WP-07 closure follow in order. No retry or missing-leg rerun is permitted.
No acceptance of Ticket 06 is claimed by this disposition.
