import { Option, Schema } from "effect";

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_MAX_PROTOCOL_VERSION,
  PI_SUBAGENTS_MIN_PROTOCOL_VERSION,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentCancelCommand,
  type PiSubagentCancelResult,
  type PiSubagentCapability,
  type PiSubagentHandshakeFailureResponse,
  type PiSubagentHandshakeRequest,
  PiSubagentHandshakeResponse,
  type PiSubagentHandshakeSuccessResponse,
  type PiSubagentLifecycleEvent,
  type PiSubagentNegotiatedCapability,
  type PiSubagentSpawnCommand,
  type PiSubagentSpawnResult,
  PiSubagentTeardownOwnedProcessesResult as PiSubagentTeardownOwnedProcessesResultSchema,
  type PiSubagentTeardownOwnedProcessesCommand,
  type PiSubagentTeardownOwnedProcessesResult,
} from "@synara/contracts";

import {
  MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  MAX_PI_SUBAGENT_LEASE_DURATION_MS,
  MAX_PI_SUBAGENT_PROGRESS_RATE_HZ,
  MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS,
  MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
  MIN_PI_SUBAGENT_LEASE_DURATION_MS,
  MIN_PI_SUBAGENT_PROGRESS_RATE_HZ,
  resolvePiSubagentWatchdogStageTimeoutMs,
} from "../config.ts";

export const PI_SUBAGENT_BRIDGE_KEY = Symbol.for("synara.pi.subagents.bridge");
export const PI_SUBAGENT_MANAGED_FOREGROUND_KEY = Symbol.for(
  "synara.pi.subagents.managed_foreground.v1",
);
const PI_SUBAGENT_PROBE_CACHE_KEY = Symbol.for("synara.pi.subagents.probe_cache");

/**
 * Decision 0033 §3: the additive capability string gating the opaque
 * identity-fenced child-owner teardown endpoint. It is advertised as an
 * OPTIONAL handshake capability only — an old Alfie without the endpoint
 * stays fully managed on the ordinary child path (D0033 compatibility:
 * teardown proof simply degrades to band 78 owner-unproven).
 */
export const PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY =
  "child-bash-process-ownership" as const;

/** Reason discriminant for every non-terminal owner-unproven path (D0033 §6). */
export type PiSubagentTeardownOwnedProcessesUnprovenReason =
  | "bridge_operation_absent"
  | "dispatch_threw"
  | "dispatch_timed_out"
  | "malformed_result"
  | "identity_mismatch"
  | "owner_unavailable"
  | "dispatch_failed"
  | "stale_generation"
  | "owner_missing";

export type PiSubagentTeardownOwnedProcessesDispatch =
  | { readonly kind: "validated"; readonly result: PiSubagentTeardownOwnedProcessesResult }
  | {
      readonly kind: "unproven";
      readonly reason: PiSubagentTeardownOwnedProcessesUnprovenReason;
      readonly diagnosticCode: "pi_subagent_teardown_owner_unproven";
      readonly diagnosticMessage: string;
      /** Command fencing actually dispatched (absence: nothing was dispatched). */
      readonly attemptedCommand: PiSubagentTeardownOwnedProcessesCommand;
      /** Decoded result when one was produced but cannot be trusted as proof. */
      readonly result?: PiSubagentTeardownOwnedProcessesResult;
    };

export type PiSubagentObservationKind =
  | "started"
  | "detached"
  | "progress"
  | "heartbeat"
  | "terminal";

export interface PiSubagentObservationInput {
  readonly kind: PiSubagentObservationKind;
  readonly occurredAt: string;
  /** Present for progress-kind observations only; opaque latest-snapshot JSON. */
  readonly progressJson?: string;
  /** Present for terminal-kind observations only (Ticket 07 / T07-AC5). */
  readonly terminal?: PiSubagentTerminalObservationPayload;
}

/**
 * Ticket 07 terminal observation payload (extension → host). Carries only a
 * bounded summary and an authorized transcript reference — never raw
 * unbounded transcript output. The server truncates the summary again
 * before persistence regardless of producer bounding.
 */
export interface PiSubagentTerminalObservationPayload {
  /** "succeeded" | "failed" (cancellation settles via the durable cancel path). */
  readonly state: string;
  /** Bounded excerpt of the child result (producer-side cap). */
  readonly summary: string;
  /** Opaque reference to the extension-owned transcript artifact. */
  readonly transcriptRef?: string;
  /** Best-effort parsed outcome judgment, distinct from execution status. */
  readonly outcomeState?: string;
  readonly diagnosticMessage?: string;
}

