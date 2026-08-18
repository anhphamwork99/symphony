import { assert, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect } from "vitest";

import { PiSubagentExecutionRepositoryLive } from "./PiSubagentExecutionRepository.ts";
import { SqlitePersistenceMemory } from "../Layers/Sqlite.ts";
import {
  PiSubagentExecutionRepository,
  type PiSubagentCompletionDispatchBatchContent,
  type PiSubagentCompletionOutboxEntry,
} from "../Services/PiSubagentExecutionRepository.ts";

/**
 * Decision 0016 — completion-dispatch batch ledger (Ticket 09 remediation).
 *
 * Repository state-machine contract over the real in-memory SQLite schema
 * (migration 103 applied through the shared migrator):
 *
 * - guarded transactional create (canonical selection, generation fence, cap,
 *   immutable frozen content, associate-members-once, fail-closed on
 *   noncanonical / duplicate / cross-thread / oversized membership and on
 *   identity collision);
 * - durable one-active-batch-per-thread authority (partial unique index);
 * - exact receipt correlation (recordCompletionDispatchAccepted) and exact
 *   membership finalization (finalizeCompletionDispatchBatch);
 * - stable-identity transient retry with terminal exhaustion at the policy
 *   ceiling; immutable rejection/collision with one genuine attempt;
 *   stale-before-submission supersede with zero parent effect;
 * - transaction failure leaves no partial batch or stranded delivered rows;
 * - rollback leaves pre-batch `delivered` evidence inert (never redriven).
 *
 * Execution/terminal evidence is never mutated by any batch transition.
 *
 * NOTE: `it.layer` shares one in-memory database across every test in the
 * group, so every test uses its own parent thread id to stay isolated.
 */

