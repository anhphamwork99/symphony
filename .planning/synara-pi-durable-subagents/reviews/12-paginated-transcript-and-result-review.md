# 12 — Authorized paginated transcript and result view — review

**Date:** 2026-08-19
**Reviewed change:** Symphony `8473fd96` (`feat(pi-subagents): authorized
paginated transcript and result view (issue 12)`), fixed point `ae8e9c19`.
**Review method:** matt-code-review two-axis review — one Standards sub-agent
(documented repo standards + Fowler smell baseline) and one Spec sub-agent
(ticket 12 ACs, Testing Strategy Decision 0001, approved Testing Seams),
run in parallel.

## Standards

**Documented-standard violations**

1. Duplicate truncation logic (`slice(0, max-1) + "…"` excerpt helper) now in
   four Pi-subagent files (repo AGENTS.md Maintainability).
2. Verification deferred — the implementation report said "see review
   evidence" without recording the pass.

**Baseline smells (judgement calls)**

- Stale-closure initial-load effect in the dialog (suppressed exhaustive-deps).
- `summaryTruncated` heuristic: length >= current config cap (false positive
  at exact cap; config drift).
- Dead contract literal `pi_subagent_transcript_page_truncated` (declared,
  pinned by contracts test, never emitted).
- fs reader re-streams from byte 0 per page; deep cursors re-charge the
  1 MiB budget (Performance-first priority).
- `parseEntry` returned `index: -1` placeholder overwritten by the caller.

## Spec

**Missing/partial**

1. T12-AC1 partial — no caller identity in the read path; only thread/project
   cross-check (executionId correlation integrity, not authorization).
2. T12-AC6 approved seam — "available transcript for an orphaned execution"
   is structurally impossible (orphaned rows have no persisted transcriptRef);
   the test proved the structurally-possible paths instead.
3. AC4 minor — running executions cannot continue a truncated summary.

**Implemented-but-wrong**

1. Deep-cursor reads bounded per request but re-scan from byte 0 (cheap
   budget abuse).
2. Truncation inference unreliable (exact-cap false positive, config drift).
3. All-corrupt stretch loops Load-more on empty pages.

**Testing-governance deviations**

- wsRpc handler wiring + expensive-read classification had no test at the
  nearest public boundary (Decision 0001 substitutions clause).

**Scope creep:** the unused `pi_subagent_transcript_page_truncated` literal.

## Remediation (same day, all findings closed)

| Finding | Fix                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1/AC1  | `authorizeCaller` hook wired in wsRpc via `McpSessionAuthority.resolveForThread` (Decision 21); foreign-authority denial + owning-authority read proven in boundary tests |
| S3      | fs reader reports `budgetExhausted`; page returns `pi_subagent_transcript_page_truncated` on a non-continuable empty page (also retires the dead literal — T3)            |
| S4      | `summaryTruncated` = at-cap AND ends with ingest ellipsis marker                                                                                                          |
| S5      | dialog stops Load-more after a zero-entry page; browser test added                                                                                                        |
| S2/AC6  | documented honest limitation; orphaned + succeeded twin state-mapping test                                                                                                |
| T1      | shared `piSubagentBoundedText.ts` adopted by all five excerpt sites                                                                                                       |
| T2      | verification results recorded in the ticket report                                                                                                                        |
| T4      | dialog effect keys on `loadedExecutionId` state (no suppression)                                                                                                          |
| T5      | `parseEntry(line, index)`                                                                                                                                                 |
| T6      | `piSubagentReadDenialToWsRpcError` pure seam + admission classification test                                                                                              |

## Verification (clean tree at remediation)

- Server focused: read boundary 10/10, reader 9/9, terminal lifecycle,
  restart reconciliation, repository, card surface, admission — 71/71
  (post-cleanup 18/18 on the two ticket-owned files).
- Web: dialog browser 5/5; strip component 6/6.
- Full suites + typecheck + fmt + lint recorded in the ticket report.

**Verdict: PASS after remediation.**
