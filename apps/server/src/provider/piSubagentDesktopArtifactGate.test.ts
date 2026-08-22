import { describe, expect, it } from "vitest";
import path from "node:path";

import type { PiSubagentArtifactVerification } from "./piSubagentArtifactVerifier.ts";

import {
  evaluatePiSubagentDesktopArtifactGate,
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
  type PiSubagentArtifactVerifier,
} from "./piSubagentDesktopArtifactGate.ts";

/**
 * Ticket 01 (handshake-first) — pure decision-matrix tests for the desktop
 * managed-artifact early gate (T01-AC2 / AC3 / AC5, Decision 0004 §4-§6).
 *
 * The gate is a pure function over (mode, env, verifier seam): no fs, no
 * process.env, no Pi SDK import, no side effects. Every test injects a
 * deterministic env map and verifier stub and asserts both the decision
 * (exact result shape) and the diagnostics contract (stable, bounded, free
 * of absolute root paths and raw filesystem errors).
 */

const VERIFIER_CATEGORIES = [
  "manifest_missing",
  "manifest_malformed",
  "entry_missing",
  "digest_mismatch",
  "path_escape",
  "symlink_escape",
  "unlisted_entry",
  "capability_profile_invalid",
] as const;

const ABSOLUTE_ROOT = "/Users/attacker/definitely/not/the/release/root";

const validVerification: PiSubagentArtifactVerification = {
  valid: true,
  metadata: {
    sourceIdentity: {
      repositoryUrl: "https://github.com/anhphamwork99/alfie.git",
      pinnedCommit: "aa6fa4a8540644d2509b10d6df854486ddc67d1d",
      packageName: "@alfie/pi-subagents",
      packageVersion: "0.15.0-alfie.4",
    },
    capabilityProfile: {
      protocolVersion: 1,
      capabilities: ["managed-spawn", "abort-propagation"],
      requiredCapabilities: ["managed-spawn", "abort-propagation"],
    },
  },
};

/** Deterministic verifier stub that records every call it receives. */
const verifierReturning = (
  result: PiSubagentArtifactVerification,
): { readonly verifier: PiSubagentArtifactVerifier; readonly calls: string[] } => {
  const calls: string[] = [];
  return {
    verifier: async (root: string) => {
      calls.push(root);
      return result;
    },
    calls,
  };
};

