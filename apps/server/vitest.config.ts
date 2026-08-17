import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

// Ticket 22 remediation (WP-08): the wall-clock-sensitive pi-subagent suites
// assert Decision 0006 §5's `budget + 500 ms` detach envelope against real-Pi
// sessions. These four files run in the `wallclock` project while everything
// else stays in `unit`; the groups execute strictly sequentially with
// wallclock first. No assertion or timeout was widened; Decision 0006 is
// unchanged.
//
// WP-08's challenge evidence (2026-08-17, /tmp copy preserved in the ticket)
// proved two things: (1) vitest 4's default `forks` pool + `isolate: true`
// already gave every file its own child process under the old serial script,
// so the original same-worker attribution was wrong; (2) the envelope tail in
// multi-file invocations comes from vitest MAIN-process transform/module-graph
// work for heavy pending files (acceptance standalone: 7/7 green; same file
// first-executed in a 4-file invocation: 10/17 fail at 930–1119 ms; 3 tiny
// dummy pending files: 3/3 green). Owner adjudication (option A, 2026-08-17):
// keep this isolation config as a strict harness improvement, and verify the
// envelope via per-file standalone invocations. Do not widen the envelope or
// remove these files from this project without re-adjudication.
const WALLCLOCK_TESTS = [
  "src/provider/piSubagentForegroundAcceptance.test.ts",
  "src/provider/piSubagentForegroundReopen.test.ts",
  "src/provider/piSubagentForegroundLifecycle.test.ts",
  "src/provider/piSubagentRealExtension.test.ts",
  "src/provider/piSubagentProgressAcceptance.test.ts",
];

const wallclockProject = defineConfig({
  test: {
    name: "wallclock",
    include: WALLCLOCK_TESTS,
    // Each file gets its own forked runner process (vitest 4 defaults to the
    // `forks` pool with `isolate: true`); the files execute strictly one at a
    // time so teardown from an adjacent file can settle before the next one
    // starts.
    maxWorkers: 1,
    // `unit` and `wallclock` must not interleave: distinct groupOrder values
    // make the vitest scheduler run the groups strictly sequentially. The
    // wallclock project runs first (lower groupOrder) because the start of a
    // run has no adjacent teardown settling yet — the same clean state that
    // made standalone-file invocations meet the envelope in WP-07's
    // measurements.
    sequence: { groupOrder: 1 },
    // Server integration tests exercise sqlite/git orchestration and can
    // legitimately exceed the default timeout when the full workspace suite
    // is running under CI load.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});

const unitProject = defineConfig({
  test: {
    name: "unit",
    // `integration/**` was accidentally dropped from discovery by the first
    // WP-08 project split (reviewer finding M1: full-suite file count fell
    // 371 -> 365, silently skipping ~30 integration tests). Keep it included.
    include: ["src/**/*.test.ts", "integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", ...WALLCLOCK_TESTS.map((file) => `**/${file}`)],
    maxWorkers: 1,
    sequence: { groupOrder: 2 },
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // Preserve the serial semantics of the previous
      // `vitest run --maxWorkers=1 --no-file-parallelism` invocation at the
      // root level as well, so direct `vitest run` calls (without the
      // package.json script) stay one-file-at-a-time too.
      maxWorkers: 1,
      fileParallelism: false,
      projects: [unitProject, wallclockProject],
    },
  }),
);
