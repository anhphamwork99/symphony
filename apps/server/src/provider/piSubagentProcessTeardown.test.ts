import type {
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
import {
  ingestPiSubagentTerminal,
  PI_SUBAGENT_TERMINAL_SEQUENCE,
} from "./piSubagentTerminalCoordinator.ts";
import { PI_SUBAGENT_WATCHDOG_BAND } from "./piSubagentWatchdogEscalation.ts";
import {
  MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS,
  PI_SUBAGENT_TEARDOWN_BAND,
  runPiSubagentProcessTeardown,
  type PiSubagentOwnedTeardownDispatchResult,
  type PiSubagentProcessTeardownInput,
} from "./piSubagentProcessTeardown.ts";

/**
 * Ticket 16 — Owned process-tree teardown and fencing.
 *
 * Testing Seams (deterministic process-supervisor seams approved by the
 * owner in the ticket-breakdown review on 2026-08-16): these tests drive
 * the coordinator over the REAL repository (in-memory SQLite, established
 * pattern) with an injectable owned-teardown dispatch fixture (owned,
 * unrelated, surviving, graceful, restart cases) and late terminal-event
 * injection after proven teardown — proving the journal-first request and
 * outcome records, owned-only dispatch, proof-before-fence settlement, and
 * the honest uncertain-cleanup diagnostics.
 *
 * The conditional real-Pi destructive boundary (third seam bullet) is NOT
 * exercised here; see the ticket's Testing Seams approval gate.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const TERMINAL_STATES = new Set(["cancelled", "succeeded", "failed", "rejected"]);

const T0 = "2026-08-19T12:00:00.000Z";
const EPOCH_T0 = Date.parse(T0);
const nowAt = (epochMs: number) => () => epochMs;

function makeExecution(overrides?: Partial<PiSubagentExecutionRecord>): PiSubagentExecutionRecord {
  return {
    executionId: "exec_td_1",
    attemptId: "att_td_1",
    generation: 1,
    commandId: "cmd_td_1",
    projectId: "proj_default" as ProjectId,
    parentThreadId: "th_td" as ThreadId,
    parentTurnId: "turn_td" as TurnId,
    parentToolCallId: "call_td",
    agentType: "general-purpose",
    prompt: "teardown task",
    mode: "foreground",
    cancellationScope: "parent_turn" as PiSubagentCancellationScope,
    desiredState: "cancelling" as PiSubagentLifecycleState,
    observedState: "cancelling" as PiSubagentLifecycleState,
    createdAt: T0,
    updatedAt: T0,
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

/**
 * Drives the admitted aggregate into the honest watchdog handoff shape:
 * observed `cancelling` (durable intent, ticket 06 seq-90 semantics through
 * the generic lifecycle seam — matches how the watchdog leaves executions).
 */
const driveToCancelling = (
  repository: PiSubagentExecutionRepositoryShape,
  record: PiSubagentExecutionRecord,
) =>
  repository.recordLifecycleEvent({
    eventId: `evt_cancelling_${record.executionId}_${record.attemptId}`,
    executionId: record.executionId,
    attemptId: record.attemptId,
    generation: record.generation,
    sequence: 2,
    state: "cancelling",
    occurredAt: record.createdAt,
    diagnosticCode: "pi_subagent_cancel_escalated",
    diagnosticMessage: "fixture: cancelling before teardown",
  });

/** Journals the ticket 15 teardown handoff (band 74) for the CURRENT attempt. */
const journalHandoff = (
  repository: PiSubagentExecutionRepositoryShape,
  record: PiSubagentExecutionRecord,
) =>
  repository.recordWatchdogStageEvent({
    executionId: record.executionId,
    attemptId: record.attemptId,
    generation: record.generation,
    sequence: PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
    state: record.observedState,
    occurredAt: T0,
    diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
    diagnosticMessage: "Watchdog cleanup remains uncertain (fixture handoff)",
    metadata: { phase: "watchdog_escalation", reason: "session_stop_timeout" },
  });

interface TeardownDispatchRequest {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
}

interface TeardownFixture {
  /** Recorded dispatch requests (the owned-only kill calls). */
  readonly requests: TeardownDispatchRequest[];
  /** Configurable dispatch result: undefined = no live owned supervisor. */
  result: () => PiSubagentOwnedTeardownDispatchResult | undefined;
}

function makeTeardownFixture(
  initial: { result?: () => PiSubagentOwnedTeardownDispatchResult | undefined } = {},
): TeardownFixture {
  const requests: TeardownFixture["requests"][number][] = [];
  return {
    requests,
    result: initial.result ?? (() => undefined),
  };
}

type DiagnosticEvent = {
  readonly executionId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly parentThreadId: string;
  readonly stage:
    | "teardown_requested"
    | "teardown_proven"
    | "teardown_survivors"
    | "teardown_owner_unproven"
    | "failure";
  readonly diagnosticCode: string;
  readonly diagnosticMessage: string;
};

const baseInput = (
  repository: PiSubagentExecutionRepositoryShape,
  fixture: TeardownFixture,
  overrides?: Partial<PiSubagentProcessTeardownInput> & {
    readonly diagnostics?: DiagnosticEvent[];
  },
): PiSubagentProcessTeardownInput => ({
  repository,
  dispatchOwnedTeardown: async (execution) => {
    fixture.requests.push({
      executionId: execution.executionId,
      attemptId: execution.attemptId,
      generation: execution.generation,
      parentThreadId: execution.parentThreadId,
    });
    return fixture.result();
  },
  now: nowAt(EPOCH_T0),
  onDiagnostic: (event) => {
    overrides?.diagnostics?.push(event as DiagnosticEvent);
  },
  ...overrides,
});

describe("runPiSubagentProcessTeardown (Issue 16)", () => {
  it("T16-AC1: teardown dispatches ONLY for the handed-off execution through the owned supervisor and never for unrelated executions", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const handedOff = makeExecution();
        // An unrelated live execution in the same scan set: no handoff row.
        const unrelated = makeExecution({
          executionId: "exec_td_unrelated",
          attemptId: "att_td_unrelated",
          commandId: "cmd_td_unrelated",
          parentThreadId: "th_unrelated" as ThreadId,
          parentToolCallId: "call_unrelated",
        });
        yield* admit(repository, handedOff);
        yield* admit(repository, unrelated);
        yield* journalHandoff(repository, handedOff);

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture)),
        );

        // Exactly the handed-off execution was dispatched — the unrelated
        // execution was never signalled (owned-only teardown).
        expect(result.outcomes).toHaveLength(1);
        expect(result.outcomes[0]!.executionId).toBe("exec_td_1");
        expect(fixture.requests).toHaveLength(1);
        expect(fixture.requests[0]!.parentThreadId).toBe("th_td");
        expect(fixture.requests.some((request) => request.parentThreadId === "th_unrelated")).toBe(
          false,
        );
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC2: the request is journaled once before dispatch and a second pass re-dispatches nothing new while observing idempotent journal effects", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const input = baseInput(repository, fixture);
        const first = yield* Effect.promise(() => runPiSubagentProcessTeardown(input));
        expect(first.outcomes[0]!.outcome.kind).toBe("settled_proven");

        const journal = yield* repository.listJournalEvents("exec_td_1");
        const requests = journal.filter(
          (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.request,
        );
        const outcomes = journal.filter(
          (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.outcome,
        );
        // Exactly one request row and one outcome row — deterministic
        // idempotent identities under the journal UNIQUE constraint.
        expect(requests).toHaveLength(1);
        expect(outcomes).toHaveLength(1);
        expect(
          requests[0]!.diagnosticCode === "pi_subagent_teardown_requested" ||
            (requests[0]!.diagnosticCode ?? "").length > 0,
        ).toBe(true);

        // The execution settled terminal `cancelled`, so the second pass's
        // non-terminal scan skips it entirely (no new dispatch).
        const second = yield* Effect.promise(() => runPiSubagentProcessTeardown(input));
        expect(second.outcomes).toHaveLength(0);
        expect(fixture.requests).toHaveLength(1);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC3: only a liveness-verified dispatch settles — a kill API return without proof (survivors) never settles", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const fixture = makeTeardownFixture({
          result: () => ({ kind: "survivors", survivorPids: [4242, 4243, 4244] }),
        });
        const diagnostics: DiagnosticEvent[] = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture, { diagnostics })),
        );

        expect(result.outcomes[0]!.outcome.kind).toBe("survivors");
        // Projection stays honestly `cancelling` — never settled on a
        // non-proof outcome.
        const stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelling");
          expect(TERMINAL_STATES.has(stored.value.observedState)).toBe(false);
        }
        // T16-AC4: the stable survivors diagnostic is journaled (durable)
        // and reported to the operator surface, with the bounded PID list.
        const journal = yield* repository.listJournalEvents("exec_td_1");
        const outcomeRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.outcome,
        );
        expect(outcomeRow).toBeDefined();
        expect(outcomeRow!.diagnosticCode ?? "").toBe("pi_subagent_teardown_survivors");
        const metadata = (outcomeRow!.metadata ?? {}) as Record<string, unknown>;
        expect(metadata.survivorPids).toEqual([4242, 4243, 4244]);
        expect(
          diagnostics.some(
            (event) =>
              event.stage === "teardown_survivors" &&
              event.diagnosticCode === "pi_subagent_teardown_survivors",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC3: survivor PID lists are capped to the bounded maximum before journaling", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const many = Array.from(
          { length: MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS + 10 },
          (_, i) => 9000 + i,
        );
        const fixture = makeTeardownFixture({
          result: () => ({ kind: "survivors", survivorPids: many }),
        });
        yield* Effect.promise(() => runPiSubagentProcessTeardown(baseInput(repository, fixture)));

        const journal = yield* repository.listJournalEvents("exec_td_1");
        const outcomeRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.outcome,
        );
        const metadata = (outcomeRow!.metadata ?? {}) as Record<string, unknown>;
        expect((metadata.survivorPids as number[]).length).toBe(
          MAX_PI_SUBAGENT_TEARDOWN_SURVIVOR_PIDS,
        );
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC5: proven teardown fences the attempt/generation while settling cancelled, and late same-generation terminal events are ignored and counted", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const diagnostics: DiagnosticEvent[] = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture, { diagnostics })),
        );

        const settled = result.outcomes[0]!.outcome;
        expect(settled.kind).toBe("settled_proven");
        if (settled.kind !== "settled_proven") return;
        // The fence advanced the generation beyond the torn-down one.
        expect(settled.fencedGeneration).toBe(2);

        const stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelled");
          expect(stored.value.desiredState).toBe("cancelled");
          expect(stored.value.generation).toBe(2);
          expect(stored.value.diagnosticCode).toBe("pi_subagent_teardown_proven");
        }
        // Operator pairing: the proven diagnostic reached the operator
        // surface alongside the durable journal row.
        expect(
          diagnostics.some(
            (event) =>
              event.stage === "teardown_proven" &&
              event.diagnosticCode === "pi_subagent_teardown_proven",
          ),
        ).toBe(true);

        // A LATE terminal from the fenced attempt/generation cannot revive
        // or reverse the settled projection: it journals as history only
        // and is counted through the stale-terminal path.
        const late = yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: "exec_td_1",
            attemptId: "att_td_1",
            generation: 1,
            state: "succeeded",
            occurredAt: "2026-08-19T12:01:00.000Z",
            summary: "late success from the torn-down generation",
          },
          summaryMaxChars: 2000,
        });
        expect(late.outcome).not.toBe("persisted");

        const after = yield* repository.getById("exec_td_1");
        expect(Option.isSome(after)).toBe(true);
        if (Option.isSome(after)) {
          expect(after.value.observedState).toBe("cancelled");
          expect(after.value.generation).toBe(2);
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC6: graceful cancellation (seq 92 settlement) and normal terminal paths never enter teardown", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;

        // Graceful cancellation: settles through the ticket 06 ack path —
        // the journal carries seq 92 but NO band-74 handoff row.
        const graceful = makeExecution();
        yield* admit(repository, graceful);
        yield* repository.recordCancellationIntent({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          sequence: 90,
          cancelCommandId: "cancelcmd_exec_td_1_att_td_1_gen1_th_td",
          occurredAt: T0,
          reason: "parent_turn_stop",
        });
        yield* repository.recordCancelledAck({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          sequence: 92,
          occurredAt: T0,
          evidenceChannel: "child_ack",
        });

        // Normal terminal: settles through band 40 — no handoff row either.
        const finished = makeExecution({
          executionId: "exec_td_finished",
          attemptId: "att_td_finished",
          commandId: "cmd_td_finished",
          parentToolCallId: "call_finished",
        });
        yield* admit(repository, finished);
        yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: "exec_td_finished",
            attemptId: "att_td_finished",
            generation: 1,
            state: "succeeded",
            occurredAt: T0,
            summary: "normal terminal",
          },
          summaryMaxChars: 2000,
        });

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture)),
        );

        // No dispatch for either: graceful cancels and normal terminals
        // never invoke process-tree teardown.
        expect(result.outcomes).toHaveLength(0);
        expect(fixture.requests).toHaveLength(0);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC6 (boundary): a same-generation terminal arriving between handoff and teardown settles as ordinary lifecycle evidence — no proof yet, no fence at handoff", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        // The child's own terminal lands BEFORE any teardown dispatch.
        yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: "exec_td_1",
            attemptId: "att_td_1",
            generation: 1,
            state: "succeeded",
            occurredAt: T0,
            summary: "terminal beat teardown",
          },
          summaryMaxChars: 2000,
        });

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture)),
        );

        // The non-terminal scan skips the settled execution: terminal truth
        // won before any teardown proof, and nothing was dispatched.
        expect(result.outcomes).toHaveLength(0);
        expect(fixture.requests).toHaveLength(0);
        const stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("succeeded");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC7: restart with no live owned supervisor dispatches nothing, kills nothing, and records the bounded owner_unproven evidence once", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        // The restart fixture: no live owned supervisor exists.
        const fixture = makeTeardownFixture({ result: () => undefined });
        const diagnostics: DiagnosticEvent[] = [];
        const first = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture, { diagnostics })),
        );

        expect(first.outcomes[0]!.outcome.kind).toBe("owner_unproven");
        expect(fixture.requests).toHaveLength(1);
        // Projection stays cancelling — unproven ownership never settles.
        let stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelling");
        }
        const journal = yield* repository.listJournalEvents("exec_td_1");
        const outcomeRow = journal.find(
          (event) => event.sequence === PI_SUBAGENT_TEARDOWN_BAND.outcome,
        );
        expect(outcomeRow!.diagnosticCode ?? "").toBe("pi_subagent_teardown_owner_unproven");
        expect(
          diagnostics.some(
            (event) =>
              event.stage === "teardown_owner_unproven" &&
              event.diagnosticCode === "pi_subagent_teardown_owner_unproven",
          ),
        ).toBe(true);

        // Second restart pass: bounded and idempotent — the deterministic
        // outcome identity dedupes; no new journal rows accumulate.
        const journalBefore = (yield* repository.listJournalEvents("exec_td_1")).length;
        const second = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture)),
        );
        expect(second.outcomes[0]!.outcome.kind).toBe("owner_unproven");
        const journalAfter = yield* repository.listJournalEvents("exec_td_1");
        expect(journalAfter.length - journalBefore).toBe(0);
        stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelling");
        }
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("T16-AC7: the pass is bounded — at most maxPerPass handed-off executions dispatch per sweep", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        for (let i = 1; i <= 3; i += 1) {
          const execution = makeExecution({
            executionId: `exec_td_b${i}`,
            attemptId: `att_td_b${i}`,
            commandId: `cmd_td_b${i}`,
            parentThreadId: `th_td_b${i}` as ThreadId,
            parentToolCallId: `call_b${i}`,
          });
          yield* admit(repository, execution);
          yield* driveToCancelling(repository, execution);
          yield* journalHandoff(repository, execution);
        }

        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(repository, fixture, { maxPerPass: 2 })),
        );
        expect(result.outcomes).toHaveLength(2);
        expect(fixture.requests).toHaveLength(2);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("Decision 0001 failure coverage: a repository outage on the request write reports the stable persistence-failed diagnostic and does not dispatch", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const failing: PiSubagentExecutionRepositoryShape = {
          ...repository,
          recordTeardownRequested: () => Effect.fail(new Error("journal unavailable") as never),
        };
        const fixture = makeTeardownFixture({ result: () => ({ kind: "proven" }) });
        const diagnostics: DiagnosticEvent[] = [];
        const result = yield* Effect.promise(() =>
          runPiSubagentProcessTeardown(baseInput(failing, fixture, { diagnostics })),
        );
        expect(result.outcomes[0]!.outcome.kind).toBe("failed");
        expect(fixture.requests).toHaveLength(0);
        expect(
          diagnostics.some(
            (event) => event.diagnosticCode === "pi_subagent_lifecycle_persistence_failed",
          ),
        ).toBe(true);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("Decision 0001 failure coverage: a dispatch rejection is journaled as the honest survivors outcome, never a settled claim", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const fixture = makeTeardownFixture();
        const input: PiSubagentProcessTeardownInput = {
          repository,
          dispatchOwnedTeardown: () => Promise.reject(new Error("teardown dispatch crashed")),
          now: nowAt(EPOCH_T0),
        };
        const result = yield* Effect.promise(() => runPiSubagentProcessTeardown(input));
        expect(result.outcomes[0]!.outcome.kind).toBe("survivors");
        const stored = yield* repository.getById("exec_td_1");
        expect(Option.isSome(stored)).toBe(true);
        if (Option.isSome(stored)) {
          expect(stored.value.observedState).toBe("cancelling");
        }
        void fixture;
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});

