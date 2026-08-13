// FILE: piSynaraMcpToolExecution.ts
// Purpose: Pi-local execution registry for Synara MCP tool calls (impl-07).
//
// The registry owns the structured `synara_mcp_disabled` settlement for the
// Pi-facing side of a disable (Decisions 13/14): new admissions are fenced
// synchronously before any asynchronous cleanup starts, every in-flight
// execution is settled exactly once with the accepted error code and message,
// the underlying gateway call is aborted, late callbacks are suppressed (a
// settled promise can never be resolved twice and the entry is removed from
// the registry), and calls are never automatically retried or replayed.
//
// Admission is generation-scoped: `resetForFreshActivation` retires the
// current generation and installs a fresh one only at a proven fresh
// activation safe-boundary (the lifecycle coordinator's commit seam). The
// retired generation stays fenced forever and keeps its own pending map, so
// stale executions/callbacks from it can never enter or mutate the fresh
// generation, and a re-enabled session admits mapped tool calls again.
//
// Gateway-side cancellation and drainage remain owned by the agent-gateway
// in-flight request registry (see piSynaraMcpLifecycle.ts deactivation
// seams); this module is strictly the Pi-facing settlement boundary.
import { PI_SYNARA_MCP_DISABLED_REFUSAL } from "./piSynaraMcpExtension.ts";

/** Structured error code returned to a Pi-facing call settled by disable. */
export const SYNARA_MCP_DISABLED_ERROR_CODE = "synara_mcp_disabled";

export interface PiSynaraMcpDisabledError extends Error {
  readonly code: typeof SYNARA_MCP_DISABLED_ERROR_CODE;
}

export function makePiSynaraMcpDisabledError(): PiSynaraMcpDisabledError {
  return Object.assign(new Error(PI_SYNARA_MCP_DISABLED_REFUSAL), {
    name: "PiSynaraMcpDisabledError",
    code: SYNARA_MCP_DISABLED_ERROR_CODE,
  }) as PiSynaraMcpDisabledError;
}

export function isPiSynaraMcpDisabledError(cause: unknown): cause is PiSynaraMcpDisabledError {
  return (
    cause instanceof Error &&
    (cause as PiSynaraMcpDisabledError).code === SYNARA_MCP_DISABLED_ERROR_CODE
  );
}

export interface PiSynaraMcpToolExecutionInput {
  /** The gateway-bound call; receives the registry's abort signal. */
  readonly call: (signal?: AbortSignal) => Promise<unknown>;
  /** The Pi SDK's own abort signal (turn interruption), linked to the call. */
  readonly signal?: AbortSignal;
}

export interface PiSynaraMcpToolExecutionRegistry {
  /**
   * Run one Pi-facing Synara MCP tool execution. When the registry is fenced
   * the call is rejected with the structured disabled error before its
   * handler starts. When disable settles the registry, every in-flight
   * execution rejects exactly once with that same structured error and its
   * gateway call is aborted.
   */
  readonly execute: (input: PiSynaraMcpToolExecutionInput) => Promise<unknown>;
  /** Synchronously fence new admissions; later executions fail fast. */
  readonly fence: () => void;
  readonly isFenced: () => boolean;
  /**
   * Settle every in-flight execution exactly once with the structured
   * disabled error and abort its gateway call. Resolves when all in-flight
   * executions are settled; idempotent.
   */
  readonly settleAll: () => Promise<void>;
  /** In-flight execution count (bounded diagnostics). */
  readonly inFlightCount: () => number;
  /** Executions settled as disabled (bounded diagnostics). */
  readonly disabledSettledCount: () => number;
  /**
   * Retire the current execution generation and install a fresh one. Must
   * only be called at a proven fresh-activation safe-boundary (the lifecycle
   * coordinator's commit seam): a re-enabled session admits mapped tool
   * calls again, while the retired generation stays fenced forever with its
   * own pending map, so stale executions/callbacks from it can never enter
   * or mutate the fresh generation. `fenceNewGeneration` starts the fresh
   * generation fenced; the coordinator requests it when a disable was
   * requested while the activation ran, so no call can be admitted after
   * that disable's fence began.
   */
  readonly resetForFreshActivation: (fenceNewGeneration: boolean) => void;
}

