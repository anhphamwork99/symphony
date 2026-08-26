import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES,
} from "@synara/contracts";

import {
  PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME,
  type PiSubagentArtifactVerification,
  verifyPiSubagentArtifact,
} from "./piSubagentArtifactVerifier.ts";

/**
 * Ticket 01 (handshake-first) — focused failure-matrix tests for the
 * production runtime verifier (T01-AC2 / WP2) at the approved artifact
 * filesystem boundary.
 *
 * Every closed category is proven with a real on-disk fixture, and every
 * invalid result is proven bounded: exactly one category, a normalized
 * RELATIVE entry label only, and no absolute root, raw filesystem error,
 * or stack trace anywhere in the result.
 */

const sha256 = (content: string | Uint8Array): string =>
  createHash("sha256").update(content).digest("hex");

const PINNED_COMMIT = "3fe340b401ca86bcbe8b55abd4de107e1d93482e";

interface ArtifactFileSpec {
  readonly path: string;
  readonly content: string | Uint8Array;
}

interface ArtifactSpec {
  readonly files: ReadonlyArray<ArtifactFileSpec>;
  readonly manifestOverride?: Record<string, unknown> | undefined;
}

const VALID_SOURCE_IDENTITY = {
  repositoryUrl: "https://github.com/anhphamwork99/alfie.git",
  pinnedCommit: PINNED_COMMIT,
  packageName: "@alfie/pi-subagents",
  packageVersion: "0.15.0-alfie.6",
};

const VALID_CAPABILITY_PROFILE = {
  protocolVersion: 1,
  capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
  requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
};

const BASE_FILES: ReadonlyArray<ArtifactFileSpec> = [
  {
    path: "agent/extensions/pi-subagents/package.json",
    content: JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.6" }),
  },
  {
    path: "agent/extensions/pi-subagents/src/index.ts",
    content: "export const managed = true;\n",
  },
  { path: "agent/extensions/pi-subagents/src/.gitkeep", content: "" },
];

/**
 * Ticket 01b (Decision 0006 Binding decision 2) — the expanded runtime
 * closure: the staged `agent/extensions/shared` sibling content the pinned
 * extension imports and the release-owned lock-proven `node_modules`
 * regular-file dependency closure. Every entry is a regular manifest-listed
 * file, mirroring the release stager's expanded layout
 * (`scripts/lib/piSubagentArtifactStaging.ts` stages `shared/*.js` +
 * `shared/*.d.ts` and a root-level `node_modules/<package>/...` tree).
 */
const SHARED_SUBTREE_FILES: ReadonlyArray<ArtifactFileSpec> = [
  {
    path: "agent/extensions/shared/durable-preferences.js",
    content: "export const durablePreferences = 'shared';\n",
  },
  {
    path: "agent/extensions/shared/durable-preferences.d.ts",
    content: "export declare const durablePreferences: string;\n",
  },
];

/**
 * Ticket 01c (Decision 0010 AC4) — the derived child-prompt closure subtree
 * `agent/system`. Staged manifest-exactly like every other release content;
 * the generic security matrix below proves it fails closed under the same
 * bounded categories with no partial trust.
 */
const PROMPT_SYSTEM_SUBTREE_FILES: ReadonlyArray<ArtifactFileSpec> = [
  {
    path: "agent/system/subagent-system.md",
    content: "# Subagent System\n\nYou are a delegated subagent.\n",
  },
  {
    path: "agent/system/tool-guidelines.md",
    content: "# Tool Guidelines\n\nUse tools deliberately.\n",
  },
  {
    path: "agent/system/skill-rules.md",
    content: "# Skill Rules\n\nLoad skills before use.\n",
  },
  {
    path: "agent/system/working-style.md",
    content: "# Working Style\n\nBe precise and evidence-driven.\n",
  },
];

