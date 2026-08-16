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

describe("Pi subagent extension bridge & versioned handshake (Issue 19)", () => {
  it("successfully negotiates capability with compatible bridge fixture", async () => {
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

  it("fails closed with offered-versus-supported context when bridge returns unsupported version", async () => {
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

  it("returns bridge_absent diagnostic code when probing legacy extension without bridge", async () => {
    const { extension } = makeLegacyPiSubagentExtension();

    const result = await probePiSubagentBridge(extension);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_absent");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_absent");
    expect(result.diagnosticMessage).toBeDefined();
  });

  it("returns bridge_error diagnostic code when bridge throws during handshake", async () => {
    const { bridge } = makeFailingPiSubagentExtension(new Error("Bridge explosion in test"));

    const result = await negotiatePiSubagentCapability(bridge);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_error");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_error");
    expect(result.diagnosticMessage).toContain("Bridge explosion in test");
  });

  it("returns bridge_malformed_response when bridge returns malformed response", async () => {
    const malformedBridge = {
      handshake: vi.fn().mockResolvedValue({ not_a_valid_field: 123 }),
    };

    const result = await negotiatePiSubagentCapability(malformedBridge as any);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("bridge_malformed_response");
    expect(result.diagnosticCode).toBe("pi_subagent_bridge_malformed_response");
  });

  it("fails closed with capability_mismatch when bridge returns missing_capabilities error", async () => {
    const bridge = {
      handshake: vi.fn().mockResolvedValue({
        ok: false,
        error: "missing_capabilities",
        protocolVersion: 1,
        extensionVersion: "0.10.0-alfie.1",
        missingCapabilities: ["terminal-outbox"],
        detail: "Extension does not support terminal-outbox",
      }),
    };

    const result = await negotiatePiSubagentCapability(bridge as any);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("capability_mismatch");
    expect(result.diagnosticCode).toBe("pi_subagent_capability_mismatch");
    expect(result.missingCapabilities).toEqual(["terminal-outbox"]);
    expect(result.diagnosticMessage).toContain("terminal-outbox");
  });

  it("fails closed with capability_mismatch when success response omits a required capability", async () => {
    const { bridge } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn"], // Omits "abort-propagation" which is required by default
      extensionVersion: "0.1.0",
    });

    const result = await negotiatePiSubagentCapability(bridge, {
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      supportedProtocolVersions: [PI_SUBAGENTS_PROTOCOL_VERSION],
      clientVersion: "0.7.2",
      requiredCapabilities: ["managed-spawn", "abort-propagation"],
    });

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("capability_mismatch");
    expect(result.diagnosticCode).toBe("pi_subagent_capability_mismatch");
    expect(result.missingCapabilities).toEqual(["abort-propagation"]);
    expect(result.capabilities).toEqual(["managed-spawn"]);
    expect(result.diagnosticMessage).toContain("abort-propagation");
  });

  it("probe is idempotent and produces no side effects on repeated calls", async () => {
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
});
