// FILE: piSubagentArtifactStaging.ts
// Purpose: Build-time staging of the release-controlled official `pi-subagents`
// extension artifact into desktop resources, with a deterministic
// machine-verifiable manifest (Ticket 01 WP1b, AC1/AC4).
// Layer: Release/build helper
// Depends: clean pinned Alfie checkout (see
// apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json)
// and the WP1a manifest contracts in @synara/contracts.
//
// Build-time only. Git is used HERE to prove the source is the exact pinned
// clean checkout (Decision 0004 §3 forbids Git at production runtime — that
// belongs to the Ticket 01 verifier WP, not this module). User `~/.pi` files,
// credentials, auth/models configuration, and user-global extensions are
// never read, copied, or mutated: the only read surface is the pinned
// extension subtree of the supplied Alfie repository.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  PiSubagentArtifactManifest,
} from "@synara/contracts";
import { Schema } from "effect";

import {
  materializeNpmRuntimeClosure,
  npmClosureSourcePaths,
  PiSubagentNpmRuntimeClosureError,
  selectNpmRuntimeClosure,
  type NpmRuntimeClosureSelection,
} from "./piSubagentNpmRuntimeClosure.ts";
import {
  PiSubagentPromptClosureError,
  derivePromptClosureFromRepo,
} from "./piSubagentPromptClosureDerivation.ts";

/** Staged artifact directory name inside desktop resources. */
export const PI_SUBAGENT_ARTIFACT_DIR_NAME = "pi-subagents-artifact";

/** Generated manifest file name inside the staged artifact directory. */
export const PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME = "manifest.json";

/**
 * Path of the pin fixture relative to the Synara repository root. The fixture
 * is authoritative and read-only for this module.
 */
export const PI_SUBAGENT_EXTENSION_PROVENANCE_FIXTURE_RELATIVE_PATH =
  "apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json";

/** Extension subtree inside the Alfie repository that forms the artifact. */
const EXTENSION_RELATIVE_ROOT = "agent/extensions/pi-subagents";

/**
 * Ticket 01b (Decision 0006): the sibling shared modules the pinned extension
 * imports at load. Exactly these shared files are staged (the extension
 * imports nothing else from `agent/extensions/shared`), each `.js` runtime
 * file plus its `.d.ts` declaration so TS-hosted consumers stay coherent.
 */
const EXTENSION_SHARED_MODULE_BASENAMES = [
  "durable-preferences",
  "execution-identity",
  "model-catalog-reconciler",
] as const;

/** Shared subtree root inside the Alfie repository. */
const SHARED_RELATIVE_ROOT = "agent/extensions/shared";

/**
 * Ticket 01c (Decision 0010): the `agent/system` subtree inside the Alfie
 * repository whose prompt files are mechanically derived per pin. The
 * subtree root bounds the cleanliness/status Git checks; the exact staged
 * file set is ALWAYS the derivation result — there is deliberately no
 * hand-maintained per-file list (a changed dependency graph must update the
 * closure or fail the build, never silently omit content).
 */
const PROMPT_SYSTEM_RELATIVE_ROOT = "agent/system";

/**
 * The extension's own development-test subtree is not release runtime
 * material and is never staged. Everything else Git-tracks under the
 * extension root (package manifests, `src/`, `dist/`, root entry scripts,
 * package docs) is staged.
 */
const EXTENSION_EXCLUDED_SUBTREES = [`${EXTENSION_RELATIVE_ROOT}/test/`];

/** Extension entry whose literals declare the artifact capability profile. */
const EXTENSION_ENTRY_RELATIVE_PATH = `${EXTENSION_RELATIVE_ROOT}/src/index.ts`;

/** Contract caps mirrored for bounded enumeration before schema validation. */
const MAX_FILE_ENTRIES = 8_192;
const MAX_FILE_BYTES = 64 * 1_024 * 1_024;

/**
 * Prohibited payload vocabulary (Ticket 01 AC4). User authentication, model
 * configuration, API keys, and user-global extension content must never be
 * staged into the release artifact. Names are matched against the staged
 * relative path's basename (exact) and extension (exact, lower-cased).
 */
const PROHIBITED_BASENAMES = new Set(["auth.json", "models.json", "credentials.json"]);
const PROHIBITED_EXTENSIONS = new Set([".pem", ".key", ".p8", ".pfx"]);

/**
 * Bounded staging failure with a stable machine-readable code. Codes are the
 * build-time mirror of the verifier category vocabulary: they name the class
 * of problem without leaking user file contents.
 */
