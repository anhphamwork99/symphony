# Decision 0001 — project charter and inherited authority

## Status

**Accepted for project creation and planning scope.** This record does not
accept a source architecture, implementation candidate, release, push, or
deploy.

## Date and owner authorization

- **Date:** 2026-08-26
- **Owner:** anhpham99
- **Approval:** “okay, tạo 1 project trong planning để spawn các subagents thực
  hiện và xử lý vấn đề 1 cách toàn trình đi”
- **Accepted slug:** `synara-pi-subagent-lifecycle-reliability`

## Governing references

- This project home: [PROJECT.md](../PROJECT.md)
- Inherited durable authority: [durable-subagents Project Home](../../synara-pi-durable-subagents/PROJECT.md)
- Inherited handshake authority: [handshake-first Project Home](../../synara-pi-subagent-handshake-first/PROJECT.md)
- Supporting incident: [research 001](../research/001-live-incident-and-current-seam-map.md)
- Supporting candidate contract: [research 002](../research/002-candidate-solution-contract.md)

## Decision

1. Create the project home and six-ticket decomposition in planning only.
2. Make `PROJECT.md` the sole project status/frontier router.
3. Set the exact initial frontier to Ticket 01 only; Tickets 02–06 remain
   blocked.
4. Preserve inherited accepted decisions by aspect; link, do not copy or
   silently supersede them.
5. Use one integrated feature-level review and exactly one Supervisor final
   acceptance for the full project. Reviews are evidence, not authority.
6. Keep Alfie conditional and pinned to
   `aa6fa4a8540644d2509b10d6df854486ddc67d1d` /
   `@alfie/pi-subagents@0.15.0-alfie.4`; any runtime change requires
   provenance re-pin.
7. Preserve settled invariants: durable `executionId`, attempt/generation
   fencing, proof-before-fence, journal-first terminal/outbox, bounded and
   authorized payloads, no automatic replay/Resume, no PID guessing, no
   Symphony PID kill authority, and separate terminal outcome/cleanup proof.
8. Record crash guardian, orphan-terminal exception, durable post-restart owner
   receipt, and provider-bootstrap Resume only as candidate directions and
   material decision gates.

## Rejected interpretations

- This record is not acceptance of any of the four candidate architectures.
- Research cannot advance the frontier.
- A ticket cannot become ready by editing its own status; the router must
  advance it.
- A real-Pi or manual claim cannot be substituted by a fake or fixture claim.

## Downstream effect

Ticket 01 is ready-for-agent as a read-only grounding ticket. All other tickets
are blocked pending the dependency graph and decision gates in PROJECT.md.
