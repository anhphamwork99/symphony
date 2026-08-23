// FILE: piSubagentNpmRuntimeClosure.ts
// Purpose: Ticket 01b (Decision 0006) — lock-proven, release-owned npm runtime
// dependency closure for the pinned Alfie `pi-subagents` extension. Selects the
// exact direct-runtime dependency set from the extension's npm lockfile v3 and
// materializes it from a fresh, isolated, lifecycle-script-disabled `npm ci`
// into regular-file artifact content.
// Layer: Release/build helper (same layer as piSubagentArtifactStaging.ts).
// Depends: the pinned Alfie checkout's
// `agent/extensions/pi-subagents/{package.json,package-lock.json}` and the
// npm registry/cache for a fresh lock install.
//
// Security posture (Decision 0006 Binding decisions 2–4):
// - Selection is proven from the lockfile, never a floating range: every
//   selected package carries an exact lock version + integrity digest.
// - Materialization NEVER reads the Alfie checkout's ambient `node_modules`
//   (or any user-global install): only `package.json` + `package-lock.json`
//   are copied into an isolated empty staging directory, and the install runs
//   there. Tampered tarballs are refused by npm's lock integrity enforcement.
// - Lifecycle scripts are disabled (`--ignore-scripts`), dev/optional
//   dependencies are excluded (`--omit=dev`/`--omit=optional` plus closure
//   filtering), link/file/git/local packages are rejected, `.bin` is never
//   staged, and every staged entry must be a regular file (no symlinks).
// - Peer dependencies are host-SDK APIs supplied by the packaged Pi host at
//   extension load (the SDK extension loader resolves them via jiti
//   alias/virtualModules, not artifact node_modules); they are deliberately
//   NOT part of the artifact closure and never materialized here.

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Bounded failure code vocabulary (build-time mirror of verifier categories). */
export type PiSubagentNpmRuntimeClosureErrorCode =
  | "lock_missing"
  | "lock_malformed"
  | "lock_root_map_mismatch"
  | "lock_package_missing"
  | "lock_package_ineligible"
  | "lock_integrity_missing"
  | "install_failed"
  | "install_output_invalid"
  | "ambient_source_forbidden"
  | "staged_entry_invalid";

export class PiSubagentNpmRuntimeClosureError extends Error {
  readonly code: PiSubagentNpmRuntimeClosureErrorCode;

  constructor(code: PiSubagentNpmRuntimeClosureErrorCode, message: string) {
    super(message);
    this.name = "PiSubagentNpmRuntimeClosureError";
    this.code = code;
  }
}

/** One lock-proven selected runtime dependency package. */
export interface NpmRuntimeClosurePackage {
  /** npm package name, e.g. `@sinclair/typebox`. */
  readonly name: string;
  /** Lock packages-tree key, e.g. `node_modules/@sinclair/typebox`. */
  readonly lockPath: string;
  /** Exact locked version (never a range). */
  readonly version: string;
  /** Lock integrity digest (`sha512-...`). */
  readonly integrity: string;
  /** Registry tarball URL the lock resolved the exact version from. */
  readonly resolved: string;
}

/** Result of lockfile-driven closure selection. */
export interface NpmRuntimeClosureSelection {
  readonly packages: ReadonlyArray<NpmRuntimeClosurePackage>;
  /**
   * Lock root package version. Deliberately informational only: the lock root
   * version may lag the package manifest; trust derives from the manifest +
   * pinned-commit verification, not this label.
   */
  readonly lockRootVersion: string;
}

interface LockPackagesEntry {
  readonly version?: unknown;
  readonly resolved?: unknown;
  readonly integrity?: unknown;
  readonly dev?: unknown;
  readonly devOptional?: unknown;
  readonly optional?: unknown;
  readonly link?: unknown;
  readonly dependencies?: Record<string, string> | undefined;
  readonly peerDependencies?: Record<string, string> | undefined;
}

interface LockfileShape {
  readonly lockfileVersion?: unknown;
  readonly packages?: Record<string, LockPackagesEntry>;
  readonly name?: unknown;
}

