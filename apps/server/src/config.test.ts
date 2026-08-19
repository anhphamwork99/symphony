// FILE: config.test.ts
// Purpose: Verifies pure server configuration path derivation helpers, plus the
//          realpath canonicalization applied to homeDir/chatWorkspaceRoot/
//          studioWorkspaceRoot so reported roots match the REALPATH-canonicalized
//          roots stored on project rows (see wsRpc.ts's
//          canonicalizeProjectWorkspaceRoot).

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect } from "effect";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS,
  DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ,
  DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
  DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT,
  MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  MAX_PI_SUBAGENT_LEASE_DURATION_MS,
  MAX_PI_SUBAGENT_PROGRESS_RATE_HZ,
  MAX_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
  MAX_PI_SUBAGENT_CANCEL_RETRY_LIMIT,
  MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  MIN_PI_SUBAGENT_LEASE_DURATION_MS,
  MIN_PI_SUBAGENT_PROGRESS_RATE_HZ,
  MIN_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
  MIN_PI_SUBAGENT_CANCEL_RETRY_LIMIT,
  DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT,
  MAX_PI_SUBAGENT_COMPLETION_RETRY_LIMIT,
  MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  MIN_PI_SUBAGENT_COMPLETION_RETRY_LIMIT,
  resolvePiSubagentCompletionRetryLimit,
  DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
  MIN_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
  MAX_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
  resolvePiSubagentCompletionBatchWindowMs,
  DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES,
  MIN_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES,
  MAX_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES,
  resolvePiSubagentCompletionMaxBatchEntries,
  MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
  resolvePiSubagentTerminalSummaryMaxChars,
  DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS,
  MIN_PI_SUBAGENT_ORPHAN_AFTER_MS,
  MAX_PI_SUBAGENT_ORPHAN_AFTER_MS,
  resolvePiSubagentOrphanAfterMs,
  DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY,
  MIN_PI_SUBAGENT_PROVIDER_CONCURRENCY,
  MAX_PI_SUBAGENT_PROVIDER_CONCURRENCY,
  resolvePiSubagentProviderConcurrency,
  DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP,
  MIN_PI_SUBAGENT_SERVER_QUEUE_CAP,
  MAX_PI_SUBAGENT_SERVER_QUEUE_CAP,
  resolvePiSubagentServerQueueCap,
  DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP,
  MIN_PI_SUBAGENT_PROJECT_QUEUE_CAP,
  MAX_PI_SUBAGENT_PROJECT_QUEUE_CAP,
  resolvePiSubagentProjectQueueCap,
  DEFAULT_PI_SUBAGENT_WALL_TIME_MS,
  MIN_PI_SUBAGENT_WALL_TIME_MS,
  MAX_PI_SUBAGENT_WALL_TIME_MS,
  resolvePiSubagentWallTimeMs,
  resolvePiSubagentWatchdogStageTimeoutMs,
  DEFAULT_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS,
  MIN_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS,
  MAX_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS,
  resolveCanonicalWorkspaceRoots,
  resolveDefaultChatWorkspaceRoot,
  resolveDefaultStudioWorkspaceRoot,
  resolvePiSubagentForegroundWaitMs,
  resolvePiSubagentHeartbeatIntervalMs,
  resolvePiSubagentLeaseDurationMs,
  resolvePiSubagentProgressRateHz,
  resolvePiSubagentCancelAckTimeoutMs,
  resolvePiSubagentCancelRetryLimit,
  resolveStaticDir,
} from "./config";

const tempDirs = new Set<string>();
const originalSynaraStaticDir = process.env.SYNARA_STATIC_DIR;

function makeTempDir(prefix = "synara-config-test-"): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
  if (originalSynaraStaticDir === undefined) {
    delete process.env.SYNARA_STATIC_DIR;
  } else {
    process.env.SYNARA_STATIC_DIR = originalSynaraStaticDir;
  }
});

describe("resolveStaticDir", () => {
  it("uses the desktop static snapshot exposed through the Synara environment", async () => {
    const snapshotDir = makeTempDir("synara-static-snapshot-test-");
    fs.writeFileSync(path.join(snapshotDir, "index.html"), "<main>Synara</main>");
    process.env.SYNARA_STATIC_DIR = snapshotDir;

    const resolved = await Effect.runPromise(
      resolveStaticDir().pipe(Effect.provide(NodeServices.layer)),
    );

    expect(resolved).toBe(path.resolve(snapshotDir));
  });
});

