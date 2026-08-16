import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENTS_PROTOCOL_VERSION,
} from "@synara/contracts";

import {
  makeCompatiblePiSubagentExtension,
  makeFailingPiSubagentExtension,
  makeLegacyPiSubagentExtension,
  makeUnsupportedPiSubagentExtension,
  probePiSubagentBridge,
} from "./piSubagentBridge.ts";

async function createTestPiSession(extensionFactories: readonly any[]) {
  const cwd = "/tmp";
  const agentDir = `/tmp/synara-pi-session-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const modelRuntime = await ModelRuntime.create({
    authPath: `${agentDir}/auth.json`,
    modelsPath: null,
  });
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime,
    resourceLoaderOptions: { extensionFactories: [...extensionFactories] },
  });
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(cwd),
  });

  await session.bindExtensions({});
  return { session, services };
}

describe("Pi provider session subagent capability negotiation (T01-AC2, T01-AC3, T01-AC4)", () => {
  it("negotiates managed capability on session start with compatible extension fixture", async () => {
    const { extension } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
    });

    const { session } = await createTestPiSession([extension]);

    const result = await probePiSubagentBridge(session);

    expect(result.isManaged).toBe(true);
    expect(result.status).toBe("managed_enabled");
    expect(result.diagnosticCode).toBe("pi_subagent_managed_enabled");
    expect(result.protocolVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(result.extensionVersion).toBe("0.1.0");

    session.dispose();
  });

  it("fails closed with unsupported_version diagnostic code when extension has unsupported protocol version", async () => {
    const { extension } = makeUnsupportedPiSubagentExtension({
      protocolVersion: 99,
      supportedVersions: [99],
      extensionVersion: "2.0.0",
      detail: "Requires protocol 99",
    });

    const { session } = await createTestPiSession([extension]);

    const result = await probePiSubagentBridge(session);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("unsupported_version");
    expect(result.diagnosticCode).toBe("pi_subagent_unsupported_version");
    expect(result.offeredVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(result.supportedVersions).toEqual([99]);
    expect(result.diagnosticMessage).toContain("Requires protocol 99");

    session.dispose();
  });

  it("handles legacy extension without bridge gracefully as bridge_absent", async () => {
    const { extension } = makeLegacyPiSubagentExtension();

    const { session } = await createTestPiSession([extension]);

    const result = await probePiSubagentBridge(session);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_absent");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
    expect(result.diagnosticMessage).toBeDefined();

    // Verify native / legacy tool is present and working
    const tools = session.getAllTools();
    const agentTool = tools.find((t) => t.name === "Agent");
    expect(agentTool).toBeDefined();

    session.dispose();
  });

  it("handles failing bridge gracefully with bridge_error diagnostic code", async () => {
    const { extension } = makeFailingPiSubagentExtension(new Error("Startup bridge failure"));

    const { session } = await createTestPiSession([extension]);

    const result = await probePiSubagentBridge(session);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_error");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_error");
    expect(result.diagnosticMessage).toContain("Startup bridge failure");

    session.dispose();
  });
});

describe("Pi provider session subagent admission and legacy bypass (T02-AC2, T02-AC4, T02-AC6)", () => {
  it("T02-AC2, T02-AC4: managed session runs subagent with server-minted identities and fails when denied", async () => {
    let spawnCount = 0;
    const { extension, bridge, emittedEvents } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation"],
      onSpawn: async (cmd) => {
        spawnCount++;
        if (cmd.agentType === "denied_agent") {
          return {
            status: "rejected",
            executionId: "exec_denied",
            attemptId: "att_denied",
            generation: 1,
            state: "rejected",
            diagnosticCode: "pi_subagent_admission_unauthorized",
            rejectionReason: "Spawn unauthorized for this agent type",
          };
        }
        return {
          status: "accepted",
          executionId: `exec_${spawnCount}`,
          attemptId: `att_${spawnCount}`,
          generation: 1,
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
        };
      },
    });

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(true);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");
    expect(agentTool?.definition?.execute).toBeDefined();

    // 1. Authorized call
    const authorizedResult = await agentTool.definition.execute("call_1", {
      commandId: "cmd_auth_1",
      agentType: "authorized_agent",
      prompt: "Do work",
    });

    expect((authorizedResult as any).executionId).toBe("exec_1");
    expect((authorizedResult as any).attemptId).toBe("att_1");
    expect((authorizedResult as any).generation).toBe(1);
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]!.executionId).toBe("exec_1");

    // 2. Denied call produces no child execution / running event
    const deniedResult = await agentTool.definition.execute("call_2", {
      commandId: "cmd_denied_1",
      agentType: "denied_agent",
      prompt: "Forbidden work",
    });

    expect(deniedResult.isError).toBe(true);
    expect((deniedResult as any).content[0].text).toContain("rejected");
    // Emitted events count should NOT have increased for the denied call
    expect(emittedEvents.length).toBe(1);

    session.dispose();
  });

  it("T02-AC6: unhandshaked legacy session bypasses managed admission path entirely", async () => {
    const { extension } = makeLegacyPiSubagentExtension();

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(false);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");
    expect(agentTool?.definition?.execute).toBeDefined();

    const result = await agentTool.definition.execute("call_legacy_1", {
      prompt: "Legacy prompt without managed IDs",
    });

    expect((result as any).content[0].text).toBe("legacy response");
    expect((result as any).executionId).toBeUndefined();

    session.dispose();
  });
});

describe("Pi provider session admission fails closed (Ticket 03: T03-AC1, T03-AC3, T03-AC6)", () => {
  it("T03-AC1, T03-AC2: tool execution fails closed and emits no child running event when admission persistence fails", async () => {
    const { extension, emittedEvents } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation"],
      onSpawn: async () => ({
        status: "rejected",
        executionId: "exec_rejected_pers",
        attemptId: "att_rejected_pers",
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_lifecycle_persistence_failed",
        rejectionReason: "Failed to persist execution lifecycle truth to durable store",
      }),
    });

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(true);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");

    const result = await agentTool.definition.execute("call_fail_1", {
      commandId: "cmd_fail_1",
      agentType: "researcher",
      prompt: "Research task",
    });

    // Proves child spawn is prevented and stable persistence diagnostic is returned
    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain("pi_subagent_lifecycle_persistence_failed");
    expect(emittedEvents.length).toBe(0);

    session.dispose();
  });

  it("T03-AC3: tool execution fails closed with degraded diagnostic when control health is degraded", async () => {
    const { extension, emittedEvents } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation"],
      onSpawn: async () => ({
        status: "rejected",
        executionId: "exec_rejected_degraded",
        attemptId: "att_rejected_degraded",
        generation: 1,
        state: "rejected",
        diagnosticCode: "pi_subagent_control_degraded",
        rejectionReason: "Managed subagent control health is degraded due to persistence unavailability",
      }),
    });

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(true);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");

    const result = await agentTool.definition.execute("call_fail_2", {
      commandId: "cmd_fail_2",
      agentType: "researcher",
      prompt: "Research task",
    });

    expect(result.isError).toBe(true);
    expect((result as any).content[0].text).toContain("pi_subagent_control_degraded");
    expect(emittedEvents.length).toBe(0);

    session.dispose();
  });
});

describe("Pi subagent admission and legacy bypass (Issue 20: T20-AC6, T20-AC7)", () => {
  it("T20-AC6: managed tool execution returns server-minted executionId, attemptId, generation on success and stable error on denial", async () => {
    let spawnCalled = false;
    const { extension, emittedEvents } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation"],
      onSpawn: async (cmd) => {
        spawnCalled = true;
        if (cmd.agentType === "denied_type") {
          return {
            status: "rejected",
            executionId: "exec_denied_test",
            attemptId: "att_denied_test",
            generation: 1,
            state: "rejected",
            diagnosticCode: "pi_subagent_admission_unauthorized",
            rejectionReason: "Spawn unauthorized for agent type",
          };
        }
        return {
          status: "accepted",
          executionId: "exec_accepted_test",
          attemptId: "att_accepted_test",
          generation: 1,
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
        };
      },
    });

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(true);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");

    // Success call
    const okResult = await agentTool.definition.execute("call_ok", {
      commandId: "cmd_ok_1",
      agentType: "researcher",
      prompt: "Research task",
    });

    expect((okResult as any).executionId).toBe("exec_accepted_test");
    expect((okResult as any).attemptId).toBe("att_accepted_test");
    expect((okResult as any).generation).toBe(1);
    expect(emittedEvents.length).toBe(1);

    // Denied call
    const deniedResult = await agentTool.definition.execute("call_denied", {
      commandId: "cmd_denied_2",
      agentType: "denied_type",
      prompt: "Forbidden task",
    });

    expect(deniedResult.isError).toBe(true);
    expect((deniedResult as any).content[0].text).toContain("pi_subagent_admission_unauthorized");
    // No additional child emitted
    expect(emittedEvents.length).toBe(1);

    session.dispose();
  });

  it("T20-AC7: unmanaged/legacy session bypasses managed admission path entirely", async () => {
    const { extension } = makeLegacyPiSubagentExtension();

    const { session, services } = await createTestPiSession([extension]);
    const capability = await probePiSubagentBridge(session);
    expect(capability.isManaged).toBe(false);

    const loadedExt = services.resourceLoader.getExtensions().extensions[0] as any;
    const agentTool = loadedExt.tools.get("Agent");

    const result = await agentTool.definition.execute("call_legacy_bypass", {
      prompt: "Legacy work without managed admission",
    });

    expect((result as any).content[0].text).toBe("legacy response");
    expect((result as any).executionId).toBeUndefined();

    session.dispose();
  });
});
