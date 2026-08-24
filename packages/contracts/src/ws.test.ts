import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ORCHESTRATION_WS_CHANNELS, ORCHESTRATION_WS_METHODS } from "./orchestration";
import { DEVICE_PROJECT_WS_CHANNELS, DEVICE_WS_METHODS } from "./device";
import {
  WsPushDeviceProjectEvent,
  WebSocketRequest,
  WsResponse,
  WS_CHANNELS,
  WS_METHODS,
} from "./ws";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("accepts getTurnDiff requests when fromTurnCount <= toTurnCount", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-1",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: "thread-1",
        fromTurnCount: 1,
        toTurnCount: 2,
      },
    });
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
  }),
);

it.effect("rejects getTurnDiff requests when fromTurnCount > toTurnCount", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(WebSocketRequest, {
        id: "req-1",
        body: {
          _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
          threadId: "thread-1",
          fromTurnCount: 3,
          toTurnCount: 2,
        },
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims websocket request id and nested orchestration ids", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: " req-1 ",
      body: {
        _tag: ORCHESTRATION_WS_METHODS.getTurnDiff,
        threadId: " thread-1 ",
        fromTurnCount: 0,
        toTurnCount: 0,
      },
    });
    assert.strictEqual(parsed.id, "req-1");
    assert.strictEqual(parsed.body._tag, ORCHESTRATION_WS_METHODS.getTurnDiff);
    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getTurnDiff) {
      assert.strictEqual(parsed.body.threadId, "thread-1");
    }
  }),
);

it.effect("accepts git.preparePullRequestThread requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-pr-1",
      body: {
        _tag: WS_METHODS.gitPreparePullRequestThread,
        cwd: "/repo",
        reference: "#42",
        mode: "worktree",
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.gitPreparePullRequestThread);
  }),
);

it.effect("accepts project script discovery requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-project-scripts-1",
      body: {
        _tag: WS_METHODS.projectsDiscoverScripts,
        cwd: "/repo",
        depth: 1,
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.projectsDiscoverScripts);
  }),
);

it.effect("accepts automation create requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-automation-create-1",
      body: {
        _tag: WS_METHODS.automationCreate,
        name: "Nightly maintenance",
        projectId: "project-1",
        prompt: "Check stale dependencies.",
        schedule: { type: "manual" },
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.automationCreate);
  }),
);

it.effect("accepts automation proposal resolution requests", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-automation-proposal-1",
      body: {
        _tag: WS_METHODS.automationResolveProposal,
        automationId: "automation-1",
        resolution: "accepted",
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.automationResolveProposal);
  }),
);

it.effect("accepts automation run action requests", () =>
  Effect.gen(function* () {
    const markRead = yield* decode(WebSocketRequest, {
      id: "req-automation-read-1",
      body: {
        _tag: WS_METHODS.automationMarkRunRead,
        runId: "run-1",
        unread: false,
      },
    });
    const archive = yield* decode(WebSocketRequest, {
      id: "req-automation-archive-1",
      body: {
        _tag: WS_METHODS.automationArchiveRun,
        runId: "run-1",
        archived: true,
      },
    });

    assert.strictEqual(markRead.body._tag, WS_METHODS.automationMarkRunRead);
    assert.strictEqual(archive.body._tag, WS_METHODS.automationArchiveRun);
  }),
);

it.effect("accepts typed websocket push envelopes with sequence", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.type, "push");
    assert.strictEqual(parsed.sequence, 1);
    assert.strictEqual(parsed.channel, WS_CHANNELS.serverWelcome);
  }),
);

it.effect("accepts git.actionProgress push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.gitActionProgress,
      data: {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.gitActionProgress);
  }),
);

it.effect("accepts git.worktreeSetupProgress push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 5,
      channel: WS_CHANNELS.gitWorktreeSetupProgress,
      data: {
        progressId: "progress-1",
        kind: "phase_started",
        phase: "branch",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.gitWorktreeSetupProgress);
  }),
);

it.effect("accepts automation.event push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 4,
      channel: WS_CHANNELS.automationEvent,
      data: {
        type: "definition-deleted",
        automationId: "automation-1",
      },
    });

    if (!("type" in parsed) || parsed.type !== "push") {
      assert.fail("expected websocket response to decode as a push envelope");
    }

    assert.strictEqual(parsed.channel, WS_CHANNELS.automationEvent);
  }),
);

it.effect("rejects push envelopes when channel payload does not match the channel schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(WsResponse, {
        type: "push",
        sequence: 2,
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: {
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

// ── WP4: Project-owned terminal method registration ─────────────────

it.effect("accepts project terminal open requests keyed by real ProjectId", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WebSocketRequest, {
      id: "req-terminal-project-open-1",
      body: {
        _tag: WS_METHODS.terminalProjectOpen,
        projectId: "project-1",
        terminalId: "default",
        cwd: "/repo",
        cols: 120,
        rows: 30,
      },
    });
    assert.strictEqual(parsed.body._tag, WS_METHODS.terminalProjectOpen);
    if (parsed.body._tag === WS_METHODS.terminalProjectOpen) {
      assert.strictEqual(parsed.body.projectId, "project-1");
      assert.strictEqual(parsed.body.cwd, "/repo");
    }
  }),
);

