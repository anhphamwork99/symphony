// FILE: piSubagentDesktopArtifactGate.ts
// Purpose: Pure managed-artifact early gate for the desktop runtime mode —
// the shared denial point that must run before any Pi SDK import,
// makeAgentDir()/global agent-directory discovery, or durable subagent side
// effect (Ticket 01 / T01-AC3, Decision 0004 §4-§6). A VALID desktop
// verification now returns the trusted controlled-runtime binding (Ticket 02
// WP1 / Decision 0003): the controlled `agentDir` `<verified-root>/agent` plus
// bounded trusted metadata, and nothing else.
// Local web/dev path (dev-runner prepared cache): a WEB-mode server started
// with a NON-EMPTY locator is verified exactly like desktop and receives the
// same trusted managed binding, while a WEB-mode server WITHOUT a locator
// keeps the historical pass-through unchanged (no verifier call). Desktop is
// unchanged.
// Layer: Server provider seam (pure decision function — no PiAdapter wiring).
// Depends: the Ticket 01 production verifier contract only. This module must
// never import Pi SDK modules, touch Git or the network, read user Pi files,
// or create side effects; it consumes an injectable env map and an
// injectable verifier seam.
// Exports: the gate decision function and its result types.

import path from "node:path";

import type { RuntimeMode } from "../config.ts";
import type { PiSubagentArtifactVerificationCategory } from "@synara/contracts";
import {
  verifyPiSubagentArtifact,
  type PiSubagentArtifactVerification,
  type PiSubagentArtifactVerifiedMetadata,
} from "./piSubagentArtifactVerifier.ts";

/**
 * Env var carrying the release-derived managed Pi artifact locator
 * (Decision 0004 §1 — desktop main process supplies exactly one
 * release-derived value; never renderer/request/inherited input).
 *
 * For the local web/dev path the dev runner supplies exactly one value: the
 * pin-keyed verified cache entry under the resolved SYNARA_HOME. The same
 * rule holds — the locator is launcher-derived, never renderer/request or
 * arbitrary user input.
 */
export const SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV = "SYNARA_PI_SUBAGENT_ARTIFACT_DIR";

/**
 * Controlled sub-directory INSIDE the verified artifact root that becomes
 * the desktop managed Pi `agentDir` (Ticket 02 / Decision 0003): the staged
 * artifact places the extension tree at `agent/extensions/...`, so the
 * controlled agent directory is `<verified-root>/agent` — never the artifact
 * root itself and never a user/request-supplied directory.
 */
export const PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT = "agent";

/**
 * Closed failure-reason vocabulary for the gate. `locator_missing` is
 * produced by the gate itself (desktop without a locator); every other
 * reason is the verifier's closed `PiSubagentArtifactVerificationCategory`
 * (AC2).
 */
export type PiSubagentDesktopArtifactGateUnavailableReason =
  | "locator_missing"
  | PiSubagentArtifactVerificationCategory;

/**
 * Pass outcome — non-desktop modes only (AC5). Carries no metadata and no
 * diagnostic surface.
 */
export interface PiSubagentDesktopArtifactGatePass {
  readonly kind: "pass";
}

/**
 * Trusted controlled-runtime binding a VALID desktop verification now
 * supplies (Ticket 02 / Decision 0004 §6-§7). `agentDir` is the controlled
 * `<verified-root>/agent` directory the desktop managed session must use for
 * extension discovery; `metadata` is the verifier's already-validated
 * bounded trusted metadata (never a diagnostic surface). It contains no
 * absolute user paths and no credential/model material.
 */
export interface PiSubagentDesktopArtifactGateManagedBinding {
  readonly agentDir: string;
  readonly metadata: PiSubagentArtifactVerifiedMetadata;
}

/**
 * Pass outcome for desktop with a verified artifact — the only shape that
 * may unlock the desktop managed bootstrap (Ticket 02 WP1).
 */
export interface PiSubagentDesktopArtifactGateManagedPass {
  readonly kind: "pass";
  readonly managed: PiSubagentDesktopArtifactGateManagedBinding;
}

/**
 * Unavailable outcome — the fail-closed denial every desktop path must
 * observe before Pi import/discovery (T01-AC3, Decision 0004 §5).
 *
 * `detail` is stable and bounded: a short fixed diagnostic line built from
 * the reason and, when present, the verifier's already-normalized RELATIVE
 * entry label. It never contains an absolute root path, a raw filesystem
 * error, a stack trace, or any other environment-derived string.
 */
export interface PiSubagentDesktopArtifactGateUnavailable {
  readonly kind: "unavailable";
  readonly reason: PiSubagentDesktopArtifactGateUnavailableReason;
  readonly detail: string;
}

