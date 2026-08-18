import type {
  PiSubagentDiagnosticCode,
  PiSubagentExecutionRecord,
  PiSubagentLifecycleState,
} from "@synara/contracts";
import { ProjectId, ThreadId, TurnId } from "@synara/contracts";
import { assert } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe, expect, it } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "../persistence/Layers/PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentExecutionRepositoryShape,
} from "../persistence/Services/PiSubagentExecutionRepository.ts";
import { fingerprintOrchestrationCommand } from "../orchestration/commandFingerprint.ts";
import {
  buildPiSubagentCompletionDispatchCommand,
  derivePiSubagentCompletionDispatchIdentity,
  serializePiSubagentCompletionDispatchCommand,
} from "./piSubagentCompletionDispatchIdentity.ts";
import {
  makePiSubagentCompletionCoordinator,
  type PiSubagentCompletionCoordinator,
} from "./piSubagentCompletionCoordinator.ts";
import type {
  PiSubagentParentEffectDispatchOutcome,
  PiSubagentParentEffectDispatcher,
} from "./piSubagentParentEffectDispatcher.ts";
import {
  ingestPiSubagentTerminal,
  type PiSubagentTerminalObservation,
} from "./piSubagentTerminalCoordinator.ts";

/**
 * Decision 0016 per-thread completion coordinator (Ticket 09 remediation,
 * WP5) — deterministic fault suite.
 *
 * Seam: server orchestration integration boundary — the REAL repository +
 * in-memory SQLite + the production coordinator, driven through the
 * production terminal ingest, the completion-pending trigger, the durable
 * batch ledger, the narrow parent-effect dispatcher port (a scriptable fake
 * modeling the OrchestrationEngine and its receipt replay), and the virtual
 * clock. Crash boundaries are simulated by creating a FRESH coordinator over
 * the SAME durable repository ("restart"): the batch ledger is the recovery
 * authority.
 *
 * Deterministic faults (Decision 0016 §10) + preserved T09 criteria.
 */

const repositoryLayer = PiSubagentExecutionRepositoryLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const runTest = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(repositoryLayer)) as unknown as Effect.Effect<A, unknown, never>,
  );

const PARENT_THREAD = "th_decision_16";

const makeExecution = (
  overrides?: Partial<PiSubagentExecutionRecord>,
): PiSubagentExecutionRecord => ({
  executionId: "exec_d16_1",
  attemptId: "att_d16_1",
  generation: 1,
  commandId: "cmd_d16_1",
  projectId: "proj_default" as ProjectId,
  parentThreadId: PARENT_THREAD as ThreadId,
  parentTurnId: "turn_d16" as TurnId,
  parentToolCallId: "call_d16",
  agentType: "general-purpose",
  prompt: "task",
  mode: "background",
  cancellationScope: "parent_turn",
  desiredState: "running" as PiSubagentLifecycleState,
  observedState: "running" as PiSubagentLifecycleState,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:00.000Z",
  ...overrides,
});

const admit = (record: PiSubagentExecutionRecord) =>
  Effect.gen(function* () {
    const repository = yield* PiSubagentExecutionRepository;
    const result = yield* repository.recordAdmission({
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
      now: record.createdAt,
    });
    expect(result.kind === "admitted" || result.kind === "already_applied").toBe(true);
  });

const makeObservation = (
  overrides?: Partial<PiSubagentTerminalObservation>,
): PiSubagentTerminalObservation => ({
  executionId: "exec_d16_1",
  attemptId: "att_d16_1",
  generation: 1,
  state: "succeeded",
  occurredAt: "2026-08-18T00:01:00.000Z",
  summary: "Agent completed: 3 tool uses. Outcome: done.",
  transcriptRef: "/tmp/agents/exec_d16_1/output.md",
  outcomeState: "done",
  ...overrides,
});

const outboxIdFor = (observation: PiSubagentTerminalObservation) =>
  `outbox_${observation.executionId}_${observation.attemptId}_gen${observation.generation}`;

