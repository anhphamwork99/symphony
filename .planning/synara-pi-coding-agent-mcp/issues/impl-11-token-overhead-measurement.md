# impl-11 — Measure Pi standalone and Synara token overhead

**What to build:** Produce paired measurements of Pi standalone, Synara default, and activated Synara MCP sessions by real accounting components.

**Blocked by:** impl-03 — Remove default Synara tools and add dormant MCP extension.

**Status:** implemented-awaiting-final-acceptance

- [x] Measure policy, tool schema, startup/context, cached input, and processed tokens consistently.
- [x] Compare equivalent prompts and model/session configurations.
- [x] Report real overhead without changing accounting or hiding catalog content.
- [x] Record whether measurement justifies future compaction or artifact-backed output work.

## Delivery evidence

- Harness: `apps/server/scripts/token-overhead/measure.ts`
- Reconciliation and reporting: `apps/server/src/measurement/`
- Measurement-only effective-catalog observer:
  `apps/server/src/provider/piCatalogObserver.ts`
- Paired real-run artifact:
  `benchmarks/synara-pi-token-overhead/report.json`
- Human-readable result and reproduction command:
  `benchmarks/synara-pi-token-overhead/README.md`

The accepted run used `cockpit/gpt-5.6-sol`, thinking level `medium`, three
fresh repetitions per mode, and two identical measured turns per repetition.
All three modes completed 3/3 valid repetitions and every measured turn
reconciled against
`total == input + cacheRead + cacheWrite + output`.

The measurement records a non-binding recommendation to investigate
compaction or artifact-backed output separately. It does not establish a
numeric budget or authorize that work.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Controlled paired measurement harness — equivalent Pi standalone, Synara default, and activated Synara MCP runs report comparable policy, tool-schema, startup/context, cached-input, and processed-token measurements with configuration metadata and repeatability/variance.
- **AC2:** Token accounting snapshot/reconciliation contract — component totals reconcile with reported totals; missing or inconsistent accounting is a measurement failure; instrumentation does not alter accounting or hide catalog content.

This ticket observes real accounting only. A numeric overhead budget, compaction, artifact-backed output, or accounting change is outside the seam approval and requires a separate owner decision.
