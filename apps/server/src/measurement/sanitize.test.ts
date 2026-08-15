// FILE: sanitize.test.ts
// Purpose: Focused tests for the report-surface sanitization (Decision 34
// §3/§5): committed output must never contain raw sensitive paths or
// credential-shaped values.
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  redactCredentialShapes,
  sanitizeFailureForReport,
  sanitizePathForReport,
} from "./sanitize.ts";

describe("sanitizePathForReport", () => {
  it("relativizes paths under the home directory", () => {
    const home = os.homedir();
    const input = path.join(home, ".pi", "agent");
    expect(sanitizePathForReport(input)).toBe(`~${path.sep}.pi${path.sep}agent`);
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(sanitizePathForReport("/tmp/workspace")).toBe("/tmp/workspace");
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
});
