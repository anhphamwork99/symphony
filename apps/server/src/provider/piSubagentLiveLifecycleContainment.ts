/**
 * Volatile, session-local live lifecycle containment.
 *
 * This module owns no provider state.  A caller supplies an opaque provider
 * session object and an exact public execution tuple, then supplies the
 * already-captured provider callback for one invocation.  The registry only
 * decides whether that callback may be entered and whether its response may
 * be exposed; it never queues, retries, reconstructs, or persists a route.
 *
 * Linearization contract (Decision 0006 / WP-01 remediation):
 *
 * - Live CONTROL is only ever returned as `applied` after the provider-owned
 *   callback explicitly marked the acceptance boundary (`markAccepted`) AND
 *   the same tuple/session/registration/epoch still exists after the response.
 *   Ordinary retirement removes live availability but preserves that in-flight
 *   continuity, so an accepted success may still apply while failures remain
 *   outcome-unknown. A control callback that returns without ever marking
 *   acceptance is NOT an applied control; it classifies as bounded unavailable,
 *   because no provider-owned acceptance point was reached.
 * - Live OBSERVATION never emits a provider acceptance boundary, never
 *   classifies as outcome-unknown, and is only returned as `applied` when the
 *   current, still-live registration revalidates after the bounded snapshot
 *   resolves.
 * - Internal reasons are a closed, bounded vocabulary.  They reach only the
 *   injected trace seam; the public result surface stays the fixed diagnostic
 *   code.  Timeout reasons are reachable only through `markTimedOut`.
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
  | "provider_unavailable"
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
  /**
   * Marks a structured pre-acceptance provider failure with a closed
   * bounded reason.  Only the `provider_inactive` member is used by the
   * managed binding today; the full set keeps the seam typed and closed.
   */
  readonly markUnavailable: (reason: PiSubagentLiveLifecycleUnavailableReason) => void;
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
   * Trusted internal closure over the callback captured from the exact
   * provider runtime. It is never called unless the opaque registration
   * passes entry validation. Callers must not substitute a callback from
   * another tool or provider session; WP-02 composition retains the exact
   * registration handle and captured target together.
   */
  readonly invoke?: PiSubagentLiveLifecycleInvocation<T> | undefined;
}

export interface PiSubagentLiveLifecycleResult<T> {
  readonly status: "applied" | "unavailable" | "outcome_unknown" | "stale";
  readonly diagnosticCode?: PiSubagentLiveLifecycleDiagnosticCode;
  /** Present only for an applied, post-response-revalidated invocation. */
  readonly value?: T;
}

/**
 * Bounded, closed internal reason vocabulary for the unavailable shape.
 * These values are emitted to the trace seam only; they never become public
 * diagnostics or arbitrary error text.
 */
export type PiSubagentLiveLifecycleUnavailableReason =
  | "provider_inactive"
  | "callback_missing"
  | "callback_disposed"
  | "callback_mismatched"
  | "callback_failed_before_acceptance"
  | "callback_timeout_before_acceptance";

/** Bounded, closed internal reason vocabulary for the outcome-unknown shape. */
export type PiSubagentLiveLifecycleUnknownReason =
  | "callback_lost_after_acceptance"
  | "callback_timeout_after_acceptance"
  | "callback_failed_after_acceptance";

type InternalReason =
  | PiSubagentLiveLifecycleUnavailableReason
  | PiSubagentLiveLifecycleUnknownReason
  | "stale"
  | "active";

/** Classified failure produced by the closed reason table below. */
type ClassifiedFailure =
  | { readonly kind: "unavailable"; readonly reason: PiSubagentLiveLifecycleUnavailableReason }
  | { readonly kind: "outcome_unknown"; readonly reason: PiSubagentLiveLifecycleUnknownReason };

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
  JSON.stringify([tuple.executionId, tuple.attemptId, tuple.generation]);

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

/**
 * The closed classification table.  It never infers a timeout from an
 * unmarked throw: timeout reasons are reachable only when the callback
 * marked `markTimedOut`, and outcome-unknown only on the control path after
 * an explicitly marked acceptance.  Observation always stays unavailable.
 */
