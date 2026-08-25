// FILE: piSubagentDevArtifactCache.ts
// Purpose: Dev-runtime cache of the release-controlled managed Pi subagent
// artifact under the resolved SYNARA_HOME, keyed by the pin (Ticket: local
// web/dev controlled pinned artifact path). The dev runner prepares this
// cache ONCE per pin and forwards the cache locator to the dev server via
// `SYNARA_PI_SUBAGENT_ARTIFACT_DIR`, so a local web/dev server consumes the
// SAME verified, release-controlled artifact the packaged desktop does —
// staged by the existing release stager and verified by the existing
// production verifier. No duplicated staging or verification logic.
// Layer: Dev/build helper (scripts). Runs under plain Node (type-stripping),
// exactly like `scripts/dev-runner.ts` and `scripts/build-desktop-artifact.ts`.
// Depends: `./piSubagentArtifactStaging.ts` (release stager — the single
// staging source of truth; pin fixture is the authoritative read-only pin)
// and `../../apps/server/src/provider/piSubagentArtifactVerifier.ts` (the
// production runtime verifier — the single verification source of truth).
//
// Security boundaries preserved from the staging/verifier contracts:
// - the pin comes ONLY from the repository provenance fixture (never env,
//   never request input);
// - the cache is keyed by the pinned commit, so two pins never share bytes;
// - staged content is never symlinked, never gains post-verification files,
//   and never carries auth/models material (stager's prohibited-payload
//   guard; verifier's exact closed-tree check on every hit);
// - an invalid, tampered, or symlinked cache entry is quarantined (removed)
//   and restaged from the pinned source; a restage that still fails to
//   verify fails closed;
// - concurrent preparations of the same pin serialize through a
//   lock-and-wait protocol so exactly one staging pass publishes the entry
//   (the stager itself publishes atomically; the lock closes the
//   remove-then-rename interleaving window between concurrent rebuilds).

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  buildPiSubagentArtifact,
  loadPiSubagentExtensionProvenance,
  PI_SUBAGENT_EXTENSION_PROVENANCE_FIXTURE_RELATIVE_PATH,
  resolveAlfieRepoDir,
  type PiSubagentExtensionProvenanceFixture,
} from "./piSubagentArtifactStaging.ts";
import { verifyPiSubagentArtifact } from "../../apps/server/src/provider/piSubagentArtifactVerifier.ts";

/**
 * Directory under the resolved SYNARA_HOME that holds the dev artifact cache.
 * Kept namespaced under `dev-` so it can never be confused with server state
 * (`state.sqlite`, worktrees, …) and is trivially safe to delete.
 */
export const PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME = "dev-pi-subagent-artifacts";

/** Lock file name inside the cache root, one per pin. */
const LOCK_FILE_SUFFIX = ".lock";

/** Bounded wait for a concurrent preparation of the same pin to finish. */
const LOCK_WAIT_TIMEOUT_MS = 120_000;
const LOCK_POLL_MS = 100;

/**
 * Closed failure vocabulary. Codes name the failing leg without embedding
 * absolute paths or raw filesystem errors in messages intended for
 * operators.
 */
export type PiSubagentDevArtifactCacheErrorCode =
  | "provenance_unreadable"
  | "alfie_repo_unresolved"
  | "cache_location_invalid"
  | "staging_failed"
  | "verification_failed";

export class PiSubagentDevArtifactCacheError extends Error {
  readonly code: PiSubagentDevArtifactCacheErrorCode;

  constructor(code: PiSubagentDevArtifactCacheErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "PiSubagentDevArtifactCacheError";
    this.code = code;
  }
}

/** Successful preparation result. */
export interface PreparedPiSubagentDevArtifact {
  /** Cache entry root — the value to forward as the artifact locator. */
  readonly artifactDir: string;
  /** True when this call staged a fresh entry; false on a verified hit. */
  readonly staged: boolean;
  /** The pin this entry is keyed by (full pinned commit). */
  readonly pinnedCommit: string;
}

