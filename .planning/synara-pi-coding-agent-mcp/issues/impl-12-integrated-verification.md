# impl-12 — Verify the integrated Synara MCP flow

**What to build:** Prove the complete user journey from dormant default Pi through enable, multi-session activation, MCP use, disable during a call, recovery, and rollback.

**Blocked by:** impl-01 through impl-11.

**Status:** done

- [x] Verify default dormant startup has no Synara catalog or MCP activity.
- [x] Verify enable pending/terminal behavior, all-session success, and subject-bound MCP use.
- [x] Verify disable cancellation continues the Pi turn and prevents replay.
- [x] Verify reconnect/restart recovery and future-session waiting.
- [x] Verify failed sibling activation rolls the whole project back to disabled.
- [x] Run focused integration/manual smoke evidence and the permitted full test command.

## Delivery evidence

- Real WebSocket/RPC orchestration harness:
  `apps/server/integration/WsOrchestrationHarness.integration.ts` and
  `apps/server/integration/synaraWsClient.integration.ts`.
- Deterministic provider-boundary controls:
  `apps/server/integration/TestProviderAdapter.integration.ts`.
- AC1 integrated lifecycle journey:
  `apps/server/integration/synaraMcp.integration.test.ts`.
- AC2 browser/work-log journey:
  `apps/web/src/synaraMcpJourneySmoke.test.ts`.
- Focused AC1 verification passed 3 files / 9 tests.
- Focused AC2 and focused reducer/work-log regressions passed 3 files / 151
  tests.
- Full `bun run test` passed 8/8 workspace tasks. The server suite reported
  4,115 passing and 17 environment-gated skips; the web suite reported 3,797
  passing.
- Owner-authorized final bundled completion gate passed: `bun fmt` exited 0;
  `bun lint` exited 0 with 460 warnings and 0 errors; `bun typecheck` passed
  7/7 packages. Formatter-only unrelated drift was reversed under Decision
  31, leaving the candidate clean.
- Matt conformance review passed both Standards and Spec/testing-governance
  axes after repair. The retained non-blocking smells concern unused
  test-fixture controls and repeated harness cleanup branches; neither affects
  AC1/AC2 behavior or completion evidence.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Integrated server/WebSocket/Pi boundary — a thin vertical slice covers dormant startup, successful enable, authorized MCP use, disable during an MCP call with Pi-turn continuity, reconnect/restart recovery, and failed-sibling global rollback.
- **AC2:** Browser/work-log smoke boundary — durable activity visibility, reconnect replay equivalence, and absence of assistant-message or sidebar contamination are verified without duplicating the focused suites from `impl-01` through `impl-11`.

Use representative success/failure journeys, including at least one authority or activation failure, one rollback/recovery path, and exactly-once terminal activity evidence. The full suite command remains `bun run test`.
