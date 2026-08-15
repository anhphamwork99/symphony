// FILE: catalogArtifact.test.ts
// Purpose: Harness-side Decision 35 artifact parsing/validation tests: the
// harness accepts only a fresh, correctly-identified, canonically consistent
// complete artifact; stale/wrong identity, malformed, observer-failed, and
// internally inconsistent artifacts fail closed with bounded reasons and are
// never promoted to a valid manifest.
import { describe, expect, it } from "vitest";

import {
  CATALOG_ARTIFACT_SCHEMA,
  CATALOG_ARTIFACT_SCHEMA_VERSION,
  manifestSummaryFromArtifact,
  parseCatalogArtifact,
  validateCatalogArtifact,
  type CatalogArtifactOk,
} from "./catalogArtifact.ts";
import { canonicalizeManifest, sha256 } from "./canonicalize.ts";
import type { CanonicalToolEntry } from "./types.ts";

const ENTRIES: CanonicalToolEntry[] = [
  {
    name: "bash",
    description: "Run a command",
    parameters: { type: "object" },
    promptGuidelines: ["Prefer explicit commands"],
  },
  { name: "write", description: "Write a file", parameters: { type: "object" } },
];

function okArtifact(overrides: Partial<Record<string, unknown>> = {}): CatalogArtifactOk {
  const canonical = canonicalizeManifest(ENTRIES);
  const base = {
    schema: CATALOG_ARTIFACT_SCHEMA,
    schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
    status: "ok",
    mode: "synara-default",
    threadId: "thread-1",
    lifecycleGeneration: "gen-1",
    phase: "ready",
    capturedAt: new Date().toISOString(),
    toolCount: ENTRIES.length,
    canonicalBytes: canonical.byteLength,
    hash: sha256(canonical),
    hashAlgorithm: "sha256",
    canonicalizationMethod:
      "sort-by-name; per-tool fixed key order {name,description,parameters,promptGuidelines?}; " +
      "compact JSON (no whitespace); UTF-8 bytes; sha256 hex digest.",
    entries: ENTRIES,
    ...overrides,
  };
  const parsed = parseCatalogArtifact(JSON.stringify(base));
  if (parsed.status === "malformed" || parsed.status === "failed") {
    throw new Error("fixture artifact must parse as ok");
  }
  return parsed;
}

describe("catalog artifact parsing (Decision 35)", () => {
  it("parses an ok artifact and rejects malformed content", () => {
    expect(okArtifact().status).toBe("ok");
    expect(parseCatalogArtifact("not json").status).toBe("malformed");
    expect(parseCatalogArtifact("[]").status).toBe("malformed");
    expect(parseCatalogArtifact(JSON.stringify({ schema: "other" })).status).toBe("malformed");
    expect(
      parseCatalogArtifact(JSON.stringify({ ...okArtifact(), schemaVersion: 2 })).status,
    ).toBe("malformed");
    expect(
      parseCatalogArtifact(
        JSON.stringify({ ...okArtifact(), entries: [{ name: 1, description: "x" }] }),
      ).status,
    ).toBe("malformed");
  });

  it("parses observer failure markers with their bounded code", () => {
    const parsed = parseCatalogArtifact(
      JSON.stringify({
        schema: CATALOG_ARTIFACT_SCHEMA,
        schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
        status: "failed",
        code: "enumeration-failed",
        message: "catalog observer capture failed: enumeration-failed",
      }),
    );
    expect(parsed.status).not.toBe("malformed");
    if (parsed.status === "failed") {
      expect(parsed.code).toBe("enumeration-failed");
      expect(parsed.message).not.toContain("/");
    }
  });
});

describe("catalog artifact validation (Decision 35)", () => {
  it("accepts a complete, current, correctly-identified artifact", () => {
    const artifact = okArtifact();
    const validation = validateCatalogArtifact(artifact, {
      mode: "synara-default",
      threadId: "thread-1",
      phase: "ready",
    });
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.entries.map((entry) => entry.name).sort()).toEqual(["bash", "write"]);
      const summary = manifestSummaryFromArtifact({
        entries: validation.entries,
        localCaptureProduced: true,
      });
      expect(summary.catalogComplete).toBe(true);
      expect(summary.toolCount).toBe(2);
      expect(summary.hash).toBe(artifact.hash);
      expect(summary.canonicalBytes).toBe(artifact.canonicalBytes);
      expect(summary.localCaptureProduced).toBe(true);
    }
  });

  it("rejects a misrouted or stale artifact (mode/thread/phase identity)", () => {
    expect(
      validateCatalogArtifact(okArtifact(), {
        mode: "synara-activated",
        threadId: "thread-1",
        phase: "ready",
      }).ok,
    ).toBe(false);
    expect(
      validateCatalogArtifact(okArtifact(), {
        mode: "synara-default",
        threadId: "thread-2",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "thread-identity-mismatch" });
    expect(
      validateCatalogArtifact(okArtifact(), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "activated-terminal",
      }),
    ).toEqual({ ok: false, reason: "phase-mismatch" });
    expect(
      validateCatalogArtifact(okArtifact({ mode: "synara-activated" }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "mode-mismatch" });
  });

  it("rejects empty and count-inconsistent artifacts", () => {
    expect(
      validateCatalogArtifact(okArtifact({ entries: [], toolCount: 0 }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "empty-catalog" });
    expect(
      validateCatalogArtifact(okArtifact({ toolCount: 1 }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "tool-count-mismatch" });
  });

  it("rejects internally inconsistent canonical bytes or hashes (tampered artifact)", () => {
    expect(
      validateCatalogArtifact(okArtifact({ canonicalBytes: 1 }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "canonical-mismatch" });
    expect(
      validateCatalogArtifact(okArtifact({ hash: "deadbeef" }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "canonical-mismatch" });
    // A tampered entry changes the recomputed canonical bytes/hash.
    const tampered = okArtifact({
      entries: [{ ...ENTRIES[0]!, description: "tampered" }, ENTRIES[1]],
    });
    expect(
      validateCatalogArtifact(tampered, {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "canonical-mismatch" });
  });

  it("rejects unsupported hash algorithms and method drift", () => {
    expect(
      validateCatalogArtifact(okArtifact({ hashAlgorithm: "md5" }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "unsupported-hash-algorithm" });
    expect(
      validateCatalogArtifact(okArtifact({ canonicalizationMethod: "other" }), {
        mode: "synara-default",
        threadId: "thread-1",
        phase: "ready",
      }),
    ).toEqual({ ok: false, reason: "canonicalization-method-mismatch" });
  });
});
