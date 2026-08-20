import { describe, expect, it, vi } from "vitest";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentHandshakeRequest,
  type PiSubagentTeardownOwnedProcessesCommand,
  type PiSubagentTeardownOwnedProcessesResult,
} from "@synara/contracts";

import {
  attachPiSubagentManagedForegroundBinding,
  createDefaultHandshakeRequest,
  dispatchPiSubagentTeardownOwnedProcesses,
  getPiSubagentManagedForegroundBinding,
  isPiSubagentManagedForegroundBinding,
  makeCompatiblePiSubagentExtension,
  makeFailingPiSubagentExtension,
  makeLegacyPiSubagentExtension,
  makeUnsupportedPiSubagentExtension,
  negotiatePiSubagentCapability,
  negotiationSupportsPiSubagentCapability,
  PI_SUBAGENT_BRIDGE_KEY,
  PI_SUBAGENT_MANAGED_FOREGROUND_KEY,
  PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
  type PiSubagentManagedForegroundBinding,
  type PiSubagentObservationInput,
  probePiSubagentBridge,
  validatePiSubagentTeardownOwnedProcessesResult,
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

      expect(observations1).toEqual([{ kind: "started", occurredAt: "2026-08-17T12:00:00.000Z" }]);
      expect(observations2).toEqual([]);

      // Perform observation on context 2
      await resolved2?.reportObservation({
        kind: "detached",
        occurredAt: "2026-08-17T12:00:15.000Z",
      });

      expect(observations1).toHaveLength(1);
      expect(observations2).toEqual([{ kind: "detached", occurredAt: "2026-08-17T12:00:15.000Z" }]);
    });
  });
});