export interface PreparePiSubagentDevArtifactInput {
  /** Synara repository root (locates the read-only pin fixture). */
  readonly repoRoot: string;
  /** Resolved SYNARA_HOME (cache lives under `<synaraHome>/dev-pi-subagent-artifacts`). */
  readonly synaraHome: string;
  /**
   * Environment consulted ONLY for locating the pinned Alfie checkout
   * (`ALFIE_REPO_DIR` / `ALFIE_EXTENSION_DIR`), mirroring the stager's
   * locator convention. The pin itself never comes from here.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const asRecord = (
  env: Readonly<Record<string, string | undefined>> | undefined,
): Record<string, string | undefined> => (env === undefined ? {} : { ...env });

/**
 * Resolves the pinned Alfie source for the current pin. The staging
 * resolver reads `process.env` directly, so this helper applies the caller's
 * env explicitly and restores the previous values afterwards — the cache
 * helper stays injectable while the stager stays untouched.
 */
function withAlfieLocatorEnv<T>(
  env: Readonly<Record<string, string | undefined>>,
  run: () => T,
): T {
  const keys = ["ALFIE_REPO_DIR", "ALFIE_EXTENSION_DIR"] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

/** Loads the authoritative read-only pin fixture for this repository. */
export function loadDevArtifactPin(
  repoRoot: string,
): PiSubagentExtensionProvenanceFixture {
  const fixturePath = join(resolve(repoRoot), PI_SUBAGENT_EXTENSION_PROVENANCE_FIXTURE_RELATIVE_PATH);
  try {
    return loadPiSubagentExtensionProvenance(fixturePath);
  } catch (cause) {
    throw new PiSubagentDevArtifactCacheError(
      "provenance_unreadable",
      `Could not read the managed pi-subagents pin fixture for the dev artifact cache: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }
}

/** Cache entry directory for one pin (deterministic; commit-named). */
export function piSubagentDevArtifactCacheEntryDir(input: {
  readonly synaraHome: string;
  readonly pinnedCommit: string;
}): string {
  const normalized = input.pinnedCommit.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) {
    throw new PiSubagentDevArtifactCacheError(
      "cache_location_invalid",
      "Managed pi-subagents pin is not a Git commit SHA; refusing to derive a cache location.",
    );
  }
  return join(
    resolve(input.synaraHome),
    PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME,
    normalized,
  );
}

/**
 * Verifies a cache entry with the production verifier. Returns the valid
 * result or `undefined` — never throws for an invalid tree (the caller
 * decides between quarantine+restage and fail-closed).
 */
const verifyCacheEntry = (artifactDir: string) =>
  verifyPiSubagentArtifact(artifactDir).then(
    (result) => (result.valid ? result : undefined),
    () => undefined,
  );

/**
 * Quarantines a cache entry: removes whatever sits at the location (a
 * symlink removes only the link itself — never its target) plus any stale
 * staging siblings the release stager may have left behind a crashed run
 * (the stager names its temp siblings `<entry>.staging-<hex>`).
 */
function quarantineCacheEntry(artifactDir: string): void {
  // rm on a symlink path removes the link only (lstat semantics), so a
  // hostile symlinked cache entry cannot delete content outside the cache.
  rmSync(artifactDir, { recursive: true, force: true });
  const parent = join(artifactDir, "..");
  const entryBase = artifactDir.split(/[\\/]/).pop() ?? "";
  if (entryBase !== "" && existsSync(parent)) {
    for (const name of readdirSync(parent)) {
      if (name.startsWith(`${entryBase}.staging-`)) {
        rmSync(join(parent, name), { recursive: true, force: true });
      }
    }
  }
}

/**
 * One preparation pass for a pin: verify-or-stage.
 *
 * Returns the prepared entry. Throws `PiSubagentDevArtifactCacheError`
 * (fail closed) when the pinned source cannot be resolved, staging fails,
 * or a freshly staged entry still fails verification.
 */
async function prepareOnce(input: {
  readonly provenance: PiSubagentExtensionProvenanceFixture;
  readonly artifactDir: string;
  readonly repoRoot: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<PreparedPiSubagentDevArtifact> {
  const existing = await verifyCacheEntry(input.artifactDir);
  if (existing !== undefined) {
    return {
      artifactDir: input.artifactDir,
      staged: false,
      pinnedCommit: input.provenance.pinnedCommit,
    };
  }

  // Miss (absent, invalid, tampered, or symlinked): quarantine and restage
  // from the pinned source. The stager proves the source is the exact clean
  // pinned checkout before any byte is staged.
  quarantineCacheEntry(input.artifactDir);

  let repoDir: string;
  try {
    repoDir = withAlfieLocatorEnv(input.env, () => resolveAlfieRepoDir(input.repoRoot));
  } catch (cause) {
    throw new PiSubagentDevArtifactCacheError(
      "alfie_repo_unresolved",
      cause instanceof Error ? cause.message : String(cause),
      cause,
    );
  }

  try {
    buildPiSubagentArtifact({
      repoDir,
      artifactDir: input.artifactDir,
      provenance: input.provenance,
    });
  } catch (cause) {
    throw new PiSubagentDevArtifactCacheError(
      "staging_failed",
      `Failed to stage the managed pi-subagents dev artifact from the pinned source: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }

  const staged = await verifyCacheEntry(input.artifactDir);
  if (staged === undefined) {
    quarantineCacheEntry(input.artifactDir);
    throw new PiSubagentDevArtifactCacheError(
      "verification_failed",
      "A freshly staged managed pi-subagents dev artifact failed production verification; refusing to forward it.",
    );
  }
  return {
    artifactDir: input.artifactDir,
    staged: true,
    pinnedCommit: input.provenance.pinnedCommit,
  };
}

/**
 * Cross-process lock for one pin's cache entry. The lock file lives inside
 * the cache root (created on demand). A holder that crashed leaves a stale
 * lock; the bounded wait below treats an over-aged lock as abandoned and
 * takes it over, so a crashed preparation can never wedge dev startup
 * forever.
 */
const STALE_LOCK_MS = 180_000;

async function withPinLock<T>(
  cacheRoot: string,
  pinnedCommit: string,
  run: () => Promise<T>,
): Promise<T> {
  mkdirSync(cacheRoot, { recursive: true });
  const lockPath = join(cacheRoot, `${pinnedCommit.trim().toLowerCase()}${LOCK_FILE_SUFFIX}`);
  const { open } = await import("node:fs/promises");
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      break;
    } catch (cause) {
      const code = (cause as { readonly code?: string }).code;
      if (code !== "EEXIST") throw cause;
      // Abandoned-lock takeover: a lock older than STALE_LOCK_MS belongs to
      // a dead preparation and is removed so this one can proceed.
      try {
        const stats = statSync(lockPath);
        if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // The lock vanished between open and stat — retry immediately.
      }
      if (Date.now() >= deadline) {
        throw new PiSubagentDevArtifactCacheError(
          "cache_location_invalid",
          "Timed out waiting for a concurrent managed pi-subagents dev artifact preparation.",
        );
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, LOCK_POLL_MS));
    }
  }
  try {
    return await run();
  } finally {
    rmSync(lockPath, { force: true });
  }
}

