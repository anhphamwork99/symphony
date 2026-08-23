// FILE: desktop-platform-build-config.ts
// Purpose: Builds platform-specific electron-builder config fragments for desktop artifacts.
// Layer: Release/build helper
// Depends on: Desktop packaging policy and electron-builder config shape.

import { PI_SUBAGENT_ARTIFACT_DIR_NAME } from "./piSubagentArtifactStaging.ts";

export { PI_SUBAGENT_ARTIFACT_DIR_NAME } from "./piSubagentArtifactStaging.ts";

export const MICROPHONE_USAGE_DESCRIPTION =
  "Synara needs microphone access so you can record voice notes and transcribe them into the chat composer.";
export const MAC_ENTITLEMENTS_PATH = "apps/desktop/resources/entitlements.mac.plist";
export const MAC_INHERITED_ENTITLEMENTS_PATH =
  "apps/desktop/resources/entitlements.mac.inherit.plist";
export const MAC_APPSNAP_HELPER_STAGE_PATH =
  "apps/desktop/native/appsnap/build/synara-appsnap-helper";
export const MAC_APPSNAP_HELPER_ASAR_EXCLUSION = "!apps/desktop/native/appsnap/build/**";
export const MAC_APPSNAP_HELPER_BUNDLE_PATH = "Contents/Helpers/synara-appsnap-helper";
export const MAC_DEVICE_HELPER_STAGE_PATH = "apps/server/dist/device-helper";
export const MAC_DEVICE_HELPER_RESOURCE_PATH = "Resources/device-helper";
export const WINDOWS_INSTALLER_GUID = "368107a8-afe6-5db5-ab3b-d4f331684868";
const MAC_DMG_ICON_PATH = "icon.icns";
export const NODE_PTY_ASAR_UNPACK_GLOBS = ["node_modules/node-pty/**"] as const;

/**
 * Where the staged artifact lives inside the staged app tree that
 * electron-builder packages (cwd). Mirrors the `prod-resources` mirror copy
 * in `build-desktop-artifact.ts`.
 */
export const PI_SUBAGENT_ARTIFACT_STAGED_PATH = `apps/desktop/prod-resources/${PI_SUBAGENT_ARTIFACT_DIR_NAME}`;

/**
 * ASAR exclusion for the staged artifact. The main app `files` matcher adds
 * default exclusions (`.gitignore`, node_modules closure) that strip entries
 * the release manifest requires, so an ASAR-packaged copy is always
 * incomplete and the runtime verifier fails closed on it. Excluding it here
 * makes the byte-for-byte `extraResources` copy authoritative. The brace
 * expansion in the glob covers both the directory entry itself and every
 * nested file inside its whole tree.
 */
export const PI_SUBAGENT_ARTIFACT_ASAR_EXCLUSION =
  `!${PI_SUBAGENT_ARTIFACT_STAGED_PATH}{,/**/*}`;

/**
 * External resource mappings for the managed artifact. Advanced
 * `extraResources` matchers do not receive the main app default exclusions
 * applied to the app tree. The root and dependency closure are copied from
 * separate source roots so the reconstructed tree outside `app.asar` is
 * byte-for-byte complete at the locator's `process.resourcesPath` candidate.
 */
export interface DesktopExtraResourceMapping {
  readonly filter?: ReadonlyArray<string>;
  readonly from: string;
  readonly to: string;
}

export const PI_SUBAGENT_ARTIFACT_EXTRA_RESOURCES: ReadonlyArray<DesktopExtraResourceMapping> = [
  {
    from: PI_SUBAGENT_ARTIFACT_STAGED_PATH,
    to: PI_SUBAGENT_ARTIFACT_DIR_NAME,
    // Electron Builder treats nested `node_modules` as dependency input and
    // drops it from this tree copy. Copy that closure from its own source
    // root below so its relative paths no longer traverse a node_modules
    // segment.
    filter: ["**/*", "!node_modules{,/**/*}"],
  },
  {
    from: `${PI_SUBAGENT_ARTIFACT_STAGED_PATH}/node_modules`,
    to: `${PI_SUBAGENT_ARTIFACT_DIR_NAME}/node_modules`,
  },
];

export interface DesktopPlatformBuildConfig {
  readonly asarUnpack?: ReadonlyArray<string>;
  readonly dmg?: Record<string, unknown>;
  readonly extraFiles?: ReadonlyArray<Record<string, string>>;
  readonly extraResources?: ReadonlyArray<DesktopExtraResourceMapping>;
  readonly files?: ReadonlyArray<string>;
  readonly linux?: Record<string, unknown>;
  readonly mac?: Record<string, unknown>;
  readonly nsis?: Record<string, unknown>;
  readonly win?: Record<string, unknown>;
}

