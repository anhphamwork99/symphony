// FILE: piSubagentNpmRuntimeClosure.test.ts
// Purpose: Ticket 01b (Decision 0006) — focused tests for the lock-proven
// npm runtime closure selector and the fresh-install materializer.
// Layer: Release/build helper tests (same layer as the module under test).
//
// The selector legs are pure synthetic lockfile-v3 cases (no network). The
// materializer legs run a FAKE npm executable (generated per test) so the
// install contract is proven deterministically: fresh-install-only sourcing,
// exact-version agreement, `.bin` exclusion at any depth, symlink rejection,
// and fail-closed bounded errors. The real `npm ci` leg is exercised by the
// stager suite against the real pinned Alfie checkout.

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  materializeNpmRuntimeClosure,
  PiSubagentNpmRuntimeClosureError,
  selectNpmRuntimeClosure,
} from "./piSubagentNpmRuntimeClosure.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function expectClosureError(action: () => unknown, code: string, messagePattern: RegExp): void {
  let caught: unknown;
  try {
    action();
  } catch (cause) {
    caught = cause;
  }
  expect(caught).toBeInstanceOf(PiSubagentNpmRuntimeClosureError);
  const error = caught as PiSubagentNpmRuntimeClosureError;
  expect(error.code).toBe(code);
  expect(error.message).toMatch(messagePattern);
}

/** Lock entry factory with the invariants a registry-resolved runtime dep has. */
function lockEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "1.0.0",
    resolved: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
    integrity: "sha512-" + "a".repeat(86),
    ...overrides,
  };
}

function baseLock(
  packages: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const root = packages[""] ?? {};
  return {
    name: "@alfie/pi-subagents",
    version: "0.15.0-alfie.4",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@alfie/pi-subagents",
        version: "0.15.0-alfie.4",
        dependencies: { croner: "^10.0.1" },
        peerDependencies: { "@earendil-works/pi-ai": ">=0.83.0" },
        ...root,
      },
      ...Object.fromEntries(Object.entries(packages).filter(([key]) => key !== "")),
    },
  };
}

function basePackageJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "@alfie/pi-subagents",
    version: "0.15.0-alfie.4",
    dependencies: { croner: "^10.0.1" },
    peerDependencies: { "@earendil-works/pi-ai": ">=0.83.0" },
    ...overrides,
  };
}

