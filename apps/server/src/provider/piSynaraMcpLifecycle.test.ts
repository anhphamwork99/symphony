import { describe, expect, it, vi } from "vitest";

import {
  makePiSynaraMcpDiagnostics,
  makePiSynaraMcpLifecycleCoordinator,
  PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL,
  PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE,
  PI_SYNARA_MCP_DIAGNOSTIC_LIMIT,
  PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT,
  PI_SYNARA_MCP_GATEWAY_DRAIN_TIMEOUT_MS,
  PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
  type PiSynaraMcpActivationSeams,
  type PiSynaraMcpDeactivationSeams,
  type PiSynaraMcpLifecycleCoordinator,
  type PiSynaraMcpStagedActivation,
} from "./piSynaraMcpLifecycle.ts";
import {
  makePiSynaraMcpDormantExtension,
  PI_SYNARA_MCP_DISABLED_REFUSAL,
  type PiSynaraMcpLifecycleAdapter,
} from "./piSynaraMcpExtension.ts";

const ACTIVATION_INPUT = { subject: "subject-1", sessionId: "session-1" };
const AUTHORITY = { subject: "subject-1", sessionId: "session-1", lifecycleGeneration: "authority-1" };
const CREDENTIAL = { credential: "credential-1" };
const CONNECTION = { connection: "connection-1" };
const CATALOG = { tools: [{ name: "synara_tool_1" }, { name: "synara_tool_2" }] };

interface Harness {
  readonly adapter: PiSynaraMcpLifecycleAdapter;
  readonly coordinator: PiSynaraMcpLifecycleCoordinator;
  readonly calls: string[];
  readonly received: {
    authorityInput: unknown;
    applied: PiSynaraMcpStagedActivation[];
    cleaned: PiSynaraMcpStagedActivation[];
  };
  readonly seams: MutablePiSynaraMcpActivationSeams;
}

type MutablePiSynaraMcpActivationSeams = {
  -readonly [K in keyof PiSynaraMcpActivationSeams]: PiSynaraMcpActivationSeams[K];
};

const STAGE_NAMES: Record<keyof PiSynaraMcpActivationSeams, string> = {
  validateAuthority: "authority",
  issueCredential: "credential",
  connect: "connect",
  discover: "discover",
  validateCatalog: "catalog",
  applyAtSafeBoundary: "apply",
  cleanup: "cleanup",
};

