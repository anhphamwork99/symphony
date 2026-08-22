// FILE: piSubagentDesktopArtifactEnvironment.ts
// Purpose: Derives the release-controlled managed Pi artifact locator from
// packaged resources and scrubs inherited Pi agent-dir overrides before the
// backend child is spawned (Ticket 01 WP3, Decision 0004).
// Layer: Desktop main-process startup helper
// Depends: Electron packaging layout only — never inherited environment,
// renderer input, or request/provider options.
// Exports: the backend env derivation for the managed artifact boundary.

import * as Path from "node:path";

/**
 * Backend env var carrying the release-derived managed Pi artifact locator.
 * Decision 0004 §1: its value is computed by trusted main-process code from
 * the selected packaged resource; it is never accepted from inherited env.
 */
export const SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV = "SYNARA_PI_SUBAGENT_ARTIFACT_DIR";

/**
 * The Pi SDK's global agent-directory override. Decision 0004 §2: desktop must
 * explicitly remove it from the backend child environment so inherited input
 * can never redirect Pi extension discovery at a user-global directory. The
 * artifact locator is a locator only and is never mapped into this var.
 */
const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Staged artifact directory name (matches build-time staging, WP1b). */
export const PI_SUBAGENT_ARTIFACT_DIR_NAME = "pi-subagents-artifact";

/** Where the staged artifact lives inside the packaged app tree. */
const PACKAGED_ARTIFACT_RELATIVE_PATH = `apps/desktop/resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;

/**
 * Resolve the packaged artifact locator candidates. Pure path computation from
 * packaging-provided roots: asar-packaged resources (`app.getAppPath()`), the
 * AppImage `prod-resources` mirror, and `process.resourcesPath` for any layout
 * that ships extra resources outside the archive. The first candidate whose
 * directory exists wins; none of these roots is renderer- or env-controlled.
 */
function resolvePackagedArtifactCandidates(input: {
  readonly appPath: string;
  readonly resourcesPath: string;
}): ReadonlyArray<string> {
  return [
    Path.join(input.appPath, PACKAGED_ARTIFACT_RELATIVE_PATH),
    Path.join(input.appPath, "apps/desktop/prod-resources", PI_SUBAGENT_ARTIFACT_DIR_NAME),
    Path.join(input.resourcesPath, PI_SUBAGENT_ARTIFACT_DIR_NAME),
  ];
}

function resolvePackagedArtifactDir(input: {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly exists: (candidate: string) => boolean;
}): string | null {
  for (const candidate of resolvePackagedArtifactCandidates(input)) {
    if (input.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Build the managed Pi artifact portion of the backend child environment.
 *
 * Returns a NEW object; never mutates `process.env` or the input. Two
 * invariants are enforced together (Decision 0004 §1/§2):
 *
 * 1. `SYNARA_PI_SUBAGENT_ARTIFACT_DIR` is always scrubbed from the inherited
 *    environment first, then — in a packaged launch — set to exactly the path
 *    derived from the packaged resource candidates. An attacker-supplied
 *    inherited value can therefore never survive into the child.
 * 2. `PI_CODING_AGENT_DIR` is always removed from the child environment, in
 *    packaged AND non-packaged launches, so desktop managed discovery cannot
 *    be redirected at a user-global agent directory. The locator is never
 *    written into `PI_CODING_AGENT_DIR`.
 *
 * Non-packaged development launches intentionally do NOT invent a
 * user-controlled artifact path: the inherited locator is scrubbed and no new
 * locator is set, leaving Ticket 02's explicit controlled binding to supply
 * one when it exists.
 */
export function applyPiSubagentArtifactBackendEnv(input: {
  readonly inheritedEnv: NodeJS.ProcessEnv;
  readonly isPackaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly exists: (candidate: string) => boolean;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.inheritedEnv };
  delete env[PI_CODING_AGENT_DIR_ENV];
  delete env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV];
  if (input.isPackaged) {
    const artifactDir = resolvePackagedArtifactDir(input);
    if (artifactDir !== null) {
      env[SYNARA_PI_SUBAGENT_ARTIFACT_DIR_ENV] = artifactDir;
    }
  }
  return env;
}
