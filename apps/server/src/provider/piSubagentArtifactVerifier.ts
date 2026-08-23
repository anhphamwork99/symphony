import {
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  PiSubagentArtifactManifest,
  type PiSubagentArtifactCapabilityProfile,
  type PiSubagentArtifactSourceIdentity,
  type PiSubagentArtifactVerificationCategory,
} from "@synara/contracts";
import { createHash, type Hash } from "node:crypto";
import * as fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import nodePath from "node:path";
import { Option, Schema } from "effect";

/** File handle type as produced by the default `node:fs/promises` seam. */
type ArtifactFileHandle = Awaited<ReturnType<typeof fs.open>>;

/**
 * Ticket 01 (handshake-first) — production runtime verifier for the managed
 * Pi subagent artifact (T01-AC2 / WP2).
 *
 * Pure verification that executes inside a packaged desktop server: it uses
 * ONLY standard Node filesystem/crypto primitives and the release-generated
 * manifest — never Git, never the network, never an Alfie checkout, and it
 * never reads, copies, or mutates the user's Pi directory (Decision 0004 §3).
 *
 * Fail-close contract (Decision 0002 / Decision 0004 §5):
 * - `verifyPiSubagentArtifact(root)` returns trusted manifest/source/
 *   capability metadata ONLY for a closed valid regular-file tree that
 *   exactly matches the generated manifest (size AND SHA-256 per record,
 *   exact file set in BOTH directions).
 * - Every other outcome is an invalid result carrying EXACTLY ONE category
 *   from the closed `PiSubagentArtifactVerificationCategory` vocabulary
 *   (WP1a contract — no divergent vocabulary here).
 * - There is NEVER a partial success: an invalid result carries no metadata,
 *   and a valid result carries no diagnostic.
 * - Diagnostics are bounded: the optional `entry` label is the manifest- or
 *   tree-normalized RELATIVE POSIX path (≤ the contract's 1024-char path
 *   bound). The verifier never places the absolute root, a raw filesystem
 *   error string, or a stack trace into any result — underlying `fs` errors
 *   are caught and collapsed onto a category.
 *
 * This module exports only the usable verifier result/error surface. The
 * desktop gate that must deny before SDK/global discovery (Decision 0004
 * §4/§5) and the PiAdapter wiring are owned by a different worker.
 */

/** Release-derived fixed manifest location inside the artifact root. */
export const PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME = "manifest.json";

/**
 * Upper bound on manifest bytes read. A schema-valid manifest for the
 * contract's 8 192-entry cap stays far below this; anything larger is
 * treated as malformed rather than read unbounded (hostile-input guard).
 */
const MAX_MANIFEST_BYTES = 4 * 1_024 * 1_024;

/**
 * Digest stream chunk size — bounds per-read memory while hashing artifact
 * files (the manifest's per-file size cap keeps total bytes bounded).
 */
const DIGEST_CHUNK_BYTES = 256 * 1_024;

/** Trusted, bounded metadata a VALID verification returns (Decision 0004 §3). */
export interface PiSubagentArtifactVerifiedMetadata {
  /** Clean pinned Alfie source identity recorded by the release pipeline. */
  readonly sourceIdentity: PiSubagentArtifactSourceIdentity;
  /** Protocol/capability profile proven against the required desktop profile. */
  readonly capabilityProfile: PiSubagentArtifactCapabilityProfile;
}

/** Valid outcome — trusted metadata only, no diagnostic surface. */
export interface PiSubagentArtifactValidVerification {
  readonly valid: true;
  readonly metadata: PiSubagentArtifactVerifiedMetadata;
}

/**
 * Invalid outcome — fail-close result with exactly one closed category and
 * an optional normalized RELATIVE entry label. Never carries absolute
 * paths, raw filesystem errors, or stack traces.
 */