const makeVirtualClock = () => {
  let current = 0;
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = [];
  return {
    now: () => current,
    schedule: (delayMs: number, callback: () => void) => {
      const timer = { at: current + Math.max(0, delayMs), callback, cancelled: false };
      timers.push(timer);
      return {
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
    advance: (ms: number) => {
      current += ms;
      for (const timer of [...timers]) {
        if (!timer.cancelled && timer.at <= current) {
          timer.cancelled = true;
          timer.callback();
        }
      }
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
  };
};
type VirtualClock = ReturnType<typeof makeVirtualClock>;

const ACCEPTED: PiSubagentParentEffectDispatchOutcome = {
  kind: "accepted",
  receipt: {
    commandId: "",
    resultSequence: 100,
    messageId: "",
    acceptedAt: "2026-08-18T00:02:00.000Z",
  },
};

const makeBinder = (options?: {
  readonly script?: ReadonlyArray<PiSubagentParentEffectDispatchOutcome>;
  readonly always?: PiSubagentParentEffectDispatchOutcome;
}) => {
  const dispatched: string[] = [];
  let cursor = 0;
  const script = options?.script ?? [];
  const always = options?.always;
  const dispatcher: PiSubagentParentEffectDispatcher = {
    async dispatch(payload) {
      dispatched.push(payload);
      if (always !== undefined) {
        return always;
      }
      const outcome = script[Math.min(cursor, script.length - 1)];
      cursor += 1;
      return outcome ?? { kind: "transient", error: "script exhausted" };
    },
    bindOnce() {},
    isBound() {
      return true;
    },
    onBound() {
      return () => {};
    },
  } as PiSubagentParentEffectDispatcher;
  return {
    dispatcher,
    dispatched,
    dispatchCount: () => dispatched.length,
  };
};
type Binder = ReturnType<typeof makeBinder>;

const makeBatchContentBuilder = () => {
  return (input: {
    readonly parentThreadId: string;
    readonly members: readonly {
      readonly outboxId: string;
      readonly executionId: string;
    }[];
    readonly createdAt: string;
  }): {
    readonly batchId: string;
    readonly parentCommandId: string;
    readonly parentMessageId: string;
    readonly fingerprintVersion: number;
    readonly commandFingerprint: string;
    readonly membership: readonly string[];
    readonly parentMessageText: string;
    readonly commandPayloadJson: string;
  } => {
    const outboxIds = input.members.map((member) => member.outboxId);
    const identity = derivePiSubagentCompletionDispatchIdentity({
      parentThreadId: input.parentThreadId,
      outboxIds,
    });
    const parentMessageText = `[policy]\nA background subagent finished: ${input.members
      .map((member) => member.executionId)
      .join(", ")}`;
    const command = buildPiSubagentCompletionDispatchCommand({
      identity,
      commandInput: {
        parentThreadId: input.parentThreadId,
        parentMessageText,
        runtimeMode: "full-access",
        interactionMode: "default",
        assistantDeliveryMode: "buffered",
        createdAt: input.createdAt,
      },
    });
    const fingerprint = fingerprintOrchestrationCommand(command);
    return {
      batchId: identity.batchId,
      parentCommandId: identity.parentCommandId,
      parentMessageId: identity.parentMessageId,
      fingerprintVersion: fingerprint.version,
      commandFingerprint: fingerprint.value,
      membership: outboxIds,
      parentMessageText,
      commandPayloadJson: serializePiSubagentCompletionDispatchCommand(command),
    };
  };
};

const setupCoordinator = (options?: {
  readonly clock?: VirtualClock;
  readonly binder?: Binder;
  readonly batchWindowMs?: number;
  readonly retryLimit?: number;
  readonly maxBatchEntries?: number;
  readonly busyThreads?: Set<string>;
  readonly unavailableThreads?: Set<string>;
  readonly throwingBuilder?: boolean;
  readonly onDiagnostic?: (event: {
    readonly parentThreadId: string;
    readonly executionId?: string | undefined;
    readonly batchId?: string | undefined;
    readonly diagnosticCode: PiSubagentDiagnosticCode;
    readonly diagnosticMessage: string;
  }) => void;
}) => {
  const clock = options?.clock ?? makeVirtualClock();
  const binder = options?.binder ?? makeBinder({ script: [ACCEPTED] });
  const busyThreads = options?.busyThreads ?? new Set<string>();
  const unavailableThreads = options?.unavailableThreads ?? new Set<string>();
  const diagnostics: Array<PiSubagentDiagnosticCode> = [];
  const buildBatchContent = makeBatchContentBuilder();
  let repositoryRef: PiSubagentExecutionRepositoryShape | undefined;
  const coordinator = makePiSubagentCompletionCoordinator({
    get repository() {
      if (repositoryRef === undefined) {
        throw new Error("coordinator repository not bound to the Effect scope yet");
      }
      return repositoryRef;
    },
    batchWindowMs: options?.batchWindowMs ?? 1_000,
    retryLimit: options?.retryLimit,
    maxBatchEntries: options?.maxBatchEntries,
    now: clock.now,
    schedule: clock.schedule,
    isParentBusy: (parentThreadId) => busyThreads.has(parentThreadId),
    parentSessionAvailable: (parentThreadId) => !unavailableThreads.has(parentThreadId),
    parentEffectDispatcher: binder.dispatcher,
    buildBatchContent: options?.throwingBuilder
      ? () => {
          throw new Error("content builder failed");
        }
      : (input) => buildBatchContent(input),
    onDiagnostic: (event) => {
      diagnostics.push(event.diagnosticCode);
      options?.onDiagnostic?.(event);
    },
  });
  const bindRepository = (repository: PiSubagentExecutionRepositoryShape) => {
    repositoryRef = repository;
  };
  return { clock, binder, coordinator, diagnostics, bindRepository };
};

/** Flush zero-delay redrive timers + in-flight coordinator work (Effect). */
const flush = (coordinator: PiSubagentCompletionCoordinator, clock: VirtualClock) =>
  Effect.gen(function* () {
    for (let i = 0; i < 30; i += 1) {
      clock.advance(0);
      const hadTimers = clock.pending() > 0;
      yield* Effect.sleep(0);
      yield* Effect.promise(() => coordinator.waitForIdle());
      if (!hadTimers) {
        break;
      }
    }
    yield* Effect.promise(() => coordinator.waitForIdle());
  });

const triggerAndFlush = (
  coordinator: PiSubagentCompletionCoordinator,
  clock: VirtualClock,
  fire: () => void,
) =>
  Effect.gen(function* () {
    fire();
    clock.advance(1_000);
    yield* Effect.promise(() => coordinator.waitForIdle());
    yield* flush(coordinator, clock);
  });

describe("Decision 0016 completion coordinator (WP5)", () => {
  it("T09-AC1: near-simultaneous completions → ONE immutable batch, ONE accepted receipt, both acknowledged", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { clock, coordinator, binder, bindRepository } = setupCoordinator();
        bindRepository(repository);
        yield* admit(makeExecution());
        yield* admit(
          makeExecution({
            executionId: "exec_d16_2",
            attemptId: "att_d16_2",
            commandId: "cmd_d16_2",
          }),
        );
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_d16_2", attemptId: "att_d16_2" }),
        });
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });

        expect(binder.dispatchCount()).toBe(0); // window still open (batching)
        yield* triggerAndFlush(coordinator, clock, () => {});

        const e1 = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        const e2 = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_d16_2", attemptId: "att_d16_2" })),
        );
        expect(e1._tag === "Some" && e1.value.deliveryState === "acknowledged").toBe(true);
        expect(e2._tag === "Some" && e2.value.deliveryState === "acknowledged").toBe(true);
        expect(binder.dispatched).toHaveLength(1);
        const payload = JSON.parse(binder.dispatched[0]!) as { message: { text: string } };
        expect(payload.message.text).toContain("exec_d16_1");
        expect(payload.message.text).toContain("exec_d16_2");
      }),
    );
  });

  it("Decision 0018 F1: receipt-confirmed finalization emits the SUCCESS diagnostic literal, never the failure code", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const { clock, coordinator, bindRepository, diagnostics } = setupCoordinator();
        bindRepository(repository);
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        yield* triggerAndFlush(coordinator, clock, () => {});

        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "acknowledged").toBe(true);
        // The accepted-and-acknowledged finalization diagnostic uses the
        // dedicated success literal (Decision 0018 F1 follow-up owner:
        // Ticket 11). A failure code on the success path would be a
        // user-visible false failure.
        expect(diagnostics).toContain("pi_subagent_completion_delivery_succeeded");
        expect(diagnostics).not.toContain("pi_subagent_completion_delivery_failed");
      }),
    );
  });

  it("F1: loss after batch/member commit but before command submission → same batch recovers, one message", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        const created = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(created));
        expect(created.value.state).toBe("awaiting_acceptance");
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "delivered").toBe(true);
        // The pre-bind dispatch was `unavailable`: the engine was never reached
        // (batch still awaiting acceptance, no receipt, no retry accounting).
        expect(c1.binder.dispatchCount()).toBe(1);
        expect(c1.binder.dispatched).toHaveLength(1);

        // Restart #2: recovery drives the awaiting batch through the bridge.
        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.onParentTurnSettled(PARENT_THREAD),
        );

        const after = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(after)).toBe(true);
        const recovered = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation()),
        );
        expect(Option.isSome(recovered) && recovered.value.deliveryState === "acknowledged").toBe(
          true,
        );
        expect(c2.binder.dispatchCount()).toBe(1);
      }),
    );
  });

  it("F2: batch durably `accepted` at restart → finalize once with zero re-dispatch", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(active));
        expect(active.value.state).toBe("awaiting_acceptance");

        // Engine accepted, then process died before local finalization.
        const accepted = yield* repository.recordCompletionDispatchAccepted({
          batchId: active.value.batchId,
          fingerprintVersion: active.value.fingerprintVersion,
          commandFingerprint: active.value.commandFingerprint,
          parentCommandId: active.value.parentCommandId,
          parentMessageId: active.value.parentMessageId,
          acceptedReceiptSequence: 100,
          now: "2026-08-18T00:02:00.000Z",
        });
        expect(accepted.kind).toBe("transitioned");
        if (accepted.kind === "transitioned") {
          expect(accepted.batch.state).toBe("accepted");
        }

        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.triggerScan([PARENT_THREAD]),
        );

        expect(c2.binder.dispatchCount()).toBe(0); // no re-dispatch of an accepted batch
        const after = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(after)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("F1-alt/restart: restart without any new terminal recovers an awaiting batch after dispatcher availability", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const batchOpt = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(batchOpt));
        expect(batchOpt.value.state).toBe("awaiting_acceptance");
        expect(c1.binder.dispatched).toHaveLength(1);

        // NO new terminal arrives — only dispatcher/session availability.
        const c2 = setupCoordinator({ binder: makeBinder({ always: ACCEPTED }) });
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.triggerScan([PARENT_THREAD]),
        );

        const after = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(after)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "acknowledged").toBe(true);
        expect(c1.binder.dispatched[0]).toBe(c2.binder.dispatched[0]); // byte-identical
      }),
    );
  });

  it("F3: timeout/no receipt → byte-identical retry under the same identity", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const binder = makeBinder({
          script: [{ kind: "transient", error: "no receipt" }, ACCEPTED],
        });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder });
        bindRepository(repository);
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        clock.advance(1_000);
        yield* flush(coordinator, clock);

        const retryable = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(retryable));
        expect(retryable.value.state).toBe("retryable");
        expect(retryable.value.attemptCount).toBe(1);

        clock.advance(1_000);
        yield* flush(coordinator, clock);

        expect(binder.dispatchCount()).toBe(2);
        expect(binder.dispatched[0]).toBe(binder.dispatched[1]);
        const after = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(after)).toBe(true);
      }),
    );
  });

  it("F4: accepted despite caller timeout (unverified) → receipt recovery, no duplicate", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const binder = makeBinder({
          script: [{ kind: "unverified", error: "could not confirm" }, ACCEPTED],
        });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder });
        bindRepository(repository);
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        clock.advance(1_000);
        yield* flush(coordinator, clock);
        clock.advance(1_000);
        yield* flush(coordinator, clock);

        expect(binder.dispatched[0]).toBe(binder.dispatched[1]);
        const after = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(after)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("F5: altered stored payload under same ID → fail-closed collision, exhausted, zero dispatch, no rotated identity", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(active));
        const batch = active.value;

        const parsed = JSON.parse(batch.commandPayloadJson) as {
          message: { text: string; messageId: string; role: string; attachments: [] };
        };
        const driftedPayload = JSON.stringify({
          ...parsed,
          message: { ...parsed.message, text: "tampered under the same identity" },
        });
        yield* sql`
          UPDATE pi_subagent_completion_dispatch_batches
          SET command_payload_json = ${driftedPayload}
          WHERE batch_id = ${batch.batchId}
        `;

        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.triggerScan([PARENT_THREAD]),
        );

        expect(c2.binder.dispatchCount()).toBe(0);
        const finalBatch = yield* repository.getCompletionDispatchBatch(batch.batchId);
        assert(Option.isSome(finalBatch));
        expect(finalBatch.value.state).toBe("exhausted");
        expect(finalBatch.value.batchId).toBe(batch.batchId); // no identity rotation
        const slot = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(slot)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "delivered").toBe(true);
        expect(c2.diagnostics).toContain("pi_subagent_completion_batch_collision");
      }),
    );
  });

  it("F5b: malformed stored payload fails closed (collision) with zero dispatch", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        const sql = yield* SqlClient.SqlClient;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(active));
        yield* sql`
          UPDATE pi_subagent_completion_dispatch_batches
          SET command_payload_json = '{{{not json'
          WHERE batch_id = ${active.value.batchId}
        `;

        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.triggerScan([PARENT_THREAD]),
        );
        expect(c2.binder.dispatchCount()).toBe(0);
        const finalBatch = yield* repository.getCompletionDispatchBatch(active.value.batchId);
        expect(Option.isSome(finalBatch) && finalBatch.value.state).toBe("exhausted");
      }),
    );
  });

  it("F6: persisted rejection → one genuine failure, terminal exhaustion, no repeated increments", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const binder = makeBinder({
          script: [{ kind: "rejected", error: "turn rejected before running" }],
        });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder });
        bindRepository(repository);
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        clock.advance(1_000);
        yield* flush(coordinator, clock);

        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true); // exhausted is terminal
        const recoverable = yield* repository.listRecoverableCompletionDispatchBatches({
          retryLimit: 5,
        });
        expect(recoverable).toHaveLength(0);

        coordinator.onParentTurnSettled(PARENT_THREAD);
        yield* flush(coordinator, clock);
        expect(binder.dispatchCount()).toBe(1); // not re-incremented / re-driven
        const recoverableAgain = yield* repository.listRecoverableCompletionDispatchBatches({
          retryLimit: 5,
        });
        expect(recoverableAgain).toHaveLength(0);
      }),
    );
  });

  it("T09-AC3/busy: busy parent defers with zero durable state or retry, recovers on settle", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const busy = new Set<string>([PARENT_THREAD]);
        const binder = makeBinder({ always: ACCEPTED });
        const { clock, coordinator, bindRepository, diagnostics } = setupCoordinator({
          busyThreads: busy,
          binder,
        });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "pending").toBe(true);
        expect(binder.dispatchCount()).toBe(0);
        expect(diagnostics).not.toContain("pi_subagent_completion_delivery_failed");

        busy.delete(PARENT_THREAD);
        coordinator.onParentTurnSettled(PARENT_THREAD);
        yield* flush(coordinator, clock);
        const after = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(after) && after.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("lazy session: absent managed parent consumes no retry and recovers on hydration", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const unavailable = new Set<string>([PARENT_THREAD]);
        const binder = makeBinder({ always: ACCEPTED });
        const { clock, coordinator, bindRepository } = setupCoordinator({
          unavailableThreads: unavailable,
          binder,
        });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        expect(binder.dispatchCount()).toBe(0);
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true);

        unavailable.delete(PARENT_THREAD);
        coordinator.onManagedSessionHydrated(PARENT_THREAD);
        yield* flush(coordinator, clock);
        const after = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(after) && after.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("cross-thread isolation: one thread's failing batch never blocks another thread", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution({ parentThreadId: "th_a" as ThreadId }));
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const binderA = makeBinder({ always: { kind: "transient", error: "th_a failing" } });
        const {
          clock: clockA,
          coordinator: coordA,
          bindRepository: bindA,
        } = setupCoordinator({
          binder: binderA,
          retryLimit: 1,
        });
        bindA(repository);
        yield* triggerAndFlush(coordA, clockA, () =>
          coordA.onCompletionPending({ parentThreadId: "th_a" }),
        );
        const exhausted = yield* repository.getActiveCompletionDispatchBatch("th_a");
        expect(Option.isNone(exhausted)).toBe(true);

        yield* admit(
          makeExecution({
            executionId: "exec_b",
            attemptId: "att_b",
            commandId: "cmd_b",
            parentThreadId: "th_b" as ThreadId,
          }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_b", attemptId: "att_b" }),
        });
        const binderB = makeBinder({ always: ACCEPTED });
        const {
          clock: clockB,
          coordinator: coordB,
          bindRepository: bindB,
        } = setupCoordinator({
          binder: binderB,
        });
        bindB(repository);
        yield* triggerAndFlush(coordB, clockB, () =>
          coordB.onCompletionPending({ parentThreadId: "th_b" }),
        );
        const acked = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_b", attemptId: "att_b" })),
        );
        expect(Option.isSome(acked) && acked.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("later same-thread completions stay outside the active batch and join the NEXT batch after settle", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        // Batch #1 stays ACTIVE (retryable) while a second completion arrives.
        const binder = makeBinder({ always: { kind: "transient", error: "keep active" } });
        const { clock, coordinator, bindRepository } = setupCoordinator({
          binder,
          retryLimit: 10,
        });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const batch1 = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(batch1));
        expect(batch1.value.membership).toHaveLength(1);
        const parkedEntry = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation()),
        );
        expect(Option.isSome(parkedEntry) && parkedEntry.value.deliveryState).toBe("delivered");

        yield* admit(
          makeExecution({
            executionId: "exec_second",
            attemptId: "att_second",
            commandId: "cmd_second",
          }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_second", attemptId: "att_second" }),
        });
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        clock.advance(1_000);
        yield* flush(coordinator, clock);

        // STILL exactly one active batch (batch #1); the newer completion is
        // parked OUTSIDE it (durable one-outstanding authority).
        const stillActive = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(stillActive));
        expect(stillActive.value.batchId).toBe(batch1.value.batchId);
        expect(stillActive.value.membership).toHaveLength(1);
        const parkedSecond = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_second", attemptId: "att_second" })),
        );
        expect(Option.isSome(parkedSecond) && parkedSecond.value.deliveryState).toBe("pending");

        // Switch to an accepting dispatcher: batch #1 settles and a SECOND batch
        // forms with exactly the waiting entry.
        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.triggerScan([PARENT_THREAD]),
        );
        const second = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_second", attemptId: "att_second" })),
        );
        expect(Option.isSome(second) && second.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("unrelated settle/provider events cannot settle the batch; exact receipt correlation finalizes", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const binder = makeBinder({ always: { kind: "transient", error: "not accepted yet" } });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        coordinator.onParentTurnSettled(PARENT_THREAD);
        coordinator.onParentTurnSettled(PARENT_THREAD);
        yield* flush(coordinator, clock);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "delivered").toBe(true);

        const binderOk = makeBinder({ always: ACCEPTED });
        const {
          clock: c2clock,
          coordinator: coord2,
          bindRepository: bind2,
        } = setupCoordinator({ binder: binderOk });
        bind2(repository);
        yield* triggerAndFlush(coord2, c2clock, () => coord2.onParentTurnSettled(PARENT_THREAD));
        const acked = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(acked) && acked.value.deliveryState === "acknowledged").toBe(true);
      }),
    );
  });

  it("stale-before-creation: generation-fenced members produce zero batch command", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        yield* repository.recordLifecycleEvent({
          eventId: "evt_resume",
          executionId: "exec_d16_1",
          attemptId: "att_d16_1",
          generation: 2,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-18T00:05:00.000Z",
        });
        const binder = makeBinder({ always: ACCEPTED });
        const { clock, coordinator, bindRepository, diagnostics } = setupCoordinator({ binder });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        expect(binder.dispatchCount()).toBe(0);
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState === "superseded").toBe(true);
        expect(diagnostics).toContain("pi_subagent_completion_superseded");
      }),
    );
  });

  it("stale-before-submission: batch superseded with zero command, slot released", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });

        const c1 = setupCoordinator({
          binder: makeBinder({ script: [{ kind: "unavailable", error: "pre-bind" }] }),
        });
        c1.bindRepository(repository);
        yield* triggerAndFlush(c1.coordinator, c1.clock, () =>
          c1.coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        assert(Option.isSome(active));

        yield* repository.recordLifecycleEvent({
          eventId: "evt_resume2",
          executionId: "exec_d16_1",
          attemptId: "att_d16_1",
          generation: 2,
          sequence: 2,
          state: "running",
          occurredAt: "2026-08-18T00:05:00.000Z",
        });

        const c2 = setupCoordinator();
        c2.bindRepository(repository);
        yield* triggerAndFlush(c2.coordinator, c2.clock, () =>
          c2.coordinator.onManagedSessionHydrated(PARENT_THREAD),
        );
        expect(c2.binder.dispatchCount()).toBe(0);
        const after = yield* repository.getCompletionDispatchBatch(active.value.batchId);
        expect(Option.isSome(after) && after.value.state).toBe("superseded");
        const slot = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(slot)).toBe(true);
      }),
    );
  });

  it("execution/terminal evidence stays byte-stable through retry exhaustion", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const evidenceBefore = yield* repository.getTerminalEvidence("exec_d16_1");
        assert(Option.isSome(evidenceBefore));

        const binder = makeBinder({
          script: [
            { kind: "transient", error: "t1" },
            { kind: "transient", error: "t2" },
            { kind: "transient", error: "t3" },
            { kind: "transient", error: "t4" },
            { kind: "transient", error: "t5" },
          ],
        });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder, retryLimit: 5 });
        bindRepository(repository);
        coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD });
        for (let i = 0; i < 6; i += 1) {
          clock.advance(1_000);
          yield* flush(coordinator, clock);
        }

        const evidenceAfter = yield* repository.getTerminalEvidence("exec_d16_1");
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        assert(Option.isSome(evidenceAfter));
        expect(evidenceAfter.value.terminalSummary).toBe(evidenceBefore.value.terminalSummary);
        expect(Option.isSome(member) && member.value.summary).toBe(
          "Agent completed: 3 tool uses. Outcome: done.",
        );
        expect(Option.isSome(member) && member.value.deliveryState).toBe("delivered");
        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true); // exhausted → slot released
      }),
    );
  });

  it("content builder failure → no partial batch, entries stay pending (fail closed)", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        yield* ingestPiSubagentTerminal({ repository, observation: makeObservation() });
        const { clock, coordinator, bindRepository, diagnostics } = setupCoordinator({
          throwingBuilder: true,
        });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        const active = yield* repository.getActiveCompletionDispatchBatch(PARENT_THREAD);
        expect(Option.isNone(active)).toBe(true);
        const member = yield* repository.getCompletionOutboxEntry(outboxIdFor(makeObservation()));
        expect(Option.isSome(member) && member.value.deliveryState).toBe("pending");
        expect(diagnostics).toContain("pi_subagent_completion_batch_collision");
      }),
    );
  });

  it("rollback inertness: pre-batch delivered row never redrives; new pending entries still deliver", async () => {
    await runTest(
      Effect.gen(function* () {
        const repository = yield* PiSubagentExecutionRepository;
        yield* admit(makeExecution());
        const row = yield* repository.recordCompletionOutboxEntry({
          executionId: "exec_d16_1",
          attemptId: "att_d16_1",
          generation: 1,
          terminalEventId: "evt_legacy",
          parentThreadId: PARENT_THREAD,
          terminalState: "succeeded",
          summary: "legacy",
          now: "2026-08-18T00:01:00.000Z",
        });
        yield* repository.markCompletionDelivered({
          outboxId: row.entry.outboxId,
          now: "2026-08-18T00:01:00.000Z",
        });

        yield* admit(
          makeExecution({ executionId: "exec_new", attemptId: "att_new", commandId: "cmd_new" }),
        );
        yield* ingestPiSubagentTerminal({
          repository,
          observation: makeObservation({ executionId: "exec_new", attemptId: "att_new" }),
        });

        const binder = makeBinder({ always: ACCEPTED });
        const { clock, coordinator, bindRepository } = setupCoordinator({ binder });
        bindRepository(repository);
        yield* triggerAndFlush(coordinator, clock, () =>
          coordinator.onCompletionPending({ parentThreadId: PARENT_THREAD }),
        );

        const legacy = yield* repository.getCompletionOutboxEntry(row.entry.outboxId);
        expect(Option.isSome(legacy) && legacy.value.deliveryState).toBe("delivered");
        const fresh = yield* repository.getCompletionOutboxEntry(
          outboxIdFor(makeObservation({ executionId: "exec_new", attemptId: "att_new" })),
        );
        expect(Option.isSome(fresh) && fresh.value.deliveryState).toBe("acknowledged");
      }),
    );
  });
});
