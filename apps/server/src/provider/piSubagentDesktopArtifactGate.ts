// FILE: piSubagentDesktopArtifactGate.ts
// Purpose: Pure managed-artifact early gate for the desktop runtime mode —
// the shared denial point that must run before any Pi SDK import,
// makeAgentDir()/global agent-directory discovery, or durable subagent side
// effect (Ticket 01 / T01-AC3, Decision 0004 §4-§6).
// Layer: Server provider seam (pure decision function — no PiAdapter wiring).
// Depends: the Ticket 01 production verifier contract only. This module must
// never import Pi SDK modules, touch Git or the network, read user Pi files,
// or create side effects; it consumes an injectable env map and an
// injectable verifier seam.
// Exports: the gate decision function and its result types.

import type { RuntimeMode } from "../config.ts";
import type { PiSubagentArtifactVerificationCategory } from "@synara/contracts";
import {
  verifyPiSubagentArtifact,
  type PiSubagentArtifactVerification,
} from "./piSubagentArtifactVerifier.ts";

/**
 * Env var carrying the release-derived managed Pi artifact locator
 * (Decision 0004 §1 — desktop main process supplies exactly one
 * release-derived value; never renderer/request/inherited input).
 */
export const SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV = "SYNARA_PI_SUBAGENT_ARTIFACT_DIR";

/**
 * Ticket 02 boundary (Decision 0004 §6): a verified artifact alone does not
 * create a usable controlled Pi runtime. Until Ticket 02 supplies the
 * explicit controlled-runtime binding, a valid artifact is still
 * managed-subagent-unavailable — never a legacy/unmanaged fallback.
 */
export const PI_SUBAGENT_MANAGED_RUNTIME_UNAVAILABLE_REASON = "managed_runtime_binding_unavailable";

/**
 * Closed failure-reason vocabulary for the gate. `locator_missing` is
 * produced by the gate itself; every other reason is the verifier's closed
 * `PiSubagentArtifactVerificationCategory` (AC2) or the Ticket 02 boundary
 * marker.
 */
export type PiSubagentDesktopArtifactGateUnavailableReason =
  | "locator_missing"
  | "managed_runtime_binding_unavailable"
  | PiSubagentArtifactVerificationCategory;

/**
 * Pass outcome — non-desktop modes only (AC5). Carries no metadata and no
 * diagnostic surface.
 */
export interface PiSubagentDesktopArtifactGatePass {
  readonly kind: "pass";
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
const DETAIL_MANAGED_RUNTIME_UNAVAILABLE =
  "managed pi runtime binding is not available in this build";
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
 * Deterministic decision order (Decision 0004 §4-§6):
 *  1. `mode !== "desktop"` → pass WITHOUT invoking the verifier (AC5:
 *     non-desktop behavior is outside this rollout and unchanged).
 *  2. Desktop with absent/blank locator → unavailable `locator_missing`
 *     WITHOUT invoking the verifier (nothing release-derived to verify).
 *  3. Desktop locator present → evaluate it with the shared verifier.
 *     invalid result → unavailable carrying the verifier's closed category
 *     verbatim plus a safe bounded detail (AC2).
 *  4. Valid artifact → STILL unavailable
 *     `managed_runtime_binding_unavailable`: Ticket 02 has not built the
 *     controlled runtime, and desktop never falls back to unmanaged
 *     discovery (Decision 0002 / 0004 §6).
 *
 * The function is side-effect free and never throws for control flow: the
 * injected verifier is expected to return its closed result union rather
 * than reject, mirroring `verifyPiSubagentArtifact`.
 */
export async function evaluatePiSubagentDesktopArtifactGate(
  mode: RuntimeMode,
  options: EvaluatePiSubagentDesktopArtifactGateOptions,
): Promise<PiSubagentDesktopArtifactGateResult> {
  if (mode !== "desktop") return { kind: "pass" };

  const rawLocator = options.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
  const locator = rawLocator?.trim() ?? "";
  if (locator === "") {
    return { kind: "unavailable", reason: "locator_missing", detail: DETAIL_LOCATOR_MISSING };
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
    kind: "unavailable",
    reason: PI_SUBAGENT_MANAGED_RUNTIME_UNAVAILABLE_REASON,
    detail: DETAIL_MANAGED_RUNTIME_UNAVAILABLE,
  };
}
