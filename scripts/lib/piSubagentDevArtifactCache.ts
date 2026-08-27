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

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { open as openFile, type FileHandle } from "node:fs/promises";
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
  | "cache_root_unavailable"
  | "cache_quarantine_failed"
  | "lock_open_failed"
  | "lock_write_failed"
  | "lock_close_failed"
  | "lock_read_failed"
  | "lock_remove_failed"
  | "lock_timeout"
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

export interface PiSubagentDevArtifactCacheLockHandle {
  writeFile(data: string, encoding: "utf8"): Promise<void>;
  close(): Promise<void>;
}

/** Narrow cache-only filesystem seam used to prove bounded failure mapping. */
export interface PiSubagentDevArtifactCacheFs {
  mkdirSync(path: string, options: { readonly recursive: true }): void;
  existsSync(path: string): boolean;
  readdirSync(path: string): ReadonlyArray<string>;
  rmSync(path: string, options: { readonly recursive?: boolean; readonly force?: boolean }): void;
  readFileSync(path: string, encoding: "utf8"): string;
  open(path: string, flags: "wx"): Promise<PiSubagentDevArtifactCacheLockHandle>;
}

const defaultCacheFs: PiSubagentDevArtifactCacheFs = {
  mkdirSync: (path, options) => mkdirSync(path, options),
  existsSync,
  readdirSync: (path) => readdirSync(path, { encoding: "utf8" }),
  rmSync: (path, options) => rmSync(path, options),
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  open: async (path, flags): Promise<FileHandle> => openFile(path, flags),
};

