import { describe, expect, it } from "vitest";

import type { PiSubagentExecutionRecord } from "@synara/contracts";

import { selectWallTimeExpiries } from "./piSubagentWallTimePolicy.ts";

interface ExecutionFixture {
  readonly executionId: string;
  readonly attemptId?: string;
  readonly generation?: number;
  readonly observedState?: PiSubagentExecutionRecord["observedState"];
  readonly createdAt: string;
}

const makeExecutions = (fixtures: ExecutionFixture[]) =>
  fixtures.map((fixture) => ({
    executionId: fixture.executionId,
    attemptId: fixture.attemptId ?? `att_${fixture.executionId}`,
    generation: fixture.generation ?? 1,
    parentThreadId: "thread_main",
    observedState: fixture.observedState ?? ("running" as const),
    createdAt: fixture.createdAt,
  }));

const NOW_MS = Date.parse("2026-08-18T12:00:00.000Z");
const TWO_HOURS_MS = 7200000;

describe("selectWallTimeExpiries (Issue 13 / T13-AC3)", () => {
  it("selects non-terminal executions past the budget measured from durable createdAt", () => {
    const executions = makeExecutions([
      { executionId: "exec_expired", createdAt: "2026-08-18T10:00:00.000Z" },
      { executionId: "exec_not_expired", createdAt: "2026-08-18T10:00:00.001Z" },
      {
        executionId: "exec_succeeded",
        observedState: "succeeded",
        createdAt: "2026-08-18T06:00:00.000Z",
      },
      {
        executionId: "exec_cancelled",
        observedState: "cancelled",
        createdAt: "2026-08-18T06:00:00.000Z",
      },
      {
        executionId: "exec_rejected",
        observedState: "rejected",
        createdAt: "2026-08-18T06:00:00.000Z",
      },
      {
        executionId: "exec_orphaned_still_eligible",
        observedState: "orphaned",
        createdAt: "2026-08-18T06:00:00.000Z",
      },
      {
        executionId: "exec_cancelling_still_eligible",
        observedState: "cancelling",
        createdAt: "2026-08-18T06:00:00.000Z",
      },
    ]);

    const { candidates } = selectWallTimeExpiries(executions, {
      wallTimeMs: TWO_HOURS_MS,
      nowMs: NOW_MS,
    });

    expect(candidates.map((candidate) => candidate.executionId)).toEqual([
      "exec_expired",
      "exec_orphaned_still_eligible",
      "exec_cancelling_still_eligible",
    ]);
    expect(candidates[0]).toEqual({
      executionId: "exec_expired",
      attemptId: "att_exec_expired",
      generation: 1,
      parentThreadId: "thread_main",
      admittedAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("boundary: exactly at the budget elapses the execution; one tick before does not", () => {
    const executions = makeExecutions([
      { executionId: "exec_exact", createdAt: "2026-08-18T10:00:00.000Z" },
      { executionId: "exec_one_tick", createdAt: "2026-08-18T10:00:00.001Z" },
    ]);
    const { candidates } = selectWallTimeExpiries(executions, {
      wallTimeMs: TWO_HOURS_MS,
      nowMs: NOW_MS,
    });
    expect(candidates.map((candidate) => candidate.executionId)).toEqual(["exec_exact"]);
  });

  it("fails safe on invalid budgets or clocks: no selection (T13-AC7)", () => {
    const executions = makeExecutions([
      { executionId: "exec_would_expire", createdAt: "2026-08-18T06:00:00.000Z" },
    ]);
    for (const wallTimeMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selectWallTimeExpiries(executions, { wallTimeMs, nowMs: NOW_MS }).candidates).toEqual(
        [],
      );
    }
    expect(
      selectWallTimeExpiries(executions, {
        wallTimeMs: TWO_HOURS_MS,
        nowMs: Number.NaN,
      }).candidates,
    ).toEqual([]);
  });

  it("skips executions with unparseable durable timestamps", () => {
    const executions = makeExecutions([{ executionId: "exec_bad_time", createdAt: "not-a-date" }]);
    const { candidates } = selectWallTimeExpiries(executions, {
      wallTimeMs: TWO_HOURS_MS,
      nowMs: NOW_MS,
    });
    expect(candidates).toEqual([]);
  });
});
