import { describe, expect, it } from "vitest";
import { Duration, Effect, Stream } from "effect";

import { WHITEBOARD_OPERATION_ERROR } from "@synara/contracts";

import {
  makeWhiteboardOperationSessionService,
  type WhiteboardOperationSessionError,
  type WhiteboardOperationSessionService,
} from "./WhiteboardOperationSessionService";

const SERVER_ID = "whiteboard-test-server";

const runScoped = <A>(
  body: (
    service: WhiteboardOperationSessionService,
  ) => Effect.Effect<A, WhiteboardOperationSessionError>,
  options: Parameters<typeof makeWhiteboardOperationSessionService>[0] = {
    serverInstanceId: SERVER_ID,
  },
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const service = yield* makeWhiteboardOperationSessionService(options);
        return yield* body(service);
      }),
    ),
  );

const attachInput = (suffix = "1") => ({
  projectId: `project-${suffix}`,
  documentKind: "file-canvas" as const,
  documentId: `document-${suffix}`,
  canvasIdentity: `canvas-${suffix}`,
  expectedDocumentRevision: 0,
});

const identityOf = (attached: {
  readonly serverInstanceId: string;
  readonly operationSessionId: string;
  readonly sessionEpoch: number;
  readonly projectId: string;
  readonly documentKind: "file-canvas" | "untitled-canvas";
  readonly documentId: string;
  readonly canvasIdentity: string;
}) => ({
  serverInstanceId: attached.serverInstanceId,
  operationSessionId: attached.operationSessionId,
  sessionEpoch: attached.sessionEpoch,
  projectId: attached.projectId,
  documentKind: attached.documentKind,
  documentId: attached.documentId,
  canvasIdentity: attached.canvasIdentity,
});

const progressInput = (
  identity: ReturnType<typeof identityOf>,
  operation: { batchId: string; operationId: string; generation: number },
  producerSequence: number,
  overrides: Record<string, unknown> = {},
) => ({
  ...identity,
  batchId: operation.batchId,
  operationId: operation.operationId,
  generation: operation.generation,
  producerSequence,
  dependsOnProducerSequences:
    producerSequence === 1 ? [] : [producerSequence - 1],
  expectedBeforeRevision: producerSequence - 1,
  expectedAfterRevision: producerSequence,
  expectedSemanticFingerprint: `fingerprint-${producerSequence}`,
  mutation: {
    format: "synara.whiteboard.progress/v1" as const,
    elements: [
      {
        id: `element-${producerSequence}`,
        type: "rectangle" as const,
        x: producerSequence,
        y: producerSequence,
      },
    ],
  },
  ...overrides,
});

const acknowledgementInput = (
  identity: ReturnType<typeof identityOf>,
  progress: {
    batchId: string;
    operationId: string;
    generation: number;
    producerSequence: number;
    serverSequence: number;
  },
  applicationResult: "applied-semantic" | "applied-no-op" | "rejected",
) => ({
  ...identity,
  batchId: progress.batchId,
  operationId: progress.operationId,
  generation: progress.generation,
  producerSequence: progress.producerSequence,
  serverSequence: progress.serverSequence,
  adapterCorrelationId: `correlation-${progress.producerSequence}`,
  applicationResult,
  resultingMutationRevision: progress.producerSequence,
  verifiedSemanticFingerprint: `verified-${progress.producerSequence}`,
  ...(applicationResult === "rejected"
    ? { diagnosticCode: "semantic-verification-mismatch" as const }
    : {}),
});

const expectCode = async <A>(
  promise: Promise<A>,
  code: string,
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ code });
};

const awaitResolvedTakeOver = (
  service: WhiteboardOperationSessionService,
  input: Record<string, unknown>,
) =>
  Effect.gen(function*() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const result = yield* service.takeOver(input);
      if (result.status === "resolved") return result;
      yield* Effect.sleep(Duration.millis(1));
    }
    return yield* Effect.dieMessage("take over did not resolve within the bounded test window");
  });

