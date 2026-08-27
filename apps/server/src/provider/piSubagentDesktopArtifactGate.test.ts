import { afterAll, beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
} from "@synara/contracts";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME,
  type PiSubagentArtifactVerification,
  verifyPiSubagentArtifact,
} from "./piSubagentArtifactVerifier.ts";

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
      pinnedCommit: "3fe340b401ca86bcbe8b55abd4de107e1d93482e",
      packageName: "@alfie/pi-subagents",
      packageVersion: "0.15.0-alfie.6",
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
      "returns pass for mode %s with no locator and zero verifier calls",
      async ([mode]) => {
        const { verifier, calls } = verifierReturning({
          valid: false,
          category: "digest_mismatch",
        });
        const result = await evaluatePiSubagentDesktopArtifactGate(mode, {
          env: desktopEnv(undefined),
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

  /**
   * Local web/dev path (dev-runner prepared cache): a WEB-mode server started
   * with a NON-EMPTY launcher-derived locator is verified exactly like
   * desktop and receives the SAME trusted managed binding; an invalid locator
   * fails closed with the verifier's closed category. A web-mode server
   * without a locator keeps the historical pass-through (covered above).
   */
  describe("web mode with a non-empty launcher-derived locator (local dev path)", () => {
    it("verifies the locator and returns the trusted managed binding", async () => {
      const { verifier, calls } = verifierReturning(validVerification);
      const result = await evaluatePiSubagentDesktopArtifactGate("web", {
        env: desktopEnv("/synara-home/dev-pi-subagent-artifacts/aa6fa4a8"),
        verify: verifier,
      });
      expect(calls).toEqual(["/synara-home/dev-pi-subagent-artifacts/aa6fa4a8"]);
      expect(result).toEqual({
        kind: "pass",
        managed: {
          agentDir: path.join("/synara-home/dev-pi-subagent-artifacts/aa6fa4a8", "agent"),
          metadata: validVerification.metadata,
        },
      });
    });

    it.for(VERIFIER_CATEGORIES)(
      "fails closed on an invalid locator with the closed category %s",
      async (category) => {
        const { verifier, calls } = verifierReturning({ valid: false, category });
        const result = await evaluatePiSubagentDesktopArtifactGate("web", {
          env: desktopEnv(ABSOLUTE_ROOT),
          verify: verifier,
        });
        expect(result.kind).toBe("unavailable");
        if (result.kind !== "unavailable") return;
        expect(result.reason).toBe(category);
        expect(result.detail).toMatch(/^managed pi artifact verification failed: /);
        expect(result.detail).not.toContain(ABSOLUTE_ROOT);
        expect(calls.length).toBe(1);
      },
    );

    it("trims a whitespace-padded web locator before verifying", async () => {
      const { verifier, calls } = verifierReturning(validVerification);
      await evaluatePiSubagentDesktopArtifactGate("web", {
        env: desktopEnv("  /dev-cache/entry  \n"),
        verify: verifier,
      });
      expect(calls).toEqual(["/dev-cache/entry"]);
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

/**
 * Ticket 01b (AC3/AC6, Decision 0006) — the shared fail-close gate fed by the
 * PRODUCTION verifier over REAL on-disk expanded-closure fixtures (extension
 * + `agent/extensions/shared` + root-level `node_modules` regular files).
 * No verifier stub: the denial reason is the real verifier's bounded category
 * for a genuinely invalid shared or dependency artifact.
 */
const closureSha256 = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const CLOSURE_VALID_FILES = [
  {
    path: "agent/extensions/pi-subagents/package.json",
    content: JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.6" }),
  },
  {
    path: "agent/extensions/shared/durable-preferences.js",
    content: "export const durablePreferences = 'shared';\n",
  },
  {
    path: "node_modules/zod/index.js",
    content: "module.exports = require('./lib/index.js');\n",
  },
  {
    path: "agent/system/subagent-system.md",
    content: "# Subagent System\n\nYou are a delegated subagent.\n",
  },
  {
    path: "agent/system/working-style.md",
    content: "# Working Style\n\nBe precise and evidence-driven.\n",
  },
] as const;

const stageClosureArtifact = async (root: string): Promise<void> => {
  const files = CLOSURE_VALID_FILES.map((file) => Object.assign({}, file));
  for (const file of files) {
    await mkdir(join(root, file.path, ".."), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  await writeFile(
    join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
    JSON.stringify(
      {
        schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        sourceIdentity: validVerification.metadata.sourceIdentity,
        capabilityProfile: {
          protocolVersion: 1,
          capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
          requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
        },
        files: files.map((file) => ({
          path: file.path,
          sizeBytes: Buffer.byteLength(file.content),
          sha256: closureSha256(file.content),
        })),
      },
      null,
      2,
    ),
  );
};

let closureFixtureRoot: string;

beforeAll(async () => {
  closureFixtureRoot = await mkdtemp(join(tmpdir(), "synara-t01b-gate-"));
});

afterAll(async () => {
  await rm(closureFixtureRoot, { recursive: true, force: true });
});

const REAL_VERIFIER: PiSubagentArtifactVerifier = (root) => verifyPiSubagentArtifact(root);

/**
 * Ticket 01c (Decision 0010 AC6) — the desktop gate fed by the production
 * verifier over the expanded prompt-system closure. The valid fixture carries
 * `agent/system` entries; corrupt/missing system entries deny with the real
 * verifier's bounded category BEFORE any managed runtime use — the same
 * fail-close ordering as every other closure subtree.
 */
describe("evaluatePiSubagentDesktopArtifactGate with agent/system prompt closure entries (Ticket 01c)", () => {
  it("a symlinked agent/system prompt entry denies with symlink_escape before load", async () => {
    const artifactRoot = await mkdtemp(join(closureFixtureRoot, "t01c-symlink-"));
    await stageClosureArtifact(artifactRoot);
    const outside = join(closureFixtureRoot, "t01c-outside-prompt.md");
    await writeFile(outside, "# Subagent System\n\nDecoy prompt bytes.\n");
    await rm(join(artifactRoot, "agent/system/subagent-system.md"));
    await symlink(outside, join(artifactRoot, "agent/system/subagent-system.md"));

    const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
      env: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: artifactRoot },
      verify: REAL_VERIFIER,
    });

    expect(result).toEqual({
      kind: "unavailable",
      reason: "symlink_escape",
      detail:
        "managed pi artifact verification failed: symlink_escape (entry: agent/system/subagent-system.md)",
    });
    // The decoy bytes never entered any gate surface.
    expect(JSON.stringify(result)).not.toContain("Decoy prompt bytes");
  });

  it("an unlisted extra file under agent/system denies with unlisted_entry", async () => {
    const artifactRoot = await mkdtemp(join(closureFixtureRoot, "t01c-unlisted-"));
    await stageClosureArtifact(artifactRoot);
    await writeFile(join(artifactRoot, "agent/system/orchestration-rules.md"), "unlisted bytes");

    const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
      env: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: artifactRoot },
      verify: REAL_VERIFIER,
    });

    expect(result).toEqual({
      kind: "unavailable",
      reason: "unlisted_entry",
      detail:
        "managed pi artifact verification failed: unlisted_entry (entry: agent/system/orchestration-rules.md)",
    });
  });
});

describe("evaluatePiSubagentDesktopArtifactGate with the production verifier over real expanded-closure artifacts (Ticket 01b)", () => {
  it.for([
    [
      "shared",
      {
        category: "entry_missing",
        entry: "agent/extensions/shared/durable-preferences.js",
        corrupt: async (root: string) => {
          await rm(join(root, "agent/extensions/shared/durable-preferences.js"));
        },
      },
    ],
    [
      "node_modules",
      {
        category: "digest_mismatch",
        entry: "node_modules/zod/index.js",
        corrupt: async (root: string) => {
          await writeFile(
            join(root, "node_modules/zod/index.js"),
            "module.exports = require('./lib/index.jS');\n",
          );
        },
      },
    ],
    [
      "system-missing",
      {
        category: "entry_missing",
        entry: "agent/system/subagent-system.md",
        corrupt: async (root: string) => {
          await rm(join(root, "agent/system/subagent-system.md"));
        },
      },
    ],
    [
      "system-tampered",
      {
        category: "digest_mismatch",
        entry: "agent/system/working-style.md",
        corrupt: async (root: string) => {
          await writeFile(
            join(root, "agent/system/working-style.md"),
            "# Working Style\n\nBe precise and evidence-driven.X",
          );
        },
      },
    ],
  ] as const)(
    "a real invalid %s artifact denies with the verifier's bounded category and a safe detail",
    async ([label, variant]) => {
      const artifactRoot = await mkdtemp(join(closureFixtureRoot, `${label}-`));
      await stageClosureArtifact(artifactRoot);
      await variant.corrupt(artifactRoot);

      const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
        env: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: artifactRoot },
        verify: REAL_VERIFIER,
      });

      expect(result).toEqual({
        kind: "unavailable",
        reason: variant.category,
        detail: `managed pi artifact verification failed: ${variant.category} (entry: ${variant.entry})`,
      });
    },
  );

  it("a real VALID expanded closure passes with the trusted controlled binding", async () => {
    const artifactRoot = await mkdtemp(join(closureFixtureRoot, "valid-"));
    await stageClosureArtifact(artifactRoot);

    const result = await evaluatePiSubagentDesktopArtifactGate("desktop", {
      env: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: artifactRoot },
      verify: REAL_VERIFIER,
    });

    expect(result.kind).toBe("pass");
    if (result.kind !== "pass" || !("managed" in result)) return;
    expect(result.managed.agentDir).toBe(join(artifactRoot, "agent"));
    expect(Object.keys(result.managed).toSorted()).toEqual(["agentDir", "metadata"]);
  });
});
