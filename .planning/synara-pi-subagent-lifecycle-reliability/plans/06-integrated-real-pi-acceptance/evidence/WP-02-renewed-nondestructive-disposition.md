# Renewed WP-02 non-destructive real-Pi disposition — Ticket 06

**State:** CHALLENGED — the renewed WP-02 attempt started exactly once and
stopped at the canonical-identity leg. It is not a current WP-02 PASS. No
producer is run by this evidence-preservation transaction, and no retry is
authorized.

**Recorded:** 2026-08-28 (local, UTC+7)  
**Evidence class:** R (controlled real-Pi, non-destructive), with provenance
facts recorded as P.  
**Frozen candidate:** `ffd45bd867e94c9003415f5f2e937cc9c616e399`  
**Alfie pin:** `3fe340b401ca86bcbe8b55abd4de107e1d93482e`

## 1. Fixed execution and isolation facts

- Symphony producer worktree was `/private/tmp/symphony-t06`, at the exact
  frozen candidate `ffd45bd867e94c9003415f5f2e937cc9c616e399`.
- Controlled Alfie worktree was `/tmp/alfie-t06`, at the exact pinned commit
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e`; its post-attempt tracked status
  was clean.
- Both renewed legs used Node v24.14.1 and the supported Vitest runner.
- `ALFIE_REPO_DIR=/tmp/alfie-t06` was explicit and
  `SYNARA_T17_MANUAL_TEARDOWN` was unset. No destructive/manual claim is made.
- Each leg ran as its own serial process with a fresh process-level temporary
  outer HOME. The integrated leg used `tmp.gLZPdTzMaC`; the canonical leg used
  `tmp.wX79oSZqVb`. Each EXIT cleanup completed, and post-run checks proved
  both temporary homes absent.
- The no-concurrent-tool producer window was observed: while each producer
  ran, the worker only waited for that process to exit; no FFF, semantic,
  search, or other agent-tool activity was concurrent with it.
- Candidate/Alfie pins, the Pi acceptance-surface zero-delta condition, and the
  protected owner-WIP hash were retained. Protected WIP remained unstaged.

## 2. Renewed attempt scope and stop rule

The renewed complete WP-02 attempt was authorized as one atomic sequence. It
started exactly once and ran the following legs, serially, until the first
nonzero producer exit:

1. `piSubagentRealPiAcceptance.test.ts`
2. `piSubagentCanonicalIdentityAcceptance.test.ts`
3. `piSubagentLifecycleContainmentRealPiAcceptance.test.ts`
4. `piSubagentRestartAcceptance.test.ts`
5. `piSubagentResumeAcceptance.test.ts`

The first two legs ran. The canonical-identity exit 1 consumed the attempt and
stopped the sequence. Legs 3–5 were therefore **not run** in this renewed
attempt: lifecycle-containment, restart, and resume have no renewed result.
There was no behavioral retry and no continuation after the canonical failure.

## 3. Leg 1 — integrated real-Pi PASS

- **Runner:** Node v24.14.1
- **Fresh HOME:** `tmp.gLZPdTzMaC`; cleanup completed and absence was proven
- **Result:** 1 file passed; 10 tests passed; 1 expected manual skip; exit 0
- **Expected skip:** the single destructive manual T17-AC6 test, excluded by
  the unset `SYNARA_T17_MANUAL_TEARDOWN` environment variable
- **Fixture barrier:** T17-AC4 exact-two barrier recorded
  `accepted=2 pending=2`
- **Immutable raw log:**
  `evidence/WP-02-renewed-realpi-acceptance.log`
- **SHA-256:**
  `5bdb1a515b715fa62b63602f83aa1762b9b61812f194528c2322b71dbc5bb78b`

This is an integrated-leg PASS only. It does not promote WP-02 to PASS and
does not authorize downstream gates.

## 4. Leg 2 — canonical-identity failure and diagnostics

- **Runner:** Node v24.14.1
- **Fresh HOME:** `tmp.wX79oSZqVb`; cleanup completed and absence was proven
- **Result:** 1 file failed; 2 tests failed; 7 tests passed; exit 1
- **Terminal-first failure** (`piSubagentCanonicalIdentityAcceptance.test.ts:913`):
  expected diagnostic `pi_subagent_read_live_record_unavailable`, but observed
  `pi_subagent_live_lifecycle_stale_ignored`.
- **Enqueue-first failure** (`piSubagentCanonicalIdentityAcceptance.test.ts:924`):
  expected text `Steer state: applied`, but observed
  `Managed live lifecycle stale response ignored`.
- **Immutable raw log:**
  `evidence/WP-02-renewed-canonical-identity-acceptance.log`
- **SHA-256:**
  `28ded0c0221643cff775b467c9f2df15cf83627016a58e9184c59c46e170c08c`

This is a behavioral canonical-identity challenge, not an environment failure
and not evidence for a source fix. Source diagnosis is pending a fresh owner
decision; this record makes no implementation change.

## 5. Disposition and downstream routing

- No current five-leg WP-02 PASS exists. The integrated PASS is retained as a
  bounded leg result; the canonical failure prevents WP-02 completion.
- The renewed raw logs are preserved byte-for-byte. Historical attempt logs
  remain unchanged and supporting-only.
- No retry is authorized for this spent renewed attempt.
- Lifecycle-containment, restart, and resume were not run and must not be
  described as renewed PASS or failure results.
- The destructive WP-03 leg was not run. WP-03 remains blocked pending a
  renewed five-leg WP-02 PASS and fresh owner authorization.
- WP-04 remains blocked pending a newly authorized WP-03 PASS. No quality,
  review, Supervisor, or destructive work was run.
- No source, test, fixture, configuration, manifest, lockfile, or Alfie change
  was made or is implied by this challenge record.
