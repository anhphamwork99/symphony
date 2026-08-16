# Durable managed executions for Pi subagents

**Project:** synara-pi-durable-subagents
**Project home:** [PROJECT.md](PROJECT.md)
**Status:** ready-for-agent
**Tracker:** Local Markdown under this Project Home

## Problem Statement

The user relies on Synara primarily through Pi coding agent and delegates
substantial work through the Pi `Agent` extension. Long-running subagents are
currently coupled to the lifetime of the parent tool call and Pi turn. A
foreground `Agent` waits for the child to finish and emits progress updates on
an 80 ms spinner interval, causing avoidable runtime events, persistence work,
WebSocket traffic, rendering work, and memory pressure.

Background execution returns an agent ID promptly, but its running registry and
queue remain process-local, parent cancellation is not consistently propagated,
and each completion can independently trigger a follow-up Pi turn. Synara can
persist provider and orchestration events, but it does not own a durable
subagent execution record that distinguishes execution state, observation
state, desired cancellation, and completion delivery.

As a result, a long-running or unresponsive subagent can leave Synara and Pi
with conflicting views of reality. The UI may show an interrupted or stopped
turn while the child continues consuming resources. A browser reconnect can
recover projected thread state but not a durable child execution identity.
After a server restart, an in-process Pi child cannot be proven alive, yet the
system lacks an explicit `orphaned` state for that uncertainty. Late completion
events can race with cancellation, reconciliation, or resumed work.

The user needs long-running Pi subagents to behave like managed jobs: they must
release the parent interaction promptly, remain observable, accept authorized
control, use bounded resources, recover honestly after disconnects and
restarts, and deliver completion without creating turn storms.

## Solution

Introduce a versioned managed-execution capability between Synara and the Pi
subagent extension. Every managed subagent receives a stable `executionId`
before the child starts and an `attemptId` for each concrete spawn or resume.
The Pi extension remains the live execution owner for the child `AgentSession`;
Synara becomes the durable control and observation owner; the web application
renders the server's execution projection.

Foreground execution becomes a bounded attachment rather than an unbounded
wait. Synara waits for a configurable foreground budget, initially 10 seconds.
If the child finishes in that budget, the user receives the result as before.
If it remains active, the parent `Agent` tool returns the execution handle and
the child continues detached from the tool-call transport while remaining
inside its declared cancellation scope.

Synara persists each execution's requested mode, desired state, observed state,
current attempt, operation generation, ownership lease, transcript reference,
resource usage, terminal evidence, diagnostics, and completion-delivery state.
Lifecycle transitions are durable and deduplicated. Intermediate progress is
coalesced into a latest snapshot and may be dropped under pressure; lifecycle
and terminal evidence may not be dropped.

Stop becomes a durable intent. Synara records cancellation before dispatching
it, the Pi extension fences stale operations and aborts the child, and Synara
only reports `cancelled` after acknowledgement or equivalent owner-death
evidence. Failed cancellation remains visible as `cancelling` with a stable
diagnostic and retry path.

Completion is persisted before notification. A completion coordinator batches
child completions per parent thread and permits at most one outstanding
follow-up turn per thread. Execution success remains separate from completion
delivery success, allowing safe idempotent retries without changing the child
outcome.

Browser disconnect does not affect execution. Reconnect hydrates a durable
snapshot and resumes lifecycle events by cursor without replaying every
intermediate progress update. Server restart reconciles non-terminal
executions against the live bridge and transcript terminal evidence. If no live
owner or terminal evidence can be proven, Synara marks the execution
`orphaned`; it does not claim that the child is still running and does not
automatically replay side-effecting work.

The capability is optional and versioned. Pi CLI usage without the Synara
bridge retains legacy behavior. Synara enables managed behavior only after a
successful capability handshake and labels unsupported or pre-existing agents
as legacy unmanaged executions.

## User Stories

1. As a Synara user, I want a long-running Pi subagent to release the parent
   `Agent` tool call promptly, so that I can continue using the conversation
   while the delegated work continues.
2. As a Synara user, I want short Pi subagent tasks to return their result
   directly when they finish within the foreground wait budget, so that simple
   delegation remains convenient.
3. As a Synara user, I want every managed subagent to have an `executionId`, so
   that I can refer to and control the same logical task throughout its life.
4. As a Synara user, I want each resumed run to have a distinct `attemptId`, so
   that I can distinguish a retry from the execution that was interrupted.