describe("selectNpmRuntimeClosure (lock-proven selection)", () => {
  it("selects exactly the direct runtime deps with locked versions, digests, and registry URLs", () => {
    const selection = selectNpmRuntimeClosure({
      packageJson: basePackageJson({
        dependencies: { croner: "^10.0.1", nanoid: "^5.0.0" },
      }),
      packageLockJson: baseLock({
        "": {
          name: "@alfie/pi-subagents",
          version: "0.11.0-alfie.1",
          dependencies: { croner: "^10.0.1", nanoid: "^5.0.0" },
          peerDependencies: { "@earendil-works/pi-ai": ">=0.83.0" },
          devDependencies: { typescript: "^6.0.0" },
        },
        "node_modules/croner": lockEntry({ version: "10.0.1" }),
        "node_modules/nanoid": lockEntry({ version: "5.1.11" }),
        // dev/optional content and peer/host-SDK packages exist in the lock
        // but must NEVER seed or join the runtime closure.
        "node_modules/typescript": lockEntry({ dev: true, version: "6.0.3" }),
        "node_modules/fsevents": lockEntry({ dev: true, optional: true }),
        "node_modules/@earendil-works/pi-ai": lockEntry({ version: "0.83.0" }),
      }),
    });
    expect(selection.packages.map((pkg) => pkg.name)).toEqual(["croner", "nanoid"]);
    expect(selection.packages[0]).toMatchObject({
      name: "croner",
      lockPath: "node_modules/croner",
      version: "10.0.1",
      integrity: expect.stringMatching(/^sha512-/),
      resolved: "https://registry.npmjs.org/pkg/-/pkg-1.0.0.tgz",
    });
    // The lagging lock root VERSION label is deliberately informational.
    expect(selection.lockRootVersion).toBe("0.11.0-alfie.1");
  });

  it("follows transitive runtime dependencies through the lock recursively", () => {
    const selection = selectNpmRuntimeClosure({
      packageJson: basePackageJson({ dependencies: { croner: "^10.0.1" } }),
      packageLockJson: baseLock({
        "": { dependencies: { croner: "^10.0.1" } },
        "node_modules/croner": lockEntry({
          version: "10.0.1",
          dependencies: { yaml: "^2" },
        }),
        "node_modules/yaml": lockEntry({ version: "2.9.0" }),
      }),
    });
    expect(selection.packages.map((pkg) => pkg.name).sort()).toEqual(["croner", "yaml"]);
  });

  it("rejects a root dependency-map mismatch between lock and package.json", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson({ dependencies: { croner: "^10.0.1", yaml: "^2" } }),
          packageLockJson: baseLock({
            "": { dependencies: { croner: "^10.0.1" } },
            "node_modules/croner": lockEntry(),
            "node_modules/yaml": lockEntry(),
          }),
        }),
      "lock_root_map_mismatch",
      /dependency\/peer maps do not match/i,
    );
  });

  it("rejects a root peer-map mismatch between lock and package.json", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson({ peerDependencies: { "@earendil-works/pi-ai": ">=0.83.0" } }),
          packageLockJson: baseLock({
            "": {
              dependencies: { croner: "^10.0.1" },
              peerDependencies: { "@earendil-works/pi-ai": ">=0.99.0" },
            },
            "node_modules/croner": lockEntry(),
          }),
        }),
      "lock_root_map_mismatch",
      /do not match/i,
    );
  });

  it("rejects a lock entry missing for a direct runtime dependency", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: baseLock({ "": { dependencies: { croner: "^10.0.1" } } }),
        }),
      "lock_package_missing",
      /no entry for direct runtime dependency 'croner'/i,
    );
  });

  it("rejects a transitive dependency missing from the lock (fail-closed traversal)", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: baseLock({
            "": { dependencies: { croner: "^10.0.1" } },
            "node_modules/croner": lockEntry({ dependencies: { yaml: "^2" } }),
          }),
        }),
      "lock_package_missing",
      /no entry for direct runtime dependency 'yaml'/i,
    );
  });

  it("rejects a linked (link:true) lock package", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: baseLock({
            "": { dependencies: { croner: "^10.0.1" } },
            "node_modules/croner": lockEntry({ link: true }),
          }),
        }),
      "lock_package_ineligible",
      /linked local package/i,
    );
  });

  it("rejects dev, devOptional, and optional lock markings on runtime deps", () => {
    for (const marking of [{ dev: true }, { devOptional: true }, { optional: true }]) {
      expectClosureError(
        () =>
          selectNpmRuntimeClosure({
            packageJson: basePackageJson(),
            packageLockJson: baseLock({
              "": { dependencies: { croner: "^10.0.1" } },
              "node_modules/croner": lockEntry(marking),
            }),
          }),
        "lock_package_ineligible",
        /dev\/optional/i,
      );
    }
  });

  it("rejects a missing or non-sha512 integrity digest (no range-floating selection)", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: baseLock({
            "": { dependencies: { croner: "^10.0.1" } },
            "node_modules/croner": lockEntry({ integrity: undefined }),
          }),
        }),
      "lock_integrity_missing",
      /no sha512 integrity digest/i,
    );
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: baseLock({
            "": { dependencies: { croner: "^10.0.1" } },
            "node_modules/croner": lockEntry({ integrity: "sha1-deadbeef" }),
          }),
        }),
      "lock_integrity_missing",
      /no sha512 integrity digest/i,
    );
  });

  it("rejects non-registry resolved sources (git/file/local)", () => {
    for (const resolved of ["git+ssh://git@github.com:x/y.git", "file:../local-pkg", "../local"]) {
      expectClosureError(
        () =>
          selectNpmRuntimeClosure({
            packageJson: basePackageJson(),
            packageLockJson: baseLock({
              "": { dependencies: { croner: "^10.0.1" } },
              "node_modules/croner": lockEntry({ resolved }),
            }),
          }),
        "lock_package_ineligible",
        /not resolved from a registry tarball URL/i,
      );
    }
  });

  it("rejects non-v3 lockfiles and missing packages trees", () => {
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: { lockfileVersion: 2, packages: {} },
        }),
      "lock_malformed",
      /Unsupported lockfileVersion 2/i,
    );
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: { lockfileVersion: 3 },
        }),
      "lock_malformed",
      /packages tree/i,
    );
    expectClosureError(
      () =>
        selectNpmRuntimeClosure({
          packageJson: basePackageJson(),
          packageLockJson: { lockfileVersion: 3, packages: { "node_modules/croner": lockEntry() } },
        }),
      "lock_malformed",
      /no root package entry/i,
    );
  });
});

/**
 * Generates a FAKE npm executable for materializer tests. The fake ignores
 * the registry entirely: it fabricates `node_modules/<pkg>` for each package
 * named in `installedPackages` inside the `--prefix`-like cwd (npm ci runs
 * with cwd at the install root), with behaviors toggled per test.
 */
