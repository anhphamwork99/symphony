import type {
  PiSubagentCancelResult,
  PiSubagentCancellationScope,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
} from "@synara/contracts";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { sweepPiSubagentWallTimeExpiry } from "./piSubagentWallTimeSweep.ts";
import {
  PI_SUBAGENT_WATCHDOG_BAND,
  runPiSubagentWatchdogEscalation,
  type PiSubagentWatchdogEscalationInput,
} from "./piSubagentWatchdogEscalation.ts";
import type { PiSubagentActiveChild, PiSubagentExtensionBridge } from "./piSubagentBridge.ts";

/**
 * Ticket 15 — Watchdog escalation through provider-session stop.
 *
 * Testing Seams (approved 2026-08-16): server orchestration/process
 * integration boundary with controllable child, provider-turn, and
 * provider-session fixtures. These tests drive the coordinator over the REAL
 * repository (in-memory SQLite, established pattern) with injectable stage
 * controls (child cancel bridge, provider-turn interrupt, provider-session
 * stop, evidence probes) and an injectable clock — proving the journal-first
 * stage records, evidence-driven settlement, honest `cancelling` projection,
 * and uncertain-cleanup handoff diagnostics.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const TERMINAL_STATES = new Set(["cancelled", "succeeded", "failed", "rejected"]);

const T0 = "2026-08-18T12:00:00.000Z";
// Admission timestamp old enough that the 2h wall-time budget has elapsed
// at the injected clock (EPOCH_T0).
const ADMITTED_AT = "2026-08-18T09:00:00.000Z";
const nowAt = (epochMs: number) => () => epochMs;
const EPOCH_T0 = Date.parse(T0);

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_wd_1",
    attemptId: "att_wd_1",
    generation: 1,
    commandId: "cmd_wd_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_wd" as ThreadId,
    parentTurnId: "turn_wd" as TurnId,
    parentToolCallId: "call_wd",
    agentType: "general-purpose",
    prompt: "watchdog task",
    mode: "foreground",
    cancellationScope: "parent_turn" as PiSubagentCancellationScope,
    desiredState: "running" as PiSubagentLifecycleState,
    observedState: "running" as PiSubagentLifecycleState,
    createdAt: ADMITTED_AT,
    updatedAt: ADMITTED_AT,
    ...overrides,
  };
}

const admit = (repository: PiSubagentExecutionRepositoryShape, record: PiSubagentExecutionRecord) =>
  repository.recordAdmission({
    executionId: record.executionId,
    attemptId: record.attemptId,
    generation: record.generation,
    commandId: record.commandId,
    commandFingerprint: `fp_${record.commandId}`,
    projectId: record.projectId,
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    parentToolCallId: record.parentToolCallId,
    agentType: record.agentType,
    prompt: record.prompt,
    mode: record.mode,
    cancellationScope: record.cancellationScope,
    state: "accepted",
    diagnosticCode: "pi_subagent_managed_enabled",
    now: record.createdAt,
  });

interface StageControls {
  readonly bridge: PiSubagentExtensionBridge;
  readonly interrupts: Array<{ readonly threadId: string }>;
  readonly sessionStops: Array<{ readonly threadId: string }>;
  readonly listActive: () => ReadonlyArray<PiSubagentActiveChild> | undefined;
  readonly isSessionAlive: (threadId: string) => boolean;
}

const defaultCancel = (): PiSubagentCancelResult => ({
  // Never resolves to an acknowledgement by default: the dispatch races
  // the stage timeout and times out (the honest no-evidence case).
  status: "missing",
  executionId: "exec_wd_1",
  attemptId: "att_wd_1",
  generation: 1,
});

const ackedCancel = (): PiSubagentCancelResult => ({
  status: "cancelled",
  executionId: "exec_wd_1",
  attemptId: "att_wd_1",
  generation: 1,
});

/**
 * Controllable child/provider-turn/provider-session fixture (approved seam):
 * every stage action is recorded and its evidence is toggleable.
 */
