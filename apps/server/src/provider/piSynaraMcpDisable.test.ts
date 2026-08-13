// FILE: piSynaraMcpDisable.test.ts
// Purpose: Verifies the per-session disable orchestration (impl-07): the
// synchronous admission fence, the ordered coordinator sequence, idempotent
// duplicate disables, and the fail-closed dormant/unavailable results.
import { describe, expect, it, vi } from "vitest";

import { PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL, disablePiSynaraMcpSession } from "./piSynaraMcpDisable.ts";
import {
  makePiSynaraMcpLifecycleCoordinator,
  type PiSynaraMcpActivationSeams,
  type PiSynaraMcpDeactivationSeams,
  type PiSynaraMcpLifecycleCoordinator,
} from "./piSynaraMcpLifecycle.ts";
import {
  makePiSynaraMcpDormantExtension,
  type PiSynaraMcpLifecycleAdapter,
} from "./piSynaraMcpExtension.ts";
import {
  SYNARA_MCP_DISABLED_ERROR_CODE,
  makePiSynaraMcpToolExecutionRegistry,
  type PiSynaraMcpToolExecutionRegistry,
} from "./piSynaraMcpToolExecution.ts";

const ACTIVATION_INPUT = { subject: "subject-1", sessionId: "session-1" };
const AUTHORITY = { subject: "subject-1", sessionId: "session-1", lifecycleGeneration: "authority-1" };
const CREDENTIAL = { credential: "credential-1" };
const CONNECTION = { connection: "connection-1" };
const CATALOG = { tools: [{ name: "synara_tool_1" }] };

interface Harness {
  readonly adapter: PiSynaraMcpLifecycleAdapter;
  readonly coordinator: PiSynaraMcpLifecycleCoordinator;
  readonly executions: PiSynaraMcpToolExecutionRegistry;
  readonly cleaned: unknown[];
  readonly reloads: ReturnType<typeof vi.fn>;
}

