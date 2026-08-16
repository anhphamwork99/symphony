import { Option, Schema } from "effect";


import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_MAX_PROTOCOL_VERSION,
  PI_SUBAGENTS_MIN_PROTOCOL_VERSION,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentCapability,
  type PiSubagentHandshakeFailureResponse,
  type PiSubagentHandshakeRequest,
  PiSubagentHandshakeResponse,
  type PiSubagentHandshakeSuccessResponse,
  type PiSubagentNegotiatedCapability,
} from "@synara/contracts";

export const PI_SUBAGENT_BRIDGE_KEY = Symbol.for("synara.pi.subagents.bridge");
const PI_SUBAGENT_PROBE_CACHE_KEY = Symbol.for("synara.pi.subagents.probe_cache");

export interface PiSubagentExtensionBridge {
  readonly handshake: (
    request: PiSubagentHandshakeRequest,
  ) => Promise<PiSubagentHandshakeResponse> | PiSubagentHandshakeResponse;
}

export function createDefaultHandshakeRequest(): PiSubagentHandshakeRequest {
  return {
    protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
    supportedProtocolVersions: [PI_SUBAGENTS_PROTOCOL_VERSION],
    clientVersion: "0.7.2",
    requiredCapabilities: ["managed-spawn", "abort-propagation"],
    optionalCapabilities: [
      "coalesced-progress",
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
        status: "bridge_error",
        diagnosticCode: "pi_subagent_bridge_error",
        isManaged: false,
        diagnosticMessage: "Pi subagent bridge returned malformed handshake response",
      };
    }

    const response = decodedOption.value;

    if (!response.ok) {
      const failure = response as PiSubagentHandshakeFailureResponse;
      return {
        status: "unsupported_version",
        diagnosticCode: "pi_subagent_unsupported_version",
        isManaged: false,
        offeredVersion: request.protocolVersion,
        supportedVersions: failure.supportedProtocolVersions ?? (failure.protocolVersion ? [failure.protocolVersion] : undefined),
        extensionVersion: failure.extensionVersion,
        diagnosticMessage: failure.detail ?? `Pi subagent bridge rejected handshake with error: ${failure.error}`,
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
}

export function makeCompatiblePiSubagentExtension(options?: CompatibleExtensionOptions) {
  const protocolVersion = options?.protocolVersion ?? PI_SUBAGENTS_PROTOCOL_VERSION;
  const capabilities = options?.capabilities ?? [...PI_SUBAGENT_CAPABILITIES];
  const extensionVersion = options?.extensionVersion ?? "0.1.0";

  const bridge: PiSubagentExtensionBridge = {
    handshake: async () => ({
      ok: true,
      protocolVersion,
      extensionVersion,
      capabilities,
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
    name: "pi-subagents",
    factory,
    [PI_SUBAGENT_BRIDGE_KEY]: bridge,
  };

  return { extension, bridge };
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