function makeHarness(
  overrides: Partial<PiSynaraMcpActivationSeams> = {},
  deactivation: PiSynaraMcpDeactivationSeams = {},
): Harness {
  const adapter = makePiSynaraMcpDormantExtension().adapter;
  const calls: string[] = [];
  const received = {
    authorityInput: undefined as unknown,
    applied: [] as PiSynaraMcpStagedActivation[],
    cleaned: [] as PiSynaraMcpStagedActivation[],
  };
  const base: PiSynaraMcpActivationSeams = {
    validateAuthority: async (input) => {
      received.authorityInput = input;
      return { ok: true, authority: AUTHORITY };
    },
    issueCredential: async () => CREDENTIAL,
    connect: async () => CONNECTION,
    discover: async () => CATALOG,
    validateCatalog: async () => ({ ok: true }),
    applyAtSafeBoundary: async (staged) => {
      received.applied.push(staged);
    },
    cleanup: async (staged) => {
      received.cleaned.push(staged);
    },
  };
  // Every seam (including overrides) records its call, so call-order
  // assertions stay valid when a test substitutes a seam.
  const combined = { ...base, ...overrides };
  const wrap = <K extends keyof PiSynaraMcpActivationSeams>(
    key: K,
    fn: PiSynaraMcpActivationSeams[K],
  ): PiSynaraMcpActivationSeams[K] => {
    const wrapped = (...args: unknown[]): Promise<unknown> => {
      calls.push(STAGE_NAMES[key]);
      return (fn as (...args: unknown[]) => Promise<unknown>)(...args);
    };
    return wrapped as PiSynaraMcpActivationSeams[K];
  };
  const seams = Object.fromEntries(
    (Object.keys(combined) as (keyof PiSynaraMcpActivationSeams)[]).map((key) => [
      key,
      wrap(key, combined[key]),
    ]),
  ) as unknown as MutablePiSynaraMcpActivationSeams;
  const coordinator = makePiSynaraMcpLifecycleCoordinator({ adapter, seams, deactivation });
  return { adapter, coordinator, calls, received, seams };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function activateAndCommit(harness: Harness): Promise<string> {
  const activation = harness.coordinator.activate(ACTIVATION_INPUT);
  await flush();
  await harness.adapter.notifySafeBoundary();
  const result = await activation;
  if (!result.ok) {
    throw new Error(`activation failed: ${result.reason}`);
  }
  return result.lifecycleGeneration;
}

describe("makePiSynaraMcpLifecycleCoordinator", () => {
  it("starts dormant with zero coordinator side effects", async () => {
    const harness = makeHarness();
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.adapter.state).toBe("dormant");
    expect(harness.calls).toEqual([]);
    expect(harness.coordinator.diagnostics.entries).toEqual([]);

    // The extension's safe-boundary hook still works and triggers nothing.
    const listener = vi.fn();
    harness.adapter.onSafeBoundary(listener);
    await harness.adapter.notifySafeBoundary();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(harness.calls).toEqual([]);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("stages identity, credentials, connection, discovery, and catalog validation before any application", async () => {
    const harness = makeHarness();
    harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();

    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog"]);
    expect(harness.calls).not.toContain("apply");
    expect(harness.coordinator.state).toBe("activating");
    // The activation input is passed through to the trusted authority validator only.
    expect(harness.received.authorityInput).toBe(ACTIVATION_INPUT);
  });

  it("defers catalog application to the safe boundary and commits atomically", async () => {
    const harness = makeHarness();
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    harness.seams.applyAtSafeBoundary = async (staged) => {
      harness.calls.push("apply");
      harness.received.applied.push(staged);
      await applyGate;
    };

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog"]);
    expect(harness.calls).not.toContain("apply");
    expect(harness.coordinator.state).toBe("activating");

    await harness.adapter.notifySafeBoundary();
    await flush();
    expect(harness.calls).toContain("apply");
    expect(harness.received.applied).toHaveLength(1);
    // The commit waits for the atomic application to resolve.
    expect(harness.coordinator.state).toBe("activating");

    releaseApply();
    const result = await activation;
    expect(result).toMatchObject({ ok: true, state: "active", alreadyActive: false });
    if (result.ok) {
      expect(result.lifecycleGeneration).toMatch(/^[0-9a-f-]{36}$/);
      const applied = harness.received.applied[0];
      expect(applied?.authority).toBe(AUTHORITY);
      expect(applied?.credential).toEqual(CREDENTIAL);
      expect(applied?.connection).toEqual(CONNECTION);
      expect(applied?.catalog).toBe(CATALOG);
      expect(applied?.lifecycleGeneration).toBe(result.lifecycleGeneration);
    }
    expect(harness.coordinator.state).toBe("active");
    expect(harness.received.applied).toHaveLength(1);
  });

  it("serializes concurrent activations and dedupes a duplicate while active", async () => {
    const harness = makeHarness();
    const first = harness.coordinator.activate(ACTIVATION_INPUT);
    const second = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    await harness.adapter.notifySafeBoundary();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toMatchObject({ ok: true, state: "active", alreadyActive: false });
    expect(secondResult).toMatchObject({ ok: true, state: "active", alreadyActive: true });
    if (firstResult.ok && secondResult.ok) {
      expect(secondResult.lifecycleGeneration).toBe(firstResult.lifecycleGeneration);
    }
    // Exactly one staged activation and one atomic exposure.
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog", "apply"]);
    expect(harness.received.applied).toHaveLength(1);
  });

  it("fails closed on authority denial without touching staging", async () => {
    const harness = makeHarness({
      validateAuthority: async () => ({ ok: false, reason: "missing subject binding" }),
    });
    const result = await harness.coordinator.activate(ACTIVATION_INPUT);

    expect(result).toEqual({
      ok: false,
      state: "dormant",
      stage: "authority",
      reason: "missing subject binding",
    });
    expect(harness.calls).toEqual(["authority", "cleanup"]);
    expect(harness.coordinator.state).toBe("dormant");
    await expect(harness.adapter.invoke({ method: "tools/list" })).rejects.toThrow(
      PI_SYNARA_MCP_DISABLED_REFUSAL,
    );
  });

  it("rolls back a failed staging step to dormant with cleanup of the staged candidates", async () => {
    const harness = makeHarness({
      discover: async () => {
        throw new Error("discovery exploded");
      },
    });
    const result = await harness.coordinator.activate(ACTIVATION_INPUT);

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "discovery" });
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "cleanup"]);
    expect(harness.calls).not.toContain("apply");
    expect(harness.received.cleaned).toHaveLength(1);
    expect(harness.received.cleaned[0]?.credential).toEqual(CREDENTIAL);
    expect(harness.received.cleaned[0]?.connection).toEqual(CONNECTION);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("returns unavailable when cleanup cannot be proven", async () => {
    const harness = makeHarness({
      discover: async () => {
        throw new Error("discovery exploded");
      },
      cleanup: async () => {
        throw new Error("cannot prove cleanup");
      },
    });
    const result = await harness.coordinator.activate(ACTIVATION_INPUT);

    expect(result).toMatchObject({ ok: false, state: "unavailable", stage: "discovery" });
    expect(harness.coordinator.state).toBe("unavailable");
    expect(harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "cleanup.uncertain")).toBe(true);
  });

  it("recovers from unavailable with a fresh activation attempt", async () => {
    const harness = makeHarness();
    let failDiscovery = true;
    let failCleanup = true;
    harness.seams.discover = async () => {
      if (failDiscovery) {
        throw new Error("discovery exploded");
      }
      return CATALOG;
    };
    harness.seams.cleanup = async (staged) => {
      harness.calls.push("cleanup");
      harness.received.cleaned.push(staged);
      if (failCleanup) {
        throw new Error("cannot prove cleanup");
      }
    };

    const first = await harness.coordinator.activate(ACTIVATION_INPUT);
    expect(first).toMatchObject({ ok: false, state: "unavailable" });
    expect(harness.coordinator.state).toBe("unavailable");

    failDiscovery = false;
    failCleanup = false;
    const second = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    expect(harness.coordinator.state).toBe("activating");
    await harness.adapter.notifySafeBoundary();
    const secondResult = await second;

    expect(secondResult).toMatchObject({ ok: true, state: "active", alreadyActive: false });
    expect(harness.coordinator.state).toBe("active");
    expect(harness.received.applied).toHaveLength(1);
  });

  it("rejects an empty catalog without exposure", async () => {
    const harness = makeHarness({
      validateCatalog: async () => ({ ok: false, reason: "catalog is empty" }),
    });
    const result = await harness.coordinator.activate(ACTIVATION_INPUT);

    expect(result).toMatchObject({
      ok: false,
      state: "dormant",
      stage: "catalog",
      reason: "catalog is empty",
    });
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog", "cleanup"]);
    expect(harness.calls).not.toContain("apply");
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("rejects a malformed catalog without exposure", async () => {
    const harness = makeHarness({
      validateCatalog: async () => ({ ok: false, reason: "catalog tool schema is invalid" }),
    });
    const result = await harness.coordinator.activate(ACTIVATION_INPUT);

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "catalog" });
    expect(harness.received.applied).toHaveLength(0);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("fences stale completions after dispose so tools are never exposed", async () => {
    const harness = makeHarness();
    let releaseDiscover!: (catalog: unknown) => void;
    const discoverGate = new Promise<unknown>((resolve) => {
      releaseDiscover = resolve;
    });
    harness.seams.discover = async () => {
      harness.calls.push("discover");
      return discoverGate;
    };

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    expect(harness.calls).toContain("discover");

    const disposePromise = harness.coordinator.dispose();
    releaseDiscover(CATALOG);

    const result = await activation;
    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "superseded" });
    await disposePromise;
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.calls).not.toContain("apply");

    // A later safe boundary must not expose anything.
    await harness.adapter.notifySafeBoundary();
    expect(harness.calls).not.toContain("apply");
  });

  it("dispose during the safe-boundary wait aborts before exposure", async () => {
    const harness = makeHarness();
    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog"]);

    const disposePromise = harness.coordinator.dispose();
    const result = await activation;
    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "superseded" });
    await disposePromise;
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.calls).not.toContain("apply");

    // Even a boundary firing after dispose exposes nothing.
    await harness.adapter.notifySafeBoundary();
    expect(harness.calls).not.toContain("apply");
  });

  it("fences a stale apply completion after rollback and never retries", async () => {
    const harness = makeHarness();
    harness.seams.applyAtSafeBoundary = async () => {
      harness.calls.push("apply");
      throw new Error("apply failed");
    };

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    await harness.adapter.notifySafeBoundary();
    const result = await activation;

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "apply" });
    expect(harness.calls).toContain("cleanup");
    expect(harness.coordinator.state).toBe("dormant");

    // A later boundary does not re-apply.
    await harness.adapter.notifySafeBoundary();
    expect(harness.calls.filter((call) => call === "apply")).toHaveLength(1);
  });

  it("retires the active generation through the deactivation handoff", async () => {
    const harness = makeHarness();
    const generation = await activateAndCommit(harness);
    expect(harness.coordinator.state).toBe("active");

    const handoff = await harness.coordinator.beginDeactivation();
    expect(harness.coordinator.state).toBe("deactivating");
    expect(handoff.generation).toBe(generation);
    expect(handoff.authority).toBe(AUTHORITY);
    expect(handoff.staged.catalog).toBe(CATALOG);
    expect(typeof handoff.cleanup).toBe("function");
    // Invocation is refused while deactivating.
    await expect(harness.adapter.invoke({ method: "tools/list" })).rejects.toThrow(
      PI_SYNARA_MCP_DISABLED_REFUSAL,
    );

    const outcome = await handoff.complete();
    expect(outcome).toEqual({ state: "dormant" });
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.calls).toContain("cleanup");
    expect(harness.received.cleaned[0]?.catalog).toBe(CATALOG);

    // Completing twice is idempotent and does not re-run cleanup.
    expect(await handoff.complete()).toEqual({ state: "dormant" });
    expect(harness.calls.filter((call) => call === "cleanup")).toHaveLength(1);
  });

  it("rejects deactivation when the session is not active", async () => {
    const harness = makeHarness();
    await expect(harness.coordinator.beginDeactivation()).rejects.toThrow(
      PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE,
    );

    harness.seams.validateAuthority = async () => ({ ok: false, reason: "denied" });
    await harness.coordinator.activate(ACTIVATION_INPUT);
    await expect(harness.coordinator.beginDeactivation()).rejects.toThrow(
      PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE,
    );
  });

  it("ends deactivation in unavailable when cleanup cannot be proven", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);
    harness.seams.cleanup = async (staged) => {
      harness.calls.push("cleanup");
      harness.received.cleaned.push(staged);
      throw new Error("cannot prove cleanup");
    };

    const handoff = await harness.coordinator.beginDeactivation();
    const outcome = await handoff.complete();
    expect(outcome).toEqual({ state: "unavailable" });
    expect(harness.coordinator.state).toBe("unavailable");
  });

  it("dispose deactivates an active session with cleanup", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    await harness.coordinator.dispose();
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.calls).toContain("cleanup");
    expect(harness.received.cleaned[0]?.catalog).toBe(CATALOG);
    await expect(harness.adapter.invoke({ method: "tools/list" })).rejects.toThrow(
      PI_SYNARA_MCP_DISABLED_REFUSAL,
    );
    expect(harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "disposed")).toBe(true);
  });

  it("dispose while dormant is a no-op and permanently refuses further operations", async () => {
    const harness = makeHarness();
    await harness.coordinator.dispose();

    expect(harness.calls).toEqual([]);
    expect(harness.coordinator.state).toBe("dormant");
    await expect(harness.coordinator.activate(ACTIVATION_INPUT)).rejects.toThrow(
      PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
    );
    await expect(harness.coordinator.beginDeactivation()).rejects.toThrow(
      PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
    );
    await expect(harness.coordinator.dispose()).resolves.toBeUndefined();
  });

  it("fences an activation already queued before dispose is requested", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    const queuedActivation = harness.coordinator.activate(ACTIVATION_INPUT);
    const disposePromise = harness.coordinator.dispose();

    await expect(queuedActivation).rejects.toThrow(PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL);
    await disposePromise;
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.received.applied).toHaveLength(1);
    await harness.adapter.notifySafeBoundary();
    expect(harness.calls.filter((call) => call === "apply")).toHaveLength(1);
  });

  it("fences a queued activation behind an in-flight one so dispose never stalls", async () => {
    let releaseDiscover!: () => void;
    const discoverGate = new Promise<void>((resolve) => {
      releaseDiscover = resolve;
    });
    const harness = makeHarness({
      discover: async () => {
        await discoverGate;
        return CATALOG;
      },
    });

    const inFlight = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    expect(harness.calls).toContain("discover");

    const queued = harness.coordinator.activate(ACTIVATION_INPUT);
    const disposePromise = harness.coordinator.dispose();

    releaseDiscover();
    const inFlightResult = await inFlight;
    expect(inFlightResult).toMatchObject({ ok: false, state: "dormant", stage: "superseded" });

    // Without the dispose fence the queued activation would re-arm itself,
    // wait forever on the safe boundary, and block dispose behind it.
    const queuedOutcome = await Promise.race([
      queued.then(
        (result) => ({ kind: "resolved" as const, result }),
        (error) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ readonly kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 500),
      ),
    ]);
    expect(queuedOutcome.kind).toBe("rejected");
    if (queuedOutcome.kind === "rejected") {
      expect((queuedOutcome.error as Error).message).toBe(
        PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
      );
    }
    await disposePromise;
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.calls).not.toContain("apply");

    // A boundary firing after dispose exposes nothing.
    await harness.adapter.notifySafeBoundary();
    expect(harness.calls).not.toContain("apply");
  });

  it("serializes deactivation behind an in-flight activation", async () => {
    const harness = makeHarness();
    let releaseApply!: () => void;
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    harness.seams.applyAtSafeBoundary = async (staged) => {
      harness.calls.push("apply");
      harness.received.applied.push(staged);
      await applyGate;
    };

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    await harness.adapter.notifySafeBoundary();
    await flush();
    expect(harness.calls).toContain("apply");

    const deactivation = harness.coordinator.beginDeactivation();
    releaseApply();
    const result = await activation;
    expect(result).toMatchObject({ ok: true });
    const handoff = await deactivation;
    expect(harness.coordinator.state).toBe("deactivating");

    const outcome = await handoff.complete();
    expect(outcome).toEqual({ state: "dormant" });
    expect(harness.calls).toEqual(["authority", "credential", "connect", "discover", "catalog", "apply", "cleanup"]);
  });

  it("refuses activation while deactivating until the handoff completes", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    await expect(harness.coordinator.activate(ACTIVATION_INPUT)).rejects.toThrow(
      PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL,
    );
    await handoff.complete();

    const generation = await activateAndCommit(harness);
    expect(generation).toMatch(/^[0-9a-f-]{36}$/);
    expect(harness.coordinator.state).toBe("active");
    expect(harness.received.applied).toHaveLength(2);
  });

  it("bounds diagnostics to the newest entries and truncates long messages", () => {
    const diagnostics = makePiSynaraMcpDiagnostics(5);
    for (let i = 0; i < 8; i += 1) {
      diagnostics.record({ kind: "activation.failed", message: `failure ${i}`, state: "dormant" });
    }
    expect(diagnostics.entries).toHaveLength(5);
    expect(diagnostics.entries[0]?.message).toBe("failure 3");
    expect(diagnostics.entries[4]?.message).toBe("failure 7");

    diagnostics.record({
      kind: "activation.failed",
      message: "x".repeat(PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT + 50),
      state: "dormant",
    });
    expect(diagnostics.entries[4]?.message.length).toBeLessThanOrEqual(PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT);
    expect(diagnostics.entries[4]?.message.endsWith("…")).toBe(true);
  });

  it("orders disable settlement, gateway drain, cleanup, and boundary reload during deactivation", async () => {
    const order: string[] = [];
    const harness = makeHarness({}, {
      settleExecutions: async () => {
        order.push("settle");
      },
      cancelGatewayRequests: async () => {
        order.push("cancel");
      },
      reloadAtSafeBoundary: async () => {
        order.push("reload");
      },
    });
    await activateAndCommit(harness);

    const handoff = await harness.coordinator.beginDeactivation();
    const outcome = await handoff.complete({ awaitSafeBoundary: false });

    expect(outcome).toEqual({ state: "dormant" });
    expect(order).toEqual(["settle", "cancel", "reload"]);
    expect(harness.calls).toContain("cleanup");
    // Settlement and drain happen before the revoke/clear cleanup.
    expect(order.indexOf("settle")).toBeLessThan(harness.calls.indexOf("cleanup"));
    expect(order.indexOf("cancel")).toBeLessThan(harness.calls.indexOf("cleanup"));
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("passes the exact active turn identity into the gateway cancel seam (Decision 14)", async () => {
    const cancelOptions: Array<{ readonly turnId?: string }> = [];
    const harness = makeHarness({}, {
      cancelGatewayRequests: async (_staged, options) => {
        cancelOptions.push(options ?? {});
      },
    });
    await activateAndCommit(harness);

    const handoff = await harness.coordinator.beginDeactivation();
    const outcome = await handoff.complete({ awaitSafeBoundary: false, turnId: "turn-exact-1" });

    expect(outcome).toEqual({ state: "dormant" });
    // The handoff carries the disable-time turn identity to the cancel seam
    // so it can retire exact-turn write authority before cancellation.
    expect(cancelOptions).toEqual([{ turnId: "turn-exact-1" }]);
  });

  it("revokes credentials only after the gateway drain barrier settles", async () => {
    const order: string[] = [];
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const harness = makeHarness({}, {
      settleExecutions: async () => {
        order.push("settle");
      },
      cancelGatewayRequests: async () => {
        order.push("cancel");
        await drainGate;
      },
      reloadAtSafeBoundary: async () => {
        order.push("reload");
      },
    });
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    const completion = handoff.complete({ awaitSafeBoundary: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The drain barrier is still pending: cleanup (revoke) must not run yet.
    expect(order).toEqual(["settle", "cancel"]);
    expect(harness.calls).not.toContain("cleanup");

    releaseDrain();
    await expect(completion).resolves.toEqual({ state: "dormant" });
    expect(harness.calls).toContain("cleanup");
    expect(order).toEqual(["settle", "cancel", "reload"]);
  });

  it("treats a gateway drain timeout as not clean success and leaves the session unavailable", async () => {
    const harness = makeHarness({}, {
      settleExecutions: async () => undefined,
      cancelGatewayRequests: async () => {
        // The gateway drain never settles within the configured bound.
        await new Promise<void>(() => undefined);
      },
      drainTimeoutMs: 25,
      reloadAtSafeBoundary: async () => undefined,
    });
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    const outcome = await handoff.complete({ awaitSafeBoundary: false });

    expect(outcome).toEqual({ state: "unavailable" });
    expect(harness.coordinator.state).toBe("unavailable");
    // Revocation/cleanup still ran best-effort after the drain timeout.
    expect(harness.calls).toContain("cleanup");
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "disable.drain.timeout"),
    ).toBe(true);
    expect(PI_SYNARA_MCP_GATEWAY_DRAIN_TIMEOUT_MS).toBe(2_000);
  });

  it("waits for the safe boundary before the reload when awaited, and reloads immediately otherwise", async () => {
    const reloads: string[] = [];
    const harness = makeHarness({}, {
      reloadAtSafeBoundary: async () => {
        reloads.push("reload");
      },
    });
    await activateAndCommit(harness);

    const awaitedHandoff = await harness.coordinator.beginDeactivation();
    const awaited = awaitedHandoff.complete({ awaitSafeBoundary: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloads).toEqual([]);
    await harness.adapter.notifySafeBoundary();
    await expect(awaited).resolves.toEqual({ state: "dormant" });
    expect(reloads).toEqual(["reload"]);
    expect(harness.coordinator.state).toBe("dormant");

    const harness2 = makeHarness({}, {
      reloadAtSafeBoundary: async () => {
        reloads.push("reload-immediate");
      },
    });
    await activateAndCommit(harness2);
    const immediateHandoff = await harness2.coordinator.beginDeactivation();
    await expect(immediateHandoff.complete({ awaitSafeBoundary: false })).resolves.toEqual({
      state: "dormant",
    });
    expect(reloads).toEqual(["reload", "reload-immediate"]);
  });

  it("leaves the session unavailable when the boundary reload cannot be proven", async () => {
    const harness = makeHarness({}, {
      reloadAtSafeBoundary: async () => {
        throw new Error("reload exploded");
      },
    });
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    const outcome = await handoff.complete({ awaitSafeBoundary: false });

    expect(outcome).toEqual({ state: "unavailable" });
    expect(harness.coordinator.state).toBe("unavailable");
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "disable.reload.uncertain"),
    ).toBe(true);
  });

  it("leaves the session unavailable when in-flight settlement cannot be proven", async () => {
    const harness = makeHarness({}, {
      settleExecutions: async () => {
        throw new Error("settle exploded");
      },
      reloadAtSafeBoundary: async () => undefined,
    });
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    const outcome = await handoff.complete({ awaitSafeBoundary: false });

    expect(outcome).toEqual({ state: "unavailable" });
    expect(harness.coordinator.state).toBe("unavailable");
    expect(
      harness.coordinator.diagnostics.entries.some((entry) => entry.kind === "disable.settle.uncertain"),
    ).toBe(true);
  });

  it("returns the same handoff for a duplicate deactivation while deactivating", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    const first = await harness.coordinator.beginDeactivation();
    const duplicate = await harness.coordinator.beginDeactivation();

    expect(duplicate).toBe(first);
    expect(harness.coordinator.state).toBe("deactivating");
    expect(await first.complete()).toEqual({ state: "dormant" });
    expect(await duplicate.complete()).toEqual({ state: "dormant" });
    expect(harness.calls.filter((call) => call === "cleanup")).toHaveLength(1);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("dispose during deactivation releases the boundary wait and finalizes without a reload", async () => {
    const reloads: string[] = [];
    const harness = makeHarness({}, {
      reloadAtSafeBoundary: async () => {
        reloads.push("reload");
      },
    });
    await activateAndCommit(harness);
    const handoff = await harness.coordinator.beginDeactivation();

    // The awaited deactivation is parked on the safe boundary; dispose must
    // release it instead of waiting for the next agent_end forever.
    const completion = handoff.complete({ awaitSafeBoundary: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const disposePromise = harness.coordinator.dispose();
    await expect(completion).resolves.toEqual({ state: "dormant" });
    await disposePromise;

    expect(harness.coordinator.state).toBe("dormant");
    expect(reloads).toEqual(["reload"]);
    await expect(harness.coordinator.activate(ACTIVATION_INPUT)).rejects.toThrow(
      PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL,
    );
  });

  it("rolls back an apply failure with an immediate reload when the catalog was exposed", async () => {
    const order: string[] = [];
    const harness = makeHarness({}, {
      reloadAtSafeBoundary: async () => {
        order.push("reload");
      },
    });
    harness.seams.applyAtSafeBoundary = async () => {
      harness.calls.push("apply");
      throw new Error("apply failed");
    };

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    await harness.adapter.notifySafeBoundary();
    const result = await activation;

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "apply" });
    expect(harness.calls).toContain("cleanup");
    expect(order).toEqual(["reload"]);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("never reloads for a superseded staging rollback that exposed no catalog", async () => {
    const order: string[] = [];
    let releaseDiscover!: () => void;
    const discoverGate = new Promise<void>((resolve) => {
      releaseDiscover = resolve;
    });
    const harness = makeHarness(
      {
        discover: async () => {
          await discoverGate;
          return CATALOG;
        },
      },
      {
        reloadAtSafeBoundary: async () => {
          order.push("reload");
        },
      },
    );

    const activation = harness.coordinator.activate(ACTIVATION_INPUT);
    await flush();
    const disposePromise = harness.coordinator.dispose();
    releaseDiscover();
    const result = await activation;
    await disposePromise;

    expect(result).toMatchObject({ ok: false, state: "dormant", stage: "superseded" });
    expect(order).toEqual([]);
    expect(harness.calls).not.toContain("apply");
  });

  it("keeps the coordinator's default diagnostics bounded", async () => {
    const harness = makeHarness({
      validateAuthority: async () => ({ ok: false, reason: "denied" }),
    });
    for (let i = 0; i < PI_SYNARA_MCP_DIAGNOSTIC_LIMIT + 3; i += 1) {
      await harness.coordinator.activate(ACTIVATION_INPUT);
    }
    expect(harness.coordinator.diagnostics.entries.length).toBeLessThanOrEqual(PI_SYNARA_MCP_DIAGNOSTIC_LIMIT);
  });
});