describe("Pi subagent managed foreground binding observation kinds & policy (Issue 23 / WP-B)", () => {
  const createValidBinding = (
    overrides?: Record<string, unknown>,
  ): PiSubagentManagedForegroundBinding =>
    ({
      executionId: "exec_t23_001",
      attemptId: "att_t23_001",
      generation: 1,
      cancellationScope: "parent_turn",
      foregroundWaitMs: 10000,
      reportObservation: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    }) as PiSubagentManagedForegroundBinding;

  describe("guard accepts the widened observation kinds pass-through (types only — reportObservation is opaque)", () => {
    it("accepts a binding whose reportObservation will receive progress/heartbeat kinds", () => {
      const binding = createValidBinding();
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
    });
  });

  describe("isPiSubagentManagedForegroundBinding policy field matrix", () => {
    it("accepts a valid progress + heartbeat policy", () => {
      const binding = createValidBinding({
        progress: { rateHz: 2 },
        heartbeat: { intervalMs: 10000, leaseMs: 30000 },
      });
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
    });

    it("accepts a binding with NO policy fields (legacy binding)", () => {
      const binding = createValidBinding();
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
      expect("progress" in binding).toBe(false);
      expect("heartbeat" in binding).toBe(false);
    });

    it("accepts a binding with only a progress policy", () => {
      const binding = createValidBinding({ progress: { rateHz: 0.5 } });
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
    });

    it("accepts a binding with only a heartbeat policy", () => {
      const binding = createValidBinding({
        heartbeat: { intervalMs: 100, leaseMs: 1000 },
      });
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
    });

    it("still accepts (but later strips) structurally invalid progress policy", () => {
      // Policy fields are validated only when present; malformed policy does
      // NOT reject the core binding — the extraction path strips it.
      const binding = createValidBinding({ progress: { rateHz: 99 } });
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
      const stripped = getPiSubagentManagedForegroundBinding(
        attachPiSubagentManagedForegroundBinding({}, binding),
      );
      expect(stripped).toBeDefined();
      expect(stripped?.progress).toBeUndefined();
    });

    it("still accepts (but later strips) structurally invalid heartbeat policy", () => {
      const binding = createValidBinding({
        heartbeat: { intervalMs: 10, leaseMs: 30000 },
      });
      expect(isPiSubagentManagedForegroundBinding(binding)).toBe(true);
      const stripped = getPiSubagentManagedForegroundBinding(
        attachPiSubagentManagedForegroundBinding({}, binding),
      );
      expect(stripped?.heartbeat).toBeUndefined();
    });
  });

  describe("normalizePiSubagentManagedForegroundBinding policy matrix", () => {
    it("passes a fully valid policy through untouched", () => {
      const policy = { rateHz: 4 };
      const heartbeatPolicy = { intervalMs: 5000, leaseMs: 60000 };
      const binding = createValidBinding({
        progress: policy,
        heartbeat: heartbeatPolicy,
      });
      const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
      const extracted = getPiSubagentManagedForegroundBinding(ctx);
      expect(extracted?.progress).toEqual(policy);
      expect(extracted?.heartbeat).toEqual(heartbeatPolicy);
    });

    it("strips invalid rateHz but keeps a valid heartbeat policy", () => {
      const binding = createValidBinding({
        progress: { rateHz: 0.01 },
        heartbeat: { intervalMs: 10000, leaseMs: 30000 },
      });
      const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
      const extracted = getPiSubagentManagedForegroundBinding(ctx);
      expect(extracted?.progress).toBeUndefined();
      expect(extracted?.heartbeat).toEqual({ intervalMs: 10000, leaseMs: 30000 });
    });

    it("strips non-finite rateHz (NaN/Infinity)", () => {
      for (const rateHz of [Number.NaN, Number.POSITIVE_INFINITY, "2" as unknown as number]) {
        const binding = createValidBinding({ progress: { rateHz } });
        const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
        expect(getPiSubagentManagedForegroundBinding(ctx)?.progress).toBeUndefined();
      }
    });

    it("strips fractional or out-of-range heartbeat interval/lease", () => {
      for (const heartbeat of [
        { intervalMs: 10000.5, leaseMs: 30000 },
        { intervalMs: 99, leaseMs: 30000 },
        { intervalMs: 600001, leaseMs: 30000 },
        { intervalMs: 10000, leaseMs: 999 },
        { intervalMs: 10000, leaseMs: 3600001 },
        { intervalMs: Number.NaN, leaseMs: 30000 },
      ]) {
        const binding = createValidBinding({ heartbeat });
        const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
        expect(getPiSubagentManagedForegroundBinding(ctx)?.heartbeat).toBeUndefined();
      }
    });

    it("strips nullish/malformed policy objects entirely", () => {
      for (const progress of [null, "fast", 2, []]) {
        const binding = createValidBinding({ progress });
        const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
        expect(getPiSubagentManagedForegroundBinding(ctx)?.progress).toBeUndefined();
      }
    });

    it("keeps the attached binding immutable and frozen after sanitization", () => {
      const binding = createValidBinding({ progress: { rateHz: 11 } });
      const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
      expect(Object.isFrozen(ctx)).toBe(true);
      const extracted = getPiSubagentManagedForegroundBinding(ctx);
      expect(Object.isFrozen(extracted)).toBe(true);
    });
  });

  describe("PiSubagentObservationInput widened kinds", () => {
    it("reportObservation accepts progress and heartbeat observation inputs", async () => {
      const received: PiSubagentObservationInput[] = [];
      const binding = createValidBinding({
        reportObservation: async (input: PiSubagentObservationInput) => {
          received.push(input);
        },
      });
      const ctx = attachPiSubagentManagedForegroundBinding({}, binding);
      const extracted = getPiSubagentManagedForegroundBinding(ctx)!;

      await extracted.reportObservation({
        kind: "progress",
        occurredAt: "2026-08-18T00:00:00.000Z",
        progressJson: '{"turnCount":1}',
      });
      await extracted.reportObservation({
        kind: "heartbeat",
        occurredAt: "2026-08-18T00:00:10.000Z",
      });

      expect(received).toEqual([
        {
          kind: "progress",
          occurredAt: "2026-08-18T00:00:00.000Z",
          progressJson: '{"turnCount":1}',
        },
        { kind: "heartbeat", occurredAt: "2026-08-18T00:00:10.000Z" },
      ]);
    });
  });
});