function classifyFailure(
  kind: "observe" | "control",
  accepted: boolean,
  timedOut: boolean,
  unavailableReason: PiSubagentLiveLifecycleUnavailableReason | undefined,
  unknownReason: PiSubagentLiveLifecycleUnknownReason | undefined,
): ClassifiedFailure {
  if (unavailableReason !== undefined && !accepted) {
    return { kind: "unavailable", reason: unavailableReason };
  }
  if (unknownReason !== undefined) {
    return kind === "control" && accepted
      ? { kind: "outcome_unknown", reason: unknownReason }
      : { kind: "unavailable", reason: "callback_failed_before_acceptance" };
  }
  if (kind === "control" && accepted) {
    return timedOut
      ? { kind: "outcome_unknown", reason: "callback_timeout_after_acceptance" }
      : { kind: "outcome_unknown", reason: "callback_failed_after_acceptance" };
  }
  return timedOut
    ? { kind: "unavailable", reason: "callback_timeout_before_acceptance" }
    : { kind: "unavailable", reason: "callback_failed_before_acceptance" };
}

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
    if (
      !input ||
      !isValidTuple(input.tuple) ||
      !input.session ||
      typeof input.session !== "object"
    ) {
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
      registration !== state.registration ||
      registration.session !== session ||
      tupleKey(registration.tuple) !== tupleKey(tuple)
    ) {
      return { reason: "callback_mismatched" };
    }
    if (state.cleared || state.retired) return { state, reason: "callback_disposed" };
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
      const reason = resolved.reason as PiSubagentLiveLifecycleUnavailableReason;
      emit("return_unavailable", input.tuple, reason);
      return {
        status: "unavailable",
        diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      };
    }
    const captured = kind === "observe" ? state.observe : state.control;
    const invoke = input.invoke ?? (captured as PiSubagentLiveLifecycleInvocation<T> | undefined);
    if (invoke === undefined) {
      emit("return_unavailable", input.tuple, "callback_missing");
      return {
        status: "unavailable",
        diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      };
    }

    emit("callback_entered", input.tuple);
    // Control acceptance starts unproven and must be marked explicitly at
    // the provider-owned boundary.  Observation has no acceptance boundary at
    // all: it resolves or fails, and never becomes outcome-unknown.
    let accepted = false;
    let timedOut = false;
    let unavailableReason: PiSubagentLiveLifecycleUnavailableReason | undefined;
    let unknownReason: PiSubagentLiveLifecycleUnknownReason | undefined;
    const markAccepted = (): void => {
      // Observation has no provider-owned acceptance boundary: its context's
      // markAccepted is a structural no-op so the observation path can never
      // emit provider_acceptance or classify as outcome-unknown.
      if (kind === "observe") return;
      if (!accepted) {
        accepted = true;
        emit("provider_acceptance", input.tuple);
      }
    };
    const markTimedOut = (): void => {
      timedOut = true;
    };
    const markResponseLost = (): void => {
      unknownReason = "callback_lost_after_acceptance";
    };
    const markUnavailable = (reason: PiSubagentLiveLifecycleUnavailableReason): void => {
      if (unavailableReason === undefined) unavailableReason = reason;
    };
    emit("callback_revalidated", input.tuple);

    // Continuity is identity-only: ordinary retirement changes availability,
    // but must not turn an already-entered control into a stale response.
    // Replacement, session clear, or any other invalidation removes the
    // exact tuple/registration/epoch from the live registry and is stale.
    const isContinuous = (): boolean => {
      const current = bySession.get(input.session)?.get(tupleKey(input.tuple));
      return (
        current !== undefined &&
        current === state &&
        current.epoch === state.epoch &&
        current.registration === input.registration &&
        current.registration.session === input.session
      );
    };

    // Observation retains the existing availability-sensitive semantics:
    // retirement during a snapshot makes the response stale.
    const isCurrent = (): boolean =>
      isContinuous() && !state.retired && !state.cleared && state.active;
    const isResponseValid = kind === "control" ? isContinuous : isCurrent;

    const returnFailure = (failure: ClassifiedFailure): PiSubagentLiveLifecycleResult<T> => {
      if (failure.kind === "outcome_unknown") {
        emit("return_outcome_unknown", input.tuple, failure.reason);
        return {
          status: "outcome_unknown",
          diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
        };
      }
      emit("return_unavailable", input.tuple, failure.reason);
      return {
        status: "unavailable",
        diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      };
    };

    let value: T;
    try {
      value = await invoke({
        tuple: input.tuple,
        session: input.session,
        markAccepted,
        markTimedOut,
        markResponseLost,
        markUnavailable,
      });
    } catch {
      if (!isResponseValid()) {
        emit("response_revalidated", input.tuple);
        emit("return_stale", input.tuple, "stale");
        return { status: "stale", diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored" };
      }
      return returnFailure(
        classifyFailure(kind, accepted, timedOut, unavailableReason, unknownReason),
      );
    }

    if (!isResponseValid()) {
      emit("response_revalidated", input.tuple);
      emit("return_stale", input.tuple, "stale");
      return { status: "stale", diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored" };
    }
    emit("response_revalidated", input.tuple);
    if (unavailableReason !== undefined && !accepted) {
      // A structured pre-acceptance provider failure beats any returned
      // value: no provider-owned acceptance point was reached, so the
      // bounded result is unavailable with zero accepted effect claimed.
      emit("provider_unavailable", input.tuple, unavailableReason);
      return returnFailure({ kind: "unavailable", reason: unavailableReason });
    }
    if (unknownReason !== undefined) {
      // A marked response loss means the returned value cannot be trusted as
      // the provider-owned outcome, even if some value came back.
      return returnFailure(
        classifyFailure(kind, accepted, timedOut, unavailableReason, unknownReason),
      );
    }
    if (timedOut) {
      // A bounded deadline remains authoritative even if the provider later
      // resolves a value. Before acceptance it is unavailable; after a
      // control acceptance point it is outcome-unknown. A late value is never
      // exposed as applied merely because it eventually arrived.
      return returnFailure(classifyFailure(kind, accepted, true, unavailableReason, unknownReason));
    }
    if (kind === "control" && !accepted) {
      // Pure control is never reported as applied when the provider-owned
      // acceptance boundary was not marked, even if the callback returned a
      // value: a return without acceptance proves no accepted effect.
      return returnFailure({
        kind: "unavailable",
        reason: timedOut
          ? "callback_timeout_before_acceptance"
          : "callback_failed_before_acceptance",
      });
    }
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
      if (state === undefined) return false;
      // Exact identity retirement: only the identical registration object may
      // retire its state. An earlier registration carrying an equal public
      // tuple must never retire the replacement that displaced it.
      if (state.registration !== input) return false;
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

interface RegistrationState {
  readonly registration: PiSubagentLiveLifecycleRegistration;
  readonly epoch: number;
  readonly observe: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
  readonly control: PiSubagentLiveLifecycleInvocation<unknown> | undefined;
  active: boolean;
  retired: boolean;
  cleared: boolean;
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
