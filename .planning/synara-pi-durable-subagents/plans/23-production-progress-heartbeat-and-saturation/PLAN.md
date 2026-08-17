# Ticket 23 — Production progress, heartbeat leases, and saturation control

**Status:** in implementation
**Date:** 2026-08-18
**Governed by:** Issue 23, Decisions 0001–0008, approved Testing Seams (owner 2026-08-16).

## Settled design (orchestrator decisions, binding for both work packets)

Two-layer event flow, all additive and capability-safe:

```
Alfie managed branch (producer)
  createActivityTracker funnel ──► producer coalescer (trailing-edge, ≤ rateHz)
                                     │  progress observation
  heartbeat timer (interval, survives detach) ──► heartbeat observation
                                     │
        binding.reportObservation({ kind: "started"|"detached"|"progress"|"heartbeat", … })
                                     │
Symphony PiAdapter.wrapAgentTool dispatch
  ├─ started/detached → journal seq2/seq3 (unchanged, ticket 22)
  ├─ progress → per-execution server coalescer (trailing-edge ≤ rateHz)
  │     ├─ durable latest-snapshot UPDATE (last_progress_json/at, dropped_progress_count)
  │     └─ offerRuntimeEvent(item.updated) for web activity
  └─ heartbeat → lightweight UPDATE (last_heartbeat_at, lease_expires_at) only
```

### Settled decisions

1. **Binding v1 extension (backward compatible).** `reportObservation` input
   widens `kind` to `"started" | "detached" | "progress" | "heartbeat"` and
   gains an optional `progressJson: string` field (present for progress kind
   only). `PiSubagentManagedForegroundBinding` gains optional policy fields
   `progress`/`heartbeat` (see §3); guards validate them only when present;
   absence/malformed → legacy behavior for old callers, internal defaults
   inside the extension when managed.
2. **Producer coalescing lives in the Alfie managed branch** at the existing
   `createActivityTracker(maxTurns, onStreamUpdate)` funnel
   (index.ts:1397 today passes no onStreamUpdate). Managed mode passes a
   trailing-edge throttle; the legacy 80ms spinner path is untouched.
   Progress payload is the legacy `AgentDetails` subset WITHOUT
   `spinnerFrame`: `{ toolUses, turnCount, maxTurns, durationMs, activity,
tokens, status: "running" }` serialized as `progressJson`.
3. **Config knobs (Symphony `config.ts`, same pattern as
   `resolvePiSubagentForegroundWaitMs`):**
   - `SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ` → default 2, range 0.1–10 (hz)
   - `SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS` → default 10 000, range 100–600 000
   - `SYNARA_PI_SUBAGENT_LEASE_DURATION_MS` → default 30 000, range 1 000–3 600 000
     Invalid → default. Wired in `main.ts` ServerConfigLive AND `config.ts`
     layerTest. Passed into the binding as optional policy
     `{ progress: { rateHz }, heartbeat: { intervalMs, leaseMs } }`.
4. **Heartbeat ownership: extension side** (it is the live execution owner).
   One interval per managed execution, registered next to the budget timer in
   `liveAttachments`, cleared on inline completion and in the post-detach
   settlement continuation. Counted in `getResourceSnapshot().activeTimerCount`.
   Survives detach. Observation failures are swallowed (never kill the child,
   never degrade control health — observation is not control truth).
5. **Lease/progress persistence is a dedicated UPDATE path** on
   `pi_subagent_executions` (columns already staged by migration 099):
   progress → `last_progress_json`, `last_progress_at`, `dropped_progress_count`;
   heartbeat → `last_heartbeat_at`, `lease_expires_at` (= now + leaseMs).
   Never touches `desired_state`/`observed_state`, never writes journal rows
   (no durable intermediate progress history). New repository methods:
   `recordProgressObservation`, `recordHeartbeatObservation`, and a reader
   `getObservation(executionId)` → `{ lastProgressJson, lastProgressAt,
droppedProgressCount, lastHeartbeatAt, leaseExpiresAt }`.
   Write failures: progress/heartbeat swallow (counters keep ticking); only
   lifecycle kinds keep the ticket-22 degrade+reject semantics.
6. **Server-side coalescer** (per execution, in the PiAdapter wrapper):
   one latest-snapshot slot + trailing-edge timer at `1/rateHz`; updates
   arriving while a slot is pending replace the slot and increment a coalesced
   counter; flush emits `item.updated` + durable UPDATE. `dispose()` awaited
   on inline completion; idle-TTL self-cleanup (max(lease, 2×heartbeat)
   without progress) covers detached executions whose tool call already
   returned. No lifecycle/terminal event ever passes through this queue.
7. **Capability surface:** Alfie `PI_SUBAGENT_CAPABILITIES` gains
   `"coalesced-progress"`; extension version → `0.11.0-alfie.1`.
   `synara-bridge.test.ts` missing-capability case flips to use another
   missing required capability. Symphony keeps `coalesced-progress` OPTIONAL
   in the default handshake request; mixed-version safety: an extension that
   does not advertise it never sends progress/heartbeat kinds.
8. **AC8:** reconnect = existing WS cursor-resume + activity stream; the
   flood test proves coalesced event counts (≤ rate×duration), and repo
   reopen proves `getObservation` restores latest progress + lease without
   intermediate history. No new WS schema. Web auto-follow already excludes
   non-message activity (ChatView guard + browser test).
9. **Real-Pi evidence (AC9):** deterministic loopback SSE model server +
   provenance re-pin to the new Alfie commit; new
   `piSubagentProgressAcceptance.test.ts` drives a real managed child with a
   small binding policy (fast heartbeat/lease) and proves real progress
   kinds, durable observations, and no legacy spinner stream.
10. **Migration:** none required (migration 099 already stages all columns).
    No new migration in ticket 23.

## Work packets

- **WP-A (Alfie repo `/Users/anhpham99/alfie`):** producer coalescer,
  heartbeat timer, binding widening + policy validation, capability/version
  bump, extension tests, cleanup/release semantics.
- **WP-B (Symphony):** config resolvers + live wiring, contracts widening,
  repository observation methods + tests, PiAdapter dispatch + server
  coalescer + saturation/invalid-config/reopen tests.
- **WP-C (Symphony, after A+B):** provenance re-pin, real-Pi progress
  acceptance test, per-file standalone envelope verification, full suite,
  ticket report update.

## Verification gates

- Alfie: `bun run test` (extension suite) green; bounded-foreground +
  new coalescing/heartbeat tests green.
- Symphony: focused files standalone; then one bundled
  `bun fmt`+`bun lint`+`bun typecheck`+`bun run test` pass (workspace rule).
- Ticket 23 report filled with evidence before review.
