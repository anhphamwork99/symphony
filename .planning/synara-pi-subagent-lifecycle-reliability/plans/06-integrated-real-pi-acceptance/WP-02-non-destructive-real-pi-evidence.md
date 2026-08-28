# WP-02 — exactly one new full non-destructive real-Pi evidence run

**State:** **BLOCKED** pending a passing WP-01 producer collection at frozen
candidate2. No current R PASS.
**Candidate:** `2afef48b008527685658801d8f0d84c79e24827d`, the sole-parent child
of `ffd45bd867e94c9003415f5f2e937cc9c616e399`; candidate2 is the producer
identity, never the integration merge.
**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is Authoritative for canonical F5 classification and the exact containment
correction. Decision 0007 remains authoritative for the historical fixture
rebaseline and erratum.

## Route and objective

After WP-01 PASS, run exactly one new complete five-file set, serially, against
candidate2 and the pinned controlled Alfie composition. The run must prove the
corrected terminal-first and enqueue-first F5 outcomes, lifecycle/restart/
Resume strands, exact tuple traces, bounded diagnostics, isolation, expected
skips, cleanup, and zero source delta. It is non-destructive only and cannot
provide M evidence.

## Closed five-file set

```text
apps/server/src/provider/piSubagentRealPiAcceptance.test.ts
apps/server/src/provider/piSubagentCanonicalIdentityAcceptance.test.ts
apps/server/src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts
apps/server/src/provider/piSubagentRestartAcceptance.test.ts
apps/server/src/provider/piSubagentResumeAcceptance.test.ts
```

No manifest expansion or prerequisite-dependent extra file is allowed.

## Candidate, Alfie, and isolation

Alfie remains pinned at
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
`@alfie/pi-subagents@0.15.0-alfie.6`; no Alfie source or pin change is
allowed. Use a fresh detached candidate worktree, process-level HOME
isolation, explicit `ALFIE_REPO_DIR`, isolated state/workspace/ports, and the
supported Node runner where required by the existing manifest. The main
integration merge `44249d81c49172e192dcf0f09ddfadc702a4b34c` has parents
`50853a3b9774e7aa5462916056195ffa536dc491` and candidate2 but is provenance
only, not a producer checkout identity.

## Exactly-once and stop gates

Each file runs once in its own standalone Vitest process. A first nonzero exit,
unexpected skip, failed cleanup, provenance/pin drift, non-empty acceptance-
surface delta, protected-WIP hash/staging drift, canonical F5 contradiction,
retry, or third-file need stops the attempt immediately. There is no retry.
Historical ffd WP-02 evidence and the focused candidate2 red/green logs are
not current R evidence.

No destructive operation, PID enumeration/signalling, manual recipe, quality
gate, review, or Supervisor work is authorized or run by this package. A
five-leg exit-0 result only unlocks fresh owner WP-03; it does not activate old
authorization. Protected owner WIP remains outside this transaction and its
required aggregate hash is
`ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.
