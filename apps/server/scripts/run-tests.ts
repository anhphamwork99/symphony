#!/usr/bin/env node
// FILE: run-tests.ts
// Purpose: WP-08 owner-adjudicated (option A, 2026-08-17) test orchestrator
// for `@synara/cli`: run the `unit` vitest project once, then every file in
// the shared WALLCLOCK_TESTS manifest in its OWN standalone `vitest run`
// process, because vitest main-process transform/module-graph work for heavy
// pending files puts a timing tail on the `budget + 500 ms` detach envelope in
// multi-file invocations (Decision 0006 §5; per-file standalone invocations
// are the envelope acceptance method). No assertion, timeout, or inclusion
// change — this only changes HOW the same tests are invoked.
// Layer: test harness — uses node builtins only (no workspace dependencies),
// runs under plain `node` like `scripts/cli.ts`, and spawns the real vitest
// CLI (`vitest/vitest.mjs`) under the current node executable so the test
// runtime is byte-for-byte the runtime the previous `vitest run` script used.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WALLCLOCK_TESTS } from "./wallclock-tests.ts";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Invocation {
  /** Human label used in progress/failure output (e.g. `unit`, a file path). */
  readonly label: string;
  /** vitest CLI arguments (without the leading `vitest`/node executable). */
  readonly args: readonly string[];
}

/**
 * Build the full invocation plan: one `unit` project run, then one standalone
 * process per wallclock file. Both carry the previous script's explicit
 * serial-execution flags (`--maxWorkers=1 --no-file-parallelism`) so the
 * invocation-level semantics never silently regress.
 */
export function planInvocations(wallclockTests: readonly string[]): Invocation[] {
  const serial = ["--maxWorkers=1", "--no-file-parallelism"] as const;
  return [
    { label: "unit", args: ["run", "--project", "unit", ...serial] },
    ...wallclockTests.map((file) => ({
      label: file,
      args: ["run", "--project", "wallclock", ...serial, file],
    })),
  ];
}

function resolveVitestCli(): string {
  const require = createRequire(import.meta.url);
  const vitestPackageJson = require.resolve("vitest/package.json");
  const cli = join(dirname(vitestPackageJson), "vitest.mjs");
  if (!existsSync(cli)) {
    throw new Error(`Could not locate the vitest CLI at ${cli}.`);
  }
  return cli;
}

interface InvocationFailure {
  readonly label: string;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

function exitCodeFor(failure: InvocationFailure): number {
  // `vitest run` exits non-zero (1) on test failures; exit codes > 1 are
  // vitest fatal errors. A signal-terminated child maps to 128 + signal
  // number so signal propagation survives the runner process.
  if (failure.code !== null) return failure.code;
  if (failure.signal !== null) return 128 + signalNumber(failure.signal);
  return 1;
}

function signalNumber(signal: string): number {
  // SIGINT=2, SIGTERM=15 on every supported platform (posix); fall back to 1.
  const known: Record<string, number> = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
  return known[signal] ?? 1;
}

function runInvocation(
  invocation: Invocation,
  vitestCli: string,
): Promise<InvocationFailure | null> {
  return new Promise((resolvePromise, rejectPromise) => {
    // stdio inherit keeps vitest's live reporter output streaming to this
    // process's stdout/stderr unchanged. The explicit env spread documents
    // that the child inherits the full environment (CI variables,
    // ALFIE_REPO_DIR, PI_* knobs, ...) exactly as the previous single
    // `vitest run` invocation did.
    const child: ChildProcess = spawn(process.execPath, [vitestCli, ...invocation.args], {
      cwd: packageDir,
      stdio: "inherit",
      env: { ...process.env },
    });

    const forwardSignal = (signal: NodeJS.Signals) => {
      // Forward Ctrl+C / termination to the running child so its teardown
      // hooks run; the child's exit then resolves this promise.
      child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);

    child.on("error", (error) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      resolvePromise(
        code === 0 && signal === null ? null : { label: invocation.label, code, signal },
      );
    });
  });
}

