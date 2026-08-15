// FILE: synaraMcp.integration.test.ts
// Purpose: impl-12 AC1 integrated journey slices (WP3-WP5) through the REAL
// WebSocket orchestration harness. All commands, snapshots, and replays go
// through the public WS RPC boundary (`dispatchCommand`/`getSnapshot`/
// `getThreadDetailSnapshot`/`replayEvents`); the deterministic test adapter
// harness is used only at the provider boundary. No production code is
// touched.
//
// Journey 1 (WP3): dormant startup with zero MCP activity -> active-turn-safe
// enable pending/terminal across multiple current sessions -> subject- and
// generation-bound MCP use -> reconnect/replay equivalence with no
// slash-command message or provider-turn contamination, including one
// generation-fencing (authority/activation) failure with exactly-once
// terminal evidence and sibling cleanup.
//
// Journey 2 (WP4): disable during an in-flight MCP call -> fence/settle/
// cancel/revoke/reload ordering, structured disabled settlement exactly once,
// Pi turn continuity (no interrupt), no replay, duplicate-disable
// idempotency, and fail-closed post-fence admissions.
//
// Journey 3 (WP5): future-session waiting during a pending enable, failed-
// sibling global rollback to disabled with sibling cleanup, and restart
// recovery from durable pending state with exactly-once deterministic
// terminal and zero provider replay.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationThread,
  type ProjectMcpActivationOperation,
} from "@synara/contracts";
import { Effect } from "effect";
import { expect, it } from "vitest";

import {
  SYNARA_MCP_DISABLE_COMMAND,
  SYNARA_MCP_ENABLE_COMMAND,
  SYNARA_MCP_FAILED_ACTIVITY_KIND,
  SYNARA_MCP_PENDING_ACTIVITY_KIND,
  SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND,
  synaraMcpRequestId,
  synaraMcpSessionGeneration,
} from "../src/orchestration/synaraMcpCommand.ts";
import { SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL } from "../src/orchestration/synaraMcpStartupRecovery.ts";
import {
  PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
  PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
} from "../src/provider/piSynaraMcpEnable.ts";
import {
  SYNARA_MCP_DISABLED_ERROR_CODE,
  isPiSynaraMcpDisabledError,
} from "../src/provider/piSynaraMcpToolExecution.ts";

import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";
import {
  makeWsOrchestrationHarness,
  type WsOrchestrationHarness,
} from "./WsOrchestrationHarness.integration.ts";
import { connectSynaraWsClient } from "./synaraWsClient.integration.ts";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value);

/** Minimal fixture turn that starts, emits one assistant delta, and completes. */
const EMPTY_TURN_RESPONSE: TestTurnResponse = {
  events: [
    { type: "turn.started", turnId: "fixture-turn-1" },
    { type: "message.delta", turnId: "fixture-turn-1", delta: "ok.\n" },
    { type: "turn.completed", turnId: "fixture-turn-1", status: "completed" },
  ],
};

/** Observes a promise without ever rejecting: rejection is captured in a result. */
type ObservedCall<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly cause: unknown };

const observePromise = <A>(promise: Promise<A>): Promise<ObservedCall<A>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (cause) => ({ ok: false as const, cause }),
  );

/** Polls a direct (synchronous) predicate over fixture/harness state. */
async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
    await sleep(10);
  }
}

const createProject = async (
  harness: WsOrchestrationHarness,
  projectId: string,
  workspaceRoot: string = harness.workspaceDir,
): Promise<void> => {
  await harness.client.dispatchCommand({
    type: "project.create",
    commandId: `cmd-${projectId}-create-${randomUUID()}`,
    projectId,
    title: `Project ${projectId}`,
    workspaceRoot,
    createdAt: new Date().toISOString(),
  });
};

const createThread = async (
  harness: WsOrchestrationHarness,
  projectId: string,
  threadId: string,
): Promise<void> => {
  await harness.client.dispatchCommand({
    type: "thread.create",
    commandId: `cmd-${threadId}-create-${randomUUID()}`,
    threadId,
    projectId,
    title: `Thread ${threadId}`,
    modelSelection: { provider: "codex", model: DEFAULT_MODEL_BY_PROVIDER.codex },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: null,
    worktreePath: harness.workspaceDir,
    createdAt: new Date().toISOString(),
  });
};

/**
 * Start one normal turn on a fresh session: queues the fixture turn response
 * for the NEXT session that starts (deterministic because turns are
 * dispatched and settled one at a time), dispatches the turn through the real
 * WS boundary, and waits until the projected session is ready with a
 * non-streaming assistant message.
 */
