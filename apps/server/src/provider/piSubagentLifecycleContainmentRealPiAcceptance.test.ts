/**
 * Ticket 03 / WP-03 — isolated REAL-PI acceptance (Decision 0006).
 *
 * Real Pi owns the session, pinned extension, managed admission, sequence-2
 * activation, one synchronous steer insertion, route retirement, terminal
 * callback, and persistence-failure path. Dedicated fixtures below exercise
 * bands 74–78 through the same live repository used by that real-Pi runtime.
 *
 * Response loss after acceptance and replaced/stale callback classification
 * require deterministic callback injection. Those classifications remain
 * owned by piSubagentLiveLifecycleContainment.test.ts and the containment
 * wiring tests; this suite does not fabricate them with elapsed time. Its
 * sibling session only corroborates real session isolation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { CommandId, MessageId, ProjectId, ThreadId } from "@synara/contracts";

import type { PiSubagentExecutionRepositoryShape } from "../persistence/Services/PiSubagentExecutionRepository.ts";
import {
  DETERMINISTIC_DRIVER_MODEL_ID,
  makeRealPiWsHarness,
  observeIsolationPaths,
  verifyRealPiExtensionProvenance,
} from "./piSubagentRealPiAcceptanceHelpers.ts";

const PINNED_ALFIE_COMMIT = "3fe340b401ca86bcbe8b55abd4de107e1d93482e";
const PINNED_ALFIE_VERSION = "0.15.0-alfie.6";
const PINNED_PI_SDK_VERSION = "0.83.0";

const waitFor = async <T>(
  read: () => T | Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 90_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (predicate(value)) return value;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
};

const settleBounded = async (
  operation: Promise<unknown> | undefined,
  label: string,
  timeoutMs = 2_000,
): Promise<void> => {
  if (operation === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out settling ${label}.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

function registeredTool(session: any, name: string): any {
  const extensions = session?.resourceLoader?.getExtensions?.()?.extensions;
  if (!Array.isArray(extensions)) throw new Error("Real Pi session has no extension registry.");
  const extension = extensions.find(
    (candidate: any) => candidate?.tools instanceof Map && candidate.tools.has(name),
  );
  const entry = extension?.tools.get(name);
  const tool = entry?.definition ?? entry;
  if (!tool || typeof tool.execute !== "function") {
    throw new Error(`Real Pi session did not register executable ${name}.`);
  }
  return tool;
}

const invokeSteer = (tool: any, executionId: string, tag: string) =>
  Promise.resolve(
    tool.execute(
      `call_${tag}`,
      {
        execution_id: executionId,
        task: `Ticket 03 ${tag}`,
        context: "Exact live tuple only.",
        link_references: "Decision 0006",
        expected_outcome: "One bounded live-control result.",
      },
      undefined,
      undefined,
      undefined,
    ),
  );

const assertNoPublicAgentId = (value: unknown): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoPublicAgentId(entry);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    expect(key).not.toMatch(/agent[_-]?id/i);
    assertNoPublicAgentId(entry);
  }
};

function installedPiSdkVersion(): string {
  const candidates = [
    resolve(process.cwd(), "node_modules/@earendil-works/pi-coding-agent/package.json"),
    resolve(process.cwd(), "../../node_modules/@earendil-works/pi-coding-agent/package.json"),
  ];
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof manifest.version === "string") return manifest.version;
    } catch {
      // Try the workspace-level install next.
    }
  }
  throw new Error(`Pi SDK manifest not found in ${candidates.join(", ")}.`);
}

interface BandSnapshot {
  readonly band: number;
  readonly observedState: string;
  readonly generation: number;
  readonly durableBands: readonly number[];
}

const proveRepositoryBandOrdering = async (
  repository: PiSubagentExecutionRepositoryShape,
): Promise<{
  readonly before76: readonly BandSnapshot[];
  readonly terminalBefore76: string;
  readonly proven76: {
    readonly kind: string;
    readonly observedState: string;
    readonly generation: number;
  };
  readonly terminalAfter76: string;
}> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const occurredAt = "2026-08-27T12:00:00.000Z";
      const readSnapshot = (executionId: string, band: number) =>
        Effect.gen(function* () {
          const aggregate = yield* repository.getById(executionId);
          if (Option.isNone(aggregate)) throw new Error(`Missing band fixture ${executionId}.`);
          const events = yield* repository.listJournalEvents(executionId);
          return {
            band,
            observedState: aggregate.value.observedState,
            generation: aggregate.value.generation,
            durableBands: events
              .map((event) => event.sequence)
              .filter((sequence) => sequence >= 74 && sequence <= 78),
          } satisfies BandSnapshot;
        });
      const admit = (executionId: string, attemptId: string) =>
        repository.recordAdmission({
          executionId,
          attemptId,
          generation: 1,
          commandId: `cmd_${executionId}`,
          commandFingerprint: `fp_${executionId}`,
          projectId: "t03-realpi-project",
          parentThreadId: "t03-realpi-band-fixture",
          parentTurnId: "turn_t03_realpi_band_fixture",
          parentToolCallId: `call_${executionId}`,
          agentType: "general-purpose",
          prompt: "Dedicated repository band-ordering fixture.",
          mode: "foreground",
          cancellationScope: "parent_turn",
          state: "accepted",
          diagnosticCode: "pi_subagent_managed_enabled",
          now: occurredAt,
        });
      const driveBandsWithoutProof = (executionId: string, attemptId: string) =>
        Effect.gen(function* () {
          yield* repository.recordLifecycleEvent({
            eventId: `evt_${executionId}_seq2`,
            executionId,
            attemptId,
            generation: 1,
            sequence: 2,
            state: "cancelling",
            occurredAt,
            diagnosticCode: "pi_subagent_cancel_escalated",
          });
          const snapshots: BandSnapshot[] = [];
          yield* repository.recordWatchdogStageEvent({
            executionId,
            attemptId,
            generation: 1,
            sequence: 74,
            state: "cancelling",
            occurredAt,
            diagnosticCode: "pi_subagent_watchdog_cleanup_uncertain",
            diagnosticMessage: "Dedicated fixture: teardown handoff remains uncertain.",
          });
          snapshots.push(yield* readSnapshot(executionId, 74));
          yield* repository.recordTeardownRequested({
            executionId,
            attemptId,
            generation: 1,
            state: "cancelling",
            occurredAt,
          });
          snapshots.push(yield* readSnapshot(executionId, 75));
          yield* repository.recordTeardownOutcome({
            executionId,
            attemptId,
            generation: 1,
            outcome: "survivors",
            occurredAt,
            survivorPids: [],
            diagnosticMessage: "Dedicated fixture: survivor classification without settlement.",
          });
          snapshots.push(yield* readSnapshot(executionId, 77));
          yield* repository.recordTeardownOutcome({
            executionId,
            attemptId,
            generation: 1,
            outcome: "owner_unproven",
            occurredAt,
            diagnosticMessage: "Dedicated fixture: owner remains unproven.",
          });
          snapshots.push(yield* readSnapshot(executionId, 78));
          return snapshots;
        });

      const beforeExecution = "exec_t03_band_before76";
      const beforeAttempt = "att_t03_band_before76";
      yield* admit(beforeExecution, beforeAttempt);
      const before76 = yield* driveBandsWithoutProof(beforeExecution, beforeAttempt);
      const terminalBefore76 = yield* repository.recordTerminalEvent({
        executionId: beforeExecution,
        attemptId: beforeAttempt,
        generation: 1,
        sequence: 40,
        state: "succeeded",
        occurredAt,
        summary: "Same-generation terminal before proof.",
      });

      const afterExecution = "exec_t03_band_after76";
      const afterAttempt = "att_t03_band_after76";
      yield* admit(afterExecution, afterAttempt);
      yield* driveBandsWithoutProof(afterExecution, afterAttempt);
      const proven76 = yield* repository.recordTeardownOutcome({
        executionId: afterExecution,
        attemptId: afterAttempt,
        generation: 1,
        outcome: "proven",
        occurredAt,
        diagnosticMessage: "Dedicated fixture: proven outcome supplied at repository seam.",
      });
      const terminalAfter76 = yield* repository.recordTerminalEvent({
        executionId: afterExecution,
        attemptId: afterAttempt,
        generation: 1,
        sequence: 40,
        state: "succeeded",
        occurredAt,
        summary: "Old-generation terminal after proof.",
      });

      return {
        before76,
        terminalBefore76: terminalBefore76.kind,
        proven76: {
          kind: proven76.kind,
          observedState: proven76.execution.observedState,
          generation: proven76.execution.generation,
        },
        terminalAfter76: terminalAfter76.kind,
      };
    }),
  );

describe.sequential("Ticket 03 isolated real-Pi lifecycle containment acceptance", () => {
  it("causally proves inactive-before-sequence-2, one real steer, retired terminal failure, repository retry, band ordering, and disposal", async () => {
    const startedAt = Date.now();
    const provenance = verifyRealPiExtensionProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageName).toBe("@alfie/pi-subagents");
    expect(provenance.packageVersion).toBe(PINNED_ALFIE_VERSION);
    expect(provenance.pinnedCommit).toBe(PINNED_ALFIE_COMMIT);
    expect(installedPiSdkVersion()).toBe(PINNED_PI_SDK_VERSION);
    const userPiBefore = provenance.snapshotUserPiHome();

    let releaseSequence2!: () => void;
    let markSequence2Entered!: () => void;
    const sequence2Release = new Promise<void>((resolveRelease) => {
      releaseSequence2 = resolveRelease;
    });
    const sequence2Entered = new Promise<void>((resolveEntered) => {
      markSequence2Entered = resolveEntered;
    });
    let releaseTerminal!: () => void;
    let markTerminalEntered!: () => void;
    const terminalRelease = new Promise<void>((resolveRelease) => {
      releaseTerminal = resolveRelease;
    });
    const terminalEntered = new Promise<void>((resolveEntered) => {
      markTerminalEntered = resolveEntered;
    });
    let terminalCommitAttempts = 0;
    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      holdDeterministicSlowResponses: true,
      beforeSequence2Commit: async () => {
        markSequence2Entered();
        await sequence2Release;
      },
      beforeTerminalCommit: async () => {
        terminalCommitAttempts += 1;
        if (terminalCommitAttempts !== 1) return;
        markTerminalEntered();
        await terminalRelease;
        throw new Error("T03_TEST_ONLY_FIRST_TERMINAL_COMMIT_FAILURE");
      },
    });
    harness.writeSubagentModelPreference("synara-local-echo/echo-slow");
    const rootDir = harness.rootDir;
    const trace: string[] = [];
    let turnStart: Promise<unknown> | undefined;
    let ownerThreadId: ThreadId | undefined;
    let siblingThreadId: ThreadId | undefined;

    try {
      const isolation = observeIsolationPaths({
        root: harness.rootDir,
        home: harness.homeDir,
        workspace: harness.workspaceDir,
        db: harness.dbPath,
        parentAgent: harness.parentAgentDir,
        childAgent: harness.childAgentDir,
        piHome: harness.piHomeDir,
      });
      expect(new Set(Object.values(isolation).map((entry) => entry.realpath)).size).toBe(7);
      expect(harness.port).toBeGreaterThan(0);
      expect(harness.origin).toBe(`http://127.0.0.1:${harness.port}`);

      const projectId = ProjectId.makeUnsafe("t03-realpi-project");
      ownerThreadId = ThreadId.makeUnsafe("t03-realpi-owner-thread");
      siblingThreadId = ThreadId.makeUnsafe("t03-realpi-sibling-thread");
      const createdAt = new Date().toISOString();
      await harness.client.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t03-realpi-project"),
        projectId,
        title: "Ticket 03 real Pi",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      for (const [threadId, suffix, model] of [
        [ownerThreadId, "owner", DETERMINISTIC_DRIVER_MODEL_ID],
        [siblingThreadId, "sibling", "echo"],
      ] as const) {
        await harness.client.dispatchCommand({
          type: "thread.create",
          commandId: CommandId.makeUnsafe(`cmd-t03-realpi-${suffix}-thread`),
          threadId,
          projectId,
          title: `Ticket 03 ${suffix}`,
          modelSelection: { provider: "pi", model },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt,
        });
      }

      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t03-realpi-sibling-turn"),
        threadId: siblingThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t03-realpi-sibling-turn"),
          role: "user",
          text: "Establish the isolated sibling Pi session without delegation.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      turnStart = harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t03-realpi-owner-turn"),
        threadId: ownerThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t03-realpi-owner-turn"),
          role: "user",
          text: "Delegate exactly one Ticket 03 real-Pi child.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      void turnStart.catch(() => undefined);

      const admission = await waitFor(
        () =>
          harness
            .observedAdmissions()
            .find((event) => String(event.threadId) === String(ownerThreadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        "one real managed admission",
      );
      if (!admission) throw new Error("Real Pi admission was not observed.");
      const identity = admission.result;
      await sequence2Entered;
      expect(
        (await harness.durable.listJournalEvents(identity.executionId)).map((e) => e.sequence),
      ).toEqual([1]);

      const ownerSteer = registeredTool(
        harness.observedSessions().get(String(ownerThreadId)),
        "steer_subagent",
      );
      const siblingSteer = registeredTool(
        harness.observedSessions().get(String(siblingThreadId)),
        "steer_subagent",
      );
      const preSequence2 = await invokeSteer(
        ownerSteer,
        identity.executionId,
        "realpi_pre_sequence2",
      );
      expect(preSequence2.isError).toBe(true);
      expect(preSequence2.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
      assertNoPublicAgentId(JSON.parse(JSON.stringify(preSequence2)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(0);
      trace.push(
        "sequence2-gated-live-lifecycle-unavailable",
        "zero-extension-steer-before-sequence2",
      );

      releaseSequence2();
      const journalStarted = await waitFor(
        () => harness.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 2),
        "durable sequence-2 activation",
      );
      expect(journalStarted.map((event) => event.sequence)).toEqual([1, 2]);
      await waitFor(
        () => harness.modelServer.pendingSlowResponseCount(),
        (count) => count === 1,
        "one held real child response",
      );
      trace.push("sequence2-committed", "real-child-held");

      const applied = await invokeSteer(ownerSteer, identity.executionId, "realpi_active");
      expect(applied.isError).toBeUndefined();
      expect(String(applied.content?.[0]?.text)).toContain("Steer state: applied");
      assertNoPublicAgentId(JSON.parse(JSON.stringify(applied)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      trace.push("one-extension-steer-emitted");

      const siblingRefusal = await invokeSteer(
        siblingSteer,
        identity.executionId,
        "realpi_sibling",
      );
      expect(siblingRefusal.isError).toBe(true);
      expect(siblingRefusal.diagnosticCode).toBe("pi_subagent_read_unauthorized_or_out_of_scope");
      assertNoPublicAgentId(JSON.parse(JSON.stringify(siblingRefusal)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      trace.push("sibling-refused-without-extension-emission");

      harness.modelServer.releaseSlowResponses();
      await terminalEntered;
      expect(terminalCommitAttempts).toBe(1);
      expect(
        harness
          .bridgeActiveExecutions(String(ownerThreadId))
          .some((child) => child.executionId === identity.executionId),
      ).toBe(false);
      expect(
        (await harness.durable.listJournalEvents(identity.executionId)).map((e) => e.sequence),
      ).toEqual([1, 2, 3]);
      expect(
        harness
          .observedLifecycleNotifications()
          .filter(
            (event) => event.executionId === identity.executionId && event.journalSequence === 40,
          ),
      ).toHaveLength(0);
      expect(await harness.durable.getCompletionOutboxEntry(identity.executionId)).toBeUndefined();

      const retired = await invokeSteer(ownerSteer, identity.executionId, "realpi_retired");
      expect(retired.isError).toBe(true);
      expect(retired.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
      assertNoPublicAgentId(JSON.parse(JSON.stringify(retired)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      trace.push("route-retired-before-failed-commit", "precommit-notification-and-outbox-absent");

      releaseTerminal();
      const degraded = await waitFor(
        () => harness.observedControlHealth(),
        (health) => health.status === "degraded",
        "terminal persistence degradation",
      );
      expect(degraded).toEqual({
        status: "degraded",
        diagnosticCode: "pi_subagent_terminal_persistence_failed",
      });
      const afterFailure = await harness.durable.getById(identity.executionId);
      expect(afterFailure).toMatchObject({
        attemptId: identity.attemptId,
        generation: identity.generation,
        observedState: "running",
      });
      expect(
        (await harness.durable.listJournalEvents(identity.executionId)).map(
          (event) => event.sequence,
        ),
      ).toEqual([1, 2, 3]);
      expect(
        harness
          .observedLifecycleNotifications()
          .filter(
            (event) => event.executionId === identity.executionId && event.journalSequence === 40,
          ),
      ).toHaveLength(0);
      expect(await harness.durable.getCompletionOutboxEntry(identity.executionId)).toBeUndefined();
      const retiredAfterFailure = await invokeSteer(
        ownerSteer,
        identity.executionId,
        "realpi_retired_after_failure",
      );
      expect(retiredAfterFailure.isError).toBe(true);
      expect(retiredAfterFailure.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
      assertNoPublicAgentId(JSON.parse(JSON.stringify(retiredAfterFailure)));
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      trace.push(
        "first-terminal-repository-write-failed",
        "durable-state-remained-nonterminal",
        "postfailure-route-still-unavailable",
        "postfailure-notification-and-outbox-absent",
      );

      // This is deliberately a repository retry of the same tuple/sequence,
      // not a provider callback retry. Its successful repository result is
      // durable retry evidence; provider-side evidence remains the unchanged
      // extension-emission count and the post-failure unavailable result above.
      const repositoryRetry = await Effect.runPromise(
        harness.repository.recordTerminalEvent({
          executionId: identity.executionId,
          attemptId: identity.attemptId,
          generation: identity.generation,
          sequence: 40,
          state: "succeeded",
          occurredAt: new Date().toISOString(),
          summary: "Repository retry of the failed real-Pi terminal tuple.",
        }),
      );
      expect(repositoryRetry.kind).toBe("recorded");
      expect(terminalCommitAttempts).toBe(1);
      const terminalJournal = await waitFor(
        () => harness.durable.listJournalEvents(identity.executionId),
        (events) => events.some((event) => event.sequence === 40 && event.state === "succeeded"),
        "repository retry band-40 commit",
      );
      const terminalNotifications = await waitFor(
        () => harness.observedLifecycleNotifications(),
        (events) =>
          events.some(
            (event) => event.executionId === identity.executionId && event.journalSequence === 40,
          ),
        "post-retry lifecycle notification",
      );
      expect(
        terminalNotifications.filter(
          (event) => event.executionId === identity.executionId && event.journalSequence === 40,
        ),
      ).toHaveLength(1);
      const afterRetrySteer = await invokeSteer(
        ownerSteer,
        identity.executionId,
        "realpi_after_repository_retry",
      );
      expect(afterRetrySteer.isError).toBe(true);
      // Durable terminal precedence now rejects at the read boundary. Route
      // retirement itself was already observed before the retry commit.
      expect(afterRetrySteer.diagnosticCode).toBe("pi_subagent_read_live_record_unavailable");
      expect(harness.observedExtensionSteerEmissions()).toHaveLength(1);
      trace.push("repository-retry-band40-committed", "notification-after-commit");

      const bandOrdering = await proveRepositoryBandOrdering(harness.repository);
      expect(bandOrdering.before76).toHaveLength(4);
      expect(bandOrdering.before76.map((snapshot) => snapshot.band)).toEqual([74, 75, 77, 78]);
      for (const snapshot of bandOrdering.before76) {
        expect(snapshot.observedState).toBe("cancelling");
        expect(snapshot.generation).toBe(1);
        expect(snapshot.durableBands).toContain(snapshot.band);
      }
      expect(bandOrdering.terminalBefore76).toBe("recorded");
      expect(bandOrdering.proven76).toEqual({
        kind: "recorded",
        observedState: "cancelled",
        generation: 2,
      });
      expect(bandOrdering.terminalAfter76).toBe("ignored_stale");
      trace.push(
        "repository-bands-74-75-77-78-unfenced",
        "repository-band76-fenced-old-terminal-stale",
      );

      const observedCounts = {
        admissions: harness.observedAdmissions().length,
        delegatedModelRequests: harness.modelServer
          .requests()
          .filter((request) => request.delegated).length,
        supervisorSpawns: harness.observedSupervisorSpawnPids().length,
        extensionSteerEmissions: harness.observedExtensionSteerEmissions().length,
        providerTerminalCommitAttempts: terminalCommitAttempts,
        terminalLifecycleNotifications: terminalNotifications.filter(
          (event) => event.executionId === identity.executionId && event.journalSequence === 40,
        ).length,
      };
      expect(observedCounts).toEqual({
        admissions: 1,
        delegatedModelRequests: 1,
        supervisorSpawns: 0,
        extensionSteerEmissions: 1,
        providerTerminalCommitAttempts: 1,
        terminalLifecycleNotifications: 1,
      });

      console.info(
        "T03_REAL_PI_EVIDENCE",
        JSON.stringify({
          rootDir: harness.rootDir,
          executionId: identity.executionId,
          attemptId: identity.attemptId,
          generation: identity.generation,
          trace,
          journalSequences: terminalJournal.map((event) => event.sequence),
          observedCounts,
          repositoryRetryOutcome: repositoryRetry.kind,
          bandOrdering,
          deterministicOnlyClassifications: [
            "response_loss_after_acceptance",
            "late_response_from_replaced_or_stale_callback",
          ],
        }),
      );
    } finally {
      releaseSequence2();
      releaseTerminal();
      harness.modelServer.releaseSlowResponses();
      try {
        await Promise.allSettled([
          settleBounded(
            turnStart?.catch(() => undefined),
            "real-Pi owner turn",
          ),
          ownerThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.abortPiTurn(String(ownerThreadId)).catch(() => undefined),
                "real-Pi owner abort",
              ),
          ownerThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.stopPiSession(String(ownerThreadId)).catch(() => undefined),
                "real-Pi owner session stop",
              ),
          siblingThreadId === undefined
            ? Promise.resolve()
            : settleBounded(
                harness.stopPiSession(String(siblingThreadId)).catch(() => undefined),
                "real-Pi sibling session stop",
              ),
        ]);
      } finally {
        await harness.dispose();
      }
    }

    expect((await harness.rootExists())()).toBe(false);
    expect(harness.envWasRestored()).toBe(true);
    expect(harness.lastOperationDiagnostics()).toEqual([]);
    const provenanceAfter = verifyRealPiExtensionProvenance();
    expect(provenanceAfter.isVerified).toBe(true);
    expect(provenanceAfter.packageVersion).toBe(PINNED_ALFIE_VERSION);
    expect(provenanceAfter.pinnedCommit).toBe(PINNED_ALFIE_COMMIT);
    expect(provenanceAfter.snapshotUserPiHome().digest).toBe(userPiBefore.digest);
    expect(rootDir).toMatch(/^\/.*synara-realpi-t17-/);
    console.info(
      "T03_REAL_PI_CLEANUP",
      JSON.stringify({
        rootDir,
        rootExists: (await harness.rootExists())(),
        envRestored: harness.envWasRestored(),
        userPiDigestRestored: true,
        durationMs: Date.now() - startedAt,
      }),
    );
  }, 240_000);
});
