// FILE: records.ts
// Purpose: WP2 record/report kernel (Decision 34 §1/§4). Builds per-turn and
// per-repetition records, paired deltas, spread/variance summaries, and the
// insufficient-evidence logic. Every repetition stays visible — invalid runs
// are never dropped, and no numeric variance threshold is invented: variance
// is reported, and run-set sufficiency covers required repetitions,
// accounting/reconciliation, catalog completeness, and config equivalence
// only. The Decision 34 direction-consistency rule (a claimed direction must
// hold across valid paired repetitions) feeds the non-binding recommendation,
// not the run-set sufficiency gate; per-repetition component sign agreement in
// paired deltas stays descriptive data.
import { PI_RECONCILIATION_RULE, reconcileRawVsNormalized, reconcileSessionStats } from "./reconciliation.ts";
import type {
  ComponentSummary,
  EvidenceVerdict,
  NormalizedTokenSnapshot,
  PairedDelta,
  RawSessionStats,
  RawTokenComponents,
  Recommendation,
  RepetitionRecord,
  RunSetConfig,
  RunSetSummary,
  TurnMeasurement,
} from "./types.ts";

export class RunSetAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunSetAnalysisError";
  }
}

export function computeTurnDelta(
  before: RawSessionStats,
  after: RawSessionStats,
): RawTokenComponents {
  return {
    input: after.input - before.input,
    output: after.output - before.output,
    cacheRead: after.cacheRead - before.cacheRead,
    cacheWrite: after.cacheWrite - before.cacheWrite,
    total: after.total - before.total,
  };
}

export interface TurnMeasurementInput {
  readonly turnIndex: number;
  readonly before: RawSessionStats;
  readonly after: RawSessionStats;
  readonly normalized?: NormalizedTokenSnapshot;
  readonly invalidReason?: string;
  /**
   * True when no Synara projection surface exists for this turn (the
   * standalone driver observes raw SessionStats directly). The raw-vs-
   * normalized cross-check exists to detect loss of the original statistics
   * between Pi and Synara, so it does not apply to standalone turns.
   */
  readonly skipCrossCheck?: boolean;
}

export function makeTurnMeasurement(input: TurnMeasurementInput): TurnMeasurement {
  const reconcile = reconcileSessionStats(input.after);
  const crossCheck = input.skipCrossCheck === true
    ? { ok: true as const, failures: [] as readonly string[] }
    : reconcileRawVsNormalized(input.after, input.normalized);
  const invalidReasons: string[] = [];
  if (!reconcile.ok) invalidReasons.push(`reconciliation: ${reconcile.failures.join("; ")}`);
  if (!crossCheck.ok) invalidReasons.push(`cross-check: ${crossCheck.failures.join("; ")}`);
  if (input.invalidReason !== undefined) invalidReasons.push(input.invalidReason);
  return {
    turnIndex: input.turnIndex,
    raw: input.after,
    normalized: input.normalized,
    invalid: invalidReasons.length > 0,
    ...(invalidReasons.length > 0 ? { invalidReason: invalidReasons.join(" | ") } : {}),
    before: input.before,
    delta: computeTurnDelta(input.before, input.after),
    reconcileOk: reconcile.ok,
    reconcileFailures: reconcile.failures,
    crossCheckOk: crossCheck.ok,
    crossCheckFailures: crossCheck.failures,
  };
}

function directionOf(value: number): "positive" | "negative" | "zero" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "zero";
}

/**
 * Paired delta between turn 2 and turn 1 of one repetition (same fresh
 * session, same catalog). A repetition must have exactly two turns; anything
 * else makes the pair unanalyzable (explicit error, never silent).
 */
export function computePairedDeltas(repetitions: readonly RepetitionRecord[]): PairedDelta[] {
  const deltas: PairedDelta[] = [];
  for (const repetition of repetitions) {
    if (repetition.turns.length !== 2) {
      throw new RunSetAnalysisError(
        `Repetition ${repetition.mode}/${repetition.repetitionIndex} has ${repetition.turns.length} turns; exactly two valid turns are required for a paired delta.`,
      );
    }
    const first = repetition.turns[0]!.delta;
    const second = repetition.turns[1]!.delta;
    const components: RawTokenComponents = {
      input: second.input - first.input,
      output: second.output - first.output,
      cacheRead: second.cacheRead - first.cacheRead,
      cacheWrite: second.cacheWrite - first.cacheWrite,
      total: second.total - first.total,
    };
    const nonZeroDirections = Object.values(components)
      .map(directionOf)
      .filter((direction) => direction !== "zero");
    // Descriptive only: sign agreement across accounting components within one
    // pair. A cache component may fall while the total rises without
    // invalidating accounting or repeatability, so this never gates run-set
    // sufficiency — the claimed comparative direction is checked across valid
    // pairs at the recommendation level (Decision 34 §1).
    const consistentDirection =
      nonZeroDirections.length === 0 ||
      nonZeroDirections.every((direction) => direction === nonZeroDirections[0]);
    deltas.push({
      mode: repetition.mode,
      repetitionIndex: repetition.repetitionIndex,
      ...components,
      consistentDirection,
    });
  }
  return deltas;
}