const runResolveCanonicalWorkspaceRoots = (input: {
  readonly homeDir: string;
  readonly platform?: NodeJS.Platform;
}) =>
  Effect.runPromise(resolveCanonicalWorkspaceRoots(input).pipe(Effect.provide(NodeServices.layer)));

describe("resolveDefaultChatWorkspaceRoot", () => {
  it("places the managed chat workspace under Documents/Synara on macOS and Linux", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/Users/tester",
        platform: "darwin",
      }),
    ).toBe("/Users/tester/Documents/Synara");
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "/home/tester",
        platform: "linux",
      }),
    ).toBe("/home/tester/Documents/Synara");
  });

  it("uses Windows separators when deriving the managed chat workspace on Windows", () => {
    expect(
      resolveDefaultChatWorkspaceRoot({
        homeDir: "C:\\Users\\tester",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\tester\\Documents\\Synara");
  });

  it("defaults to the current process platform when no platform is supplied", () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });

    try {
      expect(resolveDefaultChatWorkspaceRoot({ homeDir: "C:\\Users\\tester" })).toBe(
        "C:\\Users\\tester\\Documents\\Synara",
      );
    } finally {
      Object.defineProperty(process, "platform", originalPlatformDescriptor!);
    }
  });
});

describe("resolveDefaultStudioWorkspaceRoot", () => {
  it("places the Studio workspace under Documents/Synara/Studio on macOS and Linux", () => {
    expect(
      resolveDefaultStudioWorkspaceRoot({
        homeDir: "/Users/tester",
        platform: "darwin",
      }),
    ).toBe("/Users/tester/Documents/Synara/Studio");
    expect(
      resolveDefaultStudioWorkspaceRoot({
        homeDir: "/home/tester",
        platform: "linux",
      }),
    ).toBe("/home/tester/Documents/Synara/Studio");
  });

  it("uses Windows separators when deriving the Studio workspace on Windows", () => {
    expect(
      resolveDefaultStudioWorkspaceRoot({
        homeDir: "C:\\Users\\tester",
        platform: "win32",
      }),
    ).toBe("C:\\Users\\tester\\Documents\\Synara\\Studio");
  });
});

describe("resolveCanonicalWorkspaceRoots", () => {
  it("canonicalizes a symlinked home directory to match project row realpaths", async () => {
    const root = makeTempDir();
    const realHome = path.join(root, "real-home");
    fs.mkdirSync(realHome, { recursive: true });
    const symlinkedHome = path.join(root, "home-link");
    fs.symlinkSync(realHome, symlinkedHome, "dir");

    const result = await runResolveCanonicalWorkspaceRoots({
      homeDir: symlinkedHome,
      platform: "darwin",
    });

    const expectedHomeDir = fs.realpathSync(realHome);
    expect(result.homeDir).toBe(expectedHomeDir);
    // chatWorkspaceRoot/studioWorkspaceRoot don't exist yet under the resolved
    // home, so they must be re-derived from the canonicalized (symlink-free)
    // home rather than the raw, symlinked input.
    expect(result.chatWorkspaceRoot).toBe(path.join(expectedHomeDir, "Documents", "Synara"));
    expect(result.studioWorkspaceRoot).toBe(
      path.join(expectedHomeDir, "Documents", "Synara", "Studio"),
    );
  });

  it("canonicalizes the nearest existing ancestor when the workspace root itself does not exist yet", async () => {
    const root = makeTempDir();
    const realDocuments = path.join(root, "real-documents");
    fs.mkdirSync(realDocuments, { recursive: true });
    const homeDir = path.join(root, "home");
    fs.mkdirSync(homeDir, { recursive: true });
    // Symlink ~/Documents to a real directory elsewhere, matching the bug
    // report scenario (e.g. iCloud-managed Documents on macOS). Neither
    // Synara/ nor Synara/Studio exist yet underneath it.
    const symlinkedDocuments = path.join(homeDir, "Documents");
    fs.symlinkSync(realDocuments, symlinkedDocuments, "dir");

    const result = await runResolveCanonicalWorkspaceRoots({
      homeDir,
      platform: "darwin",
    });

    const expectedDocuments = fs.realpathSync(realDocuments);
    expect(result.homeDir).toBe(fs.realpathSync(homeDir));
    expect(result.chatWorkspaceRoot).toBe(path.join(expectedDocuments, "Synara"));
    expect(result.studioWorkspaceRoot).toBe(path.join(expectedDocuments, "Synara", "Studio"));
    expect(fs.existsSync(result.chatWorkspaceRoot)).toBe(false);
    expect(fs.existsSync(result.studioWorkspaceRoot)).toBe(false);

    // Once the lazily-created directory shows up on disk, realpath must agree
    // with the previously-reported (pre-creation) canonicalized root.
    fs.mkdirSync(result.studioWorkspaceRoot, { recursive: true });
    expect(fs.realpathSync(result.studioWorkspaceRoot)).toBe(result.studioWorkspaceRoot);
  });
});

