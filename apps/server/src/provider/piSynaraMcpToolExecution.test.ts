// FILE: piSynaraMcpToolExecution.test.ts
// Purpose: Verifies the Pi-local Synara MCP tool execution registry — the
// narrow impl-07 AC2 seam where a disabled MCP call returns the structured
// `synara_mcp_disabled` result exactly once, late callbacks are suppressed,
// and the cancelled call is never replayed.
import { describe, expect, it, vi } from "vitest";

import { PI_SYNARA_MCP_DISABLED_REFUSAL } from "./piSynaraMcpExtension.ts";
import {
  isPiSynaraMcpDisabledError,
  makePiSynaraMcpDisabledError,
  makePiSynaraMcpToolExecutionRegistry,
  SYNARA_MCP_DISABLED_ERROR_CODE,
  type PiSynaraMcpToolExecutionRegistry,
} from "./piSynaraMcpToolExecution.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("makePiSynaraMcpToolExecutionRegistry", () => {
  it("executes a call and returns its result", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const call = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));

    await expect(registry.execute({ call })).resolves.toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(0);
    expect(registry.isFenced()).toBe(false);
  });

  it("rejects a new admission after the fence before its handler starts", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const call = vi.fn(async () => ({ ok: true }));

    registry.fence();
    expect(registry.isFenced()).toBe(true);

    const execution = registry.execute({ call });
    await expect(execution).rejects.toSatisfy(isPiSynaraMcpDisabledError);
    await expect(execution).rejects.toMatchObject({
      code: SYNARA_MCP_DISABLED_ERROR_CODE,
      message: PI_SYNARA_MCP_DISABLED_REFUSAL,
    });
    // The registration racing disable is rejected before its handler starts.
    expect(call).not.toHaveBeenCalled();
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(0);
  });

  it("settles every in-flight execution exactly once with the structured disabled error", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const signals: AbortSignal[] = [];
    const release = deferred<{ content: Array<{ type: "text"; text: string }> }>();
    const call = vi.fn(async (signal?: AbortSignal) => {
      signals.push(signal!);
      return release.promise;
    });
    const first = registry.execute({ call });
    const second = registry.execute({ call });
    expect(registry.inFlightCount()).toBe(2);

    await registry.settleAll();

    for (const execution of [first, second]) {
      await expect(execution).rejects.toMatchObject({
        code: SYNARA_MCP_DISABLED_ERROR_CODE,
        message: PI_SYNARA_MCP_DISABLED_REFUSAL,
      });
    }
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(2);
    // The underlying gateway calls were aborted at settlement.
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    // A late callback from the abandoned gateway call cannot mutate state or
    // emit a duplicate result: both executions were already settled once.
    release.resolve({ content: [{ type: "text", text: "late" }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(2);
    await expect(first).rejects.toMatchObject({ code: SYNARA_MCP_DISABLED_ERROR_CODE });
  });

  it("settles an execution even when the underlying call rejects late", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const release = deferred<unknown>();
    const call = vi.fn(async () => release.promise);

    const execution = registry.execute({ call });
    await registry.settleAll();
    release.reject(new Error("late gateway failure"));
    await Promise.resolve();
    await Promise.resolve();

    await expect(execution).rejects.toMatchObject({ code: SYNARA_MCP_DISABLED_ERROR_CODE });
    expect(registry.inFlightCount()).toBe(0);
  });

  it("propagates the Pi SDK abort signal without a disabled settlement", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const call = vi.fn(async (signal?: AbortSignal) => {
      // The registry always links its own abort signal to the call.
      const linked = signal!;
      await new Promise<never>((_resolve, reject) => {
        const onAbort = () =>
          reject(linked.reason ?? new DOMException("The operation was aborted.", "AbortError"));
        if (linked.aborted) {
          onAbort();
          return;
        }
        linked.addEventListener("abort", onAbort, { once: true });
      });
    });
    const controller = new AbortController();
    const execution = registry.execute({ call, signal: controller.signal });

    controller.abort();

    await expect(execution).rejects.toMatchObject({ name: "AbortError" });
    // The SDK-driven abort is not a disable settlement and never replays.
    expect(call).toHaveBeenCalledTimes(1);
    expect(registry.disabledSettledCount()).toBe(0);
    expect(registry.inFlightCount()).toBe(0);
  });

  it("keeps settleAll idempotent and resolves immediately when nothing is in flight", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    await expect(registry.settleAll()).resolves.toBeUndefined();
    expect(registry.disabledSettledCount()).toBe(0);
    await expect(registry.settleAll()).resolves.toBeUndefined();
  });

  it("exposes the structured error with the accepted code and message", () => {
    const error = makePiSynaraMcpDisabledError();
    expect(error.code).toBe(SYNARA_MCP_DISABLED_ERROR_CODE);
    expect(error.message).toBe(PI_SYNARA_MCP_DISABLED_REFUSAL);
    expect(error.name).toBe("PiSynaraMcpDisabledError");
    expect(isPiSynaraMcpDisabledError(error)).toBe(true);
    expect(isPiSynaraMcpDisabledError(new Error("other"))).toBe(false);
    expect(isPiSynaraMcpDisabledError(undefined)).toBe(false);
  });

  it("registers and runs multiple executions independently", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const releaseA = deferred<string>();
    const callA = vi.fn(async () => releaseA.promise);
    const callB = vi.fn(async () => "b");

    const a = registry.execute({ call: callA });
    const b = registry.execute({ call: callB });

    await expect(b).resolves.toBe("b");
    expect(registry.inFlightCount()).toBe(1);
    releaseA.resolve("a");
    await expect(a).resolves.toBe("a");
    expect(registry.inFlightCount()).toBe(0);
  });

  it("reopens admission with a fresh generation after a fence and keeps the retired generation inert (re-enable regression)", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const release = deferred<{ content: Array<{ type: "text"; text: string }> }>();
    const call = vi.fn(async (_signal?: AbortSignal) => release.promise);

    // A disabled session: the fence rejects new admissions and settles the
    // in-flight execution exactly once.
    const retired = registry.execute({ call });
    expect(registry.inFlightCount()).toBe(1);
    registry.fence();
    await expect(registry.execute({ call })).rejects.toMatchObject({
      code: SYNARA_MCP_DISABLED_ERROR_CODE,
    });
    await registry.settleAll();
    expect(registry.disabledSettledCount()).toBe(1);

    // A fresh activation replaces the admission generation at the proven
    // safe boundary: new calls are admitted again and the retired
    // generation's counters are no longer visible.
    registry.resetForFreshActivation(false);
    expect(registry.isFenced()).toBe(false);
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(0);
    const freshCall = vi.fn(async () => ({ content: [{ type: "text", text: "fresh ok" }] }));
    await expect(registry.execute({ call: freshCall })).resolves.toEqual({
      content: [{ type: "text", text: "fresh ok" }],
    });
    expect(freshCall).toHaveBeenCalledTimes(1);

    // The retired generation's late callback stays inert: it can neither
    // mutate the fresh generation nor emit a duplicate result, and the
    // retired execution keeps its once-only disabled settlement.
    release.resolve({ content: [{ type: "text", text: "late retired result" }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(0);
    await expect(retired).rejects.toMatchObject({ code: SYNARA_MCP_DISABLED_ERROR_CODE });

    // Settling the fresh generation touches only fresh executions, never the
    // retired one.
    registry.fence();
    await registry.settleAll();
    expect(registry.disabledSettledCount()).toBe(0);
    await expect(retired).rejects.toMatchObject({ code: SYNARA_MCP_DISABLED_ERROR_CODE });
  });

  it("starts the fresh generation fenced when requested (disable raced the activation)", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    registry.fence();
    await registry.settleAll();

    registry.resetForFreshActivation(true);
    expect(registry.isFenced()).toBe(true);
    const call = vi.fn(async () => ({ ok: true }));
    await expect(registry.execute({ call })).rejects.toMatchObject({
      code: SYNARA_MCP_DISABLED_ERROR_CODE,
      message: PI_SYNARA_MCP_DISABLED_REFUSAL,
    });
    expect(call).not.toHaveBeenCalled();
    expect(registry.inFlightCount()).toBe(0);
  });

  it("keeps a retired generation's in-flight execution isolated from a fresh generation's settlement", async () => {
    const registry = makePiSynaraMcpToolExecutionRegistry();
    const release = deferred<unknown>();
    const retired = registry.execute({ call: async () => release.promise });
    registry.fence();
    await registry.settleAll();

    registry.resetForFreshActivation(false);
    const fresh = registry.execute({ call: async () => "fresh" });
    await expect(fresh).resolves.toBe("fresh");
    expect(registry.inFlightCount()).toBe(0);

    // The fresh generation is settled: only fresh executions are affected;
    // the retired promise remains settled exactly once with the disabled
    // error and its late callback cannot re-enter the registry.
    registry.fence();
    await registry.settleAll();
    expect(registry.disabledSettledCount()).toBe(0);
    release.reject(new Error("late retired failure"));
    await Promise.resolve();
    await Promise.resolve();
    await expect(retired).rejects.toMatchObject({ code: SYNARA_MCP_DISABLED_ERROR_CODE });
    expect(registry.inFlightCount()).toBe(0);
    expect(registry.disabledSettledCount()).toBe(0);
  });
});