const resolveCacheFs = (
  overrides: Partial<PiSubagentDevArtifactCacheFs> | undefined,
): PiSubagentDevArtifactCacheFs => ({ ...defaultCacheFs, ...overrides });

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
  /** Internal cache-filesystem seam; production uses the real filesystem. */
  readonly cacheFs?: Partial<PiSubagentDevArtifactCacheFs>;
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
export function loadDevArtifactPin(repoRoot: string): PiSubagentExtensionProvenanceFixture {
  const fixturePath = join(
    resolve(repoRoot),
    PI_SUBAGENT_EXTENSION_PROVENANCE_FIXTURE_RELATIVE_PATH,
  );
  try {
    return loadPiSubagentExtensionProvenance(fixturePath);
  } catch (cause) {
    throw new PiSubagentDevArtifactCacheError(
      "provenance_unreadable",
      "Could not read the managed pi-subagents pin fixture for the dev artifact cache.",
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
  return join(resolve(input.synaraHome), PI_SUBAGENT_DEV_ARTIFACT_CACHE_DIR_NAME, normalized);
}

/**
 * Verifies a cache entry with the production verifier. Returns the valid
 * result or `undefined` — never throws for an invalid tree (the caller
 * decides between quarantine+restage and fail-closed).
 */
const verifyCacheEntry = (artifactDir: string, provenance: PiSubagentExtensionProvenanceFixture) =>
  verifyPiSubagentArtifact(artifactDir).then(
    (result) => {
      if (!result.valid) return undefined;
      const sourceIdentity = result.metadata.sourceIdentity;
      return sourceIdentity.repositoryUrl === provenance.expectedRepositoryUrl &&
        sourceIdentity.pinnedCommit === provenance.pinnedCommit &&
        sourceIdentity.packageName === provenance.packageName &&
        sourceIdentity.packageVersion === provenance.packageVersion
        ? result
        : undefined;
    },
    () => undefined,
  );

/**
 * Quarantines a cache entry: removes whatever sits at the location (a
 * symlink removes only the link itself — never its target) plus any stale
 * staging siblings the release stager may have left behind a crashed run
 * (the stager names its temp siblings `<entry>.staging-<hex>`).
 */
function cacheFailure(
  code: PiSubagentDevArtifactCacheErrorCode,
  message: string,
  cause?: unknown,
): PiSubagentDevArtifactCacheError {
  return new PiSubagentDevArtifactCacheError(code, message, cause);
}

function quarantineCacheEntry(artifactDir: string, cacheFs: PiSubagentDevArtifactCacheFs): void {
  try {
    // rm on a symlink path removes the link only (lstat semantics), so a
    // hostile symlinked cache entry cannot delete content outside the cache.
    cacheFs.rmSync(artifactDir, { recursive: true, force: true });
    const parent = join(artifactDir, "..");
    const entryBase = artifactDir.split(/[\\/]/).pop() ?? "";
    if (entryBase !== "" && cacheFs.existsSync(parent)) {
      for (const name of cacheFs.readdirSync(parent)) {
        if (name.startsWith(`${entryBase}.staging-`)) {
          cacheFs.rmSync(join(parent, name), { recursive: true, force: true });
        }
      }
    }
  } catch (cause) {
    throw cacheFailure(
      "cache_quarantine_failed",
      "Could not quarantine the managed pi-subagents dev artifact cache entry.",
      cause,
    );
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
  readonly cacheFs: PiSubagentDevArtifactCacheFs;
}): Promise<PreparedPiSubagentDevArtifact> {
  const existing = await verifyCacheEntry(input.artifactDir, input.provenance);
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
  quarantineCacheEntry(input.artifactDir, input.cacheFs);

  let repoDir: string;
  try {
    repoDir = withAlfieLocatorEnv(input.env, () => resolveAlfieRepoDir(input.repoRoot));
  } catch (cause) {
    throw new PiSubagentDevArtifactCacheError(
      "alfie_repo_unresolved",
      "Could not locate the pinned Alfie checkout for the managed pi-subagents dev artifact.",
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
      "Failed to stage the managed pi-subagents dev artifact from the pinned source.",
      cause,
    );
  }

  const staged = await verifyCacheEntry(input.artifactDir, input.provenance);
  if (staged === undefined) {
    quarantineCacheEntry(input.artifactDir, input.cacheFs);
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
 * Cross-process lock for one pin's cache entry. Lock ownership is deliberately
 * never taken over: a crashed holder requires bounded manual recovery. This
 * prevents a waiter from removing a lock it did not acquire and closes the
 * stale-stat/remove and read/remove TOCTOU paths.
 */
export interface PiSubagentDevArtifactPinLockOptions {
  readonly cacheFs?: Partial<PiSubagentDevArtifactCacheFs>;
  readonly waitTimeoutMs?: number;
  readonly pollMs?: number;
}

const LOCK_TIMEOUT_MESSAGE =
  "Managed pi-subagents lock timed out; confirm no dev runner is active, then remove the lock manually and retry.";

const errorCode = (cause: unknown): string | undefined =>
  typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { readonly code?: unknown }).code)
    : undefined;

async function releasePinLock(
  lockPath: string,
  ownerToken: string,
  handle: PiSubagentDevArtifactCacheLockHandle,
  cacheFs: PiSubagentDevArtifactCacheFs,
): Promise<void> {
  try {
    await handle.close();
  } catch (cause) {
    throw cacheFailure(
      "lock_close_failed",
      "Could not close the managed pi-subagents dev artifact lock.",
      cause,
    );
  }

  let contents: string;
  try {
    contents = cacheFs.readFileSync(lockPath, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return;
    throw cacheFailure(
      "lock_read_failed",
      "Could not validate ownership of the managed pi-subagents dev artifact lock.",
      cause,
    );
  }
  if (contents.trim() !== ownerToken) return;

  try {
    cacheFs.rmSync(lockPath, { force: true });
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return;
    throw cacheFailure(
      "lock_remove_failed",
      "Could not remove the managed pi-subagents dev artifact lock after preparation.",
      cause,
    );
  }
}

export async function withPinLock<T>(
  cacheRoot: string,
  pinnedCommit: string,
  run: () => Promise<T>,
  options: PiSubagentDevArtifactPinLockOptions = {},
): Promise<T> {
  const cacheFs = resolveCacheFs(options.cacheFs);
  try {
    cacheFs.mkdirSync(cacheRoot, { recursive: true });
  } catch (cause) {
    throw cacheFailure(
      "cache_root_unavailable",
      "Could not create the managed pi-subagents dev artifact cache root.",
      cause,
    );
  }

  const lockPath = join(cacheRoot, `${pinnedCommit.trim().toLowerCase()}${LOCK_FILE_SUFFIX}`);
  const ownerToken = randomBytes(16).toString("hex");
  const deadline = Date.now() + (options.waitTimeoutMs ?? LOCK_WAIT_TIMEOUT_MS);
  const pollMs = options.pollMs ?? LOCK_POLL_MS;
  let handle: PiSubagentDevArtifactCacheLockHandle | undefined;
  for (;;) {
    try {
      handle = await cacheFs.open(lockPath, "wx");
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") {
        throw cacheFailure(
          "lock_open_failed",
          "Could not open the managed pi-subagents dev artifact lock.",
          cause,
        );
      }
      if (Date.now() >= deadline) {
        throw cacheFailure("lock_timeout", LOCK_TIMEOUT_MESSAGE);
      }
      await new Promise((resolveSleep) => setTimeout(resolveSleep, pollMs));
      continue;
    }

    const acquiredHandle = handle;
    if (acquiredHandle === undefined) {
      throw cacheFailure(
        "lock_open_failed",
        "Could not open the managed pi-subagents dev artifact lock.",
      );
    }
    try {
      await acquiredHandle.writeFile(`${ownerToken}\n`, "utf8");
    } catch (cause) {
      try {
        await acquiredHandle.close();
        cacheFs.rmSync(lockPath, { force: true });
      } catch (cleanupCause) {
        throw cacheFailure(
          "lock_remove_failed",
          "Could not remove the managed pi-subagents dev artifact lock after lock setup failed.",
          cleanupCause,
        );
      }
      throw cacheFailure(
        "lock_write_failed",
        "Could not write the managed pi-subagents dev artifact lock.",
        cause,
      );
    }
    break;
  }

  const acquiredHandle = handle;
  if (acquiredHandle === undefined) {
    throw cacheFailure(
      "lock_open_failed",
      "Could not open the managed pi-subagents dev artifact lock.",
    );
  }
  try {
    return await run();
  } finally {
    await releasePinLock(lockPath, ownerToken, acquiredHandle, cacheFs);
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
  const cacheFs = resolveCacheFs(input.cacheFs);
  try {
    cacheFs.mkdirSync(cacheRoot, { recursive: true });
  } catch (cause) {
    throw cacheFailure(
      "cache_root_unavailable",
      "Could not create the managed pi-subagents dev artifact cache root.",
      cause,
    );
  }

  return withPinLock(
    cacheRoot,
    provenance.pinnedCommit,
    () =>
      prepareOnce({
        provenance,
        artifactDir,
        repoRoot: input.repoRoot,
        env: asRecord(input.env),
        cacheFs,
      }),
    { cacheFs },
  );
}
