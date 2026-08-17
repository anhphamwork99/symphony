# WP-08 — Test-harness process isolation for wall-clock-sensitive Ticket 22 suites

**State:** pending

**Owner role:** worker

**Repository:** `/Users/anhpham99/symphony`

**Dependencies:** none (builds on landed commits `e2239c6e`..`40016836`)

## Owner adjudication being implemented

The WP-07 timing-envelope challenge was adjudicated 2026-08-17 as **option (b)**:
resolve via harness process isolation. Decision 0006 §5's `budget + 500 ms`
envelope stays exactly as written — no assertion may be widened, and Decision
0006 is NOT reopened. Record this in the implementation notes of whatever
config/scripts you touch.

## Task

Make the Ticket 22 wall-clock-sensitive test files run in separate vitest
processes automatically, so adjacent real-Pi teardown in the same worker can no
longer push detach timings past the `budget + 500 ms` envelope during multi-file
or full-suite invocations. Prove it with repeated full-suite runs.

## Background

- `apps/server/package.json` script: `vitest run --maxWorkers=1
  --no-file-parallelism` (already serial, but serial-in-one-process).
- `apps/server/vitest.config.ts` merges the root `vitest.config.ts` (aliases
  only) and sets 90 s timeouts.
- WP-07 measured: standalone files meet the envelope (AC2 detach 327 ms on
  300 ms budget), but the 4-file invocation fails ~6/11 at 894–1316 ms and the
  full suite flaked 1/2 runs at 1296 ms. Root cause: real-Pi
  session/extension teardown from adjacent tests settling in the same vitest
  worker process.

## Allowed write set (nothing else)

- `apps/server/vitest.config.ts`
- `apps/server/package.json` (scripts only; no dependency/version changes)
- `apps/server/src/provider/piSubagentRealExtension.test.ts` and
  `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` — **only**
  to add a file-level doc comment naming the isolation mechanism, if that is
  where you document it; no test-logic changes.

Forbidden: any test assertion, timeout value inside these tests, any other
source file, contracts, Alfie files, planning docs (the owner adjudication is
already recorded in the ticket).

## Implementation contract

1. **Isolation mechanism.** Use vitest's projects/workspaces feature (or
   `pool: "forks"` with per-file pool isolation if that is demonstrably
   sufficient) so that each wall-clock-sensitive file executes in its own
   process:
   - At minimum these files: `piSubagentForegroundAcceptance.test.ts`,
     `piSubagentForegroundReopen.test.ts`,
     `piSubagentForegroundLifecycle.test.ts`,
     `piSubagentRealExtension.test.ts`.
   - One clean approach: define two projects in `apps/server/vitest.config.ts`
     — `unit` (include `src/**/*.test.ts`, exclude the four files) and
     `wallclock` (include only the four files, `pool: "forks"`,
     `poolOptions.forks.singleFork: false`, `maxWorkers`/`minWorkers: 1`).
     Verify the exact option names against the installed vitest version
     before committing.
   - The default `bun run test` inside `apps/server` must pick up the projects
     automatically; no new manual command may be required for correctness.
2. **No behavioral changes.** No assertion edits, no timeout bumps in tests,
   no envelope widening anywhere. If you believe an assertion must change,
   stop and return `challenge`.
3. **Verify the mechanism, not just the run.** Demonstrate that the
   wall-clock-sensitive files actually run in separate processes (e.g. distinct
   worker/process ids logged per file via a temporary reporter or env probe —
   remove the probe afterwards), then demonstrate timing stability.
4. **Repeated-runs evidence.** Run, with
   `export PATH="$HOME/.bun/bin:$PATH"` and `ALFIE_REPO_DIR=/Users/anhpham99/alfie`:
   - The 4-file focused invocation (`bun run test src/provider/piSubagentForegroundAcceptance.test.ts src/provider/piSubagentForegroundReopen.test.ts src/provider/piSubagentForegroundLifecycle.test.ts src/provider/piSubagentRealExtension.test.ts`) **3 times**, all green.
   - The full server suite (`bun run test` in `apps/server`) **2 times**, both
     green (the pre-isolation full suite flaked 1/2).
   - Clean `apps/server/.pi/` artifacts between runs.
5. **Performance sanity.** Report total wall time of the full suite before vs
   after isolation (WP-07 recorded 435 s for run 2). If isolation doubles the
   full-suite time, prefer scoping the second project to only the four files
   and note the delta honestly.

## Verification

All runs recorded with exact commands, exit codes, durations, test counts. No
push; one local commit:
`test(pi): isolate wall-clock-sensitive ticket 22 suites into separate processes (issue 22 remediation)`

## Challenge conditions

Stop and return `challenge` if: the installed vitest version cannot express
per-file/per-project process isolation; repeated runs still show the envelope
tail under isolation (this would mean the root-cause attribution is wrong and
option (b) fails — report measurements); or full-suite time regresses
unreasonably (>2x).
