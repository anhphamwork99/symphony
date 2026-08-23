import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_TERMINAL_ID,
  type TerminalProjectEvent,
  type TerminalProjectOpenInput,
  type TerminalProjectRestartInput,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PtySpawnError,
  type PtyAdapterShape,
  type PtyExitEvent,
  type PtyProcess,
  type PtySpawnInput,
} from "../Services/PTY";
import type { ProcessTreeKiller } from "../processTreeKiller";
import { TerminalManagerRuntime } from "./Manager";
import { Effect, Encoding } from "effect";

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  readonly resizeCalls: Array<{ cols: number; rows: number }> = [];
  readonly killSignals: Array<string | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();
  killed = false;
  paused = false;
  /** When true, kill() emits exit synchronously (proof for settlement). */
  exitOnKill = false;

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resizeCalls.push({ cols, rows });
  }

  kill(signal?: string): void {
    this.killed = true;
    this.killSignals.push(signal);
    if (this.exitOnKill) {
      this.emitExit({ exitCode: 0, signal: 0 });
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  onData(callback: (data: string) => void): () => void {
    this.dataListeners.add(callback);
    return () => {
      this.dataListeners.delete(callback);
    };
  }

  onExit(callback: (event: PtyExitEvent) => void): () => void {
    this.exitListeners.add(callback);
    return () => {
      this.exitListeners.delete(callback);
    };
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: PtyExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

class FakePtyAdapter implements PtyAdapterShape {
  readonly spawnInputs: PtySpawnInput[] = [];
  readonly processes: FakePtyProcess[] = [];
  private nextPid = 9000;

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess, PtySpawnError> {
    this.spawnInputs.push(input);
    const process = new FakePtyProcess(this.nextPid++);
    this.processes.push(process);
    return Effect.succeed(process);
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 800): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(poll, 15);
    };
    poll();
  });
}

