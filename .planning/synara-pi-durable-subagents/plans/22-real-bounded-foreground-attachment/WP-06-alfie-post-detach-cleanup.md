# WP-06 — Alfie post-detach settlement cleanup and failure-result shape

**State:** pending

**Owner role:** worker

**Repository:** `/Users/anhpham99/alfie`

**Dependencies:** none; parallel-safe with WP-07 (different repository)

## Task

Fix the reopened T22-AC7 defect (post-detachment settlement cleanup leak) in
the real Alfie extension, harden the lifecycle-persistence failure result
shape, and strengthen the Alfie-side tests that must observe the fix. Produce
one local commit. Do not push.

## Context and authority

A post-acceptance independent review reopened Decision 0007 because the managed
detached foreground child never receives settlement cleanup:

- `AgentManager` fires `onComplete` only for `isBackground` runs
  (`src/agent-manager.ts` — the three `if (options.isBackground)` guards
  surrounding `this.onComplete?.(record)`).
- The managed foreground path (`src/index.ts`, managed branch after
  `manager.startForeground`) deletes `liveAttachments` at detach
  (`liveAttachments.delete(managedBinding.executionId)` in Outcome B) but
  attaches no post-detach continuation to `handle.promise`, so after the
  detached child settles:
  - its `agentActivity` entry (set in `fgCallbacks.onSessionCreated`) persists
    until session disposal;
  - `widget.markFinished(record.id)` is never called, so the widget's 80 ms
    update interval can keep running (bounded only by the manager's ~10-minute
    record cleanup, `cleanup()` cutoff `10 * 60_000`).
- `getResourceSnapshot()` only counts `liveAttachments`/their timers, which is
  why AC7 tests reported 0/0 while these resources leaked.

Authoritative requirements:

- [Decision 0006](../../decisions/0006-t22-bounded-foreground-attachment-technical-direction.md)
  §4 (timer/registry cleanup on every path; settlement must remove live
  attachment/observation entries), §6 (failure containment must not return an
  inline success or a successful handle), §8 non-goals.
- [Issue 22](../../issues/22-real-bounded-foreground-attachment.md) T22-AC7
  wording and the reopened review disposition recorded in the ticket.
- [Decision 0001](../../decisions/0001-testing-strategy-governance.md) —
  resource-observation boundary and success/failure pairing.

## Allowed write set (nothing else)

- `agent/extensions/pi-subagents/src/index.ts`
- `agent/extensions/pi-subagents/src/agent-manager.ts` (only if a minimal hook
  is genuinely required; prefer the index.ts continuation — see contract)
- `agent/extensions/pi-subagents/test/bounded-foreground.test.ts`
- `agent/extensions/pi-subagents/test/synara-bridge.test.ts` (only if the
  resource snapshot surface changes)

Forbidden: any other file; package.json version/deps/scripts; changes to
steer/resume/stale-settlement/operation-token semantics; emitting any
follow-up notification for a detached child (background nudge semantics belong
to `isBackground` runs only — a detached foreground child must NOT become a
background notification).

## Implementation contract

1. **Post-detach settlement continuation.** In the managed branch's Outcome B
   (after the detached handle result is returned), attach a continuation to the
   captured `handle.promise` that, once the child settles:
   - calls `agentActivity.delete(record.id)` and `widget.markFinished(record.id)`
     idempotently;
   - performs no `onUpdate`, no notification, no `sendMessage`, no result
     consumption, and no journal/reportObservation call (terminal truth is a
   downstream ticket);
   - never rejects (consume settlement errors; the manager already normalizes
     them).
   The continuation must be attached exactly once per invocation and must not
   double-run with the inline path (inline settlement path already cleans up).
2. **Widget interval hygiene.** After marking the detached child finished, the
   widget's idle path (`update()` seeing nothing active) must clear the 80 ms
   interval. If the current `markFinished` + `update` flow does not do this for
   a finished-but-unrendered agent, trigger a `widget.update()` from the
   continuation so the existing `clearInterval` branch runs. Do not change
   `AgentWidget` unless required — if you must, stay within the write set
   constraints and keep it minimal.
3. **Failure-result shape.** The two `pi_subagent_lifecycle_persistence_failed`
   returns (`started` and `detached` report rejections) must be error-shaped:
   `isError: true` plus a structured `diagnosticCode` field in the result
   object (keep the stable diagnostic string as the text). Also mark the
   managed identity-mismatch rejection (`pi_subagent_admission_rejected` text)
   as error-shaped for consistency. This prevents the Symphony wrapper from
   presenting a failed lifecycle write as a success-shaped handle.
4. **Optional hardening (do it if cheap):** mirror the upper bound in
   `extractManagedForegroundBinding` (`foregroundWaitMs > 60000` → undefined)
   to match Symphony's validator.

## Test-first sequence (extend `test/bounded-foreground.test.ts`)

1. Detached child settles after detach → `agentActivity` no longer contains the
   record id, `widget.markFinished` was called (observable via widget state or
   the finished set), and no notification was emitted (capture
   `pi.sendMessage`).
2. Detached child is aborted after detach → same cleanup; timer already
   cleared; no double cleanup crash.
3. Inline path (existing tests 1/3) still cleans up and does not run the
   continuation twice.
4. Lifecycle-persistence failure results now carry `isError: true` and
   `diagnosticCode`.
5. Existing 12 tests remain green; update any that asserted the plain
   success-shaped failure text.

## Verification

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/anhpham99/alfie/agent/extensions/pi-subagents
bun run test test/bounded-foreground.test.ts test/synara-bridge.test.ts
bun run test
```

Clean any test artifacts before reporting status. Record test counts.

## Completion and commit rule

- Full package suite green.
- No file outside the write set changed.
- One local commit on `main`:
  `fix(pi-subagents): clean up detached foreground settlement and error-shape lifecycle failures (issue 22 remediation)`.
- Report the commit hash and clean status. Do not push.

## Challenge conditions

Stop and return `challenge` if the continuation cannot be made exactly-once,
if cleanup would require changing notification semantics for background runs,
or if a file outside the write set is genuinely required.
