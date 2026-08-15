// FILE: synaraDriver.test.ts
// Purpose: focused regression tests for the impl-11 spec-review corrections
// in the Synara driver: (1) the isolated server launches with the same
// resolved agentDir as standalone/custom `--agent-dir`; (3) an uncaught
// repetition failure yields a visible invalid RepetitionRecord with a
// sanitized lifecycle failure while the mode continues; (5) any bootstrap
// turn tool call invalidates the repetition (Decision 34 §2).
import { describe, expect, it } from "vitest";

import {
  isolatedServerLaunchOptions,
  runSynaraRepetitionLoop,
  stimulusToolCallViolation,
  type SynaraDriverOptions,
} from "./synaraDriver.ts";

function driverOptions(overrides: Partial<SynaraDriverOptions> = {}): SynaraDriverOptions {
  return {
    mode: "synara-default",
    agentDir: "/tmp/agent-dir",
    modelId: "openai/gpt-5.6-sol",
    thinkingLevel: "medium",
    repetitions: 2,
    turnsPerRepetition: 2,
    localManifestDir: null,
    harnessVersion: "test",
    promptHash: "hash",
    promptBytes: 10,
    ...overrides,
  };
}

describe("isolated server launch options (configuration equivalence)", () => {
  it("passes the resolved agentDir to the isolated server so the child Pi runtime matches standalone", () => {
    const options = driverOptions({ agentDir: "/custom/pi-agent", mode: "synara-activated" });
    const launch = isolatedServerLaunchOptions(options);
    // The child server must resolve the same Pi configuration as standalone
    // and custom `--agent-dir` (Decision 34 §4): PI_CODING_AGENT_DIR is set
    // from this value inside serverProcess.
    expect(launch.agentDir).toBe("/custom/pi-agent");
    expect(launch.catalogObserver).toEqual({ mode: "synara-activated" });
  });

  it("enables the Decision 35 observer for the mode being measured and forwards the port", () => {
    const launch = isolatedServerLaunchOptions(
      driverOptions({ mode: "synara-default", serverPort: 58090 }),
    );
    expect(launch.port).toBe(58090);
    expect(launch.catalogObserver).toEqual({ mode: "synara-default" });
  });
});

describe("per-repetition failure containment (visible invalid records)", () => {
  it("records a thrown repetition as a visible invalid record and continues the mode", async () => {
    const options = driverOptions({ repetitions: 3, mode: "synara-activated" });
    const diagnostics: string[] = [];
    let thrown = 0;
    const records = await runSynaraRepetitionLoop({
      options,
      onDiagnostic: (message) => diagnostics.push(message),
      runRepetition: async ({ repetitionIndex }) => {
        if (repetitionIndex === 1) {
          thrown += 1;
          throw new Error("WebSocket connection dropped at /tmp/secret/path");
        }
        return {
          mode: options.mode,
          repetitionIndex,
          manifest: {
            toolNames: ["bash"],
            toolCount: 1,
            canonicalBytes: 4,
            hash: "h",
            hashAlgorithm: "sha256",
            method: "m",
            localCaptureProduced: false,
            catalogComplete: true,
          },
          startup: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          turns: [],
          invalid: false,
          exposureEvidence: {
            mode: options.mode,
            projectSynaraMcpDesiredState: null,
            activationSucceeded: false,
            dormantObserved: false,
            lifecycleFailures: [],
          },
          config: {
            model: options.modelId,
            thinkingLevel: options.thinkingLevel,
            promptHash: options.promptHash,
            promptBytes: options.promptBytes,
            workspaceCwd: "/tmp/ws",
            agentDir: options.agentDir,
            harnessVersion: options.harnessVersion,
          },
        };
      },
    });

    // Every requested repetition yields a record; the throwing one is a
    // visible invalid repetition instead of an unrecorded mode abort.
    expect(records).toHaveLength(3);
    expect(thrown).toBe(1);
    expect(records[0]!.invalid).toBe(false);
    expect(records[1]!.invalid).toBe(true);
    expect(records[1]!.invalidReason).toContain("WebSocket connection dropped");
    expect(records[1]!.exposureEvidence.lifecycleFailures).toHaveLength(1);
    // Sanitization: raw filesystem paths never reach the record.
    expect(records[1]!.invalidReason).not.toContain("/tmp/secret");
    expect(records[1]!.config.workspaceCwd).toBe("<workspace-unavailable>");
    expect(records[2]!.invalid).toBe(false);
    expect(diagnostics.some((message) => message.includes("repetition 1 aborted"))).toBe(true);
  });

  it("keeps every repetition when all of them throw (fail closed deterministically)", async () => {
    const options = driverOptions({ repetitions: 2 });
    const records = await runSynaraRepetitionLoop({
      options,
      runRepetition: async () => {
        throw new Error("boom");
      },
    });
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.invalid)).toBe(true);
    expect(records.every((record) => record.invalidReason === "boom")).toBe(true);
    expect(records.every((record) => !record.manifest.catalogComplete)).toBe(true);
  });
});

describe("bootstrap turn tool-call invalidation (Decision 34 §2)", () => {
  it("returns no violation when the stimulus turn stayed on-stimulus", () => {
    expect(stimulusToolCallViolation("bootstrap turn", [])).toBeNull();
  });

  it("invalidates the repetition on any bootstrap tool call with the sanitized entry", () => {
    const violation = stimulusToolCallViolation("bootstrap turn", ["bash", "synara_list_threads"]);
    expect(violation).toBe(
      "bootstrap turn observed tool call(s): bash, synara_list_threads",
    );
  });
});
