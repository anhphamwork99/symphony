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
      control: async ({ markAccepted, markResponseLost }) => {
        // A response loss is only meaningful after the provider-owned
        // acceptance point was actually marked.
        markAccepted();
        markResponseLost();
        throw new Error("connection closed");
      },
    })!;
    containment.activate(lost);
    expect((await containment.control({ tuple, session, registration: lost })).diagnosticCode).toBe(
      "pi_subagent_live_lifecycle_outcome_unknown",
    );

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
    expect(traces.some((entry) => entry.reason === "callback_timeout_before_acceptance")).toBe(
      true,
    );
    expect(traces.some((entry) => entry.reason === "callback_timeout_after_acceptance")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_lost_after_acceptance")).toBe(true);
    expect(traces.some((entry) => entry.reason === "callback_failed_after_acceptance")).toBe(true);
    expect(JSON.stringify(traces)).not.toContain("connection closed");
  });

  it("does not expose a value that resolves after an explicit timeout marker", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();

    const observation = containment.capture({
      tuple,
      session,
      observe: async ({ markTimedOut }) => {
        markTimedOut();
        return "late observation";
      },
    })!;
    containment.activate(observation);
    expect(await containment.observe({ tuple, session, registration: observation })).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });

    const control = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted, markTimedOut }) => {
        markAccepted();
        markTimedOut();
        return "late control";
      },
    })!;
    containment.activate(control);
    expect(await containment.control({ tuple, session, registration: control })).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
  });

  it("uses collision-free exact tuple keys for identifiers containing delimiters", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    const firstTuple = { executionId: "a\u0000b", attemptId: "c", generation: 1 };
    const secondTuple = { executionId: "a", attemptId: "b\u0000c", generation: 1 };
    const first = containment.capture({
      tuple: firstTuple,
      session,
      observe: async () => "first",
    })!;
    const second = containment.capture({
      tuple: secondTuple,
      session,
      observe: async () => "second",
    })!;
    containment.activate(first);
    containment.activate(second);

    expect(await containment.observe({ tuple: firstTuple, session, registration: first })).toEqual({
      status: "applied",
      value: "first",
    });
    expect(
      await containment.observe({ tuple: secondTuple, session, registration: second }),
    ).toEqual({ status: "applied", value: "second" });
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
    expect(await containment.observe({ tuple, session, registration })).toMatchObject({
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
    expect(
      containment.capture({ tuple, session: sessionOne, observe: () => "reconstructed" }),
    ).toBeUndefined();
    expect(await containment.observe({ tuple, session: sessionTwo, registration: two })).toEqual({
      status: "applied",
      value: "two",
    });
  });

  // ---- WP-01 P0 remediation: causal negative contracts ----

  it("never applies pure control that returned without marking acceptance", async () => {
    const session = {};
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });
    let calls = 0;
    const registration = containment.capture({
      tuple,
      session,
      control: () => {
        calls += 1;
        // Returns a value but NEVER marks the provider-owned acceptance
        // boundary: no accepted effect exists, so this must not be applied.
        return "phantom success";
      },
    })!;
    containment.activate(registration);
    const result = await containment.control({ tuple, session, registration });
    expect(calls).toBe(1);
    expect(result).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
    // The value must never be exposed, and the trace must carry the explicit
    // non-timeout reason for an unmarked return.
    expect("value" in result).toBe(false);
    expect(traces).not.toContainEqual({ event: "return_applied", tuple });
    const failure = traces.find((entry) => entry.event === "return_unavailable");
    expect(failure?.reason).toBe("callback_failed_before_acceptance");
  });

  it("propagates a typed structured provider-inactive classification over a returned value", async () => {
    const session = {};
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });
    let calls = 0;
    const registration = containment.capture({
      tuple,
      session,
      control: ({ markUnavailable }) => {
        calls += 1;
        markUnavailable("provider_inactive");
        return { looksLike: "a value" };
      },
    })!;
    containment.activate(registration);
    const result = await containment.control({ tuple, session, registration });
    expect(calls).toBe(1);
    expect(result.status).toBe("unavailable");
    expect(result.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");
    expect("value" in result).toBe(false);
    expect(traces).toContainEqual({
      event: "provider_unavailable",
      tuple,
      reason: "provider_inactive",
    });
    expect(
      traces.some(
        (entry) => entry.event === "return_unavailable" && entry.reason === "provider_inactive",
      ),
    ).toBe(true);
    // No acceptance boundary was ever marked.
    expect(traces).not.toContainEqual({ event: "provider_acceptance", tuple });
  });

  it("keeps timeout reasons reachable only through markTimedOut, never from a bare throw", async () => {
    const session = {};
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });
    const bare = containment.capture({
      tuple,
      session,
      control: async () => {
        throw new Error("transport exploded");
      },
    })!;
    containment.activate(bare);
    const bareResult = await containment.control({ tuple, session, registration: bare });
    expect(bareResult.status).toBe("unavailable");
    const bareReasons = traces
      .filter((entry) => entry.event === "return_unavailable")
      .map((entry) => entry.reason);
    expect(bareReasons).toContain("callback_failed_before_acceptance");
    expect(bareReasons).not.toContain("callback_timeout_before_acceptance");

    const explicit = containment.capture({
      tuple,
      session,
      control: async ({ markTimedOut }) => {
        markTimedOut();
        throw new Error("deadline");
      },
    })!;
    containment.activate(explicit);
    expect((await containment.control({ tuple, session, registration: explicit })).status).toBe(
      "unavailable",
    );
    expect(
      traces.some(
        (entry) =>
          entry.event === "return_unavailable" &&
          entry.reason === "callback_timeout_before_acceptance",
      ),
    ).toBe(true);
    // The raw throw text never reaches the bounded trace surface.
    expect(JSON.stringify(traces)).not.toContain("transport exploded");
    expect(JSON.stringify(traces)).not.toContain("deadline");
  });

  it("keeps observation free of provider_acceptance and outcome_unknown for every failure shape", async () => {
    const session = {};
    const traces: Array<{ event: string; reason?: string }> = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: (entry) => traces.push(entry),
    });
    const thrown = containment.capture({
      tuple,
      session,
      observe: async () => {
        throw new Error("observation transport failure");
      },
    })!;
    containment.activate(thrown);
    expect(await containment.observe({ tuple, session, registration: thrown })).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });

    // Even a callback that (incorrectly) marks acceptance/loss on the
    // observation path can never produce outcome_unknown or provider_acceptance.
    const misusing = containment.capture({
      tuple,
      session,
      observe: async ({ markAccepted, markResponseLost, markTimedOut }) => {
        markAccepted();
        markTimedOut();
        markResponseLost();
        throw new Error("must still be unavailable");
      },
    })!;
    containment.activate(misusing);
    const misused = await containment.observe({ tuple, session, registration: misusing });
    expect(misused.status).toBe("unavailable");
    expect(misused.diagnosticCode).toBe("pi_subagent_live_lifecycle_unavailable");

    expect(traces).not.toContainEqual({ event: "provider_acceptance", tuple });
    expect(traces).not.toContainEqual(expect.objectContaining({ event: "return_outcome_unknown" }));
    expect(JSON.stringify(traces)).not.toContain("observation transport failure");
  });

  it("binds status semantics per path: identical marks classify differently for control and observation", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    const control = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted, markResponseLost }) => {
        markAccepted();
        markResponseLost();
        throw new Error("lost");
      },
    })!;
    containment.activate(control);
    expect(await containment.control({ tuple, session, registration: control })).toMatchObject({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });

    const observation = containment.capture({
      tuple,
      session,
      observe: async ({ markAccepted, markResponseLost }) => {
        markAccepted();
        markResponseLost();
        throw new Error("lost");
      },
    })!;
    containment.activate(observation);
    expect(await containment.observe({ tuple, session, registration: observation })).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
  });

  it("retires only by exact registration identity: a stale equal tuple cannot retire its replacement", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    let firstCalls = 0;
    const stale = containment.capture({
      tuple,
      session,
      control: ({ markAccepted }) => {
        firstCalls += 1;
        markAccepted();
        return "stale";
      },
    })!;
    containment.activate(stale);
    // A replacement capture retires the stale registration itself, then the
    // stale handle must NOT be able to retire the live replacement.
    const replacement = containment.capture({
      tuple,
      session,
      control: ({ markAccepted }) => {
        markAccepted();
        return "replacement";
      },
    })!;
    containment.activate(replacement);
    expect(containment.retire(stale)).toBe(false);
    expect(await containment.control({ tuple, session, registration: stale })).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
    expect(firstCalls).toBe(0);
    expect(await containment.control({ tuple, session, registration: replacement })).toEqual({
      status: "applied",
      value: "replacement",
    });
    expect(containment.retire(replacement)).toBe(true);
    expect(await containment.control({ tuple, session, registration: replacement })).toMatchObject({
      status: "unavailable",
    });
  });

  it("never exposes internal reasons or provider text on the public result surface", async () => {
    const session = {};
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async () => {
        throw new Error("sk-provider-secret must not leak");
      },
    })!;
    containment.activate(registration);
    const result = await containment.control({ tuple, session, registration });
    expect(Object.keys(result).toSorted()).toEqual(["diagnosticCode", "status"]);
    expect(JSON.stringify(result)).not.toContain("sk-provider-secret");
    expect(JSON.stringify(result)).not.toContain("callback_");
  });
});