const DEPENDENCY_SUBTREE_FILES: ReadonlyArray<ArtifactFileSpec> = [
  {
    path: "node_modules/zod/package.json",
    content: JSON.stringify({
      name: "zod",
      version: "3.24.1",
      main: "index.js",
      type: "commonjs",
    }),
  },
  {
    path: "node_modules/zod/index.js",
    content: "module.exports = require('./lib/index.js');\n",
  },
  {
    path: "node_modules/@scope/dep/dist/runtime.js",
    content: "export const runtimeDependency = true;\n",
  },
];

/** Extension + shared + dependency + prompt-system subtrees — the full 01c closure. */
const CLOSURE_FILES: ReadonlyArray<ArtifactFileSpec> = [
  ...BASE_FILES,
  ...SHARED_SUBTREE_FILES,
  ...DEPENDENCY_SUBTREE_FILES,
  ...PROMPT_SYSTEM_SUBTREE_FILES,
];

/** The two expanded-closure subtrees proven per failure category (AC3). */
const EXPANDED_SUBTREES = [
  [
    "shared",
    {
      files: SHARED_SUBTREE_FILES,
      /** A manifest-listed regular file inside the subtree. */
      listedEntry: "agent/extensions/shared/durable-preferences.js",
      /** Same-byte-length tampered content for the listed entry. */
      tamperedContent: "export const durablePreferences = 'shareD';\n",
      /** Not-yet-present relative file path inside the subtree. */
      unlistedFileTarget: "agent/extensions/shared/model-catalog-reconciler.js",
      /** Not-yet-present relative non-regular node path inside the subtree. */
      unlistedNonRegularTarget: "agent/extensions/shared/extra.fifo",
      /** Control-character (newline) filename inside the subtree. */
      unsafeNameTarget: "agent/extensions/shared/bad\nname.js",
      /** Symlinked-directory name inside the subtree. */
      symlinkDirTarget: "agent/extensions/shared/node_modules",
    },
  ],
  [
    "agent/system",
    {
      files: PROMPT_SYSTEM_SUBTREE_FILES,
      listedEntry: "agent/system/subagent-system.md",
      tamperedContent: "# Subagent System\n\nYou are a delegated subagent.X",
      unlistedFileTarget: "agent/system/orchestration-rules.md",
      unlistedNonRegularTarget: "agent/system/extra.fifo",
      unsafeNameTarget: "agent/system/bad\nname.md",
      symlinkDirTarget: "agent/system/extra",
    },
  ],
  [
    "node_modules",
    {
      files: DEPENDENCY_SUBTREE_FILES,
      listedEntry: "node_modules/zod/index.js",
      tamperedContent: "module.exports = require('./lib/index.jS');\n",
      unlistedFileTarget: "node_modules/zod/lib/index.js",
      unlistedNonRegularTarget: "node_modules/zod/extra.fifo",
      unsafeNameTarget: "node_modules/zod/bad\nname.js",
      symlinkDirTarget: "node_modules/zod/lib",
    },
  ],
] as const;

/** Builds the manifest JSON for a file set (the release pipeline's shape). */
const manifestFor = (
  files: ReadonlyArray<ArtifactFileSpec>,
  override: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: PI_SUBAGENT_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  sourceIdentity: VALID_SOURCE_IDENTITY,
  capabilityProfile: VALID_CAPABILITY_PROFILE,
  files: files.map((file) => ({
    path: file.path,
    sizeBytes: Buffer.byteLength(file.content as Uint8Array | string),
    sha256: sha256(file.content),
  })),
  ...override,
});

/** Stages a complete artifact fixture: files + generated manifest. */
const stageArtifact = async (root: string, spec: ArtifactSpec): Promise<void> => {
  for (const file of spec.files) {
    await mkdir(join(root, file.path, ".."), { recursive: true });
    await writeFile(join(root, file.path), file.content as Uint8Array | string);
  }
  const manifest =
    spec.manifestOverride === undefined
      ? manifestFor(spec.files)
      : manifestFor(spec.files, spec.manifestOverride);
  await writeFile(
    join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
    JSON.stringify(manifest, null, 2),
  );
};