5. As a Synara user, I want to see whether an execution is requested, queued,
   running, cancelling, cancelled, succeeded, failed, or orphaned, so that the
   UI communicates the actual operational state.
6. As a Synara user, I want execution state to survive a browser disconnect, so
   that refreshing or reopening Synara does not lose my delegated work.
7. As a Synara user, I want reconnect to show the latest useful progress
   snapshot, so that I do not need to replay thousands of spinner updates.
8. As a Synara user, I want to stop a foreground task that has detached, so
   that bounded foreground does not remove my control over the child.
9. As a Synara user, I want Stop on a parent turn to cancel every child whose
   cancellation scope is that parent turn, so that no hidden child continues
   consuming resources.
10. As a Synara user, I want background agents to receive parent cancellation,
    so that choosing background execution does not accidentally make work
    unstoppable.
11. As a Synara user, I want the UI to show `cancelling` until Pi confirms the
    child stopped, so that Synara never reports a false cancellation.
12. As a Synara user, I want a stable diagnostic when cancellation cannot be
    delivered or acknowledged, so that I know the child may still be active.
13. As a Synara user, I want an execution to become `orphaned` when Synara loses
    its live owner after restart, so that uncertainty is represented honestly.
14. As a Synara user, I want an orphaned execution to explain that partial side
    effects may already exist, so that I can inspect the workspace before
    resuming.
15. As a Synara user, I want resume of an orphaned execution to create a new
    attempt, so that late events from the old attempt cannot corrupt the new
    run.
16. As a Synara user, I want Synara to avoid automatically replaying orphaned
    write or network work, so that a restart does not duplicate side effects.
17. As a Synara user, I want terminal evidence recovered from a transcript to
    restore the correct outcome, so that completed work is not unnecessarily
    marked orphaned.
18. As a Synara user, I want the detailed transcript to remain available on
    demand, so that coalesced progress does not remove diagnostic information.
19. As a Synara user, I want large transcripts and results to load by cursor or
    page, so that a large child output does not overload the chat stream.
20. As a Synara user, I want multiple child completions to arrive as a bounded
    batch, so that they do not create a burst of independent follow-up turns.
21. As a Synara user, I want an execution outcome to remain successful when
    only its parent notification delivery fails, so that delivery problems are
    not misreported as work failures.
22. As a Synara user, I want failed completion delivery to retry safely, so
    that I eventually receive results without duplicate follow-up effects.
23. As a Synara user, I want a completion that arrives while the parent is busy
    to wait for a safe boundary, so that it does not interrupt active reasoning
    or tool work.
24. As a Synara user, I want heartbeat and nested tool progress to avoid
    triggering transcript auto-scroll, so that background work does not pull
    me away from the content I am reading.
25. As a Synara user, I want actual assistant transcript messages to retain
    their normal live-output scrolling behavior, so that managing subagents
    does not degrade the main chat experience.
26. As a Synara user, I want long-running agents to consume bounded server and
    client resources, so that one delegated task does not make Synara unstable.
27. As a Synara user, I want project and server concurrency limits to reject or
    queue excess work predictably, so that load remains controlled.
28. As a Synara user, I want queue saturation to return a stable diagnostic, so
    that I understand why a new child did not start.
29. As a Synara user, I want progress degradation to be distinguishable from
    execution failure, so that a temporarily unavailable progress stream does
    not imply that the child stopped.
30. As a Synara user, I want terminal lifecycle events to survive progress
    saturation, so that I always learn whether the task finished or failed.
31. As a Synara user, I want managed execution to remain compatible with my
    existing Pi tools and extensions, so that Synara does not replace my coding
    agent configuration.
32. As a Pi CLI user, I want the subagent extension to preserve legacy behavior
    when no Synara managed-execution bridge is present, so that the extension
    remains usable outside Synara.
33. As a Synara user, I want the UI to identify legacy unmanaged agents, so
    that I do not mistake them for restart-aware managed executions.
34. As a Synara user, I want Stop, steer, resume, result, and transcript
    operations to enforce my existing project and thread permissions, so that
    knowing an execution ID does not grant authority.
35. As a Synara user, I want scheduled subagents eventually to use the same
    admission and quota model, so that scheduled work cannot bypass resource
    controls.
36. As a Synara operator, I want lifecycle persistence failure to reject new
    managed admissions, so that the system does not create untrackable work.
