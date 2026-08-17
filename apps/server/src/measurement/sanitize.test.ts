// FILE: sanitize.test.ts
// Purpose: Focused tests for the report-surface sanitization (Decision 34
// §3/§5): committed output must never contain raw sensitive paths or
// credential-shaped values. Covers home/temp/other POSIX/Windows absolute
// paths, relative paths, embedded paths in failure strings, and a deep
// report-surface assertion over a representative serialized report.
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  redactCredentialShapes,
  sanitizeFailureForReport,
  sanitizePathForReport,
} from "./sanitize.ts";

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/** True when `child` is exactly `parent` or starts with `parent` + a separator. */
function isUnder(child: string, parent: string): boolean {
  const normalized = stripTrailingSeparators(parent);
  return (
    child === normalized ||
    child.startsWith(normalized + "/") ||
    child.startsWith(normalized + "\\")
  );
}

/**
 * Deep report-surface violation scan over a serialized report (JSON text).
 * Returns every raw absolute path found: raw home/temp roots (as substrings),
 * POSIX absolute paths, Windows drive-letter paths (including JSON-escaped
 * "C:\\dir" forms), and UNC paths (including JSON-escaped "\\\\server\\share"
 * forms). An empty result means the serialized surface is safe to commit.
 */
function findRawAbsolutePathViolations(serialized: string): string[] {
  const violations: string[] = [];
  const home = os.homedir();
  const tmp = os.tmpdir();
  if (home.length > 1 && serialized.includes(home)) {
    violations.push(`raw home path: ${home}`);
  }
  if (tmp.length > 1 && serialized.includes(tmp)) {
    violations.push(`raw temp path: ${tmp}`);
  }
  const posixPattern = /(?<![A-Za-z0-9_\-./~>])\/(?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]+/g;
  for (const match of serialized.matchAll(posixPattern)) {
    violations.push(`POSIX absolute path: ${match[0]}`);
  }
  const drivePattern = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]{1,2}(?![\\/])/g;
  for (const match of serialized.matchAll(drivePattern)) {
    violations.push(`Windows drive path: ${match[0]}`);
  }
  // Separator between UNC segments may be doubled in JSON-escaped text
  // ("\\\\server\\share"), so accept one or two backslashes.
  const uncPattern = /(?<![A-Za-z0-9])\\{2,}[^\\\s"']+\\{1,2}[^\\\s"']+/g;
  for (const match of serialized.matchAll(uncPattern)) {
    violations.push(`UNC path: ${match[0]}`);
  }
  return violations;
}

/** Representative committed-report shape (Decision 34 §1/§3/§5 surface). */
function buildRepresentativeReport(): unknown {
  const home = os.homedir();
  const tmp = os.tmpdir();
  const workspaceRoot = path.join(tmp, "synara-token-overhead-ws-0-abc123");
  const agentDir = path.join(home, ".pi", "agent");
  const manifestDir = path.join(home, ".local", "share", "synara", "manifests");
  return {
    reportVersion: 1,
    harnessVersion: "1.0.0",
    createdAt: "2026-08-15T00:00:00.000Z",
    git: { commit: "0fa26ba4", branch: "main", dirty: false },
    config: {
      repetitions: 3,
      turnsPerRepetition: 2,
      model: "gpt-5.6-sol",
      thinkingLevel: "high",
      agentDir: sanitizePathForReport(agentDir),
      localManifestDir: sanitizePathForReport(manifestDir),
      fixtureDigest: "a".repeat(64),
      fixtureGitCommit: "b".repeat(40),
    },
    runSets: {
      standalone: {
        config: { mode: "standalone", repetitions: 3, turnsPerRepetition: 2 },
        summary: {
          validRepetitions: [1, 2, 3],
          invalidRepetitions: [],
          components: { total: { mean: 100, min: 90, max: 110, values: [90, 100, 110] } },
        },
        repetitions: [
          {
            mode: "standalone",
            repetitionIndex: 0,
            manifest: {
              toolNames: ["bash", "workspace.read"],
              toolCount: 2,
              canonicalBytes: 10,
              hash: "c".repeat(64),
              hashAlgorithm: "sha256",
              method: "catalog",
              localCaptureProduced: true,
              catalogComplete: true,
            },
            startup: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
            turns: [
              {
                turnIndex: 1,
                raw: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 },
                invalid: false,
              },
            ],
            invalid: false,
            exposureEvidence: {
              mode: "standalone",
              projectSynaraMcpDesiredState: null,
              activationSucceeded: false,
              dormantObserved: false,
              lifecycleFailures: [
                sanitizeFailureForReport(
                  new Error(
                    `open ${path.join(tmp, "synara-token-overhead-ws-0-abc123", "log.txt")} failed`,
                  ),
                ),
                sanitizeFailureForReport(
                  new Error("unc \\\\server\\share\\config.yaml drive D:\\repo\\config.yaml"),
                ),
              ],
            },
            config: {
              model: "gpt-5.6-sol",
              thinkingLevel: "high",
              promptHash: "d".repeat(64),
              promptBytes: 42,
              workspaceCwd: sanitizePathForReport(workspaceRoot),
              agentDir: sanitizePathForReport(agentDir),
              harnessVersion: "1.0.0",
            },
          },
        ],
      },
      "synara-default": null,
      "synara-activated": null,
    },
    conclusions: {
      measuredFacts: ["standalone: 1/3 valid repetitions; turn-1 total tokens 10"],
      limitations: ["three repetitions are the operational minimum"],
      recommendation: { kind: "no-recommendation", rationale: "n/a" },
    },
    reconciliation: { equation: "total = input + output", description: "n/a" },
  };
}

