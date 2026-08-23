import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_TERMINAL_ID,
  TerminalAckOutputInput,
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalProjectCloseInput,
  TerminalProjectEvent,
  TerminalProjectOpenInput,
  TerminalProjectSessionSnapshot,
  TerminalProjectWriteInput,
  TerminalResizeInput,
  TerminalSessionSnapshot,
  TerminalThreadInput,
  TerminalWriteInput,
} from "./terminal";

function decodeSync<S extends Schema.Top>(schema: S, input: unknown): Schema.Schema.Type<S> {
  return Schema.decodeUnknownSync(schema as never)(input) as Schema.Schema.Type<S>;
}

function decodes<S extends Schema.Top>(schema: S, input: unknown): boolean {
  try {
    Schema.decodeUnknownSync(schema as never)(input);
    return true;
  } catch {
    return false;
  }
}

describe("TerminalOpenInput", () => {
  it("accepts valid open input", () => {
    expect(
      decodes(TerminalOpenInput, {
        threadId: "thread-1",
        cwd: "/tmp/project",
        cols: 120,
        rows: 40,
      }),
    ).toBe(true);
  });

  it("rejects invalid bounds", () => {
    expect(
      decodes(TerminalOpenInput, {
        threadId: "thread-1",
        cwd: "/tmp/project",
        cols: 10,
        rows: 2,
      }),
    ).toBe(false);
  });

  it("accepts ultrawide column counts", () => {
    // Regression: a fit on a wide viewport at a small font legitimately exceeds
    // the old 400-column cap (e.g. 436), which must not fail the terminal open.
    expect(
      decodes(TerminalOpenInput, {
        threadId: "thread-1",
        cwd: "/tmp/project",
        cols: 436,
        rows: 40,
      }),
    ).toBe(true);
  });

  it("rejects dimensions beyond the PTY ceiling", () => {
    expect(
      decodes(TerminalOpenInput, {
        threadId: "thread-1",
        cwd: "/tmp/project",
        cols: 2001,
        rows: 40,
      }),
    ).toBe(false);
  });

  it("defaults terminalId when missing", () => {
    const parsed = decodeSync(TerminalOpenInput, {
      threadId: "thread-1",
      cwd: "/tmp/project",
      cols: 100,
      rows: 24,
    });
    expect(parsed.terminalId).toBe(DEFAULT_TERMINAL_ID);
  });

  it("accepts optional env overrides", () => {
    const parsed = decodeSync(TerminalOpenInput, {
      threadId: "thread-1",
      cwd: "/tmp/project",
      cols: 100,
      rows: 24,
      env: {
        SYNARA_PROJECT_ROOT: "/tmp/project",
        CUSTOM_FLAG: "1",
      },
    });
    expect(parsed.env).toMatchObject({
      SYNARA_PROJECT_ROOT: "/tmp/project",
      CUSTOM_FLAG: "1",
    });
  });

  it("rejects invalid env keys", () => {
    expect(
      decodes(TerminalOpenInput, {
        threadId: "thread-1",
        cwd: "/tmp/project",
        cols: 100,
        rows: 24,
        env: {
          "bad-key": "1",
        },
      }),
    ).toBe(false);
  });
});

describe("TerminalWriteInput", () => {
  it("accepts non-empty data", () => {
    expect(
      decodes(TerminalWriteInput, {
        threadId: "thread-1",
        data: "echo hello\n",
      }),
    ).toBe(true);
  });

  it("rejects empty data", () => {
    expect(
      decodes(TerminalWriteInput, {
        threadId: "thread-1",
        data: "",
      }),
    ).toBe(false);
  });
});

describe("TerminalAckOutputInput", () => {
  it("accepts positive parsed byte counts", () => {
    expect(
      decodes(TerminalAckOutputInput, {
        threadId: "thread-1",
        bytes: 4096,
      }),
    ).toBe(true);
  });

  it("rejects empty ACKs", () => {
    expect(
      decodes(TerminalAckOutputInput, {
        threadId: "thread-1",
        bytes: 0,
      }),
    ).toBe(false);
  });
});

describe("TerminalThreadInput", () => {
  it("trims thread ids", () => {
    const parsed = decodeSync(TerminalThreadInput, { threadId: " thread-1 " });
    expect(parsed.threadId).toBe("thread-1");
  });
});

describe("TerminalResizeInput", () => {
  it("accepts valid size", () => {
    expect(
      decodes(TerminalResizeInput, {
        threadId: "thread-1",
        cols: 80,
        rows: 24,
      }),
    ).toBe(true);
  });
});

