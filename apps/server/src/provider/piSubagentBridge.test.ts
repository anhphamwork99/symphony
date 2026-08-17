import { describe, expect, it, vi } from "vitest";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentHandshakeRequest,
} from "@synara/contracts";

import {
  attachPiSubagentManagedForegroundBinding,
  createDefaultHandshakeRequest,
  getPiSubagentManagedForegroundBinding,
  isPiSubagentManagedForegroundBinding,
  makeCompatiblePiSubagentExtension,
  makeFailingPiSubagentExtension,
  makeLegacyPiSubagentExtension,
  makeUnsupportedPiSubagentExtension,
  negotiatePiSubagentCapability,
  PI_SUBAGENT_BRIDGE_KEY,
  PI_SUBAGENT_MANAGED_FOREGROUND_KEY,
  type PiSubagentManagedForegroundBinding,
  type PiSubagentObservationInput,
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

  it("default handshake request requires managed-spawn, abort-propagation, and bounded-foreground-attachment (WP-03)", () => {
    const defaultRequest = createDefaultHandshakeRequest();
    expect(defaultRequest.protocolVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(defaultRequest.requiredCapabilities).toEqual([
      "managed-spawn",
      "abort-propagation",
      "bounded-foreground-attachment",
    ]);
    expect(defaultRequest.optionalCapabilities).toContain("coalesced-progress");
  });

  it("sends older extension without bounded-foreground-attachment to capability mismatch and unmanaged fallback", async () => {
    const { bridge } = makeCompatiblePiSubagentExtension({
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      capabilities: ["managed-spawn", "abort-propagation"], // Older extension without bounded-foreground-attachment
      extensionVersion: "0.1.0",
    });

    const result = await negotiatePiSubagentCapability(bridge);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("capability_mismatch");
    expect(result.diagnosticCode).toBe("pi_subagent_capability_mismatch");
    expect(result.missingCapabilities).toEqual(["bounded-foreground-attachment"]);
    expect(result.capabilities).toEqual(["managed-spawn", "abort-propagation"]);
    expect(result.diagnosticMessage).toContain("bounded-foreground-attachment");
  });
});