export interface CreateDesktopPlatformBuildConfigInput {
  readonly platform: "linux" | "mac" | "win";
  readonly target: string;
  readonly signed?: boolean;
  readonly windowsAzureSignOptions?: Record<string, string>;
}

export interface DesktopNativeBuildHostInput {
  readonly arch: "arm64" | "x64" | "universal";
  readonly hostArch: string;
  readonly hostPlatform: NodeJS.Platform;
  readonly platform: "linux" | "mac" | "win";
}

export function validateDesktopNativeBuildHost(input: DesktopNativeBuildHostInput): string | null {
  if (input.platform === "mac" && input.hostPlatform !== "darwin") {
    return [
      "macOS desktop artifacts include the native Swift AppSnap helper.",
      `Build mac/${input.arch} on macOS so the helper can be compiled and signed.`,
      `Current host is ${input.hostPlatform}/${input.hostArch}.`,
    ].join(" ");
  }
  if (input.platform !== "linux") return null;
  if (input.arch === "universal") {
    return "Linux desktop artifacts support x64 or arm64 builds, not universal builds.";
  }
  if (input.hostPlatform === "linux" && input.hostArch === input.arch) return null;

  return [
    "Linux desktop artifacts include the native node-pty terminal dependency.",
    `Build linux/${input.arch} on a matching Linux host so pty.node and spawn-helper are compiled for Linux.`,
    `Current host is ${input.hostPlatform}/${input.hostArch}.`,
  ].join(" ");
}

export function createDesktopPlatformBuildConfig(
  input: CreateDesktopPlatformBuildConfigInput,
): DesktopPlatformBuildConfig {
  const nativePackaging = { asarUnpack: [...NODE_PTY_ASAR_UNPACK_GLOBS] };
  // The managed pi-subagents artifact must never live (incompletely) inside
  // app.asar; it is shipped byte-for-byte via extraResources instead.
  const piSubagentArtifactPackaging = {
    files: [PI_SUBAGENT_ARTIFACT_ASAR_EXCLUSION],
    extraResources: PI_SUBAGENT_ARTIFACT_EXTRA_RESOURCES,
  };

  if (input.platform === "mac") {
    const mac = {
      target: input.target === "dmg" ? [input.target, "zip"] : [input.target],
      icon: MAC_DMG_ICON_PATH,
      category: "public.app-category.developer-tools",
      hardenedRuntime: input.signed === true,
      notarize: input.signed === true,
      entitlements: MAC_ENTITLEMENTS_PATH,
      entitlementsInherit: MAC_INHERITED_ENTITLEMENTS_PATH,
      binaries: [MAC_APPSNAP_HELPER_BUNDLE_PATH],
      // The universal build stages the same pre-lipo'd helper in both app trees.
      // @electron/universal needs this pattern to preserve that existing fat binary.
      x64ArchFiles: MAC_APPSNAP_HELPER_BUNDLE_PATH,
      extendInfo: {
        NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
      },
    } satisfies Record<string, unknown>;

    return {
      ...nativePackaging,
      ...piSubagentArtifactPackaging,
      dmg: {
        sign: input.signed === true,
        // The signed release flow notarizes and staples the DMG after electron-builder exits.
        // Do not emit a blockmap/update entry whose hashes would describe the pre-stapled image;
        // macOS auto-updates use the separately finalized ZIP artifact.
        writeUpdateInfo: false,
      },
      files: ["**/*", MAC_APPSNAP_HELPER_ASAR_EXCLUSION, PI_SUBAGENT_ARTIFACT_ASAR_EXCLUSION],
      extraFiles: [
        {
          from: MAC_APPSNAP_HELPER_STAGE_PATH,
          to: "Helpers/synara-appsnap-helper",
        },
        {
          from: MAC_DEVICE_HELPER_STAGE_PATH,
          to: MAC_DEVICE_HELPER_RESOURCE_PATH,
        },
      ],
      mac,
    };
  }

  if (input.platform === "linux") {
    return {
      ...nativePackaging,
      ...piSubagentArtifactPackaging,
      linux: {
        target: [input.target],
        executableName: "synara",
        icon: "icon.png",
        category: "Development",
        desktop: {
          entry: {
            StartupWMClass: "synara",
          },
        },
      },
    };
  }

  return {
    ...nativePackaging,
    ...piSubagentArtifactPackaging,
    // Keep the Windows product registration stable while the public app ID changes.
    // This lets NSIS updates replace the existing installation and own its uninstaller.
    nsis: {
      guid: WINDOWS_INSTALLER_GUID,
    },
    win: {
      target: [input.target],
      icon: "icon.ico",
      ...(input.windowsAzureSignOptions
        ? {
            publisherName: input.windowsAzureSignOptions.publisherName,
            azureSignOptions: input.windowsAzureSignOptions,
          }
        : {}),
    },
  };
}