export type PiSubagentArtifactStagingErrorCode =
  | "alfie_repo_unresolved"
  | "not_a_git_repository"
  | "origin_mismatch"
  | "pinned_commit_mismatch"
  | "extension_tree_unclean"
  | "extension_tree_missing"
  | "package_identity_mismatch"
  | "pinned_hash_mismatch"
  | "prohibited_payload"
  | "symlink_in_source"
  | "capability_profile_invalid"
  | "dependency_closure_invalid"
  | "staging_output_invalid";

export class PiSubagentArtifactStagingError extends Error {
  readonly code: PiSubagentArtifactStagingErrorCode;

  constructor(code: PiSubagentArtifactStagingErrorCode, message: string) {
    super(message);
    this.name = "PiSubagentArtifactStagingError";
    this.code = code;
  }
}

/** Shape of the read-only pin fixture (see the JSON fixture for the source). */
export interface PiSubagentExtensionProvenanceFixture {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly extensionEntryRelativePath: string;
  readonly packageManifestRelativePath: string;
  readonly hashes: Readonly<Record<string, string>>;
}

/** Result of proving the supplied Alfie checkout is the pinned clean source. */
export interface VerifiedAlfieExtensionSource {
  readonly repoDir: string;
  readonly commit: string;
  readonly packageName: string;
  readonly packageVersion: string;
}

/** Result of staging the official artifact. */
export interface StagedPiSubagentArtifact {
  readonly artifactDir: string;
  readonly manifestPath: string;
  readonly manifest: typeof PiSubagentArtifactManifest.Type;
  readonly fileCount: number;
}

function git(repoDir: string, args: ReadonlyArray<string>): string {
  const result = spawnSync("git", args as string[], {
    cwd: repoDir,
    encoding: "buffer",
    maxBuffer: 64 * 1_024 * 1_024,
  });
  if (result.error || result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString("utf8").trim() : "";
    throw new PiSubagentArtifactStagingError(
      "not_a_git_repository",
      `Git command failed in the Alfie checkout (${args[0]}): ${stderr || result.error || "unknown git failure"}.`,
    );
  }
  return result.stdout.toString("utf8");
}

function normalizeGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4);
  }
  if (normalized.startsWith("git@github.com:")) {
    normalized = `https://github.com/${normalized.slice("git@github.com:".length)}`;
  }
  return normalized;
}

function computeSha256Bytes(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function computeSha256File(filePath: string): string {
  return computeSha256Bytes(readFileSync(filePath));
}

/**
 * Loads the read-only pin fixture that defines the exact clean Alfie source.
 */
export function loadPiSubagentExtensionProvenance(
  fixturePath: string,
): PiSubagentExtensionProvenanceFixture {
  if (!existsSync(fixturePath)) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_missing",
      `Pi subagent extension provenance fixture not found at ${fixturePath}.`,
    );
  }
  return JSON.parse(readFileSync(fixturePath, "utf8")) as PiSubagentExtensionProvenanceFixture;
}

/**
 * Resolves the Alfie repository directory, following the real-Pi test locator
 * convention: an explicit `ALFIE_REPO_DIR` wins; otherwise a version-controlled
 * `alfie` checkout sitting next to the Synara repository root is accepted.
 */
