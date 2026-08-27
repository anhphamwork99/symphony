// FILE: wallclock-tests.ts
// Purpose: single shared manifest of the wall-clock-sensitive pi-subagent
// suites. Consumed by BOTH `apps/server/vitest.config.ts` (project include/
// exclude) and `apps/server/scripts/run-tests.ts` (per-file standalone
// orchestration), so the two can never drift apart.
// Layer: test harness — do not import from product/runtime code.

/**
 * The wall-clock-sensitive pi-subagent suites asserting Decision 0006 §5's
 * `budget + 500 ms` detach envelope against real-Pi sessions.
 *
 * WP-08 owner adjudication (option A, 2026-08-17): vitest main-process
 * transform/module-graph work for heavy pending files puts a timing tail on
 * these suites in multi-file invocations even with per-file worker isolation.
 * Every file in this list must therefore be executed in its OWN standalone
 * `vitest run` process via `scripts/run-tests.ts`; the envelope must not be
 * widened. Do not add files here without per-file standalone verification, and
 * do not move these files out of the `wallclock` project without
 * re-adjudication (see the comment block in `apps/server/vitest.config.ts`).
 */
export const WALLCLOCK_TESTS: readonly string[] = [
  "src/provider/piSubagentForegroundAcceptance.test.ts",
  "src/provider/piSubagentForegroundReopen.test.ts",
  "src/provider/piSubagentForegroundLifecycle.test.ts",
  "src/provider/piSubagentRealExtension.test.ts",
  "src/provider/piSubagentProgressAcceptance.test.ts",
  "src/provider/piSubagentIntegratedAcceptance.test.ts",
  "src/provider/piSubagentCancellationAcceptance.test.ts",
  "src/provider/piSubagentTerminalAcceptance.test.ts",
  "src/provider/piSubagentRestartAcceptance.test.ts",
  "src/provider/piSubagentResumeAcceptance.test.ts",
  "src/provider/piSubagentCompletionOwnershipAcceptance.test.ts",
  "src/provider/piSubagentWatchdogAcceptance.test.ts",
  // Ticket 17 slice 1: the integrated real-Pi acceptance smoke (stages 0–2)
  // chains the production WS composition against the pinned Alfie extension;
  // its stage-2 `budget + 500 ms` detach envelope requires the same
  // standalone per-file wall-clock method as the suites above.
  "src/provider/piSubagentRealPiAcceptance.test.ts",
  "src/provider/piSubagentDesktopManagedRealPiAcceptance.test.ts",
  "src/provider/piSubagentDesktopProductionCompositionAcceptance.test.ts",
  "src/provider/piSubagentCanonicalIdentityAcceptance.test.ts",
  "src/provider/piSubagentLifecycleContainmentRealPiAcceptance.test.ts",
];