export type PiSubagentDesktopArtifactGateResult =
  | PiSubagentDesktopArtifactGatePass
  | PiSubagentDesktopArtifactGateManagedPass
  | PiSubagentDesktopArtifactGateUnavailable;

/** Injectable verifier seam (deterministic tests; default = production). */
export type PiSubagentArtifactVerifier = (root: string) => Promise<PiSubagentArtifactVerification>;

export interface EvaluatePiSubagentDesktopArtifactGateOptions {
  /** Env map read for the locator (tests inject a plain object). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Verifier override (tests count calls / fix outcomes). */
  readonly verify?: PiSubagentArtifactVerifier | undefined;
}

const DEFAULT_VERIFY: PiSubagentArtifactVerifier = (root) => verifyPiSubagentArtifact(root);

/** Fixed detail strings — identical for every environment and input. */
const DETAIL_LOCATOR_MISSING = "managed pi artifact locator is absent or blank";
const DETAIL_ARTIFACT_INVALID_PREFIX = "managed pi artifact verification failed: ";

/**
 * Bounded safe detail for an invalid artifact: category + optional
 * manifest-normalized RELATIVE entry label only.
 *
 * Defense-in-depth: the label is included ONLY if it is itself a
 * normalized relative path shape (trimmed, ≤ the contract's 1 024-char
 * path bound, no absolute/backslash/`..`/control-character content). A
 * hostile or future-divergent label that fails that shape check is
 * dropped entirely, so the detail can never carry an absolute root path,
 * a raw filesystem error string, or a stack fragment. The total detail is
 * clamped to a fixed bound regardless.
 */
const isSafeRelativeEntryLabel = (label: string): boolean => {
  if (label === "" || label !== label.trim() || label.length > 1_024) return false;
  if (label.includes("\\") || label.includes("\0")) return false;
  if (label.startsWith("/") || label.endsWith("/")) return false;
  for (const char of label) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  const segments = label.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." && segment === segment.trim(),
  );
};

const invalidDetail = (
  category: PiSubagentArtifactVerificationCategory,
  entry?: string | undefined,
): string => {
  const label = entry !== undefined && isSafeRelativeEntryLabel(entry) ? ` (entry: ${entry})` : "";
  return `${DETAIL_ARTIFACT_INVALID_PREFIX}${category}${label}`.slice(0, 512);
};

/**
 * Pure gate evaluation.
 *
 * Deterministic decision order (Decision 0004 §4-§6; local web/dev path):
 *  1. Absent/blank locator → desktop fails closed with `locator_missing`
 *     WITHOUT invoking the verifier; every other mode passes through
 *     unchanged (no verifier call) — the historical non-desktop behavior.
 *  2. ANY mode with a NON-BLANK locator → evaluate it with the shared
 *     verifier. This covers desktop (always required) and the local
 *     web/dev path whose dev runner forwarded the pin-keyed verified cache
 *     locator. An invalid result → unavailable carrying the verifier's
 *     closed category verbatim plus a safe bounded detail (AC2).
 *  3. Valid artifact → PASS carrying the trusted controlled-runtime binding:
 *     the controlled `agentDir` is exactly `<verified-root>/agent` (the
 *     staged `agent/extensions/...` layout), plus the verifier's trusted
 *     metadata. A gated mode never falls back to unmanaged discovery
 *     (Decision 0002 / 0004 §6-§7); the consumer must still complete the
 *     managed bootstrap (controlled runtime, artifact-only extensions,
 *     mandatory 7-capability handshake) before publishing a managed session.
 *
 * The function is side-effect free and never throws for control flow: the
 * injected verifier is expected to return its closed result union rather
 * than reject, mirroring `verifyPiSubagentArtifact`.
 */
export async function evaluatePiSubagentDesktopArtifactGate(
  mode: RuntimeMode,
  options: EvaluatePiSubagentDesktopArtifactGateOptions,
): Promise<PiSubagentDesktopArtifactGateResult> {
  const rawLocator = options.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
  const locator = rawLocator?.trim() ?? "";
  if (locator === "") {
    // Desktop without a launcher-derived locator: nothing release-derived
    // to verify — fail closed without invoking the verifier. (A web/dev
    // server without a locator passed through above, unchanged.)
    if (mode === "desktop") {
      return { kind: "unavailable", reason: "locator_missing", detail: DETAIL_LOCATOR_MISSING };
    }
    return { kind: "pass" };
  }

  const verify = options.verify ?? DEFAULT_VERIFY;
  const verification = await verify(locator);
  if (!verification.valid) {
    return {
      kind: "unavailable",
      reason: verification.category,
      detail: invalidDetail(verification.category, verification.entry),
    };
  }
  return {
    kind: "pass",
    managed: {
      agentDir: path.join(locator, PI_SUBAGENT_DESKTOP_MANAGED_AGENT_DIR_SEGMENT),
      metadata: verification.metadata,
    },
  };
}