37. As a Synara operator, I want progress sink failure to degrade observation
    without losing terminal state, so that partial telemetry failure does not
    corrupt execution truth.
38. As a Synara operator, I want metrics for active, queued, cancelling,
    orphaned, and terminal executions, so that I can detect wedges and resource
    pressure.
39. As a Synara operator, I want metrics for foreground detach duration,
    progress coalescing, dropped progress, lease expiry, cancellation latency,
    and completion retries, so that I can locate bottlenecks.
40. As a Synara operator, I want logs correlated by execution, attempt, thread,
    and generation without raw prompts or transcripts, so that incidents are
    diagnosable without leaking sensitive content.
41. As a Synara operator, I want an idle or wall-time watchdog with bounded
    escalation, so that an unresponsive child cannot hold a Pi turn forever.
42. As a Synara operator, I want reconciler settlement to fence or stop the live
    runtime, so that projection state cannot claim interruption while the same
    generation continues running.
43. As a Synara operator, I want late events from stale attempts or generations
    to be ignored and counted, so that races do not overwrite current truth.
44. As a Synara operator, I want duplicate commands and events to have
    idempotent effects, so that reconnects and retries are safe.
45. As a Synara operator, I want ownership leases and heartbeats to expire
    predictably, so that executions do not remain `running` forever after owner
    loss.
46. As a Synara operator, I want child process trees cleaned up after bounded
    escalation, so that detached shell processes do not survive an execution
    that Synara has definitively terminated.
47. As a Synara operator, I want simultaneous completions to create at most one
    outstanding follow-up turn per thread, so that burst completion remains
    stable under load.
48. As a Synara operator, I want mixed-version capability negotiation to fail
    safely, so that deploying the server and extension independently does not
    lose executions or completions.
49. As a Synara developer, I want lifecycle events and progress snapshots to
    use separate delivery policies, so that backpressure can discard noise
    without discarding truth.
50. As a Synara developer, I want explicit desired and observed states, so that
    control requests are not confused with confirmed runtime outcomes.
51. As a Synara developer, I want execution success and completion delivery to
    be modeled separately, so that retry behavior is correct and observable.
52. As a Synara developer, I want the existing subagent stale-settlement guards
    to remain authoritative within the live extension, so that the managed
    bridge does not reintroduce old resume, steer, or abort races.
53. As a Synara developer, I want ticket-level implementations to choose the
    smallest stable test seams consistent with the project testing strategy, so
    that tests remain maintainable as internal modules evolve.
54. As a Synara developer, I want a real-Pi smoke test in addition to
    deterministic fakes, so that capability handshake, detach, cancellation,
    completion, and restart assumptions are verified against the actual
    runtime.

## Implementation Decisions

1. **Use durable execution handle plus detached observation.** A managed
   subagent is a first-class logical execution, not an implementation detail of
   a long-lived parent tool call.
2. **Preserve execution ownership in the Pi extension for the first
   implementation.** The extension creates and runs the child `AgentSession`,
   owns its operation token, performs abort, steer, and resume, and writes its
   transcript. Synara does not replace the Pi agent loop.
3. **Make Synara the durable control and observation owner.** The server owns
   admission, authorization, execution records, desired state, lifecycle
   journal, deduplication, generation fencing, leases, quotas, reconciliation,
   and completion delivery.
4. **Keep the web application projection-only.** The browser renders server
   snapshots and lifecycle events and sends authorized commands. Browser
   presence or WebSocket connection lifetime does not own the execution.
5. **Assign identity before spawn.** `executionId` is created and durably
   admitted before the child begins. Every spawn or resume has a new
   `attemptId`. Events additionally carry an attempt-local sequence or unique
   event ID.
6. **Fence stale work with operation generation.** Accepted cancel, resume, and
   relevant control replacements advance a monotonic generation. Events from
   superseded attempts or generations cannot mutate the current attempt.
7. **Model desired state separately from observed state.** A cancel request
   records durable intent before dispatch. `cancel_requested` or `cancelling`
   does not become `cancelled` until the owner acknowledges termination or
   owner-death evidence proves that the attempt cannot remain live.
8. **Use the execution lifecycle `requested → accepted → queued/running`.**
   Terminal states are `rejected`, `succeeded`, `failed`, and `cancelled`.
   Observation loss leads to `orphaned`, which is non-terminal and makes no
   claim that prior side effects were rolled back.
