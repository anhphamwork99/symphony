// FILE: piSubagentManagedRuntimeBinding.ts
// Purpose: Ticket 02 (handshake-first) desktop managed-bootstrap binding —
// the pure helpers that turn a verified desktop artifact into the controlled
// runtime configuration and the MANDATORY full handshake profile, plus the
// bounded redacted failure detail every desktop bootstrap denial must use
// (spec Implementation Decisions 2/4/5; Decision 0003).
// Layer: Server provider seam (pure decision helpers — no PiAdapter wiring,
// no fs, no Pi SDK import, no side effects).
// Depends: the bridge negotiation surface in `piSubagentBridge.ts` and the
// closed capability vocabulary in `@synara/contracts`.
// Exports: the mandatory desktop capability set, the desktop handshake
// request factory, the controlled extension-directory helper, the desktop
// bridge negotiation entry point, the safe failure-detail builder, and the
// fixed desktop user runtime/model configuration failure detail.

import {
  PI_SUBAGENT_CAPABILITIES,
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentHandshakeRequest,
  type PiSubagentNegotiatedCapability,
} from "@synara/contracts";

import {
  createDefaultHandshakeRequest,
  extractPiSubagentBridge,
  negotiatePiSubagentCapability,
} from "./piSubagentBridge.ts";

/**
 * The mandatory desktop managed capability profile (spec Implementation
 * Decision 4): the handshake succeeds ONLY when the verified artifact's
 * bridge supplies ALL seven. Non-desktop sessions keep the existing
 * 3-required default probe (`createDefaultHandshakeRequest`) unchanged.
 */
export const PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "child-bash-process-ownership",
] as const;

export type PiSubagentDesktopManagedRequiredCapability =
  (typeof PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES)[number];

/** Directory segments of the controlled extension source inside agentDir. */
const MANAGED_EXTENSION_DIR_SEGMENTS = ["extensions", "pi-subagents"] as const;

/**
 * Absolute path of the release-controlled extension directory inside the
 * controlled desktop `agentDir` (Decision 0003: extensions load ONLY from
 * this directory — no user-global, project, or settings-injected source).
 */
export const piSubagentDesktopManagedExtensionDir = (agentDir: string): string =>
  [agentDir, ...MANAGED_EXTENSION_DIR_SEGMENTS].join("/");

/** Closed-vocabulary set for O(1) membership checks. */
const REQUIRED_CAPABILITY_SET: ReadonlySet<string> = new Set(
  PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES,
);

/**
 * The desktop managed handshake request (AC2): the default request shape
 * with the required profile widened to the full mandatory seven. The
 * optional profile becomes every remaining known capability, so nothing
 * about the extension's additive surface is silently dropped.
 */
export function createPiSubagentDesktopManagedHandshakeRequest(): PiSubagentHandshakeRequest {
  const base = createDefaultHandshakeRequest();
  return {
    ...base,
    requiredCapabilities: [...PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES],
    optionalCapabilities: PI_SUBAGENT_CAPABILITIES.filter(
      (capability) => !REQUIRED_CAPABILITY_SET.has(capability),
    ),
  };
}

/**
 * Desktop managed bridge negotiation (AC2/AC5).
 *
 * Extracts the bridge from the session-shaped target and negotiates with
 * the MANDATORY full profile. An absent bridge is the closed
 * `bridge_absent` outcome (same shape as the shared probe) — in desktop
 * that is FATAL at the bootstrap boundary, never a legacy fallback.
 */
export async function negotiatePiSubagentDesktopManagedBridge(
  target: unknown,
): Promise<PiSubagentNegotiatedCapability> {
  const bridge = extractPiSubagentBridge(target);
  if (bridge === undefined) {
    return {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Pi subagent bridge not found in the desktop managed session",
    };
  }
  return negotiatePiSubagentCapability(bridge, createPiSubagentDesktopManagedHandshakeRequest());
}

/** Upper bound for the bounded desktop bootstrap failure detail. */
const MAX_DESKTOP_BOOTSTRAP_FAILURE_DETAIL_CHARS = 512;

/**
 * Fixed, bounded detail for desktop-managed user runtime/model
 * configuration failures (AC5 fallback; Ticket 02 WP-B).
 *
 * The empirically real failure vector (Pi SDK 0.83.0 probe, 2026-08-22):
 * malformed or schema-invalid `models.json`/auth inputs do NOT throw during
 * ModelRuntime/services creation — they populate composition errors while
 * builtin models remain usable. The failure that actually escapes the
 * runtime boundary is an explicitly selected model id unavailable from the
 * registry (`createSdkRuntime` throws a raw message embedding that id). A
 * desktop managed session start must surface that vector as EXACTLY this
 * constant: no raw message, no model id, no path, no credential, no stack,
 * and no retained cause object. Non-desktop sessions keep the historical
 * raw `toMessage` behavior unchanged.
 */
export const PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL =
  "Managed Pi subagent user runtime configuration failed";

/**
 * Bounded, redacted desktop bootstrap failure detail (AC5 / user story 18).
 *
 * Built ONLY from the negotiated capability's CLOSED vocabulary — status,
 * diagnosticCode, and (for a capability mismatch) the closed
 * `missingCapabilities` labels. It NEVER includes `diagnosticMessage`,
 * `extensionVersion`, offered/supported versions, paths, prompts,
 * credential material, or provider configuration: a hostile or divergent
 * bridge can put arbitrary strings into `detail`/`diagnosticMessage`, and
 * those must not reach the operator surface.
 */
export function piSubagentDesktopManagedBootstrapFailureDetail(
  capability: PiSubagentNegotiatedCapability,
): string {
  if (capability.isManaged) {
    return "Managed Pi subagent harness bootstrap failed";
  }
  const missing =
    capability.status === "capability_mismatch" &&
    Array.isArray(capability.missingCapabilities) &&
    capability.missingCapabilities.length > 0
      ? ` (missing capabilities: ${capability.missingCapabilities.join(", ")})`
      : "";
  return `Managed Pi subagent harness bootstrap failed (${capability.status}:${capability.diagnosticCode})${missing}`.slice(
    0,
    MAX_DESKTOP_BOOTSTRAP_FAILURE_DETAIL_CHARS,
  );
}