interface PendingExecution {
  readonly controller: AbortController;
  readonly unlinkSignal: (() => void) | undefined;
  readonly reject: (cause: unknown) => void;
  readonly result: Promise<unknown>;
  settled: boolean;
}

/**
 * One execution admission generation. Every closure below captures this
 * generation's own `pending` map by value, so once a generation is retired
 * its late callbacks and settlements can only ever touch this generation's
 * state — never a later generation's.
 */
interface PiSynaraMcpToolExecutionGeneration {
  readonly execute: (input: PiSynaraMcpToolExecutionInput) => Promise<unknown>;
  readonly fence: () => void;
  readonly isFenced: () => boolean;
  readonly settleAll: () => Promise<void>;
  readonly inFlightCount: () => number;
  readonly disabledSettledCount: () => number;
}

function makeExecutionGeneration(): PiSynaraMcpToolExecutionGeneration {
  let fenced = false;
  let disabledSettled = 0;
  const pending = new Map<Promise<unknown>, PendingExecution>();

  const cleanup = (entry: PendingExecution) => {
    entry.unlinkSignal?.();
    pending.delete(entry.result);
  };

  const settleOne = (entry: PendingExecution) => {
    if (entry.settled) return;
    entry.settled = true;
    // Abort the underlying gateway call first so the network work stops
    // before the Pi-facing promise settles.
    entry.controller.abort(makePiSynaraMcpDisabledError());
    disabledSettled += 1;
    cleanup(entry);
    entry.reject(makePiSynaraMcpDisabledError());
  };

  return {
    execute: ({ call, signal }) => {
      // Synchronous fence: a registration racing disable is rejected before
      // its handler starts, so it can never reach the gateway.
      if (fenced) {
        return Promise.reject(makePiSynaraMcpDisabledError());
      }
      const controller = new AbortController();
      const abortFromSignal = () =>
        controller.abort(
          signal?.reason ?? new DOMException("The operation was aborted.", "AbortError"),
        );
      if (signal?.aborted) {
        abortFromSignal();
      } else if (signal !== undefined) {
        signal.addEventListener("abort", abortFromSignal, { once: true });
      }
      const unlinkSignal =
        signal === undefined
          ? undefined
          : () => signal.removeEventListener("abort", abortFromSignal);

      let rejectOnce!: (cause: unknown) => void;
      const result = new Promise<unknown>((resolve, reject) => {
        rejectOnce = reject;
        Promise.resolve()
          .then(() => call(controller.signal))
          .then(
            (value) => {
              if (entry.settled) return;
              entry.settled = true;
              cleanup(entry);
              resolve(value);
            },
            (cause) => {
              if (entry.settled) return;
              entry.settled = true;
              cleanup(entry);
              reject(cause);
            },
          );
      });
      const entry: PendingExecution = {
        controller,
        unlinkSignal,
        reject: (cause) => rejectOnce(cause),
        result,
        settled: false,
      };
      // The entry must exist before the call's synchronous section can
      // resolve; `call` is invoked on a microtask, so the registration is
      // always visible to settleAll.
      pending.set(result, entry);
      return result;
    },
    fence: () => {
      fenced = true;
    },
    isFenced: () => fenced,
    settleAll: async () => {
      for (const entry of Array.from(pending.values())) {
        settleOne(entry);
      }
    },
    inFlightCount: () => pending.size,
    disabledSettledCount: () => disabledSettled,
  };
}

export function makePiSynaraMcpToolExecutionRegistry(): PiSynaraMcpToolExecutionRegistry {
  let current = makeExecutionGeneration();
  return {
    execute: (input) => current.execute(input),
    fence: () => current.fence(),
    isFenced: () => current.isFenced(),
    settleAll: () => current.settleAll(),
    inFlightCount: () => current.inFlightCount(),
    disabledSettledCount: () => current.disabledSettledCount(),
    resetForFreshActivation: (fenceNewGeneration) => {
      // Retire the current generation permanently (it was fenced by the
      // disable that preceded this fresh activation; this is defensive and
      // self-documenting), then install the fresh admission generation.
      current.fence();
      current = makeExecutionGeneration();
      if (fenceNewGeneration) {
        current.fence();
      }
    },
  };
}