describe("Pi subagent managed foreground binding (Issue 22 / WP-02)", () => {
  const createValidBinding = (
    overrides?: Partial<PiSubagentManagedForegroundBinding>,
  ): PiSubagentManagedForegroundBinding => ({
    executionId: "exec_test_001",
    attemptId: "att_test_001",
    generation: 1,
    cancellationScope: "parent_turn",
    foregroundWaitMs: 10000,
    reportObservation: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  it("exports the canonical managed foreground private symbol key", () => {
    expect(PI_SUBAGENT_MANAGED_FOREGROUND_KEY).toBe(
      Symbol.for("synara.pi.subagents.managed_foreground.v1"),
    );
  });

  describe("isPiSubagentManagedForegroundBinding", () => {
    it("accepts a complete, valid binding object", () => {
      const binding = createValidBinding();
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
    });

    it("rejects non-object and nullish values", () => {
      expect(isPiSubagentManagedForegroundBinding(null)).toBe(false);
      expect(isPiSubagentManagedForegroundBinding(undefined)).toBe(false);
      expect(isPiSubagentManagedForegroundBinding("string")).toBe(false);
      expect(isPiSubagentManagedForegroundBinding(123)).toBe(false);
      expect(isPiSubagentManagedForegroundBinding(true)).toBe(false);
    });

    it("rejects missing, empty, or whitespace-only executionId", () => {
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ executionId: "" }))).toBe(
        false,
      );
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ executionId: "   " }))).toBe(
        false,
      );
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ executionId: undefined as any })),
      ).toBe(false);
    });

    it("rejects missing, empty, or whitespace-only attemptId", () => {
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ attemptId: "" }))).toBe(
        false,
      );
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ attemptId: "   " }))).toBe(
        false,
      );
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ attemptId: undefined as any })),
      ).toBe(false);
    });

    it("rejects non-positive, non-integer, or non-finite generation", () => {
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ generation: 0 }))).toBe(
        false,
      );
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ generation: -1 }))).toBe(
        false,
      );
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ generation: 1.5 }))).toBe(
        false,
      );
      expect(isPiSubagentManagedForegroundBinding(createValidBinding({ generation: NaN }))).toBe(
        false,
      );
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ generation: Infinity })),
      ).toBe(false);
    });

    it("rejects scope other than parent_turn", () => {
      expect(
        isPiSubagentManagedForegroundBinding(
          createValidBinding({ cancellationScope: "session" as any }),
        ),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(
          createValidBinding({ cancellationScope: "independent" as any }),
        ),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ cancellationScope: "" as any })),
      ).toBe(false);
    });

    it("rejects out-of-range, non-integer, or non-finite foregroundWaitMs", () => {
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: 99 })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: 60001 })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: 0 })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: -500 })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: 1000.5 })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: NaN })),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(createValidBinding({ foregroundWaitMs: Infinity })),
      ).toBe(false);
    });

    it("rejects missing or non-function reportObservation", () => {
      expect(
        isPiSubagentManagedForegroundBinding(
          createValidBinding({ reportObservation: "not-a-fn" as any }),
        ),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(
          createValidBinding({ reportObservation: null as any }),
        ),
      ).toBe(false);
      expect(
        isPiSubagentManagedForegroundBinding(
          createValidBinding({ reportObservation: undefined as any }),
        ),
      ).toBe(false);
    });
  });

  describe("getPiSubagentManagedForegroundBinding and attachPiSubagentManagedForegroundBinding", () => {
    it("extracts binding when present on object under the private symbol", () => {
      const binding = createValidBinding();
      const ctx = { [PI_SUBAGENT_MANAGED_FOREGROUND_KEY]: binding };
      expect(getPiSubagentManagedForegroundBinding(ctx)).toBe(binding);
    });

    it("returns undefined when private symbol is missing or binding is malformed", () => {
      expect(getPiSubagentManagedForegroundBinding({})).toBeUndefined();
      expect(getPiSubagentManagedForegroundBinding(null)).toBeUndefined();
      expect(getPiSubagentManagedForegroundBinding(undefined)).toBeUndefined();
      expect(getPiSubagentManagedForegroundBinding("not-an-object")).toBeUndefined();
      expect(
        getPiSubagentManagedForegroundBinding({
          [PI_SUBAGENT_MANAGED_FOREGROUND_KEY]: { invalid: true },
        }),
      ).toBeUndefined();
    });

    it("attaches immutable binding to a copied context without mutating the source context", () => {
      const originalCtx = { toolCallId: "call_abc", extra: 42 };
      const binding = createValidBinding();

      const boundCtx = attachPiSubagentManagedForegroundBinding(originalCtx, binding);

      expect(boundCtx).not.toBe(originalCtx);
      expect(PI_SUBAGENT_MANAGED_FOREGROUND_KEY in originalCtx).toBe(false);
      expect(getPiSubagentManagedForegroundBinding(boundCtx)).toEqual(binding);
      expect(boundCtx.toolCallId).toBe("call_abc");
      expect(boundCtx.extra).toBe(42);
      expect(Object.isFrozen(boundCtx)).toBe(true);
    });

    it("throws TypeError if trying to attach an invalid binding", () => {
      const originalCtx = { toolCallId: "call_abc" };
      expect(() =>
        attachPiSubagentManagedForegroundBinding(originalCtx, { invalid: true } as any),
      ).toThrow(TypeError);
    });
  });

  describe("context isolation across concurrent invocations", () => {
    it("two copied contexts hold distinct bindings with no cross-observation", async () => {
      const observations1: PiSubagentObservationInput[] = [];
      const observations2: PiSubagentObservationInput[] = [];

      const binding1 = createValidBinding({
        executionId: "exec_111",
        attemptId: "att_111",
        generation: 1,
        foregroundWaitMs: 5000,
        reportObservation: async (obs) => {
          observations1.push(obs);
        },
      });

      const binding2 = createValidBinding({
        executionId: "exec_222",
        attemptId: "att_222",
        generation: 2,
        foregroundWaitMs: 15000,
        reportObservation: async (obs) => {
          observations2.push(obs);
        },
      });

      const baseCtx = { sessionToken: "shared-token" };
      const ctx1 = attachPiSubagentManagedForegroundBinding(baseCtx, binding1);
      const ctx2 = attachPiSubagentManagedForegroundBinding(baseCtx, binding2);

      const resolved1 = getPiSubagentManagedForegroundBinding(ctx1);
      const resolved2 = getPiSubagentManagedForegroundBinding(ctx2);

      expect(resolved1?.executionId).toBe("exec_111");
      expect(resolved2?.executionId).toBe("exec_222");
      expect(resolved1?.foregroundWaitMs).toBe(5000);
      expect(resolved2?.foregroundWaitMs).toBe(15000);

      // Perform observation on context 1
      await resolved1?.reportObservation({
        kind: "started",
        occurredAt: "2026-08-17T12:00:00.000Z",
      });

      expect(observations1).toEqual([
        { kind: "started", occurredAt: "2026-08-17T12:00:00.000Z" },
      ]);
      expect(observations2).toEqual([]);

      // Perform observation on context 2
      await resolved2?.reportObservation({
        kind: "detached",
        occurredAt: "2026-08-17T12:00:15.000Z",
      });

      expect(observations1).toHaveLength(1);
      expect(observations2).toEqual([
        { kind: "detached", occurredAt: "2026-08-17T12:00:15.000Z" },
      ]);
    });
  });
});

