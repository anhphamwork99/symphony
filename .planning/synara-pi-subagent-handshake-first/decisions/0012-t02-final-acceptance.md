# Decision 0012 — Ticket 02 final acceptance

- **Date:** 2026-08-23
- **Status:** Accepted — binding final acceptance
- **Consultation class:** Supervisor final acceptance; the one and only final-acceptance consultation for Ticket 02.
- **Scope:** Ticket 02, “Bootstrap the verified harness and detached terminal lifecycle”, at integrated candidate `c9c8278eb` (cumulative implementation range `e65937228..c9c8278eb`) and its independently reviewed AC1–AC5 evidence. This decision does not accept Tickets 03 or 04, change Ticket 01c’s accepted artifact boundaries, or transfer production ownership.

## Question

Does the integrated Ticket 02 candidate, after a complete real controlled-artifact AC1–AC5 run and an independent PASS review, satisfy Ticket 02’s acceptance criteria?

## Governing references

- Project Home: [PROJECT.md](../PROJECT.md)
- [Ticket 02](../issues/02-bootstrap-verified-harness-and-detached-terminal-lifecycle.md)
- [Decision 0011 — Ticket 01c final acceptance](0011-t01c-final-acceptance.md)
- [Ticket 02 independent review](../reviews/02-desktop-managed-real-pi-acceptance-review.md)
- [Decision 0001 — Testing Strategy Governance](../../synara-pi-durable-subagents/decisions/0001-testing-strategy-governance.md)
- Owner-approved Ticket 02 testing seams
- The Supervisor final-acceptance consultation in the current orchestration context (2026-08-23), recorded by this decision.

## Candidate and evidence

The accepted implementation range is `e65937228..c9c8278eb`:

- `e50bff2ea` — standalone wall-clock real controlled desktop-artifact/public-WebSocket acceptance suite and registration;
- `c9c8278eb` — remediation of the first independent review’s two evidence gaps.

The range changes exactly two approved implementation paths:

- `apps/server/src/provider/piSubagentDesktopManagedRealPiAcceptance.test.ts`
- `apps/server/vitest.config.ts` (one wall-clock suite registration)

No production, artifact-staging, verifier, gate, Alfie, dependency, or other planning source changed in the candidate. The integrated diff check was clean.

The independent feature-level review was persisted at `2c7979cba` in [the Ticket 02 review](../reviews/02-desktop-managed-real-pi-acceptance-review.md). It independently reread Ticket authority, audited the full candidate range and relevant production/harness behavior, checked pinned provenance, and reran the complete standalone acceptance suite rather than relying on the implementation report.

The controlled artifact is built from the clean pinned Alfie input accepted for Ticket 01c:

- Alfie commit `aa6fa4a8540644d2509b10d6df854486ddc67d1d`;
- `@alfie/pi-subagents@0.15.0-alfie.4`;
- Ticket-01c-complete manifest-exact `agent/system` prompt closure.

Focused implementation evidence:

```text
Ticket 02 standalone wall-clock suite → 1 file passed, 6 tests passed, 0 skipped
Focused regressions → 4 files passed, 95 tests passed
```

The independent reviewer also reran the standalone wall-clock suite against the clean pin and obtained 6/6 passing tests. The acceptance test uses the real Pi loader, controlled artifact, extension bridge, production adapter, durable repository, execution-card projection, and public-WebSocket commands. The deterministic loopback model controls timing only; it does not substitute these boundaries.

## Binding decision

Ticket 02 is accepted at candidate `c9c8278eb`. AC1–AC5 all pass.

1. **AC1 — controlled artifact isolation passes.** Desktop-managed startup stages and verifies the release artifact, loads the Agent-bearing extension only from its managed artifact directory, and excludes planted user/global and parent-directory decoys. The user/global canary remains bytewise unchanged.
2. **AC2 — handshake ordering and early fail-close pass.** The successful path observes the full lifecycle capability profile before admission. A corrupted artifact fails at the public boundary with bounded `digest_mismatch` before managed exposure, capability publication, admission, model work, or fallback. Ledger counts are read only after disposal and prove no execution, journal, outbox, or dispatch effects.
3. **AC3 — supported managed admission passes.** A supported public-WebSocket Agent request creates exactly one non-rejected durable admission, with seq-1 accepted then seq-2 running/started records and matching execution identity. Real Agent-bearing parent model traffic and matching projected card identity are observed.
4. **AC4 — detached lifecycle passes.** A slow real child crosses the 300 ms foreground budget, reaches detached seq-3 within the governing `budget + 500 ms` envelope, and emits durable progress and heartbeat strictly after detachment. It commits exactly one attempt- and generation-fenced seq-40 terminal result; active ownership clears only after that terminal commit.
5. **AC5 — bounded redacted failures pass.** Invalid selected user runtime configuration exposes exactly `PI_SUBAGENT_DESKTOP_MANAGED_RUNTIME_CONFIG_FAILURE_DETAIL` after fixed-envelope extraction on both public surfaces. Self-consistent hostile artifact copies drive malformed and unsupported handshake responses through the real verifier, loader, extension bridge, adapter, and public-WebSocket boundary; they expose only their distinct bounded bootstrap categories. All negative paths exclude hostile credentials, paths, prompt/provider, and version material, and prove zero public and durable managed side effects.

The first independent review found two evidence defects: substring rather than exact runtime-detail proof, and liveness without demonstrated post-detach chronology. The accepted remediation extracts the exact provider detail from the public `Cause.pretty` envelope on both exposed surfaces, and proves a null pre-detach progress baseline followed by producer timestamps strictly later than detached seq-3. The fresh independent review verified both repairs and passed.

## Downstream effects

- Ticket 02 is accepted; its final-acceptance consultation budget is exhausted.
- Decision 0011’s Ticket 01c acceptance and all established artifact/security boundaries remain unchanged.
- Ticket 04 does **not** become ready or accepted automatically. It remains blocked by Ticket 03 until Ticket 03 receives its own binding acceptance.
- This decision does not accept Ticket 03 or Ticket 04 and does not perform Ticket 04’s desktop/server final-composition acceptance.

## Guardrails, rollback, and reopening

This acceptance applies only while its evidenced boundaries remain intact. A material weakening or removal of the wall-clock registration, post-dispose ledger observation, exact public-envelope extraction, strict post-detach liveness chronology, artifact isolation controls, or real public-WebSocket path requires reassessment.

Managed startup must remain fail-closed. Any rollback must not reintroduce user/global fallback, expose Agent work before handshake, disclose raw runtime/bridge material, or infer completion without the uniquely fenced committed terminal event.

Reopen only on material evidence that the reviewed source range/provenance changed, artifact closure is incomplete, extension resolution escapes the verified artifact, admission/failure ordering or zero-effect guarantees regress, post-detach timestamps can predate detachment while satisfying the test, terminal fencing/ownership ordering regresses, public diagnostics leak hostile data or lose their required categories, or the recorded 6/6 real run was skipped, mocked, stale, or run against a materially different candidate.
