import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type AgentSession,
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Effect, Layer } from "effect";
import { NodeFileSystem } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PI_SUBAGENTS_PROTOCOL_VERSION,
  type PiSubagentHandshakeRequest,
  type PiSubagentNegotiatedCapability,
  type ThreadId,
} from "@synara/contracts";

import { ServerConfig, type ServerConfigShape } from "../config.ts";
import {
  makeCompatiblePiSubagentExtension,
  negotiatePiSubagentCapability,
  probePiSubagentBridge,
} from "./piSubagentBridge.ts";
import { makePiAdapterLive } from "./Layers/PiAdapter.ts";
import { PiAdapter } from "./Services/PiAdapter.ts";

interface ProvenanceManifest {
  readonly expectedRepositoryUrl: string;
  readonly pinnedCommit: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly extensionEntryRelativePath: string;
  readonly packageManifestRelativePath: string;
  readonly hashes: Record<string, string>;
}

function loadProvenanceManifest(): ProvenanceManifest {
  const manifestPath = resolve(__dirname, "./test-fixtures/piSubagentExtensionProvenance.json");
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Provenance assertion failed: provenance manifest not found at ${manifestPath}`,
    );
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function computeSha256(filePath: string): string {
  const content = readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeGitUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  if (normalized.endsWith(".git")) {
    normalized = normalized.slice(0, -4);
  }
  if (normalized.startsWith("git@github.com:")) {
    normalized = "https://github.com/" + normalized.slice("git@github.com:".length);
  }
  return normalized;
}

/**
 * Resolves the root of the version-controlled Alfie repository.
 */
export function resolveAlfieRepoDir(): string {
  const candidates = [
    process.env.ALFIE_REPO_DIR,
    process.env.ALFIE_EXTENSION_DIR ? resolve(process.env.ALFIE_EXTENSION_DIR, "../../..") : undefined,
    resolve(process.cwd(), "../../../alfie"),
    resolve(process.cwd(), "../../alfie"),
    resolve(process.cwd(), "../alfie"),
    resolve(__dirname, "../../../../../../alfie"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (dir && existsSync(dir) && existsSync(join(dir, ".git"))) {
      return resolve(dir);
    }
  }
  throw new Error(
    "Provenance assertion failed: could not locate version-controlled alfie repository. Set ALFIE_REPO_DIR or ensure alfie exists alongside symphony.",
  );
}

/**
 * Resolves the path to the separately version-controlled `@alfie/pi-subagents` extension.
 */
export function resolveVersionedExtensionDir(): string {
  const repoDir = resolveAlfieRepoDir();
  const extDir = join(repoDir, "agent/extensions/pi-subagents");
  if (!existsSync(extDir) || !existsSync(join(extDir, "package.json"))) {
    throw new Error(
      `Provenance assertion failed: extension directory not found at '${extDir}'.`,
    );
  }
  return extDir;
}

/**
 * Verifies Git provenance and cryptographic integrity of the Alfie extension.
 */
export function verifyExtensionGitProvenance(repoDir?: string): {
  isVerified: boolean;
  repoDir: string;
  commit: string;
  packageName: string;
  packageVersion: string;
} {
  const manifest = loadProvenanceManifest();
  const dir = repoDir ? resolve(repoDir) : resolveAlfieRepoDir();

  // 1. Verify directory is a Git repository
  try {
    const isGit = execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (isGit !== "true") {
      throw new Error("Directory is not inside a git work tree");
    }
  } catch (err) {
    throw new Error(
      `Provenance assertion failed: '${dir}' is not a valid Git repository: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Verify normalized origin URL
  try {
    const originUrl = execSync("git config --get remote.origin.url", {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const normalizedOrigin = normalizeGitUrl(originUrl);
    const normalizedExpected = normalizeGitUrl(manifest.expectedRepositoryUrl);
    if (normalizedOrigin !== normalizedExpected) {
      throw new Error(
        `Provenance assertion failed: repository origin '${originUrl}' does not match expected '${manifest.expectedRepositoryUrl}'.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Provenance assertion failed:")) {
      throw err;
    }
    throw new Error(`Provenance assertion failed: unable to verify origin URL: ${err}`);
  }

  // 3. Verify HEAD equals pinned commit
  const headCommit = execSync("git rev-parse HEAD", {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (headCommit !== manifest.pinnedCommit) {
    throw new Error(
      `Provenance assertion failed: HEAD commit '${headCommit}' does not match pinned commit '${manifest.pinnedCommit}'.`,
    );
  }

  // 4. Verify extension path is clean
  const gitStatusRaw = execSync("git status --porcelain agent/extensions/pi-subagents", {
    cwd: dir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const gitStatus = gitStatusRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.includes("node_modules"))
    .join("\n");
  if (gitStatus.length > 0) {
    throw new Error(
      `Provenance assertion failed: extension path 'agent/extensions/pi-subagents' has uncommitted changes:\n${gitStatus}`,
    );
  }

  // 5. Verify package name and version
  const pkgPath = join(dir, manifest.packageManifestRelativePath);
  if (!existsSync(pkgPath)) {
    throw new Error(`Provenance assertion failed: package manifest missing at '${pkgPath}'.`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.name !== manifest.packageName) {
    throw new Error(
      `Provenance assertion failed: package name '${pkg.name}' does not match expected '${manifest.packageName}'.`,
    );
  }
  if (pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package version '${pkg.version}' does not match expected '${manifest.packageVersion}'.`,
    );
  }

  // 6. Verify deterministic SHA-256 artifact hashes
  for (const [relPath, expectedHash] of Object.entries(manifest.hashes)) {
    const fullPath = join(dir, relPath);
    if (!existsSync(fullPath)) {
      throw new Error(`Provenance assertion failed: file '${relPath}' missing from extension tree.`);
    }
    const computed = computeSha256(fullPath);
    if (computed !== expectedHash) {
      throw new Error(
        `Provenance assertion failed: SHA-256 mismatch for '${relPath}': expected '${expectedHash}', got '${computed}'.`,
      );
    }
  }

  return {
    isVerified: true,
    repoDir: dir,
    commit: headCommit,
    packageName: pkg.name,
    packageVersion: pkg.version,
  };
}

/**
 * Asserts that the given session has loaded the actual production
 * `@alfie/pi-subagents` extension through the real package discovery path,
 * deriving provenance directly from the loaded artifact manifest and git repository.
 *
 * Satisfies T19-AC7.
 */
export function assertProductionExtensionProvenance(
  session: AgentSession | any,
  explicitRepoDir?: string,
): {
  isProduction: boolean;
  packageName: string;
  extensionVersion: string;
  extensionPath: string;
  toolNames: string[];
} {
  const resourceLoader = session.resourceLoader;
  if (!resourceLoader || typeof resourceLoader.getExtensions !== "function") {
    throw new Error(
      "Provenance assertion failed: session does not expose resourceLoader with getExtensions().",
    );
  }

  const loadedExtensions = resourceLoader.getExtensions()?.extensions;
  if (!Array.isArray(loadedExtensions) || loadedExtensions.length === 0) {
    throw new Error("Provenance assertion failed: no extensions loaded in session.");
  }

  // Find the extension providing the Agent tool or subagents bridge
  const ext = loadedExtensions.find((e: any) => {
    if (!e || typeof e !== "object") return false;
    if (e.tools instanceof Map && e.tools.has("Agent")) return true;
    if (e.handlers instanceof Map && e.handlers.has("synara:subagents:bridge")) return true;
    return false;
  });

  if (!ext) {
    throw new Error(
      "Provenance assertion failed: subagents extension not found among loaded extensions.",
    );
  }

  // Reject inline factories and non-disk paths
  if (!ext.path || ext.path.startsWith("<inline:") || ext.path.startsWith("<temporary")) {
    throw new Error(
      "Provenance assertion failed: extension was injected via inline/temporary factory, not real package discovery.",
    );
  }

  if (
    ext.sourceInfo?.source !== "auto" &&
    ext.sourceInfo?.source !== "local" &&
    ext.sourceInfo?.source !== "package"
  ) {
    throw new Error(
      `Provenance assertion failed: extension source '${ext.sourceInfo?.source}' is not a production discovery source.`,
    );
  }

  if (!existsSync(ext.path)) {
    throw new Error(
      `Provenance assertion failed: extension entry path '${ext.path}' does not exist on disk.`,
    );
  }

  // Locate package.json from extension entry path
  let currentDir = dirname(ext.path);
  let packageJsonPath: string | undefined;
  for (let i = 0; i < 4; i++) {
    const candidate = join(currentDir, "package.json");
    if (existsSync(candidate)) {
      packageJsonPath = candidate;
      break;
    }
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  if (!packageJsonPath) {
    throw new Error(
      `Provenance assertion failed: could not locate package.json for extension at '${ext.path}'.`,
    );
  }

  let pkg: any;
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (err) {
    throw new Error(`Provenance assertion failed: unable to parse '${packageJsonPath}': ${err}`);
  }

  const manifest = loadProvenanceManifest();
  if (pkg.name !== manifest.packageName) {
    throw new Error(
      `Provenance assertion failed: package name is '${pkg.name}', expected '${manifest.packageName}'.`,
    );
  }

  if (pkg.version !== manifest.packageVersion) {
    throw new Error(
      `Provenance assertion failed: package version is '${pkg.version}', expected '${manifest.packageVersion}'.`,
    );
  }

  // Verify full 9-field production parameter schema on Agent tool
  const tools = session.getAllTools();
  const agentTool = tools.find((t: any) => t.name === "Agent");
  if (!agentTool) {
    throw new Error("Provenance assertion failed: 'Agent' tool is not registered on session.");
  }

  const params = agentTool.parameters as any;
  const props = params?.properties;
  const isCompleteSchema =
    props &&
    typeof props === "object" &&
    "task" in props &&
    "context" in props &&
    "link_references" in props &&
    "expected_outcome" in props &&
    "subagent_type" in props &&
    "thinking" in props &&
    "run_in_background" in props &&
    "resume" in props &&
    "isolation" in props;

  if (!isCompleteSchema) {
    throw new Error(
      "Provenance assertion failed: Agent tool is missing required fields from the complete 9-field delegation schema.",
    );
  }

  // Verify Git provenance and artifact hashes
  const repoDir = explicitRepoDir ?? resolveAlfieRepoDir();
  verifyExtensionGitProvenance(repoDir);

  const registeredToolNames = tools.map((t: any) => t.name);
  return {
    isProduction: true,
    packageName: pkg.name,
    extensionVersion: pkg.version,
    extensionPath: ext.path,
    toolNames: registeredToolNames,
  };
}

const createdDirs: string[] = [];

afterEach(() => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  createdDirs.length = 0;
});

async function createRealPiSession(): Promise<{
  session: AgentSession;
  services: any;
  tempAgentDir: string;
}> {
  const versionedDir = resolveVersionedExtensionDir();
  const tempAgentDir = `/tmp/synara-real-pi-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createdDirs.push(tempAgentDir);

  const extensionsDir = join(tempAgentDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  symlinkSync(versionedDir, join(extensionsDir, "pi-subagents"), "dir");
  const sharedDir = join(versionedDir, "..", "shared");
  if (existsSync(sharedDir)) {
    symlinkSync(sharedDir, join(extensionsDir, "shared"), "dir");
  }

  const modelRuntime = await ModelRuntime.create({
    authPath: join(tempAgentDir, "auth.json"),
    modelsPath: null,
  });

  const services = await createAgentSessionServices({
    cwd: tempAgentDir,
    agentDir: tempAgentDir,
    modelRuntime,
  });

  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(tempAgentDir),
  });

  await session.bindExtensions({});
  return { session, services, tempAgentDir };
}

describe("Real Pi Subagent Extension Capability Negotiation (Issue 19)", () => {
  it("T19-AC1, T19-AC7: production Pi provider session with actual extension negotiates protocol and capability set", async () => {
    const { session } = await createRealPiSession();

    // Provenance assertion: verify this is the real production extension loaded via discovery
    const provenance = assertProductionExtensionProvenance(session);
    expect(provenance.isProduction).toBe(true);
    expect(provenance.packageName).toBe("@alfie/pi-subagents");
    expect(provenance.extensionVersion).toBe("0.10.0-alfie.1");
    expect(provenance.toolNames).toContain("Agent");
    expect(provenance.toolNames).toContain("get_subagent_result");
    expect(provenance.toolNames).toContain("steer_subagent");

    // Negotiate capability on production session
    const capability = await probePiSubagentBridge(session);

    expect(capability.isManaged).toBe(true);
    expect(capability.status).toBe("managed_enabled");
    expect(capability.diagnosticCode).toBe("pi_subagent_managed_enabled");
    expect(capability.protocolVersion).toBe(PI_SUBAGENTS_PROTOCOL_VERSION);
    expect(capability.extensionVersion).toBe("0.10.0-alfie.1");
    expect(capability.capabilities).toEqual(["managed-spawn", "abort-propagation"]);

    session.dispose();
  });

  it("T19-AC2: fails closed with pi_subagent_capability_mismatch when a required capability is missing", async () => {
    const { session } = await createRealPiSession();

    // Extract real bridge from the session
    const resourceLoader = session.resourceLoader;
    const ext = resourceLoader.getExtensions().extensions[0] as any;
    const bridgeHandlers = ext.handlers.get("synara:subagents:bridge");
    expect(bridgeHandlers).toBeDefined();
    const bridge = bridgeHandlers[0]();

    // Request handshake with an unprovided required capability
    const requestWithMissing: PiSubagentHandshakeRequest = {
      protocolVersion: PI_SUBAGENTS_PROTOCOL_VERSION,
      supportedProtocolVersions: [PI_SUBAGENTS_PROTOCOL_VERSION],
      clientVersion: "0.7.2",
      requiredCapabilities: [
        "managed-spawn",
        "abort-propagation",
        "future-nonexistent-capability" as any,
      ],
    };

    const result = await negotiatePiSubagentCapability(bridge, requestWithMissing);

    expect(result.isManaged).toBe(false);
    expect(result.status).toBe("capability_mismatch");
    expect(result.diagnosticCode).toBe("pi_subagent_capability_mismatch");
    expect(result.missingCapabilities).toEqual(["future-nonexistent-capability"]);
    expect(result.diagnosticMessage).toContain("future-nonexistent-capability");

    session.dispose();
  });

  it("T19-AC3: distinguishable stable diagnostics for all handshake outcomes", async () => {
    // 1. Bridge absent
    const emptySession = { resourceLoader: { getExtensions: () => ({ extensions: [] }) } };
    const absentResult = await probePiSubagentBridge(emptySession);
    expect(absentResult.status).toBe("bridge_absent");
    expect(absentResult.diagnosticCode).toBe("pi_subagent_bridge_absent");
    expect(absentResult.isManaged).toBe(false);

    // 2. Malformed bridge response
    const malformedBridge = {
      handshake: vi.fn().mockResolvedValue({ not: "valid" }),
    };
    const malformedResult = await negotiatePiSubagentCapability(malformedBridge as any);
    expect(malformedResult.status).toBe("bridge_malformed_response");
    expect(malformedResult.diagnosticCode).toBe("pi_subagent_bridge_malformed_response");
    expect(malformedResult.isManaged).toBe(false);

    // 3. Bridge failure (throws)
    const failingBridge = {
      handshake: vi.fn().mockRejectedValue(new Error("Connection reset")),
    };
    const errorResult = await negotiatePiSubagentCapability(failingBridge as any);
    expect(errorResult.status).toBe("bridge_error");
    expect(errorResult.diagnosticCode).toBe("pi_subagent_bridge_error");
    expect(errorResult.diagnosticMessage).toContain("Connection reset");

    // 4. Unsupported protocol version
    const { session } = await createRealPiSession();
    const ext = session.resourceLoader.getExtensions().extensions[0] as any;
    const realBridge = ext.handlers.get("synara:subagents:bridge")[0]();

    const unsupportedRequest: PiSubagentHandshakeRequest = {
      protocolVersion: 99 as any,
      supportedProtocolVersions: [99 as any, 100 as any],
      clientVersion: "0.7.2",
      requiredCapabilities: ["managed-spawn"],
    };
    const unsupportedResult = await negotiatePiSubagentCapability(realBridge, unsupportedRequest);
    expect(unsupportedResult.status).toBe("unsupported_version");
    expect(unsupportedResult.diagnosticCode).toBe("pi_subagent_unsupported_version");
    expect(unsupportedResult.offeredVersion).toBe(99);
    expect(unsupportedResult.supportedVersions).toEqual([1]);

    // 5. Capability mismatch
    const mismatchRequest: PiSubagentHandshakeRequest = {
      protocolVersion: 1,
      supportedProtocolVersions: [1],
      clientVersion: "0.7.2",
      requiredCapabilities: ["nonexistent-capability" as any],
    };
    const mismatchResult = await negotiatePiSubagentCapability(realBridge, mismatchRequest);
    expect(mismatchResult.status).toBe("capability_mismatch");
    expect(mismatchResult.diagnosticCode).toBe("pi_subagent_capability_mismatch");

    // Verify all 5 negative diagnostic codes are unique
    const codes = [
      absentResult.diagnosticCode,
      malformedResult.diagnosticCode,
      errorResult.diagnosticCode,
      unsupportedResult.diagnosticCode,
      mismatchResult.diagnosticCode,
    ];
    const uniqueCodes = new Set(codes);
    expect(uniqueCodes.size).toBe(5);

    session.dispose();
  });

  it("T19-AC4: probe result is idempotent and stable for session lifetime", async () => {
    const { session } = await createRealPiSession();

    const probe1 = await probePiSubagentBridge(session);
    const probe2 = await probePiSubagentBridge(session);
    const probe3 = await probePiSubagentBridge(session);

    expect(probe1).toBe(probe2); // Identical reference from cache
    expect(probe2).toBe(probe3);
    expect(probe1.isManaged).toBe(true);
    expect(probe1.diagnosticCode).toBe("pi_subagent_managed_enabled");

    session.dispose();
  });

  it("T19-AC5: probe creates no execution, transcript, notification, or model context change", async () => {
    const { session } = await createRealPiSession();

    const toolsBefore = session.getAllTools().map((t: any) => t.name);
    const messagesBefore = session.sessionManager.getEntries?.() ?? [];

    await probePiSubagentBridge(session);

    const toolsAfter = session.getAllTools().map((t: any) => t.name);
    const messagesAfter = session.sessionManager.getEntries?.() ?? [];

    // Tool catalog unchanged
    expect(toolsAfter).toEqual(toolsBefore);
    // Session history unchanged (no executions, notifications, or transcript items added)
    expect(messagesAfter).toEqual(messagesBefore);

    session.dispose();
  });

  it("T19-AC6: outside Synara or without negotiation, actual extension retains complete legacy behavior", async () => {
    const { session } = await createRealPiSession();

    // Provenance check
    const provenance = assertProductionExtensionProvenance(session);
    expect(provenance.isProduction).toBe(true);

    // Verify Agent tool is intact with all standard documentation and schema
    const tools = session.getAllTools();
    const agentTool = tools.find((t: any) => t.name === "Agent");
    expect(agentTool).toBeDefined();
    expect(agentTool.description).toContain("Launch a new agent to handle complex");
    expect(agentTool.description).toContain("Writing the delegation request");

    // The parameters contain the full 9-field production delegation schema
    const params = agentTool.parameters as any;
    expect(params.properties.task).toBeDefined();
    expect(params.properties.context).toBeDefined();
    expect(params.properties.link_references).toBeDefined();
    expect(params.properties.expected_outcome).toBeDefined();
    expect(params.properties.subagent_type).toBeDefined();
    expect(params.properties.thinking).toBeDefined();
    expect(params.properties.run_in_background).toBeDefined();
    expect(params.properties.resume).toBeDefined();
    expect(params.properties.isolation).toBeDefined();

    session.dispose();
  });

  it("T19-AC7: test provenance assertion fails for synthetic test fixtures and realistic on-disk lookalikes", () => {
    // 1. Synthetic session from inline factory
    const { extension } = makeCompatiblePiSubagentExtension();
    const fakeTools: any[] = [];
    const fakePi = {
      registerTool: (t: any) => fakeTools.push(t),
      on: () => {},
    };
    extension.factory(fakePi);

    const syntheticSession = {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [
            {
              path: "<inline:1>",
              sourceInfo: { source: "temporary" },
              tools: new Map([["Agent", {}]]),
            },
          ],
        }),
      },
      getAllTools: () => fakeTools,
    };

    expect(() => assertProductionExtensionProvenance(syntheticSession)).toThrow(
      /inline\/temporary factory/i,
    );

    // 2. Realistic on-disk lookalike with exact full 9-field parameter schema but failing git provenance/integrity
    const lookalikeDir = `/tmp/synara-lookalike-test-${Date.now()}`;
    createdDirs.push(lookalikeDir);
    mkdirSync(lookalikeDir, { recursive: true });

    // Create realistic package.json with the same package name and version
    writeFileSync(
      join(lookalikeDir, "package.json"),
      JSON.stringify({
        name: "@alfie/pi-subagents",
        version: "0.10.0-alfie.1",
        description: "Synthetic lookalike package",
      }),
    );

    // Create realistic entry file
    const entryPath = join(lookalikeDir, "index.ts");
    writeFileSync(entryPath, "// lookalike entry\nexport default function() {}");

    const full9FieldProperties = {
      task: { type: "string" },
      context: { type: "string" },
      link_references: { type: "string" },
      expected_outcome: { type: "string" },
      subagent_type: { type: "string" },
      thinking: { type: "string" },
      run_in_background: { type: "boolean" },
      resume: { type: "string" },
      isolation: { type: "string" },
    };

    const realisticLookalikeSession = {
      resourceLoader: {
        getExtensions: () => ({
          extensions: [
            {
              path: entryPath,
              sourceInfo: { source: "auto" },
              tools: new Map([["Agent", {}]]),
              handlers: new Map([
                [
                  "synara:subagents:bridge",
                  [
                    () => ({
                      handshake: () => ({
                        ok: true,
                        protocolVersion: 1,
                        extensionVersion: "0.10.0-alfie.1",
                        capabilities: ["managed-spawn", "abort-propagation"],
                      }),
                    }),
                  ],
                ],
              ]),
            },
          ],
        }),
      },
      getAllTools: () => [
        {
          name: "Agent",
          parameters: { properties: full9FieldProperties },
        },
      ],
    };

    // Fails provenance assertion because lookalike directory is not the pinned Git repo
    expect(() =>
      assertProductionExtensionProvenance(realisticLookalikeSession, lookalikeDir),
    ).toThrow(/Provenance assertion failed/i);
  });

  it("Section E: exercises the production PiAdapter session/bootstrap boundary", async () => {
    const versionedDir = resolveVersionedExtensionDir();
    const tempAgentDir = `/tmp/synara-piadapter-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdDirs.push(tempAgentDir);

    const extensionsDir = join(tempAgentDir, "extensions");
    mkdirSync(extensionsDir, { recursive: true });
    symlinkSync(versionedDir, join(extensionsDir, "pi-subagents"), "dir");
    const sharedDir = join(versionedDir, "..", "shared");
    if (existsSync(sharedDir)) {
      symlinkSync(sharedDir, join(extensionsDir, "shared"), "dir");
    }

    const serverConfig: ServerConfigShape = {
      mode: "web",
      port: 3773,
      host: "127.0.0.1",
      cwd: tempAgentDir,
      homeDir: tempAgentDir,
      chatWorkspaceRoot: tempAgentDir,
      studioWorkspaceRoot: tempAgentDir,
      baseDir: tempAgentDir,
      stateDir: tempAgentDir,
      secretsDir: tempAgentDir,
      dbPath: join(tempAgentDir, "state.sqlite"),
      settingsPath: join(tempAgentDir, "settings.json"),
      keybindingsConfigPath: join(tempAgentDir, "keybindings.json"),
      worktreesDir: tempAgentDir,
      attachmentsDir: tempAgentDir,
      logsDir: tempAgentDir,
      serverLogPath: join(tempAgentDir, "server.log"),
      serverRuntimeStatePath: join(tempAgentDir, "runtime.json"),
      providerLogsDir: tempAgentDir,
      providerEventLogPath: join(tempAgentDir, "provider.ndjson"),
      terminalLogsDir: tempAgentDir,
      environmentIdPath: join(tempAgentDir, "env-id"),
      staticDir: undefined,
      devUrl: undefined,
      publicUrl: undefined,
      allowInsecureRemote: false,
      noBrowser: true,
      authToken: undefined,
      autoBootstrapProjectFromCwd: false,
      logProviderEvents: false,
      logWebSocketEvents: false,
    };

    let observedEvent:
      | {
          readonly threadId: ThreadId;
          readonly capability: PiSubagentNegotiatedCapability;
          readonly session: any;
          readonly context: any;
        }
      | undefined;

    const piAdapterLayer = makePiAdapterLive({
      onSubagentCapability: (event) => {
        observedEvent = event;
      },
    }).pipe(
      Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
      Layer.provide(NodeFileSystem.layer),
    );

    const testProgram = Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const session = yield* adapter.startSession({
        threadId: "th_prod_test_1" as ThreadId,
        cwd: tempAgentDir,
        providerOptions: {
          pi: {
            agentDir: tempAgentDir,
          },
        },
      });

      return { adapter, session };
    });

    const { adapter } = await Effect.runPromise(
      testProgram.pipe(Effect.provide(piAdapterLayer)),
    );

    // 1. Verify negotiated capability was stored and exposed via observation seam
    expect(observedEvent).toBeDefined();
    expect(observedEvent!.capability.isManaged).toBe(true);
    expect(observedEvent!.capability.status).toBe("managed_enabled");
    expect(observedEvent!.capability.diagnosticCode).toBe("pi_subagent_managed_enabled");
    expect(observedEvent!.capability.protocolVersion).toBe(1);
    expect(observedEvent!.capability.extensionVersion).toBe("0.10.0-alfie.1");
    expect(observedEvent!.capability.capabilities).toEqual(["managed-spawn", "abort-propagation"]);

    // 2. Verify stored in session context
    expect(observedEvent!.context.subagentCapability).toEqual(observedEvent!.capability);

    // 3. Verify probe identity is stable for session lifetime
    const secondProbe = await probePiSubagentBridge(observedEvent!.session);
    expect(secondProbe).toBe(observedEvent!.capability);

    // 4. Verify no child execution or transcript side effects occurred
    const entries = observedEvent!.session.sessionManager?.getEntries?.() ?? [];
    const executionEntries = entries.filter(
      (e: any) => e.type === "message" || e.type === "subagent" || e.type === "task",
    );
    expect(executionEntries).toHaveLength(0);

    // Stop session cleanly
    await Effect.runPromise(
      adapter.stopSession("th_prod_test_1" as ThreadId).pipe(Effect.provide(piAdapterLayer)),
    );
  });
});