const layer = it.layer(
  PiSubagentExecutionRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const NOW = "2026-08-18T12:00:00.000Z";
const RETRY_LIMIT = 5;
let threadCounter = 0;
const nextThread = (): string => `th_decision_16_${(threadCounter += 1)}`;

const admitExecution = (executionId: string, parentThreadId: string, generation = 1) =>
  Effect.gen(function* () {
    const repo = yield* PiSubagentExecutionRepository;
    const result = yield* repo.recordAdmission({
      executionId,
      attemptId: `att_${executionId}`,
      generation,
      commandId: `cmd_${executionId}`,
      commandFingerprint: `fp_${executionId}`,
      projectId: "proj_default",
      parentThreadId,
      parentTurnId: "turn_parent",
      parentToolCallId: "call_parent",
      agentType: "general-purpose",
      prompt: "task",
      mode: "background",
      cancellationScope: "parent_turn",
      state: "accepted",
      now: NOW,
    });
    assert(result.kind === "admitted" || result.kind === "already_applied");
  });

const createOutboxEntry = (
  executionId: string,
  parentThreadId: string,
  generation = 1,
) =>
  Effect.gen(function* () {
    const repo = yield* PiSubagentExecutionRepository;
    const result = yield* repo.recordCompletionOutboxEntry({
      executionId,
      attemptId: `att_${executionId}`,
      generation,
      terminalEventId: `evt_${executionId}`,
      parentThreadId,
      terminalState: "succeeded",
      summary: `summary for ${executionId}`,
      transcriptRef: `ref_${executionId}`,
      now: NOW,
    });
    assert(result.kind === "created");
    return result.entry;
  });

const makeBatchContent: (
  members: readonly PiSubagentCompletionOutboxEntry[],
  parentThreadId: string,
) => PiSubagentCompletionDispatchBatchContent = (members, parentThreadId) => {
  const parentCommandId = `pi_cmd_${members.map((m) => m.outboxId).join("_")}`;
  const parentMessageId = `pi_msg_${members.map((m) => m.outboxId).join("_")}`;
  const membership = members.map((m) => m.outboxId);
  const parentMessageText = `[policy] Follow up for ${members.map((m) => m.executionId).join(",")}`;
  return {
    batchId: `pi_batch_${members.map((m) => m.outboxId).join("_")}`,
    parentCommandId,
    parentMessageId,
    fingerprintVersion: 1,
    commandFingerprint: `fp_cmd_${parentCommandId}`,
    membership,
    parentMessageText,
    commandPayloadJson: JSON.stringify({
      type: "thread.turn.start",
      commandId: parentCommandId,
      threadId: parentThreadId,
      message: { messageId: parentMessageId, role: "user", text: parentMessageText, attachments: [] },
      dispatchMode: "queue",
      dispatchOrigin: "agent",
      runtimeMode: "full-access",
      interactionMode: "default",
      assistantDeliveryMode: "buffered",
      createdAt: NOW,
    }),
  };
};

layer("Decision 0016 completion-dispatch batch repository", (it) => {
  it.effect("no_members when no recoverable outbox rows exist", () =>
    Effect.gen(function* () {
      const repo = yield* PiSubagentExecutionRepository;
      const result = yield* repo.createCompletionDispatchBatch({
        parentThreadId: nextThread(),
        maxBatchEntries: 8,
        retryLimit: RETRY_LIMIT,
        now: NOW,
        buildBatchContent: (members) => makeBatchContent(members, "unused"),
      });
      assert(result.kind === "no_members");
    }),
  );

  it.effect(
    "caps membership at maxBatchEntries; overflow stays recoverable pending",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        for (const id of ["e1", "e2", "e3"]) {
          yield* admitExecution(id, thread);
          yield* createOutboxEntry(id, thread);
        }
        const result = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 2,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(result.kind === "created");
        assert.equal(result.batch.membership.length, 2);
        assert.equal(result.batch.state, "awaiting_acceptance");

        // The capped-out member is still pending (joins a later batch).
        const third = yield* repo.getCompletionOutboxEntry(`outbox_e3_att_e3_gen1`);
        assert(Option.isSome(third));
        if (Option.isSome(third)) {
          expect(third.value.deliveryState).toBe("pending");
          expect(third.value.dispatchBatchId).toBeNull();
        }
        // The selected two became `delivered` batch-membership evidence.
        const first = yield* repo.getCompletionOutboxEntry(`outbox_e1_att_e1_gen1`);
        assert(Option.isSome(first));
        if (Option.isSome(first)) {
          expect(first.value.deliveryState).toBe("delivered");
          expect(first.value.dispatchBatchId).toBe(result.batch.batchId);
        }
      }),
  );

  it.effect(
    "second active batch for the same thread is rejected (one-outstanding authority)",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("a1", thread);
        yield* createOutboxEntry("a1", thread);
        const first = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(first.kind === "created");

        yield* admitExecution("a2", thread);
        yield* createOutboxEntry("a2", thread);
        const second = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(second.kind === "active_batch_exists");

        // The second member was NOT touched by the rejected create.
        const untouched = yield* repo.getCompletionOutboxEntry(`outbox_a2_att_a2_gen1`);
        assert(Option.isSome(untouched));
        if (Option.isSome(untouched)) {
          expect(untouched.value.deliveryState).toBe("pending");
          expect(untouched.value.dispatchBatchId).toBeNull();
        }
      }),
  );

  it.effect(
    "member_collision rolls the transaction back (no partial batch, no stranded delivered rows)",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("c1", thread);
        yield* createOutboxEntry("c1", thread);
        yield* admitExecution("c2", thread);
        yield* createOutboxEntry("c2", thread);

        // Pre-associate c2 with a foreign (leaked) batch id while it is still
        // `pending` — simulates a racing process or a stale partial write that
        // consumed this member before the create's association step.
        const sql = yield* SqlClient.SqlClient;
        yield* sql`
          UPDATE pi_subagent_completion_outbox
          SET dispatch_batch_id = 'foreign_batch_leaked'
          WHERE outbox_id = 'outbox_c2_att_c2_gen1'
        `;

        const result = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        // c1 stays pending and is selected first; the c2 association update
        // requires dispatch_batch_id IS NULL, so it fails and rolls back.
        assert(result.kind === "member_collision");

        // No batch row was created.
        const active = yield* repo.getActiveCompletionDispatchBatch(thread);
        assert(Option.isNone(active));

        // No member was associated with any batch.
        const c1 = yield* repo.getCompletionOutboxEntry(`outbox_c1_att_c1_gen1`);
        if (Option.isSome(c1)) {
          expect(c1.value.dispatchBatchId).toBeNull();
          expect(c1.value.deliveryState).toBe("pending");
        }
      }),
  );

  it.effect(
    "noncanonical / duplicate / cross-thread / oversized builder output fails closed",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("b1", thread);
        yield* createOutboxEntry("b1", thread);
        yield* admitExecution("b2", thread);
        yield* createOutboxEntry("b2", thread);

        // Noncanonical order in the builder output.
        const noncanonical = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => ({
            ...makeBatchContent(members, thread),
            membership: [members[1]!.outboxId, members[0]!.outboxId],
          }),
        });
        assert(noncanonical.kind === "content_rejected");

        // Duplicate membership.
        const duplicate = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => ({
            ...makeBatchContent(members, thread),
            membership: [members[0]!.outboxId, members[0]!.outboxId],
          }),
        });
        assert(duplicate.kind === "content_rejected");

        // Cross-thread command payload.
        const crossThread = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => ({
            ...makeBatchContent(members, thread),
            commandPayloadJson: JSON.stringify({
              ...JSON.parse(makeBatchContent(members, thread).commandPayloadJson),
              threadId: "th_other_thread",
            }),
          }),
        });
        assert(crossThread.kind === "content_rejected");

        // Oversized membership (more than the selected members).
        const oversized = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 1,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => ({
            ...makeBatchContent(members, thread),
            membership: [members[0]!.outboxId, members[1]!.outboxId],
          }),
        });
        assert(oversized.kind === "content_rejected");

        // Nothing was created by any of the rejecting attempts.
        const active = yield* repo.getActiveCompletionDispatchBatch(thread);
        assert(Option.isNone(active));
      }),
  );

  it.effect(
    "exact receipt correlation: accepted only on matching command/fingerprint/message; mismatches fail closed",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("r1", thread);
        yield* createOutboxEntry("r1", thread);
        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        const batch = created.batch;

        // Fingerprint mismatch → fail closed, batch unchanged awaiting.
        const fingerprintMismatch = yield* repo.recordCompletionDispatchAccepted({
          batchId: batch.batchId,
          fingerprintVersion: 1,
          commandFingerprint: "wrong_fingerprint",
          parentCommandId: batch.parentCommandId,
          parentMessageId: batch.parentMessageId,
          acceptedReceiptSequence: 100,
          now: NOW,
        });
        assert(fingerprintMismatch.kind === "receipt_mismatch");
        expect(fingerprintMismatch.reason).toBe("fingerprint_mismatch");
        const stillAwaiting = yield* repo.getCompletionDispatchBatch(batch.batchId);
        assert(Option.isSome(stillAwaiting));
        expect(stillAwaiting.value.state).toBe("awaiting_acceptance");
        expect(stillAwaiting.value.acceptedReceiptSequence).toBeNull();

        // Message mismatch → fail closed.
        const messageMismatch = yield* repo.recordCompletionDispatchAccepted({
          batchId: batch.batchId,
          fingerprintVersion: 1,
          commandFingerprint: batch.commandFingerprint,
          parentCommandId: batch.parentCommandId,
          parentMessageId: "another_message",
          acceptedReceiptSequence: 100,
          now: NOW,
        });
        assert(messageMismatch.kind === "receipt_mismatch");
        expect(messageMismatch.reason).toBe("message_mismatch");

        // Exact receipt → accepted.
        const exact = yield* repo.recordCompletionDispatchAccepted({
          batchId: batch.batchId,
          fingerprintVersion: 1,
          commandFingerprint: batch.commandFingerprint,
          parentCommandId: batch.parentCommandId,
          parentMessageId: batch.parentMessageId,
          acceptedReceiptSequence: 101,
          now: NOW,
        });
        assert(exact.kind === "transitioned");
        expect(exact.batch.state).toBe("accepted");
        expect(exact.batch.acceptedReceiptSequence).toBe(101);

        // Idempotent replay of the same accepted receipt.
        const replay = yield* repo.recordCompletionDispatchAccepted({
          batchId: batch.batchId,
          fingerprintVersion: 1,
          commandFingerprint: batch.commandFingerprint,
          parentCommandId: batch.parentCommandId,
          parentMessageId: batch.parentMessageId,
          acceptedReceiptSequence: 101,
          now: NOW,
        });
        assert(replay.kind === "transitioned");
        expect(replay.batch.state).toBe("accepted");
        expect(replay.batch.attemptCount).toBe(0);
      }),
  );

  it.effect(
    "finalize acknowledges only exact batch members and is idempotent",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("f1", thread);
        const member = yield* createOutboxEntry("f1", thread);
        yield* admitExecution("unrelatedRunner", thread);
        const unrelated = yield* createOutboxEntry("unrelatedRunner", thread);

        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        const batch = created.batch;

        // Simulate a generic message_end acknowledgement on an unrelated
        // member (old path) — must NOT settle this batch or its members.
        yield* repo.markCompletionAcknowledged({ outboxId: unrelated.outboxId, now: NOW });

        const finalized = yield* repo.finalizeCompletionDispatchBatch({
          batchId: batch.batchId,
          now: NOW,
        });
        assert(finalized.kind === "transitioned");
        expect(finalized.batch.state).toBe("acknowledged");
        expect(finalized.batch.acknowledgedAt).toBe(NOW);

        const settledMember = yield* repo.getCompletionOutboxEntry(member.outboxId);
        assert(Option.isSome(settledMember));
        if (Option.isSome(settledMember)) {
          expect(settledMember.value.deliveryState).toBe("acknowledged");
        }

        // Idempotent finalization replay.
        const replay = yield* repo.finalizeCompletionDispatchBatch({
          batchId: batch.batchId,
          now: NOW,
        });
        assert(replay.kind === "transitioned");
        expect(replay.batch.state).toBe("acknowledged");

        // Slot released: a fresh batch may now form for the thread.
        const active = yield* repo.getActiveCompletionDispatchBatch(thread);
        assert(Option.isNone(active));
      }),
  );

  it.effect(
    "transient failure is retryable under the same identity and exhausts at the ceiling",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("t1", thread);
        yield* createOutboxEntry("t1", thread);
        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        const batchId = created.batch.batchId;

        // retryLimit=5 → attempts 1..4 retryable, attempt 5 exhausted.
        let last: string | undefined;
        for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
          const failed = yield* repo.failCompletionDispatchBatch({
            batchId,
            now: NOW,
            error: `transient ${attempt}`,
            retryLimit: RETRY_LIMIT,
          });
          assert(failed.kind === "transitioned");
          expect(failed.batch.attemptCount).toBe(attempt);
          last = failed.batch.state;
        }
        expect(last).toBe("exhausted");
        expect(created.batch.batchId).toBe(batchId); // same identity throughout

        // Exhausted batches leave the recovery scan.
        const recoverable = yield* repo.listRecoverableCompletionDispatchBatches({
          retryLimit: RETRY_LIMIT,
        });
        expect(recoverable.filter((b) => b.batchId === batchId)).toHaveLength(0);

        // Members stay `delivered` evidence, never redriven; execution evidence readable.
        const member = yield* repo.getCompletionOutboxEntry("outbox_t1_att_t1_gen1");
        assert(Option.isSome(member));
        expect(member.value.deliveryState).toBe("delivered");
      }),
  );

  it.effect(
    "immutable rejection: one genuine attempt, no repeated increments, evidence preserved",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("j1", thread);
        yield* createOutboxEntry("j1", thread);
        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        const batchId = created.batch.batchId;

        const rejected = yield* repo.rejectCompletionDispatchBatch({
          batchId,
          now: NOW,
          error: "fingerprint-matched persisted rejection: busy root rejected",
          reason: "rejected",
        });
        assert(rejected.kind === "transitioned");
        expect(rejected.batch.state).toBe("exhausted");
        expect(rejected.batch.attemptCount).toBe(1);
        expect(rejected.batch.exhaustedAt).toBe(NOW);

        // Replay of the same known rejection must not increment again.
        const replay = yield* repo.rejectCompletionDispatchBatch({
          batchId,
          now: NOW,
          error: "replayed rejection",
          reason: "rejected",
        });
        assert(replay.kind === "transitioned");
        expect(replay.batch.attemptCount).toBe(1);
        expect(replay.batch.lastError).toContain("persisted rejection");

        // Collision settles terminal under the same identity too.
        const thread2 = nextThread();
        yield* admitExecution("j2", thread2);
        yield* createOutboxEntry("j2", thread2);
        const created2 = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread2,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread2),
        });
        assert(created2.kind === "created");
        const collision = yield* repo.rejectCompletionDispatchBatch({
          batchId: created2.batch.batchId,
          now: NOW,
          error: "identity collision: same command id under different content",
          reason: "collision",
        });
        assert(collision.kind === "transitioned");
        expect(collision.batch.state).toBe("exhausted");
      }),
  );

  it.effect(
    "stale-before-submission supersedes the batch with zero parent effect and releases the slot",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        yield* admitExecution("s1", thread, 1);
        yield* createOutboxEntry("s1", thread, 1);
        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");

        const superseded = yield* repo.supersedeCompletionDispatchBatch({
          batchId: created.batch.batchId,
          now: NOW,
          supersededByReason: "member generation advanced before submission",
        });
        assert(superseded.kind === "transitioned");
        expect(superseded.batch.state).toBe("superseded");

        const active = yield* repo.getActiveCompletionDispatchBatch(thread);
        assert(Option.isNone(active));
        const member = yield* repo.getCompletionOutboxEntry("outbox_s1_att_s1_gen1");
        assert(Option.isSome(member));
        if (Option.isSome(member)) {
          expect(member.value.deliveryState).toBe("delivered");
          expect(member.value.dispatchBatchId).toBe(created.batch.batchId);
        }
      }),
  );

  it.effect(
    "stale-before-creation members are superseded inside create and excluded",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        // Admit at generation 1, then advance to generation 2 (resume).
        yield* admitExecution("g1", thread, 1);
        yield* createOutboxEntry("g1", thread, 1);
        yield* repo.recordLifecycleEvent({
          eventId: "evt_advance",
          executionId: "g1",
          attemptId: "att_g1",
          generation: 2,
          sequence: 2,
          state: "running",
          occurredAt: NOW,
        });
        yield* admitExecution("g2", thread, 1);
        yield* createOutboxEntry("g2", thread, 1);

        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        // Only the current member joins the batch (g1 is fenced superseded).
        expect(created.batch.membership).toEqual(["outbox_g2_att_g2_gen1"]);
        const fenced = yield* repo.getCompletionOutboxEntry("outbox_g1_att_g1_gen1");
        assert(Option.isSome(fenced));
        if (Option.isSome(fenced)) {
          expect(fenced.value.deliveryState).toBe("superseded");
        }
      }),
  );

  it.effect(
    "recovery scope: awaiting + within-budget retryable only; accepted awaits finalization; terminal excluded",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;

        const threadAwaiting = nextThread();
        yield* admitExecution("w1", threadAwaiting);
        yield* createOutboxEntry("w1", threadAwaiting);
        const awaiting = yield* repo.createCompletionDispatchBatch({
          parentThreadId: threadAwaiting,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, threadAwaiting),
        });
        assert(awaiting.kind === "created");

        const threadRetryable = nextThread();
        yield* admitExecution("w2", threadRetryable);
        yield* createOutboxEntry("w2", threadRetryable);
        const retryableCreate = yield* repo.createCompletionDispatchBatch({
          parentThreadId: threadRetryable,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, threadRetryable),
        });
        assert(retryableCreate.kind === "created");
        yield* repo.failCompletionDispatchBatch({
          batchId: retryableCreate.batch.batchId,
          now: NOW,
          error: "transient",
          retryLimit: RETRY_LIMIT,
        });

        const threadExhausted = nextThread();
        yield* admitExecution("w3", threadExhausted);
        yield* createOutboxEntry("w3", threadExhausted);
        const exhaustedCreate = yield* repo.createCompletionDispatchBatch({
          parentThreadId: threadExhausted,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, threadExhausted),
        });
        assert(exhaustedCreate.kind === "created");
        for (let attempt = 1; attempt <= RETRY_LIMIT; attempt += 1) {
          yield* repo.failCompletionDispatchBatch({
            batchId: exhaustedCreate.batch.batchId,
            now: NOW,
            error: "transient",
            retryLimit: RETRY_LIMIT,
          });
        }

        const recoverable = yield* repo.listRecoverableCompletionDispatchBatches({
          retryLimit: RETRY_LIMIT,
        });
        const byThread = new Set(recoverable.map((b) => b.parentThreadId));
        expect(byThread.has(threadAwaiting)).toBe(true);
        expect(byThread.has(threadRetryable)).toBe(true);
        expect(byThread.has(threadExhausted)).toBe(false);
      }),
  );

  it.effect(
    "rollback leaves pre-batch delivered evidence inert (never redriven by recovery)",
    () =>
      Effect.gen(function* () {
        const repo = yield* PiSubagentExecutionRepository;
        const thread = nextThread();
        // Legacy/rollback artifact: a `delivered` row with NO batch (old
        // pre-remediation code, or a downgraded binary).
        yield* admitExecution("legacy1", thread);
        const row = yield* repo.recordCompletionOutboxEntry({
          executionId: "legacy1",
          attemptId: "att_legacy1",
          generation: 1,
          terminalEventId: "evt_legacy1",
          parentThreadId: thread,
          terminalState: "succeeded",
          summary: "legacy",
          now: NOW,
        });
        assert(row.kind === "created");
        yield* repo.markCompletionDelivered({ outboxId: row.entry.outboxId, now: NOW });

        yield* admitExecution("legacy2", thread);
        yield* createOutboxEntry("legacy2", thread);
        const created = yield* repo.createCompletionDispatchBatch({
          parentThreadId: thread,
          maxBatchEntries: 8,
          retryLimit: RETRY_LIMIT,
          now: NOW,
          buildBatchContent: (members) => makeBatchContent(members, thread),
        });
        assert(created.kind === "created");
        // Only the fresh pending member joins; the pre-batch delivered row is
        // never selected.
        expect(created.batch.membership).not.toContain(row.entry.outboxId);
        expect(created.batch.membership).toEqual(["outbox_legacy2_att_legacy2_gen1"]);
      }),
  );
});
