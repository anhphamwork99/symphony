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
    expect(inactive).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      unavailableReason: "provider_route_inactive",
    });
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
    expect(traces.some((entry) => entry.reason === "provider_route_inactive")).toBe(true);
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
      unavailableReason: "callback_timeout_before_acceptance",
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
      unavailableReason: "callback_failed_before_acceptance",
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

  it("classifies ordinary retirement before control acceptance as unavailable, not stale", async () => {
    const session = {};
    const pending = deferred<void>();
    const traces: string[] = [];
    const containment = makePiSubagentLiveLifecycleContainment({
      trace: ({ event }) => traces.push(event),
    });
    let calls = 0;
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markUnavailable }) => {
        calls += 1;
        await pending.promise;
        markUnavailable("provider_inactive");
        return "late value";
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      unavailableReason: "provider_inactive",
    });
    expect(calls).toBe(1);
    expect(traces).not.toContain("return_stale");
  });

  it("applies a successful accepted control after ordinary retirement and never reconstructs it", async () => {
    const session = {};
    const pending = deferred<void>();
    const containment = makePiSubagentLiveLifecycleContainment();
    let calls = 0;
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        calls += 1;
        markAccepted();
        await pending.promise;
        return "accepted result";
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({ status: "applied", value: "accepted result" });
    expect(await containment.control({ tuple, session, registration })).toMatchObject({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
    });
    expect(calls).toBe(1);
    expect(containment.capture({ tuple, session, control: () => "reconstructed" })).toBeUndefined();
    expect(containment.activate(registration)).toBe(false);
  });

  it("classifies an accepted control throw after ordinary retirement as outcome-unknown", async () => {
    const session = {};
    const pending = deferred<void>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        markAccepted();
        await pending.promise;
        throw new Error("late failure");
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
  });

  it("classifies an accepted response loss after ordinary retirement as outcome-unknown", async () => {
    const session = {};
    const pending = deferred<void>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted, markResponseLost }) => {
        markAccepted();
        await pending.promise;
        markResponseLost();
        return "untrusted result";
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
  });

  it("classifies an accepted timeout after ordinary retirement as outcome-unknown", async () => {
    const session = {};
    const pending = deferred<void>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted, markTimedOut }) => {
        markAccepted();
        await pending.promise;
        markTimedOut();
        return "late result";
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
  });

  it("ignores a success-shaped response when the tuple registration is replaced during await", async () => {
    const session = {};
    const pending = deferred<string>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const original = containment.capture({
      tuple,
      session,
      control: async ({ markAccepted }) => {
        markAccepted();
        return pending.promise;
      },
    })!;
    containment.activate(original);
    const inFlight = containment.control({ tuple, session, registration: original });

    const replacement = containment.capture({
      tuple,
      session,
      control: ({ markAccepted }) => {
        markAccepted();
        return "replacement";
      },
    })!;
    containment.activate(replacement);
    pending.resolve("original");

    expect(await inFlight).toEqual({
      status: "stale",
      diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
    });
    expect(await containment.control({ tuple, session, registration: replacement })).toEqual({
      status: "applied",
      value: "replacement",
    });
  });

  it("ignores an in-flight response after session clear while the replacement session remains live", async () => {
    const oldSession = {};
    const replacementSession = {};
    const pending = deferred<string>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const original = containment.capture({
      tuple,
      session: oldSession,
      control: async ({ markAccepted }) => {
        markAccepted();
        return pending.promise;
      },
    })!;
    containment.activate(original);
    const inFlight = containment.control({ tuple, session: oldSession, registration: original });

    const replacement = containment.capture({
      tuple,
      session: replacementSession,
      control: ({ markAccepted }) => {
        markAccepted();
        return "replacement session";
      },
    })!;
    containment.activate(replacement);
    containment.clearSession(oldSession);
    expect(
      await containment.control({
        tuple,
        session: replacementSession,
        registration: replacement,
      }),
    ).toEqual({ status: "applied", value: "replacement session" });

    pending.resolve("cleared original");
    expect(await inFlight).toEqual({
      status: "stale",
      diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
    });
  });

  it("classifies an unaccepted throw after ordinary retirement as unavailable", async () => {
    const session = {};
    const pending = deferred<void>();
    const containment = makePiSubagentLiveLifecycleContainment();
    const registration = containment.capture({
      tuple,
      session,
      control: async () => {
        await pending.promise;
        throw new Error("late failure");
      },
    })!;
    containment.activate(registration);
    const inFlight = containment.control({ tuple, session, registration });
    expect(containment.retire(registration)).toBe(true);
    pending.resolve();
    expect(await inFlight).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      unavailableReason: "callback_failed_before_acceptance",
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
      unavailableReason: "callback_failed_before_acceptance",
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

  it("preserves only the closed unavailable reason and never provider text", async () => {
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
    expect(result).toEqual({
      status: "unavailable",
      diagnosticCode: "pi_subagent_live_lifecycle_unavailable",
      unavailableReason: "callback_failed_before_acceptance",
    });
    expect("value" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sk-provider-secret");
    expect(result.unavailableReason).toBe("callback_failed_before_acceptance");
  });

  it("carries a closed reason on every unavailable path and omits it on applied, unknown, and stale", async () => {
    const reasons = new Set([
      "provider_inactive",
      "provider_route_inactive",
      "callback_missing",
      "callback_disposed",
      "callback_mismatched",
      "callback_failed_before_acceptance",
      "callback_timeout_before_acceptance",
    ]);
    const expectUnavailable = async (
      resultPromise: Promise<{
        readonly status: string;
        readonly unavailableReason?: string;
        readonly value?: unknown;
      }>,
    ) => {
      const result = await resultPromise;
      expect(result.status).toBe("unavailable");
      expect(reasons.has(result.unavailableReason ?? "")).toBe(true);
      expect("value" in result).toBe(false);
    };

    const missing = makePiSubagentLiveLifecycleContainment();
    await expectUnavailable(missing.control({ tuple, session: {}, registration: undefined }));

    const inactive = makePiSubagentLiveLifecycleContainment();
    const inactiveSession = {};
    const inactiveRegistration = inactive.capture({ tuple, session: inactiveSession })!;
    await expectUnavailable(
      inactive.control({ tuple, session: inactiveSession, registration: inactiveRegistration }),
    );

    const mismatched = makePiSubagentLiveLifecycleContainment();
    const mismatchedSession = {};
    const mismatchedRegistration = mismatched.capture({ tuple, session: mismatchedSession })!;
    mismatched.activate(mismatchedRegistration);
    await expectUnavailable(
      mismatched.control({
        tuple,
        session: mismatchedSession,
        registration: { tuple: { ...tuple }, session: mismatchedSession },
      }),
    );

    const disposed = makePiSubagentLiveLifecycleContainment();
    const disposedSession = {};
    const disposedRegistration = disposed.capture({ tuple, session: disposedSession })!;
    disposed.activate(disposedRegistration);
    disposed.retire(disposedRegistration);
    await expectUnavailable(
      disposed.control({ tuple, session: disposedSession, registration: disposedRegistration }),
    );

    const callbackMissing = makePiSubagentLiveLifecycleContainment();
    const callbackMissingSession = {};
    const callbackMissingRegistration = callbackMissing.capture({
      tuple,
      session: callbackMissingSession,
    })!;
    callbackMissing.activate(callbackMissingRegistration);
    await expectUnavailable(
      callbackMissing.control({
        tuple,
        session: callbackMissingSession,
        registration: callbackMissingRegistration,
      }),
    );

    const failed = makePiSubagentLiveLifecycleContainment();
    const failedSession = {};
    const failedRegistration = failed.capture({
      tuple,
      session: failedSession,
      control: () => {
        throw new Error("provider failure");
      },
    })!;
    failed.activate(failedRegistration);
    await expectUnavailable(
      failed.control({ tuple, session: failedSession, registration: failedRegistration }),
    );

    const timedOut = makePiSubagentLiveLifecycleContainment();
    const timedOutSession = {};
    const timedOutRegistration = timedOut.capture({
      tuple,
      session: timedOutSession,
      control: ({ markTimedOut }) => {
        markTimedOut();
        throw new Error("deadline");
      },
    })!;
    timedOut.activate(timedOutRegistration);
    await expectUnavailable(
      timedOut.control({ tuple, session: timedOutSession, registration: timedOutRegistration }),
    );

    const applied = makePiSubagentLiveLifecycleContainment();
    const appliedSession = {};
    const appliedRegistration = applied.capture({
      tuple,
      session: appliedSession,
      control: ({ markAccepted }) => {
        markAccepted();
        return "accepted";
      },
    })!;
    applied.activate(appliedRegistration);
    const appliedResult = await applied.control({
      tuple,
      session: appliedSession,
      registration: appliedRegistration,
    });
    expect(appliedResult).toEqual({ status: "applied", value: "accepted" });
    expect("unavailableReason" in appliedResult).toBe(false);

    const unknown = makePiSubagentLiveLifecycleContainment();
    const unknownSession = {};
    const unknownRegistration = unknown.capture({
      tuple,
      session: unknownSession,
      control: ({ markAccepted }) => {
        markAccepted();
        throw new Error("lost");
      },
    })!;
    unknown.activate(unknownRegistration);
    const unknownResult = await unknown.control({
      tuple,
      session: unknownSession,
      registration: unknownRegistration,
    });
    expect(unknownResult).toEqual({
      status: "outcome_unknown",
      diagnosticCode: "pi_subagent_live_lifecycle_outcome_unknown",
    });
    expect("unavailableReason" in unknownResult).toBe(false);

    const stale = makePiSubagentLiveLifecycleContainment();
    const staleSession = {};
    const pending = deferred<string>();
    const staleRegistration = stale.capture({
      tuple,
      session: staleSession,
      observe: () => pending.promise,
    })!;
    stale.activate(staleRegistration);
    const staleResultPromise = stale.observe({
      tuple,
      session: staleSession,
      registration: staleRegistration,
    });
    stale.retire(staleRegistration);
    pending.resolve("late");
    const staleResult = await staleResultPromise;
    expect(staleResult).toEqual({
      status: "stale",
      diagnosticCode: "pi_subagent_live_lifecycle_stale_ignored",
    });
    expect("unavailableReason" in staleResult).toBe(false);
  });
});