export interface PiSubagentProgressPolicy {
  readonly rateHz: number;
}

export interface PiSubagentHeartbeatPolicy {
  readonly intervalMs: number;
  readonly leaseMs: number;
}

export interface PiSubagentManagedForegroundBinding {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly cancellationScope: "parent_turn";
  readonly foregroundWaitMs: number;
  readonly reportObservation: (input: PiSubagentObservationInput) => Promise<void>;
  /** Ticket 23 server policy pass-through; absent on legacy bindings. */
  readonly progress?: PiSubagentProgressPolicy;
  readonly heartbeat?: PiSubagentHeartbeatPolicy;
}

export function isPiSubagentManagedForegroundBinding(
  value: unknown,
): value is PiSubagentManagedForegroundBinding {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string | symbol, unknown>;
  if (typeof record.executionId !== "string" || record.executionId.trim().length === 0) {
    return false;
  }
  if (typeof record.attemptId !== "string" || record.attemptId.trim().length === 0) {
    return false;
  }
  if (
    typeof record.generation !== "number" ||
    !Number.isInteger(record.generation) ||
    record.generation <= 0
  ) {
    return false;
  }
  if (record.cancellationScope !== "parent_turn") {
    return false;
  }
  if (
    typeof record.foregroundWaitMs !== "number" ||
    !Number.isInteger(record.foregroundWaitMs) ||
    record.foregroundWaitMs < MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS ||
    record.foregroundWaitMs > MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS
  ) {
    return false;
  }
  if (typeof record.reportObservation !== "function") {
    return false;
  }
  return true;
}

function isValidPiSubagentProgressPolicy(value: unknown): value is PiSubagentProgressPolicy {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.rateHz === "number" &&
    Number.isFinite(record.rateHz) &&
    record.rateHz >= MIN_PI_SUBAGENT_PROGRESS_RATE_HZ &&
    record.rateHz <= MAX_PI_SUBAGENT_PROGRESS_RATE_HZ
  );
}

function isValidPiSubagentHeartbeatPolicy(value: unknown): value is PiSubagentHeartbeatPolicy {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.intervalMs === "number" &&
    Number.isInteger(record.intervalMs) &&
    record.intervalMs >= MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS &&
    record.intervalMs <= MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS &&
    typeof record.leaseMs === "number" &&
    Number.isInteger(record.leaseMs) &&
    record.leaseMs >= MIN_PI_SUBAGENT_LEASE_DURATION_MS &&
    record.leaseMs <= MAX_PI_SUBAGENT_LEASE_DURATION_MS
  );
}

/**
 * Ticket 23 policy guard matrix: policy fields are validated ONLY when
 * present; a malformed policy never rejects the core binding — the policy
 * fields are stripped so the extension falls back to its internal defaults.
 * Old extensions never send these fields and are unaffected.
 */
export function normalizePiSubagentManagedForegroundBinding(
  binding: PiSubagentManagedForegroundBinding,
): PiSubagentManagedForegroundBinding {
  const progressValid =
    binding.progress === undefined || isValidPiSubagentProgressPolicy(binding.progress);
  const heartbeatValid =
    binding.heartbeat === undefined || isValidPiSubagentHeartbeatPolicy(binding.heartbeat);
  if (progressValid && heartbeatValid) {
    return binding;
  }
  const sanitized: Record<string, unknown> = { ...binding };
  if (!progressValid) {
    delete sanitized.progress;
  }
  if (!heartbeatValid) {
    delete sanitized.heartbeat;
  }
  return sanitized as unknown as PiSubagentManagedForegroundBinding;
}

export function getPiSubagentManagedForegroundBinding(
  target: unknown,
): PiSubagentManagedForegroundBinding | undefined {
  if (!target || typeof target !== "object") {
    return undefined;
  }
  const record = target as Record<string | symbol, unknown>;
  const binding = record[PI_SUBAGENT_MANAGED_FOREGROUND_KEY];
  if (isPiSubagentManagedForegroundBinding(binding)) {
    return normalizePiSubagentManagedForegroundBinding(binding);
  }
  return undefined;
}

export function attachPiSubagentManagedForegroundBinding<
  T extends Record<string | symbol, unknown>,
