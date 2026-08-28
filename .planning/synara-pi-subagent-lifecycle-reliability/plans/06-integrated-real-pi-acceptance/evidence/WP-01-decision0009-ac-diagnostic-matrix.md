# WP-01 — Decision 0009 AC / diagnostic matrix

**Current evidence only:**
`WP-01-decision0009-deterministic.log` (18/18 files, 266/266 tests, exit 0)
and `WP-01-decision0009-contracts.log` (1/1 file, 40/40 tests, exit 0).
Aggregate: **19/19 files, 306/306 tests, zero failures, zero skips**.
The matrix does not cite or overwrite any prior WP-01 log or matrix.

The rows below are D-class deterministic evidence from those two current logs.
Line anchors for `piSubagentLiveLifecycleContainment.test.ts` are verified at
the frozen candidate3 checkout. R-class real-Pi evidence remains a separate
WP-02 concern.

## Decision 0009 — structured provider-unavailable preservation and reason mapping

| Situation / case | Positive expected result | Failure or diagnostic boundary | Evidence anchor |
|---|---|---|---|
| Exact live provider path returns the structured `pi_subagent_managed_execution_unavailable_live` marker on an unavailable result before acceptance | The exact marker maps the unaccepted control to `pi_subagent_read_live_record_unavailable` and preserves internal `unavailableReason: provider_inactive` on the unavailable result; the reason is never public or durable | Marker-only mapping; provider text is never parsed and no accepted effect is claimed | `piSubagentCanonicalRouting.test.ts:568`, `:582`; `piSubagentLiveLifecycleContainment.test.ts:635` |
| Unaccepted control with `provider_inactive` reaches the managed boundary | Maps to `pi_subagent_read_live_record_unavailable` without claiming an accepted effect | Terminal-first control cannot become `applied` without crossing the provider-owned acceptance marker | `piSubagentCanonicalRouting.test.ts:568`, `:577`; `piSubagentLiveLifecycleContainment.test.ts:602` |
| Observation on a captured but inactive route, and generic route-inactive (`provider_route_inactive`) | Remain generic `pi_subagent_live_lifecycle_unavailable` | Route-inactive conflation with provider-inactive structured-marker routing is rejected (pre-freeze review fix) | `piSubagentCanonicalRouting.test.ts:547`, `:557`, `:561` |
| Human text resembling the marker arrives on the containment path | Never parsed; conservative generic classification stands | Text-shape markers cannot trigger the structured mapping | `piSubagentCanonicalRouting.test.ts:640`, `:646` |
| Accepted (`applied`), stale (`stale_ignored`), timeout, and outcome-unknown semantics | Unchanged by Decision 0009; preserved exactly | No reconstruction, retry, replay, or acceptance lie is introduced by the correction | `piSubagentLiveLifecycleContainment.test.ts` (within the 266-test unit leg) |

## T06-AC2 — public execution identity and bounded surfaces

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| Exact tuple capture/activation applies one live observation; sibling sessions and equal public tuples remain isolated (`:25`, `:53`). Durable execution reads and terminal/outbox paths are covered by the current 19-file collection. | Missing, mismatched, inactive, or disposed routes return bounded `pi_subagent_live_lifecycle_unavailable` without provider dispatch (`:92`). Internal provider text is not exposed (`:833`). |
| Current unit log proves the complete 18-file deterministic leg (266 tests); current contracts log proves the 40 contract assertions. | Current logs show zero skips, so the AC2 deterministic leg was not silently omitted. Real-Pi control/reconnect remains pending WP-02 and is not claimed here. |

## T06-AC3 — lifecycle, terminal ordering, cancellation, and truthful diagnostics

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| The current 266-test unit leg includes cancellation, watchdog escalation/sweep, teardown, terminal lifecycle, and completion outbox files; Decision 0008 same-registration accepted retirement remains `applied` (`:363`). | Pre-acceptance retirement is `unavailable` (`:333`, `:540`); accepted throw/loss/timeout is `outcome_unknown` (`:392`, `:415`, `:439`). These outcomes do not invent terminal truth or retry. |
| Observation and control paths distinguish acceptance, timeout markers, and response loss (`:135`, `:267`, `:662`, `:708`); the Decision 0009 structured marker preserves internal `provider_inactive` only on unavailable results (`:635`). | An unmarked return/throw cannot become accepted success; provider/internal reasons are suppressed (`:594`, `:833`); the `provider_inactive` reason never becomes public. |

