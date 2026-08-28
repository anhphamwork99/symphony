/**
 * Whiteboard operation-session authority (Ticket 02) — production service.
 *
 * Binding mechanics: Decision 0065 (D1–D8) at
 * `.planning/synara-whiteboard/decisions/0065-ticket-02-server-authority-websocket-seam.md`;
 * package semantics: Decision 0063; wire shapes:
 * `packages/contracts/src/whiteboardOperation.ts`.
 *
 * Ephemeral, in-memory, server-authoritative operation-session state machine:
 * - strict schema decoding on every entry point; unknown keys fail decoding
 *   and are never stripped (D8);
 * - fixed caps with canonical encoded byte accounting, quiescent-LRU
 *   eviction, released tombstones, and fail-closed lost/reset semantics (D3);
 * - one live authority per exact (projectId, documentKind, documentId,
 *   canvasIdentity) (D3);
 * - protected active/lost state; protected records are never evicted,
 *   truncated, or converted into success (D3);
 * - contiguous producer sequence admission with dependencies, canonical
 *   duplicate equivalence, and conflicting-duplicate failure (D8);
 * - four-field acknowledgement fencing with exactly-once counters (D4);
 * - Take Over: atomic validation, generation advancement before dispatch,
 *   non-retryable lineage, one pending event, exactly one scoped dispatcher
 *   fiber raced against the Effect-clock deadline, exactly one containment
 *   outcome, idempotent repeats (D2);
 * - custom snapshot-first bounded replay/live streams with gap
 *   reset/lost semantics and lossless subscriber queues (D5);
 * - exactly one schema-valid terminal derivation and release/tombstones.
 *
 * All state-machine transitions are serialized through one service-owned
 * Effect semaphore (the "one synchronization seam"). The service is scoped:
 * creating it requires a Scope; scope closure interrupts outstanding
 * dispatcher/deadline fibers and ends every subscriber stream without
 * manufacturing containment or terminal truth. There is no persistence, no
 * diagnostics, no configuration or environment surface, no wall-clock reads,
 * no native timers, and no test-only API or cap override.
 */

