# impl-11 — Measure Pi standalone and Synara token overhead

**What to build:** Produce paired measurements of Pi standalone, Synara default, and activated Synara MCP sessions by real accounting components.

**Blocked by:** impl-03 — Remove default Synara tools and add dormant MCP extension.

**Status:** ready-for-agent

- [ ] Measure policy, tool schema, startup/context, cached input, and processed tokens consistently.
- [ ] Compare equivalent prompts and model/session configurations.
- [ ] Report real overhead without changing accounting or hiding catalog content.
- [ ] Record whether measurement justifies future compaction or artifact-backed output work.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Controlled paired measurement harness — equivalent Pi standalone, Synara default, and activated Synara MCP runs report comparable policy, tool-schema, startup/context, cached-input, and processed-token measurements with configuration metadata and repeatability/variance.
- **AC2:** Token accounting snapshot/reconciliation contract — component totals reconcile with reported totals; missing or inconsistent accounting is a measurement failure; instrumentation does not alter accounting or hide catalog content.

This ticket observes real accounting only. A numeric overhead budget, compaction, artifact-backed output, or accounting change is outside the seam approval and requires a separate owner decision.
