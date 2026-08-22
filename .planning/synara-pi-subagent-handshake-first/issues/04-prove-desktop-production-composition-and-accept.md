# 04 — Prove desktop production composition and accept the harness

**What to build:** As a Synara desktop user and release operator, I can trust
that the packaged desktop, server, official artifact, Pi runtime, durable
projection, and execution card work together under both successful and
failure conditions. The release does not claim completion until every
handshake-first condition has evidence.

**Blocked by:** 02 — Bootstrap the verified harness and detached terminal lifecycle; 03 — Present durable execution-card truth.

**Status:** ready-for-agent

**Testing strategy:** [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md).

- [ ] **AC1:** Real desktop/server composition selects the packaged official
  artifact while an isolated old global extension remains present, untouched,
  and unused.
- [ ] **AC2:** The same real composition proves handshake readiness before
  Agent exposure, a detached child with continued liveness and one committed
  terminal result, and the matching `Running in background` to terminal card
  transition.
- [ ] **AC3:** Missing, corrupt, unsupported, or malformed artifacts and
  bridge/runtime configuration failures fail before managed durable side
  effects with actionable safe diagnostics.
- [ ] **AC4:** Regression evidence preserves journal-first terminal integrity,
  non-terminal orphaning, stale-generation fencing after Resume, and
  non-terminal teardown uncertainty.
- [ ] **AC5:** The full verification suite, one independent feature review,
  and one Supervisor acceptance consultation pass before the project is marked
  accepted.

## Testing Seams

**Approval status:** Approved — human owner, 2026-08-21: “đồng ý, tạo testing seam trước đi”.

- **AC1:** The packaged desktop resource resolver and backend process
  composition boundary — an isolated user Pi home with a planted old extension
  is preserved byte-for-byte while the official artifact is selected.
- **AC2:** The real Pi desktop/server composition boundary — the harness
  completes mandatory handshake before the real managed Agent is exposed; a
  slow child detaches, reports liveness, commits one terminal result, and the
  hydrated card presents each durable state accurately.
- **AC3:** The same composition failure boundary — missing/corrupt manifest,
  invalid artifact byte, unsupported capability, malformed handshake, and
  invalid user runtime configuration produce safe bootstrap categories with
  zero managed durable side effects.
- **AC4:** Existing public durable-execution acceptance boundaries for terminal
  journal truth, restart reconciliation, explicit Resume, and teardown
  uncertainty — rerun against the packaged-harness candidate to prove no
  lifecycle invariant regressed.
- **AC5:** The project validation boundary — targeted suites, `bun run test`,
  owner-authorized heavyweight checks, one persisted independent review, and
  one persisted Supervisor decision form the sole completion evidence.
