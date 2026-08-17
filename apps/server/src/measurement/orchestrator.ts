// FILE: orchestrator.ts
// Purpose: WP5 core — orchestrate the three modes, assemble the committed
// report (Decision 34 §1/§3/§4), compute the measured-facts conclusion and
// the non-binding recommendation, and decide the process exit status.
// The report surface never contains schemas, credentials, or raw sensitive
// paths — only names/count/bytes/hash/method plus accounting and metadata.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  buildRunSetSummary,
  evaluateEvidence,
  makeRecommendation,
  REPORT_RECONCILIATION_RULE,
} from "./records.ts";
import { sanitizePathForReport } from "./sanitize.ts";
import { runStandaloneMode, type StandaloneDriverOptions } from "./standaloneDriver.ts";
import { runSynaraMode, type SynaraDriverOptions } from "./synaraDriver.ts";
import { STIMULUS_HASH, STIMULUS_TEXT, stimulusByteLength } from "./stimulus.ts";
import type {
  Conclusion,
  MeasurementMode,
  MeasurementReport,
  Recommendation,
  ReportRunSet,
  RepetitionRecord,
  RunSetConfig,
} from "./types.ts";

export const HARNESS_VERSION = "1.0.0";

export interface OrchestratorOptions {
  readonly agentDir: string;
  readonly modelId: string;
  readonly thinkingLevel: string;
  readonly repetitions: number;
  readonly turnsPerRepetition: number;
  readonly localManifestDir: string | null;
  readonly modes: readonly MeasurementMode[];
  readonly serverPort?: number;
  /** Shared fixture digest proving byte-equivalent project/worktree input. */
  readonly fixtureDigest: string;
  /** Deterministic fixture repo HEAD (null when git is unavailable). */
  readonly fixtureGitCommit: string | null;
  /** Repo root used for the committed git metadata; defaults to process.cwd(). */
  readonly repoRoot?: string;
  readonly onDiagnostic?: (message: string) => void;
}

export interface OrchestratorResult {
  readonly report: MeasurementReport;
  readonly exitCode: 0 | 1 | 2;
  readonly insufficientModes: readonly MeasurementMode[];
}

interface GitMetadata {
  readonly commit: string;
  readonly branch: string;
  readonly dirty: boolean;
  readonly diffHash?: string;
}

