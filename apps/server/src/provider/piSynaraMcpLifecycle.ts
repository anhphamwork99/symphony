import { randomUUID } from "node:crypto";

import type { PiSynaraMcpLifecycleAdapter, PiSynaraMcpLifecycleState } from "./piSynaraMcpExtension.ts";

/** Maximum diagnostics entries retained (newest win, oldest dropped). */
export const PI_SYNARA_MCP_DIAGNOSTIC_LIMIT = 25;

/** Maximum message length retained per diagnostics entry. */
export const PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT = 240;

/** Stable refusal for lifecycle operations issued after the coordinator is disposed. */
export const PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL =
  "Pi Synara MCP lifecycle coordinator is disposed";

/** Stable refusal for deactivation while the session is not active. */
export const PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE =
  "Pi Synara MCP deactivation requires an active session";

/** Stable refusal for activation while a deactivation handoff is outstanding. */
export const PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL =
  "Pi Synara MCP deactivation is in progress; retry after it completes";

/**
 * Bounded gateway drainage window (Decision 14): the existing two-second
 * timeout applied to the gateway registry drain barrier. A drain timeout is
 * not clean success — authority is still revoked best-effort, but the session
 * stays unavailable.
 */
export const PI_SYNARA_MCP_GATEWAY_DRAIN_TIMEOUT_MS = 2_000;

/** One bounded diagnostic record; state is the lifecycle state associated with the entry. */
export interface PiSynaraMcpDiagnosticEntry {
  readonly at: string;
  readonly kind: string;
  readonly message: string;
  readonly state: PiSynaraMcpLifecycleState;
  readonly generation?: string;
}

/**
 * Bounded diagnostics sink. {@link PiSynaraMcpDiagnostics.entries} never grows
 * beyond the configured limit and messages are truncated to
 * {@link PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT}.
 */
export interface PiSynaraMcpDiagnostics {
  readonly entries: readonly PiSynaraMcpDiagnosticEntry[];
  readonly record: (entry: {
    readonly kind: string;
    readonly message: string;
    readonly state: PiSynaraMcpLifecycleState;
    readonly generation?: string;
  }) => void;
  readonly clear: () => void;
}

/** Bounded ring-buffer diagnostics; keeps the newest `limit` entries. */
export function makePiSynaraMcpDiagnostics(
  limit: number = PI_SYNARA_MCP_DIAGNOSTIC_LIMIT,
): PiSynaraMcpDiagnostics {
  const entries: PiSynaraMcpDiagnosticEntry[] = [];
  const boundedLimit = Math.max(1, Math.floor(limit));
  return {
    get entries() {
      return entries;
    },
    record: (entry) => {
      entries.push({
        at: new Date().toISOString(),
        kind: entry.kind,
        message: truncateDiagnosticMessage(entry.message),
        state: entry.state,
        ...(entry.generation === undefined ? {} : { generation: entry.generation }),
      });
      if (entries.length > boundedLimit) {
        entries.splice(0, entries.length - boundedLimit);
      }
    },
    clear: () => {
      entries.length = 0;
    },
  };
}

/**
 * Candidate resources accumulated by one activation attempt, bound to the
 * attempt's lifecycle generation. Seams receive the record as it evolves;
 * cleanup receives whatever candidates exist when the attempt ends.
 */
export interface PiSynaraMcpStagedActivation {
  readonly lifecycleGeneration: string;
  readonly authority?: unknown;
  readonly credential?: unknown;
  readonly connection?: unknown;
  readonly catalog?: unknown;
}

export type PiSynaraMcpAuthorityValidation =
  | { readonly ok: true; readonly authority: unknown }
  | { readonly ok: false; readonly reason: string };

export type PiSynaraMcpCatalogValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** The staged step (or fencing condition) an activation attempt failed at. */
export type PiSynaraMcpActivationStage =
  | "authority"
  | "credential"
  | "connection"
  | "discovery"
  | "catalog"
  | "apply"
  | "superseded";

/**
 * Dependency-injected public seams for one activation attempt. All seams are
 * owned by the coordinator's caller; the coordinator never reaches into
 * private Pi SDK reload helpers. Cleanup must resolve only when cleanup is
 * proven and reject when it cannot be proven.
 */
