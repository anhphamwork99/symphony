# PROJECT — Antigravity background lifecycle

Status: accepted

Final acceptance:
`decisions/0001-accept-integrated-antigravity-background-lifecycle.md`

Current enablement policy:
`decisions/0002-owner-default-on.md`

Project home:
`/private/tmp/symphony-agy-bg-lifecycle/.planning/synara-antigravity-background-lifecycle`

## Goal

Keep an Antigravity turn active while `agy` still owns background commands or
asynchronous tasks, ingest all output before settlement, and expose an honest
aggregate status without inventing per-job identity.

## Owner-approved scope

- Preserve one `agy -p` process per provider turn.
- Treat the official Stop hook field `fullyIdle` as the aggregate idle authority.
- For `fullyIdle:false`, return `decision:"continue"`, keep the turn running,
  suppress missing-terminal recovery, and emit one edge-triggered aggregate
  `active` event.
- For `fullyIdle:true`, allow natural process exit, wait within a bounded close
  window, perform a bounded stable-EOF hook/transcript drain, and emit the
  terminal event last.
- Bound continuation count and background wall time. Reuse the existing proven
  process-tree teardown and quarantine behavior on failures.
- Enable the feature by default. Absent, empty, or malformed
  `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE` resolves to the product default
  (`true`); explicit `false`/`0`/`off` remains the legacy rollback kill switch.
- Expose only aggregate UI states (`active`, `idle`, `finalizing`). Do not expose
  or synthesize background job IDs, names, counts, PIDs, or progress.
- Treat background-status updates as activity, not assistant live output; they
  must not retrigger transcript auto-follow.

## Authoritative records

- [Antigravity Hooks](https://antigravity.google/docs/hooks.md) is authoritative
  for the Stop input/output contract, including `fullyIdle` and
  `decision:"continue"`.
- `docs/findings/ANTIGRAVITY-fullyIdle-probe.md` is authoritative for local
  `agy` 1.1.19 print-mode qualification and the enablement gate.
- `decisions/0002-owner-default-on.md` is authoritative for the current
  product default and explicit rollback values; Decision 0001 remains the
  immutable historical lifecycle acceptance.
- The integrated source and focused tests at this project candidate are
  authoritative for implementation behavior and regression evidence.
- This file is authoritative for feature scope, non-goals, and acceptance
  routing.
- `.planning/synara-antigravity-terminal-recovery/` is supporting history only.
  Its accepted scope explicitly excluded contracts and UI and does not govern
  this feature.

## Non-goals

- Per-job native lifecycle events or synthetic job registries.
- Internal Antigravity gRPC integration.
- Migration to long-lived `stream-json`.
- Durable reattachment to an inherited `agy` process after a Synara server
  restart. Full continuation is a separate project.

## Acceptance criteria

- **AC-01 Hook contract:** With the flag enabled, Stop `fullyIdle:false` under
  the continuation cap returns `continue`; true, malformed, missing, or capped
  Stop returns `{}` and never `decision:"stop"`.
- **AC-02 Legacy safety:** With the flag disabled, Stop behavior is unchanged.
- **AC-03 Active ownership:** A continued false Stop emits one aggregate
  `active` edge, does not teardown or settle, and repeated false observations
  do not duplicate the activity row or reset the hard deadline.
- **AC-04 Recovery exclusion:** Missing-terminal recovery cannot claim a turn
  while the aggregate lifecycle owns it, regardless of `pendingTools`.
- **AC-05 Idle transition:** A true Stop after active emits one `idle` edge,
  waits boundedly for natural close, and does not emit terminal at Stop
  observation time.
- **AC-06 Terminal ordering:** Natural close emits `finalizing`, drains late
  hook/transcript records through stable EOF, closes dangling tool items
  honestly, and emits exactly one `turn.completed` as the final turn-scoped
  event.
- **AC-07 Failure honesty:** Close-before-idle, continuation exhaustion, and
  background deadline expiry preserve captured output and settle failed with
  specific diagnostics.
- **AC-08 Cleanup safety:** Close-wait timeout uses proven teardown. Unproven
  death enters quarantine, blocks admission, and does not create a second
  cleanup owner or terminal.
- **AC-09 Cancellation:** User interrupt and session stop cancel timers and
  preserve single-terminal behavior.
- **AC-10 Typed aggregate surface:** The provider event schema accepts only
  `active | idle | finalizing` from `provider_stop` and rejects per-job fields.
- **AC-11 Web truth:** The latest current-turn activity drives the composer
  status; stale prior-turn, malformed, settled, aborted, or non-running state
  clears or is ignored correctly, including reconnect snapshots.
- **AC-12 Transcript isolation:** Aggregate lifecycle activities are omitted
  from the work log and do not change the transcript auto-follow signal or call
  `scrollToEnd`; real assistant messages retain auto-follow behavior.
- **AC-13 Real-provider qualification:** The recorded `agy` 1.1.19 probe shows
  one PID surviving false Stops, both sentinels completing, a later true Stop,
  and process close only after true.
- **AC-14 Rollback:** Setting `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE` to
  `false`, `0`, or `off` restores legacy behavior without data migration.

The product default is ON. Absent, empty, and malformed lifecycle input all
resolve to `true`; only the explicit `false`/`0`/`off` values disable it.

## Verification and acceptance routing

The integrated candidate must pass focused contract, server, projection, web
derivation, presenter, compiler, and browser tests, followed by one final
workspace pass of `bun run test`, `bun fmt`, `bun lint`, and `bun typecheck`.

After verification, collect exactly one independent feature-level reviewer
evidence package. Then invoke exactly one Project Supervisor final acceptance
consultation using this `PROJECT.md` as the authoritative routing record.

The accepted integrated candidate already completed the heavyweight workspace
verification recorded in Decision 0001. This default-policy follow-up is
bounded to the resolver, adapter fallback, focused adapter/config tests, and
authoritative documentation; its verification uses targeted formatting/lint
checks, focused server tests, and `git diff --check` without repeating the
workspace-wide gates.