function runGit(repoRoot: string, args: ReadonlyArray<string>): string | undefined {
  try {
    return (
      execFileSync("git", args, {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split("\n")[0] || undefined
    );
  } catch {
    return undefined;
  }
}

export function collectGitMetadata(repoRoot = process.cwd()): GitMetadata {
  const commit = runGit(repoRoot, ["rev-parse", "HEAD"]);
  const branch = runGit(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const diffStat = runGit(repoRoot, ["diff", "HEAD", "--stat"]);
  const dirty = diffStat !== undefined && diffStat.length > 0;
  let diffHash: string | undefined;
  if (dirty) {
    // Reproducibility identifier for the measured source state without
    // committing raw sensitive content (Decision 34 §5).
    const diff = runGit(repoRoot, ["diff", "HEAD"]);
    if (diff !== undefined) {
      diffHash = createHash("sha256").update(diff).digest("hex");
    }
  }
  return {
    commit: commit ?? "unknown",
    branch: branch ?? "unknown",
    dirty,
    ...(diffHash === undefined ? {} : { diffHash }),
  };
}

function runSetConfig(mode: MeasurementMode, options: OrchestratorOptions): RunSetConfig {
  return {
    mode,
    repetitions: options.repetitions,
    turnsPerRepetition: options.turnsPerRepetition,
    model: options.modelId,
    thinkingLevel: options.thinkingLevel,
    promptHash: STIMULUS_HASH,
    promptBytes: stimulusByteLength(),
    harnessVersion: HARNESS_VERSION,
  };
}

function buildReportRunSet(
  mode: MeasurementMode,
  repetitions: readonly RepetitionRecord[],
  options: OrchestratorOptions,
): ReportRunSet {
  const config = runSetConfig(mode, options);
  const summary = buildRunSetSummary({ mode, repetitions });
  const evidence = evaluateEvidence(config, summary.validRepetitions);
  const valid = summary.validRepetitions;
  return {
    config,
    repetitions,
    summary,
    evidence,
    catalog: {
      toolNamesByRepetition: repetitions.map((repetition) => repetition.manifest.toolNames),
      toolCounts: repetitions.map((repetition) => repetition.manifest.toolCount),
      canonicalByteCounts: repetitions.map((repetition) => repetition.manifest.canonicalBytes),
      hashes: repetitions.map((repetition) => repetition.manifest.hash),
      methods: repetitions.map((repetition) => repetition.manifest.method),
    },
  };
}

function comparisonDirection(
  options: OrchestratorOptions,
  runSets: Partial<Record<MeasurementMode, readonly RepetitionRecord[]>>,
): {
  readonly consistentDirection: boolean;
  readonly direction: "positive" | "negative" | "mixed" | "none";
  readonly pairedCount: number;
} {
  const standalone = runSets.standalone ?? [];
  const deltas: number[] = [];
  for (const mode of ["synara-default", "synara-activated"] as const) {
    const synara = runSets[mode] ?? [];
    for (let index = 0; index < options.repetitions; index += 1) {
      const standaloneRep = standalone.find((repetition) => repetition.repetitionIndex === index);
      const synaraRep = synara.find((repetition) => repetition.repetitionIndex === index);
      if (!standaloneRep || !synaraRep || standaloneRep.invalid || synaraRep.invalid) continue;
      const standaloneTurn = standaloneRep.turns[0];
      const synaraTurn = synaraRep.turns[0];
      if (!standaloneTurn || !synaraTurn) continue;
      deltas.push(synaraTurn.raw.total - standaloneTurn.raw.total);
    }
  }
  if (deltas.length === 0) {
    return { consistentDirection: false, direction: "none", pairedCount: 0 };
  }
  const positive = deltas.every((delta) => delta > 0);
  const nonPositive = deltas.every((delta) => delta <= 0);
  return {
    consistentDirection: positive || nonPositive,
    direction: positive ? "positive" : nonPositive ? "negative" : "mixed",
    pairedCount: deltas.length,
  };
}

function buildConclusion(
  options: OrchestratorOptions,
  runSets: Partial<Record<MeasurementMode, readonly RepetitionRecord[]>>,
  evidenceByMode: Partial<Record<MeasurementMode, boolean>>,
): Conclusion {
  const measuredFacts: string[] = [];
  const limitations: string[] = [];
  const direction = comparisonDirection(options, runSets);
  const recommendation: Recommendation = makeRecommendation({
    consistentDirection: direction.consistentDirection,
    component: "total (turn 1 cumulative, cold start)",
    pairedCount: direction.pairedCount,
    direction: direction.direction,
  });

  for (const mode of ["standalone", "synara-default", "synara-activated"] as const) {
    const repetitions = runSets[mode] ?? [];
    const valid = repetitions.filter((repetition) => !repetition.invalid);
    measuredFacts.push(
      `${mode}: ${valid.length}/${options.repetitions} valid repetitions; ` +
        `turn-1 total tokens ${valid.map((repetition) => repetition.turns[0]?.raw.total ?? "n/a").join(", ")}`,
    );
    if (evidenceByMode[mode]) {
      measuredFacts.push(
        `${mode}: evidence insufficient (${runSets[mode]?.length ?? 0} repetitions recorded)`,
      );
    }
  }
  if (options.modes.includes("synara-activated")) {
    limitations.push(
      "Activated-mode measured turns run after a real enable; the session-start bootstrap turn " +
        "(same stimulus, dormant catalog) is unmeasured and its raw accounting is reported in the " +
        "repetition startup field, so activated-mode turn-1 totals include the bootstrap session cost.",
    );
    limitations.push(
      "Activated-mode complete manifests are captured by the Decision 35 measurement-only observer " +
        "from the live session's authoritative getAllTools() surface and retained only inside the " +
        "harness-created isolated home; catalog completeness for every mode therefore depends on the " +
        "Pi SDK AgentSession.getAllTools() surface being the exact model-visible catalog " +
        "(Decision 35 residual uncertainty).",
    );
  }
  measuredFacts.push(
    `Reconciliation equation: ${REPORT_RECONCILIATION_RULE.equation} — every valid turn reconciled against it.`,
  );
  limitations.push(
    "Three repetitions are the operational minimum, not a claim of statistical power; variance is " +
      "reported raw and no numeric threshold is applied (Decision 34 §1/§4).",
  );

  return { measuredFacts, limitations, recommendation };
}

export async function runMeasurement(options: OrchestratorOptions): Promise<OrchestratorResult> {
  const runSets: Partial<Record<MeasurementMode, readonly RepetitionRecord[]>> = {};
  const diagnostics: string[] = [];
  const onDiagnostic = (message: string) => {
    diagnostics.push(message);
    options.onDiagnostic?.(message);
  };

  if (options.modes.includes("standalone")) {
    const standaloneOptions: StandaloneDriverOptions = {
      agentDir: options.agentDir,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      repetitions: options.repetitions,
      turnsPerRepetition: options.turnsPerRepetition,
      localManifestDir: options.localManifestDir,
      harnessVersion: HARNESS_VERSION,
      promptHash: STIMULUS_HASH,
      promptBytes: stimulusByteLength(),
      onDiagnostic,
    };
    const result = await runStandaloneMode(standaloneOptions);
    runSets.standalone = result.repetitions;
  }

  if (options.modes.includes("synara-default") || options.modes.includes("synara-activated")) {
    const sharedSynaraOptions = {
      agentDir: options.agentDir,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      repetitions: options.repetitions,
      turnsPerRepetition: options.turnsPerRepetition,
      localManifestDir: options.localManifestDir,
      harnessVersion: HARNESS_VERSION,
      promptHash: STIMULUS_HASH,
      promptBytes: stimulusByteLength(),
      ...(options.serverPort === undefined ? {} : { serverPort: options.serverPort }),
      onDiagnostic,
    };
    if (options.modes.includes("synara-default")) {
      const result = await runSynaraMode({
        ...sharedSynaraOptions,
        mode: "synara-default",
      } satisfies SynaraDriverOptions);
      runSets["synara-default"] = result.repetitions;
    }
    if (options.modes.includes("synara-activated")) {
      const result = await runSynaraMode({
        ...sharedSynaraOptions,
        mode: "synara-activated",
      } satisfies SynaraDriverOptions);
      runSets["synara-activated"] = result.repetitions;
    }
  }

  const evidenceByMode: Partial<Record<MeasurementMode, boolean>> = {};
  const insufficientModes: MeasurementMode[] = [];
  const runSetReports: Record<MeasurementMode, ReportRunSet | null> = {
    standalone: null,
    "synara-default": null,
    "synara-activated": null,
  };
  for (const mode of ["standalone", "synara-default", "synara-activated"] as const) {
    const repetitions = runSets[mode];
    if (repetitions === undefined) {
      runSetReports[mode] = null;
      continue;
    }
    const reportRunSet = buildReportRunSet(mode, repetitions, options);
    runSetReports[mode] = reportRunSet;
    evidenceByMode[mode] = reportRunSet.evidence.insufficientEvidence;
    if (reportRunSet.evidence.insufficientEvidence) {
      insufficientModes.push(mode);
    }
  }

  const conclusion = buildConclusion(options, runSets, evidenceByMode);
  const git = collectGitMetadata(options.repoRoot);
  const report: MeasurementReport = {
    reportVersion: 1,
    harnessVersion: HARNESS_VERSION,
    createdAt: new Date().toISOString(),
    git,
    environment: {
      bun: typeof Bun !== "undefined" ? Bun.version : "unknown",
      platform: process.platform,
      arch: process.arch,
      serverPort: options.serverPort ?? null,
    },
    prompt: {
      text: STIMULUS_TEXT,
      bytes: stimulusByteLength(),
      hash: STIMULUS_HASH,
    },
    config: {
      repetitions: options.repetitions,
      turnsPerRepetition: options.turnsPerRepetition,
      model: options.modelId,
      thinkingLevel: options.thinkingLevel,
      agentDir: sanitizePathForReport(options.agentDir),
      localManifestDir:
        options.localManifestDir === null ? null : sanitizePathForReport(options.localManifestDir),
      fixtureDigest: options.fixtureDigest,
      fixtureGitCommit: options.fixtureGitCommit,
    },
    runSets: runSetReports,
    conclusions: conclusion,
    reconciliation: {
      equation: REPORT_RECONCILIATION_RULE.equation,
      description: REPORT_RECONCILIATION_RULE.description,
    },
  };

  // Fail closed: incomplete or unreconciled run sets exit nonzero.
  const exitCode: 0 | 1 | 2 = insufficientModes.length > 0 ? 1 : 0;
  return { report, exitCode, insufficientModes };
}

export function printReportSummary(report: MeasurementReport): void {
  const lines: string[] = [];
  lines.push(`Token-overhead measurement report (harness ${report.harnessVersion})`);
  lines.push(
    `  git: ${report.git.commit} (${report.git.branch})${report.git.dirty ? " [dirty]" : ""}`,
  );
  for (const mode of ["standalone", "synara-default", "synara-activated"] as const) {
    const runSet = report.runSets[mode];
    if (runSet === null) {
      lines.push(`  ${mode}: skipped`);
      continue;
    }
    const { validRepetitions, invalidRepetitions, components } = runSet.summary;
    lines.push(
      `  ${mode}: ${validRepetitions.length}/${runSet.config.repetitions} valid repetitions` +
        (invalidRepetitions.length > 0
          ? ` (${invalidRepetitions.length} invalid: ${invalidRepetitions.map((r) => r.invalidReason).join("; ")})`
          : ""),
    );
    lines.push(
      `    turn-1 total tokens: ${validRepetitions.map((r) => r.turns[0]?.raw.total ?? "n/a").join(", ")}`,
    );
    lines.push(
      `    paired delta (turn2 - turn1) total: mean ${Math.round(components.total.mean)} range ${components.total.min}..${components.total.max} (n=${components.total.values.length})`,
    );
    lines.push(
      `    catalog: ${runSet.catalog.toolCounts.join("/")} tools, ${runSet.catalog.canonicalByteCounts.join("/")} bytes, ${runSet.catalog.hashes.join("/")}`,
    );
    if (runSet.evidence.insufficientEvidence) {
      lines.push(`    evidence: INSUFFICIENT (${runSet.evidence.reasons.join(", ")})`);
    } else {
      lines.push("    evidence: sufficient");
    }
  }
  lines.push(
    `  recommendation: ${report.conclusions.recommendation.kind} — ${report.conclusions.recommendation.rationale}`,
  );
  process.stderr.write(`${lines.join("\n")}\n`);
}
