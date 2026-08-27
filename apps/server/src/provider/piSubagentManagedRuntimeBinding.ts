// FILE: piSubagentManagedRuntimeBinding.ts
// Purpose: Ticket 02 (handshake-first) desktop managed-bootstrap binding —
// the pure helpers that turn a verified desktop artifact into the controlled
// runtime configuration and the MANDATORY full handshake profile, plus the
// bounded redacted failure detail every desktop bootstrap denial must use
// (spec Implementation Decisions 2/4/5; Decision 0003).
// Layer: Server provider seam (handshake and managed-tool routing helpers —
// no fs, no Pi SDK import, no provider-global state).
// Depends: the bridge negotiation surface in `piSubagentBridge.ts` and the
// closed capability vocabulary in `@synara/contracts`.
// Exports: the mandatory desktop capability set, the desktop handshake
// request factory, the controlled extension-directory helper, the desktop
// bridge negotiation entry point, the safe failure-detail builder, and the
// fixed desktop user runtime/model configuration failure detail.

import {
  PI_SUBAGENT_CAPABILITIES,
  PiSubagentDiagnosticCode,
  type PiSubagentDiagnosticCode as PiSubagentDiagnosticCodeType,
  type PiSubagentHandshakeRequest,
  type PiSubagentNegotiatedCapability,
} from "@synara/contracts";
import { Effect, Schema } from "effect";
import type { PiSubagentExecutionReadService } from "./piSubagentExecutionReadService.ts";
import type {
  PiSubagentLiveLifecycleContainment,
  PiSubagentLiveLifecycleRegistration,
  PiSubagentLiveLifecycleUnavailableReason,
} from "./piSubagentLiveLifecycleContainment.ts";

import {
  createDefaultHandshakeRequest,
  extractPiSubagentBridge,
  negotiatePiSubagentCapability,
} from "./piSubagentBridge.ts";

export const PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY =
  "execution-identity-routing-v1" as const;

/**
 * The mandatory desktop managed capability profile (spec Implementation
 * Decision 4): the handshake succeeds ONLY when the verified artifact's
 * bridge supplies the full managed profile, including canonical identity
 * routing. Non-desktop sessions keep the existing legacy probe unchanged.
 */
export const PI_SUBAGENT_DESKTOP_MANAGED_REQUIRED_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "child-bash-process-ownership",
  PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
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
 * with the required profile widened to the full managed profile. The optional
 * profile becomes every remaining known capability, so nothing about the
 * extension's additive surface is silently dropped.
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

/** The managed request profile shared by desktop and non-desktop sessions. */
export function createPiSubagentManagedHandshakeRequest(): PiSubagentHandshakeRequest {
  const base = createDefaultHandshakeRequest();
  const requiredCapabilities = [
    ...base.requiredCapabilities,
    PI_SUBAGENT_EXECUTION_IDENTITY_ROUTING_CAPABILITY,
  ];
  const required = new Set(requiredCapabilities);
  return {
    ...base,
    requiredCapabilities,
    optionalCapabilities: PI_SUBAGENT_CAPABILITIES.filter((capability) => !required.has(capability)),
  };
}

/**
 * Managed-session negotiation. An absent bridge remains the legacy/unmanaged
 * result; once a bridge exists, however, the canonical routing capability is
 * mandatory and is never downgraded to a partial managed session.
 */
export async function negotiatePiSubagentManagedBridge(
  target: unknown,
): Promise<PiSubagentNegotiatedCapability> {
  const bridge = extractPiSubagentBridge(target);
  if (bridge === undefined) {
    return {
      status: "bridge_absent",
      diagnosticCode: "pi_subagent_bridge_absent",
      isManaged: false,
      diagnosticMessage: "Pi subagent bridge not found; using legacy unmanaged behavior",
    };
  }
  return negotiatePiSubagentCapability(bridge, createPiSubagentManagedHandshakeRequest());
}