const startSessionTurn = async (
  harness: WsOrchestrationHarness,
  threadId: ThreadId,
  text: string,
): Promise<OrchestrationThread> => {
  await Effect.runPromise(harness.adapterHarness.queueTurnResponseForNextSession(EMPTY_TURN_RESPONSE));
  await harness.client.dispatchCommand({
    type: "thread.turn.start",
    commandId: `cmd-${threadId}-turn-${randomUUID()}`,
    threadId,
    message: {
      messageId: `msg-${threadId}-${randomUUID()}`,
      role: "user",
      text,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: new Date().toISOString(),
  });
  return harness.waitForThread(
    threadId,
    (thread) =>
      thread.session?.status === "ready" &&
      thread.messages.some((message) => message.role === "assistant" && message.streaming === false),
  );
};

/**
 * Start a turn on an ALREADY-EXISTING session (the per-thread fixture queue
 * is used because no new session start consumes the next-session queue).
 */
const startReusedSessionTurn = async (
  harness: WsOrchestrationHarness,
  threadId: ThreadId,
  text: string,
  delta = "ok.\n",
): Promise<OrchestrationThread> => {
  await Effect.runPromise(
    harness.adapterHarness.queueTurnResponse(threadId, {
      events: [
        { type: "turn.started", turnId: "fixture-turn-1" },
        { type: "message.delta", turnId: "fixture-turn-1", delta },
        { type: "turn.completed", turnId: "fixture-turn-1", status: "completed" },
      ],
    }),
  );
  await harness.client.dispatchCommand({
    type: "thread.turn.start",
    commandId: `cmd-${threadId}-turn-${randomUUID()}`,
    threadId,
    message: {
      messageId: `msg-${threadId}-${randomUUID()}`,
      role: "user",
      text,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: new Date().toISOString(),
  });
  return harness.waitForThread(
    threadId,
    (thread) =>
      thread.session?.status === "ready" &&
      thread.messages.some((message) => message.role === "assistant" && message.streaming === false),
  );
};

/** Dispatch a Synara-owned slash command through the real WS boundary. */
const dispatchMcpCommand = async (
  harness: WsOrchestrationHarness,
  threadId: ThreadId,
  commandId: string,
  text: string,
): Promise<number> => {
  const result = await harness.client.dispatchCommand({
    type: "thread.turn.start",
    commandId,
    threadId,
    message: {
      messageId: `msg-${commandId}`,
      role: "user",
      text,
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: new Date().toISOString(),
  });
  return result.sequence;
};

const operationOf = (project: OrchestrationProject): ProjectMcpActivationOperation | null =>
  project.synaraMcpActivationOperation ?? null;

const activityIdsOf = (thread: OrchestrationThread): ReadonlyArray<string> =>
  thread.activities.map((activity) => activity.id);

const countJournalActivities = async (
  harness: WsOrchestrationHarness,
  requestId: string,
  phase: "pending" | "terminal",
): Promise<number> => {
  const events = await harness.client.replayEvents({ fromSequenceExclusive: 0 });
  return events.filter(
    (event) =>
      event.type === "thread.activity-appended" &&
      event.payload.activity.id === `${requestId}:${phase}`,
  ).length;
};

const journalHasSlashMessage = async (
  harness: WsOrchestrationHarness,
  text: string,
): Promise<boolean> => {
  const events = await harness.client.replayEvents({ fromSequenceExclusive: 0 });
  return events.some(
    (event) =>
      event.type === "thread.message-sent" &&
      (event.payload as { text?: unknown }).text === text,
  );
};

const readThreadSnapshot = async (harness: WsOrchestrationHarness, threadId: ThreadId) =>
  Effect.runPromise(harness.adapterHarness.adapter.readThread(threadId));

// ---------------------------------------------------------------------------
// Journey 2 (WP4 slice)
// ---------------------------------------------------------------------------
it(
  "WP4 journey: disable during an in-flight MCP call with fence/settle ordering, structured exactly-once settlement, turn continuity, no replay, duplicate idempotency",
  async () => {
    const harness = await makeWsOrchestrationHarness({ provider: "codex" });
    try {
      const threadC = asThreadId("thread-mcp-c");
      const threadD = asThreadId("thread-mcp-d");
      const projectId = "project-wp4";

      // --- Two current sessions, enabled project-wide. ---
      await createProject(harness, projectId);
      await createThread(harness, projectId, String(threadC));
      await createThread(harness, projectId, String(threadD));
      await startSessionTurn(harness, threadC, "hello C");
      await startSessionTurn(harness, threadD, "hello D");
      const enableCommandId = "cmd-wp4-enable-1";
      await dispatchMcpCommand(harness, threadC, enableCommandId, SYNARA_MCP_ENABLE_COMMAND);
      await harness.waitForProject(
        projectId,
        (project) => operationOf(project)?.aggregateStatus === "succeeded",
      );
      expect(harness.adapterHarness.getEnableCalls(threadC)).toHaveLength(1);
      expect(harness.adapterHarness.getEnableCalls(threadD)).toHaveLength(1);
      expect(harness.adapterHarness.getDisableCalls(threadC)).toEqual([]);

      // --- Subject-bound MCP use is admitted while enabled. ---
      const usedCall = observePromise(
        harness.adapterHarness.startSynaraMcpCall(threadC, () => Promise.resolve("mcp-ok")),
      );
      const used = await Effect.runPromise(Effect.promise(() => usedCall));
      expect(used.ok).toBe(true);
      if (used.ok) {
        expect(used.value).toBe("mcp-ok");
      }

      // --- An in-flight MCP call is running when disable arrives. ---
      let handlerCalls = 0;
      let capturedSignal: AbortSignal | undefined;
      const inflightCall = harness.adapterHarness.startSynaraMcpCall(threadC, (signal) => {
        handlerCalls += 1;
        capturedSignal = signal;
        return new Promise<never>(() => {});
      });
      const observedInflight = observePromise(inflightCall);
      expect(harness.adapterHarness.getSynaraMcpInFlightCount(threadC)).toBe(1);

      // --- Pi turn continuity: a normal turn runs to completion while the
      // MCP call is still in flight; disable never interrupts the turn. ---
      await Effect.runPromise(
        harness.adapterHarness.queueTurnResponse(threadC, {
          events: [
            { type: "turn.started", turnId: "fixture-turn-2" },
            { type: "message.delta", turnId: "fixture-turn-2", delta: "turn while call in flight.\n" },
            { type: "turn.completed", turnId: "fixture-turn-2", status: "completed" },
          ],
        }),
      );
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: `cmd-${threadC}-continuity-${randomUUID()}`,
        threadId: threadC,
        message: {
          messageId: `msg-${threadC}-continuity-${randomUUID()}`,
          role: "user",
          text: "continue while the MCP call is in flight",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      });
      const continued = await harness.waitForThread(threadC, (thread) =>
        thread.messages.some((message) => message.text === "turn while call in flight.\n"),
      );
      expect(continued.session?.status).toBe("ready");
      expect(harness.adapterHarness.getInterruptCalls(threadC)).toEqual([]);
      // The MCP call is still in flight after the turn completed.
      expect(harness.adapterHarness.getSynaraMcpInFlightCount(threadC)).toBe(1);

      // --- Disable during the in-flight MCP call. ---
      const disableCommandId = "cmd-wp4-disable-1";
      const disableRequestId = synaraMcpRequestId(disableCommandId);
      await dispatchMcpCommand(harness, threadC, disableCommandId, SYNARA_MCP_DISABLE_COMMAND);

      const pendingDisable = await harness.waitForThread(threadC, (thread) =>
        thread.activities.some(
          (activity) =>
            activity.id === `${disableRequestId}:pending` &&
            activity.kind === SYNARA_MCP_PENDING_ACTIVITY_KIND,
        ),
      );
      expect(
        pendingDisable.activities.find((activity) => activity.id === `${disableRequestId}:pending`)!
          .payload,
      ).toMatchObject({
        requestId: disableRequestId,
        command: "disable",
        phase: "pending",
        status: "pending",
        requestedState: "disabled",
      });

      const disabledProject = await harness.waitForProject(
        projectId,
        (project) =>
          operationOf(project)?.aggregateStatus === "succeeded" &&
          operationOf(project)?.desiredState === "disabled",
      );
      expect(operationOf(disabledProject)?.desiredState).toBe("disabled");

      // --- Fence/settle/cancel/revoke/reload ordering on the issuing member
      // and on the sibling; the in-flight call settled exactly once with the
      // structured disabled error and its gateway signal aborted. ---
      expect(harness.adapterHarness.getDisableCalls(threadC)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
      ]);
      expect(harness.adapterHarness.getDisableCalls(threadD)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
      ]);
      await waitFor("in-flight MCP call settled as disabled", () =>
        harness.adapterHarness.getSynaraMcpDisabledSettledCount(threadC) === 1,
      );
      expect(harness.adapterHarness.getSynaraMcpInFlightCount(threadC)).toBe(0);
      const observedSettled = await Effect.runPromise(Effect.promise(() => observedInflight));
      expect(observedSettled.ok).toBe(false);
      if (!observedSettled.ok) {
        expect(isPiSynaraMcpDisabledError(observedSettled.cause)).toBe(true);
        expect((observedSettled.cause as { code?: string }).code).toBe(
          SYNARA_MCP_DISABLED_ERROR_CODE,
        );
      }
      expect(capturedSignal?.aborted).toBe(true);
      expect((capturedSignal?.reason as { code?: string } | undefined)?.code).toBe(
        SYNARA_MCP_DISABLED_ERROR_CODE,
      );

      // --- Exactly-once terminal for the disable command. ---
      const terminalDisable = await harness.waitForThread(threadC, (thread) =>
        thread.activities.some(
          (activity) =>
            activity.id === `${disableRequestId}:terminal` &&
            activity.kind === SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND,
        ),
      );
      const disableTerminals = terminalDisable.activities.filter(
        (activity) => activity.id === `${disableRequestId}:terminal`,
      );
      expect(disableTerminals).toHaveLength(1);
      expect(disableTerminals[0]!.turnId).toBeNull();
      expect(disableTerminals[0]!.payload).toMatchObject({
        requestId: disableRequestId,
        command: "disable",
        phase: "terminal",
        status: "succeeded",
        requestedState: "disabled",
        finalState: "disabled",
      });
      expect(await countJournalActivities(harness, disableRequestId, "terminal")).toBe(1);
      expect(await countJournalActivities(harness, disableRequestId, "pending")).toBe(1);

      // --- No replay: the settled call's handler never re-runs. ---
      await sleep(100);
      expect(handlerCalls).toBe(1);
      expect(harness.adapterHarness.getSynaraMcpDisabledSettledCount(threadC)).toBe(1);

      // --- Fail closed: a post-fence admission is rejected before its
      // handler starts. ---
      const fencedAdmission = observePromise(
        harness.adapterHarness.startSynaraMcpCall(threadC, () => {
          handlerCalls += 1;
          return Promise.resolve("never");
        }),
      );
      const observedFenced = await Effect.runPromise(Effect.promise(() => fencedAdmission));
      expect(observedFenced.ok).toBe(false);
      if (!observedFenced.ok) {
        expect(isPiSynaraMcpDisabledError(observedFenced.cause)).toBe(true);
      }
      expect(handlerCalls).toBe(1);

      // --- Duplicate disable is idempotent: the fence is reinstalled, no
      // further staging, no second settlement, exactly one new terminal. ---
      const duplicateDisableCommandId = "cmd-wp4-disable-2";
      const duplicateRequestId = synaraMcpRequestId(duplicateDisableCommandId);
      await dispatchMcpCommand(harness, threadC, duplicateDisableCommandId, SYNARA_MCP_DISABLE_COMMAND);
      await harness.waitForThread(threadC, (thread) =>
        thread.activities.some(
          (activity) =>
            activity.id === `${duplicateRequestId}:terminal` &&
            activity.kind === SYNARA_MCP_SUCCEEDED_ACTIVITY_KIND,
        ),
      );
      expect(harness.adapterHarness.getDisableCalls(threadC)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
        { stages: ["fence"] },
      ]);
      expect(harness.adapterHarness.getDisableCalls(threadD)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
        { stages: ["fence"] },
      ]);
      expect(harness.adapterHarness.getSynaraMcpDisabledSettledCount(threadC)).toBe(1);
      expect(await countJournalActivities(harness, duplicateRequestId, "terminal")).toBe(1);

      // --- No turn interrupt anywhere in the journey; the session surface
      // stays usable after disable (Pi turn continuity). ---
      expect(harness.adapterHarness.getInterruptCalls(threadC)).toEqual([]);
      expect(harness.adapterHarness.getInterruptCalls(threadD)).toEqual([]);
      expect(harness.adapterHarness.listActiveSessionIds()).toEqual([
        String(threadC),
        String(threadD),
      ]);
      await Effect.runPromise(
        harness.adapterHarness.queueTurnResponse(threadC, {
          events: [
            { type: "turn.started", turnId: "fixture-turn-3" },
            { type: "message.delta", turnId: "fixture-turn-3", delta: "after disable.\n" },
            { type: "turn.completed", turnId: "fixture-turn-3", status: "completed" },
          ],
        }),
      );
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: `cmd-${threadC}-after-disable-${randomUUID()}`,
        threadId: threadC,
        message: {
          messageId: `msg-${threadC}-after-disable-${randomUUID()}`,
          role: "user",
          text: "work after disable",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      });
      const afterDisable = await harness.waitForThread(threadC, (thread) =>
        thread.messages.some((message) => message.text === "after disable.\n"),
      );
      expect(afterDisable.session?.status).toBe("ready");

      // --- No slash-command message or provider-turn contamination. ---
      expect(await journalHasSlashMessage(harness, SYNARA_MCP_DISABLE_COMMAND)).toBe(false);
      const providerTurnSnapshot = await readThreadSnapshot(harness, threadC);
      expect(providerTurnSnapshot.turns).toHaveLength(3);
    } finally {
      await harness.dispose();
      await harness.dispose();
    }
  },
  180_000,
);

