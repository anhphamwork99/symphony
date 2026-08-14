// FILE: synaraMcpSessionConvergence.test.ts
// Purpose: Verifies impl-09 AC2 — runtime/session generation boundary. A
// session that starts, resumes, or is recreated converges ONLY from the final
// durable project state: while an activation operation is pending it waits
// (never before the exact operation terminal), a terminal enabled state
// activates through the public provider boundary with the exact fresh
// session generation (never a stale wait-set token), and every other state —
// terminal failed, terminal disabled, no operation, or a missing project —
// stays dormant. The convergence never writes project state, so a stale or
// duplicate convergence can never restore enabled state or replay completed
// work. Uses representative recovery states rather than the full impl-08
// wait-set matrix.
// Layer: Orchestration session-convergence tests
import {
  ProjectId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ProjectMcpActivationOperation,
} from "@synara/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  convergeSynaraMcpSession,
  decideSynaraMcpSessionConvergence,
  SYNARA_MCP_CONVERGENCE_ACTIVATION_BOUND_MS,
  SYNARA_MCP_CONVERGENCE_ACTIVATION_TIMEOUT_DETAIL,
  type SynaraMcpSessionConvergenceEnableResolution,
  type SynaraMcpSessionConvergenceSeams,
} from "./synaraMcpSessionConvergence.ts";
import { createEmptyReadModel } from "./projector.ts";

const now = "2026-08-12T12:00:00.000Z";
const projectId = ProjectId.makeUnsafe("project-mcp-convergence");
const threadId = ThreadId.makeUnsafe("thread-mcp-convergence");