>(
  ctx: T,
  binding: PiSubagentManagedForegroundBinding,
): T & { readonly [PI_SUBAGENT_MANAGED_FOREGROUND_KEY]: PiSubagentManagedForegroundBinding } {
  if (!isPiSubagentManagedForegroundBinding(binding)) {
    throw new TypeError("Invalid Pi subagent managed foreground binding");
  }
  // A structurally invalid policy field never rejects the binding: it is
  // stripped here (ticket 23) so the extension uses its internal defaults.
  const sanitizedBinding = normalizePiSubagentManagedForegroundBinding(binding);
  const immutableBinding = Object.isFrozen(sanitizedBinding)
    ? sanitizedBinding
    : Object.freeze({ ...sanitizedBinding });
  return Object.freeze({
    ...ctx,
    [PI_SUBAGENT_MANAGED_FOREGROUND_KEY]: immutableBinding,
  });
}

export interface PiSubagentActiveChild {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly mode: string;
  readonly cancellationScope: string;
  readonly isRunning: boolean;
}

export interface PiSubagentExtensionBridge {
  readonly handshake: (
    request: PiSubagentHandshakeRequest,
  ) => Promise<PiSubagentHandshakeResponse> | PiSubagentHandshakeResponse;
  readonly spawn?: (
    command: PiSubagentSpawnCommand,
  ) => Promise<PiSubagentSpawnResult> | PiSubagentSpawnResult;
  /**
   * Ticket 06 fenced durable cancel (host → extension). The result MUST
   * resolve only after the child operation settled on the extension side
   * (termination evidence), carrying the same attempt/generation. A live
   * child whose identity does not match returns `stale` and is NOT aborted.
   */
  readonly cancel?: (
    command: PiSubagentCancelCommand,
  ) => Promise<PiSubagentCancelResult> | PiSubagentCancelResult;
  /**
   * Decision 0033 §3/§5 opaque identity-fenced child-owner teardown
   * endpoint (owner → host is the RESULT; this is the host → owner command
   * spelling). OPTIONAL and additive: an extension without the capability
   * simply never exposes it, and every such absence degrades to non-terminal
   * band 78 owner-unproven — never to parent-supervisor fallback. The
   * command carries ONLY execution/attempt/generation fencing; PIDs, session
   * keys, and signals stay endpoint-local.
   */
  readonly teardownOwnedProcesses?: (
    command: PiSubagentTeardownOwnedProcessesCommand,
  ) =>
    | Promise<PiSubagentTeardownOwnedProcessesResult>
    | PiSubagentTeardownOwnedProcessesResult;
  readonly abort?: (id: string) => boolean | Promise<boolean>;
  readonly abortAll?: () => number | Promise<number>;
  readonly getActiveExecutions?: () => ReadonlyArray<PiSubagentActiveChild>;
  readonly emitLifecycleEvent?: (event: PiSubagentLifecycleEvent) => Promise<void> | void;
}

export function createDefaultHandshakeRequest(): PiSubagentHandshakeRequest {
  return {
    protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
    supportedProtocolVersions: [PI_SUBAGENTS_PROTOCOL_VERSION],
    clientVersion: "0.7.2",
    requiredCapabilities: ["managed-spawn", "abort-propagation", "bounded-foreground-attachment"],
    optionalCapabilities: [
      "coalesced-progress",
      "durable-cancellation",
      "journal-terminal-lifecycle",
      "terminal-outbox",
      "completion-delivery-ownership",
      "restart-reconciliation",
      "paginated-transcripts",
      PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
    ],
  };
}

/**
 * Decision 0033 capability gate for an optional capability: true only when a
 * negotiated handshake actually supplied it. An unmanaged or absent
 * negotiation never enables the child-owner teardown path.
 */
export function negotiationSupportsPiSubagentCapability(
  negotiated: PiSubagentNegotiatedCapability,
  capability: PiSubagentCapability,
): boolean {
  return (
    negotiated.isManaged && (negotiated.capabilities ?? []).includes(capability)
  );
}

/**
 * Decision 0033 §6/§7 result validation. Returns the authenticated owner
 * result ONLY when it decodes against the staged contract AND its
 * execution/attempt/generation correlation echoes the dispatched command
 * fencing exactly. Malformed, unknown-shape, and mismatched data are all
 * `undefined` — an invalid/unproven marker the caller maps to band 78 with
 * no signal, no band 76, and no generation fence.
 */
export function validatePiSubagentTeardownOwnedProcessesResult(
  raw: unknown,
  command: PiSubagentTeardownOwnedProcessesCommand,
): PiSubagentTeardownOwnedProcessesResult | undefined {
  const decodedOption = Schema.decodeUnknownOption(
    PiSubagentTeardownOwnedProcessesResultSchema,
  )(raw);
  if (Option.isNone(decodedOption)) {
    return undefined;
  }
  const result = decodedOption.value;
  if (
    result.executionId !== command.executionId ||
    result.attemptId !== command.expectedAttemptId ||
    result.generation !== command.expectedGeneration
  ) {
    return undefined;
  }
  return result;
}