function makeHarness(deactivation: PiSynaraMcpDeactivationSeams = {}): Harness {
  const { adapter } = makePiSynaraMcpDormantExtension();
  const cleaned: unknown[] = [];
  const reloads = vi.fn(async () => undefined);
  const seams: PiSynaraMcpActivationSeams = {
    validateAuthority: async () => ({ ok: true, authority: AUTHORITY }),
    issueCredential: async () => CREDENTIAL,
    connect: async () => CONNECTION,
    discover: async () => CATALOG,
    validateCatalog: async () => ({ ok: true }),
    applyAtSafeBoundary: async () => undefined,
    cleanup: async (staged) => {
      cleaned.push(staged);
    },
  };
  const coordinator = makePiSynaraMcpLifecycleCoordinator({
    adapter,
    seams,
    deactivation: {
      ...deactivation,
      reloadAtSafeBoundary: deactivation.reloadAtSafeBoundary ?? reloads,
    },
  });
  return { adapter, coordinator, executions: makePiSynaraMcpToolExecutionRegistry(), cleaned, reloads };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function activateAndCommit(harness: Harness): Promise<void> {
  const activation = harness.coordinator.activate(ACTIVATION_INPUT);
  await flush();
  await harness.adapter.notifySafeBoundary();
  const result = await activation;
  expect(result).toMatchObject({ ok: true, state: "active" });
}

describe("disablePiSynaraMcpSession", () => {
  it("fences new admissions synchronously before any asynchronous work", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    const disable = disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
      awaitSafeBoundary: false,
    });
    // The fence is installed synchronously by the disable call itself, before
    // the serialized coordinator operation resolves.
    expect(harness.executions.isFenced()).toBe(true);

    const call = vi.fn(async () => "late");
    await expect(harness.executions.execute({ call })).rejects.toMatchObject({
      code: SYNARA_MCP_DISABLED_ERROR_CODE,
    });
    expect(call).not.toHaveBeenCalled();

    await expect(disable).resolves.toEqual({ state: "dormant" });
  });

  it("settles an active session to dormant with the ordered sequence", async () => {
    const order: string[] = [];
    const harness = makeHarness({
      settleExecutions: async () => {
        order.push("settle");
        await harness.executions.settleAll();
      },
      cancelGatewayRequests: async () => {
        order.push("cancel");
      },
    });
    await activateAndCommit(harness);
    const gate = new Promise<never>(() => undefined);
    const inFlight = harness.executions.execute({ call: async () => gate });

    const outcome = await disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
      awaitSafeBoundary: false,
    });

    expect(outcome).toEqual({ state: "dormant" });
    await expect(inFlight).rejects.toMatchObject({
      code: SYNARA_MCP_DISABLED_ERROR_CODE,
    });
    expect(harness.cleaned).toHaveLength(1);
    expect(order).toEqual(["settle", "cancel"]);
    expect(harness.reloads).toHaveBeenCalledTimes(1);
    expect(harness.coordinator.state).toBe("dormant");
    expect(harness.executions.disabledSettledCount()).toBe(1);
  });

  it("parks the runtime reload at the safe boundary when awaited", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    const outcome = disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
      awaitSafeBoundary: true,
    });
    await flush();
    expect(harness.reloads).not.toHaveBeenCalled();

    await harness.adapter.notifySafeBoundary();
    await expect(outcome).resolves.toEqual({ state: "dormant" });
    expect(harness.reloads).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for duplicate disables while deactivating", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);

    const first = disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
      awaitSafeBoundary: false,
    });
    const duplicate = disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
      awaitSafeBoundary: false,
    });

    await expect(first).resolves.toEqual({ state: "dormant" });
    await expect(duplicate).resolves.toEqual({ state: "dormant" });
    expect(harness.cleaned).toHaveLength(1);
    expect(harness.reloads).toHaveBeenCalledTimes(1);
  });

  it("returns an idempotent success for a dormant session", async () => {
    const harness = makeHarness();
    const outcome = await disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
    });

    expect(outcome).toEqual({ state: "dormant", alreadyDisabled: true });
    expect(harness.cleaned).toEqual([]);
    expect(harness.coordinator.state).toBe("dormant");
  });

  it("returns an idempotent unavailable result for an unavailable session", async () => {
    // Force the session unavailable: activation cleanup cannot be proven, so
    // the session stays unavailable until a fresh activation succeeds.
    const adapter = makePiSynaraMcpDormantExtension().adapter;
    const coordinator = makePiSynaraMcpLifecycleCoordinator({
      adapter,
      seams: {
        validateAuthority: async () => ({ ok: true, authority: AUTHORITY }),
        issueCredential: async () => CREDENTIAL,
        connect: async () => CONNECTION,
        discover: async () => {
          throw new Error("discovery exploded");
        },
        validateCatalog: async () => ({ ok: true }),
        applyAtSafeBoundary: async () => undefined,
        cleanup: async () => {
          throw new Error("cannot prove cleanup");
        },
      },
    });
    const activation = await coordinator.activate(ACTIVATION_INPUT);
    expect(activation).toMatchObject({ ok: false, state: "unavailable" });
    expect(coordinator.state).toBe("unavailable");

    const outcome = await disablePiSynaraMcpSession({
      coordinator,
      executions: makePiSynaraMcpToolExecutionRegistry(),
    });

    expect(outcome).toEqual({
      state: "unavailable",
      alreadyDisabled: true,
      detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
    });
  });

  it("reports unavailable with the stable detail when cleanup cannot be proven", async () => {
    // Rebuild the coordinator with a cleanup seam that fails after commit.
    const adapter = makePiSynaraMcpDormantExtension().adapter;
    const cleaned: unknown[] = [];
    const reloads = vi.fn(async () => undefined);
    const coordinator = makePiSynaraMcpLifecycleCoordinator({
      adapter,
      seams: {
        validateAuthority: async () => ({ ok: true, authority: AUTHORITY }),
        issueCredential: async () => CREDENTIAL,
        connect: async () => CONNECTION,
        discover: async () => CATALOG,
        validateCatalog: async () => ({ ok: true }),
        applyAtSafeBoundary: async () => undefined,
        cleanup: async (staged) => {
          cleaned.push(staged);
          throw new Error("cannot prove cleanup");
        },
      },
      deactivation: { reloadAtSafeBoundary: reloads },
    });
    const activation = coordinator.activate(ACTIVATION_INPUT);
    await flush();
    await adapter.notifySafeBoundary();
    await expect(activation).resolves.toMatchObject({ ok: true });

    const outcome = await disablePiSynaraMcpSession({
      coordinator,
      executions: makePiSynaraMcpToolExecutionRegistry(),
      awaitSafeBoundary: false,
    });

    expect(outcome).toEqual({
      state: "unavailable",
      detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
    });
    expect(coordinator.state).toBe("unavailable");
    expect(cleaned).toHaveLength(1);
  });

  it("reports the settled state for a disposed coordinator", async () => {
    const harness = makeHarness();
    await activateAndCommit(harness);
    await harness.coordinator.dispose();

    const outcome = await disablePiSynaraMcpSession({
      coordinator: harness.coordinator,
      executions: harness.executions,
    });

    expect(outcome).toEqual({ state: "dormant", alreadyDisabled: true });
    expect(harness.cleaned).toHaveLength(1);
  });
});
