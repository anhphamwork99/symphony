# Decision 0002 — No legacy managed-subagent fallback

- **Date:** 2026-08-21
- **Status:** Accepted by owner
- **Owner evidence:** “A”
- **Scope:** Synara desktop managed Pi subagent product behavior

## Context

Decision 0001 requires a release-controlled extension and a mandatory
handshake before managed Agent work. The source handoff allows a
developer-only legacy mode only if it is explicitly named, separated from
durable managed identity and cards, and never silently mixed with managed
lifecycle semantics.

Decisions 0004, 0005, and 0006 in the historical durable-subagent project
allowed unhandshaked or capability-missing extensions to continue under legacy
unmanaged semantics. That was their accepted mixed-version posture before the
incident revealed that the desktop could select a mutable old global extension.

## Authority reconciliation

For Synara desktop managed-subagent sessions, the source handoff's
handshake-first direction and this owner decision supersede only the
legacy-fallback portions of Decisions 0004, 0005, and 0006. Their
authorization, atomic-admission, control-health, ownership, sequence-ordering,
timer, cancellation, and lifecycle-persistence invariants remain binding.
Other Pi consumers remain outside this project and may continue to use their
own global extensions.

## Decision

Synara desktop will not provide a legacy or unmanaged subagent fallback in
this work. If the release-selected artifact is unavailable or does not satisfy
the mandatory handshake, managed-subagent initialization fails early with an
actionable diagnostic.

The product must not create a child, admission, managed execution identity, or
execution card before that failure. It must not silently select a global Pi
extension as an alternative.

## Consequences

- There is one supported desktop managed-subagent path and one set of durable
  lifecycle semantics.
- A future developer-only diagnostic mode is out of scope and would require an
  explicit, separately approved design that remains visibly and structurally
  outside managed execution semantics.
- The bootstrap failure path becomes a release-quality requirement, not a
  per-Agent fallback or late workflow rejection.
