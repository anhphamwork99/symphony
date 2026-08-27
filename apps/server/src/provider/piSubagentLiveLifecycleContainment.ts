/**
 * Volatile, session-local live lifecycle containment.
 *
 * This module owns no provider state.  A caller supplies an opaque provider
 * session object and an exact public execution tuple, then supplies the
 * already-captured provider callback for one invocation.  The registry only
 * decides whether that callback may be entered and whether its response may
 * be exposed; it never queues, retries, reconstructs, or persists a route.
 */

export type PiSubagentLiveLifecycleDiagnosticCode =
  | "pi_subagent_live_lifecycle_unavailable"
  | "pi_subagent_live_lifecycle_outcome_unknown"
  | "pi_subagent_live_lifecycle_stale_ignored"
  | "pi_subagent_terminal_late_applied";

export interface PiSubagentLiveLifecycleTuple {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
}

/** Provider-owned session identity.  Its contents are deliberately opaque. */
export type PiSubagentLiveLifecycleSession = object;

export type PiSubagentLiveLifecycleTraceEvent =
  | "durable_authorization"
  | "current_tuple_resolved"
  | "callback_lookup"
  | "callback_entered"
  | "callback_revalidated"
  | "provider_acceptance"
  | "callback_retired"
  | "response_revalidated"
  | "return_unavailable"
  | "return_outcome_unknown"
  | "return_stale"
  | "return_applied"
  | "session_cleared";

export interface PiSubagentLiveLifecycleTrace {
  readonly event: PiSubagentLiveLifecycleTraceEvent;
  readonly tuple?: PiSubagentLiveLifecycleTuple;
  /** Fixed internal classification, present only on diagnostic trace events. */
  readonly reason?: string;
}

export interface PiSubagentLiveLifecycleContainmentOptions {
  /** Test-only observation seam; production composition need not provide it. */
  readonly trace?: ((trace: PiSubagentLiveLifecycleTrace) => void) | undefined;
}

export interface PiSubagentLiveLifecycleRegistration {
  readonly tuple: PiSubagentLiveLifecycleTuple;
  readonly session: PiSubagentLiveLifecycleSession;
}

export interface PiSubagentLiveLifecycleInvocationContext {
  readonly tuple: PiSubagentLiveLifecycleTuple;
  readonly session: PiSubagentLiveLifecycleSession;
  /** Marks the provider-owned acceptance boundary synchronously. */
  readonly markAccepted: () => void;
  /** Marks a bounded invocation timeout without exposing provider details. */
  readonly markTimedOut: () => void;
  /** Marks a response loss after a provider-owned acceptance point. */
  readonly markResponseLost: () => void;
}

export type PiSubagentLiveLifecycleInvocation<T> = (
  context: PiSubagentLiveLifecycleInvocationContext,
) => Promise<T> | T;

export interface PiSubagentLiveLifecycleCaptureInput extends PiSubagentLiveLifecycleRegistration {
  readonly observe?: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
  readonly control?: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
}

export interface PiSubagentLiveLifecycleDispatchInput<T> {
  readonly tuple: PiSubagentLiveLifecycleTuple;
  readonly session: PiSubagentLiveLifecycleSession;
  readonly registration?: PiSubagentLiveLifecycleRegistration | undefined;
  /**
   * The callback captured from the exact provider runtime.  It is never
   * called unless the registration passes entry validation.
   */
  readonly invoke?: PiSubagentLiveLifecycleInvocation<T> | undefined;
}

export interface PiSubagentLiveLifecycleResult<T> {
  readonly status: "applied" | "unavailable" | "outcome_unknown" | "stale";
  readonly diagnosticCode?: PiSubagentLiveLifecycleDiagnosticCode;
  /** Present only for an applied, post-response-revalidated invocation. */
  readonly value?: T;
}

interface RegistrationState {
  readonly registration: PiSubagentLiveLifecycleRegistration;
  readonly epoch: number;
  readonly observe: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
  readonly control: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
  active: boolean;
  retired: boolean;
  cleared: boolean;
}

type InternalReason =
  | "provider_inactive"
  | "callback_missing"
  | "callback_disposed"
  | "callback_mismatched"
  | "callback_timeout_before_acceptance"
  | "callback_lost_after_acceptance"
  | "callback_timeout_after_acceptance"
  | "callback_failed_after_acceptance"
  | "stale"
  | "active";

const isValidTuple = (tuple: PiSubagentLiveLifecycleTuple): boolean =>
  typeof tuple.executionId === "string" &&
  tuple.executionId.trim().length > 0 &&
  tuple.executionId.length <= 256 &&
  typeof tuple.attemptId === "string" &&
  tuple.attemptId.trim().length > 0 &&
  tuple.attemptId.length <= 256 &&
  Number.isSafeInteger(tuple.generation) &&
  tuple.generation > 0;