/**
 * Review remediation (Decision 0033 §6): the host-side bound on the opaque
 * `teardownOwnedProcesses` bridge call. It REUSES the existing Pi watchdog
 * stage timeout semantics (Ticket 15 / T15-AC1: absent, invalid, or
 * out-of-range input falls back to the shared 10s default — never clamped),
 * so no new configuration knob, environment variable, or schema migration
 * is introduced and direct callers without options stay safe.
 */
export interface PiSubagentTeardownOwnedProcessesDispatchOptions {
  /** Bounded wait for the owner endpoint reply (default 10000ms). */
  readonly timeoutMs?: number | undefined;
}

/** Module-private sentinel resolved when the bounded wait elapses first. */
const PI_SUBAGENT_TEARDOWN_DISPATCH_TIMED_OUT = Symbol(
  "synara.pi.subagents.teardown_owned_processes.dispatch_timed_out",
);

/**
 * Decision 0033 §5/§6 host-side dispatch of the opaque child-owner teardown
 * endpoint. This is the ONLY surface Symphony may call for managed-child
 * Ticket-16 teardown; it never enumerates, caches, reconstructs, registers,
 * or signals child PIDs/process groups, and never falls back to the parent
 * PiBashProcessSupervisor. Every absent/malformed/mismatched/thrown/timed-
 * out path is a non-terminal owner-unproven outcome — including the
 * authenticated owner-reported `stale`/`missing`/`owner_unavailable`/
 * `dispatch_failed` statuses, which carry no teardown proof of any kind.
 * The opaque endpoint is never signalled or aborted when the bound elapses;
 * the host simply stops waiting (D0033 §6: a timed-out endpoint is
 * non-terminal owner-unproven with no kill claim).
 */
export async function dispatchPiSubagentTeardownOwnedProcesses(
  bridge: PiSubagentExtensionBridge,
  command: PiSubagentTeardownOwnedProcessesCommand,
  options?: PiSubagentTeardownOwnedProcessesDispatchOptions,
): Promise<PiSubagentTeardownOwnedProcessesDispatch> {
  const teardownFn = bridge.teardownOwnedProcesses;
  if (typeof teardownFn !== "function") {
    // Mixed-version extension (no child-bash-process-ownership capability):
    // nothing was dispatched; the honest band-78 owner-unproven posture.
    return {
      kind: "unproven",
      reason: "bridge_operation_absent",
      diagnosticCode: "pi_subagent_teardown_owner_unproven",
      diagnosticMessage:
        "The extension bridge does not expose the teardownOwnedProcesses owner endpoint (capability child-bash-process-ownership absent); no owned teardown was proven",
      attemptedCommand: command,
    };
  }

  // Direct-caller safety: an absent/invalid/out-of-range deadline falls
  // back to the existing watchdog-stage default (10s), never to zero.
  const timeoutMs = resolvePiSubagentWatchdogStageTimeoutMs(options?.timeoutMs);

  let raw: unknown;
  try {
    raw = await new Promise<unknown>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(PI_SUBAGENT_TEARDOWN_DISPATCH_TIMED_OUT);
      }, Math.max(0, timeoutMs));
      timer.unref?.();
      const accept = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const fail = (cause: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(cause);
      };
      let endpointOutcome: unknown;
      try {
        endpointOutcome = teardownFn(command);
      } catch (syncCause) {
        // A bridge function may throw synchronously (same contract as a
        // later rejection): the honest outcome is `dispatch_threw`.
        fail(syncCause);
        return;
      }
      // Handlers stay attached even after a timeout win, so a LATE endpoint
      // settlement or rejection can never surface as an unhandled rejection.
      void Promise.resolve(endpointOutcome).then(accept, fail);
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      kind: "unproven",
      reason: "dispatch_threw",
      diagnosticCode: "pi_subagent_teardown_owner_unproven",
      diagnosticMessage: `The teardownOwnedProcesses owner endpoint dispatch threw (${message}); no owned teardown was proven`,
      attemptedCommand: command,
    };
  }

  if (raw === PI_SUBAGENT_TEARDOWN_DISPATCH_TIMED_OUT) {
    return {
      kind: "unproven",
      reason: "dispatch_timed_out",
      diagnosticCode: "pi_subagent_teardown_owner_unproven",
      diagnosticMessage: `The teardownOwnedProcesses owner endpoint did not settle within the bounded host-side wait of ${String(timeoutMs)}ms; the host stopped waiting without signalling the owner, no owned teardown was proven, and cleanup remains uncertain`,
      attemptedCommand: command,
    };
  }

  const decodedOption = Schema.decodeUnknownOption(
    PiSubagentTeardownOwnedProcessesResultSchema,
  )(raw);
  if (Option.isNone(decodedOption)) {
    return {
      kind: "unproven",
      reason: "malformed_result",
      diagnosticCode: "pi_subagent_teardown_owner_unproven",
      diagnosticMessage:
        "The teardownOwnedProcesses owner endpoint returned a malformed or unknown result; no owned teardown was proven",
      attemptedCommand: command,
    };
  }
  const result = decodedOption.value;

  if (
    result.executionId !== command.executionId ||
    result.attemptId !== command.expectedAttemptId ||
    result.generation !== command.expectedGeneration
  ) {
    return {
      kind: "unproven",
      reason: "identity_mismatch",
      diagnosticCode: "pi_subagent_teardown_owner_unproven",
      diagnosticMessage:
        "The teardownOwnedProcesses owner endpoint replied with a mismatching execution/attempt/generation identity; the stale owner was not trusted and nothing further was signalled",
      attemptedCommand: command,
      result,
    };
  }

  switch (result.status) {
    case "proven":
      return { kind: "validated", result };
    case "survivors":
      // The ONLY survivor-evidence path (band 77); bounded by contract at
      // MAX_PI_SUBAGENT_TEARDOWN_RESULT_SURVIVOR_PIDS entries.
      return { kind: "validated", result };
    case "stale":
      return {
        kind: "unproven",
        reason: "stale_generation",
        diagnosticCode: "pi_subagent_teardown_owner_unproven",
        diagnosticMessage:
          "The live owner endpoint reported the teardown fencing as stale; nothing was signalled and no teardown was proven",
        attemptedCommand: command,
        result,
      };
    case "missing":
      return {
        kind: "unproven",
        reason: "owner_missing",
        diagnosticCode: "pi_subagent_teardown_owner_unproven",
        diagnosticMessage:
          "The owner endpoint reported no such execution under this owner; no teardown was proven",
        attemptedCommand: command,
        result,
      };
    case "owner_unavailable":
      return {
        kind: "unproven",
        reason: "owner_unavailable",
        diagnosticCode: "pi_subagent_teardown_owner_unproven",
        diagnosticMessage:
          "No live owner endpoint exists to ask; no teardown was proven",
        attemptedCommand: command,
        result,
      };
    case "dispatch_failed":
      return {
        kind: "unproven",
        reason: "dispatch_failed",
        diagnosticCode: "pi_subagent_teardown_owner_unproven",
        diagnosticMessage:
          "The owner endpoint reported a failed dispatch; no teardown claim of any kind was made",
        attemptedCommand: command,
        result,
      };
  }
}

