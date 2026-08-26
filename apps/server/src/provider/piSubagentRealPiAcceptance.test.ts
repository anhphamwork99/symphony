/**
 * Ticket 17 — Integrated real-Pi acceptance smoke, vertical slice 3
 * (approved stages 0–4).
 *
 * ONE hermetic file chains the production server composition (real
 * OrchestrationEngine → ProviderCommandReactor → durable ProviderService →
 * REAL PiAdapter → real pinned Alfie pi-subagents extension) behind a real
 * loopback HTTP/WebSocket server and drives it ONLY through the public
 * WebSocket RPC boundary (`dispatchCommand`, `getThreadDetailSnapshot`,
 * `server.getSettings`, `server.updateSettings`):
 *
 *   STAGE 0  [T17-AC8/AC9] pinned-extension provenance + owned isolation:
 *            explicit temp agent dirs (parent via the public
 *            `server.updateSettings` Pi agentDir seam, child via
 *            PI_CODING_AGENT_DIR), temp state/home/workspace, loopback port 0,
 *            no user ~/.pi or env mutation, stable stage diagnostics.
 *   STAGE 1  [T17-AC1] a real managed Pi execution starts through the
 *            production WS path (or the accepted direct live Agent-tool
 *            fallback behind that same real WS composition, with calibration
 *            evidence) and identity continuity holds from the durable row to
 *            the WS execution card.
 *   STAGE 2  [T17-AC2] standalone bounded detach within wait + 500 ms
 *            (journal-first envelope), bounded/latest progress, then a
 *            genuinely NEW WebSocket client obtains fresh thread detail with
 *            the execution card restored (reconnect hydration).
 *   STAGE 3  [T17-AC9] real durable single-execution cancellation through
 *            the public WS card-cancel command: cancelling intent visible
 *            before terminal acknowledgement, durable seq 90 → seq 92
 *            continuity for the current attempt/generation, and bridge
 *            active-registry cleanup after settlement.
 *   STAGE 4  [T17-AC4] two real background slow children under one parent
 *            thread complete inside one bounded completion batch window,
 *            produce exactly one accepted parent follow-up, and each
 *            execution result remains individually retrievable through the
 *            public read RPC without identity conflation.
 *
 * The ONLY fixture is the deterministic loopback model endpoint (owner
 * approved seam): every model call that reaches it comes from a real Pi
 * session spawned by the real production graph. Provider fakes cannot pass
 * this file: the extension is the actual pinned Alfie tree (provenance is
 * asserted in stage 0), and the card/journal truth is produced by the real
 * adapter/bridge/repository chain.
 *
 * All helpers live in `piSubagentRealPiAcceptanceHelpers.ts` — no imports
 * from other `*.test.ts` files (they double-register their suites).
 *
 * Wall-clock note (Decision 0008 method): the stage-2 `budget + 500 ms`
 * detach envelope is only valid in a standalone per-file invocation; this
 * file is registered in the `wallclock` vitest project and verified
 * standalone.
 */
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@synara/contracts";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  DETERMINISTIC_BATCH_DRIVER_MODEL_ID,
  DETERMINISTIC_DRIVER_MODEL_ID,
  DETERMINISTIC_MANUAL_TEARDOWN_CHILD_MODEL,
  DETERMINISTIC_RESTART_DRIVER_MODEL_ID,
  makeRealPiWsHarness,
  verifyRealPiExtensionProvenance,
  writeBridgeAbsentAgentDir,
  writeStrippedCapabilityAgentDir,
  type RealPiWsHarness,
} from "./piSubagentRealPiAcceptanceHelpers.ts";
import {
  PI_SUBAGENT_WATCHDOG_BAND,
  PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC,
  PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
  PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC,
  PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC,
  runPiSubagentWatchdogEscalation,
} from "./piSubagentWatchdogEscalation.ts";

interface RealPiSliceFixture {
  readonly harness: RealPiWsHarness;
  /** Digest of the user's ~/.pi tree captured before the harness existed. */
  readonly userPiHomeDigest: string;
  /** Stage-1 execution identity, proven from durable truth and the WS card. */
  stage1ExecutionId?: string;
  /** Stage-2 execution identity (slow detached child). */
  stage2ExecutionId?: string;
}

let fixture: RealPiSliceFixture | undefined;

// ─── OrchestrationEvent type guards (narrowing the replay event union) ──────
// `replayEvents` returns the full public event union; each guard narrows to
// exactly the event member the surrounding assertion reads, so the payload
// fields stay type-checked against the contract instead of cast away.

function isPiSubagentExecutionUpdatedEvent(
  event: OrchestrationEvent,
): event is Extract<OrchestrationEvent, { type: "thread.pi-subagent-execution-updated" }> {
  return event.type === "thread.pi-subagent-execution-updated";
}

function isActivityAppendedEvent(
  event: OrchestrationEvent,
): event is Extract<OrchestrationEvent, { type: "thread.activity-appended" }> {
  return event.type === "thread.activity-appended";
}

function isMessageSentEvent(
  event: OrchestrationEvent,
): event is Extract<OrchestrationEvent, { type: "thread.message-sent" }> {
  return event.type === "thread.message-sent";
}

/** Structurally validates a JSON activity payload carrying a detail string. */
function activityPayloadDetail(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  if (!("detail" in payload) || typeof (payload as { detail?: unknown }).detail !== "string") {
    return undefined;
  }
  return (payload as { detail: string }).detail;
}

const metadataPhase = (metadata: unknown): string | undefined => {
  if (typeof metadata !== "object" || metadata === null || !("phase" in metadata)) {
    return undefined;
  }
  return typeof metadata.phase === "string" ? metadata.phase : undefined;
};

const metadataDispatched = (metadata: unknown): boolean | undefined => {
  if (typeof metadata !== "object" || metadata === null || !("dispatched" in metadata)) {
    return undefined;
  }
  return typeof metadata.dispatched === "boolean" ? metadata.dispatched : undefined;
};

const metadataResult = (metadata: unknown): string | undefined => {
  if (typeof metadata !== "object" || metadata === null || !("result" in metadata)) {
    return undefined;
  }
  return typeof metadata.result === "string" ? metadata.result : undefined;
};

const metadataReason = (metadata: unknown): string | undefined => {
  if (typeof metadata !== "object" || metadata === null || !("reason" in metadata)) {
    return undefined;
  }
  return typeof metadata.reason === "string" ? metadata.reason : undefined;
};