9. **Use bounded foreground attachment.** Managed foreground waits for a
   configurable budget, initially 10 seconds and constrained to an operational
   range. Completion inside the budget returns the normal result. Otherwise the
   tool returns the execution handle while the same child continues.
10. **Do not equate detach with cancellation independence.** Transport mode and
    cancellation scope are separate properties. The first implementation uses
    parent-turn cancellation by default for both foreground-detached and
    background executions.
11. **Propagate parent abort to background execution.** Managed background
    spawn must receive and honor the parent abort signal rather than relying
    only on session shutdown cleanup.
12. **Provide a versioned optional bridge.** Synara and the Pi extension
    negotiate managed-execution capabilities. The bridge is a host integration
    surface, not a default model-facing Synara tool catalog.
13. **Preserve non-Synara behavior.** Without a successful bridge handshake,
    Pi CLI and other hosts keep legacy extension semantics. Synara must not
    label those executions durable or recoverable.
14. **Use idempotent commands.** Spawn, cancel, steer, resume, describe,
    list-active, and transcript-read commands carry command identity,
    execution identity, expected attempt or generation, and return explicit
    already-applied, stale, missing, invalid-state, or unavailable results.
15. **Use at-least-once lifecycle delivery with exactly-once projection
    effects.** Lifecycle events carry execution, attempt, generation, event
    identity, and sequence. Synara persists and deduplicates them before
    projection.
16. **Separate lifecycle from observation.** Accepted, queued, started,
    cancel-acknowledged, terminal, and control acceptance are lifecycle edges.
    Progress, heartbeat, resource usage, and transcript cursors are
    observations.
17. **Protect lifecycle under pressure.** Lifecycle uses a non-coalescing
    durable path with reserved capacity. If Synara cannot persist lifecycle, it
    enters degraded control health and rejects new managed admissions.
18. **Coalesce progress at the producer and server.** Managed mode removes the
    legacy 80 ms spinner publication. Progress is limited to a small configurable
    rate, initially no more than two updates per second per execution, with
    trailing-edge latest-snapshot behavior.
19. **Keep heartbeat out of user transcript events.** Heartbeat refreshes an
    ownership lease, initially at approximately 10-second intervals, without
    generating chat messages, transcript auto-follow, or durable progress
    history.
20. **Store large output by reference.** Detailed text streams to a transcript.
    Lifecycle events carry bounded summaries and transcript cursors rather than
    unbounded raw output. Transcript reading is authorized and paginated.
21. **Persist terminal before notification.** A terminal event updates the
    execution aggregate and creates a completion-outbox entry atomically or
    with equivalent journal-first recoverability.
22. **Separate execution outcome from completion delivery.** Completion
    delivery tracks pending, delivered, acknowledged, and superseded states.
    Delivery failure does not change a succeeded execution into a failed one.
23. **Batch completion per parent thread.** The completion coordinator groups
    near-simultaneous child terminals in a bounded window and permits at most
    one outstanding follow-up turn per thread. Full results remain retrievable
    by execution identity.
24. **Deliver completion only at a safe parent boundary.** If the parent turn
    is active, completion waits in the inbox rather than interrupting current
    reasoning or tool work.
25. **Make cancellation journal-first and retryable.** Synara authorizes and
    records desired cancellation, dispatches an idempotent cancel, and retains
    `cancelling` with diagnostics when dispatch or acknowledgement fails.
26. **Escalate unresponsive cancellation in bounded stages.** The control path
    progresses from child abort to provider-turn interrupt, provider-session
    stop, and owned process-tree teardown according to configured timeouts and
    evidence. Projection settlement alone is not termination proof.
27. **Fence reconciled runtimes.** When reconciliation concludes that a turn is
    abandoned or ownerless, it must stop or rotate the applicable live runtime
    generation so that late events cannot reverse the settled projection.
28. **Reconnect from durable snapshot.** Browser reconnect hydrates the latest
    execution aggregate and lifecycle cursor. Intermediate progress history is
    not replayed; only the latest useful observation is needed.
29. **Represent process death honestly.** On startup, Synara reconciles every
    non-terminal execution against bridge-reported active executions and
    transcript terminal markers. Without either, the execution becomes
    `orphaned` with an owner-loss diagnostic.
30. **Do not auto-replay orphaned work.** Resume creates a new attempt and
    generation. The initial implementation requires explicit user action and
    does not automatically resume work capable of write or external side
    effects.