describe("TerminalClearInput", () => {
  it("defaults terminal id", () => {
    const parsed = decodeSync(TerminalClearInput, {
      threadId: "thread-1",
    });
    expect(parsed.terminalId).toBe(DEFAULT_TERMINAL_ID);
  });
});

describe("TerminalCloseInput", () => {
  it("accepts optional deleteHistory", () => {
    expect(
      decodes(TerminalCloseInput, {
        threadId: "thread-1",
        deleteHistory: true,
      }),
    ).toBe(true);
  });
});

describe("TerminalSessionSnapshot", () => {
  it("accepts running snapshots", () => {
    expect(
      decodes(TerminalSessionSnapshot, {
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        cwd: "/tmp/project",
        status: "running",
        pid: 1234,
        history: "hello\n",
        replayPreamble: "\u001b[?2004h\u001b[=7;1u",
        exitCode: null,
        exitSignal: null,
        updatedAt: new Date().toISOString(),
      }),
    ).toBe(true);
  });
});

describe("TerminalEvent", () => {
  it("accepts output events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "output",
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        data: "line\n",
      }),
    ).toBe(true);
  });

  it("accepts output events with byte length", () => {
    expect(
      decodes(TerminalEvent, {
        type: "output",
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        data: "line\n",
        byteLength: 5,
      }),
    ).toBe(true);
  });

  it("accepts exited events", () => {
    expect(
      decodes(TerminalEvent, {
        type: "exited",
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        exitCode: 0,
        exitSignal: null,
      }),
    ).toBe(true);
  });

  it.each(["codex", "claude", "antigravity"] as const)("accepts %s activity events", (cliKind) => {
    expect(
      decodes(TerminalEvent, {
        type: "activity",
        threadId: "thread-1",
        terminalId: DEFAULT_TERMINAL_ID,
        createdAt: new Date().toISOString(),
        hasRunningSubprocess: true,
        cliKind,
        agentState: "running",
      }),
    ).toBe(true);
  });
});

describe("TerminalProjectOpenInput", () => {
  it("accepts a valid Project-owned open input and defaults the terminal id", () => {
    const parsed = decodeSync(TerminalProjectOpenInput, {
      projectId: "project-1",
      cwd: "/tmp/project",
      cols: 120,
      rows: 40,
    });
    expect(parsed.projectId).toBe("project-1");
    expect(parsed.terminalId).toBe(DEFAULT_TERMINAL_ID);
  });

  it("rejects a missing ProjectId", () => {
    expect(
      decodes(TerminalProjectOpenInput, {
        cwd: "/tmp/project",
        cols: 120,
        rows: 40,
      }),
    ).toBe(false);
  });

  it("rejects a malformed ProjectId", () => {
    expect(
      decodes(TerminalProjectOpenInput, {
        projectId: "   ",
        cwd: "/tmp/project",
      }),
    ).toBe(false);
  });
});

describe("TerminalProjectWriteInput", () => {
  it("accepts a Project-owned write and rejects a missing ProjectId", () => {
    expect(
      decodes(TerminalProjectWriteInput, {
        projectId: "project-1",
        data: "echo hello\n",
      }),
    ).toBe(true);
    expect(decodes(TerminalProjectWriteInput, { data: "echo hello\n" })).toBe(false);
  });
});

describe("TerminalProjectCloseInput", () => {
  it("carries the owning ProjectId", () => {
    const parsed = decodeSync(TerminalProjectCloseInput, {
      projectId: "project-1",
      deleteHistory: true,
    });
    expect(parsed.projectId).toBe("project-1");
    expect(decodes(TerminalProjectCloseInput, { deleteHistory: true })).toBe(false);
  });
});

describe("TerminalProjectSessionSnapshot", () => {
  it("round-trips a Project-owned snapshot", () => {
    const decoded = decodeSync(TerminalProjectSessionSnapshot, {
      projectId: "project-1",
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: "/tmp/project",
      status: "running",
      pid: 1234,
      history: "hello\n",
      exitCode: null,
      exitSignal: null,
      updatedAt: new Date().toISOString(),
    });
    expect(decoded.projectId).toBe("project-1");
  });
});

describe("TerminalProjectEvent", () => {
  it("accepts Project-owned output events and rejects a missing ProjectId", () => {
    const base = {
      type: "output",
      terminalId: DEFAULT_TERMINAL_ID,
      createdAt: new Date().toISOString(),
      data: "line\n",
    };
    expect(decodes(TerminalProjectEvent, { ...base, projectId: "project-1" })).toBe(true);
    expect(decodes(TerminalProjectEvent, base)).toBe(false);
    expect(decodes(TerminalProjectEvent, { ...base, projectId: "  " })).toBe(false);
  });
});