export interface PiSubagentArtifactInvalidVerification {
  readonly valid: false;
  readonly category: PiSubagentArtifactVerificationCategory;
  /** Bounded normalized relative label, when a single entry is implicated. */
  readonly entry?: string | undefined;
}

/**
 * The one result type the verifier produces. `valid === false` is the
 * deny signal; `valid === true` is the only trusted-metadata surface.
 */
export type PiSubagentArtifactVerification =
  | PiSubagentArtifactValidVerification
  | PiSubagentArtifactInvalidVerification;

/**
 * Injectable filesystem seam (deterministic test errors; default = Node).
 * Shaped to exactly the surface the verifier consumes — no broader Node
 * typing leaks into the verification path.
 */
export interface PiSubagentArtifactVerifierFs {
  readonly lstat: (path: string) => Promise<Stats>;
  readonly stat: (path: string) => Promise<Stats>;
  readonly readdir: (
    path: string,
    options: { readonly withFileTypes: true },
  ) => Promise<Array<Dirent>>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly open: (path: string, flags: "r") => Promise<ArtifactFileHandle>;
}

/** Injectable hashing seam (default = Node crypto). */
export interface PiSubagentArtifactVerifierCrypto {
  readonly createHash: (algorithm: "sha256") => Hash;
}

export interface VerifyPiSubagentArtifactOptions {
  /** Filesystem seam override (tests); defaults to `node:fs/promises`. */
  readonly fsLike?: PiSubagentArtifactVerifierFs | undefined;
  /** Crypto seam override (tests); defaults to `node:crypto`. */
  readonly cryptoLike?: PiSubagentArtifactVerifierCrypto | undefined;
}

const defaultFsLike: PiSubagentArtifactVerifierFs = {
  lstat: (path) => fs.lstat(path),
  stat: (path) => fs.stat(path),
  readdir: (path, options) => fs.readdir(path, options),
  readFile: (path) => fs.readFile(path),
  open: (path, flags) => fs.open(path, flags),
};

const defaultCryptoLike: PiSubagentArtifactVerifierCrypto = { createHash };

const invalid = (
  category: PiSubagentArtifactVerificationCategory,
  entry?: string | undefined,
): PiSubagentArtifactInvalidVerification =>
  entry === undefined ? { valid: false, category } : { valid: false, category, entry };

/**
 * Bounded diagnostic label. Clamps to the contract's relative-path length
 * bound so even a hostile tree name cannot balloon the diagnostic; the
 * label itself is already a normalized relative POSIX path by construction
 * (manifest records decode through the contract schema; walk labels are
 * joined from readdir names).
 */
const boundedEntryLabel = (label: string): string => label.slice(0, 1_024);

const isControlCharacter = (char: string): boolean =>
  char.charCodeAt(0) <= 0x1f || char.charCodeAt(0) === 0x7f;

/**
 * Normalized relative POSIX label for one walked tree entry. Returns
 * `undefined` when the label is entry-safe, and the offending label when a
 * path component itself is unsafe (empty, `.`/`..`, backslash-separated,
 * control characters, or trailing/leading whitespace) — the caller maps
 * that to `path_escape`.
 */
const unsafeTreeLabel = (label: string): string | undefined => {
  if (label === "" || label !== label.trim()) return label;
  if (label.includes("\\")) return label;
  const segments = label.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === ".." || segment !== segment.trim()) {
      return label;
    }
    for (const char of segment) {
      if (isControlCharacter(char)) return label;
    }
  }
  return undefined;
};

interface ArtifactTreeWalk {
  /** Failure detected during the walk (first by deterministic order). */
  readonly failure?: PiSubagentArtifactInvalidVerification | undefined;
  /** Regular files found, keyed by normalized relative POSIX label. */
  readonly files?: ReadonlyMap<string, Stats> | undefined;
}