export async function negotiatePiSubagentCapability(
  bridge: PiSubagentExtensionBridge,
  requestOverride?: PiSubagentHandshakeRequest,
): Promise<PiSubagentNegotiatedCapability> {
  const request = requestOverride ?? createDefaultHandshakeRequest();

  try {
    const rawResponse = await bridge.handshake(request);
    const decodedOption = Schema.decodeUnknownOption(PiSubagentHandshakeResponse)(rawResponse);

    if (Option.isNone(decodedOption)) {
      return {
        status: "bridge_malformed_response",
        diagnosticCode: "pi_subagent_bridge_malformed_response",
        isManaged: false,
        diagnosticMessage: "Pi subagent bridge returned malformed handshake response",
      };
    }

    const response = decodedOption.value;

    if (!response.ok) {
      const failure = response as PiSubagentHandshakeFailureResponse;
      if (failure.error === "missing_capabilities") {
        return {
          status: "capability_mismatch",
          diagnosticCode: "pi_subagent_capability_mismatch",
          isManaged: false,
          missingCapabilities: failure.missingCapabilities,
          extensionVersion: failure.extensionVersion,
          diagnosticMessage:
            failure.detail ??
            `Pi subagent bridge missing required capabilities: ${(failure.missingCapabilities ?? []).join(", ")}`,
        };
      }
      if (failure.error === "unsupported_version") {
        return {
          status: "unsupported_version",
          diagnosticCode: "pi_subagent_unsupported_version",
          isManaged: false,
          offeredVersion: request.protocolVersion,
          supportedVersions:
            failure.supportedProtocolVersions ??
            (failure.protocolVersion ? [failure.protocolVersion] : undefined),
          extensionVersion: failure.extensionVersion,
          diagnosticMessage:
            failure.detail ?? `Pi subagent bridge rejected handshake with error: ${failure.error}`,
        };
      }
      return {
        status: "bridge_error",
        diagnosticCode: "pi_subagent_bridge_error",
        isManaged: false,
        extensionVersion: failure.extensionVersion,
        diagnosticMessage:
          failure.detail ?? `Pi subagent bridge rejected handshake with error: ${failure.error}`,
      };
    }

    const success = response as PiSubagentHandshakeSuccessResponse;

    if (
      success.protocolVersion < PI_SUBAGENTS_MIN_PROTOCOL_VERSION ||
      success.protocolVersion > PI_SUBAGENTS_MAX_PROTOCOL_VERSION
    ) {
      return {
        status: "unsupported_version",
        diagnosticCode: "pi_subagent_unsupported_version",
        isManaged: false,
        offeredVersion: request.protocolVersion,
        supportedVersions: [success.protocolVersion],
        extensionVersion: success.extensionVersion,
        diagnosticMessage: `Pi subagent bridge protocol version ${success.protocolVersion} is outside supported range [${PI_SUBAGENTS_MIN_PROTOCOL_VERSION}, ${PI_SUBAGENTS_MAX_PROTOCOL_VERSION}]`,
      };
    }

    const suppliedCapabilities = new Set(success.capabilities);
    const missing = request.requiredCapabilities.filter((c) => !suppliedCapabilities.has(c));
    if (missing.length > 0) {
      return {
        status: "capability_mismatch",
        diagnosticCode: "pi_subagent_capability_mismatch",
        isManaged: false,
        protocolVersion: success.protocolVersion,
        capabilities: success.capabilities,
        missingCapabilities: missing,
        extensionVersion: success.extensionVersion,
        diagnosticMessage: `Pi subagent bridge missing required capabilities: ${missing.join(", ")}`,
      };
    }

    return {
      status: "managed_enabled",
      diagnosticCode: "pi_subagent_managed_enabled",
      isManaged: true,
      protocolVersion: success.protocolVersion,
      capabilities: success.capabilities,
      extensionVersion: success.extensionVersion,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      status: "bridge_error",
      diagnosticCode: "pi_subagent_bridge_error",
      isManaged: false,
      diagnosticMessage: `Pi subagent bridge handshake threw: ${errorMessage}`,
    };
  }
}