describe("resolvePiSubagentForegroundWaitMs (Issue 22 / WP-02)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(10000);
    expect(MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(100);
    expect(MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS).toBe(60000);
  });

  describe("valid inputs (endpoints, interior values, trimming, signs)", () => {
    const validCases: Array<{ label: string; input: unknown; expected: number }> = [
      { label: "exact min endpoint (number)", input: 100, expected: 100 },
      { label: "exact min endpoint (string)", input: "100", expected: 100 },
      { label: "exact max endpoint (number)", input: 60000, expected: 60000 },
      { label: "exact max endpoint (string)", input: "60000", expected: 60000 },
      { label: "interior near min (number)", input: 101, expected: 101 },
      { label: "interior near min (string)", input: "101", expected: 101 },
      { label: "interior near max (number)", input: 59999, expected: 59999 },
      { label: "interior near max (string)", input: "59999", expected: 59999 },
      { label: "default value (number)", input: 10000, expected: 10000 },
      { label: "default value (string)", input: "10000", expected: 10000 },
      { label: "arbitrary interior 5000 (number)", input: 5000, expected: 5000 },
      { label: "arbitrary interior 5000 (string)", input: "5000", expected: 5000 },
      { label: "arbitrary interior 30000 (number)", input: 30000, expected: 30000 },
      { label: "arbitrary interior 30000 (string)", input: "30000", expected: 30000 },
      { label: "string with leading/trailing whitespace", input: "  15000  ", expected: 15000 },
      { label: "string with explicit positive sign", input: "+10000", expected: 10000 },
    ];

    for (const { label, input, expected } of validCases) {
      it(`resolves ${label}`, () => {
        expect(resolvePiSubagentForegroundWaitMs(input)).toBe(expected);
      });
    }
  });

  describe("invalid inputs (fallback to 10000 without clamping)", () => {
    const invalidCases: Array<{ label: string; input: unknown }> = [
      // Unset and empty
      { label: "undefined input", input: undefined },
      { label: "null input", input: null },
      { label: "empty string", input: "" },
      { label: "whitespace-only string", input: "   " },

      // Non-numeric strings and types
      { label: "alphanumeric string 'abc'", input: "abc" },
      { label: "unit-suffixed string '100ms'", input: "100ms" },
      { label: "underscore-separated string '10_000'", input: "10_000" },
      { label: "boolean string 'true'", input: "true" },
      { label: "boolean string 'false'", input: "false" },
      { label: "json object string '{}'", input: "{}" },
      { label: "boolean true", input: true },
      { label: "boolean false", input: false },
      { label: "plain object", input: {} },
      { label: "array", input: [10000] },

      // Non-finite values
      { label: "Infinity (number)", input: Infinity },
      { label: "-Infinity (number)", input: -Infinity },
      { label: "NaN (number)", input: NaN },
      { label: "'Infinity' (string)", input: "Infinity" },
      { label: "'-Infinity' (string)", input: "-Infinity" },
      { label: "'NaN' (string)", input: "NaN" },

      // Fractional values
      { label: "fractional 100.5 (number)", input: 100.5 },
      { label: "fractional 10000.1 (number)", input: 10000.1 },
      { label: "fractional '100.5' (string)", input: "100.5" },
      { label: "fractional '10000.1' (string)", input: "10000.1" },
      { label: "fractional '100.0' (string)", input: "100.0" },

      // Under-range values (must NOT clamp to 100)
      { label: "under-range 99 (number)", input: 99 },
      { label: "under-range '99' (string)", input: "99" },
      { label: "under-range 0 (number)", input: 0 },
      { label: "under-range '0' (string)", input: "0" },
      { label: "negative -1 (number)", input: -1 },
      { label: "negative '-1' (string)", input: "-1" },
      { label: "negative -100 (number)", input: -100 },
      { label: "negative '-100' (string)", input: "-100" },

      // Over-range values (must NOT clamp to 60000)
      { label: "over-range 60001 (number)", input: 60001 },
      { label: "over-range '60001' (string)", input: "60001" },
      { label: "over-range 100000 (number)", input: 100000 },
      { label: "over-range '100000' (string)", input: "100000" },
    ];

    for (const { label, input } of invalidCases) {
      it(`falls back to default 10000 for ${label}`, () => {
        expect(resolvePiSubagentForegroundWaitMs(input)).toBe(
          DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS,
        );
      });
    }
  });
});

