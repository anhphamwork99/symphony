// FILE: reconciliation.ts
// Purpose: WP1 accounting reconciliation kernel (Decision 34 §"Reconciliation
// and acceptance implications", AC2). Validates the real Pi SessionStats
// semantics (input/output/cacheRead/cacheWrite/total), documents the
// reconciliation equation the runtime supports, and cross-checks the raw
// statistics against Synara's normalized projected snapshots. Missing or
// inconsistent accounting is an explicit measurement failure; this kernel
// only observes and validates — it never modifies accounting.
import type {
  CrossCheckResult,
  NormalizedTokenSnapshot,
  RawSessionStats,
  ReconciliationResult,
  ReconciliationRule,
  TurnCompletedUsagePayload,
} from "./types.ts";

/**
 * The reconciliation equation supported by the Pi runtime's accounting
 * semantics (Pi SDK `SessionStats.tokens`): the reported total is the sum of
 * input, cache read, cache write, and output tokens. This is the documented
 * runtime contract this harness validates; a successful reconciliation is one
 * demonstrated according to this equation. If provider semantics change, this
 * rule must be updated here and in the report before claiming AC2.
 */
export const PI_RECONCILIATION_RULE: ReconciliationRule = {
  equation: "total == input + cacheRead + cacheWrite + output",
  description:
    "Pi SDK SessionStats.tokens reports total as the arithmetic sum of input, cacheRead, cacheWrite, and output. The harness reconciles every measured turn against this documented equation and treats any mismatch as a measurement failure.",
};

export function isFiniteNonNegative(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function componentFailures(stats: RawSessionStats): readonly string[] {
  const failures: string[] = [];
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
    const value = stats[key];
    if (typeof value !== "number") {
      failures.push(`missing accounting component '${key}'`);
    } else if (!isFiniteNonNegative(value)) {
      failures.push(`accounting component '${key}' is negative or not finite`);
    }
  }
  return failures;
}

/** Validate one raw SessionStats record against the documented equation. */
export function reconcileSessionStats(stats: RawSessionStats): ReconciliationResult {
  const failures = [...componentFailures(stats)];
  if (failures.length === 0) {
    const expectedTotal = stats.input + stats.cacheRead + stats.cacheWrite + stats.output;
    if (stats.total !== expectedTotal) {
      failures.push(
        `inconsistent total: reported ${stats.total}, expected ${expectedTotal} per ${PI_RECONCILIATION_RULE.equation}`,
      );
    }
  }
  return {
    ok: failures.length === 0,
    equation: PI_RECONCILIATION_RULE.equation,
    failures,
  };
}

/**
 * Cross-check the raw SessionStats against Synara's normalized projected
 * snapshot (`thread.token-usage.updated` → `context-window.updated` activity).
 * An absent normalized snapshot is acceptable only when the raw record is all
 * zeros (no usage activity was projected); otherwise its absence is a
 * measurement failure (loss of the original statistics between Pi and Synara).
 */
export function reconcileRawVsNormalized(
  raw: RawSessionStats,
  normalized: NormalizedTokenSnapshot | undefined,
): CrossCheckResult {
  const failures: string[] = [];
  if (normalized === undefined) {
    if (
      raw.total > 0 ||
      raw.input > 0 ||
      raw.output > 0 ||
      raw.cacheRead > 0 ||
      raw.cacheWrite > 0
    ) {
      failures.push(
        "normalized snapshot missing for a turn with nonzero raw usage (loss of statistics between Pi and Synara)",
      );
    }
    return { ok: failures.length === 0, failures };
  }
  const checks: ReadonlyArray<readonly [string, number | undefined, number, string]> = [
    ["inputTokens", normalized.inputTokens, raw.input, "input"],
    ["cachedInputTokens", normalized.cachedInputTokens, raw.cacheRead, "cacheRead"],
    ["outputTokens", normalized.outputTokens, raw.output, "output"],
    ["totalProcessedTokens", normalized.totalProcessedTokens, raw.total, "total"],
  ];
  for (const [normalizedKey, normalizedValue, rawValue, rawKey] of checks) {
    if (normalizedValue === undefined) {
      continue;
    }
    if (normalizedValue !== rawValue) {
      failures.push(
        `normalized '${normalizedKey}' (${normalizedValue}) disagrees with raw '${rawKey}' (${rawValue})`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readTokenComponents(value: unknown): RawSessionStats | undefined {
  if (!isRecord(value)) return undefined;
  const tokens = value.tokens;
  if (!isRecord(tokens)) return undefined;
  const input = tokens.input;
  const output = tokens.output;
  const cacheRead = tokens.cacheRead;
  const cacheWrite = tokens.cacheWrite;
  const total = tokens.total;
  if (
    typeof input !== "number" ||
    typeof output !== "number" ||
    typeof cacheRead !== "number" ||
    typeof cacheWrite !== "number" ||
    typeof total !== "number"
  ) {
    return undefined;
  }
  const cost = typeof value.cost === "number" ? value.cost : undefined;
  return { input, output, cacheRead, cacheWrite, total, ...(cost === undefined ? {} : { cost }) };
}

/**
 * Extract the raw SessionStats from a `turn.completed` provider event payload
 * (the Pi adapter preserves the raw stats in `payload.usage`). Missing or
 * malformed usage is an explicit failure, never silently ignored.
 */
export function extractTurnCompletedUsage(
  payload: Record<string, unknown>,
):
  | { readonly ok: true; readonly value: TurnCompletedUsagePayload }
  | { readonly ok: false; readonly failures: readonly string[] } {
  const failures: string[] = [];
  const state = payload.state;
  if (typeof state !== "string") {
    failures.push("turn.completed payload missing 'state'");
  }
  const stopReasonRaw = payload.stopReason;
  let stopReason: string | null = null;
  if (stopReasonRaw !== undefined && stopReasonRaw !== null) {
    if (typeof stopReasonRaw === "string") {
      stopReason = stopReasonRaw;
    } else {
      failures.push("turn.completed payload has a malformed 'stopReason'");
    }
  }
  const usage = readTokenComponents(payload.usage);
  if (usage === undefined) {
    failures.push("turn.completed payload missing or malformed raw 'usage' (SessionStats)");
  }
  if (failures.length > 0 || usage === undefined) {
    return { ok: false, failures };
  }
  const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : undefined;
  return {
    ok: true,
    value: {
      state: state as string,
      stopReason,
      usage,
      ...(errorMessage === undefined ? {} : { errorMessage }),
    },
  };
}
