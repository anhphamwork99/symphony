# WP-02 — exactly one new full non-destructive real-Pi evidence run

**State:** historical only at `ffd45bd`; the renewed attempt is CHALLENGED and
spent. Its integrated leg passed, canonical-identity leg failed, lifecycle /
restart / resume were not run, and no retry is authorized. Current WP-02 is
blocked until the reset WP-01 PASS at the new containment candidate.

**Authority:** [Decision 0008](../../decisions/0008-reassessment-live-control-post-await-retirement-classification.md)
is aspect-scoped Authoritative for canonical F5 classification and the exact
two-file correction. Decision 0007 remains historical/aspect-scoped for the
fixture rebaseline and erratum. No current D/R PASS exists.

## Route and objective

After reset WP-01 PASS, run exactly one new complete five-file set, serially,
against the new candidate and pinned controlled Alfie composition. The run must
prove the corrected terminal-first and enqueue-first F5 outcomes, all required
lifecycle/restart/resume strands, exact tuple traces, bounded diagnostics,
isolation, expected skips, cleanup, and zero source delta. This WP is
non-destructive only and cannot provide M evidence.

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

The producer candidate is the exact new two-file child of `ffd45bd`, never the
historical ffd candidate or merge `064b49f1d`. Alfie remains
`3fe340b401ca86bcbe8b55abd4de107e1d93482e` / `@alfie/pi-subagents@0.15.0-alfie.6`;
no Alfie source/pin change. Use fresh detached worktrees, process-level HOME
isolation, explicit `ALFIE_REPO_DIR`, isolated state/workspace/ports, and the
supported Node runner where required by the existing manifest.

## Exactly-once and stop gates

Each of the five files runs once in its own standalone Vitest process. A first
nonzero exit, unexpected skip, failed cleanup, provenance/pin drift, non-empty
acceptance-surface delta, protected-WIP hash/staging drift, canonical F5
contradiction, retry, or third-file need stops the attempt immediately. The
new run has no retry. Preserve all historical raw logs byte-for-byte and never
reinterpret them as current evidence.

No destructive env/operation, PID enumeration/signalling, manual recipe,
quality gate, review, or Supervisor work is run here. A five-leg exit-0 result
only unlocks fresh owner WP-03; it does not activate old authorization.

## Evidence and commit boundary

Record per-leg commands, exits, counts, durations, expected skip, exact
candidate/Alfie provenance, isolation/cleanup, AC mapping, failure diagnostics,
protected-WIP hash, and zero-delta proof in the future WP-02 artifacts. The
current renewed disposition/provenance artifacts record the historical reset
and are not overwritten by a future producer.

```text
test(pi): record Ticket 06 non-destructive real-Pi evidence
```