describe("resolvePiSubagentProgressRateHz (Issue 23 / WP-B)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ).toBe(2);
    expect(MIN_PI_SUBAGENT_PROGRESS_RATE_HZ).toBe(0.1);
    expect(MAX_PI_SUBAGENT_PROGRESS_RATE_HZ).toBe(10);
  });

  describe("valid inputs", () => {
    const validCases: Array<{ label: string; input: unknown; expected: number }> = [
      { label: "exact min endpoint (number)", input: 0.1, expected: 0.1 },
      { label: "exact min endpoint (string)", input: "0.1", expected: 0.1 },
      { label: "exact max endpoint (number)", input: 10, expected: 10 },
      { label: "exact max endpoint (string)", input: "10", expected: 10 },
      { label: "default (number)", input: 2, expected: 2 },
      { label: "default (string)", input: "2", expected: 2 },
      { label: "fractional interior 2.5 (number)", input: 2.5, expected: 2.5 },
      { label: "fractional interior 2.5 (string)", input: "2.5", expected: 2.5 },
      { label: "leading-dot fractional '.5'", input: ".5", expected: 0.5 },
      { label: "trailing-dot fractional '2.'", input: "2.", expected: 2 },
      { label: "integer-valued float 4.0 (number)", input: 4.0, expected: 4 },
      { label: "whitespace-trimmed '  3  '", input: "  3  ", expected: 3 },
      { label: "explicit sign '+5'", input: "+5", expected: 5 },
    ];
    for (const { label, input, expected } of validCases) {
      it(`resolves ${label}`, () => {
        expect(resolvePiSubagentProgressRateHz(input)).toBe(expected);
      });
    }
  });

  describe("invalid inputs (fallback to 2 without clamping)", () => {
    const invalidCases: Array<{ label: string; input: unknown }> = [
      { label: "undefined input", input: undefined },
      { label: "null input", input: null },
      { label: "empty string", input: "" },
      { label: "whitespace-only string", input: "   " },
      { label: "alphanumeric string 'abc'", input: "abc" },
      { label: "unit-suffixed string '2hz'", input: "2hz" },
      { label: "hex string '0x2'", input: "0x2" },
      { label: "exponent string '2e1'", input: "2e1" },
      { label: "underscore string '1_0'", input: "1_0" },
      { label: "boolean true", input: true },
      { label: "plain object", input: {} },
      { label: "array", input: [2] },
      { label: "Infinity (number)", input: Infinity },
      { label: "NaN (number)", input: NaN },
      { label: "'Infinity' (string)", input: "Infinity" },
      { label: "'NaN' (string)", input: "NaN" },
      { label: "under-range 0.09 (number)", input: 0.09 },
      { label: "under-range '0.05' (string)", input: "0.05" },
      { label: "zero 0 (number)", input: 0 },
      { label: "negative -2 (number)", input: -2 },
      { label: "negative '-2' (string)", input: "-2" },
      { label: "over-range 10.1 (number)", input: 10.1 },
      { label: "over-range '11' (string)", input: "11" },
      { label: "over-range 1000 (number)", input: 1000 },
    ];
    for (const { label, input } of invalidCases) {
      it(`falls back to default 2 for ${label}`, () => {
        expect(resolvePiSubagentProgressRateHz(input)).toBe(DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ);
      });
    }
  });
});

