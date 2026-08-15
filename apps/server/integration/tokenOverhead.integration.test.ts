// FILE: tokenOverhead.integration.test.ts
// Purpose: impl-11 token-overhead harness integration tests (Decision 20,
// impl-11 Testing Seams AC1/AC2). Real model runs are credential-gated:
// they run only when SYNARA_TOKEN_OVERHEAD_REAL_RUNS=1 and require a
// configured Pi agent dir. Non-gated tests cover the success and
// failure/diagnostic surfaces that need no credentials: the reconciliation
// kernels, canonical-log parsing, the isolated-server lifecycle (spawn →
// WS negotiation → snapshot → teardown), and project/thread creation over
// the real RPC API.
import { describe, expect, it } from "vitest";

import { reconcileSessionStats, PI_RECONCILIATION_RULE } from "../src/measurement/reconciliation.ts";
import { extractTurnCompletedUsage } from "../src/measurement/reconciliation.ts";
import { canonicalizeManifest, summarizeManifest, sha256 } from "../src/measurement/canonicalize.ts";
import { evaluateEvidence, buildRunSetSummary, computePairedDeltas, makeTurnMeasurement } from "../src/measurement/records.ts";
import { parseCanonicalTurnCompletedEvents, parseCanonicalToolCallEvents } from "../src/measurement/synaraDriver.ts";
import { startIsolatedServer, removeIsolatedHomeDir } from "../src/measurement/serverProcess.ts";
import { connectSynaraClient } from "../src/measurement/synaraClient.ts";
import { STIMULUS_TEXT, STIMULUS_HASH } from "../src/measurement/stimulus.ts";
import type { RawSessionStats, RepetitionRecord } from "../src/measurement/types.ts";

const REAL_RUNS = process.env.SYNARA_TOKEN_OVERHEAD_REAL_RUNS === "1";

describe("token overhead reconciliation kernel (non-gated)", () => {
  it("documents and validates the Pi SessionStats equation", () => {
    expect(PI_RECONCILIATION_RULE.equation).toBe("total == input + cacheRead + cacheWrite + output");
    const ok = reconcileSessionStats({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 });
    expect(ok.ok).toBe(true);
    const bad = reconcileSessionStats({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 11 });
    expect(bad.ok).toBe(false);
    expect(bad.failures[0]).toContain("inconsistent total");
  });

  it("fails explicitly on missing usage in turn.completed payloads", () => {
    const result = extractTurnCompletedUsage({ state: "completed", stopReason: null });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures.join(" ")).toContain("usage");
    }
  });
});

describe("token overhead canonical manifest (non-gated)", () => {
  it("canonicalizes deterministically: sorted names, stable hash, full-schema bytes", () => {
    const entries = [
      { name: "write", description: "w", parameters: { type: "object" } },
      { name: "bash", description: "b", parameters: { type: "object" } },
    ];
    const first = canonicalizeManifest(entries);
    const second = canonicalizeManifest([...entries].reverse());
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(sha256(first)).toBe(sha256(second));
    const summary = summarizeManifest({
      tools: entries,
      localCaptureProduced: true,
      catalogComplete: true,
    });
    expect(summary.toolNames).toEqual(["bash", "write"]);
    expect(summary.toolCount).toBe(2);
    expect(summary.canonicalBytes).toBe(first.byteLength);
    expect(summary.hashAlgorithm).toBe("sha256");
    expect(summary.method).toContain("sort-by-name");
  });

  it("throws on an empty manifest (complete catalog required)", () => {
    expect(() => canonicalizeManifest([])).toThrow(/empty tool manifest/);
  });
});

describe("token overhead canonical log parsing (non-gated)", () => {
  it("extracts turn.completed payloads for a thread from CANON log lines", () => {
    const line = (payload: unknown) =>
      `[2026-08-15T00:00:00.000Z] CANON: ${JSON.stringify(payload)}`;
    const content = [
      line({ type: "turn.started", threadId: "t1", payload: { model: "m" } }),
      line({
        type: "turn.completed",
        threadId: "t1",
        payload: {
          state: "completed",
          stopReason: null,
          usage: { tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } },
        },
      }),
      line({ type: "turn.completed", threadId: "t2", payload: { state: "completed" } }),
    ].join("\n");
    const events = parseCanonicalTurnCompletedEvents(content, "t1");
    expect(events).toHaveLength(1);
    const extracted = extractTurnCompletedUsage(events[0]!);
    if (!extracted.ok) {
      throw new Error(extracted.failures.join("; "));
    }
    expect(extracted.value.usage.total).toBe(10);
  });
});