export type PiSubagentManagedToolName = "get_subagent_result" | "steer_subagent";

export type PiSubagentManagedToolReadService = Pick<
  PiSubagentExecutionReadService,
  "readResult"
>;

export interface PiSubagentManagedToolRouterOptions {
  readonly readService: PiSubagentManagedToolReadService;
  /** Bound to the exact runtime session which exposed the tool. */
  readonly isCapabilityBound: () => boolean;
  /**
   * Optional WP-01 live route. Durable authorization remains above this
   * boundary; when present, only the resolved nonterminal tuple is delegated
   * to this exact session-local containment instance.
   */
  readonly liveLifecycle?: {
    readonly containment: PiSubagentLiveLifecycleContainment;
    readonly session: object;
    readonly registration?: PiSubagentLiveLifecycleRegistration | undefined;
    readonly registrationForTuple?:
      | ((tuple: {
          readonly executionId: string;
          readonly attemptId: string;
          readonly generation: number;
        }) => PiSubagentLiveLifecycleRegistration | undefined)
      | undefined;
  };
}

const MANAGED_ROUTING_MAX_OUTPUT_CHARS = 4_000;
const MANAGED_ROUTING_ID_MAX_CHARS = 256;
const MANAGED_ROUTING_MAX_CONTENT_ITEMS = 64;

const PROVIDER_IDENTITY_PATTERN = /agent[_-]?id/i;

function managedRoutingText(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  return text
    .replace(/agent[_-]?id/gi, "provider-identity")
    .slice(0, MANAGED_ROUTING_MAX_OUTPUT_CHARS);
}

function containsProviderIdentity(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return PROVIDER_IDENTITY_PATTERN.test(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsProviderIdentity(item, seen));
  return Object.entries(value).some(
    ([key, entry]) =>
      PROVIDER_IDENTITY_PATTERN.test(key) || containsProviderIdentity(entry, seen),
  );
}

function managedRoutingResult(
  text: string,
  details?: Record<string, unknown>,
  isError = false,
  diagnosticCode?: string,
): Record<string, unknown> {
  const result = {
    content: [{ type: "text", text: managedRoutingText(text) }],
    ...(details === undefined ? {} : { details }),
    ...(isError ? { isError: true } : {}),
    ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
  };
  // Managed responses are a provider-identity boundary. Text is redacted for
  // compatibility, while any nested key/value that still resembles Alfie's
  // private identity is rejected without returning the offending payload.
  return containsProviderIdentity(result)
    ? {
        content: [{ type: "text", text: "Managed execution response unavailable." }],
        isError: true,
        diagnosticCode: "pi_subagent_read_live_record_unavailable",
      }
    : result;
}

const isPiSubagentDiagnosticCode = (value: unknown): value is PiSubagentDiagnosticCodeType =>
  typeof value === "string" && Schema.is(PiSubagentDiagnosticCode)(value);

function managedRoutingFailure(code: string, text = code): Record<string, unknown> {
  return managedRoutingResult(text, undefined, true, code);
}

function readFailureCode(error: unknown): string {
  if (error && typeof error === "object" && "diagnosticCode" in error) {
    const code = (error as { diagnosticCode?: unknown }).diagnosticCode;
    if (typeof code === "string") return code;
  }
  return "pi_subagent_read_denied";
}