describe("resolvePiSubagentHeartbeatIntervalMs (Issue 23 / WP-B)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS).toBe(10000);
    expect(MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS).toBe(100);
    expect(MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS).toBe(600000);
  });

  describe("valid inputs", () => {
    const validCases: Array<{ label: string; input: unknown; expected: number }> = [
      { label: "exact min endpoint (number)", input: 100, expected: 100 },
      { label: "exact min endpoint (string)", input: "100", expected: 100 },
      { label: "exact max endpoint (number)", input: 600000, expected: 600000 },
      { label: "exact max endpoint (string)", input: "600000", expected: 600000 },
      { label: "default (number)", input: 10000, expected: 10000 },
      { label: "default (string)", input: "10000", expected: 10000 },
      { label: "interior 5000 (number)", input: 5000, expected: 5000 },
      { label: "interior 5000 (string)", input: "5000", expected: 5000 },
      { label: "whitespace-trimmed '  15000  '", input: "  15000  ", expected: 15000 },
      { label: "explicit sign '+30000'", input: "+30000", expected: 30000 },
    ];
    for (const { label, input, expected } of validCases) {
      it(`resolves ${label}`, () => {
        expect(resolvePiSubagentHeartbeatIntervalMs(input)).toBe(expected);
      });
    }
  });

  describe("invalid inputs (fallback to 10000 without clamping)", () => {
    const invalidCases: Array<{ label: string; input: unknown }> = [
      { label: "undefined input", input: undefined },
      { label: "null input", input: null },
      { label: "empty string", input: "" },
      { label: "whitespace-only string", input: "   " },
      { label: "alphanumeric string 'abc'", input: "abc" },
      { label: "unit-suffixed string '10000ms'", input: "10000ms" },
      { label: "underscore string '10_000'", input: "10_000" },
      { label: "boolean true", input: true },
      { label: "plain object", input: {} },
      { label: "Infinity (number)", input: Infinity },
      { label: "NaN (number)", input: NaN },
      { label: "fractional 10000.5 (number)", input: 10000.5 },
      { label: "fractional '100.5' (string)", input: "100.5" },
      { label: "under-range 99 (number)", input: 99 },
      { label: "under-range '99' (string)", input: "99" },
      { label: "zero 0 (number)", input: 0 },
      { label: "negative -1 (number)", input: -1 },
      { label: "over-range 600001 (number)", input: 600001 },
      { label: "over-range '600001' (string)", input: "600001" },
      { label: "over-range 1000000 (number)", input: 1000000 },
    ];
    for (const { label, input } of invalidCases) {
      it(`falls back to default 10000 for ${label}`, () => {
        expect(resolvePiSubagentHeartbeatIntervalMs(input)).toBe(
          DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
        );
      });
    }
  });
});

describe("resolvePiSubagentLeaseDurationMs (Issue 23 / WP-B)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS).toBe(30000);
    expect(MIN_PI_SUBAGENT_LEASE_DURATION_MS).toBe(1000);
    expect(MAX_PI_SUBAGENT_LEASE_DURATION_MS).toBe(3600000);
  });

  describe("valid inputs", () => {
    const validCases: Array<{ label: string; input: unknown; expected: number }> = [
      { label: "exact min endpoint (number)", input: 1000, expected: 1000 },
      { label: "exact min endpoint (string)", input: "1000", expected: 1000 },
      { label: "exact max endpoint (number)", input: 3600000, expected: 3600000 },
      { label: "exact max endpoint (string)", input: "3600000", expected: 3600000 },
      { label: "default (number)", input: 30000, expected: 30000 },
      { label: "default (string)", input: "30000", expected: 30000 },
      { label: "interior 120000 (number)", input: 120000, expected: 120000 },
      { label: "interior 120000 (string)", input: "120000", expected: 120000 },
      { label: "whitespace-trimmed '  45000  '", input: "  45000  ", expected: 45000 },
      { label: "explicit sign '+60000'", input: "+60000", expected: 60000 },
    ];
    for (const { label, input, expected } of validCases) {
      it(`resolves ${label}`, () => {
        expect(resolvePiSubagentLeaseDurationMs(input)).toBe(expected);
      });
    }
  });

  describe("invalid inputs (fallback to 30000 without clamping)", () => {
    const invalidCases: Array<{ label: string; input: unknown }> = [
      { label: "undefined input", input: undefined },
      { label: "null input", input: null },
      { label: "empty string", input: "" },
      { label: "whitespace-only string", input: "   " },
      { label: "alphanumeric string 'abc'", input: "abc" },
      { label: "unit-suffixed string '30s'", input: "30s" },
      { label: "underscore string '30_000'", input: "30_000" },
      { label: "boolean true", input: true },
      { label: "plain object", input: {} },
      { label: "Infinity (number)", input: Infinity },
      { label: "NaN (number)", input: NaN },
      { label: "fractional 30000.5 (number)", input: 30000.5 },
      { label: "fractional '1000.5' (string)", input: "1000.5" },
      { label: "under-range 999 (number)", input: 999 },
      { label: "under-range '999' (string)", input: "999" },
      { label: "zero 0 (number)", input: 0 },
      { label: "negative -1000 (number)", input: -1000 },
      { label: "over-range 3600001 (number)", input: 3600001 },
      { label: "over-range '3600001' (string)", input: "3600001" },
      { label: "over-range 7200000 (number)", input: 7200000 },
    ];
    for (const { label, input } of invalidCases) {
      it(`falls back to default 30000 for ${label}`, () => {
        expect(resolvePiSubagentLeaseDurationMs(input)).toBe(DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS);
      });
    }
  });
});