describe("sanitizePathForReport", () => {
  it("relativizes paths under the home directory", () => {
    const home = os.homedir();
    const input = path.join(home, ".pi", "agent");
    expect(sanitizePathForReport(input)).toBe(`~${path.sep}.pi${path.sep}agent`);
  });

  it("projects temp-root paths to a stable <tmp> label without random suffixes", () => {
    const input = path.join(os.tmpdir(), "synara-token-overhead-ws-0-abc123");
    expect(sanitizePathForReport(input)).toBe(`<tmp>${path.sep}synara-token-overhead-ws-0`);
  });

  it("keeps nested subpaths under the temp placeholder", () => {
    const input = path.join(
      os.tmpdir(),
      "synara-token-overhead-ws-1-xyz789",
      "sub",
      "artifact.bin",
    );
    expect(sanitizePathForReport(input)).toBe(
      `<tmp>${path.sep}synara-token-overhead-ws-1${path.sep}sub${path.sep}artifact.bin`,
    );
  });

  it("projects the temp root itself to <tmp>", () => {
    expect(sanitizePathForReport(os.tmpdir())).toBe("<tmp>");
  });

  it("projects other POSIX absolute paths to <abs> plus a safe basename", () => {
    const input = "/opt/synara-unrelated/runner.sh";
    if (isUnder(input, os.homedir()) || isUnder(input, os.tmpdir())) return;
    expect(sanitizePathForReport(input)).toBe(`<abs>${path.sep}runner.sh`);
  });

  it("projects Windows drive absolute paths to <abs> plus a safe basename", () => {
    expect(sanitizePathForReport("D:\\repo\\config.yaml")).toBe(`<abs>${path.sep}config.yaml`);
    expect(sanitizePathForReport("D:/repo/config.yaml")).toBe(`<abs>${path.sep}config.yaml`);
  });

  it("projects UNC absolute paths to <abs> plus a safe basename", () => {
    expect(sanitizePathForReport("\\\\server\\share\\config.yaml")).toBe(
      `<abs>${path.sep}config.yaml`,
    );
  });

  it("projects JSON-escaped Windows paths embedded in strings", () => {
    const message = 'Cannot read "D:\\\\repo\\\\config.yaml"';
    const result = sanitizePathForReport(message);
    expect(result).not.toContain("D:");
    expect(result).toContain(`<abs>${path.sep}config.yaml`);
  });

  it("leaves relative paths unchanged", () => {
    for (const input of ["relative/path/file.ts", "./relative", "../up/file", "a/b/c"]) {
      expect(sanitizePathForReport(input)).toBe(input);
    }
  });

  it("leaves already-projected ~ forms unchanged", () => {
    expect(sanitizePathForReport("~")).toBe("~");
    expect(sanitizePathForReport("~/x")).toBe("~/x");
  });

  it("projects the POSIX root to <abs>", () => {
    expect(sanitizePathForReport("/")).toBe("<abs>");
  });

  it("drops sensitive basenames from <abs> projections", () => {
    expect(sanitizePathForReport("/opt/.env")).toBe("<abs>");
    expect(sanitizePathForReport("/opt/id_rsa")).toBe("<abs>");
    expect(sanitizePathForReport("/opt/server.pem")).toBe("<abs>");
  });

  it("does not treat a sibling of the home directory as home-relative", () => {
    const home = os.homedir();
    if (home.length <= 1) return;
    const sibling = `${stripTrailingSeparators(home)}-suffix`;
    const result = sanitizePathForReport(sibling);
    expect(result).not.toContain("~");
    expect(result).not.toContain(home);
    expect(result.startsWith("<abs>")).toBe(true);
  });

  it("does not treat a sibling of the temp root as temp-relative", () => {
    const tmp = stripTrailingSeparators(os.tmpdir());
    if (tmp.length <= 1) return;
    const sibling = `${tmp}-suffix`;
    const result = sanitizePathForReport(sibling);
    expect(result).not.toBe(sibling);
    expect(result.startsWith("<abs>")).toBe(true);
  });
});