it.effect("defaults project terminal id and accepts write/close without a pseudo thread", () =>
  Effect.gen(function* () {
    const write = yield* decode(WebSocketRequest, {
      id: "req-terminal-project-write-1",
      body: {
        _tag: WS_METHODS.terminalProjectWrite,
        projectId: "project-1",
        data: "ls\r",
      },
    });
    const close = yield* decode(WebSocketRequest, {
      id: "req-terminal-project-close-1",
      body: {
        _tag: WS_METHODS.terminalProjectClose,
        projectId: "project-1",
      },
    });
    const list = yield* decode(WebSocketRequest, {
      id: "req-terminal-project-list-1",
      body: {
        _tag: WS_METHODS.terminalProjectList,
        projectId: "project-1",
      },
    });

    assert.strictEqual(write.body._tag, WS_METHODS.terminalProjectWrite);
    if (write.body._tag === WS_METHODS.terminalProjectWrite) {
      // The Project terminal default mirrors the thread surface: omitted
      // terminalId decodes to "default" rather than a synthetic thread key.
      assert.strictEqual(write.body.terminalId, "default");
    }
    assert.strictEqual(close.body._tag, WS_METHODS.terminalProjectClose);
    assert.strictEqual(list.body._tag, WS_METHODS.terminalProjectList);
    // A Project terminal open without its ProjectId is not decodable: the
    // owning Project must be identified explicitly, never inferred.
    const rejected = yield* Effect.exit(
      decode(WebSocketRequest, {
        id: "req-terminal-project-reject-1",
        body: {
          _tag: WS_METHODS.terminalProjectOpen,
          cwd: "/repo",
        },
      }),
    );
    assert.strictEqual(rejected._tag, "Failure");
  }),
);

it.effect("decodes project terminal push events on their own channel", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsResponse, {
      type: "push",
      sequence: 7,
      channel: WS_CHANNELS.terminalProjectEvent,
      data: {
        type: "started",
        projectId: "project-1",
        terminalId: "default",
        createdAt: "2026-08-24T00:00:00.000Z",
        snapshot: {
          projectId: "project-1",
          terminalId: "default",
          cwd: "/repo",
          status: "running",
          pid: 123,
          history: "",
          exitCode: null,
          exitSignal: null,
          updatedAt: "2026-08-24T00:00:00.000Z",
        },
      },
    });
    assert.strictEqual(parsed.type, "push");
    if (parsed.type === "push") {
      assert.strictEqual(parsed.channel, WS_CHANNELS.terminalProjectEvent);
    }
  }),
);

// ── WP5: Project-owned device method registration ───────────────────

it.effect("accepts project device requests keyed by real ProjectId", () =>
  Effect.gen(function* () {
    const getState = yield* decode(WebSocketRequest, {
      id: "req-device-project-getstate-1",
      body: {
        _tag: DEVICE_WS_METHODS.getProjectState,
        projectId: "project-1",
      },
    });
    assert.strictEqual(getState.body._tag, DEVICE_WS_METHODS.getProjectState);

    const attach = yield* decode(WebSocketRequest, {
      id: "req-device-project-attach-1",
      body: {
        _tag: DEVICE_WS_METHODS.attachProject,
        projectId: "project-1",
        udid: "FAKE-0001",
      },
    });
    assert.strictEqual(attach.body._tag, DEVICE_WS_METHODS.attachProject);

    const detach = yield* decode(WebSocketRequest, {
      id: "req-device-project-detach-1",
      body: {
        _tag: DEVICE_WS_METHODS.detachProject,
        projectId: "project-1",
      },
    });
    assert.strictEqual(detach.body._tag, DEVICE_WS_METHODS.detachProject);

    // The owning Project must be identified explicitly: an attach without its
    // ProjectId is not decodable, and no pseudo-ThreadId key is accepted.
    const rejected = yield* Effect.exit(
      decode(WebSocketRequest, {
        id: "req-device-project-reject-1",
        body: {
          _tag: DEVICE_WS_METHODS.attachProject,
          udid: "FAKE-0001",
        },
      }),
    );
    assert.strictEqual(rejected._tag, "Failure");
  }),
);

it.effect("decodes project device push events on their own channel", () =>
  Effect.gen(function* () {
    // Decode through the dedicated push schema: the event must validate as a
    // device.project-event push AND its payload as a ProjectDeviceState naming
    // the owning Project — proving the channel carries Project-owned state,
    // never a Thread-keyed snapshot.
    const parsed = yield* decode(WsPushDeviceProjectEvent, {
      type: "push",
      sequence: 3,
      channel: DEVICE_PROJECT_WS_CHANNELS.event,
      data: {
        type: "device.project-state",
        state: {
          projectId: "project-1",
          version: 1,
          attachedDeviceUdid: "FAKE-0001",
          devices: [],
          agentActive: false,
          availability: { kind: "available" },
          lastError: null,
        },
      },
    });
    assert.strictEqual(parsed.channel, DEVICE_PROJECT_WS_CHANNELS.event);
    assert.strictEqual(parsed.data.state.projectId, "project-1");
    assert.strictEqual(parsed.data.state.attachedDeviceUdid, "FAKE-0001");
  }),
);
