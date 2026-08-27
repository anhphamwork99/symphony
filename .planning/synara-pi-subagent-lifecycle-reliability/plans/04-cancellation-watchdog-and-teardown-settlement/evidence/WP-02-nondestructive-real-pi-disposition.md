WP-02 non-destructive real-Pi disposition — recorded 2026-08-27 (current session)

## Authorization and execution status

AUTHORIZED and EXECUTED in the current session. The owner said `okay triển khai đi`
in this session, satisfying WP-02's condition 1 (current-session authorization for
provider operation). All five WP-02 conditions held:

1. Owner/current-session authorization for provider operation: PRESENT.
2. `ALFIE_REPO_DIR=/Users/anhpham99/alfie` — the exact clean controlled checkout
   verified in `WP-02-controlled-provider-provenance.txt` (HEAD
   `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, clean tree, matching origin,
   `@alfie/pi-subagents@0.15.0-alfie.6`, all fixture hashes match): CONFIRMED.
3. Tests used isolated temporary state and their existing cleanup hooks: CONFIRMED
   (see "Isolation and cleanup" below).
4. Only the existing cancellation and watchdog acceptance suites ran: CONFIRMED
   (two wallclock files, nothing else).
5. No destructive teardown or manual child-process claim is made: CONFIRMED.

## Exact commands and environment

Working directory: `/Users/anhpham99/symphony/apps/server` (Symphony HEAD at run time:
`bab07af82d31c7fc128fd561fc0dc06eed0f7300`; production code identical to frozen
candidate `08b65ebb466470d71814c4467d74e68f43991138` — see provenance file delta
classification). Run with `set -o pipefail`, each wallclock file standalone through
the repository-pinned Vitest CLI, producer exit captured via `${PIPESTATUS[0]}`:

```bash
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentCancellationAcceptance.test.ts
ALFIE_REPO_DIR=/Users/anhpham99/alfie \
  bun run ../../node_modules/vitest/vitest.mjs run --project wallclock \
  --maxWorkers=1 --no-file-parallelism \
  src/provider/piSubagentWatchdogAcceptance.test.ts
```

Raw output preserved at `evidence/WP-02-nondestructive-real-pi.log`.

## Isolation and cleanup behavior

Both acceptance suites compose their own isolated environment per test: temporary
agent dirs/workspace/state dirs are created under fresh temp directories and removed
by the suites' existing `afterEach` cleanup hooks (`rmSync(dir, { recursive: true,
force: true })` over the tracked `createdDirs` registry — cancellation file :157-166,
watchdog file :144). Provider traffic goes to a deterministic loopback model server
(`http.createServer` on `127.0.0.1` port 0, `synara-local-echo`/`echo-slow` models)
closed by the test. The controlled Alfie repo is only READ (provenance assertion +
extension loading via the pinned manifest); nothing in Alfie is written, reset, or
cleaned. The real Pi runtime process launched by the suites is a child of the test
process using the temp agent dir — no global/system Pi state is touched.

## Actual results (from the preserved log)

- Cancellation acceptance (`piSubagentCancellationAcceptance.test.ts`, wallclock
  project): 1 test file passed, 2/2 tests passed, duration 12.01s (start 22:53:25).
- Watchdog acceptance (`piSubagentWatchdogAcceptance.test.ts`, wallclock project):
  1 test file passed, 2/2 tests passed, duration 6.62s (start 22:53:37).
- Producer exit status: 0 (exit captured via `${PIPESTATUS[0]}`; not masked by tee).

Named cases executed (from the suite files):
- "T06-AC2/AC4/AC5/AC7: Stop cancels foreground-detached and background children
  with termination evidence"
- "T06-AC6/T06-AC1: replayed Stop against settled executions re-dispatches nothing
  and keeps durable truth"
- "T15-AC1/AC4: wall-time expiry escalates a real background child through stage-1
  abort and settles exactly once on child acknowledgement"
- "T15-AC2/AC5: a stage-1 acknowledgement timeout advances to the provider-turn
  interrupt without ever claiming stopped or cancelled"

Both suites begin with `verifyExtensionGitProvenance()` against the controlled
checkout, so this run also re-exercised origin/HEAD/cleanliness/identity/hash
verification live, on Pi SDK `@earendil-works/pi-coding-agent@0.83.0`.

## Evidence-class limits (honest)

This run is CONDITIONAL NON-DESTRUCTIVE REAL-PI evidence only. It is a current-session
run, separate from and additional to the deterministic WP-01 evidence
(`WP-01-focused-deterministic.log`, 11 files / 177 tests, exit 0 at the frozen
candidate), which remains authoritative for criterion-level verdicts. This run does
NOT cover destructive teardown paths: no proven-fence kill of an unowned/surviving
child, no manual operator recipe, no PID enumeration/signalling, no Survivor PID
production evidence, and no `cleanup_uncertain` escalation to an actual process kill
was performed or claimed. Per Decisions 0028 and 0034, destructive real-Pi coverage
remains isolated/manual and was `not run for Ticket 04` (no owner-operated destructive
run record exists). Nothing in this disposition refreshes or weakens the destructive
manual-run claim by inference.
