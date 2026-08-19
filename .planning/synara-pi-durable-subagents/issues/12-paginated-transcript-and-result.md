# 12 — Authorized paginated transcript and result view

**What to build:** A user can open a managed execution's result and transcript
from its card and read bounded pages by cursor. Every read enforces existing
project/thread authority; knowing an `executionId` grants no access. Large
results show stable truncation diagnostics and continue through the transcript
surface rather than lifecycle events or WebSocket push.

**Blocked by:** 11 — Reconnectable execution card.

**Status:** ACCEPTED — Decision 0020 (Supervisor final acceptance 2026-08-19,
fixed point Symphony `8473fd96` + `0094eaf9`); all criteria checked off

- [x] **T12-AC1:** Result and transcript reads authorize the current user
      against the execution's project and thread before returning content.
- [x] **T12-AC2:** Unknown-ID knowledge or access to a different project/thread
      cannot read metadata, result, transcript, or filesystem references.
- [x] **T12-AC3:** Retrieval is cursor/page based with bounded page and response
      sizes; no unbounded read path is exposed.
- [x] **T12-AC4:** A bounded result summary that omits content reports a stable
      truncation diagnostic and a retrievable continuation.
- [x] **T12-AC5:** Full transcript or result content never appears in lifecycle
      events, execution snapshots, metrics, default logs, or WebSocket push.
- [x] **T12-AC6:** Transcript availability is never interpreted as evidence that
      the execution is currently alive.
- [x] **T12-AC7:** Missing, expired, corrupt, or unavailable transcript evidence
      produces stable diagnostics without changing execution outcome.

## Testing Seams

**Approval status:** Approved — owner approval in the ticket-breakdown review
on 2026-08-16.

- **T12-AC1, T12-AC2, T12-AC3, T12-AC7:** Authorized transcript-read command
  boundary with project/thread, pagination, missing, and corrupt fixtures.
- **T12-AC3, T12-AC4:** Browser result/transcript view boundary with large
  output and continuation fixtures.
- **T12-AC5:** Lifecycle, snapshot, and WebSocket contract suite proving full
  content fields are excluded.
- **T12-AC6:** Execution state mapping test using an available transcript for
  an orphaned execution.

## Implementation Report

**Status:** implemented; independent two-axis review remediated (see
`reviews/12-paginated-transcript-and-result-review.md`); awaiting final
acceptance.
**Date:** 2026-08-19 (implementation `8473fd96`; review remediation follow-up
commit).

### Review remediation (two-axis review 2026-08-19)

Both review reports are persisted at
`reviews/12-paginated-transcript-and-result-review.md`. Remediations:

- **S1/AC1 (caller identity)** — the WS handler now wires an
  `authorizeCaller` hook through the existing Decision 21 machinery:
  connections holding an MCP session authority may only read executions
  whose parent thread is bound to the SAME authority
  (`McpSessionAuthority.resolveForThread`); owner/browser connections rely
  on the trusted transport boundary, identical to `getThreadDetailSnapshot`
  which already exposes execution cards. Boundary test proves owning-authority
  read + foreign-authority denial.
- **S3 (deep-cursor scan)** — the fs reader reports `budgetExhausted` when the
  page byte budget is spent skipping lines before the cursor; the page then
  returns the stable `pi_subagent_transcript_page_truncated` diagnostic on a
  non-continuable empty page instead of re-charging the budget per retry.
  (Also retires the previously-unused literal — it now has exactly one
  emitting code path.) Reader test covers it through the injectable seam.
- **S4 (truncation inference)** — `summaryTruncated` now requires the summary
  to be at the cap AND end with the ingest ellipsis marker, so an
  untruncated summary that happens to equal the cap no longer claims
  truncation. Fixture fixed to exercise true ingest truncation.
- **S5 (empty-page loop)** — the dialog stops offering Load-more after a page
  that returns zero entries while claiming more (all-corrupt stretch / page
  budget exhaustion). Browser test covers it.
- **T1 (duplicated truncation logic)** — extracted shared
  `piSubagentBoundedText.ts` (`truncateWithEllipsis`, `boundedOptionalString`);
  the new read files AND the pre-existing terminal coordinator, restart
  reconciliation, and repository excerpt helpers now all use it.
- **T3 (dead literal)** — `pi_subagent_transcript_page_truncated` now has its
  emitting path (see S3).
- **T4 (stale closure)** — the dialog's initial-load effect now keys on an
  explicit `loadedExecutionId` state (no suppressed lint, no ref reads);
  switching cards always reloads.