## T06-AC4 — restart/reconnect, owner truth, and no automatic replay

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| The current unit leg includes restart reconciliation, startup recovery order, resume coordination, WS snapshot/live stream, and execution-card surface coverage. | Replacement/session-clear responses are stale and cannot restore an old route (`:463`, `:499`). Missing or inactive routes stay bounded unavailable (`:92`); an unaccepted inactive control reads `pi_subagent_read_live_record_unavailable`. |
| Explicit resume and durable terminal/read boundaries are exercised in the same current 18-file collection; no real-Pi claim is made by this D matrix. | The D collection does not substitute for WP-02's controlled real-Pi restart/reconnect proof. No automatic replay is inferred from deterministic coverage. |

## T06-AC5 — stale attempt/generation and duplicate delivery/control fencing

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| Exact tuple keys are collision-free (`:240`); exact-registration retirement protects a replacement (`:783`); accepted same-registration retirement preserves one applied result (`:363`). | In-flight replacement/session mismatch is `stale_ignored` (`:463`, `:499`); a stale equal-tuple handle cannot retire the replacement (`:783`). |
| Explicit timeout and accepted response-loss cases preserve bounded outcome classification (`:206`, `:267`, `:392`, `:415`, `:439`). | No value is exposed after explicit timeout, and accepted uncertainty is not retried or converted into a second provider action (`:206`, `:439`). |
| The current contracts log covers the 40 contract assertions for identity, diagnostic, and stale-generation vocabulary. | Current logs report zero failed and zero skipped; no duplicate-control claim is based on an omitted leg. |

## T06-AC7 — stage attribution and stable failure diagnostics

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| Current unit coverage includes bridge, read boundary, watchdog, teardown, terminal, and live-containment diagnostic paths; current contracts coverage validates the shared diagnostic contract. | Missing/disposed/provider-inactive routes use the stable unavailable codes (`:92`; managed control maps to `pi_subagent_read_live_record_unavailable` exactly per Decision 0009, `piSubagentCanonicalRouting.test.ts:577`); accepted post-retirement failure shapes use stable outcome-unknown (`:392`, `:415`, `:439`); replacement uses stable stale-ignored (`:463`, `:499`). |
| The public result surface remains bounded and excludes internal/provider text (`:833`); pure control must cross the explicit provider-acceptance marker (`:594`). | Bare throws do not invent timeout or acceptance; no provider text leaks through a failure result (`:135`, `:662`, `:833`); the internal `provider_inactive` reason is not surfaced. |
| The current logs record exit 0, 306 passed, zero failures, and zero skips across all 19 files. | A deterministic PASS is not real-Pi R evidence and does not authorize WP-03/M, WP-04/Q, G-M, or G-Q. |

## WP-01 disposition and route

| Gate | Result |
|---|---|
| Closed set | PASS — same 19 files: 18 unit files plus one contracts file; no missing or extra file |
| Candidate/provenance | PASS — candidate3 `9b55649050b76feffdc4279ceaec92ac74a78686`, detached and clean at `/private/tmp/symphony-t06`; exact four-path correction delta from candidate2 and six-path total from `12fd6686`; Alfie pin and protected-WIP hash recorded in provenance |
| Deterministic producer | PASS — 18/18 + 1/1 files; 266/266 + 40/40 tests; `306/306`; exit `0` and `0`; zero failures/skips |
| Estimate correction | PASS — `303 + 5 = 308` superseded by actual `303 + 3 = 306`; candidate3 added three focused net cases; no missing or extra file |
| WP-02 | **READY** for exactly one complete five-file non-destructive real-Pi attempt, serially and without retry |
| Later gates | Not run — no WP-02, WP-03, WP-04, quality gate, integrated review, or Supervisor consultation |