interface PackageManifestShape {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: Record<string, string> | undefined;
  readonly devDependencies?: Record<string, string> | undefined;
  readonly optionalDependencies?: Record<string, string> | undefined;
  readonly peerDependencies?: Record<string, string> | undefined;
}

function readJsonFile(
  filePath: string,
  errorCode: PiSubagentNpmRuntimeClosureErrorCode,
  label: string,
): unknown {
  if (!existsSync(filePath)) {
    throw new PiSubagentNpmRuntimeClosureError(errorCode, `${label} not found at '${filePath}'.`);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    throw new PiSubagentNpmRuntimeClosureError(
      "lock_malformed",
      `${label} at '${filePath}' is not parseable JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

function asRecord(
  value: unknown,
  errorCode: PiSubagentNpmRuntimeClosureErrorCode,
  label: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PiSubagentNpmRuntimeClosureError(
      errorCode,
      `${label} is malformed (expected an object).`,
    );
  }
  return value as Record<string, unknown>;
}

function normalizeDependencyMap(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, string>;
}

/**
 * Proves the lock root dependency/peer maps still describe exactly the same
 * dependency graph the extension package manifest declares. The lock ROOT
 * VERSION is deliberately NOT compared: it is metadata that frequently lags
 * the manifest (as it does on the pinned pin) and carries no selection trust.
 * A dependency-map mismatch means the lock no longer proves the manifest's
 * graph and staging fails closed.
 */
export function assertLockRootMatchesPackageManifest(input: {
  readonly lockRootPackagesEntry: LockPackagesEntry;
  readonly packageManifest: PackageManifestShape;
}): void {
  const lockDeps = normalizeDependencyMap(input.lockRootPackagesEntry.dependencies);
  const lockPeers = normalizeDependencyMap(input.lockRootPackagesEntry.peerDependencies) ?? {};
  const pkgDeps = normalizeDependencyMap(input.packageManifest.dependencies);
  const pkgPeers = normalizeDependencyMap(input.packageManifest.peerDependencies) ?? {};

  const sameMap = (
    a: Record<string, string> | undefined,
    b: Record<string, string> | undefined,
  ): boolean => {
    const aKeys = Object.keys(a ?? {}).sort();
    const bKeys = Object.keys(b ?? {}).sort();
    if (aKeys.length !== bKeys.length || aKeys.some((key, index) => key !== bKeys[index]))
      return false;
    return aKeys.every((key) => (a ?? {})[key] === (b ?? {})[key]);
  };

  if (!sameMap(lockDeps, pkgDeps) || !sameMap(lockPeers, pkgPeers)) {
    throw new PiSubagentNpmRuntimeClosureError(
      "lock_root_map_mismatch",
      "The extension lockfile root dependency/peer maps do not match package.json; the lock no longer proves the manifest dependency graph.",
    );
  }
}

function lockPathForPackage(name: string): string {
  return `node_modules/${name}`;
}

/**
 * Selects the exact lock-proven direct runtime closure from npm lockfile v3
 * content paired with the extension package manifest.
 *
 * Selection rules (fail-closed):
 * - Only the manifest's `dependencies` (direct normal runtime deps) seed the
 *   closure. `devDependencies`, `optionalDependencies`, and
 *   `peerDependencies` never seed it.
 * - The lock root maps must equal the manifest maps (version label exempt).
 * - Every selected entry must exist in `packages`, carry an exact `version`,
 *   an `integrity` digest, and a registry `resolved` tarball URL.
 * - `link`, `dev`, `devOptional`, and `optional` lock entries are ineligible.
 * - Transitive runtime `dependencies` of selected entries are followed
 *   recursively through the lock (the pinned pin has none, but the algorithm
 *   must be correct in general — a transitive miss fails closed).
 */
export function selectNpmRuntimeClosure(input: {
  readonly packageJson: unknown;
  readonly packageLockJson: unknown;
}): NpmRuntimeClosureSelection {
  const packageManifest = asRecord(
    input.packageJson,
    "lock_malformed",
    "Extension package.json",
  ) as PackageManifestShape;
  const lock = asRecord(
    input.packageLockJson,
    "lock_malformed",
    "Extension package-lock.json",
  ) as LockfileShape;

  if (lock.lockfileVersion !== 3) {
    throw new PiSubagentNpmRuntimeClosureError(
      "lock_malformed",
      `Unsupported lockfileVersion ${String(lock.lockfileVersion)}; expected npm lockfileVersion 3.`,
    );
  }
  const packages = asRecord(
    lock.packages,
    "lock_malformed",
    "Extension package-lock.json packages tree",
  ) as Record<string, LockPackagesEntry>;
  const lockRoot = packages[""];
  if (lockRoot === undefined) {
    throw new PiSubagentNpmRuntimeClosureError(
      "lock_malformed",
      "Lockfile has no root package entry.",
    );
  }

  assertLockRootMatchesPackageManifest({ lockRootPackagesEntry: lockRoot, packageManifest });

  const seedNames = Object.keys(normalizeDependencyMap(packageManifest.dependencies) ?? {}).sort();
  const selected = new Map<string, NpmRuntimeClosurePackage>();
  const queue = [...seedNames];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const name = queue.shift()!;
    const lockPath = lockPathForPackage(name);
    if (visited.has(name)) continue;
    visited.add(name);

    const entry = packages[lockPath];
    if (entry === undefined) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_package_missing",
        `Lockfile has no entry for direct runtime dependency '${name}' (${lockPath}).`,
      );
    }
    if (entry.link === true) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_package_ineligible",
        `Lockfile resolves '${name}' as a linked local package; link/file/git/local packages can never be release-owned runtime closure content.`,
      );
    }
    if (entry.dev === true || entry.devOptional === true || entry.optional === true) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_package_ineligible",
        `Lockfile marks runtime dependency '${name}' as dev/optional; dev and optional packages are excluded from the release runtime closure.`,
      );
    }
    const version = entry.version;
    const integrity = entry.integrity;
    const resolved = entry.resolved;
    if (typeof version !== "string" || version.length === 0) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_integrity_missing",
        `Lockfile entry '${name}' has no exact locked version.`,
      );
    }
    if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_integrity_missing",
        `Lockfile entry '${name}@${version}' has no sha512 integrity digest; refusing range-floating or integrity-unproven selection.`,
      );
    }
    if (typeof resolved !== "string" || !/^https:\/\/registry\./.test(resolved)) {
      throw new PiSubagentNpmRuntimeClosureError(
        "lock_package_ineligible",
        `Lockfile entry '${name}@${version}' is not resolved from a registry tarball URL; git/file/link sources are ineligible.`,
      );
    }

    selected.set(name, { name, lockPath, version, integrity, resolved });

    for (const transitiveName of Object.keys(
      normalizeDependencyMap(entry.dependencies) ?? {},
    ).sort()) {
      if (!visited.has(transitiveName)) queue.push(transitiveName);
    }
  }

  return {
    packages: [...selected.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
    lockRootVersion: typeof lockRoot.version === "string" ? lockRoot.version : "",
  };
}

/** Absolute source paths the closure reads from the pinned checkout. */
export function npmClosureSourcePaths(input: {
  readonly repoDir: string;
  readonly packageRootRelative: string;
}): {
  readonly packageJsonPath: string;
  readonly packageLockJsonPath: string;
} {
  return {
    packageJsonPath: join(input.repoDir, input.packageRootRelative, "package.json"),
    packageLockJsonPath: join(input.repoDir, input.packageRootRelative, "package-lock.json"),
  };
}

/**
 * Materializes the selected closure from a FRESH, isolated lock install.
 *
 * Isolation and integrity guarantees:
 * - Only `package.json` + `package-lock.json` are copied from the pinned
 *   checkout into a brand-new empty temp directory; the checkout's ambient
 *   `node_modules` is structurally never read (nothing else is copied, and
 *   `npm ci` refuses to run against a pre-populated tree it did not create —
 *   it removes any existing node_modules first).
 * - `npm ci --ignore-scripts --no-audit --no-fund --omit=dev --omit=optional`
 *   installs exactly the locked graph; npm enforces every lock `integrity`
 *   digest (a tampered tarball in the cache or registry fails the install).
 * - Only the closure-selected package directories are then copied into
 *   `destinationDir` (the artifact's `node_modules` root), sorted, with
 *   `.bin` never staged and every entry proven a regular file.
 */
export function materializeNpmRuntimeClosure(input: {
  readonly repoDir: string;
  /** Extension package root relative to repoDir, e.g. `agent/extensions/pi-subagents`. */
  readonly packageRootRelative: string;
  /** Artifact-relative destination directory name (always `node_modules`). */
  readonly destinationDirName: string;
  /** Absolute artifact directory under which `node_modules` is materialized. */
  readonly artifactDir: string;
  /** Pre-selected closure; when omitted it is selected from the pinned lock. */
  readonly selection?: NpmRuntimeClosureSelection;
  /** Overridable npm binary for tests. */
  readonly npmCommand?: string;
}): { readonly selection: NpmRuntimeClosureSelection; readonly stagedFileCount: number } {
  const destinationDirName = input.destinationDirName;
  if (destinationDirName !== "node_modules") {
    throw new PiSubagentNpmRuntimeClosureError(
      "ambient_source_forbidden",
      `Closure destination must be the artifact 'node_modules' root, got '${destinationDirName}'.`,
    );
  }

  const { packageJsonPath, packageLockJsonPath } = npmClosureSourcePaths({
    repoDir: input.repoDir,
    packageRootRelative: input.packageRootRelative,
  });
  const packageJson = readJsonFile(packageJsonPath, "lock_missing", "Extension package.json");
  const packageLockJson = readJsonFile(
    packageLockJsonPath,
    "lock_missing",
    "Extension package-lock.json",
  );
  const selection = input.selection ?? selectNpmRuntimeClosure({ packageJson, packageLockJson });
  if (selection.packages.length === 0) {
    throw new PiSubagentNpmRuntimeClosureError(
      "lock_package_missing",
      "The extension declares no direct runtime dependencies; nothing to materialize.",
    );
  }

  // Ambient source rejection: the checkout's own node_modules must never be
  // an install source. We prove this structurally — the install directory is
  // a brand-new empty temp dir seeded ONLY with the two manifest files.
  const installRoot = mkdtempSync(join(tmpdir(), "pi-subagent-closure-"));
  try {
    copyFileSync(packageJsonPath, join(installRoot, "package.json"));
    copyFileSync(packageLockJsonPath, join(installRoot, "package-lock.json"));

    const npm = input.npmCommand ?? "npm";
    // The install runs with `cwd` AT the isolated install root (never with
    // `--prefix`, which breaks `npm ci` root-name resolution): npm reads only
    // the two copied manifest files there and never the checkout's ambient
    // `node_modules`.
    const result = spawnSync(
      npm,
      [
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        "--omit=optional",
        "--no-workspaces",
      ],
      { cwd: installRoot, encoding: "utf8", maxBuffer: 64 * 1_024 * 1_024 },
    );
    if (result.error || result.status !== 0) {
      const stderr = (result.stderr ?? "").trim();
      throw new PiSubagentNpmRuntimeClosureError(
        "install_failed",
        `Fresh lock install of the pinned extension dependency graph failed: ${(result.error ?? stderr) || "unknown npm failure"}.`,
      );
    }

    const installedRoot = join(installRoot, "node_modules");
    if (!existsSync(installedRoot)) {
      throw new PiSubagentNpmRuntimeClosureError(
        "install_output_invalid",
        "Fresh lock install produced no node_modules output.",
      );
    }

    // Post-install verification: every selected package must exist with the
    // EXACT locked version — proving selection and install agree.
    for (const pkg of selection.packages) {
      // `pkg.lockPath` already carries the `node_modules/` prefix, so this
      // must join from the INSTALL ROOT, not from `installedRoot` (which
      // already ends in `node_modules`) — joining both would double it.
      const installedManifestPath = join(installRoot, pkg.lockPath, "package.json");
      if (!existsSync(installedManifestPath)) {
        throw new PiSubagentNpmRuntimeClosureError(
          "install_output_invalid",
          `Fresh lock install is missing selected package '${pkg.name}'.`,
        );
      }
      let installedManifest: unknown;
      try {
        installedManifest = JSON.parse(readFileSync(installedManifestPath, "utf8"));
      } catch (cause) {
        throw new PiSubagentNpmRuntimeClosureError(
          "install_output_invalid",
          `Installed '${pkg.name}' manifest is not parseable JSON: ${cause instanceof Error ? cause.message : String(cause)}.`,
        );
      }
      const manifestRecord = asRecord(
        installedManifest,
        "install_output_invalid",
        `Installed ${pkg.name} manifest`,
      );
      if (manifestRecord.version !== pkg.version) {
        throw new PiSubagentNpmRuntimeClosureError(
          "install_output_invalid",
          `Installed '${pkg.name}' version does not match the locked selection.`,
        );
      }
    }

    // Copy ONLY closure-selected packages into the artifact, regular files
    // only, .bin never staged, deterministic order.
    const artifactNodeModules = join(input.artifactDir, destinationDirName);
    let stagedFileCount = 0;
    for (const pkg of selection.packages) {
      // `pkg.lockPath` is install-root-relative (it starts with
      // `node_modules/`), so join from `installRoot` — not from
      // `installedRoot`, which already appends `node_modules`.
      const sourcePackageDir = join(installRoot, pkg.lockPath);
      // Recorded paths are relative to the installed/artifact `node_modules`
      // root, so the package's own directory segment stays in the path.
      const packageRootPrefix = pkg.lockPath.slice("node_modules/".length);
      const files = listRegularFilesRecursive(sourcePackageDir, pkg.lockPath, packageRootPrefix);
      if (files.length === 0) {
        throw new PiSubagentNpmRuntimeClosureError(
          "install_output_invalid",
          `Selected package '${pkg.name}' produced no regular files to stage.`,
        );
      }
      for (const relative of files) {
        const sourcePath = join(installRoot, "node_modules", relative);
        const stagedPath = join(artifactNodeModules, relative);
        mkdirSync(dirname(stagedPath), { recursive: true });
        copyFileSync(sourcePath, stagedPath);
        const stats = lstatSync(stagedPath);
        if (!stats.isFile()) {
          throw new PiSubagentNpmRuntimeClosureError(
            "staged_entry_invalid",
            `Staged dependency entry '${relative}' is not a regular file.`,
          );
        }
        stagedFileCount += 1;
      }
    }

    return { selection, stagedFileCount };
  } finally {
    rmSync(installRoot, { recursive: true, force: true });
  }
}

/**
 * Regular files under a package directory, sorted, rejecting symlinks/specials.
 * `.bin` shim directories are excluded at ANY depth (root-level npm bins and
 * bins nested inside a shipped package alike): executable shims are never
 * release runtime closure content. Returned paths are prefixed with
 * `pathPrefix` so they are relative to the `node_modules` root.
 */
function listRegularFilesRecursive(
  rootDir: string,
  packageLabel: string,
  pathPrefix: string,
): ReadonlyArray<string> {
  const collected: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === ".bin") {
        // `.bin` content is categorically never staged.
        continue;
      }
      const absolute = join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        throw new PiSubagentNpmRuntimeClosureError(
          "staged_entry_invalid",
          `Dependency package '${packageLabel}' contains a symbolic link at '${relative}'; staged records must be exact regular files.`,
        );
      }
      if (stats.isDirectory()) {
        walk(absolute, relative);
      } else if (stats.isFile()) {
        // Paths are relative to the installed `node_modules` root — the same
        // frame the artifact `node_modules` root uses.
        collected.push(pathPrefix ? `${pathPrefix}/${relative}` : relative);
      } else {
        throw new PiSubagentNpmRuntimeClosureError(
          "staged_entry_invalid",
          `Dependency package '${packageLabel}' contains a non-regular entry at '${relative}'.`,
        );
      }
    }
  };
  walk(rootDir, "");
  return collected.sort();
}