import {
  Cause,
  Data,
  Duration,
  Effect,
  Queue,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import type { Scope } from "effect";

import {
  WHITEBOARD_OPERATION_ERROR,
  WhiteboardAcknowledgeApplicationInput,
  WhiteboardAdmitOperationInput,
  WhiteboardCompleteOperationInput,
  WhiteboardFailOperationInput,
  WhiteboardOperationAttachSessionInput,
  WhiteboardOperationReleaseSessionInput,
  WhiteboardOperationRetryInput,
  WhiteboardOperationSubscribeInput,
  WhiteboardOperationTakeOverInput,
  WhiteboardPublishProgressInput,
} from "@synara/contracts";
import type {
  WhiteboardAcknowledgeApplicationResult,
  WhiteboardContainmentResult,
  WhiteboardOperationAdmittedEvent,
  WhiteboardOperationAttachSessionResult,
  WhiteboardOperationErrorCode,
  WhiteboardOperationProgressEvent,
  WhiteboardOperationReleaseSessionResult,
  WhiteboardOperationRetryResult,
  WhiteboardOperationSessionEvent,
  WhiteboardOperationSessionIdentity,
  WhiteboardOperationTakeOverResult,
  WhiteboardOperationTerminalEvent,
  WhiteboardOperationTerminalRecord,
} from "@synara/contracts";

/** Fixed in-memory safety bounds. No configuration or environment surface (D3). */
export const WHITEBOARD_OPERATION_SESSION_LIMITS = {
  maxLiveOperationSessions: 128,
  maxReleasedSessionTombstones: 128,
  maxReplayEventsPerSession: 256,
  maxLiveSubscribersPerSession: 8,
  maxLiveSubscribersTotal: 256,
  liveSubscriberQueueCapacity: 256,
  maxReplayBytesPerSession: 16 * 1024 * 1024,
  maxReplayBytesTotal: 128 * 1024 * 1024,
} as const;

/** Production containment deadline is exactly 2_000 ms (D2). */
export const WHITEBOARD_CONTAINMENT_DEADLINE_MS = 2_000;

/** Typed operation-session error. Its code is a WhiteboardOperationErrorCode (D7). */
export class WhiteboardOperationSessionError extends Data.TaggedError(
  "WhiteboardOperationSessionError",
)<{
  readonly code: WhiteboardOperationErrorCode;
  /** Bounded, actionable message. Never contains raw payloads or private state. */
  readonly message: string;
}> {}

/**
 * Server-owned containment dispatcher injected at construction (D2). The
 * dispatcher reports the authoritative containment outcome; throwing or
 * rejecting maps to `dispatch-failed`. Dispatch is never containment
 * acknowledgement.
 */
export type WhiteboardContainmentDispatcher = (request: {
  readonly identity: WhiteboardOperationSessionIdentity;
  readonly batchId: string;
  readonly operationId: string;
  readonly generation: number;
  readonly takeOverRequestId: string;
  readonly requestedGeneration: number;
}) => Promise<WhiteboardContainmentResult>;

export interface WhiteboardOperationSessionService {
  /** Browser-facing (D6 unary): open one session for a document/canvas identity. */
  readonly attachSession: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationAttachSessionResult,
    WhiteboardOperationSessionError
  >;
  /** Browser-facing (D6 stream): snapshot-first bounded replay/live stream. */
  readonly subscribe: (
    input: unknown,
  ) => Effect.Effect<
    Stream.Stream<WhiteboardOperationSessionEvent>,
    WhiteboardOperationSessionError
  >;
  /** Browser-facing (D6 unary): four-field-fenced acknowledgement admission. */
  readonly acknowledgeApplication: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardAcknowledgeApplicationResult,
    WhiteboardOperationSessionError
  >;
  /** Browser-facing (D6 unary): idempotent Take Over with generation fencing. */
  readonly takeOver: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationTakeOverResult,
    WhiteboardOperationSessionError
  >;
  /** Browser-facing (D6 unary): retry lineage creation with idempotent repeats. */
  readonly retry: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationRetryResult,
    WhiteboardOperationSessionError
  >;
  /** Browser-facing (D6 unary): release a quiescent session into a tombstone. */
  readonly releaseSession: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationReleaseSessionResult,
    WhiteboardOperationSessionError
  >;
  /** Internal producer authority (never browser-callable, Decision 0063 §2). */
  readonly admitOperation: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationAdmittedEvent,
    WhiteboardOperationSessionError
  >;
  /** Internal producer authority (never browser-callable). */
  readonly publishProgress: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationProgressEvent,
    WhiteboardOperationSessionError
  >;
  /** Internal producer authority (never browser-callable). */
  readonly completeOperation: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationTerminalEvent,
    WhiteboardOperationSessionError
  >;
  /** Internal producer authority (never browser-callable). */
  readonly failOperation: (
    input: unknown,
  ) => Effect.Effect<
    WhiteboardOperationTerminalEvent,
    WhiteboardOperationSessionError
  >;
}

/**
 * Creates the scoped, in-memory operation-session authority. Requires a Scope
 * so shutdown can interrupt containment fibers and end subscriber streams.
 */
export const makeWhiteboardOperationSessionService = (options: {
  /** Process-authoritative negotiated identity supplied by wsRpc.ts (D2). */
  readonly serverInstanceId: string;
  /** Optional dispatcher; default fails closed as dispatch unavailable (D2). */
  readonly containmentDispatcher?: WhiteboardContainmentDispatcher | undefined;
  /** Optional Effect-native deadline; default is exactly 2_000 ms (D2). */
  readonly containmentDeadline?: Duration.Input | undefined;
}): Effect.Effect<
  WhiteboardOperationSessionService,
  never,
  Scope.Scope
> =>
  Effect.gen(function*() {
    const serverInstanceId = options.serverInstanceId;
    const dispatcher: WhiteboardContainmentDispatcher =
      options.containmentDispatcher ??
      (() => Promise.resolve<WhiteboardContainmentResult>("dispatch-failed"));
    const deadline: Duration.Input =
      options.containmentDeadline ?? Duration.millis(WHITEBOARD_CONTAINMENT_DEADLINE_MS);

    const limits = WHITEBOARD_OPERATION_SESSION_LIMITS;

    const fail = (
      code: WhiteboardOperationErrorCode,
      message: string,
    ): Effect.Effect<never, WhiteboardOperationSessionError> =>
      Effect.fail(new WhiteboardOperationSessionError({ code, message }));

    // ------------------------------------------------------------------
    // Internal state model (all mutation happens only under `withLock`).
    // ------------------------------------------------------------------

    interface RowEntry {
      readonly serverSequence: number;
      readonly event: WhiteboardOperationSessionEvent;
      bytes: number;
    }

    interface AcknowledgementSummary {
      acceptedSemanticCount: number;
      acceptedNoOpCount: number;
      rejectedCount: number;
      lastAcceptedProducerSequence: number;
    }

    const emptyAcknowledgementSummary = (): AcknowledgementSummary => ({
      acceptedSemanticCount: 0,
      acceptedNoOpCount: 0,
      rejectedCount: 0,
      lastAcceptedProducerSequence: 0,
    });

    interface OperationRecord {
      readonly batchId: string;
      readonly operationId: string;
      generation: number;
      readonly expectedDocumentRevision: number;
      readonly retryAttempt: number;
      readonly retryOfOperationId: string | undefined;
      readonly retryOfGeneration: number | undefined;
      readonly retryOfAttempt: number | undefined;
      readonly admittedServerSequence: number;
      lastProducerSequence: number;
      /** producerSequence -> canonical input encoding + assigned serverSequence. */
      readonly producerSequences: Map<
        number,
        { readonly canonical: string; readonly serverSequence: number }
      >;
      readonly acknowledgementSummary: AcknowledgementSummary;
      terminal: WhiteboardOperationTerminalRecord | undefined;
    }

    interface TakeOverRecord {
      readonly canonicalRequest: string;
      readonly takeOverRequestId: string;
      readonly batchId: string;
      readonly operationId: string;
      readonly generation: number;
      readonly requestedGeneration: number;
      status: "pending" | "resolved";
      containmentResult: WhiteboardContainmentResult | undefined;
    }

    interface SubscriberEntry {
      readonly id: number;
      readonly queue: Queue.Queue<
        WhiteboardOperationSessionEvent,
        Cause.Done<void>
      >;
    }

    interface SessionRecord {
      readonly identity: WhiteboardOperationSessionIdentity;
      order: number;
      documentRevision: number;
      rows: Array<RowEntry>;
      lastServerSequence: number;
      readonly acknowledgementSummary: AcknowledgementSummary;
      readonly operations: Map<string, OperationRecord>;
      activeOperationKey: string | undefined;
      latestTerminal: WhiteboardOperationTerminalRecord | undefined;
      takeOver: TakeOverRecord | undefined;
      lineageNonRetryable: boolean;
      lost: boolean;
      readonly subscribers: Map<number, SubscriberEntry>;
      nextSubscriberId: number;
      retainedBytes: number;
      /** (batchId, failedOperationId, failedGeneration, failedRetryAttempt) -> record */
      readonly retries: Map<
        string,
        { readonly canonical: string; readonly result: WhiteboardOperationRetryResult }
      >;
      /** (operationId, generation, producerSequence, serverSequence) -> record */
      readonly acks: Map<
        string,
        {
          readonly canonical: string;
          readonly result: WhiteboardAcknowledgeApplicationResult;
        }
      >;
      /** serverSequence -> admitted progress row (for acknowledgement fencing). */
      readonly progressByServerSequence: Map<
        number,
        {
          readonly row: RowEntry;
          readonly operationKey: string;
          readonly batchId: string;
          readonly producerSequence: number;
          readonly canonicalInput: string;
        }
      >;
    }

    interface Tombstone {
      readonly identity: WhiteboardOperationSessionIdentity;
      readonly result: WhiteboardOperationReleaseSessionResult;
    }

    interface ServiceState {
      readonly sessions: Map<string, SessionRecord>;
      readonly authority: Map<string, string>;
      readonly tombstones: Array<Tombstone>;
      orderCounter: number;
      subscriberTotal: number;
      retainedBytesTotal: number;
      closed: boolean;
    }

    const stateRef = yield* Ref.make<ServiceState>({
      sessions: new Map(),
      authority: new Map(),
      tombstones: [],
      orderCounter: 0,
      subscriberTotal: 0,
      retainedBytesTotal: 0,
      closed: false,
    });

    // One synchronization seam: every transition below runs through this
    // single-permit semaphore, so state mutation between get/set is atomic
    // with respect to every other transition (Decision 0065 atomicity).
    const semaphore = Semaphore.makeUnsafe(1);
    const withLock = <A, E, R>(
      self: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R> => semaphore.withPermits(1)(self);

    const scope = yield* Effect.scope;
    yield* Effect.addFinalizer(() =>
      Effect.gen(function*() {
        // Shutdown (D2.10 / D5.11): end subscriber streams and let scope
        // closure interrupt outstanding dispatcher/deadline fibers. No
        // containment result, terminal event, or unlock claim is manufactured.
        const state = yield* Ref.get(stateRef);
        state.closed = true;
        for (const session of state.sessions.values()) {
          for (const subscriber of session.subscribers.values()) {
            yield* Queue.end(subscriber.queue);
          }
        }
      }),
    );

    // ------------------------------------------------------------------
    // Pure helpers (Decision 0065 D3/D5/D8).
    // ------------------------------------------------------------------

    const newOpaqueId = (): string => crypto.randomUUID();

    const authorityKeyOf = (
      identity: Pick<
        WhiteboardOperationSessionIdentity,
        "projectId" | "documentKind" | "documentId" | "canvasIdentity"
      >,
    ): string =>
      `${identity.projectId}|${identity.documentKind}|${identity.documentId}|${identity.canvasIdentity}`;

    const operationKeyOf = (operationId: string, generation: number): string =>
      `${operationId}@${generation}`;

    const ackKeyOf = (
      operationId: string,
      generation: number,
      producerSequence: number,
      serverSequence: number,
    ): string => `${operationId}@${generation}@${producerSequence}@${serverSequence}`;

    const retryTupleKeyOf = (
      batchId: string,
      failedOperationId: string,
      failedGeneration: number,
      failedRetryAttempt: number,
    ): string => `${batchId}@${failedOperationId}@${failedGeneration}@${failedRetryAttempt}`;

    /**
     * Deterministic canonical encoding of schema-decoded values (D8):
     * object keys sorted, absent optional fields and undefined normalized to
     * one representation, negative zero normalized to zero, array order
     * preserved except `dependsOnProducerSequences` which is sorted ascending
     * (duplicate-free set semantics). Comparing encodings is therefore
     * structural comparison of immutable canonical values.
     */
    const canonicalJson = (value: unknown): string => {
      if (value === undefined || value === null) return "null";
      switch (typeof value) {
        case "number":
          return Number.isInteger(value)
            ? String(value === 0 ? 0 : value)
            : JSON.stringify(value);
        case "string":
        case "boolean":
          return JSON.stringify(value);
      }
      if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: Array<string> = [];
      for (const key of keys) {
        const item = record[key];
        if (item === undefined) continue;
        const encoded =
          key === "dependsOnProducerSequences" && Array.isArray(item)
            ? `[${[...item]
                .map((entry) => canonicalJson(entry))
                .sort((a, b) => Number(a) - Number(b))
                .join(",")}]`
            : canonicalJson(item);
        parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
      return `{${parts.join(",")}}`;
    };

    const encoder = new TextEncoder();
    /** Canonical encoded size of a retained stream event for byte accounting (D3). */
    const byteLengthOf = (event: WhiteboardOperationSessionEvent): number => {
      const record = event as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: Array<string> = [];
      for (const key of keys) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
      }
      return encoder.encode(`{${parts.join(",")}}`).length;
    };

    /** Strict decoding of every entry point; unknown keys fail decoding (D8). */
    const decode = <
      S extends Schema.Top & { readonly DecodingServices: never },
    >(
      schema: S,
      input: unknown,
    ): Effect.Effect<S["Type"], WhiteboardOperationSessionError> =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(input),
        catch: () =>
          new WhiteboardOperationSessionError({
            code: WHITEBOARD_OPERATION_ERROR.identityMismatch,
            message: "request failed strict schema decoding",
          }),
      });

    /**
     * D4/D6 admission order: complete session/document identity and server
     * authority are validated before anything else is inspected.
     */
    const classifySession = (
      state: ServiceState,
      decoded: {
        readonly serverInstanceId: string;
        readonly operationSessionId: string;
        readonly sessionEpoch: number;
        readonly projectId: string;
        readonly documentKind: string;
        readonly documentId: string;
        readonly canvasIdentity: string;
      },
    ): Effect.Effect<SessionRecord, WhiteboardOperationSessionError> =>
      Effect.gen(function*() {
        if (state.closed) {
          return yield* fail(
            WHITEBOARD_OPERATION_ERROR.sessionUnknown,
            "operation-session authority is no longer available",
          );
        }
        if (decoded.serverInstanceId !== serverInstanceId) {
          return yield* fail(
            WHITEBOARD_OPERATION_ERROR.authorityChanged,
            "session authority belongs to a different server instance",
          );
        }
        const session = state.sessions.get(decoded.operationSessionId);
        if (session === undefined) {
          const tombstoned = state.tombstones.some(
            (entry) => entry.identity.operationSessionId === decoded.operationSessionId,
          );
          if (tombstoned) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionReleased,
              "operation session was released",
            );
          }
          return yield* fail(
            WHITEBOARD_OPERATION_ERROR.sessionUnknown,
            "operation session is unknown",
          );
        }
        if (
          decoded.projectId !== session.identity.projectId ||
          decoded.documentKind !== session.identity.documentKind ||
          decoded.documentId !== session.identity.documentId ||
          decoded.canvasIdentity !== session.identity.canvasIdentity
        ) {
          return yield* fail(
            WHITEBOARD_OPERATION_ERROR.identityMismatch,
            "session identity does not match the live operation session",
          );
        }
        if (decoded.sessionEpoch !== session.identity.sessionEpoch) {
          return yield* fail(
            WHITEBOARD_OPERATION_ERROR.sessionEpochStale,
            "session epoch is stale; resubscribe with the current epoch",
          );
        }
        // LRU touch on every successful classification (D3).
        session.order = ++state.orderCounter;
        return session;
      });

    const identityOf = (session: SessionRecord): WhiteboardOperationSessionIdentity =>
      session.identity;

    const isSessionQuiescent = (session: SessionRecord): boolean =>
      !session.lost &&
      session.activeOperationKey === undefined &&
      session.takeOver === undefined &&
      session.subscribers.size === 0;

    /**
     * D3 safe compaction: only quiescent, non-subscribed history may compact
     * to the baseline row, the latest terminal row, and the immediate retry
     * predecessor row. Active or Take-Over-pending state is never compacted.
     */
    const compactSession = (
      state: ServiceState,
      session: SessionRecord,
    ): void => {
      if (!isSessionQuiescent(session)) return;
      const baseline = session.rows[0];
      if (baseline === undefined) return;
      const retained = new Map<number, RowEntry>([[baseline.serverSequence, baseline]]);
      const latestTerminalRow = [...session.rows]
        .reverse()
        .find((row) => row.event.kind === "operation-terminal");
      if (latestTerminalRow !== undefined) {
        retained.set(latestTerminalRow.serverSequence, latestTerminalRow);
      }
      const activeOrLatestTerminal = latestTerminalRow?.event;
      if (
        activeOrLatestTerminal !== undefined &&
        activeOrLatestTerminal.kind === "operation-terminal"
      ) {
        const predecessorKey = operationKeyOf(
          activeOrLatestTerminal.operationId,
          activeOrLatestTerminal.generation,
        );
        const predecessor = session.operations.get(predecessorKey);
        if (
          predecessor?.retryOfOperationId !== undefined &&
          predecessor.retryOfGeneration !== undefined
        ) {
          const predecessorRow = [...session.rows]
            .reverse()
            .find(
              (row) =>
                row.event.kind === "operation-terminal" &&
                row.event.operationId === predecessor.retryOfOperationId &&
                row.event.generation === predecessor.retryOfGeneration,
            );
          if (predecessorRow !== undefined) {
            retained.set(predecessorRow.serverSequence, predecessorRow);
          }
        }
      }
      session.rows = [...retained.values()].sort(
        (a, b) => a.serverSequence - b.serverSequence,
      );
      session.progressByServerSequence.clear();
      let bytes = 0;
      for (const row of session.rows) {
        bytes += row.bytes;
        if (row.event.kind === "operation-progress") {
          session.progressByServerSequence.set(row.serverSequence, {
            row,
            operationKey: operationKeyOf(row.event.operationId, row.event.generation),
            batchId: row.event.batchId,
            producerSequence: row.event.producerSequence,
            canonicalInput: "",
          });
        }
      }
      // Compaction drops duplicate payload accounting only; canonical input
      // strings of retained rows remain usable because retained rows are the
      // ones whose canonical inputs were kept in producerSequences maps.
      const removedBytes = session.retainedBytes - bytes;
      session.retainedBytes = bytes;
      state.retainedBytesTotal -= removedBytes;
    };

    const terminateSubscriber = (
      state: ServiceState,
      session: SessionRecord,
      subscriber: SubscriberEntry,
    ): Effect.Effect<void> =>
      Effect.gen(function*() {
        if (session.subscribers.delete(subscriber.id)) {
          state.subscriberTotal -= 1;
        }
        // Lossless policy: exhaustion ends only this subscription (D3).
        yield* Queue.end(subscriber.queue);
      });

    const offerOrTerminate = (
      state: ServiceState,
      session: SessionRecord,
      subscriber: SubscriberEntry,
      event: WhiteboardOperationSessionEvent,
    ): Effect.Effect<void> =>
      Effect.gen(function*() {
        const size = yield* Queue.size(subscriber.queue);
        if (size >= limits.liveSubscriberQueueCapacity) {
          yield* terminateSubscriber(state, session, subscriber);
          return;
        }
        const offered = yield* Queue.offer(subscriber.queue, event);
        if (!offered) {
          yield* terminateSubscriber(state, session, subscriber);
        }
      });

    /**
     * Retain an event row and push it to every live subscriber. Returns null
     * when a replay cap would be exceeded and safe compaction cannot make
     * room; the caller then fails the triggering transition (D3).
     */
    const pushEvent = (
      state: ServiceState,
      session: SessionRecord,
      event: WhiteboardOperationSessionEvent,
    ): Effect.Effect<boolean> =>
      Effect.gen(function*() {
        const bytes = byteLengthOf(event);
        const totalBytes = state.retainedBytesTotal + bytes;
        const exceeds =
          session.rows.length + 1 > limits.maxReplayEventsPerSession ||
          bytes > limits.maxReplayBytesPerSession - session.retainedBytes + bytes ||
          session.retainedBytes + bytes > limits.maxReplayBytesPerSession ||
          totalBytes > limits.maxReplayBytesTotal;
        if (exceeds) {
          compactSession(state, session);
          if (
            session.rows.length + 1 > limits.maxReplayEventsPerSession ||
            session.retainedBytes + bytes > limits.maxReplayBytesPerSession ||
            state.retainedBytesTotal + bytes > limits.maxReplayBytesTotal
          ) {
            return false;
          }
        }
        const serverSequence = ++session.lastServerSequence;
        const row: RowEntry = {
          serverSequence: (event as { serverSequence: number }).serverSequence,
          event,
          bytes,
        };
        void serverSequence;
        session.rows.push(row);
        session.retainedBytes += bytes;
        state.retainedBytesTotal += bytes;
        if (event.kind === "operation-progress") {
          session.progressByServerSequence.set(row.serverSequence, {
            row,
            operationKey: operationKeyOf(event.operationId, event.generation),
            batchId: event.batchId,
            producerSequence: event.producerSequence,
            canonicalInput: "",
          });
        }
        for (const subscriber of [...session.subscribers.values()]) {
          yield* offerOrTerminate(state, session, subscriber, event);
        }
        return true;
      });

    /** D3 lost-state entry: reject transition, fence, protect, no false truth. */
    const enterLostState = (
      state: ServiceState,
      session: SessionRecord,
    ): Effect.Effect<never, WhiteboardOperationSessionError> =>
      Effect.gen(function*() {
        session.lost = true;
        session.lineageNonRetryable = true;
        return yield* fail(
          WHITEBOARD_OPERATION_ERROR.sessionLost,
          "operation session entered a protected lost state",
        );
      });

    const buildSnapshotEvent = (
      session: SessionRecord,
    ): WhiteboardOperationSessionEvent => {
      const identity = identityOf(session);
      const activeKey = session.activeOperationKey;
      const activeOperation = activeKey === undefined
        ? undefined
        : session.operations.get(activeKey);
      const takeOver = session.takeOver;
      const snapshot: WhiteboardOperationSessionEvent = {
        kind: "session-snapshot",
        ...identity,
        serverSequence: session.lastServerSequence,
        documentRevision: session.documentRevision,
        ...(activeOperation === undefined
          ? {}
          : {
              activeOperation: {
                batchId: activeOperation.batchId,
                operationId: activeOperation.operationId,
                generation: activeOperation.generation,
                expectedDocumentRevision: activeOperation.expectedDocumentRevision,
                retryAttempt: activeOperation.retryAttempt,
                ...(activeOperation.retryOfOperationId === undefined
                  ? {}
                  : { retryOfOperationId: activeOperation.retryOfOperationId }),
                ...(activeOperation.retryOfGeneration === undefined
                  ? {}
                  : { retryOfGeneration: activeOperation.retryOfGeneration }),
                ...(activeOperation.retryOfAttempt === undefined
                  ? {}
                  : { retryOfAttempt: activeOperation.retryOfAttempt }),
              },
            }),
        ...(takeOver === undefined
          ? {}
          : {
              takeOver: {
                batchId: takeOver.batchId,
                operationId: takeOver.operationId,
                generation: takeOver.generation,
                takeOverRequestId: takeOver.takeOverRequestId,
                requestedGeneration: takeOver.requestedGeneration,
                status: takeOver.status,
                ...(takeOver.containmentResult === undefined
                  ? {}
                  : { containmentResult: takeOver.containmentResult }),
              },
            }),
        acknowledgementSummary: { ...session.acknowledgementSummary },
        ...(session.latestTerminal === undefined ? {} : { terminal: session.latestTerminal }),
      };
      return snapshot;
    };

    /** D3/Decision-0063 §7 exactly-one terminal derivation from ack evidence. */
    const deriveTerminal = (
      operation: OperationRecord,
      summary: AcknowledgementSummary,
      reason: "complete" | "producer-failed" | "dependency-failed",
    ): WhiteboardOperationTerminalRecord | undefined => {
      const semantic = summary.acceptedSemanticCount;
      const noOp = summary.acceptedNoOpCount;
      const rejected = summary.rejectedCount;
      if (reason === "complete") {
        if (semantic >= 1 && rejected >= 1) {
          return {
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            outcome: "failed-partial",
            terminalReason: "browser-application-failed",
            acceptedSemanticCount: semantic,
            acceptedNoOpCount: noOp,
            rejectedCount: rejected,
            lastAcceptedProducerSequence: summary.lastAcceptedProducerSequence,
          };
        }
        if (semantic >= 1) {
          return {
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            outcome: "completed",
            terminalReason: "completed",
            acceptedSemanticCount: semantic,
            acceptedNoOpCount: noOp,
            rejectedCount: 0,
            lastAcceptedProducerSequence: summary.lastAcceptedProducerSequence,
          };
        }
        if (noOp >= 1) {
          return {
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            outcome: "zero-valid",
            terminalReason: "semantic-no-op",
            zeroValidReason: "semantic-no-op",
            acceptedSemanticCount: 0,
            acceptedNoOpCount: noOp,
            rejectedCount: rejected,
            lastAcceptedProducerSequence: 0,
          };
        }
        if (rejected >= 1) {
          return {
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            outcome: "zero-valid",
            terminalReason: "all-operations-rejected",
            zeroValidReason: "all-operations-rejected",
            acceptedSemanticCount: 0,
            acceptedNoOpCount: 0,
            rejectedCount: rejected,
            lastAcceptedProducerSequence: 0,
          };
        }
        return {
          batchId: operation.batchId,
          operationId: operation.operationId,
          generation: operation.generation,
          outcome: "zero-valid",
          terminalReason: "zero-mutation",
          zeroValidReason: "zero-mutation",
          acceptedSemanticCount: 0,
          acceptedNoOpCount: 0,
          rejectedCount: 0,
          lastAcceptedProducerSequence: 0,
        };
      }
      if (reason === "dependency-failed") {
        if (semantic >= 1) {
          return {
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            outcome: "failed-partial",
            terminalReason: "dependency-failed",
            acceptedSemanticCount: semantic,
            acceptedNoOpCount: noOp,
            rejectedCount: rejected,
            lastAcceptedProducerSequence: summary.lastAcceptedProducerSequence,
          };
        }
        // Zero-valid reason vocabulary has no dependency entry; the closest
        // truthful reason is that the first valid work was invalid.
        return {
          batchId: operation.batchId,
          operationId: operation.operationId,
          generation: operation.generation,
          outcome: "zero-valid",
          terminalReason: "invalid-first-operation",
          zeroValidReason: "invalid-first-operation",
          acceptedSemanticCount: 0,
          acceptedNoOpCount: 0,
          rejectedCount: rejected,
          lastAcceptedProducerSequence: 0,
        };
      }
      if (semantic >= 1) {
        return {
          batchId: operation.batchId,
          operationId: operation.operationId,
          generation: operation.generation,
          outcome: "failed-partial",
          terminalReason: "producer-failed",
          acceptedSemanticCount: semantic,
          acceptedNoOpCount: noOp,
          rejectedCount: rejected,
          lastAcceptedProducerSequence: summary.lastAcceptedProducerSequence,
        };
      }
      if (rejected >= 1) {
        return {
          batchId: operation.batchId,
          operationId: operation.operationId,
          generation: operation.generation,
          outcome: "zero-valid",
          terminalReason: "application-rejected-before-first-valid",
          zeroValidReason: "application-rejected-before-first-valid",
          acceptedSemanticCount: 0,
          acceptedNoOpCount: 0,
          rejectedCount: rejected,
          lastAcceptedProducerSequence: 0,
        };
      }
      return {
        batchId: operation.batchId,
        operationId: operation.operationId,
        generation: operation.generation,
        outcome: "zero-valid",
        terminalReason: "zero-mutation",
        zeroValidReason: "zero-mutation",
        acceptedSemanticCount: 0,
        acceptedNoOpCount: 0,
        rejectedCount: 0,
        lastAcceptedProducerSequence: 0,
      };
    };

    const finalizeTerminal = (
      state: ServiceState,
      session: SessionRecord,
      operation: OperationRecord,
      record: WhiteboardOperationTerminalRecord,
    ): Effect.Effect<WhiteboardOperationTerminalEvent, WhiteboardOperationSessionError> =>
      Effect.gen(function*() {
        const event: WhiteboardOperationTerminalEvent = {
          kind: "operation-terminal",
          ...identityOf(session),
          serverSequence: session.lastServerSequence + 1,
          ...record,
        };
        const retained = yield* pushEvent(state, session, event);
        if (!retained) {
          // D3: reject before browser delivery; enter protected lost state
          // and create no terminal, containment acknowledgement, or unlock.
          return yield* enterLostState(state, session);
        }
        operation.terminal = record;
        session.latestTerminal = record;
        if (session.activeOperationKey === operationKeyOf(operation.operationId, operation.generation)) {
          session.activeOperationKey = undefined;
        }
        return event;
      });

    const buildTakeOverResult = (
      session: SessionRecord,
      takeOver: TakeOverRecord,
    ): WhiteboardOperationTakeOverResult => ({
      ...identityOf(session),
      batchId: takeOver.batchId,
      operationId: takeOver.operationId,
      generation: takeOver.generation,
      takeOverRequestId: takeOver.takeOverRequestId,
      requestedGeneration: takeOver.requestedGeneration,
      status: takeOver.status,
      ...(takeOver.containmentResult === undefined
        ? {}
        : { containmentResult: takeOver.containmentResult }),
    });

    const handleTakeOverSessionError = (error: unknown): WhiteboardContainmentResult =>
      error === undefined ? "dispatch-failed" : "dispatch-failed";

    /** One dispatcher fiber per Take Over, raced against the deadline (D2). */
    const startContainmentFiber = (
      state: ServiceState,
      session: SessionRecord,
      takeOver: TakeOverRecord,
    ): Effect.Effect<void> =>
      Effect.gen(function*() {
        const identity = identityOf(session);
        const race = Effect.gen(function*() {
          const outcome: WhiteboardContainmentResult = yield* Effect.raceFirst(
            Effect.tryPromise({
              try: () =>
                dispatcher({
                  identity,
                  batchId: takeOver.batchId,
                  operationId: takeOver.operationId,
                  generation: takeOver.generation,
                  takeOverRequestId: takeOver.takeOverRequestId,
                  requestedGeneration: takeOver.requestedGeneration,
                }),
              catch: handleTakeOverSessionError,
            }),
            Effect.sleep(deadline).pipe(
              Effect.as<WhiteboardContainmentResult>("ack-timeout"),
            ),
          );
          yield* withLock(
            recordContainmentOutcome(
              state,
              session.identity.operationSessionId,
              takeOver.takeOverRequestId,
              outcome,
            ),
          );
        });
        // The fiber lives in the service scope: shutdown interrupts it.
        yield* Effect.forkIn(race, scope);
      });

    const recordContainmentOutcome = (
      state: ServiceState,
      operationSessionId: string,
      takeOverRequestId: string,
      outcome: WhiteboardContainmentResult,
    ): Effect.Effect<void, WhiteboardOperationSessionError> =>
      Effect.gen(function*() {
        const session = state.sessions.get(operationSessionId);
        if (session === undefined || state.closed) {
          return;
        }
        const takeOver = session.takeOver;
        if (
          takeOver === undefined ||
          takeOver.takeOverRequestId !== takeOverRequestId ||
          takeOver.status === "resolved"
        ) {
          // Equivalent repeats never launch another fiber; late races are ignored.
          return;
        }
        takeOver.status = "resolved";
        takeOver.containmentResult = outcome;
        const event: WhiteboardOperationSessionEvent = {
          kind: "containment-result",
          ...identityOf(session),
          serverSequence: session.lastServerSequence + 1,
          batchId: takeOver.batchId,
          operationId: takeOver.operationId,
          generation: takeOver.generation,
          takeOverRequestId: takeOver.takeOverRequestId,
          requestedGeneration: takeOver.requestedGeneration,
          result: outcome,
        };
        const retained = yield* pushEvent(state, session, event);
        if (!retained) {
          yield* enterLostState(state, session);
          return;
        }
        if (outcome !== "acknowledged") {
          // The generation fence remains; the lineage stays non-retryable;
          // the session remains protected with no interrupted-success claim.
          return;
        }
        const operation = session.operations.get(
          operationKeyOf(takeOver.operationId, takeOver.generation),
        );
        if (
          operation === undefined ||
          operation.terminal !== undefined ||
          operation.acknowledgementSummary.acceptedSemanticCount < 1
        ) {
          // Interrupted requires at least one semantic acknowledgement; no
          // terminal truth is manufactured when evidence is absent.
          return;
        }
        const record = deriveTerminal(
          operation,
          operation.acknowledgementSummary,
          "complete",
        );
        if (record === undefined) {
          return;
        }
        const terminal: WhiteboardOperationTerminalRecord =
          record.rejectedCount > 0
            ? {
                ...record,
                outcome: "failed-partial",
                terminalReason: "browser-application-failed",
                containmentResult: "acknowledged",
              }
            : {
                ...record,
                outcome: "interrupted",
                terminalReason: "take-over-acknowledged",
                containmentResult: "acknowledged",
              };
        const interruptedEvent: WhiteboardOperationTerminalEvent = {
          kind: "operation-terminal",
          ...identityOf(session),
          serverSequence: session.lastServerSequence + 1,
          ...terminal,
        };
        const terminalRetained = yield* pushEvent(state, session, interruptedEvent);
        if (!terminalRetained) {
          yield* enterLostState(state, session);
          return;
        }
        operation.terminal = terminal;
        session.latestTerminal = terminal;
        session.activeOperationKey = undefined;
      });

    // ------------------------------------------------------------------
    // Browser-facing and producer transitions.
    // ------------------------------------------------------------------

    const attachSession = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationAttachSessionResult,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          if (state.closed) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionUnknown,
              "operation-session authority is no longer available",
            );
          }
          const decoded = yield* decode(WhiteboardOperationAttachSessionInput, input);
          const key = authorityKeyOf(decoded);
          if (state.authority.has(key)) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionActive,
              "one live authority already owns this document and canvas identity",
            );
          }
          if (state.sessions.size >= limits.maxLiveOperationSessions) {
            let evicted = false;
            for (const [id, candidate] of [...state.sessions.entries()].sort(
              (a, b) => a[1].order - b[1].order,
            )) {
              if (!isSessionQuiescent(candidate)) continue;
              state.sessions.delete(id);
              state.authority.delete(authorityKeyOf(candidate.identity));
              state.retainedBytesTotal -= candidate.retainedBytes;
              for (const subscriber of candidate.subscribers.values()) {
                yield* Queue.end(subscriber.queue);
              }
              state.subscriberTotal -= candidate.subscribers.size;
              evicted = true;
              break;
            }
            if (!evicted) {
              // Fail closed at capacity when every session is protected (D3).
              return yield* fail(
                WHITEBOARD_OPERATION_ERROR.sessionActive,
                "session capacity is exhausted by protected live sessions",
              );
            }
          }
          const operationSessionId = newOpaqueId();
          const session: SessionRecord = {
            identity: {
              serverInstanceId,
              operationSessionId,
              sessionEpoch: 1,
              projectId: decoded.projectId,
              documentKind: decoded.documentKind,
              documentId: decoded.documentId,
              canvasIdentity: decoded.canvasIdentity,
            },
            order: ++state.orderCounter,
            documentRevision: decoded.expectedDocumentRevision,
            rows: [],
            lastServerSequence: 0,
            acknowledgementSummary: emptyAcknowledgementSummary(),
            operations: new Map(),
            activeOperationKey: undefined,
            latestTerminal: undefined,
            takeOver: undefined,
            lineageNonRetryable: false,
            lost: false,
            subscribers: new Map(),
            nextSubscriberId: 0,
            retainedBytes: 0,
            retries: new Map(),
            acks: new Map(),
            progressByServerSequence: new Map(),
          };
          state.sessions.set(operationSessionId, session);
          state.authority.set(key, operationSessionId);
          // Baseline: an attached session starts with baseline sequence 1 (D5).
          const baseline = buildSnapshotEvent(session);
          session.lastServerSequence = 1;
          const baselineRow: RowEntry = {
            serverSequence: 1,
            event: { ...baseline, serverSequence: 1 },
            bytes: 0,
          };
          baselineRow.bytes = byteLengthOf(baselineRow.event);
          session.rows.push(baselineRow);
          session.retainedBytes += baselineRow.bytes;
          state.retainedBytesTotal += baselineRow.bytes;
          return {
            ...identityOf(session),
            documentRevision: session.documentRevision,
          };
        }),
      );

    const subscribe = (
      input: unknown,
    ): Effect.Effect<
      Stream.Stream<WhiteboardOperationSessionEvent>,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          if (state.closed) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionUnknown,
              "operation-session authority is no longer available",
            );
          }
          const decoded = yield* decode(WhiteboardOperationSubscribeInput, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.resetRequired,
              "lost session history cannot resume; reset the operation session",
            );
          }
          if (
            session.subscribers.size >= limits.maxLiveSubscribersPerSession ||
            state.subscriberTotal >= limits.maxLiveSubscribersTotal
          ) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionActive,
              "subscriber capacity is exhausted for this operation session",
            );
          }
          const highWater = session.lastServerSequence;
          const cursor = decoded.lastServerSequence;
          if (cursor > highWater) {
            // Unavailable replay range: D3 reset/lost semantics.
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.resetRequired,
              "requested sequence is ahead of the live session history",
            );
          }
          const firstReplayIndex = session.rows.findIndex(
            (row) => row.serverSequence > cursor,
          );
          const replayHasGap =
            firstReplayIndex >= 0 &&
            (session.rows[firstReplayIndex]!.serverSequence !== cursor + 1 ||
              session.rows[session.rows.length - 1]!.serverSequence !==
                session.rows[firstReplayIndex]!.serverSequence +
                  (session.rows.length - 1 - firstReplayIndex));
          if (replayHasGap) {
            if (isSessionQuiescent(session)) {
              return yield* fail(
                WHITEBOARD_OPERATION_ERROR.resetRequired,
                "requested replay range is no longer retained",
              );
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "requested replay range is no longer retained for a protected session",
            );
          }
          const queue = yield* Queue.bounded<
            WhiteboardOperationSessionEvent,
            Cause.Done<void>
          >(limits.liveSubscriberQueueCapacity);
          const subscriber: SubscriberEntry = {
            id: ++session.nextSubscriberId,
            queue,
          };
          // Register the bounded queue before capturing state (D5.3).
          session.subscribers.set(subscriber.id, subscriber);
          state.subscriberTotal += 1;
          // Snapshot first, at the captured high-water sequence (D5.7).
          yield* offerOrTerminate(state, session, subscriber, buildSnapshotEvent(session));
          // Retained replay events ascending below the high water (D5.8).
          for (const row of session.rows) {
            if (row.serverSequence <= cursor || row.serverSequence > highWater) continue;
            yield* offerOrTerminate(state, session, subscriber, row.event);
          }
          session.order = ++state.orderCounter;
          const unregister = withLock(
            Effect.gen(function*() {
              const current = yield* Ref.get(stateRef);
              const live = current.sessions.get(session.identity.operationSessionId);
              if (live === undefined) return;
              yield* terminateSubscriber(current, live, subscriber);
            }),
          );
          // Disconnect/shutdown releases the subscriber through stream finalization.
          return Stream.fromQueue(queue).pipe(Stream.ensuring(unregister));
        }),
      );

    const acknowledgeApplication = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardAcknowledgeApplicationResult,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(
            WhiteboardAcknowledgeApplicationInput,
            input,
          );
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          const canonicalInput = canonicalJson(decoded);
          const key = ackKeyOf(
            decoded.operationId,
            decoded.generation,
            decoded.producerSequence,
            decoded.serverSequence,
          );
          // D4.2: find the admitted progress event by serverSequence.
          const progress = session.progressByServerSequence.get(decoded.serverSequence);
          if (progress === undefined || progress.row.event.kind !== "operation-progress") {
            // Classify retained evidence as stale when possible (D4).
            const evidenceOperation = session.operations.get(
              operationKeyOf(decoded.operationId, decoded.generation),
            );
            if (evidenceOperation !== undefined) {
              if (evidenceOperation.terminal !== undefined) {
                return yield* fail(
                  WHITEBOARD_OPERATION_ERROR.ackStale,
                  "operation already reached a terminal outcome",
                );
              }
              if (session.takeOver !== undefined) {
                return yield* fail(
                  WHITEBOARD_OPERATION_ERROR.ackStale,
                  "take over fenced this generation",
                );
              }
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackUnknown,
              "no admitted progress event exists for this acknowledgement",
            );
          }
          const event = progress.row.event;
          // D4.3: require the event to match all four key fields.
          if (
            event.operationId !== decoded.operationId ||
            event.generation !== decoded.generation ||
            event.producerSequence !== decoded.producerSequence
          ) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackConflict,
              "acknowledgement identity conflicts with the admitted progress event",
            );
          }
          // D4.4: require matching batch and session identity.
          if (event.batchId !== decoded.batchId) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackConflict,
              "acknowledgement batch identity conflicts with the admitted progress event",
            );
          }
          // D4.5: generation, containment, and terminal fences.
          const operation = session.operations.get(progress.operationKey);
          if (operation === undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackUnknown,
              "admitted progress evidence is no longer classifiable",
            );
          }
          if (operation.terminal !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackStale,
              "operation already reached a terminal outcome",
            );
          }
          if (session.takeOver !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackStale,
              "take over fenced this generation",
            );
          }
          // D4.6: only now evaluate duplicate equivalence.
          const prior = session.acks.get(key);
          if (prior !== undefined) {
            if (prior.canonical === canonicalInput) {
              return prior.result;
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.ackConflict,
              "acknowledgement evidence conflicts with the recorded acknowledgement",
            );
          }
          const sessionSummary = session.acknowledgementSummary;
          const operationSummary = operation.acknowledgementSummary;
          const summaries = [sessionSummary, operationSummary] as const;
          if (decoded.applicationResult === "applied-semantic") {
            for (const summary of summaries) {
              summary.acceptedSemanticCount += 1;
              summary.lastAcceptedProducerSequence = Math.max(
                summary.lastAcceptedProducerSequence,
                decoded.producerSequence,
              );
            }
          } else if (decoded.applicationResult === "applied-no-op") {
            for (const summary of summaries) {
              summary.acceptedNoOpCount += 1;
              summary.lastAcceptedProducerSequence = Math.max(
                summary.lastAcceptedProducerSequence,
                decoded.producerSequence,
              );
            }
          } else {
            for (const summary of summaries) {
              summary.rejectedCount += 1;
            }
          }
          const result: WhiteboardAcknowledgeApplicationResult = {
            ...identityOf(session),
            batchId: decoded.batchId,
            operationId: decoded.operationId,
            generation: decoded.generation,
            producerSequence: decoded.producerSequence,
            serverSequence: decoded.serverSequence,
            acceptedSemanticCount: operationSummary.acceptedSemanticCount,
            acceptedNoOpCount: operationSummary.acceptedNoOpCount,
            rejectedCount: operationSummary.rejectedCount,
          };
          session.acks.set(key, { canonical: canonicalInput, result });
          session.order = ++state.orderCounter;
          return result;
        }),
      );

    const takeOver = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationTakeOverResult,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(WhiteboardOperationTakeOverInput, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          const canonicalRequest = canonicalJson(decoded);
          const existing = session.takeOver;
          if (existing !== undefined) {
            if (existing.canonicalRequest === canonicalRequest) {
              // Equivalent repeated requests observe the recorded state and
              // never launch another fiber (D2.9).
              return buildTakeOverResult(session, existing);
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.takeOverRequestIdConflict,
              "take over request id conflicts with the recorded request",
            );
          }
          const originalOperationKey = operationKeyOf(
            decoded.operationId,
            decoded.expectedGeneration,
          );
          const operation = session.operations.get(originalOperationKey);
          if (operation === undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "take over names an unknown operation for this session",
            );
          }
          if (operation.terminal !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationTerminal,
              "operation already reached a terminal outcome",
            );
          }
          if (decoded.expectedGeneration !== operation.generation) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.takeOverGenerationStale,
              "expected generation does not match the authoritative generation",
            );
          }
          // 1. Atomically validated. 2. Recorded (below). 3. Generation
          // advances before dispatch. 4. Lineage becomes non-retryable.
          operation.generation = decoded.expectedGeneration + 1;
          const advancedOperationKey = operationKeyOf(
            operation.operationId,
            operation.generation,
          );
          session.operations.delete(originalOperationKey);
          session.operations.set(advancedOperationKey, operation);
          if (session.activeOperationKey === originalOperationKey) {
            session.activeOperationKey = advancedOperationKey;
          }
          session.lineageNonRetryable = true;
          const record: TakeOverRecord = {
            canonicalRequest,
            takeOverRequestId: decoded.takeOverRequestId,
            batchId: decoded.batchId,
            operationId: decoded.operationId,
            generation: operation.generation,
            requestedGeneration: decoded.expectedGeneration,
            status: "pending",
            containmentResult: undefined,
          };
          const pendingEvent: WhiteboardOperationSessionEvent = {
            kind: "take-over-pending",
            ...identityOf(session),
            serverSequence: session.lastServerSequence + 1,
            batchId: record.batchId,
            operationId: record.operationId,
            generation: record.generation,
            takeOverRequestId: record.takeOverRequestId,
            requestedGeneration: record.requestedGeneration,
          };
          const retained = yield* pushEvent(state, session, pendingEvent);
          if (!retained) {
            // Fence already advanced; reject before browser delivery and
            // enter protected lost state without dispatch (D3).
            session.takeOver = record;
            return yield* enterLostState(state, session);
          }
          session.takeOver = record;
          // 5. Emit pending. 6. Start exactly one dispatcher fiber.
          yield* startContainmentFiber(state, session, record);
          session.order = ++state.orderCounter;
          return buildTakeOverResult(session, record);
        }),
      );

    const retry = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationRetryResult,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(WhiteboardOperationRetryInput, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          const tupleKey = retryTupleKeyOf(
            decoded.batchId,
            decoded.failedOperationId,
            decoded.failedGeneration,
            decoded.failedRetryAttempt,
          );
          const canonicalInput = canonicalJson(decoded);
          const recorded = session.retries.get(tupleKey);
          if (recorded !== undefined) {
            if (recorded.canonical === canonicalInput) {
              return recorded.result;
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.revisionConflict,
              "retry identity conflicts with the recorded retry",
            );
          }
          if (session.lineageNonRetryable || session.takeOver !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationNotRetryable,
              "take over marked this lineage non-retryable",
            );
          }
          const predecessor = session.operations.get(
            operationKeyOf(decoded.failedOperationId, decoded.failedGeneration),
          );
          if (
            predecessor === undefined ||
            predecessor.batchId !== decoded.batchId ||
            predecessor.retryAttempt !== decoded.failedRetryAttempt
          ) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "retry names an unknown failed operation for this session",
            );
          }
          if (predecessor.terminal === undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationNotRetryable,
              "failed predecessor has not reached a terminal outcome",
            );
          }
          if (
            predecessor.terminal.outcome === "completed" ||
            predecessor.terminal.outcome === "interrupted"
          ) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationNotRetryable,
              "predecessor outcome is not retryable",
            );
          }
          if (session.activeOperationKey !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.revisionConflict,
              "another operation is already active for this session",
            );
          }
          const operationId = newOpaqueId();
          const generation = decoded.failedGeneration + 1;
          const retryAttempt = decoded.failedRetryAttempt + 1;
          const operation: OperationRecord = {
            batchId: predecessor.batchId,
            operationId,
            generation,
            expectedDocumentRevision: session.documentRevision,
            retryAttempt,
            retryOfOperationId: decoded.failedOperationId,
            retryOfGeneration: decoded.failedGeneration,
            retryOfAttempt: decoded.failedRetryAttempt,
            admittedServerSequence: session.lastServerSequence + 1,
            lastProducerSequence: 0,
            producerSequences: new Map(),
            acknowledgementSummary: emptyAcknowledgementSummary(),
            terminal: undefined,
          };
          const event: WhiteboardOperationSessionEvent = {
            kind: "operation-admitted",
            ...identityOf(session),
            serverSequence: session.lastServerSequence + 1,
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            expectedDocumentRevision: operation.expectedDocumentRevision,
            retryOfOperationId: decoded.failedOperationId,
            retryOfGeneration: decoded.failedGeneration,
            retryOfAttempt: decoded.failedRetryAttempt,
            retryAttempt,
          };
          const retained = yield* pushEvent(state, session, event);
          if (!retained) {
            return yield* enterLostState(state, session);
          }
          session.operations.set(operationKeyOf(operationId, generation), operation);
          session.activeOperationKey = operationKeyOf(operationId, generation);
          const result: WhiteboardOperationRetryResult = {
            ...identityOf(session),
            batchId: operation.batchId,
            operationId,
            generation,
            expectedDocumentRevision: operation.expectedDocumentRevision,
            retryOfOperationId: decoded.failedOperationId,
            retryOfGeneration: decoded.failedGeneration,
            retryOfAttempt: decoded.failedRetryAttempt,
            retryAttempt,
          };
          session.retries.set(tupleKey, { canonical: canonicalInput, result });
          session.order = ++state.orderCounter;
          return result;
        }),
      );

    const releaseSession = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationReleaseSessionResult,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(
            WhiteboardOperationReleaseSessionInput,
            input,
          );
          const tombstone = state.tombstones.find(
            (entry) =>
              entry.identity.serverInstanceId === decoded.serverInstanceId &&
              entry.identity.operationSessionId === decoded.operationSessionId &&
              entry.identity.sessionEpoch === decoded.sessionEpoch &&
              entry.identity.projectId === decoded.projectId &&
              entry.identity.documentKind === decoded.documentKind &&
              entry.identity.documentId === decoded.documentId &&
              entry.identity.canvasIdentity === decoded.canvasIdentity,
          );
          if (tombstone !== undefined) {
            return tombstone.result;
          }
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionActive,
              "lost sessions remain protected and cannot be released",
            );
          }
          if (
            session.activeOperationKey !== undefined ||
            session.takeOver !== undefined
          ) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionActive,
              "active sessions with unresolved work cannot be released",
            );
          }
          state.sessions.delete(session.identity.operationSessionId);
          state.authority.delete(authorityKeyOf(session.identity));
          state.retainedBytesTotal -= session.retainedBytes;
          for (const subscriber of session.subscribers.values()) {
            yield* Queue.end(subscriber.queue);
          }
          state.subscriberTotal -= session.subscribers.size;
          const result: WhiteboardOperationReleaseSessionResult = {
            ...identityOf(session),
            released: true,
          };
          state.tombstones.push({ identity: session.identity, result });
          while (state.tombstones.length > limits.maxReleasedSessionTombstones) {
            state.tombstones.shift();
          }
          return result;
        }),
      );

    const admitOperation = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationAdmittedEvent,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(WhiteboardAdmitOperationInput, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          if (session.activeOperationKey !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.revisionConflict,
              "another operation is already active for this session",
            );
          }
          const operationId = newOpaqueId();
          const generation = 1;
          const operation: OperationRecord = {
            batchId: decoded.batchId,
            operationId,
            generation,
            expectedDocumentRevision: session.documentRevision,
            retryAttempt: 0,
            retryOfOperationId: undefined,
            retryOfGeneration: undefined,
            retryOfAttempt: undefined,
            admittedServerSequence: session.lastServerSequence + 1,
            lastProducerSequence: 0,
            producerSequences: new Map(),
            acknowledgementSummary: emptyAcknowledgementSummary(),
            terminal: undefined,
          };
          const event: WhiteboardOperationSessionEvent = {
            kind: "operation-admitted",
            ...identityOf(session),
            serverSequence: session.lastServerSequence + 1,
            batchId: operation.batchId,
            operationId: operation.operationId,
            generation: operation.generation,
            expectedDocumentRevision: operation.expectedDocumentRevision,
            retryAttempt: 0,
          };
          const retained = yield* pushEvent(state, session, event);
          if (!retained) {
            return yield* enterLostState(state, session);
          }
          session.operations.set(operationKeyOf(operationId, generation), operation);
          session.activeOperationKey = operationKeyOf(operationId, generation);
          session.order = ++state.orderCounter;
          return event;
        }),
      );

    const publishProgress = (
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationProgressEvent,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(WhiteboardPublishProgressInput, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          const key = operationKeyOf(decoded.operationId, decoded.generation);
          const operation = session.operations.get(key);
          if (operation === undefined || session.activeOperationKey !== key) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "progress names an operation that is not active for this session",
            );
          }
          if (operation.batchId !== decoded.batchId) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "progress batch identity does not match the admitted operation",
            );
          }
          if (operation.terminal !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationTerminal,
              "operation already reached a terminal outcome",
            );
          }
          if (session.takeOver !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.postContainmentInput,
              "take over stopped this operation lineage",
            );
          }
          const canonicalInput = canonicalJson(decoded);
          if (decoded.producerSequence <= operation.lastProducerSequence) {
            const prior = operation.producerSequences.get(decoded.producerSequence);
            if (prior !== undefined && prior.canonical === canonicalInput) {
              // Canonical duplicate producer input is idempotent (D8).
              const row = session.progressByServerSequence.get(prior.serverSequence);
              if (row !== undefined && row.row.event.kind === "operation-progress") {
                return row.row.event;
              }
            }
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.conflictingProducerInput,
              "producer input conflicts with previously admitted progress",
            );
          }
          if (decoded.producerSequence > operation.lastProducerSequence + 1) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.producerSequenceSkipped,
              "producer sequence skipped ahead of the contiguous sequence",
            );
          }
          for (const dependency of decoded.dependsOnProducerSequences) {
            if (!operation.producerSequences.has(dependency)) {
              // Invalid dependent work is not delivered; dependent work stops.
              const record = deriveTerminal(
                operation,
                operation.acknowledgementSummary,
                "dependency-failed",
              );
              if (record !== undefined) {
                yield* finalizeTerminal(state, session, operation, record);
              }
              return yield* fail(
                WHITEBOARD_OPERATION_ERROR.dependencyInvalid,
                "progress depends on a producer sequence that was not admitted",
              );
            }
          }
          const event: WhiteboardOperationSessionEvent = {
            kind: "operation-progress",
            ...decoded,
            serverSequence: session.lastServerSequence + 1,
          };
          const retained = yield* pushEvent(state, session, event);
          if (!retained) {
            return yield* enterLostState(state, session);
          }
          operation.lastProducerSequence = decoded.producerSequence;
          operation.producerSequences.set(decoded.producerSequence, {
            canonical: canonicalInput,
            serverSequence: event.serverSequence,
          });
          const entry = session.progressByServerSequence.get(event.serverSequence);
          if (entry !== undefined) {
            session.progressByServerSequence.set(event.serverSequence, {
              ...entry,
              canonicalInput,
            });
          }
          session.order = ++state.orderCounter;
          return event;
        }),
      );

    const completeOrFail = (
      schema:
        | typeof WhiteboardCompleteOperationInput
        | typeof WhiteboardFailOperationInput,
      mode: "complete" | "fail",
      input: unknown,
    ): Effect.Effect<
      WhiteboardOperationTerminalEvent,
      WhiteboardOperationSessionError
    > =>
      withLock(
        Effect.gen(function*() {
          const state = yield* Ref.get(stateRef);
          const decoded = yield* decode(schema, input);
          const session = yield* classifySession(state, decoded);
          if (session.lost) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.sessionLost,
              "operation session is in a protected lost state",
            );
          }
          const key = operationKeyOf(decoded.operationId, decoded.generation);
          const operation = session.operations.get(key);
          if (operation === undefined || session.activeOperationKey !== key) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "completion names an operation that is not active for this session",
            );
          }
          if (operation.batchId !== decoded.batchId) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationUnknown,
              "completion batch identity does not match the admitted operation",
            );
          }
          if (operation.terminal !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.operationTerminal,
              "operation already reached a terminal outcome",
            );
          }
          if (session.takeOver !== undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.postContainmentInput,
              "take over owns this operation lineage",
            );
          }
          const record = deriveTerminal(
            operation,
            operation.acknowledgementSummary,
            mode === "complete" ? "complete" : "producer-failed",
          );
          if (record === undefined) {
            return yield* fail(
              WHITEBOARD_OPERATION_ERROR.semanticVerificationFailed,
              "terminal outcome could not be derived from acknowledgement evidence",
            );
          }
          const event = yield* finalizeTerminal(state, session, operation, record);
          session.order = ++state.orderCounter;
          return event;
        }),
      );

    const completeOperation = (input: unknown): Effect.Effect<
      WhiteboardOperationTerminalEvent,
      WhiteboardOperationSessionError
    > => completeOrFail(WhiteboardCompleteOperationInput, "complete", input);

    const failOperation = (input: unknown): Effect.Effect<
      WhiteboardOperationTerminalEvent,
      WhiteboardOperationSessionError
    > => completeOrFail(WhiteboardFailOperationInput, "fail", input);

    return {
      attachSession,
      subscribe,
      acknowledgeApplication,
      takeOver,
      retry,
      releaseSession,
      admitOperation,
      publishProgress,
      completeOperation,
      failOperation,
    } satisfies WhiteboardOperationSessionService;
  });
