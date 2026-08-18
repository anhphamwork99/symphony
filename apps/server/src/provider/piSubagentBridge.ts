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
} from "../config.ts";

export const PI_SUBAGENT_BRIDGE_KEY = Symbol.for("synara.pi.subagents.bridge");
export const PI_SUBAGENT_MANAGED_FOREGROUND_KEY = Symbol.for(
  "synara.pi.subagents.managed_foreground.v1",
);
const PI_SUBAGENT_PROBE_CACHE_KEY = Symbol.for("synara.pi.subagents.probe_cache");

export type PiSubagentObservationKind = "started" | "detached" | "progress" | "heartbeat";

export interface PiSubagentObservationInput {
  readonly kind: PiSubagentObservationKind;
  readonly occurredAt: string;
  /** Present for progress-kind observations only; opaque latest-snapshot JSON. */
  readonly progressJson?: string;
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
      "terminal-outbox",
      "restart-reconciliation",
      "paginated-transcripts",
    ],
  };
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
  readonly onSpawn?: (
    command: PiSubagentSpawnCommand,
  ) => Promise<PiSubagentSpawnResult> | PiSubagentSpawnResult;
  readonly onLifecycleEvent?: (event: PiSubagentLifecycleEvent) => Promise<void> | void;
  readonly onCancel?: (
    command: PiSubagentCancelCommand,
  ) => Promise<PiSubagentCancelResult> | PiSubagentCancelResult;
}

export function makeCompatiblePiSubagentExtension(options?: CompatibleExtensionOptions) {
  const protocolVersion = options?.protocolVersion ?? PI_SUBAGENTS_PROTOCOL_VERSION;
  const capabilities = options?.capabilities ?? [...PI_SUBAGENT_CAPABILITIES];
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
          execute: async (_toolCallId: string, params: any) => {
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