/**
 * Deterministic recursive walk of the artifact tree.
 *
 * - EVERY entry is `lstat`ed: a symbolic link is denied wherever it appears
 *   (file or directory, listed or unlisted, at any depth) — the contract
 *   rejects symlinked records outright and this walk extends that to the
 *   whole tree (WP2 requirement).
 * - Unsafe directory/file names (escape-shaped or control-character labels)
 *   are `path_escape`.
 * - Anything that is neither a regular file nor a directory (fifo, socket,
 *   device) is `unlisted_entry` — the manifest can only list exact regular
 *   files, so such content is by definition outside the declared set.
 * - The manifest file itself is walked for safety (a root-level
 *   `manifest.json` symlink is denied) but is EXCLUDED from the file set:
 *   a manifest cannot carry its own digest, so the release pipeline never
 *   lists it and the verifier never compares it against itself.
 */
const walkArtifactTree = async (
  root: string,
  fsLike: PiSubagentArtifactVerifierFs,
): Promise<ArtifactTreeWalk> => {
  const files = new Map<string, Stats>();
  // Depth-first with sorted entries at every level: the first failure is a
  // deterministic function of the tree alone, not of readdir order.
  const stack: Array<{ readonly dir: string; readonly label: string }> = [{ dir: root, label: "" }];
  while (stack.length > 0) {
    const { dir, label } = stack.pop() as { dir: string; label: string };
    let entries: Array<Dirent>;
    try {
      entries = await fsLike.readdir(dir, { withFileTypes: true });
    } catch {
      // An unreadable tree cannot be proven closed — deny as unlisted
      // content without leaking the underlying error.
      return { failure: invalid("unlisted_entry", boundedEntryLabel(label || ".")) };
    }
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const entryLabel = label === "" ? entry.name : `${label}/${entry.name}`;
      const unsafe = unsafeTreeLabel(entryLabel);
      if (unsafe !== undefined) {
        return { failure: invalid("path_escape", boundedEntryLabel(unsafe)) };
      }
      const entryPath = nodePath.join(dir, entry.name);
      let stats: Stats;
      try {
        // lstat (never stat): the link ITSELF is the trust question.
        stats = await fsLike.lstat(entryPath);
      } catch {
        return { failure: invalid("entry_missing", boundedEntryLabel(entryLabel)) };
      }
      if (stats.isSymbolicLink()) {
        return { failure: invalid("symlink_escape", boundedEntryLabel(entryLabel)) };
      }
      if (stats.isDirectory()) {
        stack.push({ dir: entryPath, label: entryLabel });
        continue;
      }
      if (!stats.isFile()) {
        return { failure: invalid("unlisted_entry", boundedEntryLabel(entryLabel)) };
      }
      if (label === "" && entry.name === PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME) {
        // The trusted manifest itself — safety-checked above, never
        // self-compared.
        continue;
      }
      files.set(entryLabel, stats);
    }
  }
  return { files };
};

/**
 * Streams one regular file and returns its exact byte size and SHA-256,
 * with TOCTOU discipline mirroring `updateArtifactIdentity.ts`: the stats
 * observed on the open descriptor must still match the path entry before
 * AND after hashing, or the file is treated as replaced mid-verification.
 */
