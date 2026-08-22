import { Schema } from "effect";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";
import { PiSubagentCapability } from "./piSubagents";

/**
 * Ticket 01 (handshake-first) — official managed Pi subagent artifact
 * manifest and verifier-category contracts.
 *
 * These are pure Effect Schema contracts only. They define the shape of the
 * machine-verifiable manifest that the desktop release pipeline generates
 * next to the staged official `pi-subagents` artifact, and the closed
 * failure-category vocabulary the Ticket 01 production verifier reports.
 * They deliberately contain NO runtime logic: no fs, no crypto, no Git —
 * the verifier that consumes them lives with the desktop artifact gate and
 * trusts manifest/digest material only (Decision 0004 §3).
 */

/**
 * Manifest schema version. This is the version of the MANIFEST SHAPE, not
 * of the extension package; it lets a future manifest add fields without
 * the verifier guessing how to read an unknown layout. `1` is the only
 * version defined by this contract.
 */
export const PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;

/** Bounded URL/repository identity lengths (diagnostic-safe metadata only). */
const ARTIFACT_URL_MAX_LENGTH = 2_048;
const ARTIFACT_PACKAGE_NAME_MAX_LENGTH = 214;
const ARTIFACT_PACKAGE_VERSION_MAX_LENGTH = 128;
const ARTIFACT_RELATIVE_PATH_MAX_LENGTH = 1_024;

/** Cap on distinct file records one manifest may carry. */
const ARTIFACT_MAX_FILE_ENTRIES = 8_192;

/** Per-file byte-size cap: an official extension artifact is never huge. */
const ARTIFACT_MAX_FILE_BYTES = 64 * 1_024 * 1_024;

/**
 * Clean pinned Alfie source identity (Decision 0001, spec Further Notes).
 * The release pipeline records where the artifact was assembled from; the
 * production verifier never invokes Git to re-derive it (Decision 0004 §3).
 */
export const PiSubagentArtifactSourceIdentity = Schema.Struct({
  /** Repository URL of the pinned clean source checkout. */
  repositoryUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(ARTIFACT_URL_MAX_LENGTH),
    Schema.isPattern(/^https:\/\/[^\s]+$/u),
  ),
  /** Full pinned commit hash (40 lowercase hex characters). */
  pinnedCommit: TrimmedNonEmptyString.check(Schema.isPattern(/^[0-9a-f]{40}$/u)),
  /** Package identity of the official extension artifact. */
  packageName: TrimmedNonEmptyString.check(Schema.isMaxLength(ARTIFACT_PACKAGE_NAME_MAX_LENGTH)),
  /**
   * Package version label — diagnostic information only. Trust derives from
   * the verified artifact and negotiated capability profile, never from this
   * label (spec Implementation Decision 4).
   */
  packageVersion: TrimmedNonEmptyString.check(
    Schema.isMaxLength(ARTIFACT_PACKAGE_VERSION_MAX_LENGTH),
  ),
});
export type PiSubagentArtifactSourceIdentity = typeof PiSubagentArtifactSourceIdentity.Type;

/** Capability required from the official artifact by the managed harness. */
const ArtifactCapability = Schema.Union([PiSubagentCapability, TrimmedNonEmptyString]);

/**
 * The capability profile the desktop release requires of the official
 * artifact (spec Implementation Decision 4). The required set is closed at
 * the CONTRACT level for the seven decision-mandated capabilities; the
 * manifest carries them so the verifier can prove the profile, and a
 * manifest whose required profile is not a superset of this set is
 * `capability_profile_invalid` (the verifier checks the superset relation;
 * this schema keeps the literal set visible to consumers).
 */
export const PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "bounded-foreground-attachment",
  "coalesced-progress",
  "durable-cancellation",
  "journal-terminal-lifecycle",
  "child-bash-process-ownership",
] as const;

/**
 * Protocol and capability profile carried by the manifest. `protocolVersion`
 * uses the existing pi-subagents handshake protocol version family so the
 * manifest profile and the runtime handshake speak the same numbering.
 */
export const PiSubagentArtifactCapabilityProfile = Schema.Struct({
  protocolVersion: PositiveInt,
  /** Capabilities the artifact itself declares. */
  capabilities: Schema.Array(ArtifactCapability)
    .check(Schema.isMinLength(1))
    .check(Schema.makeFilter((value) => new Set(value).size === value.length)),
  /**
   * Capability profile the release requires of this artifact. Always carries
   * the seven decision-mandated capabilities at minimum (enforced by filter,
   * not by exact equality, so a future release may require more).
   */
  requiredCapabilities: Schema.Array(ArtifactCapability)
    .check(Schema.isMinLength(1))
    .check(Schema.makeFilter((value) => new Set(value).size === value.length))
    .check(
      Schema.makeFilter((value) => {
        const present = new Set(value);
        return PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.every((capability) =>
          present.has(capability),
        );
      }),
    ),
});
export type PiSubagentArtifactCapabilityProfile = typeof PiSubagentArtifactCapabilityProfile.Type;

