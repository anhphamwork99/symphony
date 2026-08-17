# Post-review remediation evidence

Candidate base: parent commit `f05bb5a0`; the four-file Antigravity/main change
set is committed together with these project records.

The single independent feature review returned `CHANGES_REQUIRED` (4 High,
2 Medium) against the pre-remediation candidate. No second reviewer was used.
The findings were remediated and carried into the single final Supervisor
consultation together with the contrary review evidence. The finding closure
below is the durable project summary of that review and remediation.

## Finding closure

1. Terminal settlement cleanup admission window:
   `installExitedCleanupFence` installs the owned quarantine/resource fence
   before settlement for watchdog, Stop-hook, process-error, and interrupt.
   The table-driven regression
   `keeps admission fenced after terminal settlement while owned cleanup is unconfirmed`
   proves each claimant rejects a follow-up, does not spawn again, retains the
   run directory and lease, and emits quarantine diagnostics.
2. Session Stop racing a watchdog claimant:
   the losing Stop joins `terminalSettlement`, suppresses a second teardown,
   and leaves the managed close watcher to reap resources and exit the session.
   Regression: `lets Stop join a watchdog claim without a second teardown, then close reaps and exits`.
3. Stop-hook final drain:
   Stop-hook settlement performs a single-flight final transcript drain with
   ownership and activity-revision revalidation before the terminal event.
   Regression: `drains a final planner response before the single Stop-hook terminal`.
4. Preparation cleanup after Stop:
   preparation fences carry `stopRequested`; Stop cancels retries, performs one
   final cleanup attempt, and does not re-arm a timer on failure.
   Regression: `makes one bounded preparation cleanup attempt during Stop and never rearms its timer`.
5. Replacement teardown-unproven:
   replacement captures ownership before teardown and enters the supervised
   session-stop quarantine/reap path before returning a fenced restart error.
   Regression: `quarantines an unproven replacement teardown and does not admit a replacement turn`.
6. Stop-hook warning classification:
   unproven Stop cleanup emits cleanup-unconfirmed diagnostics/warning and does
   not emit watchdog-only `missing_terminal` diagnostics.
   Regression: `settles Stop-hook teardown failure through quarantine`.

## Final verification

- `bun run --cwd apps/server test -- src/provider/Layers/AntigravityAdapter.test.ts src/provider/providerRuntimeReconciliation.test.ts src/provider/terminalTurnApplicability.test.ts src/provider/supervisedProcessTeardown.test.ts src/main.test.ts`
  — 5 files, 147/147 tests passed.
- `bun run --cwd apps/server typecheck`
  — nonzero only from the concurrent Pi-subagent strand; no diagnostics mention
  `AntigravityAdapter.ts`, `AntigravityAdapter.test.ts`, `main.ts`, or
  `main.test.ts`.
- `git diff --check` for the four changed files passed.
- No Codex writer, Vitest, or TypeScript process remained after verification.
- The verified change set is committed together with these project records.