const hashArtifactFile = async (
  absolutePath: string,
  fsLike: PiSubagentArtifactVerifierFs,
  cryptoLike: PiSubagentArtifactVerifierCrypto,
  expected: Stats,
): Promise<{ readonly sizeBytes: number; readonly sha256: string } | null> => {
  const handle = await fsLike.open(absolutePath, "r");
  try {
    const openedBefore = await handle.stat();
    if (
      !openedBefore.isFile() ||
      openedBefore.size !== expected.size ||
      openedBefore.dev !== expected.dev ||
      (openedBefore.ino !== 0 && expected.ino !== 0 && openedBefore.ino !== expected.ino)
    ) {
      return null;
    }
    const hash = cryptoLike.createHash("sha256");
    const stream = handle.createReadStream({
      autoClose: false,
      highWaterMark: DIGEST_CHUNK_BYTES,
    });
    await new Promise<void>((resolveHash, rejectHash) => {
      stream.on("data", (chunk: Buffer | string) => {
        hash.update(chunk);
      });
      stream.once("error", rejectHash);
      stream.once("end", resolveHash);
    });
    const openedAfter = await handle.stat();
    if (
      !openedAfter.isFile() ||
      openedAfter.size !== openedBefore.size ||
      openedAfter.mtimeMs !== openedBefore.mtimeMs ||
      openedAfter.dev !== openedBefore.dev ||
      (openedAfter.ino !== 0 && openedBefore.ino !== 0 && openedAfter.ino !== openedBefore.ino)
    ) {
      return null;
    }
    return { sizeBytes: openedAfter.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
};

/**
 * Verifies the managed Pi subagent artifact rooted at `root`.
 *
 * Deterministic category precedence (first failure wins, single category):
 *  1. root absent / not a directory → `manifest_missing`
 *     root itself a symbolic link → `symlink_escape`
 *  2. manifest absent / not a regular file → `manifest_missing`
 *     manifest a symbolic link → `symlink_escape`
 * 3. manifest bytes unreadable, over the bounded size, or failing
 *    `PiSubagentArtifactManifest` decode (incl. wrong `schemaVersion`)
 *    → `manifest_malformed`
 * 4. declared capabilities do not cover the required desktop profile
 *    → `capability_profile_invalid`
 * 5. recursive tree walk: any symlink anywhere → `symlink_escape`;
 *    unsafe/escaping entry label → `path_escape`; non-regular unlisted
 *    node → `unlisted_entry`
 * 6. per manifest record (sorted): declared entry absent →
 *    `entry_missing`; resolved record path escapes the root →
 *    `path_escape`; size or digest mismatch (incl. replacement
 *    mid-verification) → `digest_mismatch`
 * 7. any actual file not declared (sorted) → `unlisted_entry`
 */
export async function verifyPiSubagentArtifact(
  root: string,
  options: VerifyPiSubagentArtifactOptions = {},
): Promise<PiSubagentArtifactVerification> {
  const fsLike = options.fsLike ?? defaultFsLike;
  const cryptoLike = options.cryptoLike ?? defaultCryptoLike;

  // 1. Artifact root must be a real directory (a symlinked root is denied
  //    as a symlinked artifact path, Decision 0004 §3).
  let rootStats: Stats;
  try {
    rootStats = await fsLike.lstat(root);
  } catch {
    return invalid("manifest_missing");
  }
  if (rootStats.isSymbolicLink()) return invalid("symlink_escape");
  if (!rootStats.isDirectory()) return invalid("manifest_missing");

  // 2. The manifest must exist as a regular file at the fixed location.
  const manifestLabel = PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME;
  const manifestPath = nodePath.join(root, manifestLabel);
  let manifestStats: Stats;
  try {
    manifestStats = await fsLike.lstat(manifestPath);
  } catch {
    return invalid("manifest_missing", manifestLabel);
  }
  if (manifestStats.isSymbolicLink()) return invalid("symlink_escape", manifestLabel);
  if (!manifestStats.isFile()) {
    // A non-file node at the manifest location means there IS no manifest
    // file there (contract: `manifest_missing` — "no manifest at the
    // release-derived location"); `manifest_malformed` is reserved for
    // manifest bytes that exist but do not decode.
    return invalid("manifest_missing", manifestLabel);
  }
  if (manifestStats.size > MAX_MANIFEST_BYTES) {
    return invalid("manifest_malformed", manifestLabel);
  }

  // 3. Decode the manifest bytes against the WP1a contract. The schema is
  //    the sole authority; any deviation (including wrong schemaVersion,
  //    bad digests, duplicate records, weak capability profile shape) is
  //    `manifest_malformed`.
  let manifestJson: unknown;
  try {
    const bytes = await fsLike.readFile(manifestPath);
    manifestJson = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalid("manifest_malformed", manifestLabel);
  }
  const decodedManifest = Schema.decodeUnknownOption(PiSubagentArtifactManifest)(manifestJson);
  if (Option.isNone(decodedManifest)) {
    return invalid("manifest_malformed", manifestLabel);
  }
  const manifest = decodedManifest.value;

  // 4. The artifact's DECLARED capabilities must satisfy the required
  //    desktop profile. The schema already forces `requiredCapabilities`
  //    to carry the seven mandated capabilities; this proves the artifact
  //    itself declares everything the release requires of it (spec
  //    Implementation Decision 4 — trust derives from the negotiated
  //    capability profile, never from version labels).
  const declared = new Set(manifest.capabilityProfile.capabilities);
  const requiredProfileSatisfied = [
    ...manifest.capabilityProfile.requiredCapabilities,
    ...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  ].every((capability) => declared.has(capability));
  if (!requiredProfileSatisfied) {
    return invalid("capability_profile_invalid");
  }

  // 5. Deterministic recursive walk: deny ANY symlink in the tree (not just
  //    manifest entries), escape-shaped labels, and non-regular nodes.
  const walk = await walkArtifactTree(root, fsLike);
  if (walk.failure !== undefined) return walk.failure;
  const actualFiles = walk.files as Map<string, Stats>;

  // 6. Per manifest record, sorted by path for a deterministic first
  //    failure. Defense-in-depth: the joined path must resolve inside the
  //    root (the schema's normalization already forbids `..`, absolute,
  //    and backslash shapes; the runtime resolution check is the
  //    guarantee that a manifest record can never address content outside
  //    the artifact root).
  const records = manifest.files.toSorted((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const rootResolved = nodePath.resolve(root);
  for (const record of records) {
    const recordPath = nodePath.resolve(root, record.path);
    if (recordPath !== rootResolved && !recordPath.startsWith(`${rootResolved}${nodePath.sep}`)) {
      return invalid("path_escape", boundedEntryLabel(record.path));
    }
    const actualStats = actualFiles.get(record.path);
    if (actualStats === undefined) {
      return invalid("entry_missing", boundedEntryLabel(record.path));
    }
    if (actualStats.size !== record.sizeBytes) {
      return invalid("digest_mismatch", boundedEntryLabel(record.path));
    }
    let hashed: { readonly sizeBytes: number; readonly sha256: string } | null;
    try {
      hashed = await hashArtifactFile(recordPath, fsLike, cryptoLike, actualStats);
    } catch {
      // Unreadable/replaced content cannot be proven — tampered bytes.
      return invalid("digest_mismatch", boundedEntryLabel(record.path));
    }
    if (
      hashed === null ||
      hashed.sizeBytes !== record.sizeBytes ||
      hashed.sha256 !== record.sha256
    ) {
      return invalid("digest_mismatch", boundedEntryLabel(record.path));
    }
  }

  // 7. Exact file set, both directions: anything on disk that the manifest
  //    does not declare is unlisted. The root-level manifest file itself is
  //    excluded from the walked set (a manifest cannot carry its own
  //    digest), so only content the release pipeline should have declared
  //    is compared.
  const declaredPaths = new Set(manifest.files.map((record) => record.path));
  const unlisted = [...actualFiles.keys()].toSorted().find((label) => !declaredPaths.has(label));
  if (unlisted !== undefined) {
    return invalid("unlisted_entry", boundedEntryLabel(unlisted));
  }

  // Closed valid tree matching the generated manifest — the only trusted
  // metadata surface (bounded by the contract schemas; no paths, no
  // filesystem detail, no partial-success fields).
  return {
    valid: true,
    metadata: {
      sourceIdentity: manifest.sourceIdentity,
      capabilityProfile: manifest.capabilityProfile,
    },
  };
}