// ---------------------------------------------------------------------------
// Journey 3 (WP5 slice)
// ---------------------------------------------------------------------------
it(
  "WP5 journey: future-session waiting, failed-sibling global rollback with sibling cleanup, and restart recovery with exactly-once terminal and zero provider replay",
  async () => {
    // The restart leg points a second harness at the same durable SQLite
    // state, so the root must be test-owned (never auto-deleted by dispose).
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "synara-mcp-wp5-"));
    const harness1 = await makeWsOrchestrationHarness({ provider: "codex", reuseRootDir: rootDir });
    let harness2: WsOrchestrationHarness | null = null;
    try {
      const threadE = asThreadId("thread-mcp-e");
      const threadF = asThreadId("thread-mcp-f");
      const threadG = asThreadId("thread-mcp-g");
      const projectRollback = "project-wp5-rollback";

      // --- Part A: failed-sibling activation rolls the whole project back
      // to disabled and cleans the successful sibling. ---
      await createProject(harness1, projectRollback);
      await createThread(harness1, projectRollback, String(threadE));
      await createThread(harness1, projectRollback, String(threadF));
      await startSessionTurn(harness1, threadE, "hello E");
      await startSessionTurn(harness1, threadF, "hello F");
      await Effect.runPromise(harness1.adapterHarness.configureEnableOutcome(threadE, "succeed"));
      await Effect.runPromise(harness1.adapterHarness.configureEnableOutcome(threadF, "fail"));
      const rollbackEnableCommandId = "cmd-wp5-enable-1";
      const rollbackRequestId = synaraMcpRequestId(rollbackEnableCommandId);
      await dispatchMcpCommand(
        harness1,
        threadE,
        rollbackEnableCommandId,
        SYNARA_MCP_ENABLE_COMMAND,
      );
      const rollbackProject = await harness1.waitForProject(
        projectRollback,
        (project) => operationOf(project)?.aggregateStatus === "failed",
      );
      const rollbackOperation = operationOf(rollbackProject)!;
      expect(rollbackOperation.desiredState).toBe("disabled");
      expect(rollbackOperation.waitSet).toEqual([
        { sessionId: String(threadE), sessionGeneration: expect.any(String) as unknown },
        { sessionId: String(threadF), sessionGeneration: expect.any(String) as unknown },
      ]);
      expect(rollbackOperation.outcomes.map((outcome) => [outcome.sessionId, outcome.status])).toEqual([
        [String(threadE), "failed"],
        [String(threadF), "failed"],
      ]);
      // The rollback journal-first semantics mark EVERY captured member's
      // durable outcome failed (the failed sibling's bounded detail is the
      // activation failure that triggered the rollback).
      const eOutcome = rollbackOperation.outcomes.find(
        (outcome) => outcome.sessionId === String(threadE),
      )!;
      expect(eOutcome.detail).toBe(PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL);
      const fOutcome = rollbackOperation.outcomes.find(
        (outcome) => outcome.sessionId === String(threadF),
      )!;
      expect(fOutcome.detail).toBe(PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL);

      // The successful sibling is cleaned by the rollback (full ordered
      // disable); the failed sibling never activated (synchronous fence
      // only). Exactly one disable per member: no replay.
      expect(harness1.adapterHarness.getEnableCalls(threadE)).toHaveLength(1);
      expect(harness1.adapterHarness.getEnableCalls(threadF)).toHaveLength(1);
      expect(harness1.adapterHarness.getDisableCalls(threadE)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
      ]);
      expect(harness1.adapterHarness.getDisableCalls(threadF)).toEqual([{ stages: ["fence"] }]);
      expect(harness1.adapterHarness.getInterruptCalls(threadE)).toEqual([]);
      expect(harness1.adapterHarness.getInterruptCalls(threadF)).toEqual([]);

      // Exactly one failed terminal with the bounded activation detail.
      const rollbackTerminalThread = await harness1.waitForThread(
        threadE,
        (thread) =>
          thread.activities.some(
            (activity) =>
              activity.id === `${rollbackRequestId}:terminal` &&
              activity.kind === SYNARA_MCP_FAILED_ACTIVITY_KIND,
          ),
      );
      const rollbackTerminals = rollbackTerminalThread.activities.filter(
        (activity) => activity.id === `${rollbackRequestId}:terminal`,
      );
      expect(rollbackTerminals).toHaveLength(1);
      expect(rollbackTerminals[0]!.payload).toMatchObject({
        requestId: rollbackRequestId,
        command: "enable",
        phase: "terminal",
        status: "failed",
        finalState: "disabled",
        detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
      });
      expect(await countJournalActivities(harness1, rollbackRequestId, "terminal")).toBe(1);
      expect(await journalHasSlashMessage(harness1, SYNARA_MCP_ENABLE_COMMAND)).toBe(false);

      // --- Part B: a session created during a pending enable waits for the
      // operation terminal and never joins the wait-set; after terminal
      // enabled it activates under its own fresh generation. ---
      await Effect.runPromise(harness1.adapterHarness.configureEnableOutcome(threadE, "defer"));
      await Effect.runPromise(harness1.adapterHarness.configureEnableOutcome(threadF, "succeed"));
      const retryEnableCommandId = "cmd-wp5-enable-2";
      const retryRequestId = synaraMcpRequestId(retryEnableCommandId);
      await dispatchMcpCommand(harness1, threadE, retryEnableCommandId, SYNARA_MCP_ENABLE_COMMAND);
      await harness1.waitForProject(
        projectRollback,
        (project) =>
          operationOf(project)?.requestId === retryRequestId &&
          operationOf(project)?.aggregateStatus === "pending",
      );
      await waitFor("deferred retry enable call on thread E", () =>
        harness1.adapterHarness.getEnableCalls(threadE).length === 2,
      );

      // Future session G starts and completes a normal turn while the enable
      // is pending: its convergence WAITS (dormant, no enable call) and the
      // immutable wait-set never gains G.
      await createThread(harness1, projectRollback, String(threadG));
      await startSessionTurn(harness1, threadG, "hello G during pending enable");
      expect(harness1.adapterHarness.getEnableCalls(threadG)).toEqual([]);
      const pendingWithFuture = await harness1.waitForProject(
        projectRollback,
        (project) => operationOf(project)?.requestId === retryRequestId,
      );
      expect(pendingWithFuture.synaraMcpActivationOperation!.waitSet.map((member) => member.sessionId)).toEqual([
        String(threadE),
        String(threadF),
      ]);

      await Effect.runPromise(harness1.adapterHarness.releaseEnable(threadE));
      await harness1.waitForProject(
        projectRollback,
        (project) =>
          operationOf(project)?.requestId === retryRequestId &&
          operationOf(project)?.aggregateStatus === "succeeded",
      );
      expect(harness1.adapterHarness.getEnableCalls(threadE)).toHaveLength(2);
      expect(harness1.adapterHarness.getEnableCalls(threadF)).toHaveLength(2);
      expect(await countJournalActivities(harness1, retryRequestId, "terminal")).toBe(1);

      // The waiting future session converges only from the FINAL durable
      // state: the next session ensure activates it under a fresh exact
      // generation (subject-bound, generation-bound).
      await startReusedSessionTurn(harness1, threadG, "second turn after terminal enabled");
      await waitFor("future session G converged to active", () =>
        harness1.adapterHarness.getEnableCalls(threadG).length === 1,
      );
      const gEnableCalls = harness1.adapterHarness.getEnableCalls(threadG);
      expect(gEnableCalls[0]!.expectedSessionGeneration).toBe(
        gEnableCalls[0]!.liveSessionGeneration,
      );
      expect(gEnableCalls[0]!.expectedSessionGeneration).toContain("orchestration:thread-mcp-g:");
      const gCall = observePromise(
        harness1.adapterHarness.startSynaraMcpCall(threadG, () => Promise.resolve("g-ok")),
      );
      const gUsed = await Effect.runPromise(Effect.promise(() => gCall));
      expect(gUsed.ok).toBe(true);
      if (gUsed.ok) {
        expect(gUsed.value).toBe("g-ok");
      }

      // --- Part C: restart recovery settles the durable pending enable with
      // exactly one deterministic terminal and zero provider replay. The
      // pending enable runs on a SEPARATE still-disabled project (a project
      // that is terminal-enabled would already have converged its new
      // sessions to active), so the restart recovery must roll this project
      // back to disabled from the persisted operation alone. ---
      const threadH = asThreadId("thread-mcp-h");
      const threadI = asThreadId("thread-mcp-i");
      const projectRecovery = "project-wp5-recovery";
      const recoveryWorkspace = path.join(harness1.workspaceDir, "recovery-workspace");
      fs.mkdirSync(recoveryWorkspace, { recursive: true });
      await createProject(harness1, projectRecovery, recoveryWorkspace);
      await createThread(harness1, projectRecovery, String(threadH));
      await createThread(harness1, projectRecovery, String(threadI));
      await startSessionTurn(harness1, threadH, "hello H");
      await startSessionTurn(harness1, threadI, "hello I");
      await Effect.runPromise(harness1.adapterHarness.configureEnableOutcome(threadH, "defer"));
      const recoveryEnableCommandId = "cmd-wp5-enable-3";
      const recoveryRequestId = synaraMcpRequestId(recoveryEnableCommandId);
      await dispatchMcpCommand(
        harness1,
        threadH,
        recoveryEnableCommandId,
        SYNARA_MCP_ENABLE_COMMAND,
      );
      await harness1.waitForProject(
        projectRecovery,
        (project) =>
          operationOf(project)?.requestId === recoveryRequestId &&
          operationOf(project)?.aggregateStatus === "pending",
      );
      await waitFor("deferred recovery enable call on thread H", () =>
        harness1.adapterHarness.getEnableCalls(threadH).length === 1,
      );

      // The server restarts with the operation still pending (never
      // released). Dispose without settling.
      await harness1.dispose();

      // Second harness over the SAME durable state runs startup recovery
      // before it is command-ready.
      harness2 = await makeWsOrchestrationHarness({ provider: "codex", reuseRootDir: rootDir });
      const recoveredProject = await harness2.waitForProject(
        projectRecovery,
        (project) =>
          operationOf(project)?.requestId === recoveryRequestId &&
          operationOf(project)?.aggregateStatus === "failed",
      );
      const recoveredOperation = operationOf(recoveredProject)!;
      expect(recoveredOperation.desiredState).toBe("disabled");
      expect(recoveredOperation.recoveryIdentity).toBeDefined();
      // Every captured member's durable outcome is failed-disabled; the
      // wait-set is the immutable capture from before the restart.
      expect(recoveredOperation.waitSet.length).toBe(2);
      expect(recoveredOperation.outcomes).toHaveLength(2);
      for (const outcome of recoveredOperation.outcomes) {
        expect(outcome.status).toBe("failed");
        expect(outcome.detail).toContain(SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL);
      }

      // Exactly-once deterministic terminal (same id the live resolution
      // would have used) with the bounded recovery detail, turnId null.
      const recoveredTerminalThread = await harness2.waitForThread(
        threadH,
        (thread) =>
          thread.activities.some(
            (activity) =>
              activity.id === `${recoveryRequestId}:terminal` &&
              activity.kind === SYNARA_MCP_FAILED_ACTIVITY_KIND,
          ),
      );
      const recoveredTerminals = recoveredTerminalThread.activities.filter(
        (activity) => activity.id === `${recoveryRequestId}:terminal`,
      );
      expect(recoveredTerminals).toHaveLength(1);
      expect(recoveredTerminals[0]!.turnId).toBeNull();
      expect(recoveredTerminals[0]!.payload).toMatchObject({
        requestId: recoveryRequestId,
        command: "enable",
        phase: "terminal",
        status: "failed",
        finalState: "disabled",
      });
      expect(
        String((recoveredTerminals[0]!.payload as { detail?: string }).detail),
      ).toContain(SYNARA_MCP_RECOVERY_ENABLE_ROLLBACK_DETAIL);
      // The durable pending activity from before the restart survives exactly
      // once, and the journal carries exactly one terminal for this request.
      expect(
        recoveredTerminalThread.activities.filter(
          (activity) => activity.id === `${recoveryRequestId}:pending`,
        ),
      ).toHaveLength(1);
      expect(await countJournalActivities(harness2, recoveryRequestId, "terminal")).toBe(1);
      expect(await countJournalActivities(harness2, recoveryRequestId, "pending")).toBe(1);

      // Zero provider/MCP replay during recovery: no enable, disable, or
      // session-start call reached the fresh adapter harness.
      expect(harness2.adapterHarness.getStartCount()).toBe(0);
      expect(harness2.adapterHarness.getEnableCalls(threadH)).toEqual([]);
      expect(harness2.adapterHarness.getEnableCalls(threadI)).toEqual([]);
      expect(harness2.adapterHarness.getDisableCalls(threadH)).toEqual([]);
      expect(harness2.adapterHarness.getDisableCalls(threadI)).toEqual([]);
      expect(harness2.adapterHarness.getSynaraMcpDisabledSettledCount(threadH)).toBe(0);

      // A session recreated after the rollback stays dormant: the project is
      // terminal disabled, so its convergence never activates (no replay).
      await startSessionTurn(harness2, threadH, "turn after restart");
      expect(harness2.adapterHarness.getStartCount()).toBe(1);
      expect(harness2.adapterHarness.getEnableCalls(threadH)).toEqual([]);
      const restartedThread = await harness2.waitForThread(
        threadH,
        (thread) =>
          thread.session?.status === "ready" &&
          thread.messages.some((message) => message.text === "ok.\n"),
      );
      expect(restartedThread.session?.status).toBe("ready");
    } finally {
      await harness2?.dispose();
      await harness1.dispose();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  },
  240_000,
);