describe("token overhead canonical log tool-call evidence (non-gated)", () => {
  it("extracts tool names from item.started events with tool payload data", () => {
    const line = (payload: unknown) =>
      `[2026-08-15T00:00:00.000Z] CANON: ${JSON.stringify(payload)}`;
    const content = [
      line({
        type: "item.started",
        threadId: "t1",
        payload: { itemType: "bash", status: "inProgress", data: { toolName: "bash" } },
      }),
      line({ type: "item.started", threadId: "t1", payload: { itemType: "read" } }),
      line({ type: "item.started", threadId: "t2", payload: { data: { toolName: "other" } } }),
      line({ type: "turn.completed", threadId: "t1", payload: { state: "completed" } }),
    ].join("\n");
    expect(parseCanonicalToolCallEvents(content, "t1")).toEqual(["bash"]);
  });
});

describe("token overhead records/report kernel (non-gated)", () => {
  const raw = (overrides: Partial<RawSessionStats> = {}): RawSessionStats => ({
    input: 100,
    output: 30,
    cacheRead: 200,
    cacheWrite: 50,
    total: 380,
    ...overrides,
  });
  const zero = (): RawSessionStats => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

  it("keeps invalid repetitions visible and excluded from paired analysis", () => {
    const valid: RepetitionRecord = {
      mode: "standalone",
      repetitionIndex: 0,
      manifest: {
        toolNames: ["bash"],
        toolCount: 1,
        canonicalBytes: 10,
        hash: "h",
        hashAlgorithm: "sha256",
        method: "m",
        localCaptureProduced: true,
        catalogComplete: true,
      },
      startup: zero(),
      turns: [
        makeTurnMeasurement({ turnIndex: 1, before: zero(), after: raw() }),
        makeTurnMeasurement({
          turnIndex: 2,
          before: raw(),
          after: raw({ input: 140, output: 40, cacheRead: 200, cacheWrite: 50, total: 430 }),
        }),
      ],
      invalid: false,
      exposureEvidence: {
        mode: "standalone",
        projectSynaraMcpDesiredState: null,
        activationSucceeded: false,
        dormantObserved: true,
        lifecycleFailures: [],
      },
      config: {
        model: "m",
        thinkingLevel: "medium",
        promptHash: STIMULUS_HASH,
        promptBytes: STIMULUS_TEXT.length,
        workspaceCwd: "/tmp/ws",
        agentDir: "/tmp/agent",
        harnessVersion: "test",
      },
    };
    const invalid = {
      ...valid,
      repetitionIndex: 1,
      invalid: true,
      invalidReason: "activation did not succeed",
      turns: [],
    };
    const summary = buildRunSetSummary({ mode: "standalone", repetitions: [valid, invalid] });
    expect(summary.validRepetitions).toHaveLength(1);
    expect(summary.invalidRepetitions).toHaveLength(1);
    expect(summary.invalidRepetitions[0]!.invalidReason).toContain("activation");
    expect(summary.pairedDeltas).toHaveLength(1);
  });

  it("declares insufficient evidence when repetitions are missing", () => {
    const verdict = evaluateEvidence(
      {
        mode: "standalone",
        repetitions: 3,
        turnsPerRepetition: 2,
        model: "m",
        thinkingLevel: "medium",
        promptHash: "h",
        promptBytes: 10,
        harnessVersion: "test",
      },
      [],
    );
    expect(verdict.insufficientEvidence).toBe(true);
    expect(verdict.reasons).toContain("incomplete-repetitions");
  });

  it("requires exactly two turns per repetition for paired deltas", () => {
    const record: RepetitionRecord = {
      mode: "standalone",
      repetitionIndex: 0,
      manifest: {
        toolNames: [],
        toolCount: 0,
        canonicalBytes: 0,
        hash: "",
        hashAlgorithm: "sha256",
        method: "m",
        localCaptureProduced: false,
        catalogComplete: false,
      },
      startup: zero(),
      turns: [makeTurnMeasurement({ turnIndex: 1, before: zero(), after: raw() })],
      invalid: false,
      exposureEvidence: {
        mode: "standalone",
        projectSynaraMcpDesiredState: null,
        activationSucceeded: false,
        dormantObserved: true,
        lifecycleFailures: [],
      },
      config: {
        model: "m",
        thinkingLevel: "medium",
        promptHash: "h",
        promptBytes: 10,
        workspaceCwd: "/tmp/ws",
        agentDir: "/tmp/agent",
        harnessVersion: "test",
      },
    };
    expect(() => computePairedDeltas([record])).toThrow(/exactly two/);
  });
});