function normalizeManagedToolParams(params: unknown):
  | { readonly kind: "invalid"; readonly code: string }
  | {
      readonly kind: "valid";
      readonly executionId?: string;
      readonly agent_id?: string;
      readonly attemptId?: string;
      readonly generation?: number;
      readonly aliasUsed: boolean;
    } {
  if (!params || typeof params !== "object") {
    return { kind: "invalid", code: "pi_subagent_read_payload_bounded" };
  }
  const raw = params as Record<string, unknown>;
  // Provider-local identity is never a managed alias. Reject it before even
  // constructing the durable read request, so it cannot reach Alfie's lookup.
  if (Object.prototype.hasOwnProperty.call(raw, "agentId")) {
    return { kind: "invalid", code: "pi_subagent_read_alias_conflict" };
  }
  if (
    (Object.prototype.hasOwnProperty.call(raw, "execution_id") &&
      typeof raw.execution_id !== "string") ||
    (Object.prototype.hasOwnProperty.call(raw, "agent_id") && typeof raw.agent_id !== "string") ||
    (Object.prototype.hasOwnProperty.call(raw, "attempt_id") && typeof raw.attempt_id !== "string")
  ) {
    return { kind: "invalid", code: "pi_subagent_read_payload_bounded" };
  }
  const executionId = typeof raw.execution_id === "string" ? raw.execution_id.trim() : undefined;
  const alias = typeof raw.agent_id === "string" ? raw.agent_id.trim() : undefined;
  const attemptId = typeof raw.attempt_id === "string" ? raw.attempt_id.trim() : undefined;
  const generation = raw.generation;
  if (
    (executionId !== undefined && executionId.length > MANAGED_ROUTING_ID_MAX_CHARS) ||
    (alias !== undefined && alias.length > MANAGED_ROUTING_ID_MAX_CHARS) ||
    (attemptId !== undefined && attemptId.length > MANAGED_ROUTING_ID_MAX_CHARS) ||
    (generation !== undefined &&
      (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1))
  ) {
    return { kind: "invalid", code: "pi_subagent_read_payload_bounded" };
  }
  if (executionId !== undefined && alias !== undefined && executionId !== alias) {
    return { kind: "invalid", code: "pi_subagent_read_alias_conflict" };
  }
  if (executionId === undefined && alias === undefined) {
    return { kind: "invalid", code: "pi_subagent_read_missing_durable_evidence" };
  }
  return {
    kind: "valid",
    ...(executionId === undefined ? {} : { executionId }),
    ...(alias === undefined ? {} : { agent_id: alias }),
    ...(attemptId === undefined ? {} : { attemptId }),
    ...(generation === undefined ? {} : { generation: generation as number }),
    aliasUsed: alias !== undefined,
  };
}

function publicReadDetails(read: any): Record<string, unknown> {
  return {
    executionId: read.executionId,
    ...(read.attemptId === undefined ? {} : { attemptId: read.attemptId }),
    ...(read.generation === undefined ? {} : { generation: read.generation }),
    observedState: read.observedState,
    ...(read.liveObservedState === null || read.liveObservedState === undefined
      ? {}
      : { liveObservedState: read.liveObservedState }),
    ...(read.diagnostics === undefined ? {} : { diagnostics: read.diagnostics }),
  };
}

function durableReadText(read: any): string {
  const diagnostics =
    Array.isArray(read.diagnostics) && read.diagnostics.length > 0
      ? `\nDiagnostics: ${read.diagnostics.join(", ")}`
      : "";
  const summary =
    typeof read.summary === "string" && read.summary.length > 0
      ? `\n\n${read.summary}`
      : "\nNo durable result evidence.";
  return (
    `Execution ID: ${read.executionId}\n` +
    `Attempt ID: ${read.attemptId ?? "unknown"}\n` +
    `Generation: ${read.generation ?? "unknown"}\n` +
    `State: ${read.observedState}${read.terminalState ? `\nTerminal state: ${read.terminalState}` : ""}` +
    diagnostics +
    summary
  );
}

const MANAGED_LIVE_UNAVAILABLE_CODE = "pi_subagent_managed_execution_unavailable_live";

interface ManagedControlRunContext {
  readonly originalExecute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<any>;
  readonly markAccepted: () => void;
  readonly markTimedOut: () => void;
  readonly markUnavailable: (reason: PiSubagentLiveLifecycleUnavailableReason) => void;
  readonly markResponseLost: () => void;
}