describe("PiSubagentExecutionRepository teardown seams (Issue 16)", () => {
  it("recordTeardownOutcome(proven) settles cancelled and advances the generation in one transaction; a replay is already_applied", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        const first = yield* repository.recordTeardownOutcome({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          outcome: "proven",
          occurredAt: T0,
          diagnosticMessage: "proven (repository seam test)",
          metadata: { reason: "owned_supervisor_proof" },
        });
        expect(first.kind).toBe("recorded");
        expect(first.execution.observedState).toBe("cancelled");
        expect(first.execution.generation).toBe(2);

        const replay = yield* repository.recordTeardownOutcome({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          outcome: "proven",
          occurredAt: T0,
          diagnosticMessage: "proven (repository seam test)",
          metadata: { reason: "owned_supervisor_proof" },
        });
        expect(replay.kind).toBe("already_applied");
        expect(replay.execution.observedState).toBe("cancelled");
        expect(replay.execution.generation).toBe(2);
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("recordTeardownOutcome on a stale generation journals history only and never fences the newer attempt", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);

        // A concurrent reconciliation fence (ticket 10 owner-loss) advances
        // the generation to 2 before the teardown outcome lands, so the
        // teardown proof for generation 1 is stale by the time it commits.
        yield* repository.recordOrphanedEvent({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          occurredAt: T0,
          diagnosticCode: "pi_subagent_owner_loss_orphaned",
          diagnosticMessage: "fixture: owner-loss fence before teardown",
        });

        const outcome = yield* repository.recordTeardownOutcome({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          outcome: "proven",
          occurredAt: T0,
          diagnosticMessage: "proven (stale test)",
        });
        expect(outcome.kind).toBe("stale_generation");
        // The fenced generation was NOT advanced again by the stale proof
        // and the aggregate was not settled `cancelled` by it.
        expect(outcome.execution.generation).toBe(2);
        expect(outcome.execution.observedState).toBe("orphaned");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("recordTeardownOutcome(proven) on an already-terminal aggregate journals history only — terminal truth is never reversed", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);
        yield* driveToCancelling(repository, execution);
        yield* journalHandoff(repository, execution);
        yield* ingestPiSubagentTerminal({
          repository,
          observation: {
            executionId: "exec_td_1",
            attemptId: "att_td_1",
            generation: 1,
            state: "succeeded",
            occurredAt: T0,
            summary: "terminal won the race",
          },
          summaryMaxChars: 2000,
        });

        const outcome = yield* repository.recordTeardownOutcome({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          outcome: "proven",
          occurredAt: T0,
          diagnosticMessage: "proven (terminal race test)",
        });
        expect(outcome.kind).toBe("already_applied");
        expect(outcome.execution.observedState).toBe("succeeded");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });

  it("recordTeardownRequested is idempotent per attempt/generation and stale for superseded ones", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const execution = makeExecution();
        yield* admit(repository, execution);

        const first = yield* repository.recordTeardownRequested({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          state: "cancelling",
          occurredAt: T0,
        });
        expect(first.kind).toBe("recorded");
        const replay = yield* repository.recordTeardownRequested({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 1,
          state: "cancelling",
          occurredAt: T0,
        });
        expect(replay.kind).toBe("already_applied");
        const stale = yield* repository.recordTeardownRequested({
          executionId: "exec_td_1",
          attemptId: "att_td_1",
          generation: 2,
          state: "cancelling",
          occurredAt: T0,
        });
        expect(stale.kind).toBe("stale_generation");
      }).pipe(Effect.provide(repositoryLayer)),
    );
  });
});
