import { describe, expect, it, vi } from "vitest";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentHandshakeRequest,
} from "@synara/contracts";

import {
  makeCompatiblePiSubagentExtension,
  makeFailingPiSubagentExtension,
  makeLegacyPiSubagentExtension,
  makeUnsupportedPiSubagentExtension,
  negotiatePiSubagentCapability,
  PI_SUBAGENT_BRIDGE_KEY,
  probePiSubagentBridge,
} from "./piSubagentBridge.ts";

describe("Pi subagent extension bridge & versioned handshake", () => {
  it("T01-AC1: successfully negotiates capability with compatible bridge fixture", async () => {
    const { extension, bridge } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: [...PI_SUBAGENT_CAPABILITIES],
      extensionVersion: "0.1.0",
    });

    const result = await negotiatePiSubagentCapability(bridge);

    expect(result.isManaged).toBe(true);
    expect(result.status).toBe("managed_enabled");
    expect(result.diagnosticCode).toBe("pi_subagent_managed_enabled");
    expect(result.protocolVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(result.extensionVersion).toBe("0.1.0");
    expect(result.capabilities).toEqual(PI_SUBAGENT_CAPABILITIES);
  });

  it("T01-AC1, T01-AC3: fails closed with offered-versus-supported context when bridge returns unsupported version", async () => {
    const { bridge } = makeUnsupportedPiSubagentExtension({
      protocolVersion: 99,
      supportedVersions: [99, 100],
      extensionVersion: "2.0.0",
      detail: "Requires protocol version 99+",
    });

    const result = await negotiatePiSubagentCapability(bridge);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("unsupported_version");
    expect(result.diagnosticCode).toBe("pi_subagent_unsupported_version");
    expect(result.offeredVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(result.supportedVersions).toEqual([99, 100]);
    expect(result.extensionVersion).toBe("2.0.0");
    expect(result.diagnosticMessage).toContain("Requires protocol version 99+");
  });

  it("T01-AC2, T01-AC3: returns bridge_absent diagnostic code when probing legacy extension without bridge", async () => {
    const { extension } = makeLegacyPiSubagentExtension();

    const result = await probePiSubagentBridge(extension);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_absent");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
    expect(result.diagnosticMessage).toBeDefined();
  });

  it("T01-AC3: returns bridge_error diagnostic code when bridge throws during handshake", async () => {
    const { bridge } = makeFailingPiSubagentExtension(new Error("Bridge explosion in test"));

    const result = await negotiatePiSubagentCapability(bridge);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_error");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_error");
    expect(result.diagnosticMessage).toContain("Bridge explosion in test");
  });

  it("T01-AC3: returns bridge_error when bridge returns malformed response", async () => {
    const malformedBridge = {
      handshake: vi.fn().mockResolvedValue({ not_a_valid_field: 123 }),
    };

    const result = await negotiatePiSubagentCapability(malformedBridge as any);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_error");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_error");
  });

  it("T01-AC5: probe is idempotent and produces no side effects on repeated calls", async () => {
    const handshakeSpy = vi.fn().mockResolvedValue({
      ok: true,
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      extensionVersion: "0.1.0",
      capabilities: [...PI_SUBAGENT_CAPABILITIES],
    });
    const bridge = { handshake: handshakeSpy };
    const sessionLike = { [PI_SUBAGENT_BRIDGE_KEY]: bridge };

    const first = await probePiSubagentBridge(sessionLike);
    const second = await probePiSubagentBridge(sessionLike);

    expect(first).toEqual(second);
    expect(handshakeSpy).toHaveBeenCalledTimes(1);
  });

  it("T02-AC2: bridge accepts server-minted executionId and attemptId and emits lifecycle event with identities", async () => {
    const spawnSpy = vi.fn().mockResolvedValue({
      status: "accepted",
      executionId: "exec_server_123",
      attemptId: "att_server_456",
      generation: 1,
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
    });

    const { extension, bridge, emittedEvents } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: [...PI_SUBAGENT_CAPABILITIES],
      onSpawn: spawnSpy,
    });

    // Mock pi runtime initializing extension
    let registeredAgentTool: any;
    const piMock = {
      on: vi.fn(),
      registerTool: (tool: any) => {
        if (tool.name === "Agent") {
          registeredAgentTool = tool;
        }
      },
    };

    extension.factory(piMock);
    expect(registeredAgentTool).toBeDefined();

    const toolResult = await registeredAgentTool.execute("call_tool_99", {
      commandId: "cmd_spawn_test",
      projectId: "proj_default",
      parentThreadId: "thread_main",
      parentTurnId: "turn_1",
      agentType: "tester",
      prompt: "Run test suite",
    });

    expect(spawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "cmd_spawn_test",
        projectId: "proj_default",
        parentThreadId: "thread_main",
        parentTurnId: "turn_1",
      }),
    );

    expect(toolResult.executionId).toBe("exec_server_123");
    expect(toolResult.attemptId).toBe("att_server_456");
    expect(toolResult.generation).toBe(1);

    // Verify lifecycle event emitted under server-minted identities
    expect(emittedEvents.length).toBe(1);
    expect(emittedEvents[0]!.executionId).toBe("exec_server_123");
    expect(emittedEvents[0]!.attemptId).toBe("att_server_456");
    expect(emittedEvents[0]!.generation).toBe(1);
    expect(emittedEvents[0]!.state).toBe("running");
  });
});

