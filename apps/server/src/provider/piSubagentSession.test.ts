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