describe("Pi subagent teardownOwnedProcesses bridge slice (Decision 0033)", () => {
  const validCommand: PiSubagentTeardownOwnedProcessesCommand = {
    commandId: "teardowncmd_exec_1_att_1_gen1",
    executionId: "exec_1",
    expectedAttemptId: "att_1",
    expectedGeneration: 1,
  };

  const echoResult = (
    status: PiSubagentTeardownOwnedProcessesResult["status"],
    overrides?: Record<string, unknown>,
  ): PiSubagentTeardownOwnedProcessesResult =>
    ({
      status,
      executionId: validCommand.executionId,
      attemptId: validCommand.expectedAttemptId,
      generation: validCommand.expectedGeneration,
      ...overrides,
    }) as PiSubagentTeardownOwnedProcessesResult;

  it("advertises child-bash-process-ownership as an OPTIONAL handshake capability only (D0033 §3/§6 compatibility)", () => {
    expect(PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY).toBe("child-bash-process-ownership");
    expect(PI_SUBAGENT_CAPABILITIES).toContain(PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY);

    const defaultRequest = createDefaultHandshakeRequest();
    expect(defaultRequest.optionalCapabilities).toContain(
      PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
    );
    // Never required: an old Alfie without the endpoint must stay manageable.
    expect(defaultRequest.requiredCapabilities).not.toContain(
      PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
    );
  });

  it("keeps an extension WITHOUT the capability fully managed (optional gating only)", async () => {
    const { bridge } = makeCompatiblePiSubagentExtension({
      capabilities: PI_SUBAGENT_CAPABILITIES.filter(
        (c) => c !== PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
      ),
    });

    const negotiated = await negotiatePiSubagentCapability(bridge);

    expect(negotiated.isManaged).toBe(true);
    expect(negotiated.status).toBe("managed_enabled");
    expect(negotiationSupportsPiSubagentCapability(negotiated, "child-bash-process-ownership"))
      .toBe(false);
  });

  it("gates the capability on when a compatible extension supplies it", async () => {
    const { bridge } = makeCompatiblePiSubagentExtension({
      onTeardownOwnedProcesses: () => echoResult("proven"),
    });

    const negotiated = await negotiatePiSubagentCapability(bridge);

    expect(negotiated.isManaged).toBe(true);
    expect(
      negotiationSupportsPiSubagentCapability(negotiated, "child-bash-process-ownership"),
    ).toBe(true);
  });

  describe("validatePiSubagentTeardownOwnedProcessesResult", () => {
    it("accepts every authenticated owner outcome with matching correlation", () => {
      for (const result of [
        echoResult("proven"),
        echoResult("survivors", { survivorPids: [901, 4242] }),
        echoResult("stale"),
        echoResult("missing"),
        echoResult("owner_unavailable"),
        echoResult("dispatch_failed"),
      ] as PiSubagentTeardownOwnedProcessesResult[]) {
        expect(
          validatePiSubagentTeardownOwnedProcessesResult(result, validCommand),
        ).toStrictEqual(result);
      }
    });

    it("rejects malformed / unknown-shape results as unproven (no validation bypass)", () => {
      const malformedInputs = [
        null,
        undefined,
        "proven",
        42,
        {},
        { not_a_valid_field: true },
        { status: "proven" },
        // Unknown status spellings must never decode.
        echoResult("owner_unproven" as never),
        echoResult("cancelled" as never),
          // Malformed PID evidence.
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [] },
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [0] },
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [9007199254740993] },
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: ["4242"] },
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [2, 1] },
          { status: "survivors", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [1, 1] },
          {
            status: "survivors",
            executionId: "exec_1",
            attemptId: "att_1",
            generation: 1,
            survivorPids: Array.from({ length: 17 }, (_, index) => index + 1),
          },
        // Survivor PIDs on a non-survivor status are forbidden by contract.
        { status: "proven", executionId: "exec_1", attemptId: "att_1", generation: 1, survivorPids: [4242] },
      ];

      for (const input of malformedInputs) {
        expect(validatePiSubagentTeardownOwnedProcessesResult(input, validCommand)).toBeUndefined();
      }
    });

    it("rejects schema-valid results whose correlation identity mismatches the command fencing", () => {
      for (const mismatch of [
        { executionId: "exec_OTHER" },
        { attemptId: "att_OTHER" },
        { generation: 2 },
      ]) {
        const mismatching = echoResult("proven", mismatch);
        expect(
          validatePiSubagentTeardownOwnedProcessesResult(mismatching, validCommand),
        ).toBeUndefined();
      }

      // A `stale` owner report still must carry the exact requested identity.
      expect(
        validatePiSubagentTeardownOwnedProcessesResult(
          echoResult("stale", { executionId: "exec_OTHER" }),
          validCommand,
        ),
      ).toBeUndefined();
    });
  });

  describe("dispatchPiSubagentTeardownOwnedProcesses", () => {
    it("does not advertise child-bash-process-ownership by default when the endpoint is absent", async () => {
      const { bridge } = makeCompatiblePiSubagentExtension({});

      const negotiated = await negotiatePiSubagentCapability(bridge);

      expect(negotiated.isManaged).toBe(true);
      expect(
        negotiationSupportsPiSubagentCapability(negotiated, "child-bash-process-ownership"),
      ).toBe(false);
    });

    it("returns validated proven/survivors results and dispatches the fenced command verbatim", async () => {
      const seen: PiSubagentTeardownOwnedProcessesCommand[] = [];
      const { bridge } = makeCompatiblePiSubagentExtension({
        onTeardownOwnedProcesses: async (command) => {
          seen.push(command);
          return echoResult("proven");
        },
      });

      const proven = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);
      expect(proven.kind).toBe("validated");
      expect(proven).toMatchObject({ kind: "validated", result: echoResult("proven") });
      expect(seen).toEqual([validCommand]);

      const survivors = await dispatchPiSubagentTeardownOwnedProcesses(
        makeCompatiblePiSubagentExtension({
          onTeardownOwnedProcesses: () => echoResult("survivors", { survivorPids: [4242] }),
        }).bridge,
        validCommand,
      );
      expect(survivors).toMatchObject({
        kind: "validated",
        result: { status: "survivors", survivorPids: [4242] },
      });
    });

    it("returns owner_unproven when the bridge operation is absent (old Alfie, optional op)", async () => {
      const { bridge } = makeCompatiblePiSubagentExtension({});
      expect("teardownOwnedProcesses" in (bridge as object)).toBe(false);

      const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);

      expect(outcome.kind).toBe("unproven");
      if (outcome.kind === "unproven") {
        expect(outcome.diagnosticCode).toBe("pi_subagent_teardown_owner_unproven");
        expect(outcome.reason).toBe("bridge_operation_absent");
        expect(outcome.diagnosticMessage).toContain("teardownOwnedProcesses");
        expect(outcome.attemptedCommand).toBe(validCommand);
      }
    });

    it("returns owner_unproven when the dispatch throws", async () => {
      const { bridge } = makeCompatiblePiSubagentExtension({
        onTeardownOwnedProcesses: () => {
          throw new Error("owner endpoint exploded");
        },
      });

      const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);

      expect(outcome.kind).toBe("unproven");
      if (outcome.kind === "unproven") {
        expect(outcome.reason).toBe("dispatch_threw");
        expect(outcome.diagnosticMessage).toContain("owner endpoint exploded");
      }
    });

    it("times out a never-settling owner endpoint into unproven with the exact attempted command and no unhandled rejection", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (cause: unknown) => {
        unhandled.push(cause);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const seen: PiSubagentTeardownOwnedProcessesCommand[] = [];
        const { bridge } = makeCompatiblePiSubagentExtension({
          onTeardownOwnedProcesses: (command) => {
            seen.push(command);
            return new Promise<PiSubagentTeardownOwnedProcessesResult>(() => {});
          },
        });

        const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand, {
          timeoutMs: 100,
        });

        expect(outcome.kind).toBe("unproven");
        if (outcome.kind === "unproven") {
          expect(outcome.reason).toBe("dispatch_timed_out");
          expect(outcome.diagnosticCode).toBe("pi_subagent_teardown_owner_unproven");
          expect(outcome.diagnosticMessage).toContain("teardownOwnedProcesses");
          expect(outcome.diagnosticMessage).toContain("100");
          // The exact fenced command actually dispatched, verbatim.
          expect(outcome.attemptedCommand).toBe(validCommand);
          // A timeout win never fabricates an owner result.
          expect(outcome.result).toBeUndefined();
        }
        expect(seen).toEqual([validCommand]);
        // Give any (incorrect) unhandled rejection time to surface.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("swallows a late endpoint rejection landing after the timeout win — never an unhandled rejection", async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (cause: unknown) => {
        unhandled.push(cause);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        const { bridge } = makeCompatiblePiSubagentExtension({
          onTeardownOwnedProcesses: () =>
            new Promise<PiSubagentTeardownOwnedProcessesResult>((_resolve, reject) => {
              setTimeout(() => reject(new Error("late owner endpoint failure")), 200);
            }),
        });

        const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand, {
          timeoutMs: 100,
        });

        expect(outcome.kind).toBe("unproven");
        if (outcome.kind === "unproven") {
          expect(outcome.reason).toBe("dispatch_timed_out");
        }
        // The rejection fires after the timeout already won.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });

    it("normalizes an absent or invalid deadline to the shared watchdog-stage default instead of the raw value", async () => {
      // An endpoint settling at ~150ms still validates: 50ms is below the
      // shared MIN (100) so it must fall back to the 10s default rather
      // than time the dispatch out.
      const makeBridge = () =>
        makeCompatiblePiSubagentExtension({
          onTeardownOwnedProcesses: () =>
            new Promise<PiSubagentTeardownOwnedProcessesResult>((resolve) => {
              setTimeout(() => resolve(echoResult("proven")), 150);
            }),
        }).bridge;

      const withInvalidLow = await dispatchPiSubagentTeardownOwnedProcesses(
        makeBridge(),
        validCommand,
        { timeoutMs: 50 },
      );
      expect(withInvalidLow.kind).toBe("validated");

      const withAbsent = await dispatchPiSubagentTeardownOwnedProcesses(
        makeBridge(),
        validCommand,
      );
      expect(withAbsent.kind).toBe("validated");
    });

    it("returns owner_unproven on a malformed owner response — never a proven claim", async () => {
      const { bridge } = makeCompatiblePiSubagentExtension({
        onTeardownOwnedProcesses: () => ({ not_a_valid_field: 123 }) as never,
      });

      const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);

      expect(outcome.kind).toBe("unproven");
      if (outcome.kind === "unproven") {
        expect(outcome.reason).toBe("malformed_result");
      }
    });

    it("returns owner_unproven on an identity-mismatched response (stale endpoint echo)", async () => {
      const { bridge } = makeCompatiblePiSubagentExtension({
        onTeardownOwnedProcesses: () => echoResult("proven", { generation: 7 }),
      });

      const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);

      expect(outcome.kind).toBe("unproven");
      if (outcome.kind === "unproven") {
        expect(outcome.reason).toBe("identity_mismatch");
      }
    });

    it("maps owner-reported owner_unavailable / dispatch_failed / stale / missing to unproven with diagnostic codes", async () => {
      for (const [status, expectedReason] of [
        ["owner_unavailable", "owner_unavailable"],
        ["dispatch_failed", "dispatch_failed"],
        ["stale", "stale_generation"],
        ["missing", "owner_missing"],
      ] as const) {
        const { bridge } = makeCompatiblePiSubagentExtension({
          onTeardownOwnedProcesses: () => echoResult(status),
        });

        const outcome = await dispatchPiSubagentTeardownOwnedProcesses(bridge, validCommand);

        expect(outcome.kind).toBe("unproven");
        if (outcome.kind === "unproven") {
          expect(outcome.reason).toBe(expectedReason);
          expect(outcome.diagnosticCode).toBe("pi_subagent_teardown_owner_unproven");
          expect(outcome.result).toStrictEqual(echoResult(status));
        }
      }
    });
  });
});