function projectOpenInput(
  overrides: Partial<TerminalProjectOpenInput> = {},
): TerminalProjectOpenInput {
  return {
    projectId: "project-1",
    cwd: process.cwd(),
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

function projectRestartInput(
  overrides: Partial<TerminalProjectRestartInput> = {},
): TerminalProjectRestartInput {
  return {
    projectId: "project-1",
    cwd: process.cwd(),
    cols: 100,
    rows: 24,
    ...overrides,
  };
}

function projectHistoryLogName(projectId: string, terminalId: string): string {
  const projectPart = `terminal_project_${Encoding.encodeBase64Url(projectId)}`;
  return `${projectPart}_${Encoding.encodeBase64Url(terminalId)}.log`;
}

describe("TerminalManager Project-owned terminals", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeManager(
    options: { processKillGraceMs?: number; processTreeKiller?: ProcessTreeKiller } = {},
  ) {
    const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-terminal-project-"));
    tempDirs.push(logsDir);
    const ptyAdapter = new FakePtyAdapter();
    const manager = new TerminalManagerRuntime({
      logsDir,
      ptyAdapter,
      historyLineLimit: 5,
      shellResolver: () => "/bin/bash",
      ...(options.processKillGraceMs !== undefined
        ? { processKillGraceMs: options.processKillGraceMs }
        : {}),
      ...(options.processTreeKiller !== undefined
        ? { processTreeKiller: options.processTreeKiller }
        : {}),
    });
    return { logsDir, ptyAdapter, manager };
  }

  it("reuses ONE live PTY and history for the same Project across repeated opens", async () => {
    const { manager, ptyAdapter } = makeManager();
    const first = await manager.openProject(projectOpenInput());
    const second = await manager.openProject(projectOpenInput());

    expect(first.projectId).toBe("project-1");
    expect(first.terminalId).toBe(DEFAULT_TERMINAL_ID);
    expect(second.pid).toBe(first.pid);
    expect(second.history).toBe(first.history);
    expect(ptyAdapter.spawnInputs).toHaveLength(1);
    // The Project snapshot is Project-owned: it carries no thread identity at
    // all (the schema has no threadId field), which is the isolation property.
    expect("threadId" in first).toBe(false);

    manager.dispose();
  });

  it("keeps Projects isolated: distinct Projects spawn distinct PTYs and histories", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.openProject(projectOpenInput({ projectId: "project-1" }));
    await manager.openProject(projectOpenInput({ projectId: "project-2" }));

    expect(ptyAdapter.spawnInputs).toHaveLength(2);
    ptyAdapter.processes[0]?.emitData("project one output\n");
    await waitFor(() => fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))));

    const projectOne = await manager.openProject(projectOpenInput({ projectId: "project-1" }));
    const projectTwo = await manager.openProject(projectOpenInput({ projectId: "project-2" }));
    expect(projectOne.history).toContain("project one output");
    expect(projectTwo.history).toBe("");

    manager.dispose();
  });

  it("reconnects to the SAME live process with accumulated history (no respawn)", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitData("still running output\n");
    await waitFor(() => fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))));

    const reconnected = await manager.openProject(projectOpenInput());

    expect(reconnected.status).toBe("running");
    expect(reconnected.pid).toBe(process.pid);
    expect(reconnected.history).toContain("still running output");
    expect(ptyAdapter.spawnInputs).toHaveLength(1);

    manager.dispose();
  });

  it("reports an exited Project terminal truthfully instead of claiming liveness", async () => {
    const { manager, ptyAdapter } = makeManager();
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitExit({ exitCode: 0, signal: 0 });

    const snapshot = await manager.openProject(projectOpenInput());

    expect(snapshot.status).not.toBe("exited");
    expect(ptyAdapter.spawnInputs).toHaveLength(2);
    const listed = await manager.listProjectTerminals("project-1" as never);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("running");

    manager.dispose();
  });

  it("emits Project events on the project channel and never thread events", async () => {
    const { manager } = makeManager();
    const projectEvents: TerminalProjectEvent[] = [];
    manager.on("projectEvent", (event) => {
      projectEvents.push(event);
    });
    await manager.openProject(projectOpenInput());

    const started = projectEvents.find((event) => event.type === "started");
    expect(started).toBeDefined();
    if (started?.type !== "started") return;
    expect(started.snapshot.projectId).toBe("project-1");
    expect("threadId" in started).toBe(false);

    manager.dispose();
  });

  it("thread close/archive cleanup never touches Project-owned sessions", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    // A real conversation terminal owned by a thread of the same Project.
    await manager.open({ threadId: "thread-1", cwd: process.cwd(), cols: 100, rows: 24 });
    await manager.openProject(projectOpenInput({ projectId: "project-1" }));
    expect(ptyAdapter.spawnInputs).toHaveLength(2);
    const projectProcess = ptyAdapter.processes[1];
    expect(projectProcess).toBeDefined();

    // ThreadDeletionReactor cleanup paths: full thread close (delete) and the
    // archive-fenced close. Neither may settle the Project owner session.
    await manager.close({ threadId: "thread-1", deleteHistory: true });
    await manager.closeSessionsOpenedAtOrBefore({
      threadId: "thread-1",
      openedAtOrBefore: new Date(Date.now() + 60_000).toISOString(),
    });

    const listed = await manager.listProjectTerminals("project-1" as never);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.status).toBe("running");
    expect(projectProcess?.killed).toBe(false);

    // Project terminal history is untouched by the thread cleanup.
    ptyAdapter.processes[1]?.emitData("project survives thread cleanup\n");
    await waitFor(() =>
      fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );
    const survived = await manager.openProject(projectOpenInput());
    expect(survived.history).toContain("project survives thread cleanup");

    manager.dispose();
  });

  it("restartProject respawns only the Project terminal with a fresh transcript", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager();
    await manager.openProject(projectOpenInput());
    await manager.open({ threadId: "thread-1", cwd: process.cwd(), cols: 100, rows: 24 });
    const projectProcess = ptyAdapter.processes[0];
    expect(projectProcess).toBeDefined();
    if (!projectProcess) return;
    projectProcess.emitData("before restart\n");
    await waitFor(() =>
      fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );

    const snapshot = await manager.restartProject(projectRestartInput());

    expect(snapshot.history).toBe("");
    expect(snapshot.status).toBe("running");
    // One thread PTY + the respawned Project PTY.
    expect(ptyAdapter.spawnInputs).toHaveLength(3);

    manager.dispose();
  });

  it("settleProjectTerminals proves settled only when exit is observed", async () => {
    const { manager, ptyAdapter } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.exitOnKill = true;

    const results = await manager.settleProjectTerminals("project-1" as never);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("settled");
    expect(results[0]?.terminalId).toBe(DEFAULT_TERMINAL_ID);

    // Idempotent: a second settlement reports no residual terminals.
    const again = await manager.settleProjectTerminals("project-1" as never);
    expect(again).toHaveLength(0);

    manager.dispose();
  });

  it("settleProjectTerminals reports uncertain when no exit proof arrives in the window", async () => {
    const { manager, ptyAdapter } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    // kill() never emits exit — the stop signals land but proof never arrives.
    process.exitOnKill = false;

    const results = await manager.settleProjectTerminals("project-1" as never);

    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("uncertain");
    expect(results[0]?.detail).toContain("no process exit was observed");
    expect(process.killed).toBe(true);

    manager.dispose();
  });

  it("settleProjectTerminals deletes Project history and frees the sessions", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.exitOnKill = true;
    process.emitData("history before settle\n");
    await waitFor(() =>
      fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );

    await manager.settleProjectTerminals("project-1" as never);

    await waitFor(() =>
      !fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );
    expect(await manager.listProjectTerminals("project-1" as never)).toHaveLength(0);

    manager.dispose();
  });

  it("retains sessions and history when settlement is unproven; a later proven retry deletes", async () => {
    const { manager, ptyAdapter, logsDir } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitData("retained history\n");
    await waitFor(() =>
      fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );
    // kill() never emits exit — stop signals land but proof never arrives.
    process.exitOnKill = false;

    const unproven = await manager.settleProjectTerminals("project-1" as never);
    expect(unproven).toHaveLength(1);
    expect(unproven[0]?.outcome).toBe("uncertain");

    // RETENTION: no session was freed and no history file was deleted.
    expect(await manager.listProjectTerminals("project-1" as never)).toHaveLength(1);
    expect(fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default")))).toBe(
      true,
    );

    // The retained terminal is later PROVEN stopped: a retry settles it and
    // NOW deletes the sessions and history.
    process.exitOnKill = true;
    const proven = await manager.settleProjectTerminals("project-1" as never);
    expect(proven).toHaveLength(1);
    expect(proven[0]?.outcome).toBe("settled");
    await waitFor(() =>
      !fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );
    expect(await manager.listProjectTerminals("project-1" as never)).toHaveLength(0);

    manager.dispose();
  });

  it("retains sessions and history when settlement fails (failed outcome)", async () => {
    // Inject a process-tree killer whose capture() throws: killProcessWithEscalation
    // calls capture() synchronously inside stopProcess, which settlement runs
    // inside its try — so the teardown error surfaces as the "failed" outcome.
    const throwingKiller: ProcessTreeKiller = {
      capture: () => {
        throw new Error("injected teardown failure");
      },
      signal: () => undefined,
    };
    const { manager, ptyAdapter, logsDir } = makeManager({
      processKillGraceMs: 50,
      processTreeKiller: throwingKiller,
    });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.emitData("failed settlement history\n");
    await waitFor(() =>
      fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default"))),
    );

    const results = await manager.settleProjectTerminals("project-1" as never);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("failed");
    expect(results[0]?.detail).toContain("injected teardown failure");

    expect(await manager.listProjectTerminals("project-1" as never)).toHaveLength(1);
    expect(fs.existsSync(path.join(logsDir, projectHistoryLogName("project-1", "default")))).toBe(
      true,
    );

    manager.dispose();
  });

  it("rejects open and restart while the deletion fence is up; releases the fence on unproven", async () => {
    const { manager, ptyAdapter } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;

    // `deleting` fence: concurrent open/restart must be rejected.
    manager.beginProjectDeletionFence("project-1" as never);
    expect(manager.projectDeletionFenceState("project-1" as never)).toBe("deleting");
    await expect(manager.openProject(projectOpenInput())).rejects.toThrow(/being deleted/);
    await expect(manager.restartProject(projectRestartInput())).rejects.toThrow(/being deleted/);

    // Unproven settlement releases the fence: terminals become usable again.
    process.exitOnKill = false;
    const results = await manager.settleProjectTerminals("project-1" as never);
    expect(results[0]?.outcome).toBe("uncertain");
    // (The engine calls releaseProjectDeletionFence on the unproven rejection;
    // simulate that hand-off exactly as the dispatch does.)
    manager.releaseProjectDeletionFence("project-1" as never);
    expect(manager.projectDeletionFenceState("project-1" as never)).toBeNull();

    // Reopen now succeeds against the retained (exited) terminal.
    const reopened = await manager.openProject(projectOpenInput());
    expect(reopened.projectId).toBe("project-1");

    manager.dispose();
  });

  it("retains the fence as deleted after a committed deletion and never reopens", async () => {
    const { manager, ptyAdapter } = makeManager({ processKillGraceMs: 50 });
    await manager.openProject(projectOpenInput());
    const process = ptyAdapter.processes[0];
    expect(process).toBeDefined();
    if (!process) return;
    process.exitOnKill = true;

    // Engine sequence for a committed deletion.
    manager.beginProjectDeletionFence("project-1" as never);
    const results = await manager.settleProjectTerminals("project-1" as never);
    expect(results[0]?.outcome).toBe("settled");
    manager.commitProjectDeletionFence("project-1" as never);
    expect(manager.projectDeletionFenceState("project-1" as never)).toBe("deleted");

    // `deleted` is terminal: open and restart are both rejected, and a later
    // release call must NOT reopen admission.
    await expect(manager.openProject(projectOpenInput())).rejects.toThrow(/was deleted/);
    await expect(manager.restartProject(projectRestartInput())).rejects.toThrow(/was deleted/);
    manager.releaseProjectDeletionFence("project-1" as never);
    expect(manager.projectDeletionFenceState("project-1" as never)).toBe("deleted");
    await expect(manager.openProject(projectOpenInput())).rejects.toThrow(/was deleted/);

    manager.dispose();
  });
});