function writeFakeNpm(options: {
  readonly installedPackages: ReadonlyArray<{ readonly name: string; readonly version: string }>;
  readonly createRootBin?: boolean;
  readonly createNestedBin?: boolean;
  readonly createSymlink?: boolean;
  readonly omitPackage?: string;
  readonly wrongVersionFor?: { readonly name: string; readonly version: string };
  readonly exitCode?: number;
  readonly stderr?: string;
}): string {
  const scriptDir = makeTempRoot("fake-npm-");
  const scriptPath = join(scriptDir, "fake-npm.mjs");
  const script = `
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
const config = ${JSON.stringify(options)};
for (const pkg of config.installedPackages) {
  const dir = join("node_modules", pkg.name);
  mkdirSync(dir, { recursive: true });
  const version = config.wrongVersionFor && config.wrongVersionFor.name === pkg.name
    ? config.wrongVersionFor.version
    : pkg.version;
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: pkg.name, version }));
  writeFileSync(join(dir, "index.js"), \`// fake install of \${pkg.name}@\${version}\\n\`);
}
if (config.omitPackage) {
  // Simulate npm installing everything EXCEPT one selected package.
}
if (config.createRootBin) {
  mkdirSync(join("node_modules", ".bin"), { recursive: true });
  writeFileSync(join("node_modules", ".bin", "shim"), "#!/bin/sh\\nexit 0\\n");
}
if (config.createNestedBin) {
  const first = config.installedPackages[0];
  mkdirSync(join("node_modules", first.name, ".bin"), { recursive: true });
  writeFileSync(join("node_modules", first.name, ".bin", "nested-shim"), "#!/bin/sh\\nexit 0\\n");
}
if (config.createSymlink) {
  const first = config.installedPackages[0];
  symlinkSync("../elsewhere", join("node_modules", first.name, "linked.js"));
}
if (config.stderr) process.stderr.write(config.stderr);
process.exit(config.exitCode ?? 0);
function join(...segments) { return segments.join("/"); }
`;
  writeFileSync(scriptPath, script, "utf8");
  const wrapperPath = join(scriptDir, "fake-npm");
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

/** Synthetic pinned-like checkout directory with a lockable extension root. */
function writeSyntheticExtensionRepo(options: {
  readonly dependencies: Record<string, string>;
  readonly lockPackages: Record<string, Record<string, unknown>>;
  readonly ambientNodeModulesContent?: { readonly path: string; readonly content: string };
}): string {
  const repoDir = join(makeTempRoot("closure-repo-"), "alfie");
  const extensionRoot = join(repoDir, "agent/extensions/pi-subagents");
  mkdirSync(extensionRoot, { recursive: true });
  writeFileSync(
    join(extensionRoot, "package.json"),
    JSON.stringify({ name: "@alfie/pi-subagents", version: "0.15.0-alfie.4", dependencies: options.dependencies }),
  );
  writeFileSync(
    join(extensionRoot, "package-lock.json"),
    JSON.stringify({
      name: "@alfie/pi-subagents",
      version: "0.15.0-alfie.4",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { dependencies: options.dependencies }, ...options.lockPackages },
    }),
  );
  if (options.ambientNodeModulesContent) {
    const ambientPath = join(extensionRoot, "node_modules", options.ambientNodeModulesContent.path);
    mkdirSync(dirname(ambientPath), { recursive: true });
    writeFileSync(ambientPath, options.ambientNodeModulesContent.content);
  }
  return repoDir;
}

const CRONER_LOCK = lockEntry({ version: "10.0.1" });