export function resolveAlfieRepoDir(repoRoot: string): string {
  const candidates = [
    process.env.ALFIE_REPO_DIR,
    process.env.ALFIE_EXTENSION_DIR
      ? resolve(process.env.ALFIE_EXTENSION_DIR, "../../..")
      : undefined,
    join(repoRoot, "..", "alfie"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const dir = resolve(candidate);
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
  }
  throw new PiSubagentArtifactStagingError(
    "alfie_repo_unresolved",
    "Could not locate the version-controlled Alfie repository for the managed pi-subagents artifact. Set ALFIE_REPO_DIR to the clean pinned checkout.",
  );
}

/**
 * Proves the supplied directory is the exact clean pinned Alfie source
 * (build-time only; mirrors the provenance discipline of
 * `apps/server/src/provider/piSubagentRealExtension.test.ts`):
 *
 * 1. it is a Git work tree whose origin matches the fixture;
 * 2. HEAD is exactly the pinned commit;
 * 3. the extension subtree has no uncommitted changes;
 * 4. the package name/version match the pin;
 * 5. every pinned per-file SHA-256 matches.
 *
 * A source outside the pinned commit or an unclean extension tree fails with
 * a bounded diagnostic before any staging output is accepted.
 */
export function verifyAlfieExtensionProvenance(input: {
  readonly repoDir: string;
  readonly provenance: PiSubagentExtensionProvenanceFixture;
}): VerifiedAlfieExtensionSource {
  const { provenance } = input;
  const repoDir = resolve(input.repoDir);

  const insideWorkTree = git(repoDir, ["rev-parse", "--is-inside-work-tree"]).trim();
  if (insideWorkTree !== "true") {
    throw new PiSubagentArtifactStagingError(
      "not_a_git_repository",
      `Managed pi-subagents artifact source '${repoDir}' is not a Git work tree.`,
    );
  }

  const originUrl = git(repoDir, ["config", "--get", "remote.origin.url"]).trim();
  if (normalizeGitUrl(originUrl) !== normalizeGitUrl(provenance.expectedRepositoryUrl)) {
    throw new PiSubagentArtifactStagingError(
      "origin_mismatch",
      "Managed pi-subagents artifact source repository origin does not match the pinned provenance fixture.",
    );
  }

  const headCommit = git(repoDir, ["rev-parse", "HEAD"]).trim().toLowerCase();
  if (headCommit !== provenance.pinnedCommit.toLowerCase()) {
    throw new PiSubagentArtifactStagingError(
      "pinned_commit_mismatch",
      "Managed pi-subagents artifact source HEAD does not match the pinned commit; refusing to stage unpinned extension bytes.",
    );
  }

  const extensionDir = join(repoDir, EXTENSION_RELATIVE_ROOT);
  if (!existsSync(join(extensionDir, "package.json"))) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_missing",
      `Managed pi-subagents extension tree not found at '${EXTENSION_RELATIVE_ROOT}' in the pinned source.`,
    );
  }

  const statusRaw = git(repoDir, ["status", "--porcelain", EXTENSION_RELATIVE_ROOT]).trim();
  const statusLines = statusRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("node_modules"));
  if (statusLines.length > 0) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_unclean",
      `Managed pi-subagents extension tree '${EXTENSION_RELATIVE_ROOT}' has uncommitted changes; refusing to stage unclean extension bytes.`,
    );
  }

  // Ticket 01b: the shared modules the extension imports must be proven at
  // the same pinned clean commit before their bytes enter the artifact.
  const sharedStatusRaw = git(repoDir, ["status", "--porcelain", SHARED_RELATIVE_ROOT]).trim();
  const sharedStatusLines = sharedStatusRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (sharedStatusLines.length > 0) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_unclean",
      `Managed pi-subagents shared tree '${SHARED_RELATIVE_ROOT}' has uncommitted changes; refusing to stage unclean shared bytes.`,
    );
  }

  const packageManifestPath = join(repoDir, provenance.packageManifestRelativePath);
  if (!existsSync(packageManifestPath)) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_missing",
      `Managed pi-subagents package manifest missing at '${provenance.packageManifestRelativePath}'.`,
    );
  }
  const pkg = JSON.parse(readFileSync(packageManifestPath, "utf8")) as {
    name?: unknown;
    version?: unknown;
  };
  if (pkg.name !== provenance.packageName || pkg.version !== provenance.packageVersion) {
    throw new PiSubagentArtifactStagingError(
      "package_identity_mismatch",
      "Managed pi-subagents package name/version does not match the pinned provenance fixture.",
    );
  }

  for (const [relativePath, expectedHash] of Object.entries(provenance.hashes)) {
    const fullPath = join(repoDir, relativePath);
    if (!existsSync(fullPath)) {
      throw new PiSubagentArtifactStagingError(
        "pinned_hash_mismatch",
        `Pinned file '${relativePath}' is missing from the managed pi-subagents source tree.`,
      );
    }
    if (computeSha256File(fullPath) !== expectedHash) {
      throw new PiSubagentArtifactStagingError(
        "pinned_hash_mismatch",
        `Pinned file '${relativePath}' does not match its recorded SHA-256; refusing to stage tampered extension bytes.`,
      );
    }
  }

  return {
    repoDir,
    commit: headCommit,
    packageName: pkg.name as string,
    packageVersion: pkg.version as string,
  };
}

/**
 * Computes the per-build allowlist of lock-proven runtime dependency package
 * directory prefixes that may be staged under the artifact `node_modules`
 * root (Ticket 01b, Decision 0006 Binding decision 2). Derived once from the
 * selected npm runtime closure and threaded explicitly through the build —
 * deliberately NOT process-global mutable state, so concurrent or failed
 * builds can never inherit a stale allowlist. Any other `node_modules`
 * content remains `prohibited_payload`.
 */
