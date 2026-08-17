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
  MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  resolveCanonicalWorkspaceRoots,
  resolveDefaultChatWorkspaceRoot,
  resolveDefaultStudioWorkspaceRoot,
  resolvePiSubagentForegroundWaitMs,
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
        expect(resolvePiSubagentForegroundWaitMs(input)).toBe(DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS);
      });
    }
  });
});