describe("resolvePiSubagentCancelAckTimeoutMs (Issue 06)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS).toBe(5000);
    expect(MIN_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS).toBe(100);
    expect(MAX_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS).toBe(60000);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentCancelAckTimeoutMs(undefined)).toBe(5000);
    expect(resolvePiSubagentCancelAckTimeoutMs(100)).toBe(100);
    expect(resolvePiSubagentCancelAckTimeoutMs("100")).toBe(100);
    expect(resolvePiSubagentCancelAckTimeoutMs(60000)).toBe(60000);
    expect(resolvePiSubagentCancelAckTimeoutMs("  2500  ")).toBe(2500);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [
      null,
      "",
      "abc",
      "5000ms",
      true,
      {},
      Infinity,
      NaN,
      5000.5,
      99,
      60001,
      -1,
    ]) {
      expect(resolvePiSubagentCancelAckTimeoutMs(input)).toBe(
        DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
      );
    }
  });
});

describe("resolvePiSubagentCancelRetryLimit (Issue 06)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT).toBe(2);
    expect(MIN_PI_SUBAGENT_CANCEL_RETRY_LIMIT).toBe(0);
    expect(MAX_PI_SUBAGENT_CANCEL_RETRY_LIMIT).toBe(5);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentCancelRetryLimit(undefined)).toBe(2);
    expect(resolvePiSubagentCancelRetryLimit(0)).toBe(0);
    expect(resolvePiSubagentCancelRetryLimit("0")).toBe(0);
    expect(resolvePiSubagentCancelRetryLimit(5)).toBe(5);
    expect(resolvePiSubagentCancelRetryLimit("3")).toBe(3);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [null, "", "abc", "2x", true, {}, Infinity, NaN, 2.5, -1, 6]) {
      expect(resolvePiSubagentCancelRetryLimit(input)).toBe(DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT);
    }
  });
});

describe("resolvePiSubagentCompletionRetryLimit (Issue 08)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT).toBe(5);
    expect(MIN_PI_SUBAGENT_COMPLETION_RETRY_LIMIT).toBe(0);
    expect(MAX_PI_SUBAGENT_COMPLETION_RETRY_LIMIT).toBe(100);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentCompletionRetryLimit(undefined)).toBe(5);
    expect(resolvePiSubagentCompletionRetryLimit(0)).toBe(0);
    expect(resolvePiSubagentCompletionRetryLimit("0")).toBe(0);
    expect(resolvePiSubagentCompletionRetryLimit(100)).toBe(100);
    expect(resolvePiSubagentCompletionRetryLimit("7")).toBe(7);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [null, "", "abc", "3x", true, {}, Infinity, NaN, 2.5, -1, 101]) {
      expect(resolvePiSubagentCompletionRetryLimit(input)).toBe(
        DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT,
      );
    }
  });
});

describe("resolvePiSubagentCompletionBatchWindowMs (Issue 09)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS).toBe(2000);
    expect(MIN_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS).toBe(0);
    expect(MAX_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS).toBe(30000);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentCompletionBatchWindowMs(undefined)).toBe(2000);
    expect(resolvePiSubagentCompletionBatchWindowMs(0)).toBe(0);
    expect(resolvePiSubagentCompletionBatchWindowMs("0")).toBe(0);
    expect(resolvePiSubagentCompletionBatchWindowMs(30000)).toBe(30000);
    expect(resolvePiSubagentCompletionBatchWindowMs("500")).toBe(500);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [null, "", "abc", "3x", true, {}, Infinity, NaN, 2.5, -1, 30001]) {
      expect(resolvePiSubagentCompletionBatchWindowMs(input)).toBe(
        DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS,
      );
    }
  });
});

