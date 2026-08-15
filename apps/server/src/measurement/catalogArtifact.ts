// FILE: catalogArtifact.ts
// Purpose: Harness-side contract and validation for the Decision 35 catalog
// observer artifact. The observer (apps/server/src/provider/piCatalogObserver.ts)
// writes this transient artifact inside the harness-created isolated home;
// the harness waits for it, validates identity/freshness/canonical
// consistency, and consumes it as the complete effective manifest. All
// validation failures use bounded fixed reasons — never paths, schemas, or
// credentials — and any invalid artifact fails closed as a measurement
// failure (Decision 35).
import { canonicalizeManifest, MANIFEST_CANONICALIZATION_METHOD, sha256 } from "./canonicalize.ts";
import type { CanonicalToolEntry, CanonicalManifestSummary } from "./types.ts";

export const CATALOG_ARTIFACT_SCHEMA = "synara-pi-measurement-catalog-artifact" as const;
export const CATALOG_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type CatalogArtifactMode = "synara-default" | "synara-activated";
export type CatalogArtifactPhase = "ready" | "activated-terminal";

/** Success artifact as written by the observer (entries = the live getAllTools surface). */
export interface CatalogArtifactOk {
  readonly status: "ok";
  readonly schema: string;
  readonly schemaVersion: number;
  readonly mode: CatalogArtifactMode;
  readonly threadId: string;
  /** Session lifecycle generation the capture was bound to (null when the session had none). */
  readonly lifecycleGeneration: string | null;
  readonly phase: CatalogArtifactPhase;
  readonly capturedAt: string;
  readonly toolCount: number;
  readonly canonicalBytes: number;
  readonly hash: string;
  readonly hashAlgorithm: string;
  readonly canonicalizationMethod: string;
  readonly entries: readonly CanonicalToolEntry[];
}

/** Bounded failure marker written by the observer when a capture cannot be produced. */
export interface CatalogArtifactFailure {
  readonly status: "failed";
  readonly schema: string;
  readonly schemaVersion: number;
  readonly code: string;
  /** Bounded message; never contains paths, schemas, or credentials. */
  readonly message: string;
}

export type ParsedCatalogArtifact =
  | { readonly status: "malformed" }
  | CatalogArtifactFailure
  | CatalogArtifactOk;

/** Parse raw artifact bytes; `malformed` for any JSON/shape violation. */
export function parseCatalogArtifact(content: string): ParsedCatalogArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { status: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { status: "malformed" };
  }
  const record = parsed as Record<string, unknown>;
  if (record.schema !== CATALOG_ARTIFACT_SCHEMA) {
    return { status: "malformed" };
  }
  if (record.schemaVersion !== CATALOG_ARTIFACT_SCHEMA_VERSION) {
    return { status: "malformed" };
  }
  if (record.status === "failed") {
    return {
      status: "failed",
      schema: CATALOG_ARTIFACT_SCHEMA,
      schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
      code: typeof record.code === "string" && record.code.length > 0 ? record.code : "unknown",
      message:
        typeof record.message === "string" && record.message.length > 0
          ? record.message
          : "observer capture failed",
    } satisfies CatalogArtifactFailure;
  }
  if (record.status !== "ok") {
    return { status: "malformed" };
  }
  if (
    (record.mode !== "synara-default" && record.mode !== "synara-activated") ||
    typeof record.threadId !== "string" ||
    (record.lifecycleGeneration !== null && typeof record.lifecycleGeneration !== "string") ||
    (record.phase !== "ready" && record.phase !== "activated-terminal") ||
    typeof record.capturedAt !== "string" ||
    typeof record.toolCount !== "number" ||
    typeof record.canonicalBytes !== "number" ||
    typeof record.hash !== "string" ||
    typeof record.hashAlgorithm !== "string" ||
    typeof record.canonicalizationMethod !== "string" ||
    !Array.isArray(record.entries)
  ) {
    return { status: "malformed" };
  }
  const entries = record.entries as unknown[];
  if (entries.some((entry) => !isCanonicalEntry(entry))) {
    return { status: "malformed" };
  }
  return {
    status: "ok",
    schema: CATALOG_ARTIFACT_SCHEMA,
    schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
    mode: record.mode,
    threadId: record.threadId,
    lifecycleGeneration: record.lifecycleGeneration,
    phase: record.phase,
    capturedAt: record.capturedAt,
    toolCount: record.toolCount,
    canonicalBytes: record.canonicalBytes,
    hash: record.hash,
    hashAlgorithm: record.hashAlgorithm,
    canonicalizationMethod: record.canonicalizationMethod,
    entries: entries as CanonicalToolEntry[],
  } satisfies CatalogArtifactOk;
}