function computeAllowedNodeModulesPackagePrefixes(
  selection: NpmRuntimeClosureSelection,
): Set<string> {
  return new Set(selection.packages.map((pkg) => pkg.lockPath.slice("node_modules/".length)));
}

function assertNoProhibitedPayload(
  relativePath: string,
  allowedNodeModulesPackagePrefixes: ReadonlySet<string>,
): void {
  const segments = relativePath.split("/");
  const basename = segments[segments.length - 1] ?? "";
  const extension = basename.slice(basename.lastIndexOf(".")).toLowerCase();
  if (PROHIBITED_BASENAMES.has(basename)) {
    throw new PiSubagentArtifactStagingError(
      "prohibited_payload",
      `Managed pi-subagents artifact would stage prohibited payload '${basename}' at '${relativePath}'; user authentication/model configuration must never enter the release artifact.`,
    );
  }
  if (PROHIBITED_EXTENSIONS.has(extension)) {
    throw new PiSubagentArtifactStagingError(
      "prohibited_payload",
      `Managed pi-subagents artifact would stage prohibited key material '${basename}' at '${relativePath}'.`,
    );
  }
  const nodeModulesIndex = segments.indexOf("node_modules");
  if (nodeModulesIndex !== -1) {
    // `node_modules` content is staging-legal ONLY inside one of the
    // lock-proven closure package roots selected by THIS build (the set is
    // per-invocation — never process-global — so concurrent or failed
    // builds can never leak a stale allowlist). Everything else — ambient
    // installs, `.bin` shims, floating extras — stays rejected.
    if (segments[nodeModulesIndex + 1] === ".bin") {
      throw new PiSubagentArtifactStagingError(
        "prohibited_payload",
        `Managed pi-subagents artifact would stage a .bin shim at '${relativePath}'; executable shims are never release runtime content.`,
      );
    }
    const afterNodeModules = segments.slice(nodeModulesIndex + 1).join("/");
    if (
      ![...allowedNodeModulesPackagePrefixes].some(
        (prefix) => afterNodeModules === prefix || afterNodeModules.startsWith(`${prefix}/`),
      )
    ) {
      throw new PiSubagentArtifactStagingError(
        "prohibited_payload",
        `Managed pi-subagents artifact would stage dependency-tree content at '${relativePath}' outside the lock-proven runtime closure; only selected release-owned packages may be staged.`,
      );
    }
  }
}

/**
 * Extracts the artifact-declared protocol version and capability list from
 * the pinned extension entry source. The handshake literals in
 * `src/index.ts` (`PI_SUBAGENTS_PROTOCOL_VERSION`, `PI_SUBAGENT_CAPABILITIES`)
 * are the extension's own declaration, so the manifest profile is derived from
 * the pinned bytes instead of a duplicated host-side list that could drift.
 */
function extractDeclaredCapabilityProfile(
  entrySource: string,
): { protocolVersion: number; capabilities: ReadonlyArray<string> } {
  const protocolMatch = /const\s+PI_SUBAGENTS_PROTOCOL_VERSION\s*=\s*(\d+)\s*;/.exec(entrySource);
  const capabilitiesMatch =
    /const\s+PI_SUBAGENT_CAPABILITIES\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/.exec(entrySource);

  if (!protocolMatch || !capabilitiesMatch) {
    throw new PiSubagentArtifactStagingError(
      "capability_profile_invalid",
      "Could not derive the declared capability profile from the pinned pi-subagents extension entry source.",
    );
  }

  const protocolVersion = Number.parseInt(protocolMatch[1] as string, 10);
  const capabilities = [...capabilitiesMatch[1]!.matchAll(/"([^"\n]+)"/g)].map(
    (match) => match[1] as string,
  );

  if (!Number.isInteger(protocolVersion) || protocolVersion < 1 || capabilities.length === 0) {
    throw new PiSubagentArtifactStagingError(
      "capability_profile_invalid",
      "The pinned pi-subagents extension entry source declares an unusable capability profile.",
    );
  }

  const missing = PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.filter(
    (required) => !capabilities.includes(required),
  );
  if (missing.length > 0) {
    throw new PiSubagentArtifactStagingError(
      "capability_profile_invalid",
      `The pinned pi-subagents extension does not declare required capabilities: ${missing.join(", ")}.`,
    );
  }

  return { protocolVersion, capabilities };
}