const desktopEnv = (locator: string | undefined): Record<string, string | undefined> => ({
  [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: locator,
});

describe("evaluatePiSubagentDesktopArtifactGate", () => {
  describe("non-desktop modes pass without touching the verifier", () => {
    it.for([["web"] as const])(
      "returns pass for mode %s with zero verifier calls",
      async ([mode]) => {
        const { verifier, calls } = verifierReturning({
          valid: false,
          category: "digest_mismatch",
        });
        const result = await evaluatePiSubagentDesktopArtifactGate(mode, {
          env: desktopEnv("/release/pi-subagents-artifact"),
          verify: verifier,
        });
        expect(result).toEqual({ kind: "pass" });
        expect(calls.length).toBe(0);
      },
    );

    it("passes even with a blank/absent locator and a poisoned sibling env", async () => {
      const { verifier, calls } = verifierReturning({
        valid: false,
        category: "symlink_escape",
      });
      const result = await evaluatePiSubagentDesktopArtifactGate("web", {
        env: {
          ...desktopEnv("   "),
          PI_CODING_AGENT_DIR: "/Users/attacker/.pi",
          HOME: "/Users/attacker",
        },
        verify: verifier,
      });
      expect(result).toEqual({ kind: "pass" });
      expect(calls.length).toBe(0);
    });
  });

  describe("desktop with an absent or blank locator fails closed before the verifier", () => {
    it.for([
      ["absent", undefined],
      ["empty", ""],
      ["whitespace-only", " \t \n "],
    ] as const)("locator %s rejects with locator_missing", async ([, locator]) => {
      const { verifier, calls } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv(locator),
        verify: verifier,
      });
      expect(result).toEqual({
        kind: "unavailable",
        reason: "locator_missing",
        detail: "managed pi artifact locator is absent or blank",
      });
      expect(calls.length).toBe(0);
    });

    it("never reads any other env var to synthesize a locator", async () => {
      const { verifier, calls } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: {
          PI_CODING_AGENT_DIR: "/Users/attacker/.pi-global",
          HOME: "/Users/attacker",
          SYNARA_PI_SUBAGENT_ARTIFACT: "/somewhere/else",
        },
        verify: verifier,
      });
      expect(result).toMatchObject({ kind: "unavailable", reason: "locator_missing" });
      expect(calls.length).toBe(0);
    });
  });

  describe("desktop maps invalid verifier output to its closed category", () => {
    it.for(VERIFIER_CATEGORIES)(
      "category %s is preserved verbatim with a safe bounded detail",
      async (category) => {
        const { verifier } = verifierReturning({ valid: false, category });
        const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
          env: desktopEnv(ABSOLUTE_ROOT),
          verify: verifier,
        });
        expect(result.kind).toBe("unavailable");
        if (result.kind !== "unavailable") return;
        expect(result.reason).toBe(category);
        expect(result.detail.length).toBeGreaterThan(0);
        expect(result.detail.length).toBeLessThanOrEqual(512);
        expect(result.detail).not.toContain(ABSOLUTE_ROOT);
        expect(result.detail).toMatch(/^managed pi artifact verification failed: /);
      },
    );

    it("drops an entry label that is not a normalized relative path", async () => {
      const { verifier } = verifierReturning({
        valid: false,
        category: "digest_mismatch",
        entry: `${"x".repeat(4_096)}/../../escape.sh`,
      });
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv(ABSOLUTE_ROOT),
        verify: verifier,
      });
      expect(result).toEqual({
        kind: "unavailable",
        reason: "digest_mismatch",
        detail: "managed pi artifact verification failed: digest_mismatch",
      });
    });

    it("a category without an entry label stays compact", async () => {
      const { verifier } = verifierReturning({ valid: false, category: "manifest_malformed" });
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("/release/artifact"),
        verify: verifier,
      });
      expect(result).toEqual({
        kind: "unavailable",
        reason: "manifest_malformed",
        detail: "managed pi artifact verification failed: manifest_malformed",
      });
    });

    it("raw filesystem error strings from a hostile result never surface", async () => {
      const hostile = {
        valid: false,
        category: "manifest_missing",
        entry: `EPERM: ${ABSOLUTE_ROOT}/manifest.json (raw fs error)`,
      } as unknown as PiSubagentArtifactVerification;
      const { verifier } = verifierReturning(hostile);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv(ABSOLUTE_ROOT),
        verify: verifier,
      });
      expect(result.kind).toBe("unavailable");
      if (result.kind !== "unavailable") return;
      expect(result.reason).toBe("manifest_missing");
      expect(result.detail).not.toContain("EPERM");
      expect(result.detail).not.toContain(ABSOLUTE_ROOT);
      expect(result.detail).not.toContain("(raw fs error)");
    });
  });

  describe("desktop with a valid artifact returns the trusted controlled-runtime binding (Ticket 02)", () => {
    it("passes with the controlled <root>/agent agentDir and the verifier's trusted metadata", async () => {
      const { verifier, calls } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("/release/pi-subagents-artifact"),
        verify: verifier,
      });
      expect(calls).toEqual(["/release/pi-subagents-artifact"]);
      expect(result).toEqual({
        kind: "pass",
        managed: {
          agentDir: `${"/release/pi-subagents-artifact"}${path.sep}agent`,
          metadata: validVerification.metadata,
        },
      });
    });

    it("never returns the artifact root itself as the controlled agentDir", async () => {
      const { verifier } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("/release/pi-subagents-artifact"),
        verify: verifier,
      });
      expect(result.kind).toBe("pass");
      if (result.kind !== "pass" || !("managed" in result)) return;
      expect(result.managed.agentDir).not.toBe("/release/pi-subagents-artifact");
      expect(result.managed.agentDir.endsWith("agent")).toBe(true);
      // The controlled agentDir lives strictly INSIDE the verified root.
      expect(result.managed.agentDir.startsWith("/release/pi-subagents-artifact")).toBe(true);
    });

    it("carries no diagnostic surface in the managed binding", async () => {
      const { verifier } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("/release/pi-subagents-artifact"),
        verify: verifier,
      });
      expect(result.kind).toBe("pass");
      if (result.kind !== "pass" || !("managed" in result)) return;
      expect(Object.keys(result.managed).toSorted()).toEqual(["agentDir", "metadata"]);
      expect(Object.keys(result).toSorted()).toEqual(["kind", "managed"]);
    });

    it("trims surrounding whitespace from the locator before verifying", async () => {
      const { verifier, calls } = verifierReturning(validVerification);
      await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("  /release/artifact  \n"),
        verify: verifier,
      });
      expect(calls).toEqual(["/release/artifact"]);
    });
  });

  describe("the result surface itself is bounded and stable", () => {
    it("an unavailable result exposes exactly kind, reason, detail", async () => {
      const { verifier } = verifierReturning({ valid: false, category: "path_escape" });
      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: desktopEnv("/release/artifact"),
        verify: verifier,
      });
      expect(Object.keys(result).toSorted()).toEqual(["detail", "kind", "reason"]);
    });

    it("a pass result for non-desktop exposes exactly kind", async () => {
      const result = await evaluatePiSubagentDesktopArtifactGate("web", { env: {} });
      expect(Object.keys(result)).toEqual(["kind"]);
    });
  });
});
