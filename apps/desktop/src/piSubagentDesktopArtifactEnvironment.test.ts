// FILE: piSubagentDesktopArtifactEnvironment.test.ts
// Purpose: Verifies the desktop backend env scrubs inherited Pi overrides and
// derives the managed artifact locator only from packaged resources
// (Ticket 01 WP3, Decision 0004 §1/§2).
// Layer: Desktop startup tests

import { describe, expect, it } from "vitest";

import {
  PI_SUBAGENT_ARTIFACT_DIR_NAME,
  SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV,
  applyPiSubagentArtifactBackendEnv,
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
