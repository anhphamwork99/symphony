import { describe, expect, it } from "vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import type { ThreadId } from "@synara/contracts";

import { NodeFileSystem } from "@effect/platform-node";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ServerConfig, type ServerConfigShape } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import {
  McpSessionAuthority,
  type McpSessionAuthorityShape,
} from "../agentGateway/Services/McpSessionAuthority.ts";
import { makeMcpSessionAuthorityRegistry } from "../agentGateway/mcpSessionAuthority.ts";
import { makePiAdapterLive } from "./Layers/PiAdapter.ts";
import { PI_SUBAGENT_TEARDOWN_BAND } from "./piSubagentProcessTeardown.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";

/**
 * Ticket 16 — PiAdapter teardown-sweep wiring (Testing Seam: deterministic
 * process-supervisor integration boundary; the adapter-level production
 * wiring resolves the owning session's supervisor per parent thread).
 *
 * These tests mount the REAL adapter layer with a manually-driven teardown
 * clock (the `piSubagentTeardownClock` test seam) and an injectable owned
 * teardown resolver, then prove:
 * - a handed-off execution drives exactly one owned dispatch through the
 *   adapter wiring and settles proven (cancel + fence);
 * - a parent thread with NO live session resolves `undefined` at the
 *   adapter boundary — nothing is killed and the honest `owner_unproven`
 *   outcome is journaled (the production session-less wiring, T16-AC7).
 */

class TeardownClock {
  private nowMs = Date.parse("2026-08-19T12:00:00.000Z");
  private seq = 0;
  private readonly tasks = new Array<{
    id: number;
    at: number;
    callback: () => void;
    cancelled: boolean;
  }>();

  readonly now = (): number => this.nowMs;

  readonly schedule = (delayMs: number, callback: () => void): { readonly cancel: () => void } => {
    this.seq += 1;
    const task = {
      id: this.seq,
      at: this.nowMs + Math.max(0, delayMs),
      callback,
      cancelled: false,
    };
    this.tasks.push(task);
    return { cancel: () => (task.cancelled = true) };
  };

  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && t.at <= this.nowMs)
        .sort((a, b) => a.at - b.at || a.id - b.id);
      if (due.length === 0) break;
      for (const task of due) {
        task.cancelled = true;
        task.callback();
        await Promise.resolve();
        await Promise.resolve();
      }
    }
  }
}

const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (let i = 0; i < 12; i += 1) {
    await Promise.resolve();
  }
};

function makeWiringSetup() {
  const tempDir = `/tmp/synara-pi-t16-wiring-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const serverConfig: ServerConfigShape = {
    mode: "web",
    port: 3776,
    host: "127.0.0.1",
    cwd: tempDir,
    homeDir: tempDir,
    chatWorkspaceRoot: tempDir,
    studioWorkspaceRoot: tempDir,
    baseDir: tempDir,
    stateDir: tempDir,
    secretsDir: tempDir,
    dbPath: `${tempDir}/state.sqlite`,
    settingsPath: `${tempDir}/settings.json`,
    keybindingsConfigPath: `${tempDir}/keybindings.json`,
    worktreesDir: tempDir,
    attachmentsDir: tempDir,
    logsDir: tempDir,
    serverLogPath: `${tempDir}/server.log`,
    serverRuntimeStatePath: `${tempDir}/runtime.json`,
    providerLogsDir: tempDir,
    providerEventLogPath: `${tempDir}/provider.ndjson`,
    terminalLogsDir: tempDir,
    environmentIdPath: `${tempDir}/env-id`,
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

  const registry = makeMcpSessionAuthorityRegistry();
  const authorityService: McpSessionAuthorityShape = {
    ...registry,
    mintForLocalOwner: () => registry.mint({ subject: "local-owner:test", kind: "local-owner" }),
    mintForAuthenticated: (session) =>
      registry.mint({
        subject: session.subject,
        kind: "authenticated",
        authSessionId: session.sessionId,
        authExpiresAt:
          session.expiresAt === undefined || session.expiresAt === null
            ? null
            : DateTime.toEpochMillis(session.expiresAt),
      }),
    bindingFor: (authorityId, opts) => registry.bindingFor(authorityId, opts),
  };

  return { tempDir, serverConfig, authorityService };
}

/** Seeds one handed-off non-terminal execution into the durable store. */
const seedHandedOffExecution = (repository: PiSubagentExecutionRepositoryShape) =>
  Effect.gen(function* () {
    yield* repository.recordAdmission({
      executionId: "exec_t16_wire_1",
      attemptId: "att_t16_wire_1",
      generation: 1,
      commandId: "cmd_t16_wire_1",
      commandFingerprint: "fp_t16_wire_1",
      projectId: "proj_default",
      parentThreadId: "th_t16_wire" as ThreadId,
      parentTurnId: "turn_t16_wire",
      parentToolCallId: null,
      agentType: "general-purpose",
      prompt: "teardown wiring seed",
      mode: "background",
      cancellationScope: "parent_turn",
      state: "accepted",
      diagnosticCode: "pi_subagent_managed_enabled",
      now: "2026-08-19T09:00:00.000Z",
    });
    yield* repository.recordLifecycleEvent({
      eventId: "evt_t16_wire_cancelling",
      executionId: "exec_t16_wire_1",
      attemptId: "att_t16_wire_1",
      generation: 1,
      sequence: 2,
      state: "cancelling",
      occurredAt: "2026-08-19T11:58:00.000Z",
      diagnosticCode: "pi_subagent_cancel_escalated",
      diagnosticMessage: "wiring fixture: cancelling before teardown",
    });
    yield* repository.recordWatchdogStageEvent({
      executionId: "exec_t16_wire_1",
      attemptId: "att_t16_wire_1",
      generation: 1,
      sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      state: "cancelling",
      occurredAt: "2026-08-19T11:59:00.000Z",
      diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
      diagnosticMessage: "wiring fixture teardown handoff",
      metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
    });
  });

const seedProject = (tempDir: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT OR IGNORE INTO projection_projects (
        project_id, kind, title, workspace_root, default_model_selection_json,
        scripts_json, created_at, updated_at
      ) VALUES (
        'proj_default', 'project', 'Default', ${tempDir}, '{"provider":"pi","model":"pi"}',
        '[]', '2026-08-16T12:00:00.000Z', '2026-08-16T12:00:00.000Z'
      )
    `;
  });

