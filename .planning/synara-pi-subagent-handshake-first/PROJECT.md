# Synara Pi Subagent Handshake-First Handoff

## Routing metadata

- **Owner:** anhpham99
- **Lifecycle:** Implementation in progress — Ticket 01 accepted;
  Ticket 01 runtime-closure remediation (01b) opened by Decision 0006 and
  now awaits the Decision 0007 host-peer compatibility prerequisite for AC4
- **Triage status:** 01b blocked on host-peer alignment for AC4; 03 ready-for-agent;
  02 blocked by 01b
- **Tracker:** Local Markdown
- **Related historical project:**
  `.planning/synara-pi-durable-subagents/`

## Authoritative artifacts

- [spec.md](spec.md) — normative handshake-first feature specification.
- [terms.md](terms.md) — project-scoped vocabulary.
- [design-tree.md](design-tree.md) — settled decision tree and implementation
  facts collected during discovery.
- [issues/](issues/) — normative implementation tickets in dependency order.
- [decisions/0001-release-controlled-extension.md](decisions/0001-release-controlled-extension.md)
  — owner-approved extension artifact policy.
- [decisions/0002-no-legacy-managed-subagent-fallback.md](decisions/0002-no-legacy-managed-subagent-fallback.md)
  — owner-approved no-fallback policy and reconciliation of historical
  mixed-version fallback decisions.
- [decisions/0003-controlled-extension-with-user-runtime-configuration.md](decisions/0003-controlled-extension-with-user-runtime-configuration.md)
  — owner-approved authentication/model-configuration boundary.
- [decisions/0005-t01-final-acceptance.md](decisions/0005-t01-final-acceptance.md)
  — final acceptance of Ticket 01’s packaged artifact and fail-close boundary,
  artifact-closure premise amended by Decision 0006.
- [decisions/0006-t01-runtime-closure-reassessment.md](decisions/0006-t01-runtime-closure-reassessment.md)
  — binding Supervisor reassessment: the Ticket 01 artifact is an
  insufficient runtime closure for the real pinned Alfie extension; opened
  remediation Ticket 01b, stopped Ticket 02 real-runtime acceptance, and
  amended Decisions 0004/0005 narrowly.
- [decisions/0007-t01b-host-peer-compatibility-reassessment.md](decisions/0007-t01b-host-peer-compatibility-reassessment.md)
  — binding Supervisor reassessment: the real pinned artifact declares Pi
  peers `>=0.83.0`, while the current packaged host is `0.81.1`; AC4 requires
  host alignment or an Alfie-source-authoritative exact-tuple exception.
- [../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md](../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
  — accepted feature-level Testing Strategy Governance reused by this
  follow-on durable-subagent work.
- The related historical Project Home routes binding decisions for bounded
  foreground attachment, journal-first terminal truth, restart reconciliation,
  watchdog/teardown, explicit resume, and managed-child process ownership.

## Current implementation frontier

- **01 — Package and fail-close the managed Pi artifact** is accepted by
  Decision 0005 (fail-close boundary; not reopened). Its runtime-closure
  remediation is tracked as Ticket 01b.
- **01b — Remediate the verified managed Pi runtime closure** is the active
  frontier but is blocked for AC4 by Decision 0007: align the packaged Pi host
  to the pinned artifact's declared `>=0.83.0` peer floor, or obtain an
  Alfie-source-authoritative exact-tuple exception. It must be accepted before
  Ticket 02 can claim completion.
- **02 — Bootstrap the verified managed harness and prove detached terminal
  lifecycle** is blocked by 01b per Decisions 0006 and 0007. Its real-runtime
  acceptance (AC1–AC4) is stopped; existing implementation remains
  in-progress work and no AC is complete. It retains its other
  responsibilities unchanged.
- **03 — Present durable execution-card truth** is unblocked and
  ready-for-agent.
- **04 — Prove desktop production composition and complete acceptance** is
  blocked by tickets 01b, 02, and 03; it remains packaged desktop/server
  final composition only and does not absorb the remediation.