describe("resolvePiSubagentProviderConcurrency (Issue 13 / T13-AC1, T13-AC7)", () => {
  it("exports the compatibility default of four running agents per provider session", () => {
    expect(DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY).toBe(4);
    expect(MIN_PI_SUBAGENT_PROVIDER_CONCURRENCY).toBe(1);
    expect(MAX_PI_SUBAGENT_PROVIDER_CONCURRENCY).toBe(64);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentProviderConcurrency(undefined)).toBe(4);
    expect(resolvePiSubagentProviderConcurrency(1)).toBe(1);
    expect(resolvePiSubagentProviderConcurrency("1")).toBe(1);
    expect(resolvePiSubagentProviderConcurrency(64)).toBe(64);
    expect(resolvePiSubagentProviderConcurrency(" 8 ")).toBe(8);
    expect(resolvePiSubagentProviderConcurrency("+8")).toBe(8);
  });

  it("falls back to the default without clamping for invalid inputs (no unlimited concurrency)", () => {
    for (const input of [null, "", "abc", true, {}, Infinity, NaN, 2.5, 0, -1, 65]) {
      expect(resolvePiSubagentProviderConcurrency(input)).toBe(
        DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY,
      );
    }
  });
});

describe("resolvePiSubagentCompletionMaxBatchEntries (Decision 0016)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES).toBe(8);
    expect(MIN_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES).toBe(1);
    expect(MAX_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES).toBe(64);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentCompletionMaxBatchEntries(undefined)).toBe(8);
    expect(resolvePiSubagentCompletionMaxBatchEntries(null)).toBe(8);
    expect(resolvePiSubagentCompletionMaxBatchEntries(1)).toBe(1);
    expect(resolvePiSubagentCompletionMaxBatchEntries("1")).toBe(1);
    expect(resolvePiSubagentCompletionMaxBatchEntries(64)).toBe(64);
    expect(resolvePiSubagentCompletionMaxBatchEntries("64")).toBe(64);
    expect(resolvePiSubagentCompletionMaxBatchEntries(16)).toBe(16);
    expect(resolvePiSubagentCompletionMaxBatchEntries("16")).toBe(16);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of ["", "abc", "3x", true, {}, Infinity, NaN, 2.5, 0, -1, 65, 100]) {
      expect(resolvePiSubagentCompletionMaxBatchEntries(input)).toBe(
        DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES,
      );
    }
  });
});

describe("resolvePiSubagentServerQueueCap (Issue 13 / T13-AC1, T13-AC7)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP).toBe(64);
    expect(MIN_PI_SUBAGENT_SERVER_QUEUE_CAP).toBe(1);
    expect(MAX_PI_SUBAGENT_SERVER_QUEUE_CAP).toBe(1024);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentServerQueueCap(undefined)).toBe(64);
    expect(resolvePiSubagentServerQueueCap(1)).toBe(1);
    expect(resolvePiSubagentServerQueueCap("1")).toBe(1);
    expect(resolvePiSubagentServerQueueCap(1024)).toBe(1024);
    expect(resolvePiSubagentServerQueueCap("128")).toBe(128);
  });

  it("falls back to the default without clamping for invalid inputs (no unlimited queueing)", () => {
    for (const input of [null, "", "x1", false, {}, Infinity, NaN, 1.5, 0, -4, 1025]) {
      expect(resolvePiSubagentServerQueueCap(input)).toBe(DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP);
    }
  });
});

describe("resolvePiSubagentProjectQueueCap (Issue 13 / T13-AC1, T13-AC7)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP).toBe(16);
    expect(MIN_PI_SUBAGENT_PROJECT_QUEUE_CAP).toBe(1);
    expect(MAX_PI_SUBAGENT_PROJECT_QUEUE_CAP).toBe(256);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentProjectQueueCap(undefined)).toBe(16);
    expect(resolvePiSubagentProjectQueueCap(1)).toBe(1);
    expect(resolvePiSubagentProjectQueueCap("1")).toBe(1);
    expect(resolvePiSubagentProjectQueueCap(256)).toBe(256);
    expect(resolvePiSubagentProjectQueueCap(" 32 ")).toBe(32);
  });

  it("falls back to the default without clamping for invalid inputs (no unlimited queueing)", () => {
    for (const input of [null, "", "abc", true, {}, Infinity, NaN, 0.5, 0, -1, 257]) {
      expect(resolvePiSubagentProjectQueueCap(input)).toBe(DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP);
    }
  });
});

