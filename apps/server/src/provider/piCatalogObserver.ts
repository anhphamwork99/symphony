// FILE: piCatalogObserver.ts
// Purpose: Decision 35 — the smallest measurement-only observer inside the Pi
// adapter boundary that captures the complete effective catalog of the live
// measured Pi session through the authoritative `AgentSession.getAllTools()`
// surface and writes it to a transient artifact confined to the
// harness-created isolated home. The observer is absent (a complete no-op) in
// normal runs: it exists only when the isolated harness child server sets the
// explicit enable flag, the isolated-home root, the artifact destination, and
// the measurement mode. It is read-only and never registers/removes/reorders
// tools, reloads the session, alters activation, accounting, prompts,
// events, or the journal, and it never throws (observer success or failure
// can never change any lifecycle result).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { AgentSession } from "@earendil-works/pi-coding-agent";

import {
  CATALOG_ARTIFACT_SCHEMA,
  CATALOG_ARTIFACT_SCHEMA_VERSION,
} from "../measurement/catalogArtifact.ts";
import {
  canonicalizeManifest,
  MANIFEST_CANONICALIZATION_METHOD,
  sha256,
  toCanonicalEntries,
} from "../measurement/canonicalize.ts";
import type { CanonicalToolEntry } from "../measurement/types.ts";

/** Explicit measurement-only enable flag; only the exact value "1" enables. */
export const CATALOG_OBSERVER_ENV_ENABLE = "SYNARA_MEASUREMENT_CATALOG_OBSERVER" as const;
/** The harness-created isolated home; the artifact must resolve inside it. */
export const CATALOG_OBSERVER_ENV_HOME = "SYNARA_MEASUREMENT_CATALOG_HOME" as const;
/** The artifact destination (absolute, inside the isolated home). */
export const CATALOG_OBSERVER_ENV_ARTIFACT = "SYNARA_MEASUREMENT_CATALOG_ARTIFACT_PATH" as const;
/** The measurement mode selecting the capture schedule. */
export const CATALOG_OBSERVER_ENV_MODE = "SYNARA_MEASUREMENT_CATALOG_MODE" as const;

export type PiCatalogObserverMode = "synara-default" | "synara-activated";
export type PiCatalogObserverPhase = "ready" | "activated-terminal";

/** Bounded failure codes; never carry paths, schemas, credentials, or tokens. */
export type PiCatalogObserverFailureCode =
  | "enumeration-failed"
  | "empty-catalog"
  | "canonicalization-failed"
  | "serialization-failed"
  | "confinement-rejected"
  | "directory-failed"
  | "temp-write-failed"
  | "permission-failed"
  | "rename-failed";

export interface PiCatalogObserver {
  readonly mode: PiCatalogObserverMode;
  readonly artifactPath: string;
  /**
   * The live session reached its normal ready state (startSession complete).
   * In default mode this is the authoritative capture point: after readiness,
   * before the first measured turn. A fresh session resets the observer's
   * per-thread lifecycle state.
   */
  readonly onSessionReady: (input: {
    readonly threadId: string;
    readonly session: AgentSession;
    readonly lifecycleGeneration: string | undefined;
  }) => void;
  /**
   * A real activation was proven and committed at the safe boundary (staged
   * catalog applied and the Pi runtime reload completed). Records the session
   * generation the capture must still match.
   */
  readonly onActivationCommitted: (input: {
    readonly threadId: string;
    readonly lifecycleGeneration: string | undefined;
  }) => void;
  /**
   * A turn prompt is about to be issued against the live session. In
   * activated mode this is the authoritative capture point: only after the
   * committed activation, while the recorded generation is still current, and
   * before the first measured prompt in the resulting catalog state.
   */
  readonly onTurnPrompt: (input: {
    readonly threadId: string;
    readonly session: AgentSession;
    readonly lifecycleGeneration: string | undefined;
  }) => void;
}

export function parseCatalogObserverMode(value: string | undefined): PiCatalogObserverMode | null {
  if (value === "synara-default") return "synara-default";
  if (value === "synara-activated") return "synara-activated";
  return null;
}

/**
 * Build the observer from the process environment. Absent, false, or invalid
 * enablement, a missing destination, or an unknown mode makes the observer
 * absent (a no-op) so normal Synara runs never call `getAllTools()` for
 * measurement, never create measurement files, and never serialize catalogs.
 */
