// FILE: piSubagentDesktopArtifactEnvironment.test.ts
// Purpose: Verifies the desktop backend env scrubs inherited Pi overrides and
// derives the managed artifact locator only from packaged resources
// (Ticket 01 WP3, Decision 0004 §1/§2), and that the backend child spawn env
// is EXACTLY the resolver's derived environment plus the fixed child-run
// keys (Ticket 04 WP1, Decision 0016 obligation 9).
// Layer: Desktop startup tests

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SHELL_ENVIRONMENT_HYDRATED_ENV_NAME } from "@synara/shared/shell";

import {
  BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV,
  BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
  BACKEND_CHILD_SERVER_ENTRY_ENV,
  PI_SUBAGENT_ARTIFACT_DIR_NAME,
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
  applyPiSubagentArtifactBackendEnv,
  buildBackendChildSpawnEnv,
} from "./piSubagentDesktopArtifactEnvironment";

const PACKAGED_APP_PATH = "/Applications/Synara.app/Contents/Resources/app.asar";
const PACKAGED_RESOURCES_PATH = "/Applications/Synara.app/Contents/Resources";
const DEV_APP_PATH = "/repo/apps/desktop";

const packagedArtifactDir = `${PACKAGED_APP_PATH}/apps/desktop/resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;

describe("applyPiSubagentArtifactBackendEnv — packaged desktop", () => {
  it("replaces an inherited attacker locator with the packaged resource path and drops PI_CODING_AGENT_DIR", () => {
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {
        PI_CODING_AGENT_DIR: "/user/global",
        [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker",
        PATH: "/usr/bin:/bin",
        HOME: "/home/dev",
      },
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: (candidate) => candidate === packagedArtifactDir,
    });

    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(packagedArtifactDir);
    // Unrelated inherited values survive untouched.
    expect(env.PATH).toBe("/usr/bin:/bin");
    expect(env.HOME).toBe("/home/dev");
  });

  it("sources the locator from the AppImage prod-resources mirror when asar candidate is absent", () => {
    const prodResourcesDir = `${PACKAGED_APP_PATH}/apps/desktop/prod-resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {},
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: (candidate) => candidate === prodResourcesDir,
    });

    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(prodResourcesDir);
  });

  it("falls back to process.resourcesPath when the artifact is staged outside the app archive", () => {
    const resourcesDir = `${PACKAGED_RESOURCES_PATH}/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {},
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: (candidate) => candidate === resourcesDir,
    });

    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(resourcesDir);
  });

  it("never maps the locator into PI_CODING_AGENT_DIR", () => {
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {},
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: () => true,
    });

    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(packagedArtifactDir);
  });

  it("omits the locator entirely when no packaged candidate exists", () => {
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: { [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker" },
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: () => false,
    });

    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBeUndefined();
  });

  it("prefers the first existing candidate when multiple exist", () => {
    const prodResourcesDir = `${PACKAGED_APP_PATH}/apps/desktop/prod-resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;
    const resourcesDir = `${PACKAGED_RESOURCES_PATH}/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {},
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: (candidate) =>
        candidate === packagedArtifactDir || candidate === prodResourcesDir || candidate === resourcesDir,
    });

    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(packagedArtifactDir);
  });
});

describe("applyPiSubagentArtifactBackendEnv — non-packaged desktop", () => {
  it("never delivers an inherited artifact locator or Pi agent-dir override", () => {
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {
        PI_CODING_AGENT_DIR: "/user/global",
        [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
      isPackaged: false,
      appPath: DEV_APP_PATH,
      resourcesPath: DEV_APP_PATH,
      exists: () => true,
    });

    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBeUndefined();
    // Ordinary backend env stays intact.
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
  });

  it("never invents a user-controlled artifact path", () => {
    const env = applyPiSubagentArtifactBackendEnv({
      inheritedEnv: {},
      isPackaged: false,
      appPath: DEV_APP_PATH,
      resourcesPath: DEV_APP_PATH,
      exists: () => true,
    });

    expect(Object.keys(env)).not.toContain(SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV);
    expect(Object.keys(env)).not.toContain("PI_CODING_AGENT_DIR");
  });
});

describe("applyPiSubagentArtifactBackendEnv — purity", () => {
  it("returns a new object without mutating the inherited environment", () => {
    const inheritedEnv: NodeJS.ProcessEnv = {
      PI_CODING_AGENT_DIR: "/user/global",
      [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker",
      PATH: "/usr/bin",
    };
    const snapshot = { ...inheritedEnv };

    applyPiSubagentArtifactBackendEnv({
      inheritedEnv,
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      resourcesPath: PACKAGED_RESOURCES_PATH,
      exists: () => true,
    });

    expect(inheritedEnv).toEqual(snapshot);
  });

  it("never consults process.env for the locator value", () => {
    const previousLocator = process.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV] = "/attacker-process-env";
    process.env.PI_CODING_AGENT_DIR = "/user/global";
    try {
      const env = applyPiSubagentArtifactBackendEnv({
        inheritedEnv: {},
        isPackaged: true,
        appPath: PACKAGED_APP_PATH,
        resourcesPath: PACKAGED_RESOURCES_PATH,
        exists: () => true,
      });

      expect(env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(packagedArtifactDir);
      expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
    } finally {
      if (previousLocator === undefined) {
        delete process.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
      } else {
        process.env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV] = previousLocator;
      }
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  });
});

// ─── Ticket 04 WP1 / Decision 0016: backendEnv() → spawn({ env }) wiring ────
//
// The focused spawn-wiring evidence. `buildBackendChildSpawnEnv` is the
// extracted production seam `startBackend()` composes its
// `ChildProcess.spawn(..., { env })` value from; proving here that its result
// is EXACTLY the production resolver's complete derived environment plus the
// two fixed child-run keys protects the whole resolver-to-spawn chain without
// launching Electron or a backend OS child.
describe("buildBackendChildSpawnEnv — production backend spawn wiring", () => {
  it("hands the spawn exactly the resolver's complete derived environment plus the fixed child-run keys (real release-shaped layout, poisoned inherited base env)", () => {
    // A real release-shaped packaged-resource layout on disk: the staged
    // artifact directory exists under the packaged app tree root.
    const releaseRoot = mkdtempSync(join(tmpdir(), "synara-t04-wiring-"));
    try {
      const appPath = join(releaseRoot, "app.asar");
      const packagedArtifactDir = join(
        appPath,
        "apps/desktop/resources",
        PI_SUBAGENT_ARTIFACT_DIR_NAME,
      );
      mkdirSync(packagedArtifactDir, { recursive: true });
      writeFileSync(join(packagedArtifactDir, "manifest.json"), "{}\n");

      // The base env `backendEnv()` would hand over: legitimate runtime
      // configuration plus poisoned inherited Pi redirect attempts.
      const baseEnv: NodeJS.ProcessEnv = {
        PI_CODING_AGENT_DIR: "/attacker/global-agent-dir",
        [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker/inherited-locator",
        SYNARA_MODE: "desktop",
        SYNARA_NO_BROWSER: "1",
        SYNARA_PORT: "43111",
        SYNARA_HOME: "/Users/dev/Library/Synara",
        SYNARA_AUTH_TOKEN: "auth-token-value",
        SYNARA_DESKTOP_SHUTDOWN_TOKEN: "shutdown-token-value",
        PATH: "/usr/bin:/bin",
        HOME: "/home/dev",
        SYNARA_BROWSER_HOST_PIPE: "/inherited/pipe",
      };
      const serverEntry = "/Applications/Synara.app/Contents/Resources/app.asar/apps/server/dist/main.js";

      const spawnEnv = buildBackendChildSpawnEnv({
        baseEnv,
        isPackaged: true,
        appPath,
        resourcesPath: join(releaseRoot, "resources"),
        exists: (candidate) => candidate === packagedArtifactDir,
        shellPathHydrated: true,
        serverEntry,
      });

      // The production resolver's complete derived environment, computed
      // independently here as the exact expectation.
      const expectedDerivedEnv = applyPiSubagentArtifactBackendEnv({
        inheritedEnv: baseEnv,
        isPackaged: true,
        appPath,
        resourcesPath: join(releaseRoot, "resources"),
        exists: (candidate) => candidate === packagedArtifactDir,
      });

      // Exact-object contract: the spawn env is the resolver's complete
      // result plus the hydration marker and the two fixed child-run keys —
      // nothing reconstructed, dropped, or re-derived (Decision 0016: the
      // harness/desktop must never rebuild a one-key environment).
      expect(spawnEnv).toEqual({
        ...expectedDerivedEnv,
        [SHELL_ENVIRONMENT_HYDRATED_ENV_NAME]: "1",
        [BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV]: BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
        [BACKEND_CHILD_SERVER_ENTRY_ENV]: serverEntry,
      });
      // Poisoned inherited overrides never reach the child spawn.
      expect(spawnEnv.PI_CODING_AGENT_DIR).toBeUndefined();
      expect(spawnEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe(packagedArtifactDir);
      // Legitimate user/runtime configuration survives into the child.
      expect(spawnEnv.SYNARA_PORT).toBe("43111");
      expect(spawnEnv.SYNARA_AUTH_TOKEN).toBe("auth-token-value");
      expect(spawnEnv.SYNARA_BROWSER_HOST_PIPE).toBe("/inherited/pipe");
      expect(spawnEnv.PATH).toBe("/usr/bin:/bin");
      // The base env object itself is never mutated.
      expect(baseEnv.PI_CODING_AGENT_DIR).toBe("/attacker/global-agent-dir");
      expect(baseEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBe("/attacker/inherited-locator");
    } finally {
      rmSync(releaseRoot, { recursive: true, force: true });
    }
  });

  it("removes a stale hydration marker when PATH hydration failed and derives no locator in a non-packaged launch", () => {
    const spawnEnv = buildBackendChildSpawnEnv({
      baseEnv: {
        PI_CODING_AGENT_DIR: "/attacker/global-agent-dir",
        [SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]: "/attacker/inherited-locator",
        [SHELL_ENVIRONMENT_HYDRATED_ENV_NAME]: "1",
        SYNARA_PORT: "43111",
      },
      isPackaged: false,
      appPath: DEV_APP_PATH,
      resourcesPath: DEV_APP_PATH,
      exists: () => true,
      shellPathHydrated: false,
      serverEntry: "/repo/apps/server/dist/main.js",
    });

    expect(spawnEnv[SHELL_ENVIRONMENT_HYDRATED_ENV_NAME]).toBeUndefined();
    expect(spawnEnv[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV]).toBeUndefined();
    expect(spawnEnv.PI_CODING_AGENT_DIR).toBeUndefined();
    expect(spawnEnv[BACKEND_CHILD_ELECTRON_RUN_AS_NODE_ENV]).toBe(
      BACKEND_CHILD_ELECTRON_RUN_AS_NODE_VALUE,
    );
    expect(spawnEnv[BACKEND_CHILD_SERVER_ENTRY_ENV]).toBe("/repo/apps/server/dist/main.js");
    expect(spawnEnv.SYNARA_PORT).toBe("43111");
  });
});