function makeStageControls(
  initial: {
    activeChildren?: ReadonlyArray<PiSubagentActiveChild>;
    cancelResult?: () => PiSubagentCancelResult | Promise<PiSubagentCancelResult>;
  } = {},
): StageControls {
  const active: {
    children: ReadonlyArray<PiSubagentActiveChild>;
    aliveThreads: Set<string>;
  } = {
    children: initial.activeChildren ?? [],
    aliveThreads: new Set<string>(["th_wd"]),
  };
  const interrupts: Array<{ readonly threadId: string }> = [];
  const sessionStops: Array<{ readonly threadId: string }> = [];
  const bridge: PiSubagentExtensionBridge = {
    handshake: () => ({
      ok: true,
      protocolVersion: 1,
      extensionVersion: "test",
      capabilities: ["managed-spawn", "abort-propagation", "durable-cancellation"],
    }),
    cancel: (command) =>
      Promise.resolve((initial.cancelResult ?? defaultCancel)()).then((result) =>
        result.executionId === command.executionId
          ? result
          : { ...result, executionId: command.executionId },
      ),
    getActiveExecutions: () => active.children,
  };
  return {
    bridge,
    interrupts,
    sessionStops,
    listActive: () => active.children,
    isSessionAlive: (threadId) => active.aliveThreads.has(threadId),
  };
}

const baseInput = (
  repository: PiSubagentExecutionRepositoryShape,
  controls: StageControls,
  overrides?: Partial<PiSubagentWatchdogEscalationInput>,
): PiSubagentWatchdogEscalationInput => ({
  repository,
  resolveBridge: () => controls.bridge,
  isOwnerGenerationDead: () => false,
  listActive: () => controls.listActive(),
  interruptProviderTurn: (threadId) => {
    controls.interrupts.push({ threadId });
    return Promise.resolve();
  },
  stopProviderSession: (threadId) => {
    controls.sessionStops.push({ threadId });
    return Promise.resolve("stopped" as const);
  },
  stageTimeoutMs: 200,
  cancelRetryLimit: 0,
  leaseDurationMs: 30000,
  idleAfterMs: 60000,
  now: nowAt(EPOCH_T0),
  onDiagnostic: () => undefined,
  ...overrides,
});