function extractBridge(target: unknown): PiSubagentExtensionBridge | undefined {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const record = target as Record<string | symbol, unknown>;

  if (PI_SUBAGENT_BRIDGE_KEY in record && record[PI_SUBAGENT_BRIDGE_KEY]) {
    return record[PI_SUBAGENT_BRIDGE_KEY] as PiSubagentExtensionBridge;
  }

  if ("session" in record && record.session && typeof record.session === "object") {
    const sessionRecord = record.session as Record<string | symbol, unknown>;
    if (PI_SUBAGENT_BRIDGE_KEY in sessionRecord && sessionRecord[PI_SUBAGENT_BRIDGE_KEY]) {
      return sessionRecord[PI_SUBAGENT_BRIDGE_KEY] as PiSubagentExtensionBridge;
    }
  }

  const resourceLoader =
    (record.resourceLoader as any) ??
    (record.services as any)?.resourceLoader ??
    (record.session as any)?.resourceLoader;

  if (resourceLoader && typeof resourceLoader.getExtensions === "function") {
    const loaded = resourceLoader.getExtensions()?.extensions;
    if (Array.isArray(loaded)) {
      for (const ext of loaded) {
        if (!ext || typeof ext !== "object") continue;
        if (PI_SUBAGENT_BRIDGE_KEY in ext && ext[PI_SUBAGENT_BRIDGE_KEY]) {
          return ext[PI_SUBAGENT_BRIDGE_KEY] as PiSubagentExtensionBridge;
        }
        if (ext.handlers instanceof Map) {
          const bridgeHandlers = ext.handlers.get("synara:subagents:bridge");
          if (Array.isArray(bridgeHandlers) && bridgeHandlers.length > 0) {
            const resolved = bridgeHandlers[0]();
            if (resolved) return resolved;
          }
          const handshakeHandlers = ext.handlers.get("synara:subagents:handshake");
          if (Array.isArray(handshakeHandlers) && handshakeHandlers.length > 0) {
            return {
              handshake: (req) => handshakeHandlers[0](req),
            };
          }
        }
      }
    }
  }

  if ("handshake" in record && typeof record.handshake === "function") {
    return record as unknown as PiSubagentExtensionBridge;
  }

  return undefined;
}

/**
 * Ticket 06: public bridge extraction for the durable-cancellation dispatch
 * path (same extraction rules as the capability probe).
 */
