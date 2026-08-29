# WP-03 — exactly-one fresh owner-authorized manual destructive run

**State:** **PASS.** The sole Decision 0009 manual destructive run completed at candidate `9b55649050b76feffdc4279ceaec92ac74a78686` with producer exit `0`, the selected T17-AC6 case passing, exact owned root and descendant TERM evidence, zero survivors, band-76 fencing, and complete temporary-root cleanup. No retry occurred.

**Authority:** Decision 0009 is aspect-scoped **Authoritative** for the exact four-file correction and rebaseline route; inherited destructive-boundary decisions remain binding and unchanged. The owner's current-session instruction `TIếp tục hoàn thiện ticket đi` supplied fresh WP-03 authorization after WP-02 PASS.

## Objective and boundary

The sole M evidence for T06-AC6 was produced through exactly one operator-executed, isolated real-Pi run using the accepted recipe. The zero-owned-child claim is limited to the run's own exact child tree and TERM→bounded-KILL proof. No PID guessing, process-name kill, external signalling, parent fallback, Symphony kill authority, automation, or retry occurred or is claimed.

## Execution result

- Candidate: `9b55649050b76feffdc4279ceaec92ac74a78686`.
- Alfie: `3fe340b401ca86bcbe8b55abd4de107e1d93482e`.
- Producer: standalone Node/Vitest wallclock run with `SYNARA_T17_MANUAL_TEARDOWN=1`, explicit `ALFIE_REPO_DIR`, and fresh process HOME.
- Result: `1 passed`, producer exit `0`; the other ten tests were unselected by the manual-only name filter.
- Owned root PID `29538` and descendant PID `29552` both recorded TERM and were absent after the run.
- `noBand76WhileLive=true`; durable bands `75,76`; generation `1 -> 2`.
- Fresh HOME and harness root were removed; candidate, Alfie pin, staging, and protected WIP remained unchanged.

Evidence:

- `evidence/WP-03-decision0009-manual-destructive.log`
- `evidence/WP-03-decision0009-operator-record.md`

## Downstream route

WP-03 is complete and must not be rerun. WP-04 Q and WP-05 review subsequently
passed; WP-06 persisted accepted Decision 0010; WP-07 closed routing.

## Write set and commit

This transaction writes only this WP file, the raw log, and the operator record; it changes no source, configuration, recipe, WP-04/05/06/07 artifact, or protected owner WIP. Commit message: `docs(planning): record Ticket 06 manual destructive run`.
