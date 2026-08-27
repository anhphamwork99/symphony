import { describe, expect, it } from "vitest";

import {
  makePiSubagentLiveLifecycleContainment,
  type PiSubagentLiveLifecycleTuple,
} from "./piSubagentLiveLifecycleContainment.ts";

const tuple: PiSubagentLiveLifecycleTuple = {
  executionId: "execution-1",
  attemptId: "attempt-1",
  generation: 1,
};

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("PiSubagentLiveLifecycleContainment", () => {
  it("captures without activating, then applies exactly one live observation", async () => {
    const session = {};
    let calls = 0;
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      observe: async () => {
        calls += 1;
        return { state: "running" };
      },
    });
    expect(registration).toBeDefined();

    const before = await containment.observe({ tuple, session, registration });
    expect(before).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
    expect(calls).toBe(0);

    expect(containment.activate(registration!)).toBe(true);
    expect(containment.activate(registration!)).toBe(true);
    const after = await containment.observe({ tuple, session, registration });
    expect(after).toEqual({ status: "applied", value: { state: "running" } });
    expect(calls).toBe(1);
  });

  it("isolates sibling sessions and equal public tuples", async () => {
    const sessionOne = {};
    const sessionTwo = {};
    let oneCalls = 0;
    let twoCalls = 0;
    const containment = makePiSubagentLiveLifecycleContainment();
    const one = containment.capture({
      tuple,
      session: sessionOne,
      control: ({ markAccepted }) => {
        oneCalls += 1;
        markAccepted();
        return "one";
      },
    })!;
    const two = containment.capture({
      tuple,
      session: sessionTwo,
      control: ({ markAccepted }) => {
        twoCalls += 1;
        markAccepted();
        return "two";
      },
    })!;
    containment.activate(one);
    containment.activate(two);

    expect(await containment.control({ tuple, session: sessionOne, registration: one })).toEqual({
      status: "applied",
      value: "one",
    });
    expect(await containment.control({ tuple, session: sessionTwo, registration: two })).toEqual({
      status: "applied",
      value: "two",
    });
    expect(oneCalls).toBe(1);
    expect(twoCalls).toBe(1);
  });

  it("returns unavailable and never dispatches for missing, mismatched, inactive, or disposed routes", async () => {
    const session = {};
    let calls = 0;
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });
    const registration = containment.capture({
      tuple,
      session,
      control: () => {
        calls += 1;
        return "must not run";
      },
    })!;
    const missing = await containment.control({ tuple, session: {}, registration });
    expect(missing.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
    expect(calls).toBe(0);

    const inactive = await containment.control({ tuple, session, registration });
    expect(inactive.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
    expect(calls).toBe(0);

    containment.activate(registration);
    const mismatched = await containment.control({
      tuple,
      session,
      registration: { tuple: { ...tuple }, session },
    });
    expect(mismatched.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
    expect(calls).toBe(0);

    expect(containment.retire(registration)).toBe(true);
    expect(containment.capture({ tuple, session, control: () => "reconstructed" })).toBeUndefined();
    const disposed = await containment.control({ tuple, session, registration });
    expect(disposed.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
    expect(calls).toBe(0);
    expect(traces.some((entry) => entry.reason === "callback_missing")).toBe(true);
    expect(traces.some((entry) => entry.reason === "provider_inactive")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_mismatched")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_disposed")).toBe(true);
  });

  it("classifies timeout and response-loss causes without exposing internal reasons", async () => {
    const session = {};
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });

    const beforeTimeout = containment.capture({
      tuple,
      session,
      control: async ({ markTimedOut }) => {
        markTimedOut();
        throw new Error("bounded timeout");
      },
    })!;
    containment.activate(beforeTimeout);
    expect(
      (await containment.control({ tuple, session, registration: beforeTimeout })).diagnosticCode,
    ).toBe("pi_subagent_live_lifecycle_unavailable");

    const afterTimeout = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted, markTimedOut }) => {
        markAccepted();
        markTimedOut();
        throw new Error("bounded timeout");
      },
    })!;
    containment.activate(afterTimeout);
    expect(
      (await containment.control({ tuple, session, registration: afterTimeout })).diagnosticCode,
    ).toBe("pi_subagent_live_lifecycle_outcome_unknown");

    const lost = containment.capture({
      tuple,
      session,
      control: async ({ markResponseLost }) => {
        markResponseLost();
        throw new Error("connection closed");
      },
    })!;
    containment.activate(lost);
    expect(
      (await containment.control({ tuple, session, registration: lost })).diagnosticCode,
    ).toBe("pi_subagent_live_lifecycle_outcome_unknown");

    const failed = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        markAccepted();
        throw new Error("provider failure");
      },
    })!;
    containment.activate(failed);
    expect(
      (await containment.control({ tuple, session, registration: failed })).diagnosticCode,
    ).toBe("pi_subagent_live_lifecycle_outcome_unknown");
    expect(traces.some((entry) => entry.reason === "callback_timeout_before_acceptance")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_timeout_after_acceptance")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_lost_after_acceptance")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_failed_after_acceptance")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("connection closed");
  });

  it("classifies pre-acceptance failure as unavailable and post-acceptance loss as outcome unknown", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    const before = containment.capture({
      tuple,
      session,
      control: async () => {
        throw new Error("provider secret must not escape");
      },
    })!;
    containment.activate(before);
    const unavailable = await containment.control({ tuple, session, registration: before });
    expect(unavailable).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });

    const after = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        markAccepted();
        throw new Error("response lost");
      },
    })!;
    containment.activate(after);
    const unknown = await containment.control({ tuple, session, registration: after });
    expect(unknown).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
  });

  it("revalidates after await and permanently ignores a retired late response", async () => {
    const session = {};
    const pending = deferred<string>();
    let calls = 0;
    const traces: string[] = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: ({ event }) => traces.push(event),
    });
    const registration = containment.capture({
      tuple,
      session,
      observe: () => {
        calls += 1;
        return pending.promise;
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.observe({ tuple, session, registration });
    expect(calls).toBe(1);
    expect(containment.retire(registration)).toBe(true);
    pending.resolve("late");
    expect(await inFlight).toEqual({
      status: "stale",
      diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
    });
    expect(
      await containment.observe({ tuple, session, registration }),
    ).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
    expect(traces).toContain("response_revalidated");
    expect(traces).toContain("return_stale");
  });

  it("does not expose an outcome-unknown failure after retirement wins the race", async () => {
    const session = {};
    const pending = deferred<never>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        markAccepted();
        return pending.promise;
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.reject(new Error("late failure"));
    expect(await inFlight).toEqual({
      status: "stale",
      diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
    });
  });

  it("clears every route for a session without affecting another session", async () => {
    const sessionOne = {};
    const sessionTwo = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    const one = containment.capture({
      tuple,
      session: sessionOne,
      observe: () => "one",
    })!;
    const two = containment.capture({
      tuple,
      session: sessionTwo,
      observe: () => "two",
    })!;
    containment.activate(one);
    containment.activate(two);
    containment.clearSession(sessionOne);

    expect(
      await containment.observe({ tuple, session: sessionOne, registration: one }),
    ).toMatchObject({ diagnosticCode: "pi_subagent_live_lifecycle_unavailable" });
    expect(containment.capture({ tuple, session: sessionOne, observe: () => "reconstructed" })).toBeUndefined();
    expect(await containment.observe({ tuple, session: sessionTwo, registration: two })).toEqual({
      status: "applied",
      value: "two",
    });
  });
});