function operation(overrides: Partial<ProjectMcpActivationOperation> = {}): ProjectMcpActivationOperation {
  return {
    projectId,
    requestId: "request-convergence",
    operationGeneration: 1,
    recoveryIdentity: "synara-mcp-recovery:01234567",
    issuingThreadId: threadId,
    absoluteDeadline: "2026-08-12T12:02:00.000Z",
    desiredState: "enabled",
    waitSet: [],
    outcomes: [],
    aggregateStatus: "pending",
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function projectWith(activationOperation: ProjectMcpActivationOperation | null): OrchestrationProject {
  return {
    id: projectId,
    kind: "project",
    title: "Convergence project",
    workspaceRoot: "/tmp/convergence",
    defaultModelSelection: null,
    scripts: [],
    isPinned: false,
    spaceId: null,
    createdAt: now,
    updatedAt: now,
    synaraMcpDesiredState: activationOperation?.desiredState ?? "disabled",
    synaraMcpActivationVersion: activationOperation?.version ?? 0,
    synaraMcpActivationOperation: activationOperation,
  } as unknown as OrchestrationProject;
}

function readModelWith(
  activationOperation: ProjectMcpActivationOperation | null,
  options: { readonly includeThread?: boolean } = {},
): OrchestrationReadModel {
  const thread = {
    id: threadId,
    projectId,
  } as unknown as OrchestrationThread;
  return {
    ...createEmptyReadModel(now),
    projects: [projectWith(activationOperation)],
    threads: options.includeThread === false ? [] : [thread],
  };
}

interface ConvergenceHarness {
  readonly model: () => OrchestrationReadModel;
  readonly enableCalls: Array<{
    readonly threadId: ThreadId;
    readonly expectedSessionGeneration: string;
    readonly liveSessionGeneration: string | undefined;
  }>;
  readonly enable: ReturnType<typeof vi.fn<SynaraMcpSessionConvergenceSeams["enable"]>>;
}

function makeHarness(options: {
  readonly model: OrchestrationReadModel;
  readonly resolution?: SynaraMcpSessionConvergenceEnableResolution;
  readonly enableError?: unknown;
  readonly neverResolves?: boolean;
}): ConvergenceHarness {
  let model = options.model;
  const enableCalls: ConvergenceHarness["enableCalls"] = [];
  const enable = vi.fn<SynaraMcpSessionConvergenceSeams["enable"]>(
    async (input: {
      threadId: ThreadId;
      expectedSessionGeneration: string;
      liveSessionGeneration: string | undefined;
    }) => {
      enableCalls.push(input);
      if (options.neverResolves) {
        return new Promise<SynaraMcpSessionConvergenceEnableResolution>(() => {});
      }
      if (options.enableError !== undefined) {
        throw options.enableError;
      }
      return options.resolution ?? { state: "active" };
    },
  );
  return {
    model: () => model,
    enableCalls,
    enable,
  };
}

describe("impl-09 AC2: session convergence from the final durable project state", () => {
  it("decides wait, activate, or dormant from representative durable states", () => {
    expect(decideSynaraMcpSessionConvergence(undefined)).toBe("dormant");
    expect(decideSynaraMcpSessionConvergence(projectWith(null))).toBe("dormant");
    expect(decideSynaraMcpSessionConvergence(projectWith(operation()))).toBe("wait");
    expect(
      decideSynaraMcpSessionConvergence(projectWith(operation({ desiredState: "disabled" }))),
    ).toBe("wait");
    expect(
      decideSynaraMcpSessionConvergence(
        projectWith(operation({ aggregateStatus: "succeeded" })),
      ),
    ).toBe("activate");
    // A terminal failed operation always leaves the project disabled.
    expect(
      decideSynaraMcpSessionConvergence(
        projectWith(
          operation({
            aggregateStatus: "failed",
            desiredState: "disabled",
          }),
        ),
      ),
    ).toBe("dormant");
    expect(
      decideSynaraMcpSessionConvergence(
        projectWith(
          operation({ aggregateStatus: "succeeded", desiredState: "disabled" }),
        ),
      ),
    ).toBe("dormant");
  });

  it("waits for a pending operation and never activates before its exact terminal", async () => {
    for (const desiredState of ["enabled", "disabled"] as const) {
      const harness = makeHarness({
        model: readModelWith(operation({ desiredState })),
      });
      const result = await convergeSynaraMcpSession({
        threadId,
        sessionUpdatedAt: now,
        seams: {
          getReadModel: async () => harness.model(),
          enable: harness.enable,
        },
      });
      expect(result).toEqual({ kind: "waiting" });
      expect(harness.enable).not.toHaveBeenCalled();
    }
  });

  it("stays dormant for disabled, no-operation, and missing-project states", async () => {
    const dormantStates: Array<OrchestrationReadModel> = [
      readModelWith(
        operation({ aggregateStatus: "succeeded", desiredState: "disabled" }),
      ),
      readModelWith(
        operation({ aggregateStatus: "failed", desiredState: "disabled" }),
      ),
      readModelWith(null),
      readModelWith(null, { includeThread: false }),
      {
        ...createEmptyReadModel(now),
        projects: [],
        threads: [],
      },
    ];
    for (const model of dormantStates) {
      const harness = makeHarness({ model });
      const result = await convergeSynaraMcpSession({
        threadId,
        sessionUpdatedAt: now,
        seams: {
          getReadModel: async () => harness.model(),
          enable: harness.enable,
        },
      });
      expect(result).toEqual({ kind: "dormant" });
      expect(harness.enable).not.toHaveBeenCalled();
    }
  });

  it("activates a terminal-enabled project with the exact fresh session generation", async () => {
    const harness = makeHarness({
      model: readModelWith(operation({ aggregateStatus: "succeeded" })),
    });
    const result = await convergeSynaraMcpSession({
      threadId,
      // The EXACT generation of the session that was just ensured: recreated
      // runtimes converge under their own fresh generation, never a stale
      // wait-set token.
      sessionUpdatedAt: "2026-08-12T12:00:05.000Z",
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result).toEqual({ kind: "activated" });
    expect(harness.enable).toHaveBeenCalledTimes(1);
    expect(harness.enableCalls[0]).toEqual({
      threadId,
      expectedSessionGeneration: `orchestration:${threadId}:2026-08-12T12:00:05.000Z`,
      liveSessionGeneration: `orchestration:${threadId}:2026-08-12T12:00:05.000Z`,
    });
  });

  it("degrades to dormant when the activation cannot be proven (unavailable)", async () => {
    const harness = makeHarness({
      model: readModelWith(operation({ aggregateStatus: "succeeded" })),
      resolution: { state: "unavailable", detail: "activation refused" },
    });
    const result = await convergeSynaraMcpSession({
      threadId,
      sessionUpdatedAt: now,
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("Expected unavailable");
    expect(result.detail).toContain("activation refused");
  });

  it("degrades to dormant when the provider boundary throws, without propagating", async () => {
    const harness = makeHarness({
      model: readModelWith(operation({ aggregateStatus: "succeeded" })),
      enableError: new Error("provider exploded"),
    });
    const result = await convergeSynaraMcpSession({
      threadId,
      sessionUpdatedAt: now,
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result.kind).toBe("unavailable");
  });

  it("bounds a hung activation and reports the timeout detail", async () => {
    const harness = makeHarness({
      model: readModelWith(operation({ aggregateStatus: "succeeded" })),
      neverResolves: true,
    });
    const result = await convergeSynaraMcpSession({
      threadId,
      sessionUpdatedAt: now,
      boundMs: 10,
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result.kind).toBe("unavailable");
    if (result.kind !== "unavailable") throw new Error("Expected unavailable");
    expect(result.detail).toBe(SYNARA_MCP_CONVERGENCE_ACTIVATION_TIMEOUT_DETAIL);
    expect(SYNARA_MCP_CONVERGENCE_ACTIVATION_BOUND_MS).toBe(30_000);
  });

  it("never writes project state: enable is the only possible side effect", async () => {
    const harness = makeHarness({
      model: readModelWith(operation({ aggregateStatus: "succeeded" })),
    });
    const result = await convergeSynaraMcpSession({
      threadId,
      sessionUpdatedAt: now,
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result).toEqual({ kind: "activated" });
    // The module exposes no dispatch/project-state seam at all: a stale or
    // duplicate convergence physically cannot restore enabled state.
    expect(harness.enable).toHaveBeenCalledTimes(1);
    expect(harness.model().projects[0]?.synaraMcpActivationOperation?.aggregateStatus).toBe(
      "succeeded",
    );
  });

  it("activates from a legacy terminal-enabled operation (identity is not required for terminal state)", async () => {
    const legacyTerminalEnabled = operation({
      aggregateStatus: "succeeded",
      recoveryIdentity: undefined,
      issuingThreadId: undefined,
    });
    const harness = makeHarness({ model: readModelWith(legacyTerminalEnabled) });
    const result = await convergeSynaraMcpSession({
      threadId,
      sessionUpdatedAt: now,
      seams: {
        getReadModel: async () => harness.model(),
        enable: harness.enable,
      },
    });
    expect(result).toEqual({ kind: "activated" });
    expect(harness.enable).toHaveBeenCalledTimes(1);
  });
});