describe("runPiSubagentWatchdogEscalation (Issue 15)", () => {
  it("T15-AC1: wall-time expiry consumes the band-60 trigger, records a watchdog diagnostic, and starts child abort with a configured stage timeout", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);

        // Ticket 13 sweep journals the durable band-60 trigger first.
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const diagnostics: Array<{ executionId: string; diagnosticCode: string }> = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                });
              },
            }),
          ),
        );

        expect(result.escalations).toHaveLength(1);
        const escalation = result.escalations[0]!;
        expect(escalation.executionId).toBe("exec_wd_1");
        // Stage 1 journaled a durable intent BEFORE dispatch.
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(journal.some((event) => event.sequence === 90 && event.state === "cancelling")).toBe(
          true,
        );
        // Watchdog stage records are journaled (band 70–74).
        const stageRows = journal.filter(
          (event) =>
            event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
            event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
        );
        expect(stageRows.length).toBeGreaterThanOrEqual(1);
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_watchdog_walltime_escalation",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC2: missing child acknowledgement advances to provider-turn interrupt without claiming stopped or cancelled", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        // Bridge never acknowledges: cancel returns "missing" (no evidence).
        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });

        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(baseInput(repository, controls)),
        );

        // Provider-turn interrupt (stage 2) was dispatched.
        expect(controls.interrupts.map((entry) => entry.threadId)).toContain("th_wd");
        // Projection is honest: desired cancelling, observed non-terminal —
        // never stopped/cancelled by timer expiry alone.
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(TERMINAL_STATES.has(stored.value.observedState)).toBe(false);
          expect(stored.value.desiredState).toBe("cancelling");
        }
        // Stage-2 record journaled (band 72, stage metadata carries the
        // provider-turn interrupt observation).
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const stageRows = journal.filter(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
        );
        const stage2 = stageRows.find((row) =>
          String((row.metadata as Record<string, unknown>)?.phase ?? "").includes(
            "watchdog_escalation",
          ),
        );
        expect(stage2).toBeDefined();
        expect(((stage2!.metadata ?? {}) as Record<string, unknown>).dispatched).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC3: missing provider-turn terminal evidence advances to provider-session stop with journaled commands and results", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });

        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(baseInput(repository, controls)),
        );

        // Stage 3 dispatched the provider-session stop.
        expect(controls.sessionStops.map((entry) => entry.threadId)).toContain("th_wd");
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const stageRows = journal.filter(
          (event) =>
            event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
            event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
        );
        // stage records: escalation start + child abort timeout + interrupt
        // + session stop with its result + teardown handoff.
        expect(stageRows.length).toBeGreaterThanOrEqual(4);
        const sessionStopRow = journal.find(
          (event) =>
            event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop &&
            ((event.metadata ?? {}) as Record<string, unknown>).result === "stopped",
        );
        expect(sessionStopRow).toBeDefined();
        // Projection remains non-terminal (AC5): the stop result is journaled
        // evidence of the command, not termination proof of the child.
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(TERMINAL_STATES.has(stored.value.observedState)).toBe(false);
          expect(stored.value.desiredState).toBe("cancelling");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC4: child acknowledgement during stage 1 stops escalation and settles through the normal lifecycle exactly once", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({ cancelResult: ackedCancel });

        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(baseInput(repository, controls)),
        );

        // Evidence settled the execution: no further escalation stages.
        expect(controls.interrupts).toHaveLength(0);
        expect(controls.sessionStops).toHaveLength(0);
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelled");
        }
        // Settled exactly once: exactly one child_ack journal row (seq 92).
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(journal.filter((event) => event.sequence === 92)).toHaveLength(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC4: terminal evidence observed between stages stops escalation without a second settlement", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        let interrupts = 0;
        const input = baseInput(repository, controls, {
          interruptProviderTurn: async (threadId) => {
            interrupts += 1;
            controls.interrupts.push({ threadId });
            // The interrupt surfaces the child's late terminal evidence:
            // the normal terminal path (ticket 07) settles the execution.
            await Effect.runPromise(
              repository.recordTerminalEvent({
                executionId: "exec_wd_1",
                attemptId: "att_wd_1",
                generation: 1,
                sequence: 40,
                state: "succeeded",
                occurredAt: T0,
                summary: "child finished during escalation",
                transcriptRef: null,
                outcomeState: null,
                diagnosticCode: null,
                diagnosticMessage: null,
              }),
            );
          },
        });

        yield* Effect.promise(() => runPiSubagentWatchdogEscalation(input));

        expect(interrupts).toBe(1);
        // No session stop: terminal evidence stopped the chain.
        expect(controls.sessionStops).toHaveLength(0);
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("succeeded");
        }
        // Terminal settled exactly once (first applicable terminal wins,
        // ticket 07): exactly one band-40 row.
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(journal.filter((event) => event.sequence === 40)).toHaveLength(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC5: timer-only progression never claims stopped or cancelled; projection stays cancelling through every stage", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        // NO evidence anywhere: bridge returns missing, listActive keeps
        // reporting the child running, the session stays alive, and the
        // session-stop command reports an uncertain result.
        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const diagnostics: Array<{ executionId: string; diagnosticCode: string }> = [];

        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                // Session stop cannot PROVE cleanup: resolve uncertain.
                return Promise.resolve("uncertain" as const);
              },
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                });
              },
            }),
          ),
        );

        expect(result.escalations).toHaveLength(1);
        const escalation = result.escalations[0]!;
        expect(escalation.outcome).toMatchObject({ kind: "cleanup_uncertain" });
        // Full chain dispatched: interrupt + session stop.
        expect(controls.interrupts).toHaveLength(1);
        expect(controls.sessionStops).toHaveLength(1);
        // Projection stays uncertain — never stopped/cancelled from timers:
        // desired is cancelling and observed never becomes terminal.
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(TERMINAL_STATES.has(stored.value.observedState)).toBe(false);
          expect(stored.value.desiredState).toBe("cancelling");
        }
        // T15-AC6: stable uncertain-cleanup diagnostic + teardown handoff.
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_watchdog_cleanup_uncertain",
          ),
        ).toBe(true);
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const handoffRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
        );
        expect(handoffRow).toBeDefined();
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC6: session-stop timeout produces a stable diagnostic and hands the owned execution to the process-teardown stage", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const diagnostics: Array<{ executionId: string; diagnosticCode: string }> = [];

        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              stageTimeoutMs: 50,
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                // Hung session stop: never resolves — the stage timeout
                // must bound it.
                return new Promise<"stopped">(() => undefined);
              },
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                });
              },
            }),
          ),
        );

        expect(result.escalations[0]!.outcome).toMatchObject({ kind: "cleanup_uncertain" });
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_watchdog_stage_timeout",
          ),
        ).toBe(true);
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const sessionStopRows = journal.filter(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
        );
        const timeoutRow = sessionStopRows.find(
          (row) => ((row.metadata ?? {}) as Record<string, unknown>).result === "timeout",
        );
        expect(timeoutRow).toBeDefined();
        // Handoff record proves the teardown stage (ticket 16) owns the
        // execution next.
        expect(
          journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff),
        ).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("idle policy: an execution whose re-derived lease has been expired beyond the orphan threshold enters escalation without a band-60 trigger", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution({ createdAt: "2026-08-18T10:00:00.000Z" });
        yield* admit(repository, execution);
        // Heartbeat recorded long ago: last_heartbeat_at + lease (30s) has
        // been expired far beyond the 60s idle threshold at the injected
        // clock (2026-08-18T12:00:00Z).
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_wd_1",
          occurredAt: "2026-08-18T10:00:01.000Z",
          leaseExpiresAt: "2026-08-18T10:00:31.000Z",
        });

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const diagnostics: Array<{ diagnosticCode: string }> = [];

        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              onDiagnostic: (event) => {
                diagnostics.push({ diagnosticCode: event.diagnosticCode });
              },
            }),
          ),
        );

        expect(result.escalations).toHaveLength(1);
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_watchdog_idle_escalation",
          ),
        ).toBe(true);
        // No band-60 journal row was required for entry.
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(journal.some((event) => event.sequence === 60)).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("a fresh execution with a live heartbeat never enters escalation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution({ createdAt: "2026-08-18T11:59:00.000Z" }));
        yield* repository.recordHeartbeatObservation({
          executionId: "exec_wd_1",
          occurredAt: "2026-08-18T11:59:30.000Z",
          leaseExpiresAt: "2026-08-18T12:00:00.000Z",
        });

        const controls = makeStageControls();
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(baseInput(repository, controls)),
        );

        expect(result.escalations).toHaveLength(0);
        expect(controls.interrupts).toHaveLength(0);
        expect(controls.sessionStops).toHaveLength(0);
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(
          journal.some(
            (event) =>
              event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
              event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ),
        ).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC3/AC4 (F1): terminal evidence arriving during the stage-2 evidence window stops escalation before any session stop", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });

        // The interrupt resolves immediately; durable terminal evidence
        // commits on the SECOND evidence poll — before the stage deadline.
        let polls = 0;
        const diagnostics: Array<{
          executionId: string;
          stage: string;
          diagnosticCode: string;
        }> = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  stage: event.stage,
                  diagnosticCode: event.diagnosticCode,
                });
              },
              interruptProviderTurn: async (threadId) => {
                controls.interrupts.push({ threadId });
              },
              wait: async () => {
                polls += 1;
                if (polls === 2) {
                  await Effect.runPromise(
                    repository.recordTerminalEvent({
                      executionId: "exec_wd_1",
                      attemptId: "att_wd_1",
                      generation: 1,
                      sequence: 40,
                      state: "succeeded",
                      occurredAt: T0,
                      summary: "late but before the deadline",
                      transcriptRef: null,
                      outcomeState: null,
                      diagnosticCode: null,
                      diagnosticMessage: null,
                    }),
                  );
                }
              },
              evidencePollMs: 10,
            }),
          ),
        );

        expect(result.escalations[0]!.outcome).toMatchObject({
          kind: "settled_by_evidence",
          evidence: "terminal_after_interrupt",
        });
        // The session stop was NEVER dispatched.
        expect(controls.sessionStops).toHaveLength(0);
        // Truthful diagnostic (F2): the interrupt row records the
        // evidence-bearing code, not the timeout code.
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const interruptRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
        );
        expect(interruptRow?.diagnosticCode).toBe("pi_subagent_watchdog_terminal_evidence");
        expect(((interruptRow?.metadata ?? {}) as Record<string, unknown>).observed).toBe(
          "terminal_evidence",
        );
        // Decision 0024 condition 1: the exact operator event for this
        // outcome — terminal_evidence at the provider-turn-interrupt stage,
        // and no stage-2 timeout event (which belongs to the no-evidence
        // branch only).
        expect(
          diagnostics.some(
            (event) =>
              event.diagnosticCode === "pi_subagent_watchdog_terminal_evidence" &&
              event.stage === "provider_turn_interrupt",
          ),
        ).toBe(true);
        expect(
          diagnostics.some(
            (event) =>
              event.diagnosticCode === "pi_subagent_watchdog_stage_timeout" &&
              event.stage === "provider_turn_interrupt",
          ),
        ).toBe(false);
        // No teardown handoff: the escalation settled on evidence.
        expect(
          journal.some((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff),
        ).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC3 (F1): absent evidence through the full stage-2 window advances to provider-session stop exactly once", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        let polls = 0;
        const diagnostics: Array<{
          executionId: string;
          stage: string;
          diagnosticCode: string;
        }> = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  stage: event.stage,
                  diagnosticCode: event.diagnosticCode,
                });
              },
              wait: async () => {
                polls += 1;
              },
              evidencePollMs: 10,
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("stopped" as const);
              },
            }),
          ),
        );

        // The evidence window fully elapsed without proof (several polls).
        expect(polls).toBeGreaterThanOrEqual(4);
        expect(result.escalations[0]!.outcome).toMatchObject({ kind: "cleanup_uncertain" });
        // Exactly one session stop.
        expect(controls.sessionStops).toHaveLength(1);
        // F2: timeout path keeps the truthful timeout code.
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const interruptRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
        );
        expect(interruptRow?.diagnosticCode).toBe("pi_subagent_watchdog_stage_timeout");
        // Decision 0023 condition 3: the stage-2 timeout operator event is
        // asserted by stage identity — the SAME code is emitted earlier at
        // band 71 (child abort), so a code-only check would be ambiguous.
        expect(
          diagnostics.some(
            (event) =>
              event.diagnosticCode === "pi_subagent_watchdog_stage_timeout" &&
              event.stage === "provider_turn_interrupt",
          ),
        ).toBe(true);
        expect(
          diagnostics.some(
            (event) =>
              event.diagnosticCode === "pi_subagent_watchdog_stage_timeout" &&
              event.stage === "child_abort_timeout",
          ),
        ).toBe(true);
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_watchdog_terminal_evidence",
          ),
        ).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T15-AC6 (F3): a same-generation terminal arriving after the teardown handoff still settles through the normal lifecycle (no premature fence)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("uncertain" as const);
              },
            }),
          ),
        );
        expect(result.escalations[0]!.outcome).toMatchObject({ kind: "cleanup_uncertain" });
        const journalAfter = yield* repository.listJournalEvents("exec_wd_1");
        expect(
          journalAfter.some(
            (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ),
        ).toBe(true);

        // Boundary behavior (Decision 0021 F3): the handoff row does NOT
        // fence the current attempt/generation. A same-generation terminal
        // before PROVEN teardown (Ticket 16's proof-before-fence) remains
        // ordinary first-applicable terminal evidence.
        const terminal = yield* repository.recordTerminalEvent({
          executionId: "exec_wd_1",
          attemptId: "att_wd_1",
          generation: 1,
          sequence: 40,
          state: "succeeded",
          occurredAt: T0,
          summary: "late same-generation terminal before proven teardown",
          transcriptRef: null,
          outcomeState: null,
          diagnosticCode: null,
          diagnosticMessage: null,
        });
        expect(terminal.kind).toBe("recorded");
        const stored = yield* repository.getById("exec_wd_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("idle policy does not fire on the first sweep for a freshly admitted execution with no heartbeat (age guard)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        // Admitted one minute before the injected clock; no heartbeat yet.
        yield* admit(repository, makeExecution({ createdAt: "2026-08-18T11:59:00.000Z" }));

        const controls = makeStageControls();
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(baseInput(repository, controls)),
        );

        expect(result.escalations).toHaveLength(0);
        expect(controls.interrupts).toHaveLength(0);
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(
          journal.some(
            (event) =>
              event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
              event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ),
        ).toBe(false);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("journal stage-record persistence failures surface a stable diagnostic and never wedge the escalation chain", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        // Fail every watchdog stage-record journal write (Decision 0001
        // material failure coverage): the durable cancel intent (seq 90)
        // must remain the authoritative control write.
        const failingRepository: PiSubagentExecutionRepositoryShape = {
          ...repository,
          recordWatchdogStageEvent: () =>
            Effect.fail(new Error("injected watchdog journal outage") as never),
        };

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });
        const diagnostics: Array<{ executionId: string; diagnosticCode: string }> = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(failingRepository, controls, {
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("stopped" as const);
              },
              onDiagnostic: (event) => {
                diagnostics.push({
                  executionId: event.executionId,
                  diagnosticCode: event.diagnosticCode,
                });
              },
            }),
          ),
        );

        // The chain still dispatched and settled honestly.
        expect(result.escalations).toHaveLength(1);
        expect(controls.sessionStops).toHaveLength(1);
        // The persistence failure surfaced through the stable diagnostic.
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_lifecycle_persistence_failed",
          ),
        ).toBe(true);
        // The durable cancel intent still journaled (authoritative write).
        const journal = yield* repository.listJournalEvents("exec_wd_1");
        expect(journal.some((event) => event.sequence === 90)).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("stage records carry per-stage diagnostic codes (trigger entry, timeout, stopped, cleanup-uncertain)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });

        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("stopped" as const);
              },
            }),
          ),
        );

        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const row = (sequence: number) => journal.find((event) => event.sequence === sequence);
        expect(row(PI_SUBAGENT_WATCHDOG_BAND.escalationStarted)?.diagnosticCode).toBe(
          "pi_subagent_watchdog_walltime_escalation",
        );
        expect(row(PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout)?.diagnosticCode).toBe(
          "pi_subagent_watchdog_stage_timeout",
        );
        expect(row(PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop)?.diagnosticCode).toBe(
          "pi_subagent_watchdog_session_stopped",
        );
        expect(row(PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff)?.diagnosticCode).toBe(
          "pi_subagent_watchdog_cleanup_uncertain",
        );
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("re-running the watchdog after an uncertain escalation does not duplicate stage records (idempotent journal identity)", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(repository, makeExecution());
        yield* Effect.promise(() =>
          sweepPiSubagentWallTimeExpiry({
            repository,
            wallTimeMs: 7200000,
            nowMs: () => EPOCH_T0,
          }),
        );

        const controls = makeStageControls({
          activeChildren: [
            {
              executionId: "exec_wd_1",
              attemptId: "att_wd_1",
              generation: 1,
              mode: "foreground",
              cancellationScope: "parent_turn",
              isRunning: true,
            },
          ],
        });

        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("uncertain" as const);
              },
            }),
          ),
        );
        yield* Effect.promise(() =>
          runPiSubagentWatchdogEscalation(
            baseInput(repository, controls, {
              now: nowAt(EPOCH_T0 + 30_000),
              stopProviderSession: (threadId) => {
                controls.sessionStops.push({ threadId });
                return Promise.resolve("uncertain" as const);
              },
            }),
          ),
        );

        const journal = yield* repository.listJournalEvents("exec_wd_1");
        const stageRows = journal.filter(
          (event) =>
            event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
            event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
        );
        // Second pass recorded nothing new: the deterministic stage event
        // identities dedupe (already_applied), so a wedged execution never
        // accumulates duplicate escalation history.
        expect(journal.filter((event) => event.sequence === 90)).toHaveLength(1);
        // The second pass SKIPS the execution entirely: the teardown-handoff
        // record proves Ticket 16 owns it now (no re-dispatch of settled
        // stage commands).
        expect(controls.sessionStops).toHaveLength(1);
        expect(stageRows.length).toBeGreaterThanOrEqual(4);
        const ids = new Set(
          journal
            .filter(
              (event) =>
                event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
                event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
            )
            .map((event) => event.eventId),
        );
        expect(ids.size).toBe(
          journal.filter(
            (event) =>
              event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
              event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ).length,
        );
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