export function makePiCatalogObserver(env: NodeJS.ProcessEnv): PiCatalogObserver | null {
  if (env[CATALOG_OBSERVER_ENV_ENABLE] !== "1") return null;
  const homeDir = env[CATALOG_OBSERVER_ENV_HOME];
  const artifactPath = env[CATALOG_OBSERVER_ENV_ARTIFACT];
  const mode = parseCatalogObserverMode(env[CATALOG_OBSERVER_ENV_MODE]);
  if (homeDir === undefined || homeDir.length === 0) return null;
  if (artifactPath === undefined || artifactPath.length === 0) return null;
  if (mode === null) return null;
  return makeCatalogObserver({ homeDir, artifactPath, mode });
}

interface ObserverThreadState {
  activationCommitted: boolean;
  committedLifecycleGeneration: string | undefined;
  captured: boolean;
}

function freshThreadState(): ObserverThreadState {
  return { activationCommitted: false, committedLifecycleGeneration: undefined, captured: false };
}

/** Bounded observer error carrying a failure code (never a path or schema). */
class CatalogObserverError extends Error {
  constructor(readonly code: PiCatalogObserverFailureCode) {
    super(code);
  }
}

function makeCatalogObserver(options: {
  readonly homeDir: string;
  readonly artifactPath: string;
  readonly mode: PiCatalogObserverMode;
}): PiCatalogObserver {
  const states = new Map<string, ObserverThreadState>();

  const stateFor = (threadId: string): ObserverThreadState => {
    let state = states.get(threadId);
    if (state === undefined) {
      state = freshThreadState();
      states.set(threadId, state);
    }
    return state;
  };

  const capture = (input: {
    readonly threadId: string;
    readonly session: AgentSession;
    readonly lifecycleGeneration: string | undefined;
    readonly phase: PiCatalogObserverPhase;
  }): void => {
    // The observer must never throw into the lifecycle; every failure is
    // confined to a bounded marker (or, when even the destination cannot be
    // proven safe, to nothing at all — fail closed).
    try {
      const destination = confineDestination(options.homeDir, options.artifactPath);
      if (destination === null) {
        // Confinement cannot be proven: write nothing anywhere (fail closed).
        return;
      }
      let entries: CanonicalToolEntry[];
      try {
        // Take entries directly and completely from getAllTools() — no
        // filtering, truncation, redaction, or merging (Decision 35).
        entries = toCanonicalEntries(input.session.getAllTools());
      } catch {
        writeFailureMarker(destination, "enumeration-failed");
        return;
      }
      if (entries.length === 0) {
        writeFailureMarker(destination, "empty-catalog");
        return;
      }
      let canonicalBytes: Uint8Array;
      let hash: string;
      try {
        canonicalBytes = canonicalizeManifest(entries);
        hash = sha256(canonicalBytes);
      } catch {
        writeFailureMarker(destination, "canonicalization-failed");
        return;
      }
      const artifact = {
        schema: CATALOG_ARTIFACT_SCHEMA,
        schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
        status: "ok",
        mode: options.mode,
        threadId: input.threadId,
        lifecycleGeneration: input.lifecycleGeneration ?? null,
        phase: input.phase,
        capturedAt: new Date().toISOString(),
        toolCount: entries.length,
        canonicalBytes: canonicalBytes.byteLength,
        hash,
        hashAlgorithm: "sha256",
        canonicalizationMethod: MANIFEST_CANONICALIZATION_METHOD,
        entries,
      } as const;
      let serialized: string;
      try {
        serialized = JSON.stringify(artifact);
      } catch {
        writeFailureMarker(destination, "serialization-failed");
        return;
      }
      safeWrite(destination, serialized);
    } catch {
      // Unknown observer failure: never propagate into the lifecycle.
    }
  };

  const safeWrite = (destination: string, content: string): void => {
    try {
      writeArtifactAtomically(destination, content);
    } catch (cause) {
      const code =
        cause instanceof CatalogObserverError ? cause.code : "temp-write-failed";
      try {
        writeArtifactAtomically(
          destination,
          JSON.stringify({
            schema: CATALOG_ARTIFACT_SCHEMA,
            schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
            status: "failed",
            code,
            message: `catalog observer capture failed: ${code}`,
          }),
        );
      } catch {
        // Even the marker cannot be written: the harness observes a missing
        // artifact, which is itself a measurement failure.
      }
    }
  };

  const writeFailureMarker = (destination: string, code: PiCatalogObserverFailureCode): void => {
    safeWrite(
      destination,
      JSON.stringify({
        schema: CATALOG_ARTIFACT_SCHEMA,
        schemaVersion: CATALOG_ARTIFACT_SCHEMA_VERSION,
        status: "failed",
        code,
        message: `catalog observer capture failed: ${code}`,
      }),
    );
  };

  return {
    mode: options.mode,
    artifactPath: options.artifactPath,
    onSessionReady: ({ threadId, session, lifecycleGeneration }) => {
      // A fresh session resets the lifecycle state: an activation committed
      // for a previous session on the same thread can never satisfy a later
      // capture, and if the generation changed the capture is declined.
      states.set(threadId, freshThreadState());
      if (options.mode === "synara-default") {
        capture({ threadId, session, lifecycleGeneration, phase: "ready" });
      }
    },
    onActivationCommitted: ({ threadId, lifecycleGeneration }) => {
      const state = stateFor(threadId);
      state.activationCommitted = true;
      state.committedLifecycleGeneration = lifecycleGeneration;
    },
    onTurnPrompt: ({ threadId, session, lifecycleGeneration }) => {
      if (options.mode !== "synara-activated") return;
      const state = stateFor(threadId);
      if (!state.activationCommitted || state.captured) return;
      // If the generation changed before capture, decline the capture: only
      // the subsequently current generation may be captured at its valid
      // lifecycle point (Decision 35).
      if (state.committedLifecycleGeneration !== lifecycleGeneration) return;
      state.captured = true;
      capture({ threadId, session, lifecycleGeneration, phase: "activated-terminal" });
    },
  };
}

