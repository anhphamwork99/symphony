import { randomUUID } from "node:crypto";

import {
  ApprovalRequestId,
  EventId,
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  RuntimeRequestId,
  RuntimeSessionId,
  ProviderSession,
  ProviderSessionStartInput,
  ProviderTurnStartResult,
  ThreadId,
  TurnId,
  ProviderKind,
} from "@synara/contracts";
import type {
  McpAuthorityAdmissionFailure,
  McpAuthorityBinding,
} from "../src/agentGateway/mcpSessionAuthority.ts";
import type { McpSessionAuthorityShape } from "../src/agentGateway/Services/McpSessionAuthority.ts";
import { Effect, PubSub, Stream } from "effect";

import {
  PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
  PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
} from "../src/provider/piSynaraMcpEnable.ts";
import { PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL } from "../src/provider/piSynaraMcpDisable.ts";
import { makePiSynaraMcpDisabledError } from "../src/provider/piSynaraMcpToolExecution.ts";
import {
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../src/provider/Errors.ts";
import type {
  ProviderAdapterShape,
  ProviderDisableSynaraMcpResult,
  ProviderEnableSynaraMcpResult,
  ProviderThreadSnapshot,
  ProviderThreadTurnSnapshot,
} from "../src/provider/Services/ProviderAdapter.ts";

export interface TestTurnResponse {
  readonly events: ReadonlyArray<FixtureProviderRuntimeEvent>;
  readonly deferCompletion?: boolean;
  readonly mutateWorkspace?: (input: {
    readonly cwd: string;
    readonly turnCount: number;
  }) => Effect.Effect<void, never>;
}

export type FixtureProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderKind;
  readonly createdAt: string;
  readonly threadId: string;
  readonly turnId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly requestId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

// Temporary alias while fixtures migrate to the new name.
export type LegacyProviderRuntimeEvent = FixtureProviderRuntimeEvent;

/**
 * Deterministic per-thread enable control for the fixture's
 * `enableSynaraMcp` (impl-12 WP2): "succeed" completes activation
 * immediately, "defer" waits on the per-thread release gate, and "fail"
 * returns the bounded unavailable result without staging anything.
 */
export type TestSynaraMcpEnableControl = "succeed" | "defer" | "fail";

/**
 * Deterministic per-thread disable control for the fixture's
 * `disableSynaraMcp`: "succeed" completes the full ordered sequence
 * immediately, "defer" waits on the per-thread release gate before the
 * final reload stage, and "fail" runs the full sequence but reports the
 * bounded unavailable result (cleanup is never skipped).
 */
export type TestSynaraMcpDisableControl = "succeed" | "defer" | "fail";

/**
 * Ordered Decision-14 disable stages recorded by the fixture: fence new
 * admissions synchronously, settle in-flight executions exactly once, cancel
 * gateway requests, revoke/clear credentials, reload at the safe boundary.
 */
export type TestSynaraMcpDisableStage = "fence" | "settle" | "cancel" | "revoke" | "reload";

/** Outcome a test can release a deferred enable/disable with. */
export type TestSynaraMcpReleaseOutcome = "succeed" | "fail";

/** One recorded enable invocation: the full captured vs live generation pair. */
export interface TestSynaraMcpEnableCall {
  readonly expectedSessionGeneration: string;
  readonly liveSessionGeneration: string | undefined;
}

/** One recorded disable invocation with its ordered stage sequence. */
export interface TestSynaraMcpDisableCall {
  readonly stages: ReadonlyArray<TestSynaraMcpDisableStage>;
}

/**
 * Structured fail-closed denial for a Pi-facing Synara MCP call whose
 * subject-bound credential binding is missing, mismatched, stale, revoked,
 * or expired at the provider admission boundary (Decision 21). The denial
 * reason is the production `McpAuthorityAdmissionFailure` union (plus the
 * transport-level "missing-binding" outcome for an unbound session), never
 * an invented diagnostic.
 */
export const SYNARA_MCP_AUTHORITY_DENIED_ERROR_CODE = "synara_mcp_authority_denied" as const;

export interface SynaraMcpAuthorityDeniedError extends Error {
  readonly code: typeof SYNARA_MCP_AUTHORITY_DENIED_ERROR_CODE;
  readonly reason: McpAuthorityAdmissionFailure | "missing-binding";
}

export function makeSynaraMcpAuthorityDeniedError(
  reason: McpAuthorityAdmissionFailure | "missing-binding",
): SynaraMcpAuthorityDeniedError {
  return Object.assign(new Error(`Synara MCP authority denied: ${reason}`), {
    name: "SynaraMcpAuthorityDeniedError",
    code: SYNARA_MCP_AUTHORITY_DENIED_ERROR_CODE,
    reason,
  }) as SynaraMcpAuthorityDeniedError;
}

export function isSynaraMcpAuthorityDeniedError(
  cause: unknown,
): cause is SynaraMcpAuthorityDeniedError {
  return (
    cause instanceof Error &&
    (cause as SynaraMcpAuthorityDeniedError).code === SYNARA_MCP_AUTHORITY_DENIED_ERROR_CODE
  );
}

/** Pi-facing Synara MCP call handler used by the fixture's call simulation. */
export type TestSynaraMcpCallHandler = (signal: AbortSignal) => Promise<unknown>;

/** One in-flight Pi-facing Synara MCP call simulated by the fixture. */
export interface TestSynaraMcpInflightCall {
  readonly controller: AbortController;
  readonly reject: (cause: unknown) => void;
  readonly result: Promise<unknown>;
  settled: boolean;
}

/** A promise-based gate a deferred enable/disable waits on until released. */
interface SynaraMcpDeferGate<A> {
  readonly promise: Promise<A>;
  release(value: A): void;
}

function makeDeferGate<A>(): SynaraMcpDeferGate<A> {
  let release!: (value: A) => void;
  const promise = new Promise<A>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Per-session deterministic Synara MCP lifecycle state. The lifecycle state
 * machine mirrors the production extension boundary: dormant -> active via
 * a proven enable, active -> dormant via a proven disable, and unavailable
 * when an enable/disable could not be proven; a fresh matching enable is
 * always allowed again (unavailable -> activating is a legal transition).
 */
interface SynaraMcpSessionState {
  state: "dormant" | "active" | "unavailable";
  /** Admission fence installed synchronously by every disable. */
  fenced: boolean;
  enableControl: TestSynaraMcpEnableControl;
  disableControl: TestSynaraMcpDisableControl;
  enableCalls: Array<TestSynaraMcpEnableCall>;
  disableCalls: Array<TestSynaraMcpDisableCall>;
  enableGate: SynaraMcpDeferGate<ProviderEnableSynaraMcpResult>;
  disableGate: SynaraMcpDeferGate<ProviderDisableSynaraMcpResult>;
  inflightCalls: Map<Promise<unknown>, TestSynaraMcpInflightCall>;
  disabledSettledCount: number;
}

function makeSynaraMcpSessionState(): SynaraMcpSessionState {
  return {
    state: "dormant",
    fenced: false,
    enableControl: "succeed",
    disableControl: "succeed",
    enableCalls: [],
    disableCalls: [],
    enableGate: makeDeferGate(),
    disableGate: makeDeferGate(),
    inflightCalls: new Map(),
    disabledSettledCount: 0,
  };
}

interface SessionState {
  readonly session: ProviderSession;
  readonly lifecycleGeneration: string | undefined;
  /** The server-minted subject-bound MCP authority captured at session start (Decision 21). */
  readonly mcpAuthority: ProviderSessionStartInput["mcpAuthority"];
  snapshot: ProviderThreadSnapshot;
  turnCount: number;
  readonly queuedResponses: Array<TestTurnResponse>;
  readonly rollbackCalls: Array<number>;
  deferredCompletionEvents: Array<ProviderRuntimeEvent>;
  /** Deterministic per-session Synara MCP lifecycle state (impl-12 WP2). */
  readonly synaraMcp: SynaraMcpSessionState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeTurnState(value: unknown): "completed" | "failed" | "interrupted" | "cancelled" {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "completed";
}

function mapRequestType(
  requestKind: unknown,
): "command_execution_approval" | "file_change_approval" | "unknown" {
  if (requestKind === "command") {
    return "command_execution_approval";
  }
  if (requestKind === "file-change") {
    return "file_change_approval";
  }
  return "unknown";
}

function mapItemType(toolKind: unknown): "command_execution" | "file_change" | "unknown" {
  if (toolKind === "command") {
    return "command_execution";
  }
  if (toolKind === "file-change") {
    return "file_change";
  }
  return "unknown";
}

function normalizeFixtureEvent(rawEvent: Record<string, unknown>): ProviderRuntimeEvent {
  const type = typeof rawEvent.type === "string" ? rawEvent.type : "";
  switch (type) {
    case "turn.started":
      return {
        ...rawEvent,
        type: "turn.started",
        payload: isRecord(rawEvent.payload) ? rawEvent.payload : {},
      } as ProviderRuntimeEvent;
    case "turn.completed":
      return {
        ...rawEvent,
        type: "turn.completed",
        payload: isRecord(rawEvent.payload)
          ? rawEvent.payload
          : {
              state: normalizeTurnState(rawEvent.status),
            },
      } as ProviderRuntimeEvent;
    case "message.delta":
      return {
        ...rawEvent,
        type: "content.delta",
        payload: {
          streamKind: "assistant_text",
          delta: typeof rawEvent.delta === "string" ? rawEvent.delta : "",
        },
      } as ProviderRuntimeEvent;
    case "message.completed":
      return {
        ...rawEvent,
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          ...(typeof rawEvent.detail === "string" ? { detail: rawEvent.detail } : {}),
        },
      } as ProviderRuntimeEvent;
    case "tool.started":
      return {
        ...rawEvent,
        type: "item.started",
        payload: {
          itemType: mapItemType(rawEvent.toolKind),
          ...(typeof rawEvent.title === "string" ? { title: rawEvent.title } : {}),
          ...(typeof rawEvent.detail === "string" ? { detail: rawEvent.detail } : {}),
        },
      } as ProviderRuntimeEvent;
    case "tool.completed":
      return {
        ...rawEvent,
        type: "item.completed",
        payload: {
          itemType: mapItemType(rawEvent.toolKind),
          status: "completed",
          ...(typeof rawEvent.title === "string" ? { title: rawEvent.title } : {}),
          ...(typeof rawEvent.detail === "string" ? { detail: rawEvent.detail } : {}),
        },
      } as ProviderRuntimeEvent;
    case "approval.requested":
      return {
        ...rawEvent,
        type: "request.opened",
        payload: {
          requestType: mapRequestType(rawEvent.requestKind),
          ...(typeof rawEvent.detail === "string" ? { detail: rawEvent.detail } : {}),
        },
      } as ProviderRuntimeEvent;
    case "approval.resolved":
      return {
        ...rawEvent,
        type: "request.resolved",
        payload: {
          requestType: mapRequestType(rawEvent.requestKind),
          ...(typeof rawEvent.decision === "string" ? { decision: rawEvent.decision } : {}),
        },
      } as ProviderRuntimeEvent;
    default:
      return rawEvent as ProviderRuntimeEvent;
  }
}

export interface TestProviderAdapterHarness {
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  readonly provider: ProviderKind;
  readonly queueTurnResponse: (
    threadId: ThreadId,
    response: TestTurnResponse,
  ) => Effect.Effect<void, ProviderAdapterSessionNotFoundError>;
  readonly queueTurnResponseForNextSession: (
    response: TestTurnResponse,
  ) => Effect.Effect<void, never>;
  readonly getStartCount: () => number;
  readonly getRollbackCalls: (threadId: ThreadId) => ReadonlyArray<number>;
  readonly getInterruptCalls: (threadId: ThreadId) => ReadonlyArray<TurnId | undefined>;
  readonly listActiveSessionIds: () => ReadonlyArray<ThreadId>;
  readonly getApprovalResponses: (threadId: ThreadId) => ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly requestId: ApprovalRequestId;
    readonly decision: ProviderApprovalDecision;
  }>;
  /**
   * The server-minted subject-bound MCP authority captured from the
   * session-start input (Decision 21), or undefined when the session started
   * without one (fail closed). Unknown sessions return undefined.
   */
  readonly getMcpAuthority: (threadId: ThreadId) => ProviderSessionStartInput["mcpAuthority"];
  /**
   * Arm the deterministic per-thread enable control. "defer" arms a fresh
   * release gate; a release issued before the enable runs is still honored.
   */
  readonly configureEnableOutcome: (
    threadId: ThreadId,
    control: TestSynaraMcpEnableControl,
  ) => Effect.Effect<void, ProviderAdapterSessionNotFoundError>;
  /**
   * Arm the deterministic per-thread disable control. "defer" arms a fresh
   * release gate; the synchronous fence and in-flight settlement still run
   * before the gate, so the fence is never delayed by a deferred disable.
   */
  readonly configureDisableOutcome: (
    threadId: ThreadId,
    control: TestSynaraMcpDisableControl,
  ) => Effect.Effect<void, ProviderAdapterSessionNotFoundError>;
  /**
   * Release a deferred enable. Succeeds the enable (default) or fails it
   * with the bounded unavailable result. Idempotent; fails when no deferred
   * enable is armed for the thread.
   */
  readonly releaseEnable: (
    threadId: ThreadId,
    outcome?: TestSynaraMcpReleaseOutcome,
  ) => Effect.Effect<void, ProviderAdapterError>;
  /**
   * Release a deferred disable. Succeeds the disable (default) or fails it
   * with the bounded unavailable result. Idempotent; fails when no deferred
   * disable is armed for the thread.
   */
  readonly releaseDisable: (
    threadId: ThreadId,
    outcome?: TestSynaraMcpReleaseOutcome,
  ) => Effect.Effect<void, ProviderAdapterError>;
  /** Recorded enable invocations for a thread (empty for unknown sessions). */
  readonly getEnableCalls: (threadId: ThreadId) => ReadonlyArray<TestSynaraMcpEnableCall>;
  /** Recorded disable invocations with ordered stages (empty for unknown sessions). */
  readonly getDisableCalls: (threadId: ThreadId) => ReadonlyArray<TestSynaraMcpDisableCall>;
  /**
   * Simulate one Pi-facing Synara MCP call. Fail closed while the session is
   * not proven active (dormant startup or unavailable) or fenced (a
   * registration racing disable): the returned promise rejects immediately
   * with the structured disabled error before the handler starts. When the
   * session is active the call is admitted only when its subject-bound MCP
   * authority binding is present and admittable against the REAL MCP session
   * authority registry; a missing, mismatched, stale, revoked, or expired
   * binding rejects with the structured authority-denied error before the
   * handler starts. When disable settles the session, every in-flight call
   * rejects exactly once with the structured disabled error and its
   * controller aborts. Without a handler the call stays in flight until
   * disable settles it. Unknown sessions reject with the session-not-found
   * error shape.
   */
  readonly startSynaraMcpCall: (
    threadId: ThreadId,
    handler?: TestSynaraMcpCallHandler,
    options?: { readonly bindingOverride?: McpAuthorityBinding },
  ) => Promise<unknown>;
  /**
   * Emit the deferred turn-completion events of an active deferred turn
   * (completes the turn normally through the runtime event path). No-op for
   * sessions without deferred completions; unknown sessions fail with the
   * session-not-found error shape.
   */
  readonly completeDeferredTurn: (threadId: ThreadId) => Effect.Effect<void, ProviderAdapterError>;
  /** Whether the session's Synara MCP admission fence is installed. */
  readonly isSynaraMcpFenced: (threadId: ThreadId) => boolean;
  /** In-flight simulated Synara MCP call count (bounded diagnostics). */
  readonly getSynaraMcpInFlightCount: (threadId: ThreadId) => number;
  /** Calls settled as disabled (bounded diagnostics; never a replay list). */
  readonly getSynaraMcpDisabledSettledCount: (threadId: ThreadId) => number;
}

interface MakeTestProviderAdapterHarnessOptions {
  readonly provider?: ProviderKind;
  /**
   * Lazily resolve the REAL MCP session authority registry (Decision 21) the
   * provider-boundary admission validates captured bindings against. Wired by
   * `WsOrchestrationHarness` from the live server service; standalone harness
   * usages that never admit MCP calls may omit it.
   */
  readonly mcpSessionAuthority?: () => McpSessionAuthorityShape;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sessionNotFound(
  provider: ProviderKind,
  threadId: ThreadId,
): ProviderAdapterSessionNotFoundError {
  return new ProviderAdapterSessionNotFoundError({
    provider,
    threadId: String(threadId),
  });
}

function missingSessionEffect(
  provider: ProviderKind,
  threadId: ThreadId,
): Effect.Effect<never, ProviderAdapterError> {
  return Effect.fail(sessionNotFound(provider, threadId));
}

export const makeTestProviderAdapterHarness = (options?: MakeTestProviderAdapterHarnessOptions) =>
  Effect.gen(function* () {
    const provider = options?.provider ?? "codex";
    const mcpSessionAuthority = options?.mcpSessionAuthority;
    const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
    let sessionCount = 0;
    const sessions = new Map<ThreadId, SessionState>();
    const queuedResponsesForNextSession: TestTurnResponse[] = [];
    const interruptCallsBySession = new Map<ThreadId, Array<TurnId | undefined>>();
    const approvalResponsesBySession = new Map<
      ThreadId,
      Array<{
        readonly threadId: ThreadId;
        readonly requestId: ApprovalRequestId;
        readonly decision: ProviderApprovalDecision;
      }>
    >();

    const emit = (event: ProviderRuntimeEvent) => PubSub.publish(runtimeEvents, event);

    const startSession: ProviderAdapterShape<ProviderAdapterError>["startSession"] = (input) =>
      Effect.gen(function* () {
        if (input.provider !== undefined && input.provider !== provider) {
          return yield* new ProviderAdapterValidationError({
            provider,
            operation: "startSession",
            issue: `Expected provider '${provider}' but received '${input.provider}'.`,
          });
        }

        sessionCount += 1;
        const threadId = input.threadId;
        const createdAt = nowIso();

        const session: ProviderSession = {
          provider,
          status: "ready",
          runtimeMode: input.runtimeMode,
          threadId,
          cwd: input.cwd,
          resumeCursor: input.resumeCursor ?? { threadId: String(threadId), seed: sessionCount },
          createdAt,
          updatedAt: createdAt,
        };

        sessions.set(threadId, {
          session,
          lifecycleGeneration: input.lifecycleGeneration,
          mcpAuthority: input.mcpAuthority,
          snapshot: {
            threadId,
            turns: [],
          },
          turnCount: 0,
          queuedResponses: queuedResponsesForNextSession.splice(0),
          rollbackCalls: [],
          deferredCompletionEvents: [],
          synaraMcp: makeSynaraMcpSessionState(),
        });

        return session;
      });

    const sendTurn: ProviderAdapterShape<ProviderAdapterError>["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const state = sessions.get(input.threadId);
        if (!state) {
          return yield* missingSessionEffect(provider, input.threadId);
        }

        state.turnCount += 1;
        const turnCount = state.turnCount;
        const turnId = TurnId.makeUnsafe(`turn-${turnCount}`);

        const response = state.queuedResponses.shift();
        if (!response) {
          return yield* new ProviderAdapterValidationError({
            provider,
            operation: "sendTurn",
            issue: `No queued turn response for thread ${input.threadId}.`,
          });
        }

        const assistantDeltas: string[] = [];
        const deferredTurnCompletedEvents: ProviderRuntimeEvent[] = [];
        for (const fixtureEvent of response.events) {
          const rawEvent: Record<string, unknown> = {
            ...(fixtureEvent as Record<string, unknown>),
            eventId: randomUUID(),
            provider,
            sessionId: RuntimeSessionId.makeUnsafe(String(input.threadId)),
            createdAt: nowIso(),
            ...(state.lifecycleGeneration !== undefined
              ? { lifecycleGeneration: state.lifecycleGeneration }
              : {}),
          };
          rawEvent.threadId = state.snapshot.threadId;
          if (Object.hasOwn(rawEvent, "turnId")) {
            rawEvent.turnId = turnId;
          }

          const runtimeEvent = normalizeFixtureEvent(rawEvent);
          const runtimeType = (runtimeEvent as { type: string }).type;
          if (runtimeType === "content.delta") {
            const payload = runtimeEvent.payload as { delta?: unknown } | undefined;
            if (typeof payload?.delta === "string") {
              assistantDeltas.push(payload.delta);
            }
          } else if (runtimeType === "message.delta") {
            const legacyDelta = (runtimeEvent as { delta?: unknown }).delta;
            if (typeof legacyDelta === "string") {
              assistantDeltas.push(legacyDelta);
            }
          }
          if (runtimeEvent.type === "turn.completed") {
            deferredTurnCompletedEvents.push(runtimeEvent);
            continue;
          }

          yield* emit(runtimeEvent);
        }

        if (response.mutateWorkspace && state.session.cwd) {
          yield* response.mutateWorkspace({ cwd: state.session.cwd!, turnCount });
        }

        const userItem = {
          type: "userMessage",
          content: [{ type: "text", text: input.input }],
        } as const;
        const assistantText = assistantDeltas.join("");
        const nextItems: Array<unknown> =
          assistantText.length > 0
            ? [userItem, { type: "agentMessage", text: assistantText }]
            : [userItem];

        const nextTurn: ProviderThreadTurnSnapshot = {
          id: turnId,
          items: nextItems,
        };

        state.snapshot = {
          threadId: state.snapshot.threadId,
          turns: [...state.snapshot.turns, nextTurn],
        };

        if (response.deferCompletion) {
          state.deferredCompletionEvents = deferredTurnCompletedEvents;
        } else if (deferredTurnCompletedEvents.length === 0) {
          yield* emit({
            type: "turn.completed",
            eventId: EventId.makeUnsafe(randomUUID()),
            provider,
            createdAt: nowIso(),
            threadId: state.snapshot.threadId,
            turnId,
            payload: {
              state: "completed",
            },
          });
        } else {
          for (const completedEvent of deferredTurnCompletedEvents) {
            yield* emit(completedEvent);
          }
        }

        return {
          threadId: state.snapshot.threadId,
          turnId,
        } satisfies ProviderTurnStartResult;
      });

    const interruptTurn: ProviderAdapterShape<ProviderAdapterError>["interruptTurn"] = (
      threadId,
      turnId,
    ) =>
      sessions.has(threadId)
        ? Effect.sync(() => {
            const existing = interruptCallsBySession.get(threadId) ?? [];
            existing.push(turnId);
            interruptCallsBySession.set(threadId, existing);
          })
        : missingSessionEffect(provider, threadId);

    const respondToRequest: ProviderAdapterShape<ProviderAdapterError>["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) => {
      const state = sessions.get(threadId);
      if (!state) {
        return missingSessionEffect(provider, threadId);
      }
      return Effect.gen(function* () {
        yield* Effect.sync(() => {
          const existing = approvalResponsesBySession.get(threadId) ?? [];
          existing.push({
            threadId,
            requestId,
            decision,
          });
          approvalResponsesBySession.set(threadId, existing);
        });
        yield* emit({
          type: "request.resolved",
          eventId: EventId.makeUnsafe(randomUUID()),
          provider,
          createdAt: nowIso(),
          threadId,
          requestId: RuntimeRequestId.makeUnsafe(requestId),
          ...(state.lifecycleGeneration !== undefined
            ? { lifecycleGeneration: state.lifecycleGeneration }
            : {}),
          payload: {
            requestType: "unknown",
            decision,
          },
        });
        const deferredCompletionEvents = state.deferredCompletionEvents;
        state.deferredCompletionEvents = [];
        yield* Effect.forEach(deferredCompletionEvents, emit, { discard: true });
      });
    };

    const respondToUserInput: ProviderAdapterShape<ProviderAdapterError>["respondToUserInput"] = (
      threadId,
      _requestId,
      _answers,
    ) => (sessions.has(threadId) ? Effect.void : missingSessionEffect(provider, threadId));

    const settleInflightSynaraMcpCalls = (mcp: SynaraMcpSessionState) => {
      for (const entry of Array.from(mcp.inflightCalls.values())) {
        if (entry.settled) continue;
        entry.settled = true;
        // Abort the underlying gateway call first, then settle the Pi-facing
        // promise exactly once with the structured disabled error.
        entry.controller.abort(makePiSynaraMcpDisabledError());
        mcp.disabledSettledCount += 1;
        mcp.inflightCalls.delete(entry.result);
        entry.reject(makePiSynaraMcpDisabledError());
      }
    };

    const enableSynaraMcp: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["enableSynaraMcp"]
    > = (input) =>
      Effect.gen(function* () {
        const state = sessions.get(input.threadId);
        if (!state) {
          return yield* missingSessionEffect(provider, input.threadId);
        }
        const mcp = state.synaraMcp;
        mcp.enableCalls.push({
          expectedSessionGeneration: input.expectedSessionGeneration,
          liveSessionGeneration: input.liveSessionGeneration,
        });
        // Full session-generation fencing (Decision 18 F3): the durable
        // wait-set token must match the live session generation exactly; a
        // missing live binding fails closed instead of degrading.
        if (
          input.liveSessionGeneration === undefined ||
          input.expectedSessionGeneration !== input.liveSessionGeneration
        ) {
          return {
            state: "unavailable",
            detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
          } satisfies ProviderEnableSynaraMcpResult;
        }
        // Idempotent duplicate: an already-active session stays active.
        if (mcp.state === "active") {
          return { state: "active", alreadyActive: true } satisfies ProviderEnableSynaraMcpResult;
        }
        if (mcp.enableControl === "fail") {
          mcp.state = "unavailable";
          return {
            state: "unavailable",
            detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
          } satisfies ProviderEnableSynaraMcpResult;
        }
        if (mcp.enableControl === "defer") {
          const outcome = yield* Effect.promise(() => mcp.enableGate.promise);
          if (outcome.state === "active") {
            // Fresh activation admits mapped tool calls again.
            mcp.state = "active";
            mcp.fenced = false;
          } else {
            mcp.state = "unavailable";
          }
          return outcome;
        }
        mcp.state = "active";
        mcp.fenced = false;
        return { state: "active" } satisfies ProviderEnableSynaraMcpResult;
      });

    const disableSynaraMcp: NonNullable<
      ProviderAdapterShape<ProviderAdapterError>["disableSynaraMcp"]
    > = (input) =>
      Effect.gen(function* () {
        const state = sessions.get(input.threadId);
        if (!state) {
          return yield* missingSessionEffect(provider, input.threadId);
        }
        const mcp = state.synaraMcp;
        // Stage 1: the synchronous fence is installed before any suspension,
        // so a registration racing disable is rejected before its handler
        // starts. Disable never interrupts the Pi turn: no interruptTurn call.
        mcp.fenced = true;
        // Stage 2: settle every in-flight execution exactly once.
        settleInflightSynaraMcpCalls(mcp);
        // Idempotent duplicate (or a disable of a session that never
        // activated): the fence is still installed, then the settled state
        // is reported without further staging.
        if (mcp.state !== "active") {
          mcp.disableCalls.push({ stages: ["fence"] });
          if (mcp.state === "unavailable") {
            return {
              state: "unavailable",
              alreadyDisabled: true,
              detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
            } satisfies ProviderDisableSynaraMcpResult;
          }
          return {
            state: "dormant",
            alreadyDisabled: true,
          } satisfies ProviderDisableSynaraMcpResult;
        }
        const completeDisable = (
          outcome: ProviderDisableSynaraMcpResult,
        ): ProviderDisableSynaraMcpResult => {
          mcp.disableCalls.push({
            stages: ["fence", "settle", "cancel", "revoke", "reload"],
          });
          mcp.state = outcome.state === "unavailable" ? "unavailable" : "dormant";
          return outcome;
        };
        if (mcp.disableControl === "defer") {
          const outcome = yield* Effect.promise(() => mcp.disableGate.promise);
          return completeDisable(outcome);
        }
        if (mcp.disableControl === "fail") {
          return completeDisable({
            state: "unavailable",
            detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
          });
        }
        return completeDisable({ state: "dormant" });
      });

    const startSynaraMcpCall = (
      threadId: ThreadId,
      handler?: TestSynaraMcpCallHandler,
      options?: { readonly bindingOverride?: McpAuthorityBinding },
    ): Promise<unknown> => {
      const state = sessions.get(threadId);
      if (!state) {
        return Promise.reject(sessionNotFound(provider, threadId));
      }
      const mcp = state.synaraMcp;
      // Fail closed while the session is not proven active (dormant startup
      // or unavailable after an unproven enable/disable) and while the
      // admission fence is installed (a registration racing disable is
      // rejected before its handler starts), exactly like the production
      // registry's synchronous fence.
      if (mcp.state !== "active" || mcp.fenced) {
        return Promise.reject(makePiSynaraMcpDisabledError());
      }
      // Decision 21 subject-bound admission at the provider boundary: the
      // credential binding — the server-minted captured binding, or the
      // hostile override a test presents — must resolve against the REAL MCP
      // session authority registry. A missing binding fails closed, and any
      // mismatch/stale/revoked/expired admission failure denies the call
      // before its handler starts.
      const authorityService = mcpSessionAuthority?.();
      if (authorityService === undefined) {
        return Promise.reject(
          new ProviderAdapterValidationError({
            provider,
            operation: "startSynaraMcpCall",
            issue: "No MCP session authority service is wired into the test harness.",
          }),
        );
      }
      const binding = options?.bindingOverride ?? state.mcpAuthority;
      const admissionFailure: McpAuthorityAdmissionFailure | "missing-binding" | null =
        binding === undefined ? "missing-binding" : authorityService.assertAdmittable(binding);
      if (admissionFailure !== null) {
        return Promise.reject(makeSynaraMcpAuthorityDeniedError(admissionFailure));
      }
      const controller = new AbortController();
      let rejectOnce!: (cause: unknown) => void;
      const result = new Promise<unknown>((resolve, reject) => {
        rejectOnce = reject;
        Promise.resolve()
          .then(() =>
            handler === undefined ? new Promise<never>(() => {}) : handler(controller.signal),
          )
          .then(
            (value) => {
              if (entry.settled) return;
              entry.settled = true;
              mcp.inflightCalls.delete(result);
              resolve(value);
            },
            (cause) => {
              if (entry.settled) return;
              entry.settled = true;
              mcp.inflightCalls.delete(result);
              reject(cause);
            },
          );
      });
      const entry: TestSynaraMcpInflightCall = {
        controller,
        reject: (cause) => rejectOnce(cause),
        result,
        settled: false,
      };
      // The entry must exist before the handler's synchronous section can
      // resolve; the handler is invoked on a microtask, so the registration
      // is always visible to the disable settlement.
      mcp.inflightCalls.set(result, entry);
      return result;
    };

    const completeDeferredTurn = (threadId: ThreadId): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state): Effect.Effect<void, ProviderAdapterError> => {
          if (!state) {
            return Effect.fail(sessionNotFound(provider, threadId));
          }
          const events = state.deferredCompletionEvents;
          state.deferredCompletionEvents = [];
          return Effect.forEach(events, emit, { discard: true });
        }),
      );

    const stopSession: ProviderAdapterShape<ProviderAdapterError>["stopSession"] = (threadId) =>
      Effect.sync(() => {
        sessions.delete(threadId);
      });

    const listSessions: ProviderAdapterShape<ProviderAdapterError>["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (state) => state.session));

    const hasSession: ProviderAdapterShape<ProviderAdapterError>["hasSession"] = (threadId) =>
      Effect.succeed(sessions.has(threadId));

    const readThread: ProviderAdapterShape<ProviderAdapterError>["readThread"] = (threadId) => {
      const state = sessions.get(threadId);
      if (!state) {
        return missingSessionEffect(provider, threadId);
      }
      return Effect.succeed(state.snapshot);
    };

    const rollbackThread: ProviderAdapterShape<ProviderAdapterError>["rollbackThread"] = (
      threadId,
      numTurns,
    ) => {
      const state = sessions.get(threadId);
      if (!state) {
        return missingSessionEffect(provider, threadId);
      }
      if (!Number.isInteger(numTurns) || numTurns < 0 || numTurns > state.snapshot.turns.length) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider,
            operation: "rollbackThread",
            issue: "numTurns must be an integer between 0 and current turn count.",
          }),
        );
      }

      return Effect.sync(() => {
        state.rollbackCalls.push(numTurns);
        state.snapshot = {
          threadId: state.snapshot.threadId,
          turns: state.snapshot.turns.slice(0, state.snapshot.turns.length - numTurns),
        };
        state.turnCount = state.snapshot.turns.length;
        return state.snapshot;
      });
    };

    const stopAll: ProviderAdapterShape<ProviderAdapterError>["stopAll"] = () =>
      Effect.sync(() => {
        sessions.clear();
      });

    const adapter: ProviderAdapterShape<ProviderAdapterError> = {
      provider,
      capabilities: {
        sessionModelSwitch: "in-session",
      },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      enableSynaraMcp,
      disableSynaraMcp,
      stopSession,
      listSessions,
      hasSession,
      readThread,
      rollbackThread,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEvents),
    };

    const queueTurnResponse = (
      threadId: ThreadId,
      response: TestTurnResponse,
    ): Effect.Effect<void, ProviderAdapterSessionNotFoundError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state) =>
          state
            ? Effect.sync(() => {
                state.queuedResponses.push(response);
              })
            : Effect.fail(sessionNotFound(provider, threadId)),
        ),
      );

    const queueTurnResponseForNextSession = (
      response: TestTurnResponse,
    ): Effect.Effect<void, never> =>
      Effect.sync(() => {
        queuedResponsesForNextSession.push(response);
      });

    const getRollbackCalls = (threadId: ThreadId): ReadonlyArray<number> => {
      const state = sessions.get(threadId);
      if (!state) {
        return [];
      }
      return [...state.rollbackCalls];
    };

    const getStartCount = (): number => sessionCount;

    const getInterruptCalls = (threadId: ThreadId): ReadonlyArray<TurnId | undefined> => {
      const calls = interruptCallsBySession.get(threadId);
      if (!calls) {
        return [];
      }
      return [...calls];
    };

    const listActiveSessionIds = (): ReadonlyArray<ThreadId> =>
      Array.from(sessions.values(), (state) => state.session.threadId);

    const getApprovalResponses = (
      threadId: ThreadId,
    ): ReadonlyArray<{
      readonly threadId: ThreadId;
      readonly requestId: ApprovalRequestId;
      readonly decision: ProviderApprovalDecision;
    }> => {
      const responses = approvalResponsesBySession.get(threadId);
      if (!responses) {
        return [];
      }
      return [...responses];
    };

    const getMcpAuthority = (threadId: ThreadId): ProviderSessionStartInput["mcpAuthority"] =>
      sessions.get(threadId)?.mcpAuthority;

    const configureEnableOutcome = (
      threadId: ThreadId,
      control: TestSynaraMcpEnableControl,
    ): Effect.Effect<void, ProviderAdapterSessionNotFoundError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state) =>
          state
            ? Effect.sync(() => {
                state.synaraMcp.enableControl = control;
                // A fresh gate is armed on every configure so a release issued
                // before the enable runs is still honored deterministically.
                state.synaraMcp.enableGate = makeDeferGate();
              })
            : Effect.fail(sessionNotFound(provider, threadId)),
        ),
      );

    const configureDisableOutcome = (
      threadId: ThreadId,
      control: TestSynaraMcpDisableControl,
    ): Effect.Effect<void, ProviderAdapterSessionNotFoundError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state) =>
          state
            ? Effect.sync(() => {
                state.synaraMcp.disableControl = control;
                state.synaraMcp.disableGate = makeDeferGate();
              })
            : Effect.fail(sessionNotFound(provider, threadId)),
        ),
      );

    const releaseEnable = (
      threadId: ThreadId,
      outcome: TestSynaraMcpReleaseOutcome = "succeed",
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state): Effect.Effect<void, ProviderAdapterError> => {
          if (!state) {
            return Effect.fail(sessionNotFound(provider, threadId));
          }
          const mcp = state.synaraMcp;
          if (mcp.enableControl !== "defer") {
            return Effect.fail(
              new ProviderAdapterValidationError({
                provider,
                operation: "releaseEnable",
                issue: `No deferred enable is armed for thread ${threadId}.`,
              }),
            );
          }
          return Effect.sync(() => {
            mcp.enableGate.release(
              outcome === "fail"
                ? {
                    state: "unavailable",
                    detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
                  }
                : { state: "active" },
            );
          });
        }),
      );

    const releaseDisable = (
      threadId: ThreadId,
      outcome: TestSynaraMcpReleaseOutcome = "succeed",
    ): Effect.Effect<void, ProviderAdapterError> =>
      Effect.sync(() => sessions.get(threadId)).pipe(
        Effect.flatMap((state): Effect.Effect<void, ProviderAdapterError> => {
          if (!state) {
            return Effect.fail(sessionNotFound(provider, threadId));
          }
          const mcp = state.synaraMcp;
          if (mcp.disableControl !== "defer") {
            return Effect.fail(
              new ProviderAdapterValidationError({
                provider,
                operation: "releaseDisable",
                issue: `No deferred disable is armed for thread ${threadId}.`,
              }),
            );
          }
          return Effect.sync(() => {
            mcp.disableGate.release(
              outcome === "fail"
                ? {
                    state: "unavailable",
                    detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
                  }
                : { state: "dormant" },
            );
          });
        }),
      );

    const getEnableCalls = (threadId: ThreadId): ReadonlyArray<TestSynaraMcpEnableCall> => {
      const mcp = sessions.get(threadId)?.synaraMcp;
      return mcp ? [...mcp.enableCalls] : [];
    };

    const getDisableCalls = (threadId: ThreadId): ReadonlyArray<TestSynaraMcpDisableCall> => {
      const mcp = sessions.get(threadId)?.synaraMcp;
      return mcp ? [...mcp.disableCalls] : [];
    };

    const isSynaraMcpFenced = (threadId: ThreadId): boolean =>
      sessions.get(threadId)?.synaraMcp.fenced ?? false;

    const getSynaraMcpInFlightCount = (threadId: ThreadId): number =>
      sessions.get(threadId)?.synaraMcp.inflightCalls.size ?? 0;

    const getSynaraMcpDisabledSettledCount = (threadId: ThreadId): number =>
      sessions.get(threadId)?.synaraMcp.disabledSettledCount ?? 0;

    return {
      adapter,
      provider,
      queueTurnResponse,
      queueTurnResponseForNextSession,
      getStartCount,
      getRollbackCalls,
      getInterruptCalls,
      listActiveSessionIds,
      getApprovalResponses,
      getMcpAuthority,
      configureEnableOutcome,
      configureDisableOutcome,
      releaseEnable,
      releaseDisable,
      getEnableCalls,
      getDisableCalls,
      startSynaraMcpCall,
      completeDeferredTurn,
      isSynaraMcpFenced,
      getSynaraMcpInFlightCount,
      getSynaraMcpDisabledSettledCount,
    } satisfies TestProviderAdapterHarness;
  });
