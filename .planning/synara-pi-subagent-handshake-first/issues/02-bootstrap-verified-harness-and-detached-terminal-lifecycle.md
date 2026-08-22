# 02 — Bootstrap the verified harness and detached terminal lifecycle

**What to build:** As a Synara desktop user, a managed Agent becomes available
only after the official extension, user runtime configuration, and mandatory
handshake are ready. The same detached child remains observable in the
background and settles through exactly one fenced committed terminal outcome.

**Blocked by:** 01b — Remediate the verified managed Pi runtime closure.
Decision 0006 found the accepted Ticket 01 artifact an insufficient runtime
closure for the real pinned Alfie extension (missing
`agent/extensions/shared` and the lock-proven release-owned `node_modules`
dependency closure). Ticket 02 may not claim completion until remediation
01b is accepted.

**Status:** blocked — real-runtime acceptance (AC1–AC4) stopped by
[Decision 0006](../decisions/0006-t01-runtime-closure-reassessment.md).
Existing implementation code and tests remain as in-progress work toward
this ticket; no acceptance criterion is complete until 01b is accepted.

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [ ] **AC1:** Desktop managed sessions load extensions only from the verified
  release artifact while using only the user authentication/model configuration
  needed to run Pi.
- [ ] **AC2:** The managed handshake completes with the required lifecycle
  capability profile before managed Agent work is exposed; failure is early and
  never becomes a legacy fallback or a normal late Agent-call failure.
- [ ] **AC3:** A normal supported managed Agent task is admitted once and runs
  without a missing-handshake rejection.
- [ ] **AC4:** A real child exceeding the foreground budget reports accepted,
  started, detached, continuing liveness, and exactly one fenced committed
  terminal result.
- [ ] **AC5:** Invalid user runtime configuration and malformed/unsupported
  bridge responses fail safely before durable managed side effects and do not
  disclose credentials, paths, prompts, or provider configuration.

## Testing Seams

**Approval status:** Approved — human owner, 2026-08-21: “đồng ý, tạo testing seam trước đi”.

- **AC1:** The desktop backend environment through Pi session creation — an
  isolated fake user Pi home contains a v0.10-style global extension, while
  the release artifact is selected; the planted global tree remains bytewise
  unchanged and receives neither managed handshake nor Agent invocation.
- **AC2:** The managed-session startup boundary — controlled runtime creation,
  extension binding, successful mandatory handshake, and managed Agent
  exposure occur in that order; artifact/runtime/bridge failure disposes
  partial state before durable effects.
- **AC3:** The real managed Agent invocation boundary — a supported session
  creates one durable admission and child start without a new per-call
  missing-handshake failure.
- **AC4:** The real Pi extension boundary with a deterministic loopback model
  — a slow child crosses the bounded foreground wait, emits liveness after
  detach, and provides one identity/generation-fenced terminal observation
  before active ownership is released.
- **AC5:** The managed-session startup failure boundary — invalid auth/model
  input and malformed/unsupported bridge responses yield bounded categories;
  redaction assertions prove diagnostic text excludes secret-bearing input.
