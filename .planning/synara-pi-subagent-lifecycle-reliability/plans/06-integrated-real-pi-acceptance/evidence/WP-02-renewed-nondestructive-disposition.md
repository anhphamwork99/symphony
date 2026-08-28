# Historical renewed WP-02 disposition — Ticket 06 evidence reset

**State:** CHALLENGED / historical supporting only. The renewed attempt at
`ffd45bd867e94c9003415f5f2e937cc9c616e399` started exactly once, passed the
integrated leg, failed the canonical-identity leg, and stopped atomically.
There is no current WP-02 PASS and no retry is authorized for that attempt.

**Recorded:** 2026-08-28 (UTC+7)
**Evidence classes:** R for producer results; P for provenance.
**Historical candidate:** `ffd45bd867e94c9003415f5f2e937cc9c616e399`
**Alfie pin:** `3fe340b401ca86bcbe8b55abd4de107e1d93482e`

## 1. Preserved execution facts

- Symphony producer worktree: `/private/tmp/symphony-t06`, exact ffd SHA.
- Controlled Alfie worktree: `/tmp/alfie-t06`, exact pin, clean tracked tree.
- Node v24.14.1 and supported Vitest runner; explicit `ALFIE_REPO_DIR`;
  `SYNARA_T17_MANUAL_TEARDOWN` unset.
- Integrated and canonical legs each used a fresh process-level temporary
  outer HOME (`tmp.gLZPdTzMaC`, `tmp.wX79oSZqVb`), with EXIT cleanup and
  post-run absence verified. No-concurrent-tool producer discipline held.
- No destructive/manual claim; protected WIP was not staged; candidate/pin and
  acceptance-surface zero-delta gates were retained at the historical run.

## 2. Exact renewed attempt and immutable results

The atomic closed sequence was integrated, canonical-identity,
lifecycle-containment, restart, resume. It stopped after leg 2; legs 3–5
were not run. No continuation or behavioral retry occurred.

1. **Integrated leg — PASS only:** exit 0; 1 file, 10 tests, 1 expected
   manual destructive skip; exact-two T17-AC4 barrier `accepted=2 pending=2`.
   Raw log SHA-256:
   `5bdb1a515b715fa62b63602f83aa1762b9b61812f194528c2322b71dbc5bb78b`.
2. **Canonical-identity leg — FAILED:** exit 1; 1 file, 2 failed and 7
   passed. At `piSubagentCanonicalIdentityAcceptance.test.ts:913`, terminal-
   first expected `pi_subagent_read_live_record_unavailable` but observed
   `pi_subagent_live_lifecycle_stale_ignored`. At `:924`, enqueue-first expected
   `Steer state: applied` but observed `Managed live lifecycle stale response
   ignored`. Raw log SHA-256:
   `28ded0c0221643cff775b467c9f2df15cf83627016a58e9184c59c46e170c08c`.

These raw logs are immutable. They establish the exact historical challenge,
not a source fix, current candidate proof, or permission to retry. The current
failure is the Decision 0008 same-registration-retirement versus
replacement/invalidation classification seam.

## 3. Binding reassessment and reset

Decision 0008 is aspect-scoped **Authoritative** for this classification only.
Its exact implementation write set is exactly:

```text
apps/server/src/provider/piSubagentLiveLifecycleContainment.ts
apps/server/src/provider/piSubagentLiveLifecycleContainment.test.ts
```

The new candidate must be an exact two-file child of historical ffd and an
exact four-file child of `12fd6686` including the two Decision 0007 fixture
files. No canonical expectation, Alfie source/pin, third file, coordinator,
configuration, persistence, orchestration, watchdog, teardown, or unrelated
change is allowed. The new candidate SHA is unknown until implementation and
must be recorded before evidence.

## 4. Downstream route and no-retry state

Historical ffd/WP-01 and this renewed WP-02 attempt are supporting only. The
route resets to: containment two-file child → freeze → same WP-01 closed set
with 296 baseline plus exact implementation-added focused cases (count recorded
after implementation) → exactly one new full five-file WP-02 → fresh owner
WP-03 → fresh owner WP-04 → WP-05 → WP-06 Decision 0009 → closure.

WP-03/WP-04 old authorizations are non-transferable and not executable. Fresh
owner authorization is required for each gate at its dependency boundary.
No producer, test, implementation, quality, manual, review, or Supervisor work
was run by this evidence reset, and no raw log was modified.