describe("redactCredentialShapes", () => {
  it("redacts bearer tokens and api keys", () => {
    const redacted = redactCredentialShapes("Authorization: Bearer abc.def.ghi");
    expect(redacted).not.toContain("abc.def.ghi");
    expect(redacted).toContain("=<redacted>");
  });

  it("redacts apiKey-shaped values", () => {
    const redacted = redactCredentialShapes("apiKey=sk-1234567890abcdef");
    expect(redacted).not.toContain("sk-1234567890abcdef");
  });
});

describe("sanitizeFailureForReport", () => {
  it("bounds the length, relativizes home paths, and never leaks key=value credentials", () => {
    const long = "x".repeat(2_000);
    const failure = sanitizeFailureForReport(
      new Error(`failed at ${os.homedir()}/secret with token=abc.def`),
    );
    expect(failure.length).toBeLessThanOrEqual(500);
    expect(failure).not.toContain("abc.def");
    expect(failure).not.toContain(os.homedir());
    expect(failure).toContain("~/secret");
    expect(long.length).toBeGreaterThan(500);
  });

  it("sanitizes embedded home, temp, POSIX, drive, and UNC paths", () => {
    const homePath = path.join(os.homedir(), "secret", "key.txt");
    const tmpPath = path.join(os.tmpdir(), "synara-token-overhead-ws-0-abc123", "log.txt");
    const failure = sanitizeFailureForReport(
      new Error(
        [
          `failed at ${homePath}`,
          `workspace ${tmpPath}`,
          "drive D:\\repo\\config.yaml",
          "unc \\\\server\\share\\config.yaml",
        ].join("; "),
      ),
    );
    expect(failure).not.toContain(os.homedir());
    expect(failure).not.toContain(os.tmpdir());
    expect(failure).toContain(`~${path.sep}secret${path.sep}key.txt`);
    expect(failure).toContain(`<tmp>${path.sep}synara-token-overhead-ws-0${path.sep}log.txt`);
    expect(failure).toContain(`<abs>${path.sep}config.yaml`);
    expect(failure).not.toContain("D:");
    expect(failure).not.toContain("server\\share");
  });

  it("sanitizes embedded paths before length truncation", () => {
    const tmpPath = path.join(
      os.tmpdir(),
      "synara-token-overhead-ws-2-z9y8x7",
      "deep",
      "artifact.bin",
    );
    const prefix = "x".repeat(400);
    const failure = sanitizeFailureForReport(new Error(`${prefix} ${tmpPath}`));
    expect(failure.length).toBeLessThanOrEqual(500);
    expect(failure).not.toContain(os.tmpdir());
  });
});

describe("deep report-surface sanitization", () => {
  it("assertion utility detects raw absolute paths", () => {
    const serialized = JSON.stringify({
      home: os.homedir(),
      tmp: os.tmpdir(),
      workspace: path.join(os.tmpdir(), "synara-token-overhead-ws-0-abc123"),
      drive: "D:\\repo\\config.yaml",
      unc: "\\\\server\\share\\config.yaml",
    });
    const violations = findRawAbsolutePathViolations(serialized);
    expect(violations.some((v) => v.startsWith("raw home path"))).toBe(true);
    expect(violations.some((v) => v.startsWith("raw temp path"))).toBe(true);
    expect(violations.some((v) => v.startsWith("POSIX absolute path"))).toBe(true);
    expect(violations.some((v) => v.startsWith("Windows drive path"))).toBe(true);
    expect(violations.some((v) => v.startsWith("UNC path"))).toBe(true);
  });

  it("serialized representative report contains no raw absolute paths", () => {
    const serialized = JSON.stringify(buildRepresentativeReport(), null, 2);
    expect(findRawAbsolutePathViolations(serialized)).toEqual([]);
    // Config metadata survives via fixture digest/commit and safe labels.
    expect(serialized).toContain("a".repeat(64));
    expect(serialized).toContain("b".repeat(40));
    expect(serialized).toContain(`<tmp>${path.sep}synara-token-overhead-ws-0`);
    expect(serialized).toContain(`~${path.sep}.pi${path.sep}agent`);
    expect(serialized).toContain(
      `~${path.sep}.local${path.sep}share${path.sep}synara${path.sep}manifests`,
    );
    expect(serialized).not.toContain(os.tmpdir());
    expect(serialized).not.toContain(os.homedir());
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("D:");
    expect(serialized).not.toContain("server\\share");
  });
});
