// FILE: canonicalize.ts
// Purpose: Deterministic canonical manifest serialization (Decision 34 §3).
// The canonical bytes are the bytes used for schema-size accounting and
// hashing: tools sorted by name, each entry serialized with a fixed key
// order (name, description, parameters, promptGuidelines when present),
// compact JSON, UTF-8 encoded, sha256 hashed. The method is documented in
// `MANIFEST_CANONICALIZATION_METHOD`.
import { createHash } from "node:crypto";

import type {
  CanonicalManifestSummary,
  CanonicalToolEntry,
  ManifestCaptureInput,
} from "./types.ts";

export const MANIFEST_CANONICALIZATION_METHOD =
  "sort-by-name; per-tool fixed key order {name,description,parameters,promptGuidelines?}; " +
  "compact JSON (no whitespace); UTF-8 bytes; sha256 hex digest.";

const encoder = new TextEncoder();

/**
 * Map real tool/schema API entries into canonical manifest entries without
 * filtering, truncating, or redacting anything (Decision 34 §3). Shared by
 * the measurement enumeration and the Decision 35 observer so every mode
 * canonicalizes exactly the same live surface.
 */
export function toCanonicalEntries(
  tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
    readonly promptGuidelines?: readonly string[];
  }[],
): CanonicalToolEntry[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    ...(tool.promptGuidelines !== undefined && tool.promptGuidelines.length > 0
      ? { promptGuidelines: tool.promptGuidelines }
      : {}),
  }));
}

/** Deterministic per-entry object with a fixed key order. */
function canonicalEntryObject(entry: CanonicalToolEntry): Record<string, unknown> {
  const object: Record<string, unknown> = {
    name: entry.name,
    description: entry.description,
    parameters: entry.parameters,
  };
  if (entry.promptGuidelines !== undefined && entry.promptGuidelines.length > 0) {
    object.promptGuidelines = entry.promptGuidelines;
  }
  return object;
}

/**
 * Serialize the complete tool manifest into the canonical bytes. Throws when
 * the input is empty (an empty effective catalog is a measurement failure:
 * the complete manifest must contain at least the configured tools).
 */
export function canonicalizeManifest(tools: readonly CanonicalToolEntry[]): Uint8Array {
  if (tools.length === 0) {
    throw new Error(
      "Cannot canonicalize an empty tool manifest: the effective catalog was not captured.",
    );
  }
  const sorted = [...tools].sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
  const serialized = JSON.stringify(sorted.map(canonicalEntryObject));
  return encoder.encode(serialized);
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function summarizeManifest(input: ManifestCaptureInput): CanonicalManifestSummary {
  const canonicalBytes = canonicalizeManifest(input.tools);
  const toolNames = [...input.tools]
    .map((tool) => tool.name)
    .sort((left, right) => left.localeCompare(right));
  return {
    toolNames,
    toolCount: toolNames.length,
    canonicalBytes: canonicalBytes.byteLength,
    hash: sha256(canonicalBytes),
    hashAlgorithm: "sha256",
    method: MANIFEST_CANONICALIZATION_METHOD,
    localCaptureProduced: input.localCaptureProduced,
    catalogComplete: input.catalogComplete,
    ...(input.catalogIncompleteReason === undefined
      ? {}
      : { catalogIncompleteReason: input.catalogIncompleteReason }),
  };
}
