// FILE: types.ts
// Purpose: Shared value types for the impl-11 token-overhead measurement
// harness (Decision 34). These are plain data shapes used by the pure
// kernels (reconciliation, records/report) and by the real-run drivers.
// No runtime logic lives here.

export type MeasurementMode = "standalone" | "synara-default" | "synara-activated";

export const MEASUREMENT_MODES: readonly MeasurementMode[] = [
  "standalone",
  "synara-default",
  "synara-activated",
];

/** The five SessionStats components Decision 34 requires to be preserved raw. */
export interface RawTokenComponents {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

/** Raw turn accounting as reported by the Pi runtime (`SessionStats.tokens`). */
export interface RawSessionStats extends RawTokenComponents {
  /** Present when the runtime reported it; missing is a measurement failure. */
  readonly cost?: number;
}

/** Parsed shape of the raw `usage` carried by a `turn.completed` provider event. */
export interface TurnCompletedUsagePayload {
  readonly state: string;
  readonly stopReason: string | null;
  readonly usage: RawSessionStats;
  readonly errorMessage?: string;
}

/** Synara's normalized token snapshot projected from `thread.token-usage.updated`. */
export interface NormalizedTokenSnapshot {
  readonly usedTokens: number;
  readonly usedPercent?: number;
  readonly totalProcessedTokens?: number;
  readonly maxTokens?: number;
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens?: number;
  readonly lastUsedTokens?: number;
  readonly lastInputTokens?: number;
  readonly lastCachedInputTokens?: number;
  readonly lastOutputTokens?: number;
}

/** One tool's effective schema surface used for canonical manifest bytes. */
export interface CanonicalToolEntry {
  readonly name: string;
  readonly description: string;
  /** JSON value of the parameter schema (TypeBox JSON schema for Pi tools). */
  readonly parameters: unknown;
  readonly promptGuidelines?: readonly string[];
}

/** Deterministic canonical manifest summary (committed surface, no schemas). */
export interface CanonicalManifestSummary {
  readonly toolNames: readonly string[];
  readonly toolCount: number;
  /** Byte length of the canonical serialized manifest (full schemas). */
  readonly canonicalBytes: number;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
  readonly method: string;
  /** True when the local full-manifest capture was produced successfully. */
  readonly localCaptureProduced: boolean;
  /** False when the effective catalog could not be fully captured (fail-closed). */
  readonly catalogComplete: boolean;
  readonly catalogIncompleteReason?: string;
}

export interface ManifestCaptureInput {
  readonly tools: readonly CanonicalToolEntry[];
  readonly localCaptureProduced: boolean;
  readonly catalogComplete: boolean;
  readonly catalogIncompleteReason?: string;
}

/** Per-turn measured accounting for one repetition. */
export interface TurnMeasurement {
  readonly turnIndex: number;
  readonly raw: RawSessionStats;
  readonly normalized: NormalizedTokenSnapshot | undefined;
  readonly invalid: boolean;
  readonly invalidReason?: string;
  /** Raw stats immediately before this turn (startup stats for turn 1). */
  readonly before: RawSessionStats;
  /** Per-component delta (after - before). */
  readonly delta: RawTokenComponents;
  readonly reconcileOk: boolean;
  readonly reconcileFailures: readonly string[];
  readonly crossCheckOk: boolean;
  readonly crossCheckFailures: readonly string[];
}

export interface RepetitionRecord {
  readonly mode: MeasurementMode;
  readonly repetitionIndex: number;
  readonly manifest: CanonicalManifestSummary;
  readonly startup: RawSessionStats;
  readonly turns: readonly TurnMeasurement[];
  readonly invalid: boolean;
  readonly invalidReason?: string;
  /** Real activation/exposure evidence observed over the isolated server WS API. */
  readonly exposureEvidence: ExposureEvidence;
  readonly config: ConfigEvidence;
}

export interface ConfigEvidence {
  readonly model: string;
  readonly thinkingLevel: string;
  readonly promptHash: string;
  readonly promptBytes: number;
  readonly workspaceCwd: string;
  readonly agentDir: string;
  readonly harnessVersion: string;
}

/** Real-runtime exposure evidence distinguishing dormant default from activated mode. */
export interface ExposureEvidence {
  readonly mode: MeasurementMode;
  /** Observed project Synara MCP desired state ("disabled"/"enabled"/"absent"). */
  readonly projectSynaraMcpDesiredState: string | null;
  /** True when the enable command reached its succeeded terminal activity. */
  readonly activationSucceeded: boolean;
  /** True when no synara MCP command activities were observed (dormant proof). */
  readonly dormantObserved: boolean;
  /** Terminal activity detail observed for the enable command, when any. */
  readonly activationDetail?: string;
  /** Sanitized failure record for this repetition's lifecycle, when any. */
  readonly lifecycleFailures: readonly string[];
}

export interface RunSetConfig {
  readonly mode: MeasurementMode;
  readonly repetitions: number;
  readonly turnsPerRepetition: number;
  readonly model: string | undefined;
  readonly thinkingLevel: string;
  readonly promptHash: string;
  readonly promptBytes: number;
  readonly harnessVersion: string;
}

export interface ReconciliationRule {
  readonly equation: string;
  readonly description: string;
}

export interface ReconciliationResult {
  readonly ok: boolean;
  readonly equation: string;
  readonly failures: readonly string[];
}

export interface CrossCheckResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export interface PairedDelta {
  readonly mode: MeasurementMode;
  readonly repetitionIndex: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  /** Consistent direction for every non-zero component (turn2 - turn1). */
  readonly consistentDirection: boolean;
}

export interface ComponentSummary {
  readonly values: readonly number[];
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly range: number;
  readonly sampleVariance: number;
  readonly sampleStdDev: number;
}

export interface RunSetSummary {
  readonly mode: MeasurementMode;
  readonly validRepetitions: readonly RepetitionRecord[];
  readonly invalidRepetitions: readonly RepetitionRecord[];
  readonly pairedDeltas: readonly PairedDelta[];
  readonly components: Record<
    "input" | "output" | "cacheRead" | "cacheWrite" | "total",
    ComponentSummary
  >;
}

export interface EvidenceVerdict {
  readonly insufficientEvidence: boolean;
  readonly reasons: readonly string[];
  readonly validPairCount: number;
  readonly requiredPairCount: number;
}

export interface Recommendation {
  readonly kind: "supports-investigation" | "does-not-support-investigation" | "inconclusive";
  readonly rationale: string;
  readonly consistentDirection: boolean;
}

export interface Conclusion {
  readonly measuredFacts: readonly string[];
  readonly limitations: readonly string[];
  readonly recommendation: Recommendation;
}

export interface ReportRunSet {
  readonly config: RunSetConfig;
  readonly repetitions: readonly RepetitionRecord[];
  readonly summary: RunSetSummary;
  readonly evidence: EvidenceVerdict;
  readonly catalog: {
    readonly toolNamesByRepetition: readonly (readonly string[])[];
    readonly toolCounts: readonly number[];
    readonly canonicalByteCounts: readonly number[];
    readonly hashes: readonly string[];
    readonly methods: readonly string[];
  };
}

export interface MeasurementReport {
  readonly reportVersion: 1;
  readonly harnessVersion: string;
  readonly createdAt: string;
  readonly git: {
    readonly commit: string;
    readonly branch: string;
    readonly dirty: boolean;
    readonly diffHash?: string;
  };
  readonly environment: {
    readonly bun: string;
    readonly platform: NodeJS.Platform;
    readonly arch: string;
    readonly serverPort: number | null;
  };
  readonly prompt: {
    readonly text: string;
    readonly bytes: number;
    readonly hash: string;
  };
  readonly config: {
    readonly repetitions: number;
    readonly turnsPerRepetition: number;
    readonly model: string | undefined;
    readonly thinkingLevel: string;
    readonly agentDir: string;
    readonly localManifestDir: string | null;
  };
  readonly runSets: Record<MeasurementMode, ReportRunSet | null>;
  readonly conclusions: Conclusion;
  readonly reconciliation: {
    readonly equation: string;
    readonly description: string;
  };
}