/** Lists the exact shared runtime module files the pinned extension imports. */
function listSharedRuntimeFiles(repoDir: string): ReadonlyArray<string> {
  const relativePaths: string[] = [];
  for (const basename of EXTENSION_SHARED_MODULE_BASENAMES) {
    for (const suffix of [".js", ".d.ts"] as const) {
      const relativePath = `${SHARED_RELATIVE_ROOT}/${basename}${suffix}`;
      if (!existsSync(join(repoDir, relativePath))) {
        throw new PiSubagentArtifactStagingError(
          "extension_tree_missing",
          `Pinned shared runtime module '${relativePath}' is missing from the managed pi-subagents source tree.`,
        );
      }
      relativePaths.push(relativePath);
    }
  }
  // Shared runtime material is exactly the enumerated files — never a
  // directory walk, so unrelated shared-tree content can never enter.
  return relativePaths.sort();
}

/**
 * Ticket 01c (Decision 0010 Binding decision 3) — mechanically derives the
 * pinned extension's child-prompt runtime dependency closure from the clean
 * pinned source and proves every derived input is a tracked, clean,
 * non-empty, non-symlinked regular file strictly inside the repository
 * before its bytes may enter the artifact. No hand-maintained allowlist: a
 * future pin with a changed prompt-read graph rederives here and either
 * stages the new set or fails the build.
 *
 * Fail-close mapping (bounded, repository-relative diagnostics only):
 * - derivation analysis failure (dynamic/unresolved/unrecognized shape,
 *   escape, empty closure) → `dependency_closure_invalid`;
 * - derived input untracked or the `agent/system` tree dirty →
 *   `extension_tree_unclean`;
 * - derived input missing → `extension_tree_missing`;
 * - derived input empty → `staging_output_invalid`;
 * - derived input a symlink → `symlink_in_source`;
 * - derived input any other non-regular node → `staging_output_invalid`.
 */
function derivePromptClosureInputs(repoDir: string): ReadonlyArray<string> {
  let closure: { readonly promptPaths: ReadonlyArray<string> };
  try {
    closure = derivePromptClosureFromRepo({ repoDir });
  } catch (cause) {
    if (cause instanceof PiSubagentPromptClosureError) {
      throw new PiSubagentArtifactStagingError(
        "dependency_closure_invalid",
        `Managed pi-subagents prompt-closure derivation failed (${cause.code}): ${cause.message}`,
      );
    }
    throw cause;
  }

  // The whole agent/system subtree must be clean so derived bytes provably
  // come from the pinned commit (an untracked or modified prompt input is
  // ambient checkout state, never release content).
  const systemStatusRaw = git(repoDir, ["status", "--porcelain", PROMPT_SYSTEM_RELATIVE_ROOT]).trim();
  const systemStatusLines = systemStatusRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (systemStatusLines.length > 0) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_unclean",
      `Managed pi-subagents prompt tree '${PROMPT_SYSTEM_RELATIVE_ROOT}' has uncommitted changes; refusing to stage unclean prompt bytes.`,
    );
  }

  const trackedOutput = git(repoDir, [
    "ls-files",
    "-z",
    "--",
    PROMPT_SYSTEM_RELATIVE_ROOT,
  ]);
  const trackedSet = new Set(
    trackedOutput
      .split("\0")
      .map((entry) => entry.replace(/^\"|\"$/g, ""))
      .filter((entry) => entry.length > 0),
  );

  for (const relativePath of closure.promptPaths) {
    if (!trackedSet.has(relativePath)) {
      throw new PiSubagentArtifactStagingError(
        "extension_tree_unclean",
        `Derived prompt dependency '${relativePath}' is not tracked by the pinned commit; refusing to stage untracked prompt bytes.`,
      );
    }
    const sourcePath = join(repoDir, relativePath);
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(sourcePath);
    } catch {
      throw new PiSubagentArtifactStagingError(
        "extension_tree_missing",
        `Derived prompt dependency '${relativePath}' is missing from the managed pi-subagents source tree.`,
      );
    }
    if (stats.isSymbolicLink()) {
      throw new PiSubagentArtifactStagingError(
        "symlink_in_source",
        `Derived prompt dependency '${relativePath}' is a symbolic link; staged prompt records must be exact regular files.`,
      );
    }
    if (!stats.isFile()) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Derived prompt dependency '${relativePath}' is not a regular file.`,
      );
    }
    if (stats.size === 0) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Derived prompt dependency '${relativePath}' is empty; required prompt content must be non-empty.`,
      );
    }
  }

  return closure.promptPaths;
}

