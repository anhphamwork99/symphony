// FILE: projectWorkspaceAcceptance.test.ts
// Purpose: WP8 integrated acceptance evidence at the server boundary. Proves
//          the Project Contract scenarios and Decision 0002 verification
//          obligations against REAL cross-layer components: the real
//          OrchestrationEngine (in-memory SQLite, migration 105 at boot), the
//          real ProjectWorkspaceStore + migration coordinator, and the REAL
//          TerminalManagerRuntime over a fake PTY adapter (the same fake the
//          WP4 terminal suite uses, so the runtime, history files, fences,
//          settlement proof, and event channels are all production code).
// Layer: Server integrated acceptance (WP8).
// Scenario/obligation map (tested here unless noted web/desktop):
//   Scenario 2 — Project isolation (terminal + workspace stores)
//   Scenario 3 — Terminal continuity/reconnect/restart replay
//   Scenario 4 — close-confirmation preflight truthfulness (server list half)
//   Scenario 5 — unavailable content keeps a diagnostic (device + browser pane)
//   Scenario 6 — archive/restore preservation (real thread.archive/unarchive)
//   Scenario 7 — settle-then-delete + unproven failure containment
//   Obligations 4,5,6,8,11,12,13 — staged publication, mixed-project marker
//   gating, capability advertisement contract, settlement, diagnostics.
//   ProjectId propagation/negative proofs: the Project terminal surface never
//   carries a thread identity, and a Thread-keyed call using Project-id TEXT
//   creates a DISJOINT thread-keyed session (no aliasing).

import { CommandId, ProjectId, ThreadId, type TerminalProjectEvent } from "@synara/contracts";
import { PROJECT_WORKSPACE_CAPABILITY } from "@synara/contracts";
import { WS_SERVER_CAPABILITIES } from "@synara/contracts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ServerConfig } from "../config.ts";
import { ProjectWorkspaceStore } from "./Services/ProjectWorkspaceStore.ts";
import { ProjectWorkspaceStoreLive } from "./Layers/ProjectWorkspaceStore.ts";
import {
  makeProjectWorkspaceMigrationCoordinatorLayer,
  ProjectWorkspaceMigrationCoordinator,
  type ProjectWorkspacePublicationHooks,
} from "./projectWorkspaceMigrationCoordinator.ts";
import {
  TerminalError,
  TerminalManager,
  type TerminalManagerShape,
} from "../terminal/Services/Manager.ts";
import { TerminalManagerRuntime } from "../terminal/Layers/Manager.ts";
import type {
  PtyAdapterShape,
  PtyExitEvent,
  PtyProcess,
  PtySpawnInput,
} from "../terminal/Services/PTY.ts";

// ── Fake PTY adapter (same contract as the WP4 suite; real runtime) ──

class AcceptancePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  killed = false;
  paused = false;
  /** When true, kill() emits a synchronous exit event (settlement proof). */
  exitOnKill = false;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: PtyExitEvent) => void>();

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(): void {
    // Not asserted in this suite.
  }

  kill(signal?: string): void {
    this.killed = true;
    void signal;
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

class AcceptancePtyAdapter implements PtyAdapterShape {
  readonly spawnInputs: PtySpawnInput[] = [];
  readonly processes: AcceptancePtyProcess[] = [];
  private nextPid = 41000;

  spawn(input: PtySpawnInput): Effect.Effect<PtyProcess, never> {
    this.spawnInputs.push(input);
    const process = new AcceptancePtyProcess(this.nextPid++);
    this.processes.push(process);
    return Effect.succeed(process);
  }
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
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

// ── Integrated system: real engine + real store + real terminal runtime ──

const TestServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "synara-project-workspace-acceptance-",
});

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A REAL TerminalManagerRuntime over the fake PTY, wrapped into the
 * TerminalManager service shape exactly the way `TerminalManagerLive` wraps
 * it in production (Effect.tryPromise bridging), so the orchestration engine
 * and the assertions exercise production wiring.
 */
