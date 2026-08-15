// FILE: serverProcess.ts
// Purpose: WP4 — spawn and tear down the conflict-free isolated Synara
// server for the Synara modes (Decision 34 §5). The server runs with its own
// temp home directory (state/secrets/db/logs), an explicit loopback IPv4
// host, a non-default port, provider event logging enabled (so the canonical
// `turn.completed` records with raw SessionStats are persisted), and the
// user's SYNARA_AUTH_TOKEN deliberately unset (loopback-only, no auth).
// Teardown always stops the process and removes the temp state; credentials
// and session state never outlive the run.
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_READY_POLL_MS = 200;
const SERVER_READY_TIMEOUT_MS = 90_000;
const SERVER_TERMINATE_GRACE_MS = 8_000;
const SERVER_KILL_GRACE_MS = 4_000;

export interface IsolatedServerCatalogObserverConfig {
  /** The measurement mode the observer must capture (Decision 35). */
  readonly mode: "synara-default" | "synara-activated";
}

export interface IsolatedServer {
  readonly homeDir: string;
  readonly port: number;
  readonly stdoutPath: string;
  readonly stderrPath: string;
  readonly providerEventLogPath: string;
  /**
   * Working directory of the isolated child process. It is the isolated home
   * dir (never the repo), so any cwd-relative runtime state Pi writes (e.g.
   * extension `.pi` notifications) stays inside the temp home and is removed
   * with it.
   */
  readonly cwd: string;
  /**
   * Decision 35 catalog observer artifact path (inside the isolated home),
   * or null when the observer is not configured for this server. Normal
   * isolated runs (and the user's own Synara instance) never configure it.
   */
  readonly catalogArtifactPath: string | null;
  readonly process: ChildProcess;
  readonly stop: () => Promise<void>;
}

export async function findFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function resolveServerEntry(): { readonly cwd: string; readonly entry: string } {
  // The harness lives under apps/server; run the server CLI from the package
  // root so workspace imports and node_modules resolve exactly like `bun run dev`.
  // Resolve robustly under both Bun (import.meta.url = real path) and vitest's
  // node runner (module URL may be virtualized): walk upward from this file
  // until the directory that contains src/index.ts is found.
  const here = path.dirname(fileURLToPath(import.meta.url));
  let cursor = here;
  for (let depth = 0; depth < 8; depth += 1) {
    if (fs.existsSync(path.join(cursor, "src", "index.ts"))) {
      return { cwd: cursor, entry: "src/index.ts" };
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Could not resolve the apps/server package root from '${here}' (no src/index.ts found in any parent).`,
  );
}

/**
 * The isolated server must run under Bun (the repo's runtime). When the
 * harness itself runs under Bun, process.execPath is the bun binary; under
 * node (e.g. vitest's node runner) fall back to the known bun locations.
 */
function resolveBunExecutable(): string {
  if (typeof Bun !== "undefined" && typeof process.execPath === "string") {
    return process.execPath;
  }
  const candidates = [
    process.env.BUN_BINARY_PATH,
    process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, "bin", "bun") : undefined,
    path.join(os.homedir(), ".bun", "bin", "bun"),
    "bun",
  ].filter((candidate): candidate is string => typeof candidate === "string");
  return candidates[0] ?? "bun";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpReadiness(
  port: number,
  timeoutMs: number,
  stderrPath: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ws/negotiate`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      // Any HTTP answer (including a 426 compatibility verdict) means the
      // server is up and accepting connections.
      if (response.status >= 200 && response.status < 600) {
        return;
      }
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    }
    await sleep(SERVER_READY_POLL_MS);
  }
  const tail = readTail(stderrPath, 40);
  throw new Error(
    `Isolated Synara server did not become ready on port ${port} within ${timeoutMs}ms (last error: ${lastError}).\nServer stderr tail:\n${tail}`,
  );
}

function readTail(filePath: string, lines: number): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const tail = content.split("\n").slice(-lines).join("\n");
    return tail.length > 4_000 ? `…${tail.slice(-4_000)}` : tail;
  } catch {
    return "(server log unavailable)";
  }
}