/** Stages the full Ticket 01b expanded runtime closure fixture. */
const stageClosureArtifact = async (root: string): Promise<void> => {
  await stageArtifact(root, { files: CLOSURE_FILES });
};

let fixtureRoot: string;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), "synara-t01-verifier-"));
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

/** Fresh per-test artifact directory. */
const freshRoot = async (label: string): Promise<string> => {
  const root = join(fixtureRoot, label);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  return root;
};

const expectInvalid = (result: PiSubagentArtifactVerification, category: string): void => {
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.category).toBe(category);
    expect(Object.keys(result).toSorted()).toEqual(
      ["category", "entry", "valid"].filter((key) =>
        key === "entry" ? result.entry !== undefined : true,
      ),
    );
  }
};

/** The result must never embed the fixture's absolute root or fs noise. */
const expectBoundedDiagnostic = (result: PiSubagentArtifactVerification): void => {
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(fixtureRoot);
  expect(serialized).not.toContain(tmpdir());
  expect(serialized).not.toMatch(/ENOENT|EACCES|EISDIR|EPERM/u);
  expect(serialized).not.toMatch(/at \S+ \(.*:\d+:\d+\)/u);
  expect(serialized).not.toContain("stack");
};

describe("Pi subagent artifact production verifier (Ticket 01, handshake-first)", () => {
  it("accepts a closed valid regular-file tree matching the generated manifest (T01-AC2)", async () => {
    const root = await freshRoot("valid");
    await stageArtifact(root, { files: BASE_FILES });

    const result = await verifyPiSubagentArtifact(root);

    expect(result).toEqual({
      valid: true,
      metadata: {
        sourceIdentity: VALID_SOURCE_IDENTITY,
        capabilityProfile: {
          protocolVersion: 1,
          capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
          requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
        },
      },
    });
  });

  it("returns manifest_missing when the artifact root is absent", async () => {
    const result = await verifyPiSubagentArtifact(join(fixtureRoot, "does-not-exist"));

    expectInvalid(result, "manifest_missing");
    expectBoundedDiagnostic(result);
  });

  it("returns manifest_missing when the root is not a directory", async () => {
    const root = join(fixtureRoot, "root-is-file");
    await writeFile(root, "not a directory");
    try {
      const result = await verifyPiSubagentArtifact(root);
      expectInvalid(result, "manifest_missing");
      expectBoundedDiagnostic(result);
    } finally {
      await rm(root, { force: true });
    }
  });

  it("returns manifest_missing when the manifest is absent from a populated tree", async () => {
    const root = await freshRoot("no-manifest");
    for (const file of BASE_FILES) {
      await mkdir(join(root, file.path, ".."), { recursive: true });
      await writeFile(join(root, file.path), file.content as Uint8Array | string);
    }

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "manifest_missing");
    expect(result).toMatchObject({ category: "manifest_missing", entry: "manifest.json" });
    expectBoundedDiagnostic(result);
  });

  it("returns manifest_missing when the manifest path is a directory", async () => {
    const root = await freshRoot("manifest-is-dir");
    for (const file of BASE_FILES) {
      await mkdir(join(root, file.path, ".."), { recursive: true });
      await writeFile(join(root, file.path), file.content as Uint8Array | string);
    }
    // The release-derived manifest location is occupied by a directory —
    // there is no manifest FILE at that location.
    await mkdir(join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME));

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "manifest_missing");
    expectBoundedDiagnostic(result);
  });

  it("returns manifest_malformed for undecodable manifest bytes", async () => {
    for (const [label, bytes] of [
      ["truncated-json", '{"schemaVersion":1,"sourceIdentity":'],
      ["not-json", "not json at all"],
      ["json-array", "[]"],
      ["empty", ""],
    ] as const) {
      const root = await freshRoot(`malformed-${label}`);
      for (const file of BASE_FILES) {
        await mkdir(join(root, file.path, ".."), { recursive: true });
        await writeFile(join(root, file.path), file.content as Uint8Array | string);
      }
      await writeFile(join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME), bytes);

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "manifest_malformed");
      expect(result).toMatchObject({ entry: "manifest.json" });
      expectBoundedDiagnostic(result);
    }
  });

  it("returns manifest_malformed when the manifest fails the WP1a schema (wrong schemaVersion, bad digest, dropped required capability)", async () => {
    const cases: ReadonlyArray<Record<string, unknown>> = [
      { schemaVersion: 2 },
      { schemaVersion: "1" },
      {
        capabilityProfile: {
          ...VALID_CAPABILITY_PROFILE,
          requiredCapabilities: PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.slice(0, 6),
        },
      },
      {
        files: BASE_FILES.map((file, index) => ({
          path: file.path,
          sizeBytes: Buffer.byteLength(file.content as Uint8Array | string),
          sha256: index === 0 ? "not-a-digest" : sha256(file.content),
        })),
      },
      {
        files: [
          ...BASE_FILES.map((file) => ({
            path: file.path,
            sizeBytes: Buffer.byteLength(file.content as Uint8Array | string),
            sha256: sha256(file.content),
          })),
          { path: "agent/escape/../../outside.ts", sizeBytes: 1, sha256: sha256("x") },
        ],
      },
    ];

    for (const [index, override] of cases.entries()) {
      const root = await freshRoot(`schema-invalid-${index}`);
      await stageArtifact(root, { files: BASE_FILES, manifestOverride: override });

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "manifest_malformed");
      expectBoundedDiagnostic(result);
    }
  });

  it("returns capability_profile_invalid when declared capabilities drop a mandated one", async () => {
    const root = await freshRoot("capability-gap");
    const weakened = {
      protocolVersion: 1,
      // requiredCapabilities still carries all seven (schema-valid), but the
      // artifact itself does NOT declare one of them.
      capabilities: PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES.slice(0, 6),
      requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
    };
    await stageArtifact(root, {
      files: BASE_FILES,
      manifestOverride: { capabilityProfile: weakened },
    });

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "capability_profile_invalid");
    expect(result).not.toHaveProperty("entry");
    expectBoundedDiagnostic(result);
  });

  it("returns entry_missing when a declared file is absent from the tree", async () => {
    const root = await freshRoot("entry-missing");
    await stageArtifact(root, { files: BASE_FILES });
    await rm(join(root, "agent/extensions/pi-subagents/src/index.ts"));

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "entry_missing");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/src/index.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns digest_mismatch when declared size differs from actual bytes", async () => {
    const root = await freshRoot("size-mismatch");
    await stageArtifact(root, { files: BASE_FILES });
    await writeFile(join(root, "agent/extensions/pi-subagents/src/index.ts"), "tampered longer");

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "digest_mismatch");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/src/index.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns digest_mismatch when bytes are replaced with same-size content", async () => {
    const root = await freshRoot("same-size-tamper");
    const original = "export const managed = true;\n";
    const tampered = "export const managed = fals;\n";
    expect(Buffer.byteLength(original)).toBe(Buffer.byteLength(tampered));
    await stageArtifact(root, { files: BASE_FILES });
    await writeFile(join(root, "agent/extensions/pi-subagents/src/index.ts"), tampered);

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "digest_mismatch");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/src/index.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns digest_mismatch when the manifest declares wrong digest for intact bytes", async () => {
    const root = await freshRoot("wrong-digest");
    await stageArtifact(root, {
      files: BASE_FILES,
      manifestOverride: {
        files: BASE_FILES.map((file, index) => ({
          path: file.path,
          sizeBytes: Buffer.byteLength(file.content as Uint8Array | string),
          sha256:
            index === 1
              ? "a430a9ae07212092c159a32404b0a315155a3d4c0a0def1fa167209716b7ccf9"
              : sha256(file.content),
        })),
      },
    });

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "digest_mismatch");
    expectBoundedDiagnostic(result);
  });

  it("returns symlink_escape when the manifest itself is a symbolic link", async () => {
    const root = await freshRoot("manifest-symlink");
    const outside = join(fixtureRoot, "outside-manifest.json");
    await writeFile(outside, JSON.stringify(manifestFor(BASE_FILES)));
    for (const file of BASE_FILES) {
      await mkdir(join(root, file.path, ".."), { recursive: true });
      await writeFile(join(root, file.path), file.content as Uint8Array | string);
    }
    await symlink(outside, join(root, PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME));

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "symlink_escape");
    expect(result).toMatchObject({ entry: "manifest.json" });
    expectBoundedDiagnostic(result);
  });

  it("returns symlink_escape when the artifact root itself is a symbolic link", async () => {
    const realRoot = await freshRoot("root-symlink-real");
    await stageArtifact(realRoot, { files: BASE_FILES });
    const linkRoot = join(fixtureRoot, "root-symlink-link");
    await rm(linkRoot, { force: true });
    await symlink(realRoot, linkRoot);

    const result = await verifyPiSubagentArtifact(linkRoot);

    expectInvalid(result, "symlink_escape");
    expect(result).not.toHaveProperty("entry");
    expectBoundedDiagnostic(result);
  });

  it("returns symlink_escape for a LISTED file replaced by a symbolic link", async () => {
    const root = await freshRoot("listed-file-symlink");
    await stageArtifact(root, { files: BASE_FILES });
    const target = join(fixtureRoot, "outside-listed.ts");
    await writeFile(target, "outside content");
    const victim = join(root, "agent/extensions/pi-subagents/src/index.ts");
    await rm(victim);
    await symlink(target, victim);

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "symlink_escape");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/src/index.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns symlink_escape for a symlinked DIRECTORY deep in the tree, even when unlisted", async () => {
    const root = await freshRoot("dir-symlink-deep");
    await stageArtifact(root, { files: BASE_FILES });
    const outsideDir = join(fixtureRoot, "outside-dir");
    await mkdir(join(outsideDir, "inner"), { recursive: true });
    await writeFile(join(outsideDir, "inner", "payload.ts"), "sneaky");
    await symlink(outsideDir, join(root, "agent/extensions/pi-subagents/node_modules"));

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "symlink_escape");
    expect(result).toMatchObject({
      entry: "agent/extensions/pi-subagents/node_modules",
    });
    expectBoundedDiagnostic(result);
  });

  it("returns path_escape for a tree entry with a control-character name", async () => {
    const root = await freshRoot("control-char-name");
    await stageArtifact(root, { files: BASE_FILES });
    // A literal newline inside a filename is creatable on POSIX and would
    // smuggle labels past naive log/prefix handling.
    await writeFile(join(root, "agent/extensions/pi-subagents/bad\nname.ts"), "x");

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "path_escape");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/bad\nname.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns path_escape when a manifest record resolves outside the root (defense-in-depth)", async () => {
    const root = await freshRoot("record-escape");
    // A schema-valid manifest whose record resolves inside the root cannot
    // escape by construction; prove the runtime guard with the injectable
    // seam: a fake fs that walks an entry whose joined path leaves the root.
    const files = BASE_FILES;
    await stageArtifact(root, { files });
    const base = await import("node:fs/promises");
    const escapingFs = {
      lstat: base.lstat,
      stat: base.stat,
      readFile: base.readFile,
      open: base.open,
      readdir: async (dir: string, options: { readonly withFileTypes: true }) => {
        const entries = (await base.readdir(dir, options)) as Array<Dirent>;
        if (dir === root) {
          return [
            ...entries.filter((entry) => entry.name !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
            {
              name: "../escaped.ts",
              isFile: () => true,
              isDirectory: () => false,
            } as unknown as Dirent,
          ];
        }
        return entries;
      },
    };

    const result = await verifyPiSubagentArtifact(root, { fsLike: escapingFs });

    expectInvalid(result, "path_escape");
    expect(result).toMatchObject({ entry: "../escaped.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns unlisted_entry for real files the manifest does not declare", async () => {
    const root = await freshRoot("unlisted");
    await stageArtifact(root, { files: BASE_FILES });
    await mkdir(join(root, "agent/extensions/pi-subagents/extra"), { recursive: true });
    await writeFile(join(root, "agent/extensions/pi-subagents/extra/payload.ts"), "extra");

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "unlisted_entry");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/extra/payload.ts" });
    expectBoundedDiagnostic(result);
  });

  it("returns unlisted_entry for a non-regular node (FIFO) in the tree", async () => {
    const root = await freshRoot("fifo");
    await stageArtifact(root, { files: BASE_FILES });
    // node:fs/promises exposes no mkfifo; create the fixture through the
    // platform tool, scoped inside this per-test artifact root.
    const { execFileSync } = await import("node:child_process");
    execFileSync("mkfifo", [join(root, "agent/extensions/pi-subagents/pipe.fifo")]);

    const result = await verifyPiSubagentArtifact(root);

    expectInvalid(result, "unlisted_entry");
    expect(result).toMatchObject({ entry: "agent/extensions/pi-subagents/pipe.fifo" });
    expectBoundedDiagnostic(result);
  });

  it("never returns partial success: an invalid result carries no metadata field", async () => {
    const root = await freshRoot("no-partial");
    await stageArtifact(root, { files: BASE_FILES });
    await writeFile(join(root, "agent/extensions/pi-subagents/src/index.ts"), "tampered");

    const result = await verifyPiSubagentArtifact(root);

    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty("metadata");
    expect(JSON.stringify(result)).not.toContain("sourceIdentity");
    expect(JSON.stringify(result)).not.toContain("capabilityProfile");
  });

  it("verifies recursively: a nested valid tree with many directories verifies exactly", async () => {
    const root = await freshRoot("recursive-valid");
    const deep: ArtifactFileSpec = {
      path: "agent/extensions/pi-subagents/a/b/c/d/e/deep.ts",
      content: "// deepest\n",
    };
    const files = [...BASE_FILES, deep];
    await stageArtifact(root, { files });

    const result = await verifyPiSubagentArtifact(root);

    expect(result.valid).toBe(true);
  });
});