describe("WhiteboardOperationSessionService", () => {
  it("fences exact authority and allows only one live session per document/canvas", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        expect(attached.serverInstanceId).toBe(SERVER_ID);
        expect(attached.sessionEpoch).toBe(1);

        const competing = Effect.runPromise(service.attachSession(attachInput()));
        yield* Effect.promise(() =>
          expectCode(competing, WHITEBOARD_OPERATION_ERROR.sessionActive),
        );

        const wrongProject = {
          ...identityOf(attached),
          projectId: "another-project",
          lastServerSequence: 0,
        };
        const rejected = Effect.runPromise(service.subscribe(wrongProject));
        yield* Effect.promise(() =>
          expectCode(rejected, WHITEBOARD_OPERATION_ERROR.identityMismatch),
        );
      }),
    );
  });

  it("fails strict decoding and skipped producer sequences closed", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        const identity = identityOf(attached);
        const operation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-strict",
        });

        const unknownKey = Effect.runPromise(
          service.publishProgress({
            ...progressInput(identity, operation, 1),
            unexpected: true,
          }),
        );
        yield* Effect.promise(() =>
          expectCode(unknownKey, WHITEBOARD_OPERATION_ERROR.identityMismatch),
        );

        const skipped = Effect.runPromise(
          service.publishProgress(progressInput(identity, operation, 2)),
        );
        yield* Effect.promise(() =>
          expectCode(
            skipped,
            WHITEBOARD_OPERATION_ERROR.producerSequenceSkipped,
          ),
        );
      }),
    );
  });

  it("makes producer and acknowledgement duplicates idempotent and conflicting evidence fail closed", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        const identity = identityOf(attached);
        const operation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-idempotency",
        });
        const progress = yield* service.publishProgress(
          progressInput(identity, operation, 1),
        );
        const duplicate = yield* service.publishProgress(
          progressInput(identity, operation, 1),
        );
        expect(duplicate).toEqual(progress);

        const conflict = Effect.runPromise(
          service.publishProgress(
            progressInput(identity, operation, 1, {
              expectedSemanticFingerprint: "different-fingerprint",
            }),
          ),
        );
        yield* Effect.promise(() =>
          expectCode(
            conflict,
            WHITEBOARD_OPERATION_ERROR.conflictingProducerInput,
          ),
        );

        const acknowledgement = acknowledgementInput(
          identity,
          progress,
          "applied-semantic",
        );
        const first = yield* service.acknowledgeApplication(acknowledgement);
        const repeated = yield* service.acknowledgeApplication(acknowledgement);
        expect(repeated).toEqual(first);
        expect(repeated.acceptedSemanticCount).toBe(1);

        const ackConflict = Effect.runPromise(
          service.acknowledgeApplication({
            ...acknowledgement,
            verifiedSemanticFingerprint: "different-verification",
          }),
        );
        yield* Effect.promise(() =>
          expectCode(ackConflict, WHITEBOARD_OPERATION_ERROR.ackConflict),
        );
      }),
    );
  });

  it("derives operation-local terminal counters and failed-partial truth for rejected browser work", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        const identity = identityOf(attached);

        const firstOperation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-terminal",
        });
        const firstProgress = yield* service.publishProgress(
          progressInput(identity, firstOperation, 1),
        );
        yield* service.acknowledgeApplication(
          acknowledgementInput(identity, firstProgress, "applied-semantic"),
        );
        const firstTerminal = yield* service.completeOperation({
          ...identity,
          batchId: firstOperation.batchId,
          operationId: firstOperation.operationId,
          generation: firstOperation.generation,
        });
        expect(firstTerminal.outcome).toBe("completed");
        expect(firstTerminal.acceptedSemanticCount).toBe(1);

        const secondOperation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-terminal",
        });
        const secondProgress = yield* service.publishProgress(
          progressInput(identity, secondOperation, 1),
        );
        yield* service.acknowledgeApplication(
          acknowledgementInput(identity, secondProgress, "applied-semantic"),
        );
        const rejectedProgress = yield* service.publishProgress(
          progressInput(identity, secondOperation, 2),
        );
        yield* service.acknowledgeApplication(
          acknowledgementInput(identity, rejectedProgress, "rejected"),
        );
        const secondTerminal = yield* service.completeOperation({
          ...identity,
          batchId: secondOperation.batchId,
          operationId: secondOperation.operationId,
          generation: secondOperation.generation,
        });
        expect(secondTerminal).toMatchObject({
          outcome: "failed-partial",
          terminalReason: "browser-application-failed",
          acceptedSemanticCount: 1,
          rejectedCount: 1,
        });
      }),
    );
  });

  it.each([
    ["acknowledged", "acknowledged"],
    ["containment-failed", "containment-failed"],
    ["dispatch-failed", "dispatch-failed"],
  ] as const)("records %s containment once after advancing generation", async (_name, outcome) => {
    let dispatchCount = 0;
    let observedGeneration = 0;
    await runScoped(
      (service) =>
        Effect.gen(function*() {
          const attached = yield* service.attachSession(attachInput(outcome));
          const identity = identityOf(attached);
          const operation = yield* service.admitOperation({
            ...identity,
            batchId: `batch-${outcome}`,
          });
          const input = {
            ...identity,
            batchId: operation.batchId,
            operationId: operation.operationId,
            expectedGeneration: operation.generation,
            takeOverRequestId: `take-over-${outcome}`,
          };
          const pending = yield* service.takeOver(input);
          expect(pending.generation).toBe(operation.generation + 1);
          const resolved = yield* awaitResolvedTakeOver(service, input);
          expect(resolved).toMatchObject({
            status: "resolved",
            containmentResult: outcome,
          });
          const repeated = yield* service.takeOver(input);
          expect(repeated).toEqual(resolved);
          expect(dispatchCount).toBe(1);
          expect(observedGeneration).toBe(operation.generation + 1);

          const retry = Effect.runPromise(
            service.retry({
              ...identity,
              batchId: operation.batchId,
              failedOperationId: operation.operationId,
              failedGeneration: operation.generation,
              failedRetryAttempt: 0,
            }),
          );
          yield* Effect.promise(() =>
            expectCode(
              retry,
              WHITEBOARD_OPERATION_ERROR.operationNotRetryable,
            ),
          );
        }),
      {
        serverInstanceId: SERVER_ID,
        containmentDeadline: Duration.millis(20),
        containmentDispatcher: async (request) => {
          dispatchCount += 1;
          observedGeneration = request.generation;
          return outcome;
        },
      },
    );
  });

  it("does not complete with unacknowledged progress and preserves exact terminal/conflict codes", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput("fences"));
        const identity = identityOf(attached);
        const operation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-fences",
        });
        const first = yield* service.publishProgress(
          progressInput(identity, operation, 1),
        );
        const second = yield* service.publishProgress(
          progressInput(identity, operation, 2),
        );
        yield* service.acknowledgeApplication(
          acknowledgementInput(identity, first, "applied-semantic"),
        );

        const incomplete = Effect.runPromise(
          service.completeOperation({
            ...identity,
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
          }),
        );
        yield* Effect.promise(() =>
          expectCode(
            incomplete,
            WHITEBOARD_OPERATION_ERROR.semanticVerificationFailed,
          ),
        );

        const wrongServerSequence = Effect.runPromise(
          service.acknowledgeApplication({
            ...acknowledgementInput(identity, first, "applied-semantic"),
            serverSequence: second.serverSequence,
          }),
        );
        yield* Effect.promise(() =>
          expectCode(wrongServerSequence, WHITEBOARD_OPERATION_ERROR.ackConflict),
        );

        yield* service.acknowledgeApplication(
          acknowledgementInput(identity, second, "applied-semantic"),
        );
        yield* service.completeOperation({
          ...identity,
          batchId: operation.batchId,
          operationId: operation.operationId,
          generation: operation.generation,
        });
        const postTerminal = Effect.runPromise(
          service.publishProgress(progressInput(identity, operation, 3)),
        );
        yield* Effect.promise(() =>
          expectCode(postTerminal, WHITEBOARD_OPERATION_ERROR.operationTerminal),
        );
      }),
    );
  });

  it("scopes an acknowledged Take Over fence to one lineage and permits later operations", async () => {
    await runScoped(
      (service) =>
        Effect.gen(function*() {
          const attached = yield* service.attachSession(attachInput("lineage"));
          const identity = identityOf(attached);
          const operation = yield* service.admitOperation({
            ...identity,
            batchId: "batch-lineage",
          });
          const progress = yield* service.publishProgress(
            progressInput(identity, operation, 1),
          );
          const acknowledgement = acknowledgementInput(
            identity,
            progress,
            "applied-semantic",
          );
          yield* service.acknowledgeApplication(acknowledgement);
          const takeOverInput = {
            ...identity,
            batchId: operation.batchId,
            operationId: operation.operationId,
            expectedGeneration: operation.generation,
            takeOverRequestId: "take-over-lineage",
          };
          const resolved = yield* awaitResolvedTakeOver(service, takeOverInput);
          expect(resolved.containmentResult).toBe("acknowledged");

          const staleAck = Effect.runPromise(
            service.acknowledgeApplication(acknowledgement),
          );
          yield* Effect.promise(() =>
            expectCode(staleAck, WHITEBOARD_OPERATION_ERROR.ackStale),
          );

          const nextOperation = yield* service.admitOperation({
            ...identity,
            batchId: "batch-next",
          });
          const nextProgress = yield* service.publishProgress(
            progressInput(identity, nextOperation, 1),
          );
          yield* service.acknowledgeApplication(
            acknowledgementInput(identity, nextProgress, "applied-semantic"),
          );
          const nextTerminal = yield* service.completeOperation({
            ...identity,
            batchId: nextOperation.batchId,
            operationId: nextOperation.operationId,
            generation: nextOperation.generation,
          });
          expect(nextTerminal.outcome).toBe("completed");
        }),
      {
        serverInstanceId: SERVER_ID,
        containmentDispatcher: async () => "acknowledged",
      },
    );
  });

  it("records an Effect-clock acknowledgement timeout without synthesizing terminal truth", async () => {
    await runScoped(
      (service) =>
        Effect.gen(function*() {
          const attached = yield* service.attachSession(attachInput("timeout"));
          const identity = identityOf(attached);
          const operation = yield* service.admitOperation({
            ...identity,
            batchId: "batch-timeout",
          });
          const input = {
            ...identity,
            batchId: operation.batchId,
            operationId: operation.operationId,
            expectedGeneration: operation.generation,
            takeOverRequestId: "take-over-timeout",
          };
          yield* service.takeOver(input);
          const resolved = yield* awaitResolvedTakeOver(service, input);
          expect(resolved).toMatchObject({
            status: "resolved",
            containmentResult: "ack-timeout",
          });

          const release = Effect.runPromise(service.releaseSession(identity));
          yield* Effect.promise(() =>
            expectCode(release, WHITEBOARD_OPERATION_ERROR.sessionActive),
          );
        }),
      {
        serverInstanceId: SERVER_ID,
        containmentDeadline: Duration.millis(2),
        containmentDispatcher: () => new Promise(() => {}),
      },
    );
  });

  it("returns the recorded release result while its tombstone is retained", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        const identity = identityOf(attached);
        const released = yield* service.releaseSession(identity);
        const repeated = yield* service.releaseSession(identity);
        expect(repeated).toEqual(released);

        const subscribe = Effect.runPromise(
          service.subscribe({ ...identity, lastServerSequence: 0 }),
        );
        yield* Effect.promise(() =>
          expectCode(subscribe, WHITEBOARD_OPERATION_ERROR.sessionReleased),
        );
      }),
    );
  });

  it("emits snapshot first followed by ordered retained events", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput());
        const identity = identityOf(attached);
        const operation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-replay",
        });
        const progress = yield* service.publishProgress(
          progressInput(identity, operation, 1),
        );
        const stream = yield* service.subscribe({
          ...identity,
          lastServerSequence: 0,
        });
        const collected = yield* Stream.runCollect(Stream.take(stream, 3));
        const events = Array.from(collected);
        expect(events.map((event) => event.kind)).toEqual([
          "session-snapshot",
          "session-snapshot",
          "operation-admitted",
        ]);
        expect(events[0]?.serverSequence).toBe(progress.serverSequence);
        expect(events[1]?.serverSequence).toBe(1);
        expect(events[2]?.serverSequence).toBe(operation.serverSequence);
      }),
    );
  });

  it("keeps composite authority identities collision-free", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const first = yield* service.attachSession({
          projectId: "project-delimiter",
          documentKind: "file-canvas",
          documentId: "d|c",
          canvasIdentity: "x",
          expectedDocumentRevision: 0,
        });
        const second = yield* service.attachSession({
          projectId: "project-delimiter",
          documentKind: "file-canvas",
          documentId: "d",
          canvasIdentity: "c|x",
          expectedDocumentRevision: 0,
        });
        expect(first.operationSessionId).not.toBe(second.operationSessionId);
      }),
    );
  });

  it("delivers snapshot plus the maximum retained replay without consuming live queue capacity", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const attached = yield* service.attachSession(attachInput("max-replay"));
        const identity = identityOf(attached);
        const operation = yield* service.admitOperation({
          ...identity,
          batchId: "batch-max-replay",
        });
        for (let sequence = 1; sequence <= 254; sequence += 1) {
          yield* service.publishProgress(
            progressInput(identity, operation, sequence),
          );
        }
        const stream = yield* service.subscribe({
          ...identity,
          lastServerSequence: 0,
        });
        const collected = yield* Stream.runCollect(Stream.take(stream, 257));
        const events = Array.from(collected);
        expect(events).toHaveLength(257);
        expect(events[0]?.kind).toBe("session-snapshot");
        expect(events.at(-1)?.serverSequence).toBe(256);
      }),
    );
  });

  it("enforces live-session and per-session subscriber limits", async () => {
    await runScoped((service) =>
      Effect.gen(function*() {
        const sessions = [];
        for (let index = 0; index < 128; index += 1) {
          sessions.push(
            yield* service.attachSession(attachInput(`cap-${index}`)),
          );
        }
        const replacement = yield* service.attachSession(attachInput("cap-new"));
        expect(replacement.operationSessionId).toBeTruthy();

        const firstIdentity = identityOf(sessions[0]);
        const evicted = Effect.runPromise(
          service.subscribe({ ...firstIdentity, lastServerSequence: 0 }),
        );
        yield* Effect.promise(() =>
          expectCode(evicted, WHITEBOARD_OPERATION_ERROR.sessionUnknown),
        );

        const liveIdentity = identityOf(sessions[1]);
        for (let index = 0; index < 8; index += 1) {
          yield* service.subscribe({ ...liveIdentity, lastServerSequence: 1 });
        }
        const ninth = Effect.runPromise(
          service.subscribe({ ...liveIdentity, lastServerSequence: 1 }),
        );
        yield* Effect.promise(() =>
          expectCode(ninth, WHITEBOARD_OPERATION_ERROR.sessionActive),
        );
      }),
    );
  });
});