- **T5 (`index: -1` placeholder)** — `parseEntry(line, index)` assigns the
  cursor index at construction.
- **T6 (untested WS wiring)** — denial mapping extracted as the pure
  `piSubagentReadDenialToWsRpcError` seam with boundary assertions, and the
  expensive-read admission classification is pinned by a
  `wsRequestAdmission` test.
- **S2/AC6 (orphaned + available-transcript seam)** — recorded as an honest
  data-model limitation (see Known notes): the structurally-possible
  orphaned-read path is tested (stable missing diagnostic, state unchanged)
  and the available-transcript-never-reinterprets-state property is pinned
  on the succeeded twin in the same test.

### Solution shape

Ticket 12 adds a production authorized read surface over the durable
managed-execution aggregate and the extension-owned JSONL transcript
artifact. No new decider commands, lifecycle events, projection tables, or
WebSocket push channels — the reads are RPC replies on the existing WS
feature surface:

1. **Contracts** (`packages/contracts/src/piSubagents.ts`, `orchestration.ts`,
   `ws.ts`, `rpc.ts`, `ipc.ts`): two new orchestration WS methods —
   `orchestration.readPiSubagentResult` and
   `orchestration.readPiSubagentTranscript` — with bounded response schemas
   `PiSubagentResultReadResult` (bounded summary excerpt ≤4000 chars,
   `summaryTruncated`, `pi_subagent_result_truncated` diagnostic,
   `transcriptRef` continuation pointer) and `PiSubagentTranscriptReadResult`
   (bounded `PiSubagentTranscriptEntry[]`, `nextCursor`, `hasMore`,
   `skippedCorruptEntries`, stable diagnostics). Page bounds:
   `PI_SUBAGENT_TRANSCRIPT_PAGE_DEFAULT_ENTRIES = 50`, `MAX = 200`, per-entry
   excerpt cap 4000 chars, per-page byte ceiling 1 MiB. New diagnostic
   literals: `pi_subagent_read_denied`, `pi_subagent_result_truncated`,
   `pi_subagent_transcript_missing`, `pi_subagent_transcript_unavailable`,
   `pi_subagent_transcript_corrupt`, `pi_subagent_transcript_entry_truncated`.
2. **Transcript reader** (`apps/server/src/provider/piSubagentTranscriptReader.ts`):
   file-backed JSONL page reader behind the opaque `transcriptRef`. Cursor =
   zero-based entry (line) index; reads one lookahead line to detect
   `hasMore`; corrupt lines are skipped, counted, and index-stable; byte
   ceiling bounds every file read; missing/unavailable artifacts map to
   stable failure kinds. Injectable `readLines` seam for deterministic tests.
3. **Authorized read boundary** (`apps/server/src/provider/piSubagentExecutionReadService.ts`):
   every read resolves the execution from durable truth, then verifies the
   parent thread EXISTS in the projection read model AND its trusted
   `projectId` matches the execution row. Unknown id → `not_found`; missing
   thread or project mismatch → `denied` — both payload-indistinguishable,
   no metadata/result/transcript/filesystem reference is returned (AC2).
   Reads never write execution state; `observedState` is echoed verbatim from
   the durable aggregate (AC6). Transcript read failures are STABLE READ
   DIAGNOSTICS on empty pages (`pi_subagent_transcript_missing`/
   `_unavailable`), never outcome changes (AC7). A stored summary whose
   length meets the ingest cap reports `summaryTruncated` +
   `pi_subagent_result_truncated` with the transcript continuation (AC4).
4. **WS wiring** (`apps/server/src/wsRpc.ts`, `wsRequestAdmission.ts`):
   both methods mount on `AdmittedWsFeatureRpcGroup` mapping denials to
   `WsRpcError` codes `PI_SUBAGENT_EXECUTION_NOT_FOUND` /
   `PI_SUBAGENT_READ_DENIED`, classified `expensive-read` (bounded 2-concurrent
   admission). Wired into `NativeApi.orchestration` + `wsNativeApi.ts`.
5. **Web view** (`apps/web/src/components/chat/PiSubagentResultTranscriptDialog.tsx`):
   per-execution dialog opened from the execution card's new "View result and
   transcript" affordance (composer strip stays chrome; the dialog is a
   modal). Cursor-paged "Load more", truncation/unavailable diagnostics, and
   the durable observed-state label rendered verbatim — availability is
   never liveness copy (AC6).