function isCanonicalEntry(value: unknown): value is CanonicalToolEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.description !== "string") return false;
  if (!("parameters" in record)) return false;
  if (
    record.promptGuidelines !== undefined &&
    (!Array.isArray(record.promptGuidelines) ||
      record.promptGuidelines.some((line) => typeof line !== "string"))
  ) {
    return false;
  }
  return true;
}

export interface CatalogArtifactExpectation {
  readonly mode: CatalogArtifactMode;
  readonly threadId: string;
  readonly phase: CatalogArtifactPhase;
}

export type CatalogArtifactValidation =
  | { readonly ok: true; readonly entries: readonly CanonicalToolEntry[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate the artifact before consumption: schema, expected mode,
 * thread/session identity, capture phase, complete non-empty entries, and
 * exact canonical consistency (bytes and hash recomputed from the artifact's
 * own entries — the live API result — must match what the observer recorded).
 * Every failure is a bounded fixed reason; a stale or misrouted artifact is
 * never accepted (Decision 35).
 */
export function validateCatalogArtifact(
  artifact: CatalogArtifactOk,
  expected: CatalogArtifactExpectation,
): CatalogArtifactValidation {
  if (artifact.schema !== CATALOG_ARTIFACT_SCHEMA || artifact.schemaVersion !== CATALOG_ARTIFACT_SCHEMA_VERSION) {
    return { ok: false, reason: "unrecognized-artifact-schema" };
  }
  if (artifact.mode !== expected.mode) {
    return { ok: false, reason: "mode-mismatch" };
  }
  if (artifact.threadId !== expected.threadId) {
    return { ok: false, reason: "thread-identity-mismatch" };
  }
  if (artifact.phase !== expected.phase) {
    return { ok: false, reason: "phase-mismatch" };
  }
  if (artifact.entries.length === 0) {
    return { ok: false, reason: "empty-catalog" };
  }
  if (artifact.toolCount !== artifact.entries.length) {
    return { ok: false, reason: "tool-count-mismatch" };
  }
  if (artifact.hashAlgorithm !== "sha256") {
    return { ok: false, reason: "unsupported-hash-algorithm" };
  }
  if (artifact.canonicalizationMethod !== MANIFEST_CANONICALIZATION_METHOD) {
    return { ok: false, reason: "canonicalization-method-mismatch" };
  }
  if (Number.isNaN(Date.parse(artifact.capturedAt))) {
    return { ok: false, reason: "malformed-captured-at" };
  }
  let canonicalBytes: Uint8Array;
  try {
    canonicalBytes = canonicalizeManifest(artifact.entries);
  } catch {
    return { ok: false, reason: "canonicalization-failed" };
  }
  if (canonicalBytes.byteLength !== artifact.canonicalBytes) {
    return { ok: false, reason: "canonical-mismatch" };
  }
  if (sha256(canonicalBytes) !== artifact.hash) {
    return { ok: false, reason: "canonical-mismatch" };
  }
  return { ok: true, entries: artifact.entries };
}

/** Consume a validated artifact into the committed manifest summary surface. */
export function manifestSummaryFromArtifact(input: {
  readonly entries: readonly CanonicalToolEntry[];
  readonly localCaptureProduced: boolean;
}): CanonicalManifestSummary {
  const canonicalBytes = canonicalizeManifest(input.entries);
  const toolNames = [...input.entries]
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  return {
    toolNames,
    toolCount: toolNames.length,
    canonicalBytes: canonicalBytes.byteLength,
    hash: sha256(canonicalBytes),
    hashAlgorithm: "sha256",
    method: MANIFEST_CANONICALIZATION_METHOD,
    localCaptureProduced: input.localCaptureProduced,
    catalogComplete: true,
  };
}