/**
 * Exact structured classification of ONE control-class provider response.
 *
 * No human-text parsing happens on this path: the provider's structured
 * `isError` + closed `diagnosticCode` pair is the only error signal.
 *
 * - exact `isError && diagnosticCode ===
 *   pi_subagent_managed_execution_unavailable_live` → `markUnavailable(provider_inactive)`;
 * - a valid bounded controlled success object → `markAccepted` then the
 *   value flows through post-response revalidation;
   * - anything malformed, any other error shape, or a throw → conservative
   *   outcome-unknown via `markAccepted` followed by failure classification
   *   (an effect may have linearized; zero-effect is never claimed).
 */
async function classifyAndRunManagedControl(
  toolCallId: string,
  providerParams: Record<string, unknown>,
  signal: unknown,
  onUpdate: unknown,
  ctx: unknown,
  context: ManagedControlRunContext,
): Promise<any> {
  let providerResult: any;
  try {
    providerResult = await context.originalExecute(
      toolCallId,
      providerParams,
      signal,
      onUpdate,
      ctx,
    );
  } catch {
    // The provider transport threw after the call was issued. An effect may
      // have linearized; the conservative bounded classification is outcome
      // unknown, never a zero-effect claim.
      context.markAccepted();
      throw new Error("pi_subagent_live_lifecycle_outcome_unknown");
  }
  if (
    providerResult?.isError === true &&
    providerResult?.diagnosticCode === MANAGED_LIVE_UNAVAILABLE_CODE
  ) {
    // Exact structured provider-inactive marker: no accepted effect exists.
    context.markUnavailable("provider_inactive");
    throw new Error("pi_subagent_live_lifecycle_unavailable");
  }
  if (providerResult?.isError === true) {
    // Any other provider error after dispatch may follow a linearized
      // effect, so it stays conservative outcome-unknown.
      context.markAccepted();
      throw new Error("pi_subagent_live_lifecycle_outcome_unknown");
  }
  if (isBoundedControlledSuccess(providerResult)) {
    // Decision 0003: the managed steer insertion boundary is synchronous and
    // occurs before the async provider call can settle. A later response
    // loss is therefore outcome-unknown.
    context.markAccepted();
    return providerResult;
  }
  // Malformed response: acceptance may have occurred before the malformed
    // payload was produced, so this stays conservative outcome-unknown too.
    context.markAccepted();
    throw new Error("pi_subagent_live_lifecycle_outcome_unknown");
}

/**
 * A controlled success is a bounded result object with a content array of
 * bounded text entries. Anything else is malformed for live routing.
 */
function isBoundedControlledSuccess(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (result.isError === true) return false;
  if (!Array.isArray(result.content)) return false;
  if (result.content.length > MANAGED_ROUTING_MAX_CONTENT_ITEMS) return false;
  return result.content.every((item) => {
    if (!item || typeof item !== "object") return false;
    const entry = item as Record<string, unknown>;
    if (entry.type !== "text" || typeof entry.text !== "string") return false;
    return entry.text.length <= MANAGED_ROUTING_MAX_OUTPUT_CHARS;
  });
}

/**
 * Observation path: bounded snapshot capture with NO acceptance boundary.
 * A successful capture only counts when the current registration still
 * revalidates afterwards; any throw, malformed payload, or structured
 * provider error degrades to bounded unavailable — never outcome-unknown,
 * never provider_acceptance.
 */
async function observeManagedResult(
  originalExecute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: unknown,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<any>,
  toolCallId: string,
  providerParams: Record<string, unknown>,
  signal: unknown,
  onUpdate: unknown,
  ctx: unknown,
  markUnavailable: (reason: PiSubagentLiveLifecycleUnavailableReason) => void,
): Promise<any> {
  let providerResult: any;
  try {
    providerResult = await originalExecute(toolCallId, providerParams, signal, onUpdate, ctx);
  } catch {
    // Observation has no accepted side effect; a transport failure is a
    // bounded unavailable snapshot, not outcome-unknown.
    throw new Error("pi_subagent_live_lifecycle_unavailable");
  }
    if (providerResult?.isError === true) {
      if (providerResult?.diagnosticCode === MANAGED_LIVE_UNAVAILABLE_CODE) {
        markUnavailable("provider_inactive");
      }
      throw new Error("pi_subagent_live_lifecycle_unavailable");
  }
  if (!isBoundedControlledSuccess(providerResult)) {
    throw new Error("pi_subagent_live_lifecycle_unavailable");
  }
  return providerResult;
}