/**
 * Prepares (and verifies) the pinned managed Pi subagent artifact for local
 * dev, caching it under the resolved SYNARA_HOME keyed by the pinned commit.
 *
 * - Cache hit that verifies against the production verifier → returned as-is.
 * - Miss / invalid / tampered / symlinked entry → quarantined and restaged
 *   from the pinned clean source, then verified again (fail closed).
 * - Concurrent preparations of the same pin serialize: the first stages,
 *   the rest observe the verified hit (no interleaved rebuild, no partial
 *   entry ever observed).
 */
export async function preparePiSubagentDevArtifact(
  input: PreparePiSubagentDevArtifactInput,
): Promise<PreparedPiSubagentDevArtifact> {
  const provenance = loadDevArtifactPin(input.repoRoot);
  const artifactDir = piSubagentDevArtifactCacheEntryDir({
    synaraHome: input.synaraHome,
    pinnedCommit: provenance.pinnedCommit,
  });
  const cacheRoot = join(resolve(input.synaraHome), PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME);
  mkdirSync(cacheRoot, { recursive: true });

  return withPinLock(cacheRoot, provenance.pinnedCommit, () =>
    prepareOnce({ provenance, artifactDir, repoRoot: input.repoRoot, env: asRecord(input.env) }),
  );
}