describe("Ticket 17 integrated real-Pi acceptance — slice 3 (stages 0–4)", () => {
  // -------------------------------------------------------------------------
  // STAGE 0 — T17-AC8/AC9: provenance + owned isolation + diagnostics
  // -------------------------------------------------------------------------
  it("T17-AC8/AC9 stage 0: pinned extension provenance verifies, the harness owns an isolated state/home/workspace with an explicit agent dir on loopback port 0, and no user Pi config/env is read or mutated", async () => {
    // Provenance first: no synthetic/unverified extension may satisfy any
    // later stage of this file.
    const provenance = verifyRealPiExtensionProvenance();
    expect(provenance.isVerified).toBe(true);
    expect(provenance.packageName).toBe("@alfie/pi-subagents");
    expect(provenance.packageVersion).toBe("0.15.0-alfie.6");
    expect(provenance.pinnedCommit).toBe("3fe340b401ca86bcbe8b55abd4de107e1d93482e");

    // Snapshot the user's real Pi home BEFORE the harness exists so the
    // post-run comparison proves no read-modify-write escaped isolation.
    const userPiSnapshot = provenance.snapshotUserPiHome();

    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      progressRateHz: 10,
      heartbeatIntervalMs: 1_000,
      leaseDurationMs: 3_000,
      completionBatchWindowMs: 5_000,
    });
    fixture = { harness, userPiHomeDigest: userPiSnapshot.digest };
    // NOTE: no dispose here — stages 1 and 2 run against the SAME live
    // composition; the final teardown stage disposes and proves the
    // isolation postconditions (idempotent dispose, removed temp root,
    // restored env, unchanged user Pi home).
    // Owned isolation: every path the server may write lives under one
    // fresh temp root; the loopback listener bound an ephemeral port.
    expect(harness.port).toBeGreaterThan(0);
    expect(harness.port).not.toBe(3000);
    expect(harness.port).not.toBe(8080);
    expect(harness.origin).toBe(`http://127.0.0.1:${harness.port}`);
    for (const ownedPath of [
      harness.rootDir,
      harness.homeDir,
      harness.workspaceDir,
      harness.dbPath,
      harness.parentAgentDir,
      harness.childAgentDir,
    ]) {
      expect(ownedPath.startsWith(harness.rootDir)).toBe(true);
      expect(ownedPath.startsWith(await harness.userHome())).toBe(false);
    }
    expect(harness.dbPath.endsWith(".sqlite")).toBe(true);
    // The parent agent dir is wired through the PUBLIC settings seam.
    const settings = await harness.client.getServerSettings();
    expect(settings.providers.pi?.agentDir).toBe(harness.parentAgentDir);
    // Stable stage diagnostics: every operation failure carries the
    // harness operation name.
    expect(harness.lastOperationDiagnostics()).toEqual([]);
    // The deterministic loopback model endpoint is owned by the harness
    // and has served nothing yet.
    expect(harness.modelServer.requestCount()).toBe(0);
  }, 120_000);
  // -----------------------------------------------------------------------
  // STAGE 1 — T17-AC1: managed execution started through the production
  // public WS command path, with identity continuity from the durable row
  // and journal to the WS execution card.
  // -----------------------------------------------------------------------
  it("T17-AC1 stage 1: a real Pi session started by the public WS turn command negotiates managed capability and starts one identity-stamped long-running execution whose identity is continuous from the durable row to the WS card", async () => {
    if (!fixture) throw new Error("stage 0 must run first");
    const harness = fixture.harness;
    const createdAt = new Date().toISOString();
    const projectId = ProjectId.makeUnsafe("t17-proj-1");
    const threadId = ThreadId.makeUnsafe("t17-thread-1");

    const projectDispatch = await harness.client.dispatchCommand({
      type: "project.create",
      commandId: CommandId.makeUnsafe("cmd-t17-proj-1"),
      projectId,
      title: "T17 Real-Pi Project",
      workspaceRoot: harness.workspaceDir,
      createdAt,
    });
    expect(projectDispatch.sequence).toBeGreaterThanOrEqual(0);
    const threadDispatch = await harness.client.dispatchCommand({
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-t17-thread-1"),
      threadId,
      projectId,
      title: "T17 Real-Pi Thread",
      modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt,
    });
    expect(threadDispatch.sequence).toBeGreaterThanOrEqual(0);

    // The public WS turn command drives the production path end to end:
    // ensureSessionForThreadCore → durable ProviderService.startSession →
    // REAL PiAdapter over the pinned extension. The deterministic driver
    // model issues one scripted Agent tool call on the parent's turn.
    const turnStart = await harness.client.dispatchCommand({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-t17-turn-1"),
      threadId,
      message: {
        messageId: MessageId.makeUnsafe("msg-t17-turn-1"),
        role: "user",
        text: "Delegate the integrated acceptance task to a researcher subagent.",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: new Date().toISOString(),
    });
    expect(turnStart.sequence).toBeGreaterThanOrEqual(0);

    // Managed capability negotiated on the real session (observation hook
    // over the production adapter composition).
    const capability = await waitFor(
      () => harness.observedCapabilities().get(String(threadId)),
      (value) => value !== undefined,
      60_000,
      "managed capability negotiation",
    );
    expect(capability.isManaged).toBe(true);
    expect(capability.status).toBe("managed_enabled");
    expect(capability.capabilities).toContain("managed-spawn");

    // A real managed admission happened (real Agent tool call through the
    // live parent session).
    const admission = await waitFor(
      () =>
        harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
      (value) => value !== undefined && value.result.status !== "rejected",
      90_000,
      "managed admission",
    );
    expect(admission.result.status).not.toBe("rejected");
    const executionId = admission.result.executionId;
    expect(executionId).toMatch(/^exec_/);
    fixture.stage1ExecutionId = executionId;

    // Identity continuity: durable row == journal == WS execution card.
    const durable = harness.durable;
    const row = await waitFor(
      () => durable.getById(executionId!),
      (value) => value !== undefined,
      30_000,
      "durable execution row",
    );
    expect(row.observedState).not.toBe("rejected");
    const journal = await waitFor(
      () => durable.listJournalEvents(executionId!),
      (events) => events.length >= 2,
      30_000,
      "durable lifecycle journal",
    );
    expect(journal[0]!.state).toBe("accepted");
    expect(journal[1]!.state).toBe("running");
    expect(journal[1]!.attemptId).toBe(row.attemptId);

    const card = await harness.waitForExecutionCard(
      String(threadId),
      (candidate) => candidate.executionId === executionId,
      45_000,
    );
    expect(card.executionId).toBe(executionId);
    expect(card.attemptId).toBe(row.attemptId);
    expect(card.generation).toBe(row.generation);
    expect(card.agentType).toBe(admission.command.agentType);
    expect(card.observedState).not.toBe("rejected");

    // The loopback model endpoint really served the parent (driver model
    // with the extension Agent tool present) and the child (no Agent tool —
    // the extension excludes its own tools from subagent spawns).
    const modelRequests = await waitFor(
      () => harness.modelServer.requests(),
      (requests) =>
        requests.some((r) => r.model === DETERMINISTIC_DRIVER_MODEL_ID && r.hasAgentTool) &&
        requests.some((r) => !r.hasAgentTool),
      45_000,
      "parent and child model requests",
    );
    expect(modelRequests.some((r) => !r.hasAgentTool)).toBe(true);
  }, 150_000);

  // -----------------------------------------------------------------------
  // STAGE 2 — T17-AC2: standalone bounded detach within wait + 500 ms,
  // bounded/latest progress, and reconnect hydration through a genuinely
  // NEW WebSocket client.
  // -----------------------------------------------------------------------
  it("T17-AC2 stage 2: a slow real child detaches within wait + 500 ms with bounded/latest progress, and a genuinely new WS client restores the execution card from fresh thread detail", async () => {
    if (!fixture) throw new Error("stage 0 must run first");
    const harness = fixture.harness;
    const waitMs = harness.foregroundWaitMs;
    const createdAt = new Date().toISOString();
    const threadId = ThreadId.makeUnsafe("t17-thread-2");
    const projectId = ProjectId.makeUnsafe("t17-proj-1");

    // Slow child: the isolated PREFERENCES.md points every fresh subagent
    // spawn at the delayed echo model, so the foreground child cannot
    // complete inside the 300 ms budget and MUST detach.
    harness.writeSubagentModelPreference("synara-local-echo/echo-slow");

    // Reuse the stage-1 project (one workspace root per project invariant);
    // only a new thread is created for the slow-detach leg.
    await harness.client.dispatchCommand({
      type: "thread.create",
      commandId: CommandId.makeUnsafe("cmd-t17-thread-2"),
      threadId,
      projectId,
      title: "T17 Real-Pi Thread 2",
      modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: harness.workspaceDir,
      createdAt,
    });
    await harness.client.dispatchCommand({
      type: "thread.turn.start",
      commandId: CommandId.makeUnsafe("cmd-t17-turn-2"),
      threadId,
      message: {
        messageId: MessageId.makeUnsafe("msg-t17-turn-2"),
        role: "user",
        text: "Delegate the slow acceptance task to a researcher subagent.",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: new Date().toISOString(),
    });

    const admission = await waitFor(
      () =>
        harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
      (value) => value !== undefined && value.result.status !== "rejected",
      90_000,
      "slow managed admission",
    );
    const executionId = admission.result.executionId;
    fixture.stage2ExecutionId = executionId;

    // ── Standalone bounded detach (Decision 0006 §5 envelope, journal-first
    // truth): the attachment window is seq2 (started) → seq3 (detached).
    const journal = await waitFor(
      () => harness.durable.listJournalEvents(executionId),
      (events) => events.some((event) => event.sequence === 3),
      30_000,
      "detach journal event",
    );
    const started = journal.find((event) => event.sequence === 2)!;
    const detached = journal.find((event) => event.sequence === 3)!;
    expect(started.state).toBe("running");
    expect(detached.state).toBe("running");
    expect(detached.metadata).toMatchObject({
      phase: "detached",
      attachmentMode: "foreground",
      foregroundWaitMs: waitMs,
    });
    const attachmentMs = Date.parse(detached.occurredAt) - Date.parse(started.occurredAt);
    process.stdout.write(
      `T17-AC2 detach envelope: attachment=${attachmentMs}ms budget=${waitMs}ms envelope=${waitMs + 500}ms\n`,
    );
    expect(attachmentMs).toBeGreaterThanOrEqual(waitMs - 50);
    expect(attachmentMs).toBeLessThan(waitMs + 500);

    // ── Bounded/latest progress while the child keeps running: the RUNNING
    // card is visible on the FIRST client before reconnect.
    const cardRunning = await harness.waitForExecutionCard(
      String(threadId),
      (candidate) => candidate.executionId === executionId,
      30_000,
    );
    expect(cardRunning.observedState).toBe("running");
    expect(cardRunning.desiredState).toBe("running");

    // ── Reconnect hydration WHILE THE CHILD IS STILL RUNNING: close the
    // FIRST client, open a genuinely NEW one (fresh negotiation, socket, and
    // RPC runtime), and obtain FRESH thread detail carrying the same card in
    // the running state — the browser reconnect restoration path.
    await harness.client.close();
    const freshClient = await harness.connectNewClient();
    try {
      const freshCardRunning = await waitFor(
        async () => {
          const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (card) => card.executionId === executionId,
          );
        },
        (card) => card !== undefined && card.observedState === "running",
        15_000,
        "running execution card on the new WS client",
      );
      expect(freshCardRunning.attemptId).toBe(cardRunning.attemptId);
      expect(freshCardRunning.generation).toBe(cardRunning.generation);
      expect(freshCardRunning.cancellationScope).toBe("parent_turn");
      // The fresh snapshot is contract-valid and carries the hydration
      // payload the web store normalizes (captured for the web seam test).
      process.stdout.write(`T17-AC2 reconnect running card: ${JSON.stringify(freshCardRunning)}\n`);

      // Bounded/latest progress and heartbeat land as the slow child's first
      // turn streams; the reconnected client observes the coalesced card
      // fields WITHOUT any live event subscription - pure snapshot hydration.
      const observation = await waitFor(
        () => harness.durable.getObservation(executionId),
        (value) =>
          value !== undefined && value.lastProgressAt !== null && value.lastHeartbeatAt !== null,
        45_000,
        "progress and heartbeat observation",
      );
      expect(observation.lastProgressJson).not.toBeNull();
      const progress = JSON.parse(observation.lastProgressJson!);
      expect(progress.status).toBe("running");
      expect("spinnerFrame" in progress).toBe(false);
      expect(Date.parse(observation.leaseExpiresAt!)).toBeGreaterThan(
        Date.parse(observation.lastHeartbeatAt!),
      );
      expect(observation.droppedProgressCount).toBeGreaterThanOrEqual(0);

      const freshCardProgress = await waitFor(
        async () => {
          const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (card) => card.executionId === executionId,
          );
        },
        (card) =>
          card !== undefined && card.lastProgressAt !== null && card.leaseExpiresAt !== null,
        30_000,
        "progress-bearing execution card on the new WS client",
      );
      expect(freshCardProgress.lastProgressSummary).toBeTruthy();

      // The reconnected client keeps observing durable truth through the
      // terminal transition (slow child: one delayed turn, then success).
      const freshCardTerminal = await waitFor(
        async () => {
          const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (card) => card.executionId === executionId,
          );
        },
        (card) => card !== undefined && card.observedState === "succeeded",
        60_000,
        "terminal execution card on the new WS client",
      );
      expect(freshCardTerminal.terminalSummary).toContain("ACK");
      expect(freshCardTerminal.transcriptRef).toBeTruthy();
    } finally {
      await freshClient.close();
    }

    // Progress never reaches the lifecycle bridge: until the terminal band,
    // the journal stays exactly [1 accepted, 2 running(started),
    // 3 running(detached)]; after the slow child completes, ONLY the terminal
    // band (40) may follow — progress/heartbeat rows never appear.
    const journalAtProgress = await harness.durable.listJournalEvents(executionId);
    const sequences = journalAtProgress.map((event) => event.sequence);
    expect(sequences.slice(0, 3)).toEqual([1, 2, 3]);
    for (const sequence of sequences.slice(3)) {
      expect(sequence).toBe(40);
    }
  }, 180_000);

  // -----------------------------------------------------------------------
  // STAGE 7 — T17-AC7: a real older/partial extension and a bridge-absent
  // session preserve legacy truth: neither creates a managed/recoverable card.
  // -----------------------------------------------------------------------
  it("T17-AC7 stage 7: real capability-mismatch and bridge-absent Pi sessions retain legacy semantics and never project managed or recoverable executions", async () => {
    const stage = "T17-AC7 stage 7";
    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      progressRateHz: 10,
      heartbeatIntervalMs: 1_000,
      leaseDurationMs: 3_000,
    });
    const client = await harness.connectNewClient();

    try {
      const projectId = ProjectId.makeUnsafe("t17-proj-7");
      const strippedThreadId = ThreadId.makeUnsafe("t17-thread-7-stripped");
      const absentThreadId = ThreadId.makeUnsafe("t17-thread-7-absent");
      const strippedAgentDir = path.join(harness.rootDir, "stripped-agent");
      const absentAgentDir = path.join(harness.rootDir, "bridge-absent-agent");
      writeStrippedCapabilityAgentDir(strippedAgentDir, harness.modelServer.baseUrl);
      writeBridgeAbsentAgentDir(absentAgentDir, harness.modelServer.baseUrl);

      await client.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t17-proj-7"),
        projectId,
        title: "T17 Real-Pi Legacy Project",
        workspaceRoot: harness.workspaceDir,
        createdAt: new Date().toISOString(),
      });

      // Partial real extension: the Agent tool is present but its managed
      // capability handshake is incompatible, so the call must retain the
      // extension's legacy path and create zero Synara execution records.
      await client.updateServerSettings({ providers: { pi: { agentDir: strippedAgentDir } } });
      await client.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-7-stripped"),
        threadId: strippedThreadId,
        projectId,
        title: "T17 Real-Pi Stripped Capability",
        modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt: new Date().toISOString(),
      });
      await client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-7-stripped"),
        threadId: strippedThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-7-stripped"),
          role: "user",
          text: "Delegate a legacy-only task through the real Agent extension.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const strippedCapability = await waitFor(
        () => harness.observedCapabilities().get(String(strippedThreadId)),
        (value) => value !== undefined,
        60_000,
        `${stage} capability-mismatch handshake`,
      );
      expect(strippedCapability.isManaged).toBe(false);
      expect(strippedCapability.status).toBe("capability_mismatch");
      expect(strippedCapability.diagnosticCode).toBe("pi_subagent_capability_mismatch");
      expect(strippedCapability.missingCapabilities).toContain("execution-identity-routing-v1");
      await waitFor(
        () =>
          harness.modelServer
            .requests()
            .filter(
              (request) => request.model === DETERMINISTIC_DRIVER_MODEL_ID && request.hasAgentTool,
            ).length,
        (count) => count !== undefined && count >= 1,
        30_000,
        `${stage} real legacy Agent model request`,
      );
      const strippedDetail = await harness.waitForThreadDetail(String(strippedThreadId));
      expect(strippedDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(
        harness
          .observedAdmissions()
          .filter((event) => String(event.threadId) === String(strippedThreadId)),
      ).toHaveLength(0);

      // No extension at all: capabilities report bridge-absent and the real
      // Pi model sees no Agent tool. It cannot be mislabeled managed,
      // recoverable, or orphaned merely because the server is Synara-aware.
      await client.updateServerSettings({ providers: { pi: { agentDir: absentAgentDir } } });
      await client.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-7-absent"),
        threadId: absentThreadId,
        projectId,
        title: "T17 Real-Pi Bridge Absent",
        modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt: new Date().toISOString(),
      });
      await client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-7-absent"),
        threadId: absentThreadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-7-absent"),
          role: "user",
          text: "Run without a Synara subagent bridge.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const absentCapability = await waitFor(
        () => harness.observedCapabilities().get(String(absentThreadId)),
        (value) => value !== undefined,
        60_000,
        `${stage} bridge-absent handshake`,
      );
      expect(absentCapability.isManaged).toBe(false);
      expect(absentCapability.status).toBe("bridge_absent");
      expect(absentCapability.diagnosticCode).toBe("pi_subagent_bridge_absent");
      const absentDetail = await harness.waitForThreadDetail(String(absentThreadId));
      expect(absentDetail.thread.piSubagentExecutions).toHaveLength(0);
      expect(
        harness
          .observedAdmissions()
          .filter((event) => String(event.threadId) === String(absentThreadId)),
      ).toHaveLength(0);
      expect(
        [
          ...(absentDetail.thread.piSubagentExecutions ?? []),
          ...(strippedDetail.thread.piSubagentExecutions ?? []),
        ].some((card) => card.observedState === "orphaned"),
      ).toBe(false);
    } catch (error) {
      throw new Error(
        `${stage} failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `diagnostics=${JSON.stringify(harness.lastOperationDiagnostics())}; ` +
          `modelRequests=${JSON.stringify(harness.modelServer.requests())}`,
        { cause: error },
      );
    } finally {
      await client.close();
      await harness.dispose();
      // Stage 7 is intentionally an isolated legacy harness while the
      // primary stages still have a live card bridge. Its disposal clears
      // the process-global listener, so restore the primary harness's owned
      // listener before the subsequent cancellation/completion stages run.
      fixture?.harness.restoreCardLifecycleListener();
    }
  }, 180_000);

  // -----------------------------------------------------------------------
  // STAGE 3 — T17-AC9: real durable single-execution cancellation through
  // the public WS card-cancel command, with cancelling-first visibility,
  // child-ack terminal proof, and bridge active-registry cleanup.
  // -----------------------------------------------------------------------
  it("T17-AC9 stage 3: a detached real slow child is cancelled durably through the public WS card-cancel command, shows a cancelling intent before terminal acknowledgement, settles cancelled on child_ack evidence for the current attempt/generation, and leaves no live child in the bridge registry", async () => {
    if (!fixture) throw new Error("T17-AC9 stage 3 guard: stage 0 must run first");
    const harness = fixture.harness;
    const stage = "T17-AC9 stage 3";
    const createdAt = new Date().toISOString();
    const threadId = ThreadId.makeUnsafe("t17-thread-3");
    const projectId = ProjectId.makeUnsafe("t17-proj-1");
    const stageClient = await harness.connectNewClient();

    try {
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");

      await stageClient.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-3"),
        threadId,
        projectId,
        title: "T17 Real-Pi Thread 3",
        modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt,
      });
      await stageClient.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-3"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-3"),
          role: "user",
          text: "Delegate the cancellation acceptance task to a researcher subagent.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        `${stage} managed admission`,
      );
      const executionId = admission.result.executionId;
      if (!executionId) {
        throw new Error(`${stage} guard: managed admission completed without an executionId`);
      }

      const runningCard = await waitFor(
        async () => {
          const detail = await stageClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (candidate) =>
              candidate.executionId === executionId && candidate.observedState === "running",
          );
        },
        (value) => value !== undefined,
        30_000,
        `${stage} running card before cancel`,
      );
      const durableBeforeCancel = await waitFor(
        () => harness.durable.getById(executionId),
        (value) => value !== undefined && value.observedState === "running",
        30_000,
        `${stage} durable running aggregate before cancel`,
      );
      const activeBeforeCancel = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) =>
          active.some(
            (candidate) =>
              candidate.executionId === executionId &&
              candidate.attemptId === durableBeforeCancel.attemptId &&
              candidate.generation === durableBeforeCancel.generation &&
              candidate.isRunning,
          ),
        30_000,
        `${stage} bridge active execution before cancel`,
      );
      expect(activeBeforeCancel.some((candidate) => candidate.executionId === executionId)).toBe(
        true,
      );

      // The command promise resolves only after the command reactor has
      // completed cancellation. Start observing through the second public
      // client before awaiting it so the test does not skip the required
      // durable `cancelling` projection.
      const cancelDispatch = stageClient.dispatchCommand({
        type: "thread.pi-subagent-execution.cancel",
        commandId: CommandId.makeUnsafe("cmd-t17-cancel-3"),
        threadId,
        executionId,
        createdAt: new Date().toISOString(),
      });

      const cancellationIntentProbe = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) =>
          events.some(
            (event) =>
              event.sequence === 90 &&
              event.state === "cancelling" &&
              event.attemptId === durableBeforeCancel.attemptId &&
              event.generation === durableBeforeCancel.generation,
          ),
        30_000,
        `${stage} durable cancelling intent probe`,
      );
      expect(cancellationIntentProbe.some((event) => event.sequence === 90)).toBe(true);

      const cancellingIntentEvent = await waitFor(
        () =>
          stageClient.replayEvents({
            threadId,
            fromSequenceExclusive: 0,
          }),
        (events) =>
          events.some(
            (event) =>
              isPiSubagentExecutionUpdatedEvent(event) &&
              event.payload.executionId === executionId &&
              event.payload.journalSequence === 90 &&
              event.payload.card.attemptId === durableBeforeCancel.attemptId &&
              event.payload.card.generation === durableBeforeCancel.generation,
          ),
        30_000,
        `${stage} cancel-intent card publication`,
      );
      const cancellingCardUpdate = cancellingIntentEvent.find(
        (event) =>
          isPiSubagentExecutionUpdatedEvent(event) &&
          event.payload.executionId === executionId &&
          event.payload.journalSequence === 90 &&
          event.payload.card.attemptId === durableBeforeCancel.attemptId &&
          event.payload.card.generation === durableBeforeCancel.generation,
      );
      if (
        cancellingCardUpdate === undefined ||
        !isPiSubagentExecutionUpdatedEvent(cancellingCardUpdate)
      ) {
        throw new Error(
          `${stage} cancel-intent card publication was not a pi-subagent-execution-updated event.`,
        );
      }
      expect(cancellingCardUpdate.payload.card.executionId).toBe(runningCard.executionId);
      expect(cancellingCardUpdate.payload.journalSequence).toBe(90);

      const cancellingIntent = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) =>
          events.some(
            (event) =>
              event.sequence === 90 &&
              event.state === "cancelling" &&
              event.attemptId === durableBeforeCancel.attemptId &&
              event.generation === durableBeforeCancel.generation,
          ),
        30_000,
        `${stage} durable cancelling intent`,
      );
      const cancelIntentEvent = cancellingIntent.find((event) => event.sequence === 90)!;
      expect(cancelIntentEvent.state).toBe("cancelling");
      expect(cancelIntentEvent.attemptId).toBe(durableBeforeCancel.attemptId);
      expect(cancelIntentEvent.generation).toBe(durableBeforeCancel.generation);

      await cancelDispatch;

      const journalSettled = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) =>
          events.some(
            (event) =>
              event.sequence === 92 &&
              event.state === "cancelled" &&
              event.attemptId === durableBeforeCancel.attemptId &&
              event.generation === durableBeforeCancel.generation,
          ),
        60_000,
        `${stage} durable child acknowledgement`,
      );
      const cancelledAck = journalSettled.find((event) => event.sequence === 92)!;
      expect(cancelledAck.metadata).toMatchObject({ evidenceChannel: "child_ack" });
      expect(cancelledAck.attemptId).toBe(cancelIntentEvent.attemptId);
      expect(cancelledAck.generation).toBe(cancelIntentEvent.generation);
      expect(cancelledAck.sequence).toBeGreaterThan(cancelIntentEvent.sequence);

      const cancelledCard = await waitFor(
        async () => {
          const detail = await stageClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (candidate) => candidate.executionId === executionId,
          );
        },
        (card) =>
          card !== undefined &&
          card.attemptId === durableBeforeCancel.attemptId &&
          card.generation === durableBeforeCancel.generation &&
          card.observedState === "cancelled",
        30_000,
        `${stage} cancelled card after child acknowledgement`,
      );
      expect(cancelledCard.executionId).toBe(runningCard.executionId);
      expect(cancelledCard.attemptId).toBe(durableBeforeCancel.attemptId);
      expect(cancelledCard.generation).toBe(durableBeforeCancel.generation);

      const durableCancelled = await waitFor(
        () => harness.durable.getById(executionId),
        (value) =>
          value !== undefined &&
          value.attemptId === durableBeforeCancel.attemptId &&
          value.generation === durableBeforeCancel.generation &&
          value.observedState === "cancelled",
        30_000,
        `${stage} durable cancelled aggregate`,
      );
      expect(durableCancelled.executionId).toBe(runningCard.executionId);

      const activeAfterSettlement = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) =>
          !active.some(
            (candidate) =>
              candidate.executionId === executionId &&
              candidate.attemptId === durableBeforeCancel.attemptId &&
              candidate.generation === durableBeforeCancel.generation,
          ),
        30_000,
        `${stage} bridge active registry cleanup`,
      );
      expect(activeAfterSettlement.some((candidate) => candidate.executionId === executionId)).toBe(
        false,
      );

      const inactiveThreadId = ThreadId.makeUnsafe("t17-thread-3-negative");
      await stageClient.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-3-negative"),
        threadId: inactiveThreadId,
        projectId,
        title: "T17 Real-Pi Thread 3 Negative",
        modelSelection: { provider: "pi", model: DETERMINISTIC_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt: new Date().toISOString(),
      });

      await stageClient.dispatchCommand({
        type: "thread.pi-subagent-execution.cancel",
        commandId: CommandId.makeUnsafe("cmd-t17-cancel-3-negative"),
        threadId: inactiveThreadId,
        executionId,
        createdAt: new Date().toISOString(),
      });

      const inaccessibleFailure = await waitFor(
        () =>
          stageClient.replayEvents({
            threadId: inactiveThreadId,
            fromSequenceExclusive: 0,
          }),
        (events) =>
          events.some(
            (event) =>
              isActivityAppendedEvent(event) &&
              event.payload.activity.kind === "provider.subagent-execution.cancel.failed" &&
              activityPayloadDetail(event.payload.activity.payload) ===
                "No active provider session is bound to this thread.",
          ),
        30_000,
        `${stage} inaccessible cancel diagnostic`,
      );
      const inaccessibleFailureEvent = inaccessibleFailure.find(
        (event) =>
          isActivityAppendedEvent(event) &&
          event.payload.activity.kind === "provider.subagent-execution.cancel.failed",
      );
      if (
        inaccessibleFailureEvent === undefined ||
        !isActivityAppendedEvent(inaccessibleFailureEvent)
      ) {
        throw new Error(
          `${stage} inaccessible cancel diagnostic was not an activity-appended event.`,
        );
      }
      expect(inaccessibleFailureEvent.payload.activity.summary).toBe(
        "Subagent execution cancel failed",
      );

      const durableStillCancelled = await harness.durable.getById(executionId);
      expect(durableStillCancelled?.observedState).toBe("cancelled");
      expect(durableStillCancelled?.attemptId).toBe(durableBeforeCancel.attemptId);
      expect(durableStillCancelled?.generation).toBe(durableBeforeCancel.generation);
    } finally {
      await stageClient.close();
    }
  }, 180_000);

  // -----------------------------------------------------------------------
  // STAGE 4 — T17-AC4: real batched completion plus per-execution result
  // retrieval through the public WS boundary.
  // -----------------------------------------------------------------------
  it("T17-AC4 stage 4: two real background slow children under one parent thread complete into one accepted bounded batch, produce exactly one parent follow-up, and each result is retrievable individually through the public read RPC with stable denial on unknown identity", async () => {
    if (!fixture) throw new Error("T17-AC4 stage 4 guard: stage 0 must run first");
    const harness = fixture.harness;
    const stage = "T17-AC4 stage 4";
    const projectId = ProjectId.makeUnsafe("t17-proj-1");
    const threadId = ThreadId.makeUnsafe("t17-thread-4");
    const stageClient = await harness.connectNewClient();

    try {
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");

      await stageClient.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-4"),
        threadId,
        projectId,
        title: "T17 Real-Pi Thread 4",
        modelSelection: { provider: "pi", model: DETERMINISTIC_BATCH_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt: new Date().toISOString(),
      });
      await stageClient.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-4"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-4"),
          role: "user",
          text: "Delegate exactly two slow background researcher children under this one parent thread.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const firstAdmission = await waitFor(
        () =>
          harness
            .observedAdmissions()
            .find(
              (event) =>
                String(event.threadId) === String(threadId) && event.result.status !== "rejected",
            ),
        (event) => event !== undefined,
        90_000,
        `${stage} first managed admission`,
      );

      await stageClient.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-4-second"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-4-second"),
          role: "user",
          text: "Delegate a second slow background researcher child under this same parent thread.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const admissions = await waitFor(
        () =>
          harness
            .observedAdmissions()
            .filter((event) => String(event.threadId) === String(threadId)),
        (events) =>
          events !== undefined &&
          events.length >= 2 &&
          events.slice(0, 2).every((event) => event.result.status !== "rejected"),
        120_000,
        `${stage} two managed admissions`,
      );
      const executionIds = [
        firstAdmission,
        ...admissions.filter((event) => event !== firstAdmission),
      ]
        .slice(0, 2)
        .map((event) => event.result.executionId);
      expect(new Set(executionIds).size).toBe(2);

      const durableRows = await Promise.all(
        executionIds.map((executionId) =>
          waitFor(
            () => harness.durable.getById(executionId),
            (value) => value !== undefined && value.observedState === "succeeded",
            90_000,
            `${stage} durable terminal aggregate ${executionId}`,
          ),
        ),
      );
      expect(durableRows.every((row) => row.observedState === "succeeded")).toBe(true);

      const terminalCards = await waitFor(
        async () => {
          const detail = await stageClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).filter((candidate) =>
            executionIds.includes(candidate.executionId),
          );
        },
        (cards) =>
          cards !== undefined &&
          cards.length === 2 &&
          cards.every((card) => card.observedState === "succeeded"),
        90_000,
        `${stage} two terminal execution cards`,
      );
      expect(terminalCards).toHaveLength(2);

      const outboxEntries = await Promise.all(
        executionIds.map((executionId) =>
          waitFor(
            () => harness.durable.getCompletionOutboxEntry(executionId),
            (value) => value !== undefined && value.deliveryState === "acknowledged",
            90_000,
            `${stage} acknowledged outbox for ${executionId}`,
          ),
        ),
      );
      const dispatchBatchIds = outboxEntries.map((entry) => entry.dispatchBatchId);
      expect(dispatchBatchIds[0]).toBeTruthy();
      expect(new Set(dispatchBatchIds).size).toBe(1);

      const batch = await waitFor(
        () => harness.durable.getCompletionDispatchBatch(dispatchBatchIds[0]!),
        (value) => value !== undefined && value.state === "acknowledged",
        60_000,
        `${stage} acknowledged completion batch`,
      );
      expect(batch.membership).toHaveLength(2);
      expect(new Set(batch.membership)).toEqual(
        new Set(outboxEntries.map((entry) => entry.outboxId)),
      );
      expect(batch.acceptedReceiptSequence).toBeGreaterThan(0);

      const replayed = await waitFor(
        () =>
          stageClient.replayEvents({
            threadId,
            fromSequenceExclusive: 0,
          }),
        (events) =>
          events.some(
            (event) =>
              isMessageSentEvent(event) &&
              event.payload.text.includes("background subagents finished:"),
          ),
        60_000,
        `${stage} accepted batched parent follow-up`,
      );
      const followUps = replayed
        .filter(isMessageSentEvent)
        .filter((event) => event.payload.text.includes("background subagents finished:"));
      expect(followUps).toHaveLength(1);
      const followUp = followUps[0];
      if (followUp === undefined) {
        throw new Error(`${stage} expected exactly one accepted batched parent follow-up.`);
      }
      // The durable `acceptedReceiptSequence` is the engine's command receipt;
      // the public message event is the resulting parent effect and can have
      // an earlier sequence. `acknowledged` is only reachable after exact
      // fingerprint/command/message receipt correlation in the repository.
      expect(followUp.commandId).toBe(batch.parentCommandId);
      expect(followUp.payload.messageId).toBe(batch.parentMessageId);
      expect(followUp.sequence).toBeLessThan(batch.acceptedReceiptSequence!);
      for (const executionId of executionIds) {
        expect(followUp.payload.text.includes(executionId)).toBe(true);
      }

      const resultReads = await Promise.all(
        executionIds.map((executionId) => stageClient.readPiSubagentResult({ executionId })),
      );
      expect(new Set(resultReads.map((result) => result.executionId)).size).toBe(2);
      for (const result of resultReads) {
        expect(result.observedState).toBe("succeeded");
        expect(result.terminalState).toBe("succeeded");
        expect(result.summary).toContain("ACK");
        expect(result.transcriptRef).toBeTruthy();
      }

      await expect(
        stageClient.readPiSubagentResult({
          executionId: "exec_t17_stage4_unknown",
        }),
      ).rejects.toMatchObject({
        code: "PI_SUBAGENT_EXECUTION_NOT_FOUND",
        retryable: false,
      });
    } catch (error) {
      throw new Error(
        `${stage} failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `modelRequests=${JSON.stringify(harness.modelServer.requests())}`,
        { cause: error },
      );
    } finally {
      await stageClient.close();
    }
  }, 240_000);

  // -----------------------------------------------------------------------
  // STAGE 5 — Ticket 17 slice 4: real restart reconciliation on a fresh
  // server with no automatic replay/resume.
  // -----------------------------------------------------------------------
  it("T17 slice 4 stage 5: a fresh production WS boot on the same durable root reconciles one real nonterminal child honestly and does not auto-replay or resume it", async () => {
    const stage = "T17 slice 4 stage 5";
    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      progressRateHz: 10,
      heartbeatIntervalMs: 1_000,
      leaseDurationMs: 3_000,
      completionBatchWindowMs: 5_000,
    });

    try {
      const projectId = ProjectId.makeUnsafe("t17-proj-5");
      const threadId = ThreadId.makeUnsafe("t17-thread-5");
      const createdAt = new Date().toISOString();
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");

      await harness.client.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t17-proj-5"),
        projectId,
        title: "T17 Real-Pi Restart Project",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      await harness.client.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-5"),
        threadId,
        projectId,
        title: "T17 Real-Pi Restart Thread",
        modelSelection: { provider: "pi", model: DETERMINISTIC_RESTART_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt,
      });
      await harness.client.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-5"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-5"),
          role: "user",
          text: "Delegate the slow restart acceptance task to a researcher subagent.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        `${stage} managed admission`,
      );
      const executionId = admission.result.executionId;
      // Let the parent finish its background-spawn tool result first. It must
      // not be an in-flight parent effect when we establish the restart
      // baseline, but the child itself remains alive on the slow model.
      await waitFor(
        () =>
          harness.modelServer
            .requests()
            .filter(
              (request) =>
                request.model === DETERMINISTIC_RESTART_DRIVER_MODEL_ID && request.hasAgentTool,
            ),
        (requests) =>
          requests.length >= 2 &&
          requests.some((request) => request.delegated) &&
          requests.some((request) => !request.delegated),
        30_000,
        `${stage} background parent tool-result completion`,
      );

      const activeBeforeRestart = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) =>
          active.some((candidate) => candidate.executionId === executionId && candidate.isRunning),
        30_000,
        `${stage} real bridge active child before restart`,
      );
      expect(activeBeforeRestart.some((candidate) => candidate.executionId === executionId)).toBe(
        true,
      );

      const admittedRow = await waitFor(
        () => harness.durable.getById(executionId),
        (value) => value !== undefined,
        30_000,
        `${stage} durable aggregate after admission`,
      );
      if (["succeeded", "cancelled", "failed", "rejected"].includes(admittedRow.observedState)) {
        const terminalJournal = await harness.durable.listJournalEvents(executionId);
        throw new Error(
          `${stage} real background execution settled before restart despite a live bridge record: ` +
            `observedState=${admittedRow.observedState} journal=${JSON.stringify(
              terminalJournal.map((event) => ({
                sequence: event.sequence,
                state: event.state,
                attemptId: event.attemptId,
                generation: event.generation,
              })),
            )}`,
        );
      }
      const nonterminalRow = admittedRow;
      const nonterminalCard = await harness.waitForExecutionCard(
        String(threadId),
        (candidate) =>
          candidate.executionId === executionId &&
          !["succeeded", "cancelled", "failed", "rejected"].includes(candidate.observedState),
        30_000,
      );
      const runningJournal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) => events.some((event) => event.sequence === 1),
        30_000,
        `${stage} running background journal before restart`,
      );
      expect(runningJournal[0]?.sequence).toBe(1);
      expect(runningJournal.some((event) => event.sequence === 40)).toBe(false);

      const modelRequestCountBeforeRestart = harness.modelServer.requestCount();
      const delegationCountBeforeRestart = harness.modelServer
        .requests()
        .filter((request) => request.delegated).length;
      const admissionCountBeforeRestart = harness
        .observedAdmissions()
        .filter((event) => String(event.threadId) === String(threadId)).length;
      const completionOutboxBeforeRestart =
        await harness.durable.getCompletionOutboxEntry(executionId);
      const stableReplayBeforeRestart = await waitFor(
        async () => {
          // A background Agent return can publish its parent assistant
          // finalize/completion events just after the Agent execution has
          // returned. Three back-to-back reads only prove RPC consistency,
          // not that the event pump is quiet; checkpoint only after two
          // real quiet-window samples so a pre-restart native message is
          // never misclassified as a post-restart parent effect.
          const snapshots = [
            await harness.client.replayEvents({
              threadId,
              fromSequenceExclusive: 0,
            }),
          ];
          await new Promise((resolve) => setTimeout(resolve, 500));
          snapshots.push(
            await harness.client.replayEvents({
              threadId,
              fromSequenceExclusive: 0,
            }),
          );
          await new Promise((resolve) => setTimeout(resolve, 500));
          snapshots.push(
            await harness.client.replayEvents({
              threadId,
              fromSequenceExclusive: 0,
            }),
          );
          return snapshots.map((events) => ({
            events,
            headSequence: events.reduce((max, event) => Math.max(max, event.sequence), 0),
            parentMessageSentCount: events.filter((event) => event.type === "thread.message-sent")
              .length,
          }));
        },
        (snapshots) =>
          snapshots !== undefined &&
          snapshots.length >= 3 &&
          snapshots[1]?.headSequence === snapshots[0]?.headSequence &&
          snapshots[1]?.parentMessageSentCount === snapshots[0]?.parentMessageSentCount &&
          snapshots[2]?.headSequence === snapshots[1]?.headSequence &&
          snapshots[2]?.parentMessageSentCount === snapshots[1]?.parentMessageSentCount,
        30_000,
        `${stage} replayEvents quiescence before restart`,
      );
      const replayedBeforeRestart =
        stableReplayBeforeRestart[stableReplayBeforeRestart.length - 1]!;
      const followUpsBeforeRestart = replayedBeforeRestart.parentMessageSentCount;

      process.stdout.write(
        `${stage} pre-restart counters: executionId=${executionId} attemptId=${nonterminalRow.attemptId} generation=${nonterminalRow.generation} modelRequests=${modelRequestCountBeforeRestart} delegations=${delegationCountBeforeRestart} admissions=${admissionCountBeforeRestart} outbox=${completionOutboxBeforeRestart ? 1 : 0} followUps=${followUpsBeforeRestart}\n`,
      );

      const restartRootDir = harness.rootDir;
      const restartDbPath = harness.dbPath;
      const sharedModelServer = harness.modelServer;
      await harness.dispose({
        preserveRootDir: true,
        preserveModelServer: true,
      });
      // The old server is now fully stopped. Read the durable global event
      // head only after shutdown so an old-instance event committed during
      // disposal belongs to the pre-fresh-boot baseline, never to the fresh
      // server's restart effect assertion below.
      const closedDatabase = new DatabaseSync(restartDbPath, { readOnly: true });
      let replayHeadAfterOldServerShutdown: number;
      try {
        const row = closedDatabase
          .prepare("SELECT MAX(sequence) AS headSequence FROM orchestration_events")
          .get() as { readonly headSequence: number | null } | null;
        replayHeadAfterOldServerShutdown = row?.headSequence ?? 0;
      } finally {
        closedDatabase.close();
      }

      const freshHarness = await makeRealPiWsHarness({
        foregroundWaitMs: 300,
        progressRateHz: 10,
        heartbeatIntervalMs: 1_000,
        leaseDurationMs: 3_000,
        completionBatchWindowMs: 5_000,
        rootDir: restartRootDir,
        dbPath: restartDbPath,
        modelServer: sharedModelServer,
      });
      try {
        const freshClient = await freshHarness.connectNewClient();
        try {
          const reconciledCard = await waitFor(
            async () => {
              const detail = await freshClient.getThreadDetailSnapshot(String(threadId));
              return (detail?.thread.piSubagentExecutions ?? []).find(
                (candidate) => candidate.executionId === executionId,
              );
            },
            (value) => value !== undefined && value.observedState !== "running",
            45_000,
            `${stage} reconciled execution card on fresh boot`,
          );
          const reconciledRow = await waitFor(
            () => freshHarness.durable.getById(executionId),
            (value) =>
              value !== undefined &&
              value.observedState !== "running" &&
              value.diagnosticCode === "pi_subagent_owner_loss_orphaned",
            45_000,
            `${stage} reconciled durable aggregate on fresh boot`,
          );
          const replayedAfterRestart = await freshClient.replayEvents({
            threadId,
            fromSequenceExclusive: 0,
          });
          const followUpsAfterRestart = replayedAfterRestart.filter(
            (event) => event.type === "thread.message-sent",
          ).length;
          const newEventsAfterRestart = await freshClient.replayEvents({
            threadId,
            fromSequenceExclusive: replayHeadAfterOldServerShutdown,
          });
          const newParentEffectsAfterRestart = newEventsAfterRestart.filter(
            (event) => event.type === "thread.message-sent",
          );
          const completionOutboxAfterRestart =
            await freshHarness.durable.getCompletionOutboxEntry(executionId);
          const delegationCountAfterRestart = freshHarness.modelServer
            .requests()
            .filter((request) => request.delegated).length;

          process.stdout.write(
            `${stage} post-restart counters: executionId=${reconciledRow.executionId} attemptId=${reconciledRow.attemptId} generation=${reconciledRow.generation} modelRequests=${freshHarness.modelServer.requestCount()} delegations=${delegationCountAfterRestart} admissions=${freshHarness.observedAdmissions().filter((event) => String(event.threadId) === String(threadId)).length} outbox=${completionOutboxAfterRestart ? 1 : 0} followUps=${followUpsAfterRestart}\n`,
          );
          process.stdout.write(
            `${stage} seam note: no late old-generation terminal can be induced here through public WS + durable-read seams after disposing the original live process; a real old-generation child dies with that process and this suite has no durable write seam to fabricate stale terminal evidence.\n`,
          );

          expect(reconciledCard.executionId).toBe(executionId);
          expect(reconciledRow.executionId).toBe(executionId);
          expect(reconciledRow.attemptId).toBe(nonterminalRow.attemptId);
          expect(reconciledRow.generation).toBe(nonterminalRow.generation + 1);
          expect(reconciledRow.observedState).toBe("orphaned");
          expect(reconciledRow.diagnosticCode).toBe("pi_subagent_owner_loss_orphaned");
          expect(reconciledCard.observedState).toBe("orphaned");
          expect(reconciledCard.attemptId).toBe(nonterminalCard.attemptId);
          expect(reconciledCard.generation).toBe(nonterminalCard.generation + 1);
          expect(delegationCountAfterRestart).toBe(delegationCountBeforeRestart);
          expect(
            freshHarness
              .observedAdmissions()
              .filter((event) => String(event.threadId) === String(threadId)).length,
          ).toBe(0);
          expect(
            newEventsAfterRestart.filter(
              (event) => event.type === "thread.pi-subagent-execution-resume-requested",
            ),
          ).toHaveLength(0);
          if (newParentEffectsAfterRestart.length > 0) {
            throw new Error(
              `${stage} unexpected post-cursor parent messages: ${JSON.stringify(
                newParentEffectsAfterRestart.map((event) =>
                  event.type === "thread.message-sent"
                    ? {
                        sequence: event.sequence,
                        commandId: event.commandId,
                        messageId: event.payload.messageId,
                        source: event.payload.source,
                        dispatchMode: event.payload.dispatchMode,
                        dispatchOrigin: event.payload.dispatchOrigin,
                      }
                    : { sequence: event.sequence, type: event.type },
                ),
              )}`,
            );
          }
          expect(completionOutboxBeforeRestart).toBeUndefined();
          expect(completionOutboxAfterRestart).toBeUndefined();
        } finally {
          await freshClient.close();
        }
      } finally {
        await freshHarness.dispose();
        await sharedModelServer.close();
      }
    } catch (error) {
      throw new Error(
        `${stage} failed: ${error instanceof Error ? error.message : String(error)}; ` +
          `diagnostics=${JSON.stringify(harness.lastOperationDiagnostics())}; ` +
          `modelRequests=${JSON.stringify(harness.modelServer.requests())}`,
        { cause: error },
      );
    }
  }, 240_000);

  // -----------------------------------------------------------------------
  // STAGE 6 — Ticket 17 AC6: real watchdog escalation over a deliberately
  // wedged child reaches provider-session stop and durable teardown handoff
  // without claiming destructive teardown proof.
  // -----------------------------------------------------------------------
  it("T17-AC6 stage 6: a deliberately wedged real child reaches watchdog bands 70-74, invokes real session abort and real provider-session stop, and hands off teardown durably without claiming destructive proof", async () => {
    const stage = "T17-AC6 stage 6";
    const guardDiagnostic = "pi_subagent_watchdog_t17_stage6_guard";
    const harness = await makeRealPiWsHarness({
      foregroundWaitMs: 300,
      progressRateHz: 10,
      heartbeatIntervalMs: 1_000,
      leaseDurationMs: 3_000,
      completionBatchWindowMs: 5_000,
    });
    const stageClient = await harness.connectNewClient();

    try {
      harness.writeSubagentModelPreference("synara-local-echo/echo-slow");

      const projectId = ProjectId.makeUnsafe("t17-proj-6");
      const threadId = ThreadId.makeUnsafe("t17-thread-6");
      const createdAt = new Date().toISOString();

      await stageClient.dispatchCommand({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-t17-proj-6"),
        projectId,
        title: "T17 Real-Pi Watchdog Project",
        workspaceRoot: harness.workspaceDir,
        createdAt,
      });
      await stageClient.dispatchCommand({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-t17-thread-6"),
        threadId,
        projectId,
        title: "T17 Real-Pi Watchdog Thread",
        modelSelection: { provider: "pi", model: DETERMINISTIC_BATCH_DRIVER_MODEL_ID },
        interactionMode: "default",
        runtimeMode: "full-access",
        branch: null,
        worktreePath: harness.workspaceDir,
        createdAt,
      });
      await stageClient.dispatchCommand({
        type: "thread.turn.start",
        commandId: CommandId.makeUnsafe("cmd-t17-turn-6"),
        threadId,
        message: {
          messageId: MessageId.makeUnsafe("msg-t17-turn-6"),
          role: "user",
          text: "Delegate exactly one slow background researcher child for watchdog escalation acceptance.",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: new Date().toISOString(),
      });

      const admission = await waitFor(
        () =>
          harness.observedAdmissions().find((event) => String(event.threadId) === String(threadId)),
        (value) => value !== undefined && value.result.status !== "rejected",
        90_000,
        `${stage} managed admission`,
      );
      const executionId = admission.result.executionId;
      if (!executionId) {
        throw new Error(
          `${stage} guard (${guardDiagnostic}): admission completed without an executionId`,
        );
      }

      const durableBefore = await waitFor(
        () => harness.durable.getById(executionId),
        (value) =>
          value !== undefined &&
          value.desiredState === "running" &&
          !["succeeded", "cancelled", "failed", "rejected"].includes(value.observedState),
        30_000,
        `${stage} durable nonterminal aggregate before escalation`,
      );
      const activeBefore = await waitFor(
        () => harness.bridgeActiveExecutions(String(threadId)),
        (active) =>
          active.some(
            (candidate) =>
              candidate.executionId === executionId &&
              candidate.attemptId === durableBefore.attemptId &&
              candidate.generation === durableBefore.generation &&
              candidate.isRunning,
          ),
        30_000,
        `${stage} real bridge active child before escalation`,
      );
      if (!harness.bridgeForThread(String(threadId))) {
        throw new Error(`${stage} guard (${guardDiagnostic}): real Pi bridge was unavailable`);
      }
      expect(activeBefore.some((candidate) => candidate.executionId === executionId)).toBe(true);

      await harness.durable.recordWallTimeExpiry(executionId, 60_000);

      const diagnostics: Array<{
        readonly stage:
          | "escalation_started"
          | "child_abort_timeout"
          | "provider_turn_interrupt"
          | "provider_session_stop"
          | "teardown_handoff"
          | "failure";
        readonly diagnosticCode: string;
      }> = [];
      let abortDispatches = 0;
      let stopDispatches = 0;
      const result = await runPiSubagentWatchdogEscalation({
        repository: harness.repository,
        resolveBridge: (candidateThreadId) => harness.bridgeForThread(candidateThreadId),
        isOwnerGenerationDead: () => false,
        listActive: (candidateThreadId) => harness.bridgeActiveExecutions(candidateThreadId),
        interruptProviderTurn: async (candidateThreadId) => {
          abortDispatches += 1;
          await harness.abortPiTurn(candidateThreadId);
        },
        stopProviderSession: async (candidateThreadId) => {
          stopDispatches += 1;
          return harness.stopPiSession(candidateThreadId);
        },
        stageTimeoutMs: 300,
        cancelRetryLimit: 0,
        leaseDurationMs: 3_000,
        idleAfterMs: 60_000,
        onDiagnostic: (event) => {
          diagnostics.push({
            stage: event.stage,
            diagnosticCode: event.diagnosticCode,
          });
        },
      });

      expect(result.escalations).toHaveLength(1);
      expect(result.escalations[0]).toMatchObject({
        executionId,
        attemptId: durableBefore.attemptId,
        generation: durableBefore.generation,
        parentThreadId: String(threadId),
        trigger: "wall_time",
        outcome: { kind: "cleanup_uncertain" },
      });
      expect(abortDispatches).toBe(1);
      expect(stopDispatches).toBe(1);

      expect(
        diagnostics.some(
          (event) =>
            event.stage === "escalation_started" &&
            event.diagnosticCode === PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC,
        ),
      ).toBe(true);
      expect(
        diagnostics.some(
          (event) =>
            event.stage === "child_abort_timeout" &&
            event.diagnosticCode === PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
        ),
      ).toBe(true);
      expect(
        diagnostics.some(
          (event) =>
            event.stage === "provider_turn_interrupt" &&
            event.diagnosticCode === PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC,
        ),
      ).toBe(true);
      const providerSessionStopDiagnostics = diagnostics.filter(
        (event) => event.stage === "provider_session_stop",
      );
      const teardownHandoffDiagnostics = diagnostics.filter(
        (event) => event.stage === "teardown_handoff",
      );
      expect(providerSessionStopDiagnostics).toSatisfy(
        (events: typeof providerSessionStopDiagnostics) =>
          events.length === 0 ||
          (events.length === 1 &&
            events[0]?.diagnosticCode === PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC),
      );
      expect(teardownHandoffDiagnostics).toHaveLength(1);
      expect(teardownHandoffDiagnostics[0]?.diagnosticCode).toSatisfy(
        (diagnosticCode: string | undefined) =>
          diagnosticCode === PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC ||
          diagnosticCode === PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC,
      );
      const usedStoppedBranch =
        providerSessionStopDiagnostics.length === 0 &&
        teardownHandoffDiagnostics[0]?.diagnosticCode === PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC;
      const usedTimeoutBranch =
        providerSessionStopDiagnostics.length === 1 &&
        providerSessionStopDiagnostics[0]?.diagnosticCode ===
          PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC &&
        teardownHandoffDiagnostics[0]?.diagnosticCode ===
          PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC;
      expect(usedStoppedBranch || usedTimeoutBranch).toBe(true);
      expect(diagnostics.some((event) => event.stage === "failure")).toBe(false);

      const journal = await waitFor(
        () => harness.durable.listJournalEvents(executionId),
        (events) =>
          [
            PI_SUBAGENT_WATCHDOG_BAND.escalationStarted,
            PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout,
            PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
            PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
            PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
          ].every((sequence) => events.some((event) => event.sequence === sequence)),
        30_000,
        `${stage} watchdog band rows`,
      );
      const watchdogRows = journal.filter(
        (event) =>
          event.sequence >= PI_SUBAGENT_WATCHDOG_BAND.escalationStarted &&
          event.sequence <= PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      );
      expect(watchdogRows.map((event) => event.sequence)).toEqual([70, 71, 72, 73, 74]);
      for (const row of watchdogRows) {
        expect(row.attemptId).toBe(durableBefore.attemptId);
        expect(row.generation).toBe(durableBefore.generation);
      }
      expect(
        watchdogRows.find((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.escalationStarted)
          ?.diagnosticCode,
      ).toBe(PI_SUBAGENT_WATCHDOG_WALLTIME_DIAGNOSTIC);
      expect(
        watchdogRows.find((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.childAbortTimeout)
          ?.diagnosticCode,
      ).toBe(PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC);
      expect(
        watchdogRows.find(
          (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerTurnInterrupt,
        )?.diagnosticCode,
      ).toBe(PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC);
      const providerSessionStopRow = watchdogRows.find(
        (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.providerSessionStop,
      );
      expect(providerSessionStopRow?.diagnosticCode).toSatisfy(
        (diagnosticCode: string | undefined) =>
          diagnosticCode === PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC ||
          diagnosticCode === PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC,
      );
      expect(
        watchdogRows.find((event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff)
          ?.diagnosticCode,
      ).toBe(PI_SUBAGENT_WATCHDOG_CLEANUP_UNCERTAIN_DIAGNOSTIC);
      expect(providerSessionStopRow?.metadata).toSatisfy((metadata: unknown) => {
        if (metadataPhase(metadata) !== "watchdog_escalation") return false;
        if (metadataDispatched(metadata) !== true) return false;
        const result = metadataResult(metadata);
        return result === "stopped" || result === "timeout" || result === "failed";
      });
      const teardownHandoffRow = watchdogRows.find(
        (event) => event.sequence === PI_SUBAGENT_WATCHDOG_BAND.teardownHandoff,
      );
      expect(teardownHandoffRow?.metadata).toSatisfy((metadata: unknown) => {
        if (metadataPhase(metadata) !== "watchdog_escalation") return false;
        const reason = metadataReason(metadata);
        return reason === "session_stop_timeout" || reason === "session_stopped";
      });
      expect(
        (providerSessionStopRow?.diagnosticCode === PI_SUBAGENT_WATCHDOG_STOPPED_DIAGNOSTIC &&
          metadataResult(providerSessionStopRow?.metadata) === "stopped" &&
          metadataReason(teardownHandoffRow?.metadata) === "session_stopped") ||
          (providerSessionStopRow?.diagnosticCode ===
            PI_SUBAGENT_WATCHDOG_STAGE_TIMEOUT_DIAGNOSTIC &&
            (metadataResult(providerSessionStopRow?.metadata) === "timeout" ||
              metadataResult(providerSessionStopRow?.metadata) === "failed") &&
            metadataReason(teardownHandoffRow?.metadata) === "session_stop_timeout"),
      ).toBe(true);

      expect(journal.some((event) => event.sequence === 40)).toBe(false);
      expect(journal.some((event) => event.sequence === 92)).toBe(false);
      for (const forbiddenSequence of [75, 76, 77, 78]) {
        expect(journal.some((event) => event.sequence === forbiddenSequence)).toBe(false);
      }

      const durableAfter = await waitFor(
        () => harness.durable.getById(executionId),
        (value) =>
          value !== undefined &&
          value.attemptId === durableBefore.attemptId &&
          value.generation === durableBefore.generation &&
          value.desiredState === "cancelling",
        15_000,
        `${stage} durable handoff aggregate`,
      );
      expect(["succeeded", "cancelled", "failed", "rejected"]).not.toContain(
        durableAfter.observedState,
      );

      const handoffCard = await waitFor(
        async () => {
          const detail = await stageClient.getThreadDetailSnapshot(String(threadId));
          return (detail?.thread.piSubagentExecutions ?? []).find(
            (candidate) => candidate.executionId === executionId,
          );
        },
        (value) =>
          value !== undefined &&
          value.attemptId === durableBefore.attemptId &&
          value.generation === durableBefore.generation &&
          value.desiredState === "cancelling",
        15_000,
        `${stage} projected handoff card`,
      );
      expect(["succeeded", "cancelled", "failed", "rejected"]).not.toContain(
        handoffCard.observedState,
      );
    } catch (error) {
      const failure =
        error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      throw new Error(
        `${stage} failed (${guardDiagnostic}): ${failure}; ` +
          `diagnostics=${JSON.stringify(harness.lastOperationDiagnostics())}; ` +
          `modelRequests=${JSON.stringify(harness.modelServer.requests())}`,
        { cause: error },
      );
    } finally {
      await stageClient.close();
      await harness.dispose();
    }
  }, 180_000);

  // -----------------------------------------------------------------------
  // TEARDOWN — T17-AC8/AC9: idempotent, resource-owned dispose; the temp
  // root is removed, the process env restored, and the user's real Pi home
  // is byte-identical to the pre-harness snapshot.
  // -----------------------------------------------------------------------
  it("T17-AC8/AC9 teardown: dispose is idempotent, removes the owned temp root, restores the environment, and leaves the user Pi home unchanged", async () => {
    if (!fixture) throw new Error("stage 0 must run first");
    const { harness, userPiHomeDigest } = fixture;
    await harness.dispose();
    await harness.dispose();
    expect((await harness.rootExists())()).toBe(false);
    expect(harness.envWasRestored()).toBe(true);
    const after = verifyRealPiExtensionProvenance().snapshotUserPiHome();
    expect(after.digest).toEqual(userPiHomeDigest);
  }, 120_000);

  // -----------------------------------------------------------------------
  // MANUAL ONLY — T17-AC6 leg 3. This destructive real-Pi run is deliberately
  // excluded from shared CI under Decisions 0028/0032. An operator must opt
  // in, capture the resulting record, and never report it as CI evidence.
  // -----------------------------------------------------------------------
  it.skipIf(process.env.SYNARA_T17_MANUAL_TEARDOWN !== "1")(
    "MANUAL T17-AC6: a child-owned Pi Bash root and descendant ignore TERM, the production owner registry/sweep proves both exit, and band 76 fences the generation",
    async () => {
      const stage = "T17-AC6 manual teardown";
      const harness = await makeRealPiWsHarness({
        foregroundWaitMs: 300,
        progressRateHz: 10,
        heartbeatIntervalMs: 1_000,
        leaseDurationMs: 3_000,
      });
      const client = await harness.connectNewClient();

      try {
        const projectId = ProjectId.makeUnsafe("t17-manual-proj");
        const threadId = ThreadId.makeUnsafe("t17-manual-thread");
        const pidFile = path.join(harness.workspaceDir, "t17-owned-bash.pid");
        const descendantPidFile = path.join(harness.workspaceDir, "t17-owned-bash-descendant.pid");
        const termEvidenceFile = path.join(harness.workspaceDir, "t17-owned-bash-term.log");
        const escapedPidFile = JSON.stringify(pidFile);
        const escapedDescendantPidFile = JSON.stringify(descendantPidFile);
        const escapedTermEvidenceFile = JSON.stringify(termEvidenceFile);
        harness.modelServer.setManualTeardownCommand(
          // `BASHPID` is absent on the macOS Bash 3 runtime. The root's
          // `$$` and the parent shell's `$!` for the backgrounded
          // descendant Bash are stable concrete PIDs on every supported
          // Bash version.
          `bash -c 'trap "echo root-term >> \\"$3\\"" TERM; ` +
            `(trap "echo descendant-term >> \\"$3\\"" TERM; ` +
            `while :; do sleep 300 & wait "$!"; done) & child=$!; ` +
            `echo "$$" > "$1"; echo "$child" > "$2"; wait "$child"' bash ` +
            `${escapedPidFile} ${escapedDescendantPidFile} ${escapedTermEvidenceFile}`,
        );
        harness.writeSubagentModelPreference(
          `synara-local-echo/${DETERMINISTIC_MANUAL_TEARDOWN_CHILD_MODEL}`,
        );

        await client.dispatchCommand({
          type: "project.create",
          commandId: CommandId.makeUnsafe("cmd-t17-manual-proj"),
          projectId,
          title: "T17 Manual Owned Teardown",
          workspaceRoot: harness.workspaceDir,
          createdAt: new Date().toISOString(),
        });
        await client.dispatchCommand({
          type: "thread.create",
          commandId: CommandId.makeUnsafe("cmd-t17-manual-thread"),
          threadId,
          projectId,
          title: "T17 Manual Teardown",
          modelSelection: { provider: "pi", model: DETERMINISTIC_RESTART_DRIVER_MODEL_ID },
          interactionMode: "default",
          runtimeMode: "full-access",
          branch: null,
          worktreePath: harness.workspaceDir,
          createdAt: new Date().toISOString(),
        });
        await client.dispatchCommand({
          type: "thread.turn.start",
          commandId: CommandId.makeUnsafe("cmd-t17-manual-turn"),
          threadId,
          message: {
            messageId: MessageId.makeUnsafe("msg-t17-manual-turn"),
            role: "user",
            text: "Run the owned manual teardown child.",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: new Date().toISOString(),
        });

        const admission = await waitFor(
          () =>
            harness
              .observedAdmissions()
              .find((event) => String(event.threadId) === String(threadId)),
          (value) => value !== undefined && value.result.status !== "rejected",
          90_000,
          `${stage} managed admission`,
        );
        const executionId = admission.result.executionId;
        const activeBefore = await waitFor(
          () => harness.bridgeActiveExecutions(String(threadId)),
          (active) =>
            active.some(
              (candidate) => candidate.executionId === executionId && candidate.isRunning,
            ),
          30_000,
          `${stage} real active child`,
        );
        expect(activeBefore.some((candidate) => candidate.executionId === executionId)).toBe(true);
        await waitFor(
          () => existsSync(pidFile),
          (present) => present === true,
          30_000,
          `${stage} owned bash PID file`,
        );
        await waitFor(
          () => existsSync(descendantPidFile),
          (present) => present === true,
          30_000,
          `${stage} owned Bash descendant PID file`,
        );
        const rootPid = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
        const descendantPid = Number.parseInt(readFileSync(descendantPidFile, "utf8").trim(), 10);
        expect(Number.isSafeInteger(rootPid) && rootPid > 0).toBe(true);
        expect(Number.isSafeInteger(descendantPid) && descendantPid > 0).toBe(true);
        expect(() => process.kill(rootPid, 0)).not.toThrow();
        expect(() => process.kill(descendantPid, 0)).not.toThrow();
        expect(
          harness.observedSupervisorSpawnPids().includes(rootPid),
          `${stage} requires the real child Bash root PID to be absent from parent-supervisor spawn observations before teardown`,
        ).toBe(false);
        expect(
          harness.observedSupervisorSpawnPids().includes(descendantPid),
          `${stage} requires the real child Bash descendant PID to be absent from parent-supervisor spawn observations before teardown`,
        ).toBe(false);

        const before = await waitFor(
          () => harness.durable.getById(executionId),
          (value) => value !== undefined,
          30_000,
          `${stage} durable identity`,
        );
        // Stage 6 above already proves the real watchdog escalation/handoff.
        // The manual leg's narrow lower seam sets up only that proven
        // handoff precondition so this live bash process remains child-owned
        // and available for Ticket-16's real owner-endpoint teardown.
        await harness.durable.recordManualTeardownHandoff(executionId);
        const handoff = await waitFor(
          () => harness.durable.listJournalEvents(executionId),
          (events) => events.some((event) => event.sequence === 74),
          30_000,
          `${stage} watchdog handoff`,
        );
        expect(handoff.some((event) => event.sequence === 75 || event.sequence === 76)).toBe(false);
        expect(handoff.find((event) => event.sequence === 74)?.metadata).toMatchObject({
          phase: "manual_owned_teardown_setup",
        });

        const processState = (pid: number) => {
          try {
            return execFileSync(
              "ps",
              ["-p", String(pid), "-o", "pid=,ppid=,pgid=,stat=,command="],
              {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              },
            ).trim();
          } catch {
            return "absent";
          }
        };
        const isCurrentProvenRow = (
          events: Awaited<ReturnType<typeof harness.durable.listJournalEvents>>,
        ) =>
          events.some(
            (event) =>
              event.sequence === 76 &&
              event.attemptId === before.attemptId &&
              event.generation === before.generation,
          );
        const monitorRootAndDescendantUntilAbsence = async () => {
          const deadline = Date.now() + 75_000;
          let rootState = processState(rootPid);
          let descendantState = processState(descendantPid);
          for (;;) {
            const events = await harness.durable.listJournalEvents(executionId);
            const hasProvenRow = isCurrentProvenRow(events);
            rootState = processState(rootPid);
            descendantState = processState(descendantPid);
            if (hasProvenRow && (rootState !== "absent" || descendantState !== "absent")) {
              throw new Error(
                `${stage} band 76 appeared while an exact owned identity was still live; ` +
                  `root=${JSON.stringify(rootState)} descendant=${JSON.stringify(descendantState)}`,
              );
            }
            if (rootState === "absent" && descendantState === "absent") {
              return { rootState, descendantState };
            }
            if (Date.now() >= deadline) {
              throw new Error(
                `${stage} did not observe root-and-descendant absence during production teardown; ` +
                  `root=${JSON.stringify(rootState)} descendant=${JSON.stringify(descendantState)}`,
              );
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        };

        // No direct coordinator/bridge seam is invoked here. The production
        // PiAdapter's retained owner registry and periodic teardown sweep
        // must discover this durable band-74 handoff and resolve the exact
        // opaque child owner itself. The concurrent monitor rejects any
        // band-76/fence observable while either exact owned identity remains
        // live; Alfie's supervisor tests separately prove the internal
        // root-and-captured-descendant liveness check before it returns
        // `proven`.
        const [settled, absence] = await Promise.all([
          waitFor(
            () => harness.durable.listJournalEvents(executionId),
            isCurrentProvenRow,
            75_000,
            `${stage} production registry/sweep proven teardown row`,
          ),
          monitorRootAndDescendantUntilAbsence(),
        ]);
        expect(absence).toEqual({ rootState: "absent", descendantState: "absent" });
        expect(settled.some((event) => event.sequence === 75)).toBe(true);
        expect(settled.some((event) => event.sequence === 76)).toBe(true);
        const termEvidence = readFileSync(termEvidenceFile, "utf8");
        expect(termEvidence).toContain("root-term");
        expect(termEvidence).toContain("descendant-term");

        const after = await harness.durable.getById(executionId);
        expect(after?.observedState).toBe("cancelled");
        expect(after?.generation).toBe(before.generation + 1);
        const detail = await client.getThreadDetailSnapshot(String(threadId));
        const card = (detail?.thread.piSubagentExecutions ?? []).find(
          (candidate) => candidate.executionId === executionId,
        );
        expect(card?.observedState).toBe("cancelled");
        expect(card?.generation).toBe(before.generation + 1);

        process.stdout.write(
          `${stage} RUN_RECORD executionId=${executionId} attemptId=${before.attemptId} ` +
            `rootPid=${rootPid} descendantPid=${descendantPid} termEvidence=root,descendant ` +
            `noBand76WhileLive=true harnessRoot=${harness.rootDir} bands=75,76 ` +
            `generation=${before.generation}->${after?.generation}\n`,
        );
      } finally {
        await client.close();
        await harness.dispose();
      }
    },
    180_000,
  );
});

/**
 * Sound durable-read polling: the predicate only ever sees a defined value,
 * and the resolved value is only returned after a runtime `!== undefined`
 * check, so callers never receive `undefined` under the declared type.
 * Polling stays at 50 ms and the timeout diagnostic is unchanged.
 */
async function waitFor<Defined>(
  read: () => Awaited<Defined> | undefined | Promise<Awaited<Defined> | undefined>,
  predicate: (value: Exclude<Defined, undefined>) => boolean,
  timeoutMs: number,
  description: string,
): Promise<Exclude<Defined, undefined>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await Promise.resolve(read()).catch(() => undefined);
    if (value !== undefined && predicate(value as Exclude<Defined, undefined>)) {
      return value as Exclude<Defined, undefined>;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