/**
 * Wrap one Alfie managed result/control tool. Durable authorization and tuple
 * resolution are deliberately performed before `originalExecute`; terminal
 * reads never call the provider, and control never has a queue/replay fallback.
 */
export function wrapPiSubagentManagedTool(
  target: any,
  toolName: PiSubagentManagedToolName,
  options: PiSubagentManagedToolRouterOptions,
): boolean {
  if (!target || typeof target.execute !== "function" || target.__synaraCanonicalRoutingWrapped) {
    return false;
  }
  const originalExecute = target.execute.bind(target);
  target.__synaraCanonicalRoutingWrapped = true;
  target.execute = async (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: unknown,
    onUpdate?: unknown,
    ctx?: unknown,
  ) => {
    if (!options.isCapabilityBound()) {
      return managedRoutingFailure(
        "pi_subagent_read_capability_unavailable",
        "Managed execution identity routing is unavailable for this session.",
      );
    }
    const normalized = normalizeManagedToolParams(params);
    if (normalized.kind === "invalid") {
      return managedRoutingFailure(
        normalized.code,
        `Managed execution identity request rejected [${normalized.code}].`,
      );
    }
    const durableInput = {
      ...(normalized.executionId === undefined ? {} : { executionId: normalized.executionId }),
      ...(normalized.agent_id === undefined ? {} : { agent_id: normalized.agent_id }),
      ...(normalized.attemptId === undefined ? {} : { attemptId: normalized.attemptId }),
      ...(normalized.generation === undefined ? {} : { generation: normalized.generation }),
    };
    const durable = await Effect.runPromise(
      Effect.result(options.readService.readResult(durableInput)),
    );
    if (durable._tag === "Failure") {
      const code = readFailureCode(durable.failure);
      return managedRoutingFailure(
        code,
        `Managed execution read rejected [${code}].`,
      );
    }
    const read = durable.success;
    const terminal = read.terminalState !== null && read.terminalState !== undefined;
    if (terminal) {
      if (toolName === "get_subagent_result") {
        return managedRoutingResult(
          durableReadText(read),
          publicReadDetails(read),
          false,
          read.diagnosticCode,
        );
      }
      // A terminal durable tuple is never a live control target. In
      // particular, do not let Alfie's legacy non-running/Resume path decide
      // what a managed steer means.
      return managedRoutingFailure(
        "pi_subagent_read_live_record_unavailable",
        `Managed control unavailable [pi_subagent_read_live_record_unavailable] for execution ${read.executionId}.`,
      );
    }
    const providerParams: Record<string, unknown> = {
      ...params,
      execution_id: read.executionId,
      attempt_id: read.attemptId,
      generation: read.generation,
    };
    delete providerParams.agent_id;
    delete providerParams.agentId;
    let providerResult: any;
    let providerUnavailable = false;
    let providerDiagnosticCode: string | undefined;
    const liveLifecycle = options.liveLifecycle;
    if (liveLifecycle !== undefined) {
      const tuple = {
        executionId: read.executionId,
        attemptId: read.attemptId,
        generation: read.generation,
      };
      const registration =
        liveLifecycle.registrationForTuple?.(tuple) ?? liveLifecycle.registration;
      const liveResult = await (toolName === "steer_subagent"
        ? liveLifecycle.containment.control({
            tuple,
            session: liveLifecycle.session,
            registration,
            invoke: (context) =>
              classifyAndRunManagedControl(toolCallId, providerParams, signal, onUpdate, ctx, {
                originalExecute,
                markAccepted: context.markAccepted,
                markTimedOut: context.markTimedOut,
                markUnavailable: context.markUnavailable,
                markResponseLost: context.markResponseLost,
              }),
          })
        : liveLifecycle.containment.observe({
            tuple,
            session: liveLifecycle.session,
            registration,
            invoke: ({ markUnavailable }) =>
              observeManagedResult(
                originalExecute,
                toolCallId,
                providerParams,
                signal,
                onUpdate,
                ctx,
                markUnavailable,
              ),
          }));
      if (liveResult.status !== "applied") {
        const code = liveResult.diagnosticCode ?? "pi_subagent_live_lifecycle_unavailable";
        if (toolName === "get_subagent_result") {
          const diagnostics = Array.isArray(read.diagnostics) ? [...read.diagnostics] : [];
          if (!diagnostics.includes(code)) diagnostics.push(code);
          const durableWithLiveDiagnostic = { ...read, diagnostics };
          return managedRoutingResult(
            durableReadText(durableWithLiveDiagnostic),
            publicReadDetails(durableWithLiveDiagnostic),
            false,
            code,
          );
        }
        const classification =
          liveResult.status === "outcome_unknown"
            ? "outcome unknown"
            : liveResult.status === "stale"
              ? "stale response ignored"
              : "unavailable";
        return managedRoutingFailure(
          code,
          `Managed live lifecycle ${classification} [${code}].`,
        );
      }
      providerResult = liveResult.value;
    } else {
      let providerThrew = false;
      try {
        providerResult = await originalExecute(toolCallId, providerParams, signal, onUpdate, ctx);
      } catch {
        // Legacy behavior remains bounded and provider-local failures are not
        // public managed diagnostics.
        providerThrew = true;
      }
      const providerText = Array.isArray(providerResult?.content)
        ? providerResult.content
            .filter((item: any) => item && item.type === "text")
            .map((item: any) => item.text)
            .join("\n")
        : "";
      providerUnavailable =
        providerThrew ||
        providerResult?.isError === true ||
        providerResult?.diagnosticCode === "pi_subagent_managed_execution_unavailable_live" ||
        providerText.includes("pi_subagent_managed_execution_unavailable_live") ||
        providerText.includes("Agent not found");
    }
    const providerText = Array.isArray(providerResult?.content)
      ? providerResult.content
          .filter((item: any) => item && item.type === "text")
          .map((item: any) => item.text)
          .join("\n")
      : "";
    providerUnavailable ||= providerResult?.isError === true;
    providerDiagnosticCode = isPiSubagentDiagnosticCode(providerResult?.diagnosticCode)
      ? providerResult.diagnosticCode
      : undefined;
    const diagnostics = Array.isArray(read.diagnostics) ? [...read.diagnostics] : [];
    if (providerUnavailable) diagnostics.push("pi_subagent_read_live_record_unavailable");
    const boundedProviderText = providerUnavailable ? "" : managedRoutingText(providerText);
    const output =
      toolName === "steer_subagent"
        ? `Execution ID: ${read.executionId}\nSteer state: ${providerUnavailable ? "unavailable-control" : "applied"}`
        : `${durableReadText({ ...read, diagnostics })}\n\nLive supplement:\n${boundedProviderText || "Unavailable."}`;
    return managedRoutingResult(
      output,
      {
        ...publicReadDetails({ ...read, diagnostics }),
        ...(providerUnavailable ? { control: "unavailable" } : {}),
      },
      providerUnavailable,
      providerUnavailable ? "pi_subagent_read_live_record_unavailable" : providerDiagnosticCode,
    );
  };
  return true;
}

/**
 * Bounded, redacted desktop bootstrap failure detail. Only closed-vocabulary
 * capability status, code, and missing labels reach the operator surface.
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