// ---------------------------------------------------------------------------
// Journey 1 (WP3 slice)
// ---------------------------------------------------------------------------
it(
  "WP3 journey: dormant startup, multi-session enable with pending/terminal, generation-fenced failure rollback, reconnect/replay equivalence, zero contamination",
  async () => {
    const harness = await makeWsOrchestrationHarness({ provider: "codex" });
    try {
      const threadA = asThreadId("thread-mcp-a");
      const threadB = asThreadId("thread-mcp-b");
      const projectId = "project-wp3";

      // --- Dormant startup: zero provider/MCP activity before any command. ---
      expect(harness.adapterHarness.getStartCount()).toBe(0);
      expect(harness.adapterHarness.getEnableCalls(threadA)).toEqual([]);
      expect(harness.adapterHarness.getDisableCalls(threadA)).toEqual([]);
      const dormantSnapshot = await harness.client.getSnapshot();
      expect(dormantSnapshot.projects).toHaveLength(0);
      expect(await journalHasSlashMessage(harness, SYNARA_MCP_ENABLE_COMMAND)).toBe(false);

      // --- Two current sessions, one project. ---
      await createProject(harness, projectId);
      await createThread(harness, projectId, String(threadA));
      await createThread(harness, projectId, String(threadB));
      const readyA = await startSessionTurn(harness, threadA, "hello A");
      const readyB = await startSessionTurn(harness, threadB, "hello B");
      expect(harness.adapterHarness.getStartCount()).toBe(2);
      // The sessions captured the server-minted subject-bound MCP authority
      // from the session-start contract (Decision 21): a live local-owner
      // record that the shared admission boundary accepts.
      const authorityA = harness.adapterHarness.getMcpAuthority(threadA);
      const authorityB = harness.adapterHarness.getMcpAuthority(threadB);
      expect(authorityA).not.toBeNull();
      expect(authorityB).not.toBeNull();
      if (authorityA !== undefined && authorityB !== undefined) {
        expect(authorityA.kind).toBe("local-owner");
        expect(authorityB.kind).toBe("local-owner");
        const record = harness.authority.get(authorityA.authorityId);
        expect(record).toBeDefined();
        expect(record?.status).toBe("active");
        expect(record?.subject).toBe(authorityA.subject);
        // Fail-closed admission check against trusted registry state: the
        // session's subject-bound credential is currently admittable.
        expect(harness.authority.assertAdmittable(authorityA)).toBeNull();
        expect(harness.authority.assertAdmittable(authorityB)).toBeNull();
      }

      // Capture the exact session generations the wait-set will be minted
      // from (the enable acceptance snapshot).
      const sessionAUpdatedAt = readyA.session!.updatedAt;
      const sessionBUpdatedAt = readyB.session!.updatedAt;
      const tokenA = synaraMcpSessionGeneration(threadA, sessionAUpdatedAt);
      const tokenB = synaraMcpSessionGeneration(threadB, sessionBUpdatedAt);

      // --- Enable with the first wait-set member deferred (holds the
      // reconciliation open while the failure is induced on the sibling). ---
      await Effect.runPromise(harness.adapterHarness.configureEnableOutcome(threadA, "defer"));
      const enableCommandId = "cmd-wp3-enable-1";
      const requestId = synaraMcpRequestId(enableCommandId);
      const enableSequence = await dispatchMcpCommand(
        harness,
        threadA,
        enableCommandId,
        SYNARA_MCP_ENABLE_COMMAND,
      );
      expect(enableSequence).toBeGreaterThanOrEqual(0);

      // Pending acknowledgement is durable and deterministic before the
      // terminal: one pending activity with the deterministic phase id,
      // turnId null, and the shared requestId.
      const pendingThread = await harness.waitForThread(threadA, (thread) =>
        thread.activities.some(
          (activity) =>
            activity.id === `${requestId}:pending` &&
            activity.kind === SYNARA_MCP_PENDING_ACTIVITY_KIND,
        ),
      );
      const pendingActivity = pendingThread.activities.find(
        (activity) => activity.id === `${requestId}:pending`,
      )!;
      expect(pendingActivity.turnId).toBeNull();
      expect(pendingActivity.payload).toMatchObject({
        requestId,
        command: "enable",
        phase: "pending",
        status: "pending",
        requestedState: "enabled",
      });
      expect(await countJournalActivities(harness, requestId, "pending")).toBe(1);

      // The durable wait-set captured BOTH current sessions immutably with
      // the full acceptance-time generation tokens; the operation is pending
      // with a bounded deadline and the impl-09 recovery identity.
      const pendingProject = await harness.waitForProject(
        projectId,
        (project) => operationOf(project)?.aggregateStatus === "pending",
      );
      const pendingOperation = operationOf(pendingProject)!;
      expect(pendingOperation.requestId).toBe(requestId);
      expect(pendingOperation.desiredState).toBe("enabled");
      expect(pendingOperation.issuingThreadId).toBe(String(threadA));
      expect(pendingOperation.recoveryIdentity).toBeDefined();
      expect(Date.parse(pendingOperation.absoluteDeadline)).toBeGreaterThan(Date.now());
      expect(pendingOperation.waitSet).toEqual([
        { sessionId: String(threadA), sessionGeneration: tokenA },
        { sessionId: String(threadB), sessionGeneration: tokenB },
      ]);

      // The reconcile reached the deferred member: its enable call records
      // the exact captured vs live generation pair (generation-bound).
      await waitFor("deferred enable call on thread A", () =>
        harness.adapterHarness.getEnableCalls(threadA).length === 1,
      );
      expect(harness.adapterHarness.getEnableCalls(threadA)).toEqual([
        { expectedSessionGeneration: tokenA, liveSessionGeneration: tokenA },
      ]);

      // --- Active-turn-safe window: a sibling turn runs (and fails) while
      // the enable is still pending. This is the authority/activation
      // failure: the failing turn moves the sibling session to a NEW session
      // generation, so the live generation no longer matches the captured
      // wait-set token and the provider enable boundary must fail closed. ---
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: `cmd-${threadB}-fail-${randomUUID()}`,
        threadId: threadB,
        message: {
          messageId: `msg-${threadB}-fail-${randomUUID()}`,
          role: "user",
          text: "induce a session error",
          attachments: [],
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        createdAt: new Date().toISOString(),
      });
      const erroredB = await harness.waitForThread(
        threadB,
        (thread) => thread.session?.status === "error",
      );
      const sessionBErrorUpdatedAt = erroredB.session!.updatedAt;
      expect(sessionBErrorUpdatedAt).not.toBe(sessionBUpdatedAt);

      // Release the deferred member: it activates, then the stale sibling is
      // refused and the whole project rolls back to disabled.
      await Effect.runPromise(harness.adapterHarness.releaseEnable(threadA));


      // Exactly one durable terminal outcome: failed-disabled rollback with
      // the bounded generation-fencing detail.
      const failedProject = await harness.waitForProject(
        projectId,
        (project) => operationOf(project)?.aggregateStatus === "failed",
      );
      const failedOperation = operationOf(failedProject)!;
      expect(failedOperation.desiredState).toBe("disabled");
      expect(failedOperation.aggregateStatus).toBe("failed");
      expect(failedOperation.waitSet).toEqual([
        { sessionId: String(threadA), sessionGeneration: tokenA },
        { sessionId: String(threadB), sessionGeneration: tokenB },
      ]);
      expect(failedOperation.outcomes).toEqual([
        {
          sessionId: String(threadA),
          sessionGeneration: tokenA,
          status: "failed",
          detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
          updatedAt: expect.any(String) as unknown,
        },
        {
          sessionId: String(threadB),
          sessionGeneration: tokenB,
          status: "failed",
          detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
          updatedAt: expect.any(String) as unknown,
        },
      ]);

      // The sibling's enable call proves the generation fencing: the live
      // session generation no longer matches the captured wait-set token.
      const enableCallsB = harness.adapterHarness.getEnableCalls(threadB);
      expect(enableCallsB).toHaveLength(1);
      expect(enableCallsB[0]).toEqual({
        expectedSessionGeneration: tokenB,
        liveSessionGeneration: synaraMcpSessionGeneration(threadB, sessionBErrorUpdatedAt),
      });
      expect(enableCallsB[0]!.expectedSessionGeneration).not.toBe(
        enableCallsB[0]!.liveSessionGeneration,
      );

      // Rollback cleanup: the activated member receives the full ordered
      // disable sequence, the never-activated member only the synchronous
      // fence. Exactly one disable per member: no replay.
      expect(harness.adapterHarness.getDisableCalls(threadA)).toEqual([
        { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
      ]);
      expect(harness.adapterHarness.getDisableCalls(threadB)).toEqual([
        { stages: ["fence"] },
      ]);
      expect(harness.adapterHarness.getInterruptCalls(threadA)).toEqual([]);
      expect(harness.adapterHarness.getInterruptCalls(threadB)).toEqual([]);
      expect(harness.adapterHarness.getSynaraMcpDisabledSettledCount(threadA)).toBe(0);

      // Exactly-once terminal: one failed terminal activity with the
      // deterministic id, finalState disabled, turnId null, bounded detail.
      const terminalThread = await harness.waitForThread(threadA, (thread) =>
        thread.activities.some(
          (activity) =>
            activity.id === `${requestId}:terminal` &&
            activity.kind === SYNARA_MCP_FAILED_ACTIVITY_KIND,
        ),
      );
      expect(activityIdsOf(terminalThread).filter((id) => id === `${requestId}:pending`)).toHaveLength(1);
      const terminalActivities = terminalThread.activities.filter(
        (activity) => activity.id === `${requestId}:terminal`,
      );
      expect(terminalActivities).toHaveLength(1);
      const terminalActivity = terminalActivities[0]!;
      expect(terminalActivity.turnId).toBeNull();
      expect(terminalActivity.payload).toMatchObject({
        requestId,
        command: "enable",
        phase: "terminal",
        status: "failed",
        requestedState: "enabled",
        finalState: "disabled",
        detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
      });
      expect(await countJournalActivities(harness, requestId, "terminal")).toBe(1);
      expect(await countJournalActivities(harness, requestId, "pending")).toBe(1);

      // No slash-command message or provider-turn contamination: the enable
      // command never entered the message log and never produced a provider
      // turn (the provider turn count is still the two hello turns).
      expect(await journalHasSlashMessage(harness, SYNARA_MCP_ENABLE_COMMAND)).toBe(false);
      const snapshotThreadA = (await harness.client.getSnapshot()).threads.find(
        (thread) => thread.id === String(threadA),
      )!;
      expect(snapshotThreadA.messages.some((message) => message.text === SYNARA_MCP_ENABLE_COMMAND)).toBe(false);
      const providerTurnSnapshot = await readThreadSnapshot(harness, threadA);
      expect(providerTurnSnapshot.turns).toHaveLength(1);
      expect(harness.adapterHarness.getStartCount()).toBe(2);

      // --- Reconnect/replay equivalence: a fresh WS connection observes the
      // same durable journal and projection with the same deterministic
      // activity ids (no duplicate terminal, no lost state). ---
      await harness.client.close();
      const reconnected = await connectSynaraWsClient(harness.port);
      try {
        const reconnectedSnapshot = await reconnected.getSnapshot();
        const reconnectedProject = reconnectedSnapshot.projects.find(
          (project) => project.id === projectId,
        )!;
        expect(operationOf(reconnectedProject)?.aggregateStatus).toBe("failed");
        expect(operationOf(reconnectedProject)?.desiredState).toBe("disabled");
        expect(
          reconnectedSnapshot.threads
            .find((thread) => thread.id === String(threadA))!
            .activities.filter((activity) => activity.id === `${requestId}:terminal`),
        ).toHaveLength(1);
        const replayed = await reconnected.replayEvents({ fromSequenceExclusive: 0 });
        expect(
          replayed.filter(
            (event) =>
              event.type === "thread.activity-appended" &&
              event.payload.activity.id === `${requestId}:terminal`,
          ),
        ).toHaveLength(1);
        expect(
          replayed.filter(
            (event) =>
              event.type === "thread.activity-appended" &&
              event.payload.activity.id === `${requestId}:pending`,
          ),
        ).toHaveLength(1);
      } finally {
        await reconnected.close();
      }
    } finally {
      await harness.dispose();
      await harness.dispose();
    }
  },
  180_000,
);