31. **Treat transcript as evidence, not live ownership.** A terminal marker may
    reconcile a final outcome. File existence or a non-terminal transcript does
    not prove that a child is running.
32. **Authorize every control and read.** Execution identity is correlation,
    not authority. Spawn, cancel, steer, resume, list, result, and transcript
    operations preserve existing user, project, thread, active-turn, approval,
    Stop, and cancellation boundaries.
33. **Apply resource admission before spawn.** Retain a configurable
    per-provider concurrency default compatible with the current extension,
    add a server-wide cap, bound queued work per project, enforce execution
    wall-time and model budgets, and return stable diagnostics when admission
    fails.
34. **Use stable diagnostics and safe telemetry.** Operational records include
    normalized execution, attempt, thread, generation, and diagnostic codes.
    Prompts, results, and raw transcripts are not metric labels or default log
    content.
35. **Preserve transcript scrolling semantics.** Only real transcript message
    arrival and live assistant text may trigger transcript auto-follow.
    Heartbeat, resource usage, execution-card changes, and nested tool progress
    must not use that path.
36. **Roll out capability-first.** Instrument and negotiate bridge capability
    before changing semantics. Suppress legacy direct completion follow-ups
    only after Synara acknowledges ownership of completion delivery.
37. **Deliver the first vertical slice around direct Agent spawns.** The first
    slice includes managed identity, bounded detach, abort propagation, durable
    lifecycle and terminal outbox, coalesced progress, reconnect snapshot,
    parent-turn cancellation, restart-to-terminal-or-orphan reconciliation, and
    a minimal execution card.
38. **Defer true restart continuation.** Continuing a live child across Synara
    server process death requires an external execution worker or equivalent
    independently supervised process. The managed-execution first slice does
    not claim this capability.

## Testing Decisions

See the accepted project-scoped [Testing Strategy Governance Decision Record](decisions/0001-testing-strategy-governance.md).

## Out of Scope

- Transparent continuation of an in-process Pi child across Synara server
  process death.
- Automatic replay or automatic resume of orphaned execution attempts.
- Moving the Pi child agent loop entirely into Synara server in the first
  implementation.
- Introducing Synara's internal tool catalog into default Pi model context.
- Changing the opt-in activation or authorization model of Synara MCP.
- Replacing Pi's existing agent types, prompts, configured tools, extension
  discovery, steer semantics, resume semantics, or internal stale-settlement
  guards.
- Making browser or WebSocket connection lifetime own execution lifetime.
- Persisting JavaScript promises, `AbortController` instances, live
  `AgentSession` objects, or process handles as if they were recoverable
  execution state.
- Treating transcript storage as the source of live ownership.
- Replaying every progress event after reconnect.
- Sending full unbounded transcripts or results through lifecycle events or
  WebSocket push.
- Automatically including scheduled subagents in the first direct-spawn
  vertical slice.
- Building the external worker topology required for true restart continuation.
- Defining ticket-specific internal modules or concrete test seams that should
  be selected during implementation planning and repository exploration.

## Further Notes

The immediate operational mitigation and the managed-execution architecture are
complementary. Removing the 80 ms foreground spinner stream, propagating abort
to background execution, adding watchdog escalation, and fencing reconciled
runtimes should be delivered early even if the complete durable execution UI
is staged behind capability negotiation.

Suggested initial operational defaults are a 10-second foreground wait budget,
progress capped at two updates per second per execution, a 10-second heartbeat,
a 30-second ownership lease, orphaning after approximately 60 seconds without a
provable owner, four running agents per provider session for compatibility, and
a configurable two-hour execution wall-time. These are starting policies, not
protocol constants, and may be tuned from production measurements without
changing the state model.

The project should use stable diagnostic codes for bridge availability,
admission rejection, queue saturation, owner loss, transcript recovery,
cancellation failure, stale generation, event sequence gaps, completion
delivery failure, result truncation, and legacy unmanaged operation.

The existing Synara provider runtime journal, bounded callback ingress,
lifecycle generation, projection recovery, and WebSocket cursor replay are
useful foundations. They do not replace the managed execution aggregate:
provider-turn state, child-execution state, observation state, desired control
state, and completion-delivery state remain distinct concerns.

The first implementation plan should preserve mixed-version safety. A legacy
Pi extension must remain usable, but Synara must clearly avoid promising
durable control or restart recovery until the bridge handshake succeeds.