describe("Pi subagent artifact verifier — expanded runtime closure (Ticket 01b, Decision 0006)", () => {
  it("accepts the expanded closure: extension + shared + node_modules as manifest-listed regular files (AC3 baseline)", async () => {
    const root = await freshRoot("closure-valid");
    await stageClosureArtifact(root);

    const result = await verifyPiSubagentArtifact(root);

    expect(result).toEqual({
      valid: true,
      metadata: {
        sourceIdentity: VALID_SOURCE_IDENTITY,
        capabilityProfile: {
          protocolVersion: 1,
          capabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
          requiredCapabilities: [...PI_SUBAGENT_ARTIFACT_REQUIRED_CAPABILITIES],
        },
      },
    });
  });

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: a missing manifest-listed entry is entry_missing with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-missing`);
      await stageClosureArtifact(root);
      await rm(join(root, subtree.listedEntry));

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "entry_missing");
      expect(result).toMatchObject({ entry: subtree.listedEntry });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: same-size tampered bytes are digest_mismatch with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-tampered`);
      await stageClosureArtifact(root);
      const original = subtree.files.find((file) => file.path === subtree.listedEntry)
        ?.content as string;
      expect(Buffer.byteLength(subtree.tamperedContent)).toBe(Buffer.byteLength(original));
      await writeFile(join(root, subtree.listedEntry), subtree.tamperedContent);

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "digest_mismatch");
      expect(result).toMatchObject({ entry: subtree.listedEntry });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: an unlisted regular file is unlisted_entry with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-unlisted-file`);
      await stageClosureArtifact(root);
      await mkdir(join(root, subtree.unlistedFileTarget, ".."), { recursive: true });
      await writeFile(join(root, subtree.unlistedFileTarget), "unlisted bytes");

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "unlisted_entry");
      expect(result).toMatchObject({ entry: subtree.unlistedFileTarget });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: an unlisted non-regular node is unlisted_entry with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-unlisted-fifo`);
      await stageClosureArtifact(root);
      const { execFileSync } = await import("node:child_process");
      execFileSync("mkfifo", [join(root, subtree.unlistedNonRegularTarget)]);

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "unlisted_entry");
      expect(result).toMatchObject({ entry: subtree.unlistedNonRegularTarget });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: a control-character entry name is path_escape with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-unsafe-name`);
      await stageClosureArtifact(root);
      await writeFile(join(root, subtree.unsafeNameTarget), "x");

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "path_escape");
      expect(result).toMatchObject({ entry: subtree.unsafeNameTarget });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: a symlinked FILE entry is symlink_escape with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-file-symlink`);
      await stageClosureArtifact(root);
      const target = join(fixtureRoot, `outside-${label.replaceAll("/", "_")}-file.js`);
      await rm(target, { force: true });
      await writeFile(target, "outside content");
      await rm(join(root, subtree.listedEntry));
      await symlink(target, join(root, subtree.listedEntry));

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "symlink_escape");
      expect(result).toMatchObject({ entry: subtree.listedEntry });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: a symlinked DIRECTORY is symlink_escape with no metadata",
    async ([label, subtree]) => {
      const root = await freshRoot(`closure-${label}-dir-symlink`);
      await stageClosureArtifact(root);
      const outsideDir = join(fixtureRoot, `outside-${label.replaceAll("/", "_")}-dir`);
      await rm(outsideDir, { recursive: true, force: true });
      await mkdir(join(outsideDir, "inner"), { recursive: true });
      await writeFile(join(outsideDir, "inner", "payload.js"), "sneaky");
      await symlink(outsideDir, join(root, subtree.symlinkDirTarget));

      const result = await verifyPiSubagentArtifact(root);

      expectInvalid(result, "symlink_escape");
      expect(result).toMatchObject({ entry: subtree.symlinkDirTarget });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );

  it.for(EXPANDED_SUBTREES)(
    "%s subtree: a manifest record resolving outside the root is path_escape (seam)",
    async ([label, _subtree]) => {
      const root = await freshRoot(`closure-${label}-record-escape`);
      await stageClosureArtifact(root);
      const base = await import("node:fs/promises");
      const escapedLabel = `../escaped-${label}.js`;
      const escapingFs = {
        lstat: base.lstat,
        stat: base.stat,
        readFile: base.readFile,
        open: base.open,
        readdir: async (dir: string, options: { readonly withFileTypes: true }) => {
          const entries = (await base.readdir(dir, options)) as Array<Dirent>;
          if (dir === root) {
            return [
              ...entries.filter((entry) => entry.name !== PI_SUBAGENT_ARTIFACT_MANIFEST_FILE_NAME),
              {
                name: escapedLabel,
                isFile: () => true,
                isDirectory: () => false,
              } as unknown as Dirent,
            ];
          }
          return entries;
        },
      };

      const result = await verifyPiSubagentArtifact(root, { fsLike: escapingFs });

      expectInvalid(result, "path_escape");
      expect(result).toMatchObject({ entry: escapedLabel });
      expect(result).not.toHaveProperty("metadata");
      expectBoundedDiagnostic(result);
    },
  );
});
