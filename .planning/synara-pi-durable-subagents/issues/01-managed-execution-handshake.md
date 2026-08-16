# 01 — Versioned managed-execution handshake

**What to build:** Synara negotiates an optional, versioned managed-execution
capability when a Pi provider session starts or resumes. A compatible
pi-subagents extension enables managed behavior for that session. An absent,
failing, or unsupported bridge leaves the complete legacy `Agent` behavior
unchanged and prevents Synara from describing those agents as durable or
restart-recoverable.

**Blocked by:** None — can start immediately.

**Status:** complete

- [x] **T01-AC1:** The handshake carries an explicit protocol version and
  capability set; compatible versions succeed and unsupported versions fail
  closed with offered-versus-supported diagnostic context.
- [x] **T01-AC2:** Without a successful handshake, spawn, abort, completion, and
  notification behavior remain legacy behavior, and no managed execution
  record is created.
- [x] **T01-AC3:** Bridge absent, bridge error, and unsupported version produce
  distinct stable diagnostic codes without degrading unrelated Pi session or
  provider controls.
- [x] **T01-AC4:** The negotiated result is stable for the provider-session
  lifetime and can be correlated with executions admitted in that session.
- [x] **T01-AC5:** Repeated probes are idempotent and produce no execution,
  transcript, notification, or model-context side effects.
- [x] **T01-AC6:** Managed admission and completion ownership remain inert until
  successful negotiation; mixed-version rollout cannot silently enable only
  part of the managed lifecycle.


## Testing Seams

**Approval status:** Approved by owner on 2026-08-16

- **T01-AC1, T01-AC5 (Contract Schemas & Compatibility):**
  - Seam: `packages/contracts/src/piSubagents.test.ts` validating `packages/contracts/src/piSubagents.ts`.
  - Proves: Schema validation for handshake request/response envelopes, supported protocol versions, capability bitsets/sets, malformed envelopes, and pure negotiation compatibility checks.
- **T01-AC1, T01-AC2, T01-AC3, T01-AC5 (Pi Extension Bridge & Isolated Fixtures):**
  - Seam: `apps/server/src/provider/piSubagentBridge.test.ts` validating `apps/server/src/provider/piSubagentBridge.ts`.
  - Concrete isolated test fixtures:
    1. `makeCompatiblePiSubagentExtension({ protocolVersion: 1, capabilities: [...] })`: Compatible extension fixture; proves successful handshake, capability extraction, and `pi_subagent_managed_enabled`.
    2. `makeLegacyPiSubagentExtension()`: Older/legacy extension fixture with no Synara bridge; proves `pi_subagent_bridge_absent` diagnostic code without throwing.
    3. `makeUnsupportedPiSubagentExtension({ protocolVersion: 99, supportedVersions: [99] })`: Older/incompatible extension fixture; proves fail-closed negotiation with `pi_subagent_unsupported_version` and offered-vs-supported diagnostic context.
    4. `makeFailingPiSubagentExtension(new Error("Bridge explosion"))`: Faulty extension fixture; proves fail-closed handling with `pi_subagent_bridge_error` diagnostic code.
    5. Idempotent probe check: Repeated probes against the same bridge instance produce identical results with zero execution, transcript, or notification side effects.
- **T01-AC2, T01-AC3, T01-AC4 (Provider Session Integration Boundary):**
  - Seam: `apps/server/src/provider/Layers/PiAdapter.test.ts` (or `apps/server/src/provider/piSubagentSession.test.ts`).
  - Proves: Session startup and resume probe the extension bridge; negotiated capability is stored on the session context for the session lifetime; absent/unsupported/failing bridges emit distinct runtime warning events while normal session execution, turns, and tools remain fully operational.
- **T01-AC6 (Managed Admission Guard Boundary):**
  - Seam: `apps/server/src/provider/piSubagentAdmissionGuard.test.ts`.
  - Proves: Managed execution admission and completion coordinator remain inert when session capability handshake is absent or unnegotiated.


