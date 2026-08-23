# 02 — Bootstrap the verified harness and detached terminal lifecycle

**What to build:** As a Synara desktop user, a managed Agent becomes available
only after the official extension, user runtime configuration, and mandatory
handshake are ready. The same detached child remains observable in the
background and settles through exactly one fenced committed terminal outcome.

**Blocked by:** None for real-runtime acceptance — the Ticket 01c block was
removed by [Decision 0011](../decisions/0011-t01c-final-acceptance.md)
(2026-08-23), which accepted the prompt-closure remediation at candidate
`6ccc674b9` after the persisted independent PASS review at `c470acffd` and
discharged Decision 0010's suspension of Decision 0009's
complete-executable-closure/Ticket-02-unblocking conclusions. The staged
artifact now carries the pinned extension's mechanically derived
`agent/system` prompt-file closure (`subagent-system.md`,
`tool-guidelines.md`, `skill-rules.md`, `working-style.md`), and a real
delegated child spawn reaches at least its first real child model request
from the release alone.

**Status:** accepted — [Decision 0012](../decisions/0012-t02-final-acceptance.md)
(2026-08-23) accepts the complete real controlled-artifact AC1–AC5 candidate
at `c9c8278eb`, after the persisted independent PASS review at `2c7979cba`.
The accepted evidence reran the standalone desktop-managed/public-WebSocket
suite against the Ticket-01c-extended artifact and repaired the prior
live-WAL observation issue by reading external ledger counts only after
harness disposal. Ticket 02's one final-acceptance consultation has been
consumed.

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [x] **AC1:** Desktop managed sessions load extensions only from the verified
  release artifact while using only the user authentication/model configuration
  needed to run Pi.
- [x] **AC2:** The managed handshake completes with the required lifecycle
  capability profile before managed Agent work is exposed; failure is early and
  never becomes a legacy fallback or a normal late Agent-call failure.
- [x] **AC3:** A normal supported managed Agent task is admitted once and runs
  without a missing-handshake rejection.
- [x] **AC4:** A real child exceeding the foreground budget reports accepted,
  started, detached, continuing liveness, and exactly one fenced committed
  terminal result.
- [x] **AC5:** Invalid user runtime configuration and malformed/unsupported
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