describe("materializeNpmRuntimeClosure (fresh isolated install)", () => {
  it("stages exact fresh-install bytes and never reads the checkout's ambient node_modules", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
      // A poisoned AMBIENT install exists in the checkout — the staged bytes
      // must come from the fresh install, never from these files.
      ambientNodeModulesContent: {
        path: "croner/index.js",
        content: "// AMBIENT POISON from the checkout tree\n",
      },
    });
    const artifactDir = makeTempRoot("closure-artifact-");
    const npmCommand = writeFakeNpm({ installedPackages: [{ name: "croner", version: "10.0.1" }] });

    const result = materializeNpmRuntimeClosure({
      repoDir,
      packageRootRelative: "agent/extensions/pi-subagents",
      destinationDirName: "node_modules",
      artifactDir,
      npmCommand,
    });

    expect(result.selection.packages.map((pkg) => pkg.name)).toEqual(["croner"]);
    expect(result.stagedFileCount).toBe(2);
    const stagedIndex = readFileSync(join(artifactDir, "node_modules/croner/index.js"), "utf8");
    expect(stagedIndex).toBe("// fake install of croner@10.0.1\n");
    expect(stagedIndex).not.toContain("AMBIENT POISON");
    expect(existsSync(join(artifactDir, "node_modules/croner/package.json"))).toBe(true);
    // Only the two copied manifest files ever leave the checkout.
  });

  it("rejects a destination other than the artifact node_modules root", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "vendor",
          artifactDir: makeTempRoot("closure-artifact-"),
          npmCommand: writeFakeNpm({ installedPackages: [] }),
        }),
      "ambient_source_forbidden",
      /must be the artifact 'node_modules' root/i,
    );
  });

  it("fails closed with install_failed and leaves no destination content when npm fails", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    const artifactDir = makeTempRoot("closure-artifact-");
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "node_modules",
          artifactDir,
          npmCommand: writeFakeNpm({
            installedPackages: [],
            exitCode: 1,
            stderr: "npm error code EUSAGE",
          }),
        }),
      "install_failed",
      /EUSAGE|fresh lock install/i,
    );
    expect(existsSync(join(artifactDir, "node_modules"))).toBe(false);
  });

  it("rejects an install output missing a selected package", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "node_modules",
          artifactDir: makeTempRoot("closure-artifact-"),
          npmCommand: writeFakeNpm({ installedPackages: [{ name: "other", version: "1.0.0" }] }),
        }),
      "install_output_invalid",
      /missing selected package 'croner'/i,
    );
  });

  it("rejects an installed version that disagrees with the locked selection", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "node_modules",
          artifactDir: makeTempRoot("closure-artifact-"),
          npmCommand: writeFakeNpm({
            installedPackages: [{ name: "croner", version: "10.0.1" }],
            wrongVersionFor: { name: "croner", version: "9.9.9" },
          }),
        }),
      "install_output_invalid",
      /version does not match the locked selection/i,
    );
  });

  it("never stages .bin content at the install root or nested inside a package", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    const artifactDir = makeTempRoot("closure-artifact-");
    const result = materializeNpmRuntimeClosure({
      repoDir,
      packageRootRelative: "agent/extensions/pi-subagents",
      destinationDirName: "node_modules",
      artifactDir,
      npmCommand: writeFakeNpm({
        installedPackages: [{ name: "croner", version: "10.0.1" }],
        createRootBin: true,
        createNestedBin: true,
      }),
    });
    expect(result.stagedFileCount).toBe(2);
    expect(existsSync(join(artifactDir, "node_modules/.bin"))).toBe(false);
    expect(existsSync(join(artifactDir, "node_modules/croner/.bin"))).toBe(false);
    const staged = readdirSync(join(artifactDir, "node_modules/croner")).sort();
    expect(staged).toEqual(["index.js", "package.json"]);
  });

  it("rejects a symlink anywhere inside an installed package", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { croner: "^10.0.1" },
      lockPackages: { "node_modules/croner": CRONER_LOCK },
    });
    const artifactDir = makeTempRoot("closure-artifact-");
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "node_modules",
          artifactDir,
          npmCommand: writeFakeNpm({
            installedPackages: [{ name: "croner", version: "10.0.1" }],
            createSymlink: true,
          }),
        }),
      "staged_entry_invalid",
      /symbolic link/i,
    );
    // No partial destination content survives the failure.
    expect(existsSync(join(artifactDir, "node_modules"))).toBe(false);
  });

  it("rejects an extension with no direct runtime dependencies (nothing to materialize)", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: {},
      lockPackages: {},
    });
    expectClosureError(
      () =>
        materializeNpmRuntimeClosure({
          repoDir,
          packageRootRelative: "agent/extensions/pi-subagents",
          destinationDirName: "node_modules",
          artifactDir: makeTempRoot("closure-artifact-"),
          npmCommand: writeFakeNpm({ installedPackages: [] }),
        }),
      "lock_package_missing",
      /declares no direct runtime dependencies/i,
    );
  });

  it("stages scoped packages under their scope directory with exact paths", () => {
    const repoDir = writeSyntheticExtensionRepo({
      dependencies: { "@sinclair/typebox": "^0.34.49" },
      lockPackages: {
        "node_modules/@sinclair/typebox": lockEntry({ version: "0.34.49" }),
      },
    });
    const artifactDir = makeTempRoot("closure-artifact-");
    const result = materializeNpmRuntimeClosure({
      repoDir,
      packageRootRelative: "agent/extensions/pi-subagents",
      destinationDirName: "node_modules",
      artifactDir,
      npmCommand: writeFakeNpm({
        installedPackages: [{ name: "@sinclair/typebox", version: "0.34.49" }],
      }),
    });
    expect(result.selection.packages[0]!.lockPath).toBe("node_modules/@sinclair/typebox");
    expect(existsSync(join(artifactDir, "node_modules/@sinclair/typebox/package.json"))).toBe(true);
    expect(existsSync(join(artifactDir, "node_modules/@sinclair/typebox/index.js"))).toBe(true);
  });
});
