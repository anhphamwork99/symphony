# WP-01 — Decision 0008 AC / diagnostic matrix

**Current evidence only:**
`WP-01-decision0008-deterministic.log` (18/18 files, 263/263 tests, exit 0)
and `WP-01-decision0008-contracts.log` (1/1 file, 40/40 tests, exit 0).
Aggregate: **19/19 files, 303/303 tests, zero failures, zero skips**.
The matrix does not cite or overwrite any prior WP-01 log or matrix.

The rows below are D-class deterministic evidence from those two current logs.
R-class real-Pi evidence remains a separate WP-02 concern.

## Decision 0008 — post-await retirement and replacement classification

| Situation / case | Positive expected result | Failure or diagnostic boundary | Evidence anchor |
|---|---|---|---|
| Same registration retires before control acceptance | `unavailable`; no value and not `stale_ignored` | Ordinary terminal retirement must not be conflated with identity replacement | `piSubagentLiveLifecycleContainment.test.ts:333` |
| Same registration retires after provider acceptance and returns successfully | `applied`; accepted value is preserved | No reconstruction, second action, or relabeling as stale | `:363` |
| Same registration retires after acceptance and response throws | `outcome_unknown`; no success claim | Accepted effect may have happened; no retry or guessed zero-effect claim | `:392` |
| Same registration retires after acceptance and response is lost | `outcome_unknown`; no value exposure | Response loss after acceptance is not `unavailable` or success | `:415` |
| Same registration retires after acceptance and explicit timeout is marked | `outcome_unknown`; no value exposure | Timeout after acceptance cannot be converted to stale or success | `:439` |
| Tuple/registration is replaced while an accepted response is in flight | `stale_ignored`; late result cannot mutate current state | Replacement is identity failure, not ordinary retirement; replacement remains usable | `:463` |
| Session is cleared while a replacement session remains live | Old response is `stale_ignored`; replacement remains `applied` | No old-session route restoration, replay, or cross-session mutation | `:499` |
| Same registration retires before acceptance and then throws | `unavailable`; no value exposure | Bare pre-acceptance failure is not inferred to be timeout or accepted effect | `:540` |
| Stale equal-tuple handle attempts to retire replacement | Retirement returns false; replacement remains live and applies | Retirement is by exact registration identity, not tuple equality alone | `:783` |

These rows are the new Decision 0008 retirement/replacement positive and failure
coverage. They preserve the binding distinction: ordinary same-registration
retirement may return `applied` after acceptance, while replacement,
invalidated identity, or session mismatch returns `stale_ignored`.

## T06-AC2 — public execution identity and bounded surfaces

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| Exact tuple capture/activation applies one live observation; sibling sessions and equal public tuples remain isolated (`:25`, `:53`). Durable execution reads and terminal/outbox paths are covered by the current 19-file collection. | Missing, mismatched, inactive, or disposed routes return bounded `pi_subagent_live_lifecycle_unavailable` without provider dispatch (`:92`). Internal provider text is not exposed (`:824`). |
| Current unit log proves the complete 18-file deterministic leg; current contracts log proves the 40 contract assertions. | Current logs show zero skips, so the AC2 deterministic leg was not silently omitted. Real-Pi control/reconnect remains pending WP-02 and is not claimed here. |

## T06-AC3 — lifecycle, terminal ordering, cancellation, and truthful diagnostics

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| The current 263-test unit leg includes cancellation, watchdog escalation/sweep, teardown, terminal lifecycle, and completion outbox files; Decision 0008 same-registration accepted retirement is `applied` (`:363`). | Pre-acceptance retirement is `unavailable` (`:333`, `:540`); accepted throw/loss/timeout is `outcome_unknown` (`:392`, `:415`, `:439`). These outcomes do not invent terminal truth or retry. |
| Observation and control paths distinguish acceptance, timeout markers, and response loss (`:135`, `:267`, `:662`, `:708`). | An unmarked return/throw cannot become accepted success; provider/internal reasons are suppressed (`:594`, `:824`). |

## T06-AC4 — restart/reconnect, owner truth, and no automatic replay

| Positive evidence | Material failure / diagnostic evidence |
|---|---|
| The current unit leg includes restart reconciliation, startup recovery order, resume coordination, WS snapshot/live stream, and execution-card surface coverage. | Replacement/session-clear responses are stale and cannot restore an old route (`:463`, `:499`). Missing or inactive routes stay bounded unavailable (`:92`). |
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
| Current unit coverage includes bridge, read boundary, watchdog, teardown, terminal, and live-containment diagnostic paths; current contracts coverage validates the shared diagnostic contract. | Missing/disposed/provider-inactive routes use the stable unavailable code (`:92`); accepted post-retirement failure shapes use stable outcome-unknown (`:392`, `:415`, `:439`); replacement uses stable stale-ignored (`:463`, `:499`). |
| The public result surface remains bounded and excludes internal/provider text (`:824`); pure control must cross the explicit provider-acceptance marker (`:594`). | Bare throws do not invent timeout or acceptance; no provider text leaks through a failure result (`:135`, `:662`, `:824`). |
| The current logs record exit 0, 303 passed, zero failures, and zero skips across all 19 files. | A deterministic PASS is not real-Pi R evidence and does not authorize WP-03/M, WP-04/Q, G-M, or G-Q. |

## WP-01 disposition and route

| Gate | Result |
|---|---|
| Closed set | PASS — same 19 files: 18 unit files plus one contracts file; no missing or extra file |
| Candidate/provenance | PASS — candidate2 `2afef48b008527685658801d8f0d84c79e24827d`, detached and clean; exact four-path delta from `12fd6686`; Alfie pin and protected-WIP hash recorded in provenance |
| Deterministic producer | PASS — 18/18 + 1/1 files; 263/263 + 40/40 tests; `303/303`; exit `0` and `0`; zero failures/skips |
| Estimate correction | PASS — `296 + 6 = 302` superseded by actual `296 + 7 = 303`; no missing or extra file |
| WP-02 | **READY** for exactly one complete five-file non-destructive real-Pi attempt, serially and without retry |
| Later gates | Not run — no WP-02, WP-03, WP-04, quality gate, integrated review, or Supervisor consultation |
