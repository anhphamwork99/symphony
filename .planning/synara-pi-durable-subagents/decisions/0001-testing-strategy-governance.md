# Decision 0001: Testing strategy governance

**Status:** Accepted by owner
**Date:** 2026-08-16
**Scope:** Synara Pi Durable Subagents

## Context

This project changes the lifetime, observation, cancellation, completion, and
recovery behavior of long-running Pi subagents. A false positive is materially
dangerous: Synara must not report that an execution stopped, completed, survived
a restart, or delivered its result without evidence from the responsible
boundary.

The testing strategy therefore needs to prove behavior across the stable public
boundaries of the Pi extension, Synara server, durable orchestration pipeline,
and web projection while avoiding unnecessary coupling to ticket-owned
implementation details.

## Decision

Prefer the highest stable public boundary that proves each behavior, using as
few lower-level seams as necessary.

1. Use contract and state-machine tests for execution identity, attempt
   identity, lifecycle transitions, desired versus observed state, generation
   fencing, event sequencing, terminal ownership, idempotency, and completion
   delivery state.
2. Use server orchestration integration tests for admission, bounded foreground
   attachment, detached observation, lifecycle persistence, progress
   coalescing, durable cancellation, completion outbox delivery, reconnect
   hydration, lease expiry, restart reconciliation, orphan detection, and
   authorization.
3. Use the Pi subagent integration boundary to prove that foreground execution
   releases its parent tool call within the configured wait budget, background
   execution receives the parent abort signal, managed mode does not emit the
   legacy 80 ms spinner stream, Stop reaches the child execution, completion
   ownership transfers safely, and mixed-version fallback preserves legacy
   behavior.
4. Use web projection and browser tests for execution-card states, reconnect
   snapshot hydration, cancel and orphan diagnostics, transcript pagination, and
   the invariant that heartbeat, resource usage, and nested tool progress do not
   trigger transcript auto-follow.
5. Use saturation and load tests to prove that progress remains bounded and may
   be coalesced or dropped while lifecycle and terminal events remain durable.
   Memory usage must not grow linearly with the number of intermediate progress
   events.
6. Use one integrated smoke path with a real Pi runtime covering a long-running
   subagent, bounded detach, browser reconnect, Stop, simultaneous completions,
   and server restart during a non-terminal execution.

## Required success, failure, and diagnostic coverage

Every success path for a lifecycle or control transition must have matching
coverage for the material failure or diagnostic surface where applicable:

- bridge unavailable or unsupported bridge version;
- duplicate, replayed, out-of-order, or sequence-gap events;
- stale attempt or operation generation;
- concurrency, queue, or project quota exhaustion;
- cancel dispatch failure and cancel acknowledgement timeout;
- lifecycle persistence or completion-outbox failure;
- transcript checkpoint or transcript retrieval failure;
- owner loss or lease expiry after restart;
- unauthorized cancel, steer, resume, list, or transcript read;
- completion delivery failure after successful execution;
- progress saturation while a terminal event is emitted;
- mixed-version extension operation without managed-execution capability;
- late terminal evidence from an attempt superseded by resume or cancel.

Tests must not treat any of the following as success:

- `session.abort()` resolving without child terminal acknowledgement or
  equivalent owner-death evidence;
- a projected `interrupted`, `stopped`, or `cancelled` state while the live
  execution remains unfenced;
- persistence of an in-memory record as proof that an `AgentSession`, promise,
  process, or side-effect position survived process death;
- transcript-file existence as proof that an execution is currently alive;
- completion notification delivery as proof of execution success, or execution
  success as proof that completion delivery succeeded;
- a mocked UI-only state change in place of the journal-first server lifecycle.

## Preferred public boundaries

- Versioned managed-execution command and event contracts.
- Synara provider/orchestration APIs and their durable event and projection
  outputs.
- Pi extension capability handshake and managed-execution bridge.
- WebSocket snapshot and replay behavior as consumed by the web application.
- User-visible execution controls and transcript behavior in the browser.

## Permitted boundary substitutions

A ticket may use a lower seam only when the stable public boundary cannot
reliably induce a failure or observe the invariant. The ticket must document why
the public boundary is insufficient, retain the nearest useful public-boundary
test, and add only the smallest lower-level test required.

Provider fakes may replace a real Pi runtime for deterministic state, race, and
fault-injection coverage. They must be complemented by the integrated real-Pi
smoke path for capability negotiation, detach, cancellation, completion, and
restart behavior.

## Prior art

- Existing provider runtime event journal, bounded callback ingress, lifecycle
  generation, startup turn reconciliation, and terminal applicability tests.
- Existing Pi adapter tests and provider service tests.
- Existing transcript auto-scroll and live-output guardrails.
- The accepted testing strategy in the Synara Pi Coding Agent MCP project,
  particularly its journal-first, failure-pairing, reconnect, cancellation, and
  generation-isolation principles.

## Commands and repository constraints

- Use focused Vitest tests during implementation.
- Use `bun run test` for the full test suite. Never use `bun test`.
- Follow repository `AGENTS.md` for formatting, linting, and typecheck
  authorization and final completion requirements.
- Match proof to the risk: rerun the long-execution reproduction for the
  lifetime fix, browser verification for UI behavior, saturation tests for
  backpressure, and kill/restart tests for orphan reconciliation.

## Exceptions and changes

Ordinary tickets own their concrete test seams and do not require another
Decision Record. A material change to this feature-wide strategy, including
removing the real-Pi smoke path, weakening journal-first terminal evidence, or
treating automatic replay as safe recovery, requires a new owner-approved
project-scoped Decision Record.