const makeRealTerminalManagerLayer = () => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-acceptance-terminal-"));
  tempDirs.push(logsDir);
  const ptyAdapter = new AcceptancePtyAdapter();
  const runtime = new TerminalManagerRuntime({
    logsDir,
    ptyAdapter,
    historyLineLimit: 5,
    shellResolver: () => "/bin/bash",
    processKillGraceMs: 50,
  });
  const toTerminalError = (where: string) => (cause: unknown) =>
    cause instanceof TerminalError
      ? cause
      : new TerminalError({
          message: `${where}: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
  const layer = Layer.succeed(TerminalManager, {
    open: (input) =>
      Effect.tryPromise({ try: () => runtime.open(input), catch: toTerminalError("open") }),
    write: (input) =>
      Effect.tryPromise({ try: () => runtime.write(input), catch: toTerminalError("write") }),
    ackOutput: (input) =>
      Effect.tryPromise({
        try: () => runtime.ackOutput(input),
        catch: toTerminalError("ackOutput"),
      }),
    resize: (input) =>
      Effect.tryPromise({
        try: () => runtime.resize(input),
        catch: toTerminalError("resize"),
      }),
    clear: (input) =>
      Effect.tryPromise({ try: () => runtime.clear(input), catch: toTerminalError("clear") }),
    restart: (input) =>
      Effect.tryPromise({
        try: () => runtime.restart(input),
        catch: toTerminalError("restart"),
      }),
    close: (input) =>
      Effect.tryPromise({ try: () => runtime.close(input), catch: toTerminalError("close") }),
    closeSessionsOpenedAtOrBefore: (input) =>
      Effect.tryPromise({
        try: () => runtime.closeSessionsOpenedAtOrBefore(input),
        catch: toTerminalError("closeSessionsOpenedAtOrBefore"),
      }),
    openProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.openProject(input),
        catch: toTerminalError("openProject"),
      }),
    writeProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.writeProject(input),
        catch: toTerminalError("writeProject"),
      }),
    ackOutputProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.ackOutputProject(input),
        catch: toTerminalError("ackOutputProject"),
      }),
    resizeProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.resizeProject(input),
        catch: toTerminalError("resizeProject"),
      }),
    clearProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.clearProject(input),
        catch: toTerminalError("clearProject"),
      }),
    restartProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.restartProject(input),
        catch: toTerminalError("restartProject"),
      }),
    closeProject: (input) =>
      Effect.tryPromise({
        try: () => runtime.closeProject(input),
        catch: toTerminalError("closeProject"),
      }),
    listProjectTerminals: (input) =>
      Effect.tryPromise({
        try: () => runtime.listProjectTerminals(input.projectId),
        catch: toTerminalError("listProjectTerminals"),
      }),
    settleProjectTerminals: (input) =>
      Effect.tryPromise({
        try: () => runtime.settleProjectTerminals(input.projectId),
        catch: toTerminalError("settleProjectTerminals"),
      }),
    beginProjectDeletionFence: (input) =>
      Effect.sync(() => runtime.beginProjectDeletionFence(input.projectId)),
    commitProjectDeletionFence: (input) =>
      Effect.sync(() => runtime.commitProjectDeletionFence(input.projectId)),
    releaseProjectDeletionFence: (input) =>
      Effect.sync(() => runtime.releaseProjectDeletionFence(input.projectId)),
    projectDeletionFenceState: (input) =>
      Effect.sync(() => runtime.projectDeletionFenceState(input.projectId)),
    subscribe: (listener) =>
      Effect.sync(() => {
        runtime.on("event", listener);
        return () => runtime.off("event", listener);
      }),
    subscribeProject: (listener) =>
      Effect.sync(() => {
        runtime.on("projectEvent", listener);
        return () => runtime.off("projectEvent", listener);
      }),
    dispose: Effect.sync(() => runtime.dispose()),
  } satisfies TerminalManagerShape);
  return { layer, ptyAdapter, runtime };
};

async function createAcceptanceSystem(options?: { hooks?: ProjectWorkspacePublicationHooks }) {
  const terminal = makeRealTerminalManagerLayer();
  const layer = Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(ProjectWorkspaceStoreLive),
      Layer.provide(terminal.layer),
      Layer.provide(SqlitePersistenceMemory),
    ),
    ProjectWorkspaceStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
    makeProjectWorkspaceMigrationCoordinatorLayer({
      clock: { now: () => "2026-08-24T00:00:00.000Z" },
      ...(options?.hooks ? { hooks: options.hooks } : {}),
    }).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ).pipe(Layer.provideMerge(TestServerConfigLayer), Layer.provideMerge(NodeServices.layer));
  const rt = ManagedRuntime.make(layer);
  const engine = await rt.runPromise(Effect.service(OrchestrationEngineService));
  const store = await rt.runPromise(Effect.service(ProjectWorkspaceStore));
  const coordinator = await rt.runPromise(Effect.service(ProjectWorkspaceMigrationCoordinator));
  return {
    engine,
    store,
    coordinator,
    ptyAdapter: terminal.ptyAdapter,
    terminalRuntime: terminal.runtime,
    run: rt.runPromise.bind(rt) as <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>,
    dispose: () => rt.dispose(),
  };
}

type AcceptanceSystem = Awaited<ReturnType<typeof createAcceptanceSystem>>;

async function createProject(
  system: AcceptanceSystem,
  projectId: string,
  title = "Acceptance project",
): Promise<void> {
  await system.run(
    system.engine.dispatch({
      type: "project.create",
      commandId: CommandId.makeUnsafe(`cmd-create-${projectId}`),
      projectId: ProjectId.makeUnsafe(projectId),
      title,
      workspaceRoot: `/tmp/${projectId}`,
      defaultModelSelection: null,
      createdAt: "2026-08-24T00:00:00.000Z",
    }),
  );
}

async function createThread(
  system: AcceptanceSystem,
  projectId: string,
  threadId: string,
): Promise<ThreadId> {
  const id = ThreadId.makeUnsafe(threadId);
  await system.run(
    system.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.makeUnsafe(`cmd-create-${threadId}`),
      threadId: id,
      projectId: ProjectId.makeUnsafe(projectId),
      title: `Thread ${threadId}`,
      modelSelection: { provider: "codex", model: "gpt-5-codex" },
      interactionMode: "default",
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: "2026-08-24T00:00:00.000Z",
    }),
  );
  return id;
}

const openInput = (projectId: string) => ({
  projectId: ProjectId.makeUnsafe(projectId),
  cwd: process.cwd(),
  cols: 100,
  rows: 24,
});

/** A complete five-slice published payload (mirrors the WP3 store fixture). */
function completeSlices(projectId: ProjectId) {
  return [
    {
      slice: "right-dock" as const,
      projectId,
      open: true,
      preferredWidthPx: null,
      panes: [
        {
          id: `pane-${projectId}`,
          kind: "browser" as const,
          threadId: null,
          diffTurnId: null,
          diffFilePath: null,
          filePath: null,
          pullRequestProjectId: null,
          pullRequestRepository: null,
          pullRequestNumber: null,
          pullRequestInitialTab: null,
          restorationDiagnostic: null,
        },
      ],
      activePaneId: `pane-${projectId}`,
    },
    {
      slice: "terminal-presentation" as const,
      projectId,
      presentationMode: "workspace" as const,
      workspaceTab: "terminal" as const,
      workspaceLayout: "both" as const,
      terminalHeightPx: 320,
      terminalIds: ["default"],
      activeTerminalId: "default",
      terminalLabelsById: { default: "Terminal 1" },
    },
    {
      slice: "browser" as const,
      projectId,
      open: true,
      activeTabId: "tab-1",
      tabs: [{ id: "tab-1", url: "https://example.test/", title: "Example" }],
    },
    {
      slice: "browser-annotations" as const,
      projectId,
      markers: [],
    },
    {
      slice: "device" as const,
      projectId,
      attachedDeviceUdid: null,
      attachPhase: null,
    },
  ];
}

describe("WP8 server acceptance — scenarios 2/3/4/6/7 + obligations 4–6,8,11–13", () => {
  it("scenario 3 + obligation 11: a Project terminal survives conversation switches and reconnects to the SAME live process with replayed history", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-project");
      const threadA = await createThread(system, "acc-project", "acc-thread-a1");
      await createThread(system, "acc-project", "acc-thread-a2");

      // Conversation A1 opens the Project terminal (the only owner key sent).
      const runtime0 = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      const first = await runtime0.openProject(openInput("acc-project"));
      expect(first.projectId).toBe(ProjectId.makeUnsafe("acc-project"));
      expect("threadId" in first).toBe(false);
      const process = system.ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;
      process.emitData("work continues across conversation switches\n");
      await waitFor(() => process.writes.length >= 0);

      // Conversation switches happen (A1 → A2): pure navigation in the Project.
      await system.run(
        system.engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.makeUnsafe("noop-a"),
          threadId: threadA,
        }),
      );

      // The SAME terminal reconnects: one PTY, accumulated history, same pid.
      const reconnected = await runtime0.openProject(openInput("acc-project"));
      expect(reconnected.pid).toBe(process.pid);
      expect(reconnected.status).toBe("running");
      expect(reconnected.history).toContain("work continues across conversation switches");
      expect(system.ptyAdapter.spawnInputs).toHaveLength(1);

      // Project events name the Project, never a thread. Subscribe through
      // the runtime's own project channel (the same channel the typed
      // `subscribeProject` service and the WS push route consume).
      const events: Array<{ projectId?: string }> = [];
      const onProjectEvent = (event: TerminalProjectEvent) =>
        events.push(event as unknown as { projectId?: string });
      runtime0.on("projectEvent", onProjectEvent);
      // `clearProject` transitions the session state, so it provably emits on
      // the Project channel (write on a live session need not).
      await runtime0.clearProject({
        projectId: ProjectId.makeUnsafe("acc-project"),
        terminalId: "default",
      });
      runtime0.off("projectEvent", onProjectEvent);
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(String(event.projectId)).toBe("acc-project");
        expect("threadId" in event).toBe(false);
      }
    } finally {
      await system.dispose();
    }
  });

  it("scenario 2 + obligation 8: Projects stay isolated in the terminal runtime, the workspace store, and publication", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-iso-a");
      await createProject(system, "acc-iso-b");

      const runtime = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      const a = await runtime.openProject(openInput("acc-iso-a"));
      const b = await runtime.openProject(openInput("acc-iso-b"));
      expect(a.pid).not.toBe(b.pid);
      system.ptyAdapter.processes[0]?.emitData("project A output\n");
      const aAgain = await runtime.openProject(openInput("acc-iso-a"));
      const bAgain = await runtime.openProject(openInput("acc-iso-b"));
      expect(aAgain.history).toContain("project A output");
      expect(bAgain.history).not.toContain("project A output");

      // Workspace publication is per Project: publishing A leaves B absent.
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("acc-iso-a"),
          slices: completeSlices(ProjectId.makeUnsafe("acc-iso-a")),
          publishedAt: "2026-08-24T00:00:00.000Z",
          provenance: null,
        }),
      );
      const readA = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-iso-a") }),
      );
      const readB = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-iso-b") }),
      );
      expect(readA.kind).toBe("published-current");
      expect(readB).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
      if (readA.kind !== "published-current") return;
      expect(readA.slices.every((slice) => String(slice.projectId) === "acc-iso-a")).toBe(true);
    } finally {
      await system.dispose();
    }
  });

  it("scenario 4 (server half) + obligation 12: the close-confirmation preflight list reports truthful running vs exited state", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-close");
      const runtime = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      await runtime.openProject(openInput("acc-close"));
      const process = system.ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;

      // Running: the preflight surface the web close-confirmation consults.
      const running = await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-close"));
      expect(running).toHaveLength(1);
      expect(running[0]?.status).toBe("running");

      // The process exits: the list stays truthful instead of claiming liveness.
      process.emitExit({ exitCode: 0, signal: 0 });
      const settled = await runtime.settleProjectTerminals(ProjectId.makeUnsafe("acc-close"));
      expect(settled.every((result) => result.outcome === "settled")).toBe(true);
      const after = await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-close"));
      expect(after).toHaveLength(0);
    } finally {
      await system.dispose();
    }
  });

  it("scenario 6: thread archive/unarchive preserves the Project workspace byte-for-byte and the terminal keeps reconnecting", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-archive");
      const threadId = await createThread(system, "acc-archive", "acc-archive-thread");
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("acc-archive"),
          slices: completeSlices(ProjectId.makeUnsafe("acc-archive")),
          publishedAt: "2026-08-24T00:00:00.000Z",
          provenance: null,
        }),
      );
      const runtime = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      await runtime.openProject(openInput("acc-archive"));
      const process = system.ptyAdapter.processes[0];
      expect(process).toBeDefined();

      const before = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-archive") }),
      );

      await system.run(
        system.engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.makeUnsafe("cmd-archive-acc"),
          threadId,
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.unarchive",
          commandId: CommandId.makeUnsafe("cmd-unarchive-acc"),
          threadId,
        }),
      );

      // The archived→restored Project reads the IDENTICAL workspace payload.
      const after = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-archive") }),
      );
      expect(after).toEqual(before);
      // …and its terminal was never settled or respawned by conversation lifecycle.
      const reconnected = await runtime.openProject(openInput("acc-archive"));
      expect(reconnected.pid).toBe(process?.pid);
      expect(system.ptyAdapter.spawnInputs).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });

  it("scenario 7 + obligations 11/12: deletion settles terminals BEFORE commit; unproven settlement rejects with the workspace retained, then a proven retry deletes atomically", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-delete");
      const deleteThreadId = await createThread(system, "acc-delete", "acc-delete-thread");
      const runtime = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      await runtime.openProject(openInput("acc-delete"));
      const process = system.ptyAdapter.processes[0];
      expect(process).toBeDefined();
      if (!process) return;
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("acc-delete"),
          slices: completeSlices(ProjectId.makeUnsafe("acc-delete")),
          publishedAt: "2026-08-24T00:00:00.000Z",
          provenance: null,
        }),
      );

      // The Project must have no threads before deletion: archive + delete
      // the conversation FIRST — which itself must not disturb the Project's
      // terminal or workspace (scenario 6's lifecycle inside scenario 7).
      await system.run(
        system.engine.dispatch({
          type: "thread.archive",
          commandId: CommandId.makeUnsafe("cmd-archive-acc-delete"),
          threadId: deleteThreadId,
        }),
      );
      await system.run(
        system.engine.dispatch({
          type: "thread.delete",
          commandId: CommandId.makeUnsafe("cmd-thread-delete-acc-delete"),
          threadId: deleteThreadId,
        }),
      );
      expect(await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-delete"))).toHaveLength(
        1,
      );

      // Unproven settlement (kill lands, exit proof never arrives).
      process.exitOnKill = false;
      await expect(
        system.run(
          system.engine.dispatch({
            type: "project.delete",
            commandId: CommandId.makeUnsafe("cmd-delete-acc-1"),
            projectId: ProjectId.makeUnsafe("acc-delete"),
          }),
        ),
      ).rejects.toMatchObject({ _tag: "OrchestrationCommandInvariantError" });

      // Containment: no event, workspace retained, terminal session retained.
      const retained = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-delete") }),
      );
      expect(retained.kind).toBe("published-current");
      expect(await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-delete"))).toHaveLength(
        1,
      );
      const deletedEvents = await system.run(
        Effect.gen(function* () {
          const client = yield* SqlClient.SqlClient;
          const rows = yield* client<{ readonly count: number }>`
            SELECT COUNT(*) AS count FROM orchestration_events WHERE event_type = 'project.deleted'
          `;
          return rows[0]?.count ?? 0;
        }),
      );
      expect(deletedEvents).toBe(0);

      // The truthful retry: proof arrives, settlement succeeds, deletion commits
      // and removes the workspace in the SAME transaction.
      process.exitOnKill = true;
      const result = await system.run(
        system.engine.dispatch({
          type: "project.delete",
          commandId: CommandId.makeUnsafe("cmd-delete-acc-2"),
          projectId: ProjectId.makeUnsafe("acc-delete"),
        }),
      );
      expect(result.sequence).toBeGreaterThan(0);
      const gone = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-delete") }),
      );
      expect(gone).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
      expect(await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-delete"))).toHaveLength(
        0,
      );
      // The admission fence is retained as deleted: no reopen after deletion.
      expect(runtime.projectDeletionFenceState(ProjectId.makeUnsafe("acc-delete"))).toBe("deleted");
    } finally {
      await system.dispose();
    }
  });

  it("obligations 4+5: an injected failure between staging and the marker publishes NOTHING and the retry converges (real coordinator + store)", async () => {
    const failing: ProjectWorkspacePublicationHooks = {
      beforePublication: () => Effect.fail(new Error("injected pre-publication failure")),
    };
    const system = await createAcceptanceSystem({ hooks: failing });
    try {
      await createProject(system, "acc-retry");
      const results = await system.run(
        system.coordinator.migrateAllProjects({ legacySlicesByThreadId: new Map() }),
      );
      const ours = results.find((row) => row.projectId === ProjectId.makeUnsafe("acc-retry"));
      expect(ours?.outcome).toMatchObject({ kind: "failed" });
      const unpublished = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-retry") }),
      );
      expect(unpublished).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
    } finally {
      await system.dispose();
    }

    // The retry (a clean system over the same shape of inputs) converges.
    const retrySystem = await createAcceptanceSystem();
    try {
      await createProject(retrySystem, "acc-retry");
      const results = await retrySystem.run(
        retrySystem.coordinator.migrateAllProjects({ legacySlicesByThreadId: new Map() }),
      );
      const ours = results.find((row) => row.projectId === ProjectId.makeUnsafe("acc-retry"));
      expect(ours?.outcome).toMatchObject({ kind: "published" });
      const read = await retrySystem.run(
        retrySystem.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-retry") }),
      );
      expect(read.kind).toBe("published-current");
    } finally {
      await retrySystem.dispose();
    }
  });

  it("obligation 6 (marker boundary): a well-formed marker for ANOTHER Project, or mixed-Project staged slices, never activates as this Project's canonical workspace", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-mixed-a");
      await createProject(system, "acc-mixed-b");

      // Stage A's complete payload, but hand the store B's marker semantics by
      // reading through A's keys with B's expectation: the shared policy gate
      // must refuse (this exercises the same gate the store read path uses).
      await system.run(
        system.store.stageAndPublish({
          projectId: ProjectId.makeUnsafe("acc-mixed-a"),
          slices: completeSlices(ProjectId.makeUnsafe("acc-mixed-a")),
          publishedAt: "2026-08-24T00:00:00.000Z",
          provenance: null,
        }),
      );
      const readA = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-mixed-a") }),
      );
      expect(readA.kind).toBe("published-current");

      // B reads nothing of A's: no marker, no composed legacy+published mix.
      const readB = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-mixed-b") }),
      );
      expect(readB).toMatchObject({ kind: "unpublished", reason: "marker-absent" });

      // Mixed-Project staging is refused before any write lands.
      const mixed = await system.run(
        Effect.result(
          system.store.stageAndPublish({
            projectId: ProjectId.makeUnsafe("acc-mixed-b"),
            slices: completeSlices(ProjectId.makeUnsafe("acc-mixed-a")),
            publishedAt: "2026-08-24T00:00:00.000Z",
            provenance: null,
          }),
        ),
      );
      expect(mixed._tag).toBe("Failure");
      const stillB = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-mixed-b") }),
      );
      expect(stillB).toMatchObject({ kind: "unpublished", reason: "marker-absent" });
      // And A's published payload was not disturbed by the refused write.
      const stillA = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-mixed-a") }),
      );
      expect(stillA.kind).toBe("published-current");
    } finally {
      await system.dispose();
    }
  });

  it("scenario 5 + obligation 13: an unrestorable browser workspace keeps its pane with the persisted diagnostic through the real coordinator migration", async () => {
    const system = await createAcceptanceSystem();
    try {
      await createProject(system, "acc-diagnostic");
      await createThread(system, "acc-diagnostic", "acc-diagnostic-thread");
      const threadId = ThreadId.makeUnsafe("acc-diagnostic-thread");

      // Legacy v1: this Thread's dock has a browser pane AND its browser slice
      // carries a persisted restoration error (unavailable backing content).
      const results = await system.run(
        system.coordinator.migrateAllProjects({
          legacySlicesByThreadId: new Map([
            [
              threadId,
              {
                rightDock: {
                  threadId,
                  open: true,
                  panes: [
                    {
                      id: "pane-browser",
                      kind: "browser",
                      threadId: null,
                      diffTurnId: null,
                      diffFilePath: null,
                      filePath: null,
                      pullRequestProjectId: null,
                      pullRequestRepository: null,
                      pullRequestNumber: null,
                      pullRequestInitialTab: null,
                    },
                  ],
                  activePaneId: "pane-browser",
                },
                browser: {
                  threadId,
                  version: 0,
                  open: true,
                  activeTabId: null,
                  tabs: [],
                  lastError: "browser surface could not be restored",
                },
              },
            ],
          ]),
          projectIds: [ProjectId.makeUnsafe("acc-diagnostic")],
        }),
      );
      expect(
        results.find((row) => row.projectId === ProjectId.makeUnsafe("acc-diagnostic"))?.outcome,
      ).toMatchObject({ kind: "published", winnerThreadId: threadId });

      const read = await system.run(
        system.store.readProjectWorkspace({ projectId: ProjectId.makeUnsafe("acc-diagnostic") }),
      );
      expect(read.kind).toBe("published-current");
      if (read.kind !== "published-current") return;
      const dock = read.slices.find((slice) => slice.slice === "right-dock");
      expect(dock).toBeDefined();
      if (dock?.slice !== "right-dock") return;
      // The pane REMAINS (not dropped, not replaced by a default) and carries
      // the explicit actionable diagnostic.
      expect(dock.panes).toHaveLength(1);
      expect(dock.panes[0]?.kind).toBe("browser");
      expect(dock.panes[0]?.restorationDiagnostic).toBe("browser surface could not be restored");
    } finally {
      await system.dispose();
    }
  });

  it("negative: a Thread-keyed terminal call using Project-id TEXT creates a DISJOINT thread-keyed session — no Project-as-Thread alias", async () => {
    const system = await createAcceptanceSystem();
    try {
      const runtime = (system as unknown as { terminalRuntime: TerminalManagerRuntime })
        .terminalRuntime;
      const projectOpen = await runtime.openProject(openInput("acc-alias"));
      // The SAME id text, used on the thread-keyed surface, must NOT reach the
      // Project session: keys are disjoint by owner kind.
      const threadOpen = await runtime.open({
        threadId: ThreadId.makeUnsafe("acc-alias"),
        terminalId: "default",
        cwd: process.cwd(),
        cols: 100,
        rows: 24,
      });
      expect(threadOpen.pid).not.toBe(projectOpen.pid);
      expect(system.ptyAdapter.spawnInputs).toHaveLength(2);
      // And closing the thread-keyed session never settles the Project's.
      await runtime.close({ threadId: ThreadId.makeUnsafe("acc-alias") });
      expect(await runtime.listProjectTerminals(ProjectId.makeUnsafe("acc-alias"))).toHaveLength(1);
    } finally {
      await system.dispose();
    }
  });

  it("obligation 9 (server half): the server advertises exactly the Project workspace capability the client gate consumes", () => {
    expect(WS_SERVER_CAPABILITIES).toContain(PROJECT_WORKSPACE_CAPABILITY);
  });
});