export function extractPiSubagentBridge(target: unknown): PiSubagentExtensionBridge | undefined {
  return extractBridge(target);
}

export async function probePiSubagentBridge(
  target: unknown,
): Promise<PiSubagentNegotiatedCapability> {
  if (!target || typeof target !== "object") {
    return {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "No Pi subagent bridge found in target object",
    };
  }

  const cacheHolder = target as Record<string | symbol, unknown>;
  if (PI_SUBAGENT_PROBE_CACHE_KEY in cacheHolder && cacheHolder[PI_SUBAGENT_PROBE_CACHE_KEY]) {
    return cacheHolder[PI_SUBAGENT_PROBE_CACHE_KEY] as PiSubagentNegotiatedCapability;
  }

  const bridge = extractBridge(target);
  if (!bridge) {
    const absentResult: PiSubagentNegotiatedCapability = {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Pi subagent bridge not found; using legacy unmanaged behavior",
    };
    cacheHolder[PI_SUBAGENT_PROBE_CACHE_KEY] = absentResult;
    return absentResult;
  }

  const result = await negotiatePiSubagentCapability(bridge);
  cacheHolder[PI_SUBAGENT_PROBE_CACHE_KEY] = result;
  return result;
}

// ---------------------------------------------------------------------------
// Isolated Test Fixtures
// ---------------------------------------------------------------------------

export interface CompatibleExtensionOptions {
  readonly protocolVersion?: number;
  readonly capabilities?: PiSubagentCapability[];
  readonly extensionVersion?: string;
  readonly onExecuteContext?: (context: unknown) => void;
  readonly onSpawn?: (
    command: PiSubagentSpawnCommand,
  ) => Promise<PiSubagentSpawnResult> | PiSubagentSpawnResult;
  readonly onLifecycleEvent?: (event: PiSubagentLifecycleEvent) => Promise<void> | void;
  readonly onCancel?: (
    command: PiSubagentCancelCommand,
  ) => Promise<PiSubagentCancelResult> | PiSubagentCancelResult;
  /** Decision 0033 optional child-owner teardown endpoint fixture wiring. */
  readonly onTeardownOwnedProcesses?: (
    command: PiSubagentTeardownOwnedProcessesCommand,
  ) =>
    | Promise<PiSubagentTeardownOwnedProcessesResult>
    | PiSubagentTeardownOwnedProcessesResult;
}