/**
 * Exactly-normalized relative POSIX file path inside the artifact.
 *
 * Normalization rules the schema enforces (the release pipeline MUST emit
 * this shape; the verifier treats any deviation as malformed):
 * - relative only — no leading `/`, no drive letter, no `file:` scheme;
 * - no `.` or `..` segments — nothing may escape the artifact root;
 * - no empty or whitespace segments, no backslashes, no NUL;
 * - no leading/trailing whitespace anywhere — a file record is exact, so
 *   unlike free-text fields this schema does NOT silently trim;
 * - no trailing slash — records are regular files, never directories.
 */
const hasControlCharacter = (text: string): boolean =>
  Array.from(text).some(
    (char) => char.charCodeAt(0) <= 0x1f /* C0 controls */ || char.charCodeAt(0) === 0x7f /* DEL */,
  );

const isNormalizedArtifactRelativePath = (value: string): boolean => {
  if (value === "") return false;
  if (value !== value.trim()) return false;
  if (value.includes("\\")) return false;
  if (value.includes("\0")) return false;
  if (value.startsWith("/")) return false;
  if (value.endsWith("/")) return false;
  const segments = value.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment === segment.trim() &&
      !hasControlCharacter(segment),
  );
};

export const PiSubagentArtifactRelativePath = Schema.String.check(
  Schema.isMaxLength(ARTIFACT_RELATIVE_PATH_MAX_LENGTH),
).check(Schema.makeFilter(isNormalizedArtifactRelativePath));
export type PiSubagentArtifactRelativePath = typeof PiSubagentArtifactRelativePath.Type;

/** Lower-case hexadecimal SHA-256 digest, exactly 64 characters. */
export const PiSubagentArtifactSha256 = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u),
);
export type PiSubagentArtifactSha256 = typeof PiSubagentArtifactSha256.Type;

/**
 * One exact regular-file record. The verifier proves, per record, that the
 * artifact contains a regular file at this normalized path, with exactly
 * this byte size, whose SHA-256 is exactly this digest. Size must be a
 * bounded non-negative integer; zero-byte files are legitimate (e.g. an
 * empty `.gitkeep` marker inside the staged tree).
 */
export const PiSubagentArtifactFileRecord = Schema.Struct({
  path: PiSubagentArtifactRelativePath,
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(ARTIFACT_MAX_FILE_BYTES)),
  sha256: PiSubagentArtifactSha256,
});
export type PiSubagentArtifactFileRecord = typeof PiSubagentArtifactFileRecord.Type;

/**
 * The official managed Pi subagent artifact manifest (Ticket 01 AC1).
 *
 * Immutability comes from the release pipeline: the manifest is generated
 * once next to the staged artifact and travels with it through the desktop
 * resource pipeline with matching server trust metadata (spec
 * Implementation Decision 3). Duplicate file records are rejected — the
 * file set is exact, so any duplicate is tampering or corruption, never
 * something the verifier merges.
 */
export const PiSubagentArtifactManifest = Schema.Struct({
  schemaVersion: Schema.Literal(PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION),
  sourceIdentity: PiSubagentArtifactSourceIdentity,
  capabilityProfile: PiSubagentArtifactCapabilityProfile,
  files: Schema.Array(PiSubagentArtifactFileRecord)
    .check(Schema.isMinLength(1))
    .check(Schema.isMaxLength(ARTIFACT_MAX_FILE_ENTRIES))
    .check(
      Schema.makeFilter((value) => {
        const seen = new Set<string>();
        for (const record of value) {
          if (seen.has(record.path)) return false;
          seen.add(record.path);
        }
        return true;
      }),
    ),
});
export type PiSubagentArtifactManifest = typeof PiSubagentArtifactManifest.Type;

/**
 * Closed verifier failure-category vocabulary (Ticket 01 AC2).
 *
 * Every value is a bounded, actionable category — the verifier maps an
 * underlying error onto exactly one of these and never leaks paths,
 * credentials, or provider configuration into the diagnostic (spec user
 * story 18; Decision 0004 §3 "bounded metadata").
 *
 * - `manifest_missing` — no manifest at the release-derived location, or the
 *   artifact directory itself is absent.
 * - `manifest_malformed` — the manifest bytes exist but do not decode
 *   against `PiSubagentArtifactManifest` (includes wrong `schemaVersion`).
 * - `entry_missing` — a manifest file record has no file at its path.
 * - `digest_mismatch` — a file exists but its size or SHA-256 differs
 *   (tampered bytes).
 * - `path_escape` — a manifest record or directory entry resolves outside
 *   the artifact root (absolute path, `..`, symlinked directory component).
 * - `symlink_escape` — an entry or path component is a symbolic link
 *   pointing outside the artifact; symlinked records are rejected outright
 *   because records are exact regular files.
 * - `unlisted_entry` — the artifact contains content the manifest does not
 *   list (the file set is exact, both directions).
 * - `capability_profile_invalid` — the manifest's protocol/capability
 *   profile does not satisfy the required desktop profile.
 */
export const PiSubagentArtifactVerificationCategory = Schema.Literals([
  "manifest_missing",
  "manifest_malformed",
  "entry_missing",
  "digest_mismatch",
  "path_escape",
  "symlink_escape",
  "unlisted_entry",
  "capability_profile_invalid",
]);
export type PiSubagentArtifactVerificationCategory =
  typeof PiSubagentArtifactVerificationCategory.Type;