### Criterion evidence

| Criterion | Evidence                                                                                                                                                                                                                                                                                        | Status |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T12-AC1   | `piSubagentExecutionReadBoundary.test.ts`: authorized read resolves the execution from the REAL repository and verifies thread existence + trusted projectId before returning the bounded result                                                                                                | pass   |
| T12-AC2   | Same suite: unknown id → `not_found`; thread missing from read model → `denied`; thread under a different project → `denied` with `pi_subagent_read_denied`; no payload leak in either case                                                                                                     | pass   |
| T12-AC3   | `piSubagentTranscriptReader.test.ts`: cursor paging (7 entries / pages of 3), limit clamping (1,000,000 → 200), per-entry excerpt bound; boundary suite pages through the authorized service; dialog browser test loads pages and continues via Load more                                       | pass   |
| T12-AC4   | Boundary suite: summary stored at the ingest cap (2000) → `summaryTruncated: true`, `pi_subagent_result_truncated`, transcript continuation retrievable; dialog browser test renders the truncation diagnostic + continuation                                                                   | pass   |
| T12-AC5   | `piSubagentExecutionCardSurface.test.ts` T12-AC5 test: snapshot + thread-detail events exclude prompt/entries/resultContent; contracts suite pins card/event schemas carry no content fields; the read responses are the ONLY content-bearing surface and are bounded                           | pass   |
| T12-AC6   | Boundary suite state-mapping test: orphaned execution reads stable `pi_subagent_transcript_missing` and stays `orphaned`; succeeded execution reads its available transcript and stays `succeeded`; dialog echoes the durable state verbatim ("Orphaned", never "Running")                      | pass   |
| T12-AC7   | Reader + boundary suites: missing artifact → `pi_subagent_transcript_missing`; non-file/directory ref → `pi_subagent_transcript_unavailable`; corrupt lines skipped + counted (`pi_subagent_transcript_corrupt`) with stable indices; durable observed state unchanged after every failure read | pass   |

### Verification commands

- `bun run vitest run src/provider/piSubagentExecutionReadBoundary.test.ts src/provider/piSubagentTranscriptReader.test.ts` (apps/server) — 18 pass (incl. caller-authority, denial-mapping, budget-exhaustion)
- `bun run vitest run src/orchestration/Layers/piSubagentExecutionCardSurface.test.ts src/wsRequestAdmission.test.ts src/provider/piSubagentTerminalLifecycle.test.ts src/provider/piSubagentRestartReconciliation.test.ts src/persistence/Layers/PiSubagentExecutionRepository.test.ts` (apps/server) — 53 pass
- `bun run vitest run` (packages/contracts) — 229 pass
- `bun run vitest run --config vitest.browser.config.ts src/components/chat/PiSubagentResultTranscriptDialog.browser.tsx` (apps/web) — 5 pass
- `bun run vitest run src/components/chat/PiSubagentExecutionCardStrip.test.tsx src/piSubagentExecutionCardStore.test.ts src/storeEventReducer.test.ts` (apps/web) — 64 pass
- Full clean-tree verification at remediation commit: server suite 4716+ passed / 0 failed / 17 skipped (first pass) and re-run green after remediation; web suite 3892 passed (one transient environment flake on first run, green on re-run and in the final pass); root typecheck 7/7 tasks; `bun run fmt` clean; `bun run lint` 0 errors (pre-existing warnings only).

### Known notes / limitations

- **Orphaned executions have no persisted transcript reference.** The
  extension reports `transcriptRef` only in the terminal observation
  (Ticket 07); progress/heartbeat observations do not carry the artifact
  path. A restart-orphaned running execution therefore reads the stable
  `pi_subagent_transcript_missing` diagnostic even when its artifact still
  exists on disk — the server honestly cannot address it. Making the
  artifact addressable for non-terminal executions would require an Alfie
  extension change (observation payload carrying the output path) and is out
  of scope while Alfie is pinned at `489acd626` / `0.14.0-alfie.1`.
  Candidate follow-up for a future ticket.
- Authorization boundary reuse: the read gate reuses the repository's trusted
  project/thread columns and the projection read model, mirroring the T11
  card-boundary pattern (same trust model as `getThreadDetailSnapshot`). No
  per-thread principal model exists in wsRpc today; this ticket does not
  introduce one (consistent with the Decision 0019 assumption record).
- The dialog is projection-only; cancel still flows through the T11 durable
  command path.