describe("resolvePiSubagentWallTimeMs (Issue 13 / T13-AC3, T13-AC7)", () => {
  it("exports the two-hour default wall-time budget", () => {
    expect(DEFAULT_PI_SUBAGENT_WALL_TIME_MS).toBe(7200000);
    expect(MIN_PI_SUBAGENT_WALL_TIME_MS).toBe(60000);
    expect(MAX_PI_SUBAGENT_WALL_TIME_MS).toBe(86400000);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentWallTimeMs(undefined)).toBe(7200000);
    expect(resolvePiSubagentWallTimeMs(60000)).toBe(60000);
    expect(resolvePiSubagentWallTimeMs("60000")).toBe(60000);
    expect(resolvePiSubagentWallTimeMs(86400000)).toBe(86400000);
    expect(resolvePiSubagentWallTimeMs("3600000")).toBe(3600000);
  });

  it("falls back to the default without clamping for invalid inputs (no unlimited wall time)", () => {
    for (const input of [null, "", "abc", true, {}, Infinity, NaN, 5999.5, 59999, 86400001]) {
      expect(resolvePiSubagentWallTimeMs(input)).toBe(DEFAULT_PI_SUBAGENT_WALL_TIME_MS);
    }
  });
});

describe("resolvePiSubagentWatchdogStageTimeoutMs (Issue 15 / T15-AC1)", () => {
  it("exports the expected bounds and default constants (10s stage bound)", () => {
    expect(DEFAULT_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS).toBe(10000);
    expect(MIN_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS).toBe(100);
    expect(MAX_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS).toBe(60000);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentWatchdogStageTimeoutMs(undefined)).toBe(10000);
    expect(resolvePiSubagentWatchdogStageTimeoutMs(100)).toBe(100);
    expect(resolvePiSubagentWatchdogStageTimeoutMs("100")).toBe(100);
    expect(resolvePiSubagentWatchdogStageTimeoutMs(60000)).toBe(60000);
    expect(resolvePiSubagentWatchdogStageTimeoutMs("5000")).toBe(5000);
  });

  it("falls back to the default without clamping for invalid inputs (bounded stages always)", () => {
    for (const input of [null, "", "abc", true, {}, Infinity, NaN, 99.5, 99, 60001]) {
      expect(resolvePiSubagentWatchdogStageTimeoutMs(input)).toBe(
        DEFAULT_PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_MS,
      );
    }
  });
});

describe("resolvePiSubagentOrphanAfterMs (Issue 10)", () => {
  it("exports the expected bounds and default constants (~60s initial threshold)", () => {
    expect(DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS).toBe(60000);
    expect(MIN_PI_SUBAGENT_ORPHAN_AFTER_MS).toBe(1000);
    expect(MAX_PI_SUBAGENT_ORPHAN_AFTER_MS).toBe(3600000);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentOrphanAfterMs(undefined)).toBe(60000);
    expect(resolvePiSubagentOrphanAfterMs(1000)).toBe(1000);
    expect(resolvePiSubagentOrphanAfterMs("1000")).toBe(1000);
    expect(resolvePiSubagentOrphanAfterMs(3600000)).toBe(3600000);
    expect(resolvePiSubagentOrphanAfterMs("120000")).toBe(120000);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [null, "", "abc", "3x", true, {}, Infinity, NaN, 2.5, 999, 3600001]) {
      expect(resolvePiSubagentOrphanAfterMs(input)).toBe(DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS);
    }
  });
});

describe("resolvePiSubagentTerminalSummaryMaxChars (Issue 07)", () => {
  it("exports the expected bounds and default constants", () => {
    expect(DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS).toBe(2000);
    expect(MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS).toBe(64);
    expect(MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS).toBe(32768);
  });

  it("resolves valid endpoint and interior values, both input types", () => {
    expect(resolvePiSubagentTerminalSummaryMaxChars(undefined)).toBe(2000);
    expect(resolvePiSubagentTerminalSummaryMaxChars(64)).toBe(64);
    expect(resolvePiSubagentTerminalSummaryMaxChars("64")).toBe(64);
    expect(resolvePiSubagentTerminalSummaryMaxChars(32768)).toBe(32768);
    expect(resolvePiSubagentTerminalSummaryMaxChars(" 1500 ")).toBe(1500);
  });

  it("falls back to the default without clamping for invalid inputs", () => {
    for (const input of [
      null,
      "",
      "abc",
      "2000chars",
      true,
      {},
      Infinity,
      NaN,
      2000.5,
      63,
      32769,
      -1,
    ]) {
      expect(resolvePiSubagentTerminalSummaryMaxChars(input)).toBe(
        DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS,
      );
    }
  });
});