export function makeCompatiblePiSubagentExtension(options?: CompatibleExtensionOptions) {
  const protocolVersion = options?.protocolVersion ?? PI_SUBAGENTS_PROTOCOL_VERSION;
  const capabilities =
    options?.capabilities ??
    (options?.onTeardownOwnedProcesses === undefined
      ? PI_SUBAGENT_CAPABILITIES.filter(
          (capability) => capability !== PI_SUBAGENT_TEARDOWN_OWNED_PROCESSES_CAPABILITY,
        )
      : [...PI_SUBAGENT_CAPABILITIES]);
  const extensionVersion = options?.extensionVersion ?? "0.1.0";
  const emittedEvents: PiSubagentLifecycleEvent[] = [];

  const bridge: PiSubagentExtensionBridge = {
    handshake: async () => ({
      ok: true,
      protocolVersion,
      extensionVersion,
      capabilities,
    }),
    ...(options?.onSpawn !== undefined ? { spawn: options.onSpawn } : {}),
    ...(options?.onCancel !== undefined ? { cancel: options.onCancel } : {}),
    ...(options?.onTeardownOwnedProcesses !== undefined
      ? { teardownOwnedProcesses: options.onTeardownOwnedProcesses }
      : {}),
    emitLifecycleEvent: async (event) => {
      emittedEvents.push(event);
      if (options?.onLifecycleEvent) {
        await options.onLifecycleEvent(event);
      }
    },
    abort: () => true,
    abortAll: () => 0,
    getActiveExecutions: () => [],
  };

  const factory = (pi: any) => {
    if (pi) {
      pi[PI_SUBAGENT_BRIDGE_KEY] = bridge;
      if (typeof pi.on === "function") {
        pi.on("synara:subagents:bridge", () => bridge);
      }
      if (typeof pi.registerTool === "function") {
        pi.registerTool({
          name: "Agent",
          label: "Managed Agent",
          description: "Managed Pi subagent tool",
          parameters: {} as any,
          execute: async (_toolCallId: string, params: any, _signal?: unknown, _onUpdate?: unknown, ctx?: unknown) => {
            options?.onExecuteContext?.(ctx);
            if (bridge.spawn) {
              const spawnResult = await bridge.spawn({
                commandId: params.commandId ?? `cmd_${Date.now()}`,
                projectId: params.projectId ?? "proj_default",
                parentThreadId: params.parentThreadId ?? "thread_main",
                parentTurnId: params.parentTurnId ?? "turn_1",
                agentType: params.agentType ?? "default",
                prompt: params.prompt ?? "",
                mode: params.mode ?? "foreground",
                cancellationScope: params.cancellationScope ?? "parent_turn",
              });

              if (spawnResult.status === "rejected") {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Subagent spawn rejected [${spawnResult.diagnosticCode}]: ${spawnResult.rejectionReason ?? spawnResult.diagnosticCode}`,
                    },
                  ],
                  isError: true,
                };
              }

              if (bridge.emitLifecycleEvent) {
                await bridge.emitLifecycleEvent({
                  eventId: `evt_${Date.now()}`,
                  executionId: spawnResult.executionId,
                  attemptId: spawnResult.attemptId,
                  generation: spawnResult.generation,
                  sequence: 2,
                  state: "running",
                  occurredAt: new Date().toISOString(),
                  parentThreadId: params.parentThreadId ?? "thread_main",
                  parentTurnId: params.parentTurnId ?? "turn_1",
                  parentToolCallId: _toolCallId,
                  projectId: params.projectId ?? "proj_default",
                  diagnosticCode: "pi_subagent_managed_enabled",
                });
              }

              return {
                content: [
                  {
                    type: "text",
                    text: `Managed child started [executionId=${spawnResult.executionId}, attemptId=${spawnResult.attemptId}, generation=${spawnResult.generation}]`,
                  },
                ],
                executionId: spawnResult.executionId,
                attemptId: spawnResult.attemptId,
                generation: spawnResult.generation,
              };
            }

            return { content: [{ type: "text", text: "child completed" }] };
          },
        });
      }
    }
  };
  (factory as any)[PI_SUBAGENT_BRIDGE_KEY] = bridge;

  const extension = {
    name: "pi-subagents",
    factory,
    [PI_SUBAGENT_BRIDGE_KEY]: bridge,
  };

  return { extension, bridge, emittedEvents };
}

export function makeLegacyPiSubagentExtension() {
  const extension = {
    name: "pi-legacy-subagents",
    factory: (pi: any) => {
      if (pi && typeof pi.registerTool === "function") {
        pi.registerTool({
          name: "Agent",
          label: "Legacy Agent",
          description: "Legacy unmanaged subagent tool",
          parameters: {} as any,
          execute: async () => ({ content: [{ type: "text", text: "legacy response" }] }),
        });
      }
    },
  };

  return { extension };
}

export interface UnsupportedExtensionOptions {
  readonly protocolVersion: number;
  readonly supportedVersions?: number[];
  readonly extensionVersion?: string;
  readonly detail?: string;
}

export function makeUnsupportedPiSubagentExtension(options: UnsupportedExtensionOptions) {
  const bridge: PiSubagentExtensionBridge = {
    handshake: async () => ({
      ok: false,
      error: "unsupported_version",
      protocolVersion: options.protocolVersion,
      supportedProtocolVersions: options.supportedVersions ?? [options.protocolVersion],
      extensionVersion: options.extensionVersion ?? "2.0.0",
      detail: options.detail ?? `Requires protocol version ${options.protocolVersion}`,
    }),
  };

  const factory = (pi: any) => {
    if (pi) {
      pi[PI_SUBAGENT_BRIDGE_KEY] = bridge;
      if (typeof pi.on === "function") {
        pi.on("synara:subagents:bridge", () => bridge);
      }
    }
  };
  (factory as any)[PI_SUBAGENT_BRIDGE_KEY] = bridge;

  const extension = {
    name: "pi-subagents-incompatible",
    factory,
    [PI_SUBAGENT_BRIDGE_KEY]: bridge,
  };

  return { extension, bridge };
}

export function makeFailingPiSubagentExtension(error: Error) {
  const bridge: PiSubagentExtensionBridge = {
    handshake: async () => {
      throw error;
    },
  };

  const factory = (pi: any) => {
    if (pi) {
      pi[PI_SUBAGENT_BRIDGE_KEY] = bridge;
      if (typeof pi.on === "function") {
        pi.on("synara:subagents:bridge", () => bridge);
      }
    }
  };
  (factory as any)[PI_SUBAGENT_BRIDGE_KEY] = bridge;

  const extension = {
    name: "pi-subagents-failing",
    factory,
    [PI_SUBAGENT_BRIDGE_KEY]: bridge,
  };

  return { extension, bridge };
}
