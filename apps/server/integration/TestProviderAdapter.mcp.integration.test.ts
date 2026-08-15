// FILE: TestProviderAdapter.mcp.integration.test.ts
// Purpose: impl-12 WP2 fixture tests for the TestProviderAdapter harness's
// deterministic Synara MCP lifecycle controls (Decision 20 provider/MCP
// boundary seam; impl-12 AC1 fixture slice). The tests prove: the harness
// captures the server-minted mcpAuthority from the session-start input; the
// optional enableSynaraMcp/disableSynaraMcp operations apply full
// session-generation fencing, deterministic per-thread succeed/defer/fail
// controls, recorded enable/disable calls with ordered disable stages,
// idempotent duplicates, and the existing provider session-not-found error
// shape for unknown sessions; disable never interrupts the Pi turn; and the
// minimal MCP-call simulation settles in-flight calls exactly once with the
// structured `synara_mcp_disabled` error, fails closed for post-fence
// admissions, and never replays a settled call.
import { ThreadId, type McpAuthorityBinding } from "@synara/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";

import {
  PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
  PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
} from "../src/provider/piSynaraMcpEnable.ts";
import { PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL } from "../src/provider/piSynaraMcpDisable.ts";
import {
  SYNARA_MCP_DISABLED_ERROR_CODE,
  isPiSynaraMcpDisabledError,
} from "../src/provider/piSynaraMcpToolExecution.ts";
import { ProviderAdapterSessionNotFoundError } from "../src/provider/Errors.ts";

import {
  makeTestProviderAdapterHarness,
  type TestProviderAdapterHarness,
} from "./TestProviderAdapter.integration.ts";

const THREAD_ID = ThreadId.makeUnsafe("thread-mcp-wp2");

const ALICE_AUTHORITY: McpAuthorityBinding = {
  authorityId: "authority-alice-1",
  subject: "user-alice",
  kind: "authenticated",
  authSessionId: "auth-session-alice",
  authExpiresAt: 1_770_003_600_000,
  issuedAt: 1_770_000_000_000,
  credentialExpiresAt: 1_770_003_600_000,
  sessionGeneration: "session-gen-alice",
  lifecycleGeneration: "lifecycle-gen-1",
  projectId: "project-1",
};

const BOB_AUTHORITY: McpAuthorityBinding = {
  authorityId: "authority-bob-1",
  subject: "user-bob",
  kind: "local-owner",
  authSessionId: null,
  authExpiresAt: null,
  issuedAt: 1_770_000_000_000,
  credentialExpiresAt: 1_770_003_600_000,
  sessionGeneration: "session-gen-bob",
  lifecycleGeneration: null,
  projectId: "project-2",
};

// Observes a promise without ever rejecting the returned promise: the
// rejection is captured in a discriminated result. This keeps the fixture
// deterministic under the vitest it.live runtime, where a rejection routed
// through Effect's async resume can be dropped.
type ObservedCall<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly cause: unknown };

const observePromise = <A>(promise: Promise<A>): Promise<ObservedCall<A>> =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (cause) => ({ ok: false as const, cause }),
  );

const startSession = (
  harness: TestProviderAdapterHarness,
  threadId: ThreadId = THREAD_ID,
  mcpAuthority?: McpAuthorityBinding,
) =>
  harness.adapter.startSession({
    threadId,
    provider: "codex",
    runtimeMode: "full-access",
    cwd: "/tmp",
    ...(mcpAuthority === undefined ? {} : { mcpAuthority }),
  });

const enableSynaraMcp = (
  harness: TestProviderAdapterHarness,
  threadId: ThreadId,
  expectedSessionGeneration: string,
  liveSessionGeneration: string | undefined,
) => {
  const enable = harness.adapter.enableSynaraMcp;
  if (enable === undefined) {
    throw new Error("TestProviderAdapter harness must implement enableSynaraMcp.");
  }
  return enable({ threadId, expectedSessionGeneration, liveSessionGeneration });
};

