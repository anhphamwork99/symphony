import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
  PiSubagentArtifactCapabilityProfile,
  PiSubagentArtifactFileRecord,
  PiSubagentArtifactManifest,
  PiSubagentArtifactRelativePath,
  PiSubagentArtifactSha256,
  PiSubagentArtifactSourceIdentity,
  PiSubagentArtifactVerificationCategory,
} from "./piSubagentArtifact";

// SHA-256 of the empty string — a real, well-formed digest reused as filler.
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const OTHER_SHA256 = "a430a9ae07212092c159a32404b0a315155a3d4c0a0def1fa167209716b7ccf9";
const PINNED_COMMIT = "73bc7744f8fbbd12206302de2df8230b29a49178";

const validSourceIdentity = {
  repositoryUrl: "https://github.com/anhphamwork99/alfie.git",
  pinnedCommit: PINNED_COMMIT,
  packageName: "@alfie/pi-subagents",
  packageVersion: "0.15.0-alfie.5",
};

const validCapabilityProfile = {
  protocolVersion: 1,
  capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES, "terminal-outbox"],
  requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
};

const validFileRecord = {
  path: "agent/extensions/pi-subagents/package.json",
  sizeBytes: 4096,
  sha256: EMPTY_SHA256,
};

const validManifest: typeof PiSubagentArtifactManifest.Encoded = {
  schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  sourceIdentity: validSourceIdentity,
  capabilityProfile: validCapabilityProfile,
  files: [
    validFileRecord,
    {
      path: "agent/extensions/pi-subagents/src/index.ts",
      sizeBytes: 0,
      sha256: OTHER_SHA256,
    },
  ],
};