const tupleKey = (tuple: PiSubagentLiveLifecycleTuple): string =>
  `${tuple.executionId}\u0000${tuple.attemptId}\u0000${String(tuple.generation)}`;

const safeTrace = (
  trace: ((event: PiSubagentLiveLifecycleTrace) => void) | undefined,
  event: PiSubagentLiveLifecycleTraceEvent,
  tuple?: PiSubagentLiveLifecycleTuple,
  reason?: InternalReason,
): void => {
  try {
    trace?.({
      event,
      ...(tuple === undefined ? {} : { tuple }),
      ...(reason === undefined ? {} : { reason }),
    });
  } catch {
    // Trace is an injected test seam, never lifecycle authority.
  }
};

const unavailable = <T>(_reason: InternalReason): PiSubagentLiveLifecycleResult<T> => ({
  status: "unavailable",
  diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
});

const unknown = <T>(_reason: InternalReason): PiSubagentLiveLifecycleResult<T> => ({
  status: "outcome_unknown",
  diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
});

const stale = <T>(): PiSubagentLiveLifecycleResult<T> => ({
  status: "stale",
  diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
});

/**
 * Make one volatile containment instance.  The returned object is the only
 * owner of its registrations; there is intentionally no module-global map.
 */
export function makePiSubagentLiveLifecycleContainment(
  options: PiSubagentLiveLifecycleContainmentOptions = {},
) {
  const bySession = new WeakMap<object, Map<string, RegistrationState>>();
  const clearedSessions = new WeakSet<object>();
  let nextEpoch = 0;

  const emit = (
    event: PiSubagentLiveLifecycleTraceEvent,
    tuple?: PiSubagentLiveLifecycleTuple,
    reason?: InternalReason,
  ) => safeTrace(options.trace, event, tuple, reason);

  const sessionMap = (session: PiSubagentLiveLifecycleSession) => {
    let map = bySession.get(session);
    if (map === undefined) {
      map = new Map();
      bySession.set(session, map);
    }
    return map;
  };

  const capture = (
    input: PiSubagentLiveLifecycleCaptureInput,
  ): PiSubagentLiveLifecycleRegistration | undefined => {
    if (!input || !isValidTuple(input.tuple) || !input.session || typeof input.session !== "object") {
      return undefined;
    }
    if (clearedSessions.has(input.session)) return undefined;
    const map = sessionMap(input.session);
    const key = tupleKey(input.tuple);
    const previous = map.get(key);
    if (previous !== undefined) {
      // A retired route is a permanent tombstone. A still-live route may be
      // replaced by a new registration/epoch, but retirement cannot be used
      // as a way to reconstruct the same endpoint.
      if (previous.retired || previous.cleared) return undefined;
      previous.retired = true;
      previous.active = false;
      emit("callback_retired", previous.registration.tuple);
    }
    const registration: PiSubagentLiveLifecycleRegistration = {
      tuple: { ...input.tuple },
      session: input.session,
    };
    map.set(key, {
      registration,
      epoch: ++nextEpoch,
      observe: input.observe,
      control: input.control,
      active: false,
      retired: false,
      cleared: false,
    });
    return registration;
  };

  const stateFor = (
    tuple: PiSubagentLiveLifecycleTuple,
    session: PiSubagentLiveLifecycleSession,
    registration: PiSubagentLiveLifecycleRegistration | undefined,
  ): { readonly state?: RegistrationState; readonly reason: InternalReason } => {
    emit("callback_lookup", tuple);
    if (!isValidTuple(tuple)) return { reason: "callback_mismatched" };
    // A dispatch must carry the opaque registration returned by capture. A
    // tuple/session lookup alone is not authority and cannot reconstruct a
    // retired or replaced endpoint.
    if (registration === undefined) return { reason: "callback_missing" };
    const map = bySession.get(session);
    if (map === undefined) return { reason: "callback_missing" };
    const state = map.get(tupleKey(tuple));
    if (state === undefined) return { reason: "callback_missing" };
    if (
      registration !== undefined &&
      (registration !== state.registration ||
        registration.session !== session ||
        tupleKey(registration.tuple) !== tupleKey(tuple))
    ) {
      return { reason: "callback_mismatched" };
    }
    if (state.cleared || state.retired) return { state, reason: "callback_disposed" };
    if (state.registration.session !== session || tupleKey(state.registration.tuple) !== tupleKey(tuple)) {
      return { state, reason: "callback_mismatched" };
    }
    if (!state.active) return { state, reason: "provider_inactive" };
    return { state, reason: "active" };
  };

  const dispatch = async <T>(
    input: PiSubagentLiveLifecycleDispatchInput<T>,
    kind: "observe" | "control",
  ): Promise<PiSubagentLiveLifecycleResult<T>> => {
    emit("durable_authorization", input.tuple);
    emit("current_tuple_resolved", input.tuple);
    const resolved = stateFor(input.tuple, input.session, input.registration);
    const state = resolved.state;
    if (state === undefined || resolved.reason !== "active" || !state.active) {
      emit("return_unavailable", input.tuple, resolved.reason);
      return unavailable(resolved.reason);
    }
    const captured = kind === "observe" ? state.observe : state.control;
    const invoke = input.invoke ?? (captured as PiSubagentLiveLifecycleInvocation<T> | undefined);
    if (invoke === undefined) {
      emit("return_unavailable", input.tuple, "callback_missing");
      return unavailable("callback_missing");
    }

    emit("callback_entered", input.tuple);
    let accepted = kind === "observe";
    let failureReason: InternalReason | undefined;
    const markAccepted = (): void => {
      if (!accepted) {
        accepted = true;
        emit("provider_acceptance", input.tuple);
      }
    };
    const markTimedOut = (): void => {
      failureReason = accepted
        ? "callback_timeout_after_acceptance"
        : "callback_timeout_before_acceptance";
    };
    const markResponseLost = (): void => {
      accepted = true;
      failureReason = "callback_lost_after_acceptance";
      emit("provider_acceptance", input.tuple);
    };
    emit("callback_revalidated", input.tuple);
    if (kind === "observe") emit("provider_acceptance", input.tuple);

    const isCurrent = (): boolean => {
      const current = bySession.get(input.session)?.get(tupleKey(input.tuple));
      return (
        current !== undefined &&
        current === state &&
        current.epoch === state.epoch &&
        !current.retired &&
        !current.cleared &&
        current.active
      );
    };

    let value: T;
    try {
      value = await invoke({
        tuple: input.tuple,
        session: input.session,
        markAccepted,
        markTimedOut,
        markResponseLost,
      });
    } catch {
      if (!isCurrent()) {
        emit("response_revalidated", input.tuple);
        emit("return_stale", input.tuple, "stale");
        return stale();
      }
      const reason =
        failureReason ??
        (accepted ? "callback_failed_after_acceptance" : "callback_timeout_before_acceptance");
      const result = accepted ? unknown<T>(reason) : unavailable<T>(reason);
      emit(
        result.status === "outcome_unknown" ? "return_outcome_unknown" : "return_unavailable",
        input.tuple,
        reason,
      );
      return result;
    }

    if (!isCurrent()) {
      emit("response_revalidated", input.tuple);
      emit("return_stale", input.tuple, "stale");
      return stale();
    }
    emit("response_revalidated", input.tuple);
    emit("return_applied", input.tuple);
    return { status: "applied", value };
  };

  const containment = {
    capture,
    activate: (registration: PiSubagentLiveLifecycleRegistration): boolean => {
      if (!registration || !isValidTuple(registration.tuple)) return false;
      const state = bySession.get(registration.session)?.get(tupleKey(registration.tuple));
      if (
        state === undefined ||
        state.registration !== registration ||
        state.retired ||
        state.cleared
      ) {
        return false;
      }
      state.active = true;
      return true;
    },
    observe: <T>(input: PiSubagentLiveLifecycleDispatchInput<T>) => dispatch(input, "observe"),
    control: <T>(input: PiSubagentLiveLifecycleDispatchInput<T>) => dispatch(input, "control"),
    retire: (
      input:
        | PiSubagentLiveLifecycleRegistration
        | {
            readonly tuple: PiSubagentLiveLifecycleTuple;
            readonly session: PiSubagentLiveLifecycleSession;
          },
    ): boolean => {
      const map = bySession.get(input.session);
      const state = map?.get(tupleKey(input.tuple));
      if (
        state === undefined ||
        (state.registration !== input &&
          (state.registration.session !== input.session ||
            tupleKey(state.registration.tuple) !== tupleKey(input.tuple)))
      ) {
        return false;
      }
      state.retired = true;
      state.active = false;
      // Keep the tombstone in this volatile instance.  A retired registration
      // must classify as disposed, never silently become a reconstructible
      // missing route.
      emit("callback_retired", input.tuple);
      return true;
    },
    clearSession: (session: PiSubagentLiveLifecycleSession): void => {
      clearedSessions.add(session);
      const map = bySession.get(session);
      if (map === undefined) {
        emit("session_cleared");
        return;
      }
      for (const state of map.values()) {
        state.retired = true;
        state.active = false;
        state.cleared = true;
        emit("callback_retired", state.registration.tuple);
      }
      map.clear();
      bySession.delete(session);
      emit("session_cleared");
    },
  };

  return containment;
}

export type PiSubagentLiveLifecycleContainment = ReturnType<
  typeof makePiSubagentLiveLifecycleContainment
>;

/** Fixed public diagnostic mapping; internal reason enums never leave this module. */
export const PI_SUBAGENT_LIVE_LIFECYCLE_DIAGNOSTIC_CODES = [
  "pi_subagent_live_lifecycle_unavailable",
  "pi_subagent_live_lifecycle_outcome_unknown",
  "pi_subagent_live_lifecycle_stale_ignored",
  "pi_subagent_terminal_late_applied",
] as const;
