# WP-08 execution log — challenge evidence (worker, 2026-08-17)

All commands run in `apps/server` with `export PATH="$HOME/.bun/bin:$PATH"` and
`ALFIE_REPO_DIR=/Users/anhpham99/alfie` (checkout verified at pinned commit
`82406bd8`, all three provenance SHA-256 hashes match
`src/provider/test-fixtures/piSubagentExtensionProvenance.json`).
`.pi/` removed before every run. Machine: 10 logical cores (4 P-cores), macOS,
load average 3.2–3.5 throughout.

## Mechanism verification (probe, removed afterwards)

Temporary probe files (deleted before final tree audit) logged
`VITEST_POOL_ID` + `process.pid` per file:

- Old default (`vitest run --maxWorkers=1 --no-file-parallelism`, no projects):
  two files → pid 74049/74050, 74055/74056, 74061/74062 across 3 runs.
  **Vitest 4's default `forks` pool + `isolate: true` already forks a distinct
  child process per file even in one project**; the old script was serial, not
  same-process. (`poolOptions.forks.singleFork` / `minWorkers` do not exist in
  vitest 4.1.10 — verified against `dist/**/config.d.ts`, CLI options list, and
  scheduler source `chunks/cli-api.BK8pd4xc.js`.)
- New config (projects `unit` + `wallclock`): wallclock project runs first
  (groupOrder 1), unit second (groupOrder 2), distinct pids per project
  (19092 wallclock / 19093 unit). `sequence.groupOrder` verified in scheduler
  source: distinct orders run strictly sequentially
  (`for (const group of taskGroups) { await Promise.allSettled(...) }`).
- Mandated 4-file invocation: four distinct child pids observed
  (21511 / 23103 / 24312 / 24770), acceptance first.

Probe files removed; `git status` shows only the three write-set files.

## Measurement table

Envelope: Decision 0006 §5 `budget + 500 ms` = **800 ms** for AC2
(300 ms budget). Failing assertion:
`piSubagentForegroundAcceptance.test.ts:900` `expect(elapsed).toBeLessThan(foregroundWaitMs + 500)`.

| #      | Composition (under isolation config)                                                          | Result                                                                                                                                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1–R17 | Mandated 4-file invocation (`bun run test <acceptance> <reopen> <lifecycle> <realExtension>`) | **10 fail / 17 runs** (R2,R3,R7=1002 ms,R8=1119 ms,R10=937,R11=950,R12=1032,R13=935,R15=930,R17=963; green: R1,R4,R5,R6,R9,R14,R16)                                                                                                              |
| S1–S7  | Acceptance standalone (`bun run test src/provider/piSubagentForegroundAcceptance.test.ts`)    | **7/7 green** (S5–S7 run immediately before R13–R15 in the same load window)                                                                                                                                                                     |
| E1 ×3  | Acceptance + 1 tiny dummy test file                                                           | 3/3 green                                                                                                                                                                                                                                        |
| E6 ×3  | Acceptance + 3 tiny dummy test files                                                          | 3/3 green                                                                                                                                                                                                                                        |
| E2 ×3  | Acceptance + realExtension (2 heavy files)                                                    | 1 fail (1061 ms) / 3                                                                                                                                                                                                                             |
| E4 ×3  | Fully separate invocations: acceptance alone, then reopen+lifecycle+realExtension together    | acceptance standalone: 2 timing fails (943, 923 ms) + 1 completion-text fail ("Agent detached…" vs "Agent completed in"); rest-invocation 1/3 failed with **two** envelope fails in realExtension (923 ms in T21 suite, 1178 ms in T22-AC1..AC8) |

Key discriminator (same load window, sequential): S5/S6/S7 standalone green
3/3 → immediately R13 fail (935 ms), R14 green, R15 fail (930 ms).

## Order-of-execution proof that refutes the teardown attribution

In failing runs R7/R8/E2-2, the acceptance file executes **first** — its
child's `ExperimentalWarning` (pid 88889/50924) is the first worker output
after the RUN banner, and the other files' workers start only after acceptance
completes. AC2 still fails there. Therefore no adjacent teardown (same-process
or cross-process) precedes the failing measurement.

## Conclusion reached

The WP-08 challenge condition "repeated runs still show the envelope tail
under isolation" is met:

1. Process isolation is implemented and proven working (distinct PIDs per
   file, groups strictly sequential, wallclock first).
2. The envelope tail persists at ~59% (10/17) for the mandated 4-file
   invocation while the identical file is green 7/7 standalone, including
   back-to-back same-window comparisons.
3. Root-cause attribution in the ticket ("shared-worker scheduling during
   adjacent real-Pi teardown") is disproven for the first-executed file: the
   contaminating factor is the **presence of heavy pending test files in the
   same vitest invocation** (main-process Vite transform/module-graph and
   scheduling work for files not yet executed), which scales with pending
   import weight (3 tiny dummies: green; realExtension pending: fails).
4. Failures are not acceptance-only: E4-3 shows realExtension envelope fails
   (923/1178 ms) in an invocation that contains no acceptance file, and one
   completion-text failure ("Agent detached…" vs "Agent completed in")
   occurred under load — the wall-clock sensitivity is broader than one file.

## Tree state (not committed)

Working-tree changes, all within the allowed write set:

- `apps/server/vitest.config.ts` — projects `unit`/`wallclock` split,
  groupOrder 1/2, maxWorkers 1, fileParallelism false, adjudication note.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts` —
  file-level doc comment only.
- `apps/server/src/provider/piSubagentRealExtension.test.ts` — file-level doc
  comment only.
- `apps/server/package.json` — **unchanged**: the existing script
  `vitest run --maxWorkers=1 --no-file-parallelism` already picks up the
  projects automatically (verified); `poolOptions.forks.singleFork` from the
  WP sketch does not exist in vitest 4.1.10, so no script edit was needed.

No commit made: the mandated 3/3-green focused runs and 2/2-green full suite
are not achievable under this mechanism on this machine, and the WP instructs
to stop and return challenge at this point rather than improvise.