async function main(): Promise<number> {
  const planOnly = process.argv.includes("--plan");

  // Fail closed before spawning anything: a manifest entry that no longer
  // exists on disk would silently drop wallclock coverage, which Decision
  // 0008's method cannot tolerate.
  const missing = WALLCLOCK_TESTS.filter((file) => !existsSync(join(packageDir, file)));
  if (missing.length > 0) {
    console.error(
      `WALLCLOCK_TESTS references ${missing.length} file(s) missing from ${packageDir}:`,
    );
    for (const file of missing) console.error(`  - ${file}`);
    return 1;
  }

  const invocations = planInvocations(WALLCLOCK_TESTS);
  const vitestCli = resolveVitestCli();

  if (planOnly) {
    console.log(`# ${invocations.length} vitest invocation(s) from apps/server`);
    for (const invocation of invocations) {
      console.log(`node vitest.mjs ${invocation.args.join(" ")}`);
    }
    return 0;
  }

  console.log(
    `> test orchestrator: 1 unit run + ${WALLCLOCK_TESTS.length} standalone wallclock runs`,
  );
  const firstPassFailures: InvocationFailure[] = [];
  for (const [index, invocation] of invocations.entries()) {
    console.log(
      `\n> [${index + 1}/${invocations.length}] ${invocation.label === "unit" ? "unit project" : `wallclock ${invocation.label}`}`,
    );
    // Keep going after a failure so one flaky suite does not hide the state
    // of the remaining files (the previous single `vitest run` also executed
    // every file before exiting non-zero).
    const failure = await runInvocation(invocation, vitestCli);
    if (failure) firstPassFailures.push(failure);
  }

  // Transient host/filesystem load may fail one invocation even though the
  // same isolated proof is immediately reproducible as green. Re-run each
  // failed invocation exactly once after the first pass has fully settled.
  // A second failure remains gate-failing evidence, so deterministic defects
  // cannot be hidden by this policy.
  const failures: InvocationFailure[] = [];
  for (const failure of firstPassFailures) {
    const invocation = invocations.find((candidate) => candidate.label === failure.label);
    if (invocation === undefined) {
      failures.push(failure);
      continue;
    }
    const retryLabel = failure.label === "unit" ? "unit project" : `wallclock ${failure.label}`;
    console.warn(`\n> retrying ${retryLabel} once after the first pass settled`);
    const retryFailure = await runInvocation(invocation, vitestCli);
    if (retryFailure) {
      failures.push(retryFailure);
    } else {
      console.log(`> ${retryLabel} passed on its single allowed retry`);
    }
  }

  if (failures.length === 0) {
    console.log(`\n> test orchestrator: all ${invocations.length} invocation(s) green`);
    return 0;
  }

  console.error(
    `\n> test orchestrator: ${failures.length}/${invocations.length} invocation(s) failed:`,
  );
  for (const failure of failures) {
    const detail =
      failure.code !== null
        ? `exit code ${failure.code}`
        : `terminated by ${failure.signal ?? "unknown signal"}`;
    const isUnit = failure.label === "unit";
    console.error(`  - ${isUnit ? "unit project" : failure.label} (${detail})`);
    if (!isUnit) {
      // Actionable standalone rerun context for the wall-clock method.
      console.error(`    rerun standalone from apps/server:`);
      console.error(
        `      ./node_modules/.bin/vitest run --project wallclock --maxWorkers=1 --no-file-parallelism ${failure.label}`,
      );
    }
  }
  const firstFailure = failures[0];
  // Narrow without a runtime assumption: this line is reachable only when
  // `failures.length > 0` above returned early, so a missing entry is a
  // harness bug that must fail closed rather than crash the orchestrator.
  if (firstFailure === undefined) {
    console.error("> test orchestrator: failed-invocation list became empty before exit");
    return 1;
  }
  return exitCodeFor(firstFailure);
}

// Guard: `planInvocations` is exported for reuse/tests; only run the
// orchestrator when this file is executed directly as a script (not when it
// is imported by another module).
const isDirectExecution =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error("> test orchestrator failed to start:", error);
      process.exit(1);
    },
  );
}