export interface PiSynaraMcpActivationSeams {
  /** Trusted authority validation; fail-closed. The input is passed through untouched. */
  readonly validateAuthority: (input: unknown) => Promise<PiSynaraMcpAuthorityValidation>;
  /** Stage fresh identity-bound credentials for the validated authority. */
  readonly issueCredential: (staged: PiSynaraMcpStagedActivation) => Promise<unknown>;
  /** Stage the MCP connection and initialization. */
  readonly connect: (staged: PiSynaraMcpStagedActivation) => Promise<unknown>;
  /** Stage complete catalog discovery. */
  readonly discover: (staged: PiSynaraMcpStagedActivation) => Promise<unknown>;
  /** Validate the discovered catalog (schema and completeness); empty/malformed catalogs must be rejected. */
  readonly validateCatalog: (catalog: unknown) => Promise<PiSynaraMcpCatalogValidation>;
  /** Atomically expose the complete staged catalog at the safe boundary. */
  readonly applyAtSafeBoundary: (staged: PiSynaraMcpStagedActivation) => Promise<void>;
  /** Idempotently revoke/close/discard candidate resources. */
  readonly cleanup: (staged: PiSynaraMcpStagedActivation) => Promise<void>;
}

export type PiSynaraMcpActivationResult =
  | {
      readonly ok: true;
      readonly state: "active";
      readonly lifecycleGeneration: string;
      /** True when the session was already active and no new activation ran. */
      readonly alreadyActive: boolean;
    }
  | {
      readonly ok: false;
      readonly state: "dormant" | "unavailable";
      readonly stage: PiSynaraMcpActivationStage;
      readonly reason: string;
    };

/**
 * Deactivation handoff contract. impl-07 owns the cancellation/drain/revoke
 * ordering around {@link PiSynaraMcpDeactivationHandoff.cleanup}; the
 * coordinator retires the generation, fences admission, and finalizes the
 * state through {@link PiSynaraMcpDeactivationHandoff.complete}.
 */
export interface PiSynaraMcpDeactivationHandoff {
  /** Lifecycle generation being retired; stale completions are no-ops. */
  readonly generation: string;
  /** Trusted authority of the retired session (opaque to the coordinator). */
  readonly authority: unknown;
  /** Candidate resources of the retired session, bound to the generation. */
  readonly staged: PiSynaraMcpStagedActivation;
  /** Bound cleanup entry point for impl-07 to order around cancel/drain/revoke. */
  readonly cleanup: () => Promise<void>;
  /**
   * Runs the ordered disable sequence (settle -> gateway drain -> cleanup ->
   * boundary reload) and finalizes the state: `dormant` when every step is
   * proven, `unavailable` when any step cannot be proven. Idempotent.
   * `awaitSafeBoundary` (default true) parks the runtime reload on the next
   * safe boundary instead of reloading immediately.
   */
  readonly complete: (options?: {
    readonly awaitSafeBoundary?: boolean;
    /**
     * Exact active turn identity at disable time (Decision 14 step 2); the
     * cancel seam retires this turn's write authority before cancellation.
     */
    readonly turnId?: string;
  }) => Promise<{ readonly state: "dormant" | "unavailable" }>;
}

/**
 * impl-07 deactivation seams. All seams are owned by the coordinator's caller
 * and are optional so dormant/plain coordinators behave unchanged. The
 * coordinator guarantees the Decision 14 ordering: settle in-flight
 * Pi-facing executions exactly once, cancel and drain the gateway with the
 * bounded timeout, revoke/clear through the activation cleanup seam, then
 * reload the runtime only at the safe boundary. Any unproven step leaves the
 * session unavailable.
 */