describe("PiAdapter owned teardown sweep wiring (Issue 16)", () => {
  it("T16-AC1/AC2: the adapter-mounted sweep dispatches the owned teardown once for a handed-off execution and settles proven with the fence", async () => {
    const { tempDir, serverConfig, authorityService } = makeWiringSetup();
    const clock = new TeardownClock();
    const resolverCalls: Array<{ executionId: string; parentThreadId: string }> = [];

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        piSubagentTeardownClock: clock,
        piSubagentTeardownResolver: async (execution) => {
          resolverCalls.push({
            executionId: execution.executionId,
            parentThreadId: execution.parentThreadId,
          });
          return { kind: "proven" };
        },
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProject(tempDir);
      const repository = yield* PiSubagentExecutionRepository;
      yield* seedHandedOffExecution(repository);

      // Drive one sweep pass through the injected teardown clock while the
      // layer scope (and the mounted sweep timer) is still alive.
      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      expect(resolverCalls).toHaveLength(1);
      expect(resolverCalls[0]!.parentThreadId).toBe("th_t16_wire");

      // The proven outcome settled and fenced durably.
      const journal = yield* repository.listJournalEvents("exec_t16_wire_1");
      const outcomeRow = journal.find(
        (event) =>
          event.sequence === 76 && (event.diagnosticCode ?? "") === "pi_subagent_teardown_proven",
      );
      expect(outcomeRow).toBeDefined();
      const stored = yield* repository.getById("exec_t16_wire_1");
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("cancelled");
        expect(stored.value.generation).toBe(2);
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });

  it("T16-AC7 (adapter boundary): with no live session and no injected resolver the production wiring resolves undefined and journals owner_unproven without any kill", async () => {
    const { tempDir, serverConfig, authorityService } = makeWiringSetup();
    const clock = new TeardownClock();

    const testLayer = Layer.mergeAll(
      makePiAdapterLive({
        piSubagentTeardownClock: clock,
      }).pipe(
        Layer.provide(Layer.succeed(ServerConfig, serverConfig)),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(PiSubagentExecutionRepositoryLive),
        Layer.provide(OrchestrationProjectionSnapshotQueryLive),
        Layer.provide(Layer.succeed(McpSessionAuthority, authorityService)),
        Layer.provide(SqlitePersistenceMemory),
      ),
      PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
      SqlitePersistenceMemory,
    );

    const program = Effect.gen(function* () {
      yield* seedProject(tempDir);
      const repository = yield* PiSubagentExecutionRepository;
      yield* seedHandedOffExecution(repository);

      yield* Effect.promise(() => clock.advance(30_100));
      yield* Effect.promise(() => settle());

      // The wiring mounted the repository-backed sweep and processed the
      // handed-off execution: the honest owner_unproven outcome is durable
      // (band 78 row) and the projection stays cancelling — nothing settled
      // without proof, and no session-less kill was attempted.
      const journal = yield* repository.listJournalEvents("exec_t16_wire_1");
      const outcomeRow = journal.find(
        (event) =>
          (event.diagnosticCode ?? "") === "pi_subagent_teardown_owner_unproven" &&
          event.sequence === PI_SUBAGENT_TEARDOWN_BAND.ownerUnproven,
      );
      expect(outcomeRow).toBeDefined();
      const stored = yield* repository.getById("exec_t16_wire_1");
      expect(Option.isSome(stored)).toBe(true);
      if (Option.isSome(stored)) {
        expect(stored.value.observedState).toBe("cancelling");
      }
    });
    await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
  });
});