/** Lists the exact Git-tracked release-runtime files of the extension. */
function listTrackedExtensionFiles(repoDir: string): ReadonlyArray<string> {
  const output = git(repoDir, ["ls-files", "-z", "--", EXTENSION_RELATIVE_ROOT]);
  const relativePaths = output
    .split("\0")
    .map((entry) => entry.replace(/^"|"$/g, ""))
    .filter((entry) => entry.length > 0)
    .filter((entry) => !EXTENSION_EXCLUDED_SUBTREES.some((excluded) => entry.startsWith(excluded)))
    .sort();
  if (relativePaths.length === 0) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_missing",
      `The pinned source tracks no files under '${EXTENSION_RELATIVE_ROOT}'.`,
    );
  }
  if (relativePaths.length > MAX_FILE_ENTRIES) {
    throw new PiSubagentArtifactStagingError(
      "staging_output_invalid",
      `Managed pi-subagents artifact would stage ${relativePaths.length} files, over the bounded cap of ${MAX_FILE_ENTRIES}.`,
    );
  }
  return relativePaths;
}

function walkRegularFiles(rootDir: string, currentRelative = ""): ReadonlyArray<string> {
  const collected: string[] = [];
  for (const entry of readdirSync(rootDir).sort()) {
    const absolute = join(rootDir, entry);
    const relative = currentRelative ? `${currentRelative}/${entry}` : entry;
    const stats = lstatSync(absolute);
    if (stats.isDirectory()) {
      collected.push(...walkRegularFiles(absolute, relative));
    } else if (stats.isFile()) {
      collected.push(relative);
    } else {
      throw new PiSubagentArtifactStagingError(
        "symlink_in_source",
        `Staged artifact contains a non-regular entry at '${relative}'.`,
      );
    }
  }
  return collected;
}

/**
 * Assembles the deterministic official managed Pi subagent artifact (AC1)
 * from the verified pinned source into `artifactDir`:
 *
 * - enumerates exactly the Git-tracked extension runtime files (clean pinned
 *   bytes; `node_modules`, untracked content, and the extension's own test
 *   subtree can never enter);
 * - stages the exact shared runtime modules the extension imports;
 * - materializes the lock-proven runtime dependency closure from a fresh
 *   isolated `npm ci` (never the checkout's ambient `node_modules`);
 * - rejects prohibited payload (AC5) and symlinked sources;
 * - copies each file as a regular file and proves the staged bytes match the
 *   recorded size and SHA-256;
 * - emits `manifest.json` (not itself a manifest entry) carrying source
 *   identity, capability profile, and one exact record per staged file,
 *   serialized deterministically and validated against the WP1a contract.
 *
 * Atomic publish (Decision 0006 Binding decision 3/4 discipline): the whole
 * artifact is assembled in a TEMPORARY SIBLING directory of the destination
 * and only renamed into place AFTER the manifest decodes and the staged file
 * set proves exactly manifest-listed in both directions. Any failure leaves
 * the temporary sibling removed and a preexisting destination untouched —
 * there is never a partial accepted artifact at the destination.
 *
 * Identical pinned input reproduces byte-identical manifest output.
 */
export function buildPiSubagentArtifact(input: {
  readonly repoDir: string;
  readonly artifactDir: string;
  readonly provenance: PiSubagentExtensionProvenanceFixture;
  /** Overridable npm binary for tests of the dependency-closure leg. */
  readonly npmCommand?: string;
}): StagedPiSubagentArtifact {
  const verified = verifyAlfieExtensionProvenance({
    repoDir: input.repoDir,
    provenance: input.provenance,
  });

  const artifactDir = resolve(input.artifactDir);
  const stagingArtifactDir = `${artifactDir}.staging-${randomBytes(6).toString("hex")}`;
  mkdirSync(stagingArtifactDir, { recursive: true });
  try {
    const staged = assembleArtifactInto({
      stagingArtifactDir,
      verified,
      provenance: input.provenance,
      npmCommand: input.npmCommand,
    });

    // Atomic publish: only now, with the manifest validated and the staged
    // file set proven exactly manifest-listed, does the output become the
    // accepted destination. A preexisting destination is replaced; if the
    // rename fails the destination is not left partial (the old content was
    // removed only for this rename, and the staging sibling is cleaned up
    // below while the error propagates fail-closed).
    if (existsSync(artifactDir)) {
      rmSync(artifactDir, { recursive: true, force: true });
    }
    renameSync(stagingArtifactDir, artifactDir);
    return { ...staged, artifactDir, manifestPath: join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME) };
  } finally {
    rmSync(stagingArtifactDir, { recursive: true, force: true });
  }
}