export interface PiSynaraMcpDeactivationSeams {
  /** Settle every in-flight Pi-facing execution exactly once (structured disabled error). */
  readonly settleExecutions?: () => Promise<void>;
  /**
   * Cancel matching gateway-side in-flight requests and resolve when the
   * registry drain barrier settles (e.g. session-scoped registry cancel).
   * `options.turnId` is the exact active turn identity at disable time
   * (Decision 14 step 2): the seam must retire that turn's write authority
   * (e.g. `AgentGatewayCredentialsShape.retireSessionTurn`) before the
   * session-wide cancellation and await its drain barrier inside the bounded
   * drain so revocation cannot race a live write.
   */
  readonly cancelGatewayRequests?: (
    staged: PiSynaraMcpStagedActivation,
    options?: { readonly turnId?: string },
  ) => Promise<void>;
  /** Drain bound for {@link PiSynaraMcpDeactivationSeams.cancelGatewayRequests}. */
  readonly drainTimeoutMs?: number;
  /** Reload the runtime so the cleared surface applies; deferred to the safe boundary when awaited. */
  readonly reloadAtSafeBoundary?: () => Promise<void>;
}

export interface PiSynaraMcpLifecycleOptions {
  readonly adapter: PiSynaraMcpLifecycleAdapter;
  readonly seams: PiSynaraMcpActivationSeams;
  /** impl-07 ordered disable seams; optional so dormant/plain coordinators stay unchanged. */
  readonly deactivation?: PiSynaraMcpDeactivationSeams;
  /** Optional bounded diagnostics; a bounded default is created when omitted. */
  readonly diagnostics?: PiSynaraMcpDiagnostics;
}

export interface PiSynaraMcpLifecycleCoordinator {
  readonly state: PiSynaraMcpLifecycleState;
  readonly diagnostics: PiSynaraMcpDiagnostics;
  /**
   * Serialized activation. Stages identity validation, credentials,
   * connection, discovery, and catalog validation, defers application to the
   * safe boundary, then commits atomically. Already-active sessions return an
   * idempotent success without re-running staging.
   */
  readonly activate: (input: unknown) => Promise<PiSynaraMcpActivationResult>;
  /**
   * Serialized deactivation handoff. Requires an active session; returns a
   * handoff that retires the current generation and fences admission while
   * deactivating.
   */
  readonly beginDeactivation: () => Promise<PiSynaraMcpDeactivationHandoff>;
  /** Serialized dispose; supersedes pending activation and finalizes every state. */
  readonly dispose: () => Promise<void>;
}

const SUPERSEDED_MESSAGE = "activation superseded before completion";

class StagedActivationError extends Error {
  constructor(
    readonly stage: PiSynaraMcpActivationStage,
    override readonly cause: unknown,
  ) {
    super(`activation stage ${stage} failed`);
  }
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

function truncateDiagnosticMessage(message: string): string {
  if (message.length <= PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT) {
    return message;
  }
  return `${message.slice(0, PI_SYNARA_MCP_DIAGNOSTIC_MESSAGE_LIMIT - 1)}…`;
}

interface PendingAttempt {
  readonly generation: string;
  readonly staged: PiSynaraMcpStagedActivation;
  /** True once the apply seam started, so a rollback knows the runtime may carry the catalog. */
  exposed?: boolean;
}

/** Mutable internal view of the staged record; the coordinator fills candidates in place. */
interface MutableStagedActivation {
  readonly lifecycleGeneration: string;
  authority?: unknown;
  credential?: unknown;
  connection?: unknown;
  catalog?: unknown;
}

interface PendingHandoff {
  readonly generation: string;
  readonly staged: PiSynaraMcpStagedActivation;
  /** True when the committed activation exposed the catalog to the runtime. */
  readonly exposed: boolean;
  final?: "dormant" | "unavailable";
  public?: PiSynaraMcpDeactivationHandoff;
}

/**
 * Per-session Pi Synara MCP lifecycle coordinator. Owns the dormant,
 * activating, active, deactivating, and unavailable transitions for one
 * adapter, serializes every lifecycle operation, and fences stale completions
 * by generation so a superseded activation can never expose tools.
 */
export function makePiSynaraMcpLifecycleCoordinator(
  options: PiSynaraMcpLifecycleOptions,
): PiSynaraMcpLifecycleCoordinator {
  const { adapter, seams } = options;
  const deactivationSeams = options.deactivation ?? {};
  const diagnostics = options.diagnostics ?? makePiSynaraMcpDiagnostics();

  let disposed = false;
  // Set synchronously when disposal is requested, before the serialized
  // dispose operation reaches the queue. This fences lifecycle operations
  // that were queued earlier but have not started yet, so a pending
  // activation can never re-arm itself after dispose and stall the queue
  // (e.g. waiting on a safe boundary that dispose would otherwise supersede).
  let disposeRequested = false;
  let pendingAttempt: PendingAttempt | undefined;
  let committed: PendingAttempt | undefined;
  let pendingHandoff: PendingHandoff | undefined;
  let boundaryResolve: (() => void) | undefined;
  let removeBoundaryListener: (() => void) | undefined;

  // Promise-chain mutex: lifecycle operations serialize in call order.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const clearBoundaryWait = () => {
    removeBoundaryListener?.();
    removeBoundaryListener = undefined;
    boundaryResolve = undefined;
  };