export function componentSummary(values: readonly number[]): ComponentSummary {
  if (values.length === 0) {
    return {
      values: [],
      mean: 0,
      min: 0,
      max: 0,
      range: 0,
      sampleVariance: 0,
      sampleStdDev: 0,
    };
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sampleVariance =
    values.length > 1
      ? values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / (values.length - 1)
      : 0;
  return {
    values: [...values],
    mean,
    min,
    max,
    range: max - min,
    sampleVariance,
    sampleStdDev: Math.sqrt(sampleVariance),
  };
}

export function buildRunSetSummary(input: {
  readonly mode: RunSetConfig["mode"];
  readonly repetitions: readonly RepetitionRecord[];
}): RunSetSummary {
  const validRepetitions = input.repetitions.filter((repetition) => !repetition.invalid);
  const invalidRepetitions = input.repetitions.filter((repetition) => repetition.invalid);
  const pairedDeltas = computePairedDeltas(validRepetitions);
  const componentKeys = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
  const components = Object.fromEntries(
    componentKeys.map((key) => [
      key,
      componentSummary(pairedDeltas.map((delta) => delta[key])),
    ]),
  ) as RunSetSummary["components"];
  return {
    mode: input.mode,
    validRepetitions,
    invalidRepetitions,
    pairedDeltas,
    components,
  };
}

function configEquivalent(records: readonly RepetitionRecord[]): readonly string[] {
  const failures: string[] = [];
  const first = records[0];
  if (first === undefined) return failures;
  for (const record of records.slice(1)) {
    if (record.config.model !== first.config.model) {
      failures.push("model differs between repetitions");
    }
    if (record.config.thinkingLevel !== first.config.thinkingLevel) {
      failures.push("thinking level differs between repetitions");
    }
    if (record.config.promptHash !== first.config.promptHash) {
      failures.push("prompt hash differs between repetitions");
    }
    if (record.config.promptBytes !== first.config.promptBytes) {
      failures.push("prompt byte length differs between repetitions");
    }
    if (record.config.agentDir !== first.config.agentDir) {
      failures.push("agent directory differs between repetitions");
    }
    if (record.manifest.method !== first.manifest.method) {
      failures.push("manifest extraction method differs between repetitions");
    }
  }
  return failures;
}

/**
 * Decision 34 §1 insufficient-evidence logic. A run set is insufficient when
 * any required accounting component is missing, component reconciliation
 * fails, required equivalent repetitions cannot be completed, configuration
 * equivalence cannot be established, or the catalog capture is incomplete.
 * Directional consistency is deliberately not a run-set gate: the Decision 34
 * rule applies to the claimed comparative ordering across modes/repetitions,
 * not to the signs of different accounting components within one turn-to-turn
 * delta (a cache component may fall while the total rises without
 * invalidating accounting, repeatability, or evidence). Comparative direction
 * is evaluated across valid paired repetitions at the recommendation level
 * (orchestrator comparisonDirection → makeRecommendation), which reports
 * inconclusive when the direction changes between valid pairs. This never
 * invents a numeric threshold.
 */
export function evaluateEvidence(
  config: RunSetConfig,
  validRepetitions: readonly RepetitionRecord[],
): EvidenceVerdict {
  const reasons: string[] = [];
  if (validRepetitions.length < config.repetitions) {
    reasons.push("incomplete-repetitions");
  }
  for (const record of validRepetitions) {
    for (const turn of record.turns) {
      if (turn.reconcileFailures.some((failure) => failure.includes("missing accounting"))) {
        reasons.push("missing-accounting-component");
        break;
      }
      if (!turn.reconcileOk) {
        reasons.push("reconciliation-failure");
        break;
      }
      if (!turn.crossCheckOk) {
        reasons.push("reconciliation-failure");
        break;
      }
    }
    if (!record.manifest.catalogComplete) {
      reasons.push("incomplete-catalog");
    }
  }
  const equivalenceFailures = configEquivalent(validRepetitions);
  if (equivalenceFailures.length > 0) {
    reasons.push("config-inequivalence");
  }
  // Pair count for reporting only; component deltas and variance stay
  // descriptive data (buildRunSetSummary). Direction consistency is not a
  // sufficiency condition here (see doc comment above).
  const pairedDeltas = computePairedDeltas(validRepetitions);
  const uniqueReasons = [...new Set(reasons)];
  return {
    insufficientEvidence: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    validPairCount: pairedDeltas.length,
    requiredPairCount: config.repetitions,
  };
}

export interface RecommendationInput {
  readonly consistentDirection: boolean;
  readonly component: string;
  readonly pairedCount: number;
  readonly direction: "positive" | "negative" | "mixed" | "none";
}

/**
 * Non-binding recommendation (Decision 34 §1). A directional recommendation
 * requires the claimed ordering or direction to hold across all valid paired
 * repetitions; otherwise the result is inconclusive/insufficient for that
 * recommendation. No numeric budget is created.
 */
export function makeRecommendation(input: RecommendationInput): Recommendation {
  const { consistentDirection, component, pairedCount, direction } = input;
  if (!consistentDirection || pairedCount === 0 || direction === "mixed" || direction === "none") {
    return {
      kind: "inconclusive",
      rationale:
        `Direction for '${component}' was not consistent across valid paired repetitions ` +
        `(${pairedCount} valid pairs); the evidence is inconclusive for a recommendation.`,
      consistentDirection: false,
    };
  }
  if (direction === "positive") {
    return {
      kind: "supports-investigation",
      rationale:
        `Every valid paired repetition showed the same positive direction for '${component}' ` +
        `(${pairedCount} pairs); the evidence supports a non-binding investigation of compaction ` +
        `or artifact-backed output. This recommendation does not authorize that work.`,
      consistentDirection: true,
    };
  }
  return {
    kind: "does-not-support-investigation",
    rationale:
      `Every valid paired repetition showed the same non-positive direction for '${component}' ` +
      `(${pairedCount} pairs); the evidence does not support a separate investigation of ` +
      `compaction or artifact-backed output at this time.`,
    consistentDirection: true,
  };
}

export const REPORT_RECONCILIATION_RULE = PI_RECONCILIATION_RULE;
