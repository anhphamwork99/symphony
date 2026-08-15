// FILE: index.ts
// Purpose: Public entry for the impl-11 token-overhead measurement harness.
// The CLI lives in cli.ts; the launcher script under
// apps/server/scripts/token-overhead/measure.ts delegates here.
export { main as runCli } from "./cli.ts";
export { runMeasurement, HARNESS_VERSION, collectGitMetadata } from "./orchestrator.ts";
export {
  reconcileSessionStats,
  reconcileRawVsNormalized,
  extractTurnCompletedUsage,
  PI_RECONCILIATION_RULE,
} from "./reconciliation.ts";
export {
  buildRunSetSummary,
  computePairedDeltas,
  componentSummary,
  evaluateEvidence,
  makeRecommendation,
  makeTurnMeasurement,
} from "./records.ts";
export { canonicalizeManifest, summarizeManifest, sha256 } from "./canonicalize.ts";
export { STIMULUS_TEXT, STIMULUS_HASH } from "./stimulus.ts";
export { parseCanonicalTurnCompletedEvents } from "./synaraDriver.ts";
export type { SynaraClient } from "./synaraClient.ts";