export async function startIsolatedServer(input: {
  readonly agentDir?: string;
  readonly port?: number;
  /**
   * Decision 35 measurement-only observer configuration. The harness sets it
   * only for the applicable repetition's isolated child server; the explicit
   * enable flag, the isolated-home root, the artifact destination (inside the
   * home), and the mode are passed to the child through its environment.
   */
  readonly catalogObserver?: IsolatedServerCatalogObserverConfig;
}): Promise<IsolatedServer> {
  const port = input.port ?? (await findFreePort());
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-token-overhead-"));
  const { cwd, entry } = resolveServerEntry();
  const stdoutPath = path.join(homeDir, "server.stdout.log");
  const stderrPath = path.join(homeDir, "server.stderr.log");
  const stdout = fs.openSync(stdoutPath, "w");
  const stderr = fs.openSync(stderrPath, "w");
  const catalogArtifactPath =
    input.catalogObserver === undefined ? null : path.join(homeDir, "catalog-artifact.json");

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The isolated server must never inherit the user's auth token: the
    // harness connects unauthenticated over loopback.
    SYNARA_AUTH_TOKEN: "",
    SYNARA_NO_BROWSER: "1",
    SYNARA_LOG_PROVIDER_EVENTS: "1",
    ...(input.agentDir === undefined ? {} : { PI_CODING_AGENT_DIR: input.agentDir }),
    // Decision 35: the measurement-only observer is enabled only in the
    // isolated child server, with its artifact confined to this home. The
    // child never inherits observer configuration from its own environment.
    ...(input.catalogObserver === undefined
      ? {}
      : {
          SYNARA_MEASUREMENT_CATALOG_OBSERVER: "1",
          SYNARA_MEASUREMENT_CATALOG_HOME: homeDir,
          SYNARA_MEASUREMENT_CATALOG_ARTIFACT_PATH: catalogArtifactPath!,
          SYNARA_MEASUREMENT_CATALOG_MODE: input.catalogObserver.mode,
        }),
  };

  const child = spawn(
    resolveBunExecutable(),
    [
      "run",
      // Absolute entry so module resolution stays file-relative while the
      // child cwd is the isolated home dir.
      path.join(cwd, entry),
      "--",
      "--home-dir",
      homeDir,
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--mode",
      "web",
      "--no-browser",
      "--log-provider-events",
    ],
    {
      // The child must never run with the repo as its cwd: Pi sessions in the
      // server load user extensions that write project-local `.pi` state next
      // to process.cwd(), which would leak repo-local runtime state. With the
      // cwd inside the isolated home, all cwd-relative writes are confined to
      // the temp home and removed at teardown.
      cwd: homeDir,
      env,
      stdio: ["ignore", stdout, stderr],
      detached: false,
    },
  );

  const providerEventLogPath = path.join(homeDir, "userdata", "logs", "provider", "_global.log");

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null && child.signalCode !== null) {
      // Already fully exited; only cleanup remains.
      closeFds();
      return;
    }
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
    const termination = Promise.race([
      exited,
      sleep(SERVER_TERMINATE_GRACE_MS).then(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
          return sleep(SERVER_KILL_GRACE_MS);
        }
      }),
    ]);
    child.kill("SIGTERM");
    await termination;
    closeFds();
  };

  const closeFds = () => {
    for (const fd of [stdout, stderr]) {
      try {
        fs.closeSync(fd);
      } catch {
        // FDs may already be closed after the child exited.
      }
    }
  };

  try {
    await waitForHttpReadiness(port, SERVER_READY_TIMEOUT_MS, stderrPath);
  } catch (cause) {
    await stop();
    fs.rmSync(homeDir, { recursive: true, force: true });
    throw cause;
  }

  return {
    homeDir,
    port,
    stdoutPath,
    stderrPath,
    providerEventLogPath,
    cwd: homeDir,
    catalogArtifactPath,
    process: child,
    stop,
  };
}

export function removeIsolatedHomeDir(homeDir: string): void {
  fs.rmSync(homeDir, { recursive: true, force: true });
}