  const waitForSafeBoundary = () =>
    new Promise<void>((resolve) => {
      boundaryResolve = resolve;
      removeBoundaryListener = adapter.onSafeBoundary(() => resolve());
    });

  const runCleanup = async (
    staged: PiSynaraMcpStagedActivation,
    generation: string,
  ): Promise<"dormant" | "unavailable"> => {
    try {
      await seams.cleanup(staged);
      return "dormant";
    } catch (cause) {
      diagnostics.record({
        kind: "cleanup.uncertain",
        message: `cleanup could not be proven: ${toErrorMessage(cause)}`,
        state: "unavailable",
        generation,
      });
      return "unavailable";
    }
  };

  /**
   * Cancel and drain gateway-side in-flight requests within the bounded
   * window. A drain timeout or failure is not clean success (Decision 14):
   * cleanup still proceeds best-effort, but the final state is unavailable.
   */
  const drainGatewayRequests = async (
    staged: PiSynaraMcpStagedActivation,
    generation: string,
    turnId: string | undefined,
  ): Promise<boolean> => {
    const cancel = deactivationSeams.cancelGatewayRequests;
    if (cancel === undefined) return true;
    const timeoutMs = Math.max(
      1,
      deactivationSeams.drainTimeoutMs ?? PI_SYNARA_MCP_GATEWAY_DRAIN_TIMEOUT_MS,
    );
    const outcome = await Promise.race([
      cancel(staged, turnId === undefined ? undefined : { turnId }).then(
        () => "drained" as const,
        (cause) => ({ kind: "failed" as const, cause }),
      ),
      new Promise<{ readonly kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs),
      ),
    ]);
    if (outcome === "drained") return true;
    diagnostics.record({
      kind: outcome.kind === "timeout" ? "disable.drain.timeout" : "disable.drain.failed",
      message:
        outcome.kind === "timeout"
          ? `gateway drain exceeded the ${timeoutMs}ms bound`
          : `gateway drain failed: ${toErrorMessage(outcome.cause)}`,
      state: "deactivating",
      generation,
    });
    return false;
  };

  /**
   * Decision 14 disable sequence: settle Pi-facing executions exactly once,
   * drain the gateway with the bounded timeout, revoke/clear, then reload at
   * the safe boundary. Only a fully proven sequence finalizes dormant; every
   * uncertainty leaves the session unavailable.
   */
  const finalizeDeactivation = async (
    handoff: PendingHandoff,
    options: {
      readonly awaitSafeBoundary: boolean;
      readonly reload: boolean;
      readonly turnId?: string;
    },
  ): Promise<"dormant" | "unavailable"> => {
    if (handoff.final !== undefined) {
      return handoff.final;
    }

    let settlementProven = true;
    if (deactivationSeams.settleExecutions !== undefined) {
      try {
        await deactivationSeams.settleExecutions();
      } catch (cause) {
        settlementProven = false;
        diagnostics.record({
          kind: "disable.settle.uncertain",
          message: `in-flight MCP settlement could not be proven: ${toErrorMessage(cause)}`,
          state: "deactivating",
          generation: handoff.generation,
        });
      }
    }

    const drained = await drainGatewayRequests(handoff.staged, handoff.generation, options.turnId);
    const cleanupProven = (await runCleanup(handoff.staged, handoff.generation)) === "dormant";

    let reloadProven = true;
    if (
      options.reload &&
      handoff.exposed &&
      deactivationSeams.reloadAtSafeBoundary !== undefined
    ) {
      if (options.awaitSafeBoundary) {
        await waitForSafeBoundary();
      }
      try {
        await deactivationSeams.reloadAtSafeBoundary();
      } catch (cause) {
        reloadProven = false;
        diagnostics.record({
          kind: "disable.reload.uncertain",
          message: `runtime reload at the safe boundary could not be proven: ${toErrorMessage(cause)}`,
          state: "deactivating",
          generation: handoff.generation,
        });
      } finally {
        clearBoundaryWait();
      }
    }

    const outcome =
      settlementProven && drained && cleanupProven && reloadProven ? "dormant" : "unavailable";
    handoff.final = outcome;
    pendingHandoff = undefined;
    adapter.transition(outcome);
    diagnostics.record({
      kind: "deactivation.completed",
      message: "deactivation completed",
      state: outcome,
      generation: handoff.generation,
    });
    return outcome;
  };

  const activate = (input: unknown): Promise<PiSynaraMcpActivationResult> =>
    enqueue(async () => {
      if (disposed || disposeRequested) {
        throw new Error(PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL);
      }
      if (adapter.state === "deactivating") {
        throw new Error(PI_SYNARA_MCP_DEACTIVATION_IN_PROGRESS_REFUSAL);
      }
      if (committed !== undefined && adapter.state === "active") {
        return {
          ok: true,
          state: "active",
          lifecycleGeneration: committed.generation,
          alreadyActive: true,
        };
      }

      const generation = randomUUID();
      const staged: MutableStagedActivation = { lifecycleGeneration: generation };
      const attempt: PendingAttempt = { generation, staged };
      pendingAttempt = attempt;
      adapter.transition("activating");
      diagnostics.record({
        kind: "activation.started",
        message: "activation started",
        state: "activating",
        generation,
      });

      const fenced = () => pendingAttempt === attempt;
      const rollback = async (
        stage: PiSynaraMcpActivationStage,
        reason: string,
      ): Promise<PiSynaraMcpActivationResult> => {
        clearBoundaryWait();
        let outcome = await runCleanup(staged, generation);
        // When the apply seam already ran, the runtime may carry the staged
        // catalog: reload immediately (the rollback context is the same safe
        // boundary where apply ran) so no partial tool surface survives.
        if (attempt.exposed === true && deactivationSeams.reloadAtSafeBoundary !== undefined) {
          try {
            await deactivationSeams.reloadAtSafeBoundary();
          } catch (cause) {
            outcome = "unavailable";
            diagnostics.record({
              kind: "activation.reload.uncertain",
              message: `reload after rollback could not be proven: ${toErrorMessage(cause)}`,
              state: "unavailable",
              generation,
            });
          }
        }
        pendingAttempt = undefined;
        adapter.transition(outcome);
        diagnostics.record({
          kind: "activation.failed",
          message: `activation failed at ${stage}: ${reason}`,
          state: outcome,
          generation,
        });
        return { ok: false, state: outcome, stage, reason };
      };
      const step = async <T>(stage: PiSynaraMcpActivationStage, run: () => Promise<T>): Promise<T> => {
        try {
          return await run();
        } catch (cause) {
          throw new StagedActivationError(stage, cause);
        }
      };

      try {
        const validation = await step("authority", () => seams.validateAuthority(input));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        if (!validation.ok) {
          return await rollback("authority", validation.reason);
        }
        staged.authority = validation.authority;

        staged.credential = await step("credential", () => seams.issueCredential(staged));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        staged.connection = await step("connection", () => seams.connect(staged));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        staged.catalog = await step("discovery", () => seams.discover(staged));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        const catalogValidation = await step("catalog", () => seams.validateCatalog(staged.catalog));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        if (!catalogValidation.ok) {
          return await rollback("catalog", catalogValidation.reason);
        }

        // All candidates staged and validated: defer exposure to the safe boundary.
        await waitForSafeBoundary();
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }

        attempt.exposed = true;
        await step("apply", () => seams.applyAtSafeBoundary(staged));
        if (!fenced()) {
          return await rollback("superseded", SUPERSEDED_MESSAGE);
        }
        clearBoundaryWait();
      } catch (cause) {
        clearBoundaryWait();
        if (cause instanceof StagedActivationError) {
          if (!fenced()) {
            return await rollback("superseded", SUPERSEDED_MESSAGE);
          }
          return await rollback(cause.stage, toErrorMessage(cause.cause));
        }
        throw cause;
      }

      committed = { generation, staged, exposed: attempt.exposed ?? false };
      pendingAttempt = undefined;
      adapter.transition("active");
      diagnostics.record({
        kind: "activation.committed",
        message: "activation committed",
        state: "active",
        generation,
      });
      return { ok: true, state: "active", lifecycleGeneration: generation, alreadyActive: false };
    });

  const beginDeactivation = (): Promise<PiSynaraMcpDeactivationHandoff> =>
    enqueue(async () => {
      if (disposed || disposeRequested) {
        throw new Error(PI_SYNARA_MCP_LIFECYCLE_DISPOSED_REFUSAL);
      }
      // Duplicate disable while deactivating is idempotent: return the same
      // handoff so both callers observe the same terminal state.
      if (
        pendingHandoff !== undefined &&
        pendingHandoff.public !== undefined &&
        adapter.state === "deactivating"
      ) {
        return pendingHandoff.public;
      }
      if (committed === undefined || adapter.state !== "active") {
        throw new Error(PI_SYNARA_MCP_DEACTIVATION_REQUIRES_ACTIVE);
      }
      const { generation, staged } = committed;
      const exposed = committed.exposed === true;
      committed = undefined;
      const handoff: PendingHandoff = { generation, staged, exposed };
      pendingHandoff = handoff;
      adapter.transition("deactivating");
      diagnostics.record({
        kind: "deactivation.started",
        message: "deactivation started",
        state: "deactivating",
        generation,
      });

      const complete = (options?: {
        readonly awaitSafeBoundary?: boolean;
        readonly turnId?: string;
      }): Promise<{ readonly state: "dormant" | "unavailable" }> =>
        enqueue(async () => {
          if (handoff.final !== undefined) {
            return { state: handoff.final };
          }
          if (pendingHandoff !== handoff) {
            // Another path (dispose) already finalized this handoff; its
            // outcome is recorded on the handoff itself.
            return {
              state: handoff.final ?? (adapter.state === "unavailable" ? "unavailable" : "dormant"),
            };
          }
          const outcome = await finalizeDeactivation(handoff, {
            awaitSafeBoundary: options?.awaitSafeBoundary ?? true,
            reload: true,
            ...(options?.turnId === undefined ? {} : { turnId: options.turnId }),
          });
          return { state: outcome };
        });

      const publicHandoff: PiSynaraMcpDeactivationHandoff = {
        generation,
        authority: staged.authority,
        staged,
        cleanup: () => seams.cleanup(staged),
        complete,
      };
      handoff.public = publicHandoff;
      return publicHandoff;
    });

  const dispose = (): Promise<void> => {
    // Non-serialized abort: fence any in-flight activation so a stale
    // completion can never commit after dispose. The fenced attempt performs
    // its own rollback inside the queue; this body then finalizes whatever
    // state remains. Operations still queued behind the fence observe
    // disposeRequested and refuse to start, so dispose never waits on an
    // activation that is waiting for a safe boundary.
    disposeRequested = true;
    pendingAttempt = undefined;
    boundaryResolve?.();
    return enqueue(async () => {
      if (adapter.state === "active" && committed !== undefined) {
        const { generation, staged } = committed;
        const exposed = committed.exposed === true;
        committed = undefined;
        const handoff: PendingHandoff = { generation, staged, exposed };
        pendingHandoff = handoff;
        adapter.transition("deactivating");
        diagnostics.record({
          kind: "deactivation.started",
          message: "deactivation started",
          state: "deactivating",
          generation,
        });
        // Teardown finalizes immediately: the runtime is being disposed, so
        // no boundary reload is needed or safe.
        await finalizeDeactivation(handoff, { awaitSafeBoundary: false, reload: false });
      } else if (adapter.state === "deactivating" && pendingHandoff !== undefined) {
        await finalizeDeactivation(pendingHandoff, { awaitSafeBoundary: false, reload: false });
      }
      disposed = true;
      diagnostics.record({
        kind: "disposed",
        message: "lifecycle coordinator disposed",
        state: adapter.state,
      });
    });
  };

  return {
    get state() {
      return adapter.state;
    },
    diagnostics,
    activate,
    beginDeactivation,
    dispose,
  };
}