/**
 * Confine the artifact destination to the harness-created isolated home.
 * Rejects relative paths, traversal escapes, outside absolute paths, symlink
 * traversal through any parent component, symlink destinations, and
 * non-regular existing targets. Returns the resolved destination or null
 * (fail closed: nothing is ever written outside the home).
 */
export function confineDestination(homeDir: string, artifactPath: string): string | null {
  if (!path.isAbsolute(homeDir) || !path.isAbsolute(artifactPath)) return null;
  const homeRoot = path.resolve(homeDir);
  const target = path.resolve(artifactPath);
  const rel = path.relative(homeRoot, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  let realHome: string;
  let realParent: string;
  try {
    realHome = fs.realpathSync(homeRoot);
  } catch {
    return null;
  }
  try {
    realParent = fs.realpathSync(path.dirname(target));
  } catch {
    return null;
  }
  const parentRel = path.relative(realHome, realParent);
  if (parentRel.startsWith("..") || path.isAbsolute(parentRel)) return null;
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return null;
    if (!stat.isFile()) return null;
  } catch {
    // ENOENT: a fresh destination is fine.
  }
  return target;
}

/**
 * Write through a temporary file in the same restricted directory, close it,
 * set restrictive permissions, and atomically rename it. The directory is
 * made owner-only and the artifact owner-readable/writable. Any step failure
 * is mapped to a bounded code and the temp file is removed.
 */
export function writeArtifactAtomically(destination: string, content: string): void {
  const dir = path.dirname(destination);
  const temp = path.join(dir, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      throw new CatalogObserverError("permission-failed");
    }
    try {
      fd = fs.openSync(temp, "wx", 0o600);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      throw new CatalogObserverError(code === "ENOENT" || code === "ENOTDIR" ? "directory-failed" : "permission-failed");
    }
    try {
      fs.writeFileSync(fd, content, { encoding: "utf8" });
    } catch {
      throw new CatalogObserverError("temp-write-failed");
    }
    try {
      fs.fsyncSync(fd);
    } catch {
      throw new CatalogObserverError("temp-write-failed");
    }
    try {
      fs.closeSync(fd);
    } catch {
      throw new CatalogObserverError("temp-write-failed");
    }
    fd = undefined;
    try {
      fs.chmodSync(temp, 0o600);
    } catch {
      throw new CatalogObserverError("permission-failed");
    }
    try {
      fs.renameSync(temp, destination);
    } catch {
      throw new CatalogObserverError("rename-failed");
    }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort close during a failed write.
      }
    }
    try {
      fs.unlinkSync(temp);
    } catch {
      // The temp was already renamed (success) or never created.
    }
  }
}