describe("Pi subagent artifact manifest contracts (Ticket 01, handshake-first)", () => {
  it("decodes a valid official artifact manifest (T01-AC1)", () => {
    const decoded = Schema.decodeSync(PiSubagentArtifactManifest)(validManifest);
    expect(decoded.schemaVersion).toBe(1);
    expect(decoded.sourceIdentity.pinnedCommit).toBe(PINNED_COMMIT);
    expect(decoded.files).toHaveLength(2);
    expect(decoded.files[0]?.path).toBe("agent/extensions/pi-subagents/package.json");

    const identity = Schema.decodeSync(PiSubagentArtifactSourceIdentity)(validSourceIdentity);
    expect(identity.repositoryUrl).toBe("https://github.com/anhphamwork99/alfie.git");

    const profile = Schema.decodeSync(PiSubagentArtifactCapabilityProfile)(validCapabilityProfile);
    expect(profile.protocolVersion).toBe(1);
    expect(profile.capabilities).toContain("managed-spawn");
  });

  it("rejects manifests with the wrong schema version (T01-AC2 malformed)", () => {
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({
        ...validManifest,
        schemaVersion: 2,
      } as never),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({
        ...validManifest,
        schemaVersion: "1",
      } as never),
    ).toThrow();
  });

  it("rejects empty or malformed source identity fields", () => {
    for (const override of [
      { repositoryUrl: "" },
      { repositoryUrl: "   " },
      { repositoryUrl: "not-a-url" },
      { repositoryUrl: "file:///etc/passwd" },
      { repositoryUrl: "https://example.com/with space" },
      { pinnedCommit: "" },
      { pinnedCommit: "abc123" },
      { pinnedCommit: PINNED_COMMIT.toUpperCase() },
      { pinnedCommit: `${PINNED_COMMIT.slice(0, 39)}g` },
      { packageName: "" },
      { packageName: " ".repeat(8) },
      { packageVersion: "" },
    ]) {
      expect(() =>
        Schema.decodeSync(PiSubagentArtifactSourceIdentity)({
          ...validSourceIdentity,
          ...override,
        }),
      ).toThrow();
    }
  });

  it("rejects capability profiles that drop a required capability (T01-AC2)", () => {
    for (const dropped of PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES) {
      expect(() =>
        Schema.decodeSync(PiSubagentArtifactCapabilityProfile)({
          ...validCapabilityProfile,
          requiredCapabilities: PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.filter(
            (capability) => capability !== dropped,
          ),
        }),
      ).toThrow();
    }

    // The declared capability list itself stays open (additive future
    // capabilities), but must be non-empty and duplicate-free.
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactCapabilityProfile)({
        ...validCapabilityProfile,
        capabilities: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactCapabilityProfile)({
        ...validCapabilityProfile,
        capabilities: ["managed-spawn", "managed-spawn"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactCapabilityProfile)({
        ...validCapabilityProfile,
        requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES, "managed-spawn"],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactCapabilityProfile)({
        ...validCapabilityProfile,
        protocolVersion: 0,
      }),
    ).toThrow();
  });

  it("accepts only normalized relative file paths (T01-AC2 path safety)", () => {
    for (const path of [
      "agent/extensions/pi-subagents/src/index.ts",
      "a",
      "agent/extensions/pi-subagents/package.json",
      "deep/nested/dir.with.dots/file-name_1.txt",
    ]) {
      expect(Schema.decodeSync(PiSubagentArtifactRelativePath)(path)).toBe(path);
    }

    for (const path of [
      "", // empty
      "   ", // whitespace-only
      "/agent/extensions/pi-subagents/src/index.ts", // absolute
      "C:\\agent\\extensions\\index.ts", // drive/backslash
      "agent\\extensions\\index.ts", // backslash separator
      "agent/../agent/index.ts", // .. escape
      "../outside.ts", // leading .. escape
      "..", // bare parent
      ".", // bare self
      "./index.ts", // self segment
      "agent//extensions/index.ts", // empty segment
      "agent/extensions/", // trailing slash (directory-like)
      "agent/extensions/pi-subagents/src/index.ts/", // trailing slash
      " agent/extensions/index.ts", // leading space inside the path
      "agent/extensions/index.ts ", // trailing space inside the path
      "agent/exten\u0000sions/index.ts", // NUL byte
      "agent/exten\u0001sions/index.ts", // control character
      `agent/${"x".repeat(1_100)}/index.ts`, // over the length cap
    ]) {
      expect(() => Schema.decodeSync(PiSubagentArtifactRelativePath)(path)).toThrow();
    }
  });

  it("accepts only lower-case 64-hex SHA-256 digests and bounded sizes", () => {
    expect(Schema.decodeSync(PiSubagentArtifactSha256)(EMPTY_SHA256)).toBe(EMPTY_SHA256);
    expect(Schema.decodeSync(PiSubagentArtifactSha256)(OTHER_SHA256)).toBe(OTHER_SHA256);

    for (const digest of [
      "",
      "   ",
      EMPTY_SHA256.slice(0, 63),
      `${EMPTY_SHA256}0`,
      EMPTY_SHA256.toUpperCase(),
      `g${EMPTY_SHA256.slice(1)}`,
      EMPTY_SHA256.replace(/^e/, "E"),
      `${EMPTY_SHA256.slice(0, 62)}zz`,
    ]) {
      expect(() => Schema.decodeSync(PiSubagentArtifactSha256)(digest)).toThrow();
    }

    // Sizes are bounded non-negative integers; zero-byte files are valid.
    const zeroByte = Schema.decodeSync(PiSubagentArtifactFileRecord)({
      ...validFileRecord,
      sizeBytes: 0,
    });
    expect(zeroByte.sizeBytes).toBe(0);
    for (const sizeBytes of [-1, 1.5, "4096", Number.NaN, 64 * 1_024 * 1_024 + 1] as never[]) {
      expect(() =>
        Schema.decodeSync(PiSubagentArtifactFileRecord)({ ...validFileRecord, sizeBytes }),
      ).toThrow();
    }
  });

  it("rejects duplicate file records and empty file sets (T01-AC2 exactness)", () => {
    const otherPath = "agent/extensions/pi-subagents/src/agent-manager.ts";
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({
        ...validManifest,
        files: [
          validFileRecord,
          { path: validFileRecord.path, sizeBytes: 1, sha256: OTHER_SHA256 },
        ],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({
        ...validManifest,
        files: [validFileRecord, { ...validFileRecord, path: otherPath }, validFileRecord],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({ ...validManifest, files: [] }),
    ).toThrow();
    expect(() =>
      Schema.decodeSync(PiSubagentArtifactManifest)({
        ...validManifest,
        files: Array.from({ length: 8_193 }, (_, index) => ({
          ...validFileRecord,
          path: `agent/file-${index}.ts`,
        })),
      }),
    ).toThrow();
  });

  it("keeps the verification category vocabulary closed and bounded (T01-AC2)", () => {
    for (const category of [
      "manifest_missing",
      "manifest_malformed",
      "entry_missing",
      "digest_mismatch",
      "path_escape",
      "symlink_escape",
      "unlisted_entry",
      "capability_profile_invalid",
    ] as const) {
      expect(Schema.decodeSync(PiSubagentArtifactVerificationCategory)(category)).toBe(category);
    }

    // Near-miss and unrelated spellings must not be admitted.
    for (const invalid of [
      "missing",
      "malformed",
      "tampered",
      "symlinked",
      "unsupported_category",
      "manifest-not-found",
      "",
      "MANIFEST_MISSING",
    ]) {
      expect(() =>
        Schema.decodeSync(PiSubagentArtifactVerificationCategory)(invalid as never),
      ).toThrow();
    }
  });
});