const disableSynaraMcp = (harness: TestProviderAdapterHarness, threadId: ThreadId) => {
  const disable = harness.adapter.disableSynaraMcp;
  if (disable === undefined) {
    throw new Error("TestProviderAdapter harness must implement disableSynaraMcp.");
  }
  return disable({ threadId });
};

describe("TestProviderAdapter Synara MCP lifecycle (impl-12 WP2)", () => {
  describe("mcpAuthority capture", () => {
    it.live("captures the exact server-minted mcpAuthority from the session-start input", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness, THREAD_ID, ALICE_AUTHORITY);

        assert.deepEqual(harness.getMcpAuthority(THREAD_ID), ALICE_AUTHORITY);
      }),
    );

    it.live("keeps each session's captured authority independent", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        const aliceThread = ThreadId.makeUnsafe("thread-alice");
        const bobThread = ThreadId.makeUnsafe("thread-bob");
        yield* startSession(harness, aliceThread, ALICE_AUTHORITY);
        yield* startSession(harness, bobThread, BOB_AUTHORITY);

        assert.deepEqual(harness.getMcpAuthority(aliceThread), ALICE_AUTHORITY);
        assert.deepEqual(harness.getMcpAuthority(bobThread), BOB_AUTHORITY);
      }),
    );

    it.live("captures undefined when the session starts without mcpAuthority (fail closed)", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness, THREAD_ID);

        assert.equal(harness.getMcpAuthority(THREAD_ID), undefined);
      }),
    );
  });

  describe("enableSynaraMcp", () => {
    it.live("activates a session when the captured generation matches the live generation", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);

        const result = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        assert.deepEqual(result, { state: "active" });
        assert.deepEqual(harness.getEnableCalls(THREAD_ID), [
          {
            expectedSessionGeneration: "gen-1",
            liveSessionGeneration: "gen-1",
          },
        ]);
      }),
    );

    it.live("refuses a stale or misrouted session generation before any staging", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);

        const stale = yield* enableSynaraMcp(harness, THREAD_ID, "expected-gen", "live-gen");
        assert.deepEqual(stale, {
          state: "unavailable",
          detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
        });

        const unbound = yield* enableSynaraMcp(harness, THREAD_ID, "expected-gen", undefined);
        assert.deepEqual(unbound, {
          state: "unavailable",
          detail: PI_SYNARA_MCP_ENABLE_STALE_GENERATION_DETAIL,
        });

        assert.deepEqual(harness.getEnableCalls(THREAD_ID), [
          { expectedSessionGeneration: "expected-gen", liveSessionGeneration: "live-gen" },
          { expectedSessionGeneration: "expected-gen", liveSessionGeneration: undefined },
        ]);

        // The refusal is bounded: a fresh matching enable still activates.
        const fresh = yield* enableSynaraMcp(harness, THREAD_ID, "expected-gen", "expected-gen");
        assert.deepEqual(fresh, { state: "active" });
      }),
    );

    it.live("re-enabling an active session is an idempotent duplicate", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);

        const first = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        const second = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        assert.deepEqual(first, { state: "active" });
        assert.deepEqual(second, { state: "active", alreadyActive: true });
        assert.equal(harness.getEnableCalls(THREAD_ID).length, 2);
      }),
    );

    it.live("fails closed with a bounded unavailable result when the per-thread control fails", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* harness.configureEnableOutcome(THREAD_ID, "fail");

        const failed = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        assert.deepEqual(failed, {
          state: "unavailable",
          detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
        });

        // A fresh enable attempt from unavailable is allowed (mirrors the
        // production legal transition unavailable -> activating); the control
        // is re-armed because the per-thread fail control persists until
        // reconfigured.
        yield* harness.configureEnableOutcome(THREAD_ID, "succeed");
        const retried = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        assert.deepEqual(retried, { state: "active" });
      }),
    );

    it.live("defers deterministically until the test releases the enable", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* harness.configureEnableOutcome(THREAD_ID, "defer");

        const pending = yield* Effect.forkChild(
          enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1"),
        );
        yield* Effect.sleep("20 millis");

        // The enable is still waiting on the release gate: recorded, not settled.
        assert.equal(harness.getEnableCalls(THREAD_ID).length, 1);
        assert.equal(pending.pollUnsafe(), undefined);

        yield* harness.releaseEnable(THREAD_ID);
        const result = yield* Fiber.join(pending);
        assert.deepEqual(result, { state: "active" });
      }),
    );

    it.live("releases a deferred enable to a bounded failure", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* harness.configureEnableOutcome(THREAD_ID, "defer");

        const pending = yield* Effect.forkChild(
          enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1"),
        );
        yield* Effect.sleep("20 millis");
        yield* harness.releaseEnable(THREAD_ID, "fail");

        const result = yield* Fiber.join(pending);
        assert.deepEqual(result, {
          state: "unavailable",
          detail: PI_SYNARA_MCP_ENABLE_UNAVAILABLE_DETAIL,
        });

        // The failed release moved the session unavailable; a fresh matching
        // enable can still activate it once the per-thread control is re-armed
        // (the defer control persists until reconfigured).
        yield* harness.configureEnableOutcome(THREAD_ID, "succeed");
        const retried = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        assert.deepEqual(retried, { state: "active" });
      }),
    );

    it.live("fails unknown sessions with the provider session-not-found error shape", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        const unknown = ThreadId.makeUnsafe("thread-unknown-enable");

        const failure = yield* enableSynaraMcp(harness, unknown, "gen-1", "gen-1").pipe(
          Effect.flip,
        );
        assert.ok(failure instanceof ProviderAdapterSessionNotFoundError);
        assert.equal(failure.threadId, String(unknown));
        assert.equal(harness.getEnableCalls(unknown).length, 0);
      }),
    );
  });

  describe("disableSynaraMcp", () => {
    it.live("records the ordered Decision-14 disable stages and returns dormant", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        const result = yield* disableSynaraMcp(harness, THREAD_ID);

        assert.deepEqual(result, { state: "dormant" });
        assert.deepEqual(harness.getDisableCalls(THREAD_ID), [
          { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
        ]);
      }),
    );

    it.live("is an idempotent duplicate for an already-dormant session", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);

        const first = yield* disableSynaraMcp(harness, THREAD_ID);
        const second = yield* disableSynaraMcp(harness, THREAD_ID);

        assert.deepEqual(first, { state: "dormant", alreadyDisabled: true });
        assert.deepEqual(second, { state: "dormant", alreadyDisabled: true });
        // Each duplicate still installs the synchronous fence; no further
        // staging is recorded because the session never activated.
        assert.deepEqual(harness.getDisableCalls(THREAD_ID), [
          { stages: ["fence"] },
          { stages: ["fence"] },
        ]);
      }),
    );

    it.live("fails closed with unavailable when the per-thread control fails", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        yield* harness.configureDisableOutcome(THREAD_ID, "fail");

        const failed = yield* disableSynaraMcp(harness, THREAD_ID);
        assert.deepEqual(failed, {
          state: "unavailable",
          detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
        });
        // The full ordered sequence still ran; only the outcome is unavailable.
        assert.deepEqual(harness.getDisableCalls(THREAD_ID), [
          { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
        ]);

        // A duplicate disable of the unavailable session reports the settled
        // unavailable state idempotently.
        const duplicate = yield* disableSynaraMcp(harness, THREAD_ID);
        assert.deepEqual(duplicate, {
          state: "unavailable",
          alreadyDisabled: true,
          detail: PI_SYNARA_MCP_DISABLE_UNAVAILABLE_DETAIL,
        });

        // A fresh enable from unavailable is allowed (unavailable -> activating).
        const reenabled = yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        assert.deepEqual(reenabled, { state: "active" });
      }),
    );

    it.live("defers deterministically, fencing before the release gate", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        yield* harness.configureDisableOutcome(THREAD_ID, "defer");

        const pending = yield* Effect.forkChild(disableSynaraMcp(harness, THREAD_ID));
        yield* Effect.sleep("20 millis");

        // The disable is still waiting on the release gate, but the
        // synchronous fence is already installed: post-fence admissions fail
        // closed even while the disable is deferred.
        assert.equal(pending.pollUnsafe(), undefined);
        assert.isTrue(harness.isSynaraMcpFenced(THREAD_ID));

        yield* harness.releaseDisable(THREAD_ID);
        const result = yield* Fiber.join(pending);
        assert.deepEqual(result, { state: "dormant" });
        assert.deepEqual(harness.getDisableCalls(THREAD_ID), [
          { stages: ["fence", "settle", "cancel", "revoke", "reload"] },
        ]);
      }),
    );

    it.live("fails unknown sessions with the provider session-not-found error shape", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        const unknown = ThreadId.makeUnsafe("thread-unknown-disable");

        const failure = yield* disableSynaraMcp(harness, unknown).pipe(Effect.flip);
        assert.ok(failure instanceof ProviderAdapterSessionNotFoundError);
        assert.equal(failure.threadId, String(unknown));
        assert.equal(harness.getDisableCalls(unknown).length, 0);
      }),
    );

    it.live("never interrupts the Pi turn and leaves the turn surface usable", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        const result = yield* disableSynaraMcp(harness, THREAD_ID);
        assert.deepEqual(result, { state: "dormant" });

        // Disable performs no interruptTurn call: the Pi turn is never aborted.
        assert.deepEqual(harness.getInterruptCalls(THREAD_ID), []);

        // The session and its turn surface stay usable after disable.
        yield* harness.queueTurnResponse(THREAD_ID, { events: [] });
        const turn = yield* harness.adapter.sendTurn({ threadId: THREAD_ID, input: "continue" });
        assert.equal(turn.threadId, THREAD_ID);
      }),
    );
  });

  describe("Synara MCP call simulation", () => {
    it.live("settles an in-flight call exactly once on disable with the structured disabled error", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        let capturedSignal: AbortSignal | undefined;
        const call = harness.startSynaraMcpCall(THREAD_ID, (signal) => {
          capturedSignal = signal;
          return new Promise<never>(() => {});
        });
        // Attach the observer immediately so the structured rejection can
        // never become an unhandled rejection.
        const observedCall = observePromise(call);
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 1);

        const disable = yield* disableSynaraMcp(harness, THREAD_ID);
        assert.deepEqual(disable, { state: "dormant" });

        const observed = yield* Effect.promise(() => observedCall);
        assert.isFalse(observed.ok);
        if (observed.ok) {
          throw new Error("Expected the in-flight call to settle as disabled.");
        }
        assert.isTrue(isPiSynaraMcpDisabledError(observed.cause));
        assert.equal((observed.cause as { code?: string }).code, SYNARA_MCP_DISABLED_ERROR_CODE);
        // The gateway-side call was aborted with the same structured error.
        assert.isTrue(capturedSignal?.aborted === true);
        assert.equal(
          (capturedSignal?.reason as { code?: string } | undefined)?.code,
          SYNARA_MCP_DISABLED_ERROR_CODE,
        );
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 0);
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 1);

        // A duplicate disable must not settle the call again: exactly once.
        yield* disableSynaraMcp(harness, THREAD_ID);
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 1);
      }),
    );

    it.live("settles in-flight calls before a deferred disable's release gate", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        yield* harness.configureDisableOutcome(THREAD_ID, "defer");

        const call = harness.startSynaraMcpCall(THREAD_ID);
        // Attach the observer immediately so the structured rejection can
        // never become an unhandled rejection.
        const observedCall = observePromise(call);
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 1);

        const pending = yield* Effect.forkChild(disableSynaraMcp(harness, THREAD_ID));
        yield* Effect.sleep("20 millis");

        // While the disable is still deferred, the fence is installed and the
        // in-flight call is already settled exactly once with the structured
        // disabled error; post-fence admissions fail closed.
        assert.equal(pending.pollUnsafe(), undefined);
        assert.isTrue(harness.isSynaraMcpFenced(THREAD_ID));
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 1);
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 0);
        const observedSettled = yield* Effect.promise(() => observedCall);
        assert.isFalse(observedSettled.ok);
        if (!observedSettled.ok) {
          assert.isTrue(isPiSynaraMcpDisabledError(observedSettled.cause));
        }
        const admission = harness.startSynaraMcpCall(THREAD_ID, () => Promise.resolve("never"));
        // Attach immediately: the fenced admission is rejected synchronously.
        const admissionObserved = observePromise(admission);
        const observedAdmission = yield* Effect.promise(() => admissionObserved);
        assert.isFalse(observedAdmission.ok);
        if (!observedAdmission.ok) {
          assert.isTrue(isPiSynaraMcpDisabledError(observedAdmission.cause));
        }
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 1);

        yield* harness.releaseDisable(THREAD_ID);
        const result = yield* Fiber.join(pending);
        assert.deepEqual(result, { state: "dormant" });
      }),
    );

    it.live("fails closed for post-fence admissions before the handler starts", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");
        yield* disableSynaraMcp(harness, THREAD_ID);

        let handlerCalls = 0;
        const call = harness.startSynaraMcpCall(THREAD_ID, () => {
          handlerCalls += 1;
          return Promise.resolve("never");
        });
        // Attach immediately: the fenced admission is rejected synchronously.
        const observedCall = observePromise(call);

        const observed = yield* Effect.promise(() => observedCall);
        assert.isFalse(observed.ok);
        if (!observed.ok) {
          assert.isTrue(isPiSynaraMcpDisabledError(observed.cause));
        }
        // The handler never started: the admission failed before its body ran.
        assert.equal(handlerCalls, 0);
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 0);
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 0);
      }),
    );

    it.live("never replays a settled call", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        let handlerCalls = 0;
        const call = harness.startSynaraMcpCall(THREAD_ID, () => {
          handlerCalls += 1;
          return new Promise<never>(() => {});
        });
        // Attach the observer immediately so the structured rejection can
        // never become an unhandled rejection.
        const observedCall = observePromise(call);
        yield* disableSynaraMcp(harness, THREAD_ID);
        const observed = yield* Effect.promise(() => observedCall);
        assert.isFalse(observed.ok);
        if (!observed.ok) {
          assert.isTrue(isPiSynaraMcpDisabledError(observed.cause));
        }
        assert.equal(handlerCalls, 1);

        // Bounded wait: nothing re-runs the handler and nothing settles again.
        yield* Effect.sleep("20 millis");
        assert.equal(handlerCalls, 1);
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 1);
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 0);
      }),
    );

    it.live("keeps an already-completed call's result and never settles it as disabled", () =>
      Effect.gen(function* () {
        const harness = yield* makeTestProviderAdapterHarness();
        yield* startSession(harness);
        yield* enableSynaraMcp(harness, THREAD_ID, "gen-1", "gen-1");

        const call = harness.startSynaraMcpCall(THREAD_ID, () => Promise.resolve("ok"));
        const observedCall = observePromise(call);
        const observed = yield* Effect.promise(() => observedCall);
        assert.isTrue(observed.ok);
        if (observed.ok) {
          assert.equal(observed.value, "ok");
        }
        assert.equal(harness.getSynaraMcpInFlightCount(THREAD_ID), 0);

        yield* disableSynaraMcp(harness, THREAD_ID);
        assert.equal(harness.getSynaraMcpDisabledSettledCount(THREAD_ID), 0);
      }),
    );
  });
});