describe("token overhead isolated server lifecycle (non-gated)", () => {
  it("spawns an isolated server, negotiates the WS protocol, reads a snapshot, and tears down", async () => {
    const server = await startIsolatedServer({});
    try {
      const client = await connectSynaraClient(server.port);
      try {
        const snapshot = await client.getSnapshot();
        expect(snapshot.projects).toBeDefined();
        expect(snapshot.threads).toBeDefined();
      } finally {
        await client.close();
      }
    } finally {
      await server.stop();
      const fs = await import("node:fs");
      expect(fs.existsSync(server.homeDir)).toBe(true);
      const { removeIsolatedHomeDir } = await import("../src/measurement/serverProcess.ts");
      removeIsolatedHomeDir(server.homeDir);
      expect(fs.existsSync(server.homeDir)).toBe(false);
    }
  }, 120_000);

  it("creates a fresh project and thread through the real RPC API on the isolated server", async () => {
    const server = await startIsolatedServer({});
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { randomUUID } = await import("node:crypto");
    const { CommandId, ProjectId, ThreadId, MessageId } = await import("@synara/contracts");
    const workspaceCwd = fs.mkdtempSync(path.join(os.tmpdir(), "toh-rpc-ws-"));
    fs.writeFileSync(path.join(workspaceCwd, "README.md"), "fixture\n");
    try {
      const client = await connectSynaraClient(server.port);
      try {
        const projectId = ProjectId.makeUnsafe(randomUUID());
        const threadId = ThreadId.makeUnsafe(randomUUID());
        const now = new Date().toISOString();
        const projectReceipt = await client.dispatchCommand({
          type: "project.create",
          commandId: CommandId.makeUnsafe(randomUUID()),
          projectId,
          kind: "project",
          title: `toh-rpc-${now}`,
          workspaceRoot: workspaceCwd,
          createWorkspaceRootIfMissing: false,
          defaultModelSelection: { provider: "pi", model: "pi/default" },
          createdAt: now,
        });
        expect(projectReceipt.sequence).toBeGreaterThanOrEqual(0);
        const threadReceipt = await client.dispatchCommand({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(randomUUID()),
          threadId,
          projectId,
          title: "toh-rpc-thread",
          modelSelection: { provider: "pi", model: "pi/default" },
          runtimeMode: "full-access",
          interactionMode: "default",
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: null,
          createdAt: now,
        });
        expect(threadReceipt.sequence).toBeGreaterThanOrEqual(0);
        const snapshot = await client.getSnapshot();
        expect(snapshot.projects.some((project) => project.id === projectId)).toBe(true);
        expect(snapshot.threads.some((thread) => thread.id === threadId)).toBe(true);
        const detail = await client.getThreadDetailSnapshot(String(threadId));
        expect(detail?.thread.id).toBe(String(threadId));
      } finally {
        await client.close();
      }
    } finally {
      await server.stop();
      const { removeIsolatedHomeDir } = await import("../src/measurement/serverProcess.ts");
      removeIsolatedHomeDir(server.homeDir);
      fs.rmSync(workspaceCwd, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("token overhead Decision 35 catalog observer server wiring (non-gated)", () => {
  it("normal isolated servers configure no observer and create no catalog artifact", async () => {
    const server = await startIsolatedServer({});
    const fs = await import("node:fs");
    const path = await import("node:path");
    try {
      expect(server.catalogArtifactPath).toBeNull();
      const client = await connectSynaraClient(server.port);
      try {
        const snapshot = await client.getSnapshot();
        expect(snapshot.projects).toBeDefined();
      } finally {
        await client.close();
      }
      // No observer artifact anywhere in the isolated home.
      const walk = (dir: string): string[] => {
        const found: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) found.push(...walk(full));
          else if (entry.name.includes("catalog-artifact")) found.push(full);
        }
        return found;
      };
      expect(walk(server.homeDir)).toEqual([]);
    } finally {
      await server.stop();
      removeIsolatedHomeDir(server.homeDir);
    }
  }, 120_000);

  it("observer-configured servers confine the artifact path to the isolated home and clean up", async () => {
    const server = await startIsolatedServer({ catalogObserver: { mode: "synara-default" } });
    const fs = await import("node:fs");
    const path = await import("node:path");
    try {
      expect(server.catalogArtifactPath).not.toBeNull();
      expect(path.resolve(server.catalogArtifactPath!)).toContain(path.resolve(server.homeDir));
      const client = await connectSynaraClient(server.port);
      try {
        const snapshot = await client.getSnapshot();
        expect(snapshot.projects).toBeDefined();
      } finally {
        await client.close();
      }
      // No session started: no artifact yet (dormant until a session reaches
      // its ready state).
      expect(fs.existsSync(server.catalogArtifactPath!)).toBe(false);
    } finally {
      await server.stop();
      removeIsolatedHomeDir(server.homeDir);
      expect(fs.existsSync(server.homeDir)).toBe(false);
    }
  }, 120_000);
});

describe("token overhead real paired runs (credential-gated)", () => {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const runAll = (): boolean =>
    REAL_RUNS &&
    agentDir !== undefined &&
    agentDir.length > 0 &&
    process.env.SYNARA_TOKEN_OVERHEAD_REAL_RUNS === "1";

  it.skipIf(!runAll())(
    "runs the real three-mode matrix and writes a report artifact",
    async () => {
      const { runMeasurement, HARNESS_VERSION } = await import("../src/measurement/orchestrator.ts");
      const { resolveConfiguredModelId } = await import("../src/measurement/piSession.ts");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");

      const resolvedModelId = await resolveConfiguredModelId(agentDir!);
      expect(resolvedModelId).toBeDefined();
      const workspaceCwd = fs.mkdtempSync(path.join(os.tmpdir(), "synara-toh-ws-"));
      fs.writeFileSync(path.join(workspaceCwd, "README.md"), "fixture\n");
      const outputPath = path.join(os.tmpdir(), `synara-token-overhead-${Date.now()}.json`);
      try {
        const result = await runMeasurement({
          agentDir: agentDir!,
          modelId: resolvedModelId!,
          thinkingLevel: "medium",
          workspaceCwd,
          repetitions: 1,
          turnsPerRepetition: 2,
          localManifestDir: null,
          modes: ["standalone", "synara-default", "synara-activated"],
          onDiagnostic: (message) => process.stderr.write(`${message}\n`),
        });
        const report = result.report;
        expect(report.harnessVersion).toBe(HARNESS_VERSION);
        expect(report.prompt.hash).toBe(STIMULUS_HASH);
        // Every mode either ran with recorded repetitions or was skipped by config.
        expect(report.runSets.standalone).not.toBeNull();
        expect(report.runSets["synara-default"]).not.toBeNull();
        expect(report.runSets["synara-activated"]).not.toBeNull();
        for (const mode of ["standalone", "synara-default", "synara-activated"] as const) {
          const runSet = report.runSets[mode]!;
          expect(runSet.repetitions).toHaveLength(1);
          // Decision 35: every mode must produce a complete effective manifest
          // (standalone and default from the real tool API, activated through
          // the measurement-only observer); a fail-closed catalog no longer
          // carries the not-externally-capturable limitation.
          for (const repetition of runSet.repetitions) {
            expect(repetition.manifest.catalogComplete).toBe(true);
            expect(repetition.manifest.catalogIncompleteReason).toBeUndefined();
            expect(repetition.manifest.toolCount).toBeGreaterThan(0);
            expect(repetition.manifest.hash).toMatch(/^[0-9a-f]{64}$/);
          }
        }
        // Activated mode must expose the live Synara MCP tools in the complete
        // effective manifest captured after the real activation + reload.
        const activated = report.runSets["synara-activated"]!;
        const activatedNames = activated.repetitions.flatMap((r) => r.manifest.toolNames);
        expect(activatedNames.some((name) => name.startsWith("synara_"))).toBe(true);
        // Default mode must stay dormant: no Synara tools in the manifest.
        const defaultNames = report.runSets["synara-default"]!.repetitions.flatMap((r) =>
          r.manifest.toolNames,
        );
        expect(defaultNames.some((name) => name.startsWith("synara_"))).toBe(false);
        fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      } finally {
        fs.rmSync(workspaceCwd, { recursive: true, force: true });
      }
    },
    20 * 60 * 1_000,
  );
});