/**
 * Assembles the complete artifact (extension + shared + dependency closure)
 * into `stagingArtifactDir` and returns the validated manifest result. The
 * caller owns publishing the staging directory to the accepted destination.
 */
function assembleArtifactInto(input: {
  readonly stagingArtifactDir: string;
  readonly verified: VerifiedAlfieExtensionSource;
  readonly provenance: PiSubagentExtensionProvenanceFixture;
  readonly npmCommand?: string;
}): StagedPiSubagentArtifact {
  const artifactDir = input.stagingArtifactDir;
  const verified = input.verified;

  const trackedFiles = listTrackedExtensionFiles(verified.repoDir);
  const sharedFiles = listSharedRuntimeFiles(verified.repoDir);
  // Ticket 01c: the prompt-closure inputs are derived AFTER provenance is
  // proven and BEFORE any staging output — mechanically from the pinned
  // source, never from a hand-maintained list (Decision 0010 Binding 3).
  const promptClosureFiles = derivePromptClosureInputs(verified.repoDir);
  const entrySourcePath = join(verified.repoDir, input.provenance.extensionEntryRelativePath);
  if (!existsSync(entrySourcePath)) {
    throw new PiSubagentArtifactStagingError(
      "extension_tree_missing",
      `Managed pi-subagents extension entry source missing at '${input.provenance.extensionEntryRelativePath}'.`,
    );
  }
  const declaredProfile = extractDeclaredCapabilityProfile(readFileSync(entrySourcePath, "utf8"));

  // Ticket 01b (Decision 0006 Binding decision 2): select the lock-proven
  // runtime closure BEFORE staging so the `node_modules` allowlist is exact,
  // then materialize it from a fresh isolated lock install (never ambient
  // source bytes) into the artifact root-level `node_modules`. An extension
  // with zero direct runtime dependencies simply stages no `node_modules`.
  const { packageJsonPath, packageLockJsonPath } = npmClosureSourcePaths({
    repoDir: verified.repoDir,
    packageRootRelative: EXTENSION_RELATIVE_ROOT,
  });
  const selection = selectNpmRuntimeClosure({
    packageJson: JSON.parse(readFileSync(packageJsonPath, "utf8")),
    packageLockJson: JSON.parse(readFileSync(packageLockJsonPath, "utf8")),
  });
  const allowedNodeModulesPackagePrefixes = computeAllowedNodeModulesPackagePrefixes(selection);
  if (selection.packages.length > 0) {
    try {
      materializeNpmRuntimeClosure({
        repoDir: verified.repoDir,
        packageRootRelative: EXTENSION_RELATIVE_ROOT,
        destinationDirName: "node_modules",
        artifactDir,
        selection,
        npmCommand: input.npmCommand,
      });
    } catch (cause) {
      if (cause instanceof PiSubagentNpmRuntimeClosureError) {
        throw new PiSubagentArtifactStagingError(
          "dependency_closure_invalid",
          `Managed pi-subagents runtime dependency closure failed (${cause.code}): ${cause.message}`,
        );
      }
      throw cause;
    }
  }

  const fileRecords: Array<{ path: string; sizeBytes: number; sha256: string }> = [];
  const stageFile = (relativePath: string): void => {
    assertNoProhibitedPayload(relativePath, allowedNodeModulesPackagePrefixes);

    const sourcePath = join(verified.repoDir, relativePath);
    const sourceStats = lstatSync(sourcePath);
    if (sourceStats.isSymbolicLink()) {
      throw new PiSubagentArtifactStagingError(
        "symlink_in_source",
        `Pinned pi-subagents source tracks a symbolic link at '${relativePath}'; staged records must be exact regular files.`,
      );
    }
    if (!sourceStats.isFile()) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Pinned pi-subagents source tracks a non-regular entry at '${relativePath}'.`,
      );
    }
    if (sourceStats.size > MAX_FILE_BYTES) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Pinned file '${relativePath}' exceeds the bounded per-file cap of ${MAX_FILE_BYTES} bytes.`,
      );
    }

    const stagedPath = join(artifactDir, relativePath);
    mkdirSync(dirname(stagedPath), { recursive: true });
    copyFileSync(sourcePath, stagedPath);

    // Prove the staged copy is an exact regular file with identical bytes.
    const stagedStats = lstatSync(stagedPath);
    if (!stagedStats.isFile()) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Staged entry '${relativePath}' is not a regular file.`,
      );
    }
    const stagedBytes = readFileSync(stagedPath);
    if (stagedBytes.length !== stagedStats.size) {
      throw new PiSubagentArtifactStagingError(
        "staging_output_invalid",
        `Staged entry '${relativePath}' changed while staging; refusing inconsistent output.`,
      );
    }
    fileRecords.push({
      path: relativePath,
      sizeBytes: stagedBytes.length,
      sha256: computeSha256Bytes(stagedBytes),
    });
  };

  for (const relativePath of [...trackedFiles, ...sharedFiles, ...promptClosureFiles].sort()) {
    stageFile(relativePath);
  }

  // Manifest-record the materialized dependency closure: every regular file
  // under the artifact `node_modules` root, digest-verified, `.bin` absent.
  const nodeModulesRoot = join(artifactDir, "node_modules");
  if (existsSync(nodeModulesRoot)) {
    const dependencyFiles = walkRegularFiles(nodeModulesRoot, "node_modules");
    for (const relativePath of dependencyFiles.sort()) {
      assertNoProhibitedPayload(relativePath, allowedNodeModulesPackagePrefixes);
      const stagedPath = join(artifactDir, relativePath);
      const stagedStats = lstatSync(stagedPath);
      if (!stagedStats.isFile() || stagedStats.size > MAX_FILE_BYTES) {
        throw new PiSubagentArtifactStagingError(
          "staging_output_invalid",
          `Staged dependency entry '${relativePath}' is not a bounded regular file.`,
        );
      }
      const stagedBytes = readFileSync(stagedPath);
      fileRecords.push({
        path: relativePath,
        sizeBytes: stagedBytes.length,
        sha256: computeSha256Bytes(stagedBytes),
      });
    }
  }
  if (fileRecords.length > MAX_FILE_ENTRIES) {
    throw new PiSubagentArtifactStagingError(
      "staging_output_invalid",
      `Managed pi-subagents artifact would stage ${fileRecords.length} files, over the bounded cap of ${MAX_FILE_ENTRIES}.`,
    );
  }

  const manifest: typeof PiSubagentArtifactManifest.Type = {
    schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
    sourceIdentity: {
      repositoryUrl: input.provenance.expectedRepositoryUrl,
      pinnedCommit: verified.commit,
      packageName: verified.packageName,
      packageVersion: verified.packageVersion,
    },
    capabilityProfile: {
      protocolVersion: declaredProfile.protocolVersion,
      capabilities: [...declaredProfile.capabilities],
      requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
    },
    files: fileRecords,
  };

  // Self-check: the generated manifest must decode against the WP1a contract
  // before the output is accepted.
  let validatedManifest: typeof PiSubagentArtifactManifest.Type;
  try {
    validatedManifest = Schema.decodeSync(PiSubagentArtifactManifest)(manifest);
  } catch (cause) {
    throw new PiSubagentArtifactStagingError(
      "staging_output_invalid",
      `Generated pi-subagents artifact manifest failed contract validation: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const manifestPath = join(artifactDir, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  // Exactness in both directions: every staged regular file (the manifest
  // itself excepted) must be listed, and every record must still exist.
  const stagedEntries = walkRegularFiles(artifactDir).filter(
    (relative) => relative !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME,
  );
  const listedPaths = new Set(validatedManifest.files.map((record) => record.path));
  if (stagedEntries.length !== listedPaths.size || !stagedEntries.every((path) => listedPaths.has(path))) {
    throw new PiSubagentArtifactStagingError(
      "staging_output_invalid",
      "Staged pi-subagents artifact content does not exactly match the generated manifest.",
    );
  }

  return {
    artifactDir,
    manifestPath,
    manifest: validatedManifest,
    fileCount: validatedManifest.files.length,
  };
}

/**
 * One-call desktop integration helper: resolves the Alfie checkout and stages
 * the verified official artifact under
 * `<desktopResourcesDir>/pi-subagents-artifact`.
 */
export function stagePiSubagentArtifactIntoDesktopResources(input: {
  readonly repoRoot: string;
  readonly desktopResourcesDir: string;
  readonly alfieRepoDir?: string;
}): StagedPiSubagentArtifact {
  const repoRoot = resolve(input.repoRoot);
  const provenance = loadPiSubagentExtensionProvenance(
    join(repoRoot, PI_SUBAGENT_EXTENSION_PROVENANCE_FIXTURE_RELATIVE_PATH),
  );
  const repoDir = input.alfieRepoDir ? resolve(input.alfieRepoDir) : resolveAlfieRepoDir(repoRoot);
  return buildPiSubagentArtifact({
    repoDir,
    provenance,
    artifactDir: join(resolve(input.desktopResourcesDir), PI_SUBAGENT_ARTIFACT_DIR_NAME),
  });
}
