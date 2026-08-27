# Ticket 05 — restart, reconnect, Resume, projection truth, and crash diagnostics

**Status:** ready-for-agent
**Dependencies:** Tickets 02–04 accepted; local Decisions 0002/0006, applicable inherited decisions, and this evidence-first plan remain binding
**Plan:** [`../plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md`](../plans/05-restart-reconnect-resume-and-crash-diagnostics/PLAN.md)
**Execution authorization:** serial evidence-only WPs; no source/test/contract/configuration/migration/manifest/lockfile/Alfie remediation without the PLAN §9 challenge/replan gate

## Objective

Make reconnect and restart projections tell the truth about live ownership,
terminal evidence, orphan uncertainty, Resume eligibility, and crash evidence
without automatic replay.

## Acceptance criteria

- **T05-AC1:** Reconnect hydrates bounded durable execution truth and does not
  create new attempts or dispatch work.
- **T05-AC2:** Restart distinguishes recovered terminal, proven live owner, and
  owner/terminal uncertainty; orphan diagnostics explain possible side effects.
- **T05-AC3:** Late old-attempt/generation evidence is fenced, counted, and
  remains history-only.
- **T05-AC4:** Resume is explicit-only, authorized, same execution/new attempt,
  and unavailable or diagnostically rejected when provider runtime is inactive.
- **T05-AC5:** Crash diagnostics identify the lifecycle stage and evidence gap
  without inventing owner receipts, terminal exceptions, or cleanup proof.
- **T05-AC6:** No startup, hydration, reconnect, watchdog, or reconciliation
  path automatically replays or resumes side-effecting work.

## Testing seams

Restart/reconnect integration using isolated durable roots; projection snapshot
and cursor fixtures; inactive-provider Resume denial; stale-generation and
late-terminal tests; controlled real-Pi restart leg under inherited isolation;
crash diagnostic assertions with bounded safe metadata.

## Implementation Report

Evidence roots (this ticket's evidence directory, hereafter `evidence/`):
`.planning/synara-pi-subagent-lifecycle-reliability/plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/`.

### 1. Router baseline, plan commit, frozen candidate, WP commits

- Planning baseline: Symphony `fa02c58ed100242dcaab1ce2aabf0ec8d6a9cef2`.
- Plan commit: `7521b92c7` ("docs(planning): plan Ticket 05 lifecycle recovery evidence"); WP-01 froze candidate `7521b92c7cb8a614346f994e963aa379175f540b`.
- WP commits: WP-01 `4090ccee8` ("test(pi): record Ticket 05 deterministic recovery evidence"); runner correction `d12e1a2e0` ("docs(planning): correct Ticket 05 node sqlite runner") authorizing the Node producer for the production real-Pi file; this report and the controlled logs/provenance/disposition form the WP-02 evidence transaction (`test(pi): record Ticket 05 controlled recovery evidence`). `git diff --name-only 7521b92c7..HEAD -- apps packages` = 0 paths before that evidence-only transaction, so runtime/source is identical from candidate through the executed producers.
- Ticket 05 remains routed `ready-for-agent`; closure/routing to Ticket 06 belongs to WP-03.

### 2. Exact provenance and dirty/hash result

- Symphony: candidate `7521b92c7…` → current HEAD `d12e1a2e0…`, planning/evidence-only delta between them (field 1).
- Controlled Alfie: HEAD `3fe340b401ca86bcbe8b55abd4de107e1d93482e` exact; origin `https://github.com/anhphamwork99/alfie.git` exact; `git status --short` clean; `git diff` over the six contracted controlled surfaces empty; extension `@alfie/pi-subagents@0.15.0-alfie.6`; Pi SDK `@earendil-works/pi-coding-agent@0.83.0` (installed ext-local under the extension; workspace `bun.lock` pins the same version).
- Fixture hashes: all five surfaces in `apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json` match exactly (5/5 MATCH). Commands, per-surface expected/actual, and pass classification: `evidence/WP-02-controlled-provider-provenance.txt`. No reset/clean/checkout/re-pin was performed.

### 3. No-source/test/contract/configuration/migration/manifest/lockfile/Alfie delta

Zero Ticket 05 production delta: the only committed changes since the Ticket 04 closure baseline are Ticket 05 planning, routing, and evidence files; `git diff --name-only 7521b92c7..HEAD -- apps packages` is empty; working tree at report time contains only the three protected owner-WIP paths (field 14). Alfie controlled surfaces verified byte-clean (field 2). No remediation, pin change, or Alfie runtime change occurred.

### 4. Production startup composition/order

Startup recovery runs after the server is live: `recoverCompletionOutbox` → `runPiSubagentProcessTeardown` with no live-owner endpoint (band-78 `owner_unproven` evidence where applicable, kills nothing) → `reconcilePiSubagentExecutions(mode: "restart")` (`makeServerProgram`, `apps/server/src/main.ts:580-636`; order executed by `"records no-owner teardown evidence before the Ticket-10 orphan fence"`, `piSubagentStartupRecoveryOrder.test.ts:116-240`). Outbox recovery first, fence-after-evidence, no boot-time spawn/Resume/dispatch (`"T10-AC4"` zero replay row).

### 5. Reconnect isolated-root/fresh-client/card-cap/bounds/cursor evidence

Snapshot/cursor hydration via `makeCursorSafeSnapshotLiveStream` + `ProjectionSnapshotQuery` card reads (full matrix in `evidence/WP-01-ac-seam-diagnostic-matrix.md`, T05-AC1 row): durable card hydration with no in-memory Agent row; fresh subscriber over the same isolated durable state; card cap 64 with oldest-overflow omission; progress/diagnostic 512-char caps; prompt/raw `progressJson`/full transcript/result/`agentId`/PID exclusion; exact-gap cursor replay; excessive/ahead/deleted-subject/unbounded-attach-gap resnapshot fallbacks with `ORCHESTRATION_RESNAPSHOT_REQUIRED`; all work-creation counters zero. Real-Pi reconnect-class truth additionally carried by the fresh-boot leg (field 11).

### 6. T05-AC1–AC6 evidence matrix

| AC | Named evidence (current paths / executed tests) |
|---|---|
| AC1 reconnect bounded, no dispatch | `evidence/WP-01-ac-seam-diagnostic-matrix.md` T05-AC1 row; `evidence/WP-01-focused-deterministic.log` (9 files/118 tests, exit 0); structural counters in `evidence/WP-01-no-replay-structural-proof.md` §3 |
| AC2 restart terminal/live/orphan truth | WP-01 rows: startup-order `:116-240`, `"T10-AC1"` orphan `:132`, `"T10-AC2"` terminal restore `:352`, `"T10-AC3"` live-owner refresh `:233`; controlled real-Pi: `evidence/WP-02-restart-acceptance.log` ("T10-AC3/AC1/AC5…", exit 0) and Leg 3 fresh boot orphan fence `generation 1→2` + `pi_subagent_owner_loss_orphaned` in `evidence/WP-02-production-restart-leg.log` |
| AC3 stale evidence fenced/counted/history-only | WP-01 rows `"T07-AC4"` `:266`, `"T10-AC5"` `:437`, `"T14-AC2"` `:323`, `"T08-AC6"` `:571`, teardown stale row `:953`; real-Pi fenced-terminal class executed inside `evidence/WP-02-restart-acceptance.log`; Leg 3 seam note records why a late real old-generation terminal cannot be induced post-disposal (see `evidence/WP-02-nondestructive-real-pi-disposition.md`) |
| AC4 explicit authorized Resume / inactive denial | WP-01 coordinator/provider matrix (T05-AC4 row) incl. structural ProviderService `allowRecovery: false` → exact inactive-runtime message before adapter; controlled real-Pi: `evidence/WP-02-resume-acceptance.log` ("T14-AC1/AC4/AC6…", exit 0) |
| AC5 crash stage/evidence-gap diagnostics | WP-01 minimum diagnostic matrix (T05-AC5 row) incl. `pi_subagent_resume_persistence_failed`, `child_start_failed`, watchdog/cleanup uncertainty, forbidden-claim guards; bounds/redaction row (512/512 caps, T11-AC1/T12-AC5 exclusions) |
| AC6 no automatic replay/Resume | `evidence/WP-01-no-replay-structural-proof.md` (six structural claims from callers/imports); real-Pi zero-effect counters in `evidence/WP-02-production-restart-leg.log`: post-restart delegations delta 0, fresh-server admissions 0, resume-requested 0, parent effects 0, outbox 0 |

No AC rests on an unexecuted command, inherited totals alone, source comments, or compile success.

### 7. Resume authorization/denial matrix (incl. exact inactive-runtime row)

Full row set in the WP-01 matrix (Required Resume matrix section); summary: active managed + orphan + gates → same `executionId`, one new attempt/generation, one sequence-80 row before one launcher (`"T14-AC1"`); duplicate idempotent (no second child); **provider inactive → `Cannot resume subagent execution '<executionId>' because the provider runtime is not active.` from ProviderService with `allowRecovery: false`, before adapter/coordinator/sequence-80/attempt/launcher — structurally unreachable effects, no bootstrap**; unmanaged/missing launcher/snapshot; unknown/not_found, non-orphaned/invalid_state, stale_generation; authorization/quota `gate_denied`; `pi_subagent_resume_persistence_failed`; post-settlement `child_start_failed` leaving an honest durable queued attempt; success `pi_subagent_resumed` with prior-attempt evidence retained. Real orphaned-execution explicit Resume executed over real Pi in `evidence/WP-02-resume-acceptance.log`.

### 8. Crash stage/evidence-gap/bounds/redaction matrix

WP-01 dynamically executes the diagnostic rows in the T05-AC5 matrix for terminal ingest/persistence/outbox delivery gaps; startup terminal recovery + stale markers; live-owner refresh and owner/terminal absence; late old-generation terminal; watchdog stage timeout and cleanup uncertainty (`T15-AC1/AC2/AC5/AC6`, never claiming stopped/cancelled from timer-only progression); teardown requested/survivors/owner-unproven/proven (`T16-AC2/3/AC4/AC5/AC7`, survivor PID cap, band 77/78); resume persistence/child-launch failures; and bounded card projection. The provider-inactive Resume row is explicitly structural: Reactor/ProviderService source order and sole-caller reachability prove denial before adapter/coordinator with zero work effects. Metadata is restricted to public identity/lifecycle fields; raw prompts, `progressJson`, transcripts/results, provider-local `agentId`, PIDs (except capped survivor evidence), commands/secrets are excluded; no owner receipt, terminal exception, or cleanup proof is invented.

### 9. Stale attempt/generation counters and history-only evidence

Stale rows are journaled/accounted and never mutate current aggregate truth: `"T07-AC4"` stale terminal ignored+counted; `"T10-AC5"` late stale events after reconciliation; `"T14-AC2"` superseded-attempt fence; `"T08-AC6"` superseded completion creates no delivery effect; teardown `recordTeardownOutcome` stale generations journal history only. Real-Pi boundary: Leg 3 prints the suite's own seam note that a late old-generation terminal cannot be induced through public WS + durable-read seams after disposing the live process — that class stays carried by the executed deterministic rows and Leg 1's real fenced-terminal coverage.

### 10. Structural no-replay proof and before/after effect counts

`evidence/WP-01-no-replay-structural-proof.md`: (1) reconciliation has no spawn/Resume/launcher/delegation dependency; (2) startup order never imports Resume; (3) snapshot/card/cursor paths read projection state only; (4) watchdog/cleanup never import Resume; (5) sole production Resume consumer is the explicit ProviderService → PiAdapter chain; (6) inactive-runtime denial precedes adapter access. Executed before/after counters: WP-01 reconnect/restart work-creation deltas all zero; real-Pi Leg 3 counters pre→post: delegated 1→1, fresh-server admissions 0, resume-requested 0, parent effects 0, outbox 0→0, followUps 3→3 (the sole `modelRequests` 2→3 increase is non-delegated startup/runtime traffic; the criterion is zero NEW delegated requests).

### 11. Real-Pi commands, isolation, totals, exits, evidence class

Three authorized non-destructive controlled legs (exact commands, runners, totals, durations, exits, per-assertion mapping, and evidence-class separation in `evidence/WP-02-nondestructive-real-pi-disposition.md`; raw authoritative logs alongside):
- Restart acceptance: Bun producer, 1 passed (1), 10.74s, exit 0 — `evidence/WP-02-restart-acceptance.log`.
- Explicit Resume acceptance: Bun producer, 1 passed (1), 4.26s, exit 0 — `evidence/WP-02-resume-acceptance.log`.
- Fresh production boot (`-t "T17 slice 4 stage 5"`): Bun 1.3.12 pre-collection failure (`node:sqlite`, 0 tests, exit 1) preserved in `evidence/WP-02-production-restart-leg.log`, then the authorized supported retry with Node v24.14.1: 1 passed / 9 skipped (10), 12.18s, exit 0. Only the Node retry supplies behavioral evidence; the Bun failure is environment evidence, not a Ticket 05 behavior result and not a test failure. All legs: standalone wallclock isolation, exact controlled Alfie provenance (field 2), isolated roots/home/state/workspace/agent directories, deterministic loopback model endpoint.

### 12. Destructive manual disposition

Ticket 05 claims no new destructive zero-owned-child run. The accepted isolated manual evidence remains inherited, reserved for its sole proof purpose per PLAN §7 and inherited Decisions 0027/0033/0034; it was **not rerun and not relabeled** by WP-02. No PID enumeration, signalling, or process-tree kill was performed.

### 13. Heavyweight-check authorization/result

`bun fmt`, `bun lint`, and `bun typecheck` were **not run**: PLAN §7 reserves them for the final closure gate with explicit owner authorization in that conversation; none was given for WP-02. WP-01's deterministic suite plus the three real-Pi legs are the executed verification.

### 14. Owner-WIP preservation and staged paths

Protected owner WIP `apps/web/package.json`, `apps/web/src/main.tsx`, `bun.lock` remained modified-unstaged and byte-identical throughout: diff hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8` verified unchanged. No `git add .`/`git add -A`; nothing staged during evidence runs; the WP-02 commit stages only the allowed evidence/report/WP files (issue status untouched at `ready-for-agent`).

### 15. Ticket-level review/Supervisor activation

None. No Ticket 05 review and no Supervisor gate was consumed; the integrated project review and the single Supervisor final acceptance remain reserved for the complete Ticket 06/project candidate per PLAN §2.

### 16. Residual uncertainty, challenge, and reopening conditions

No AC failed; no challenge was raised. Residual honest boundaries: (a) the production-leg title filter covers stage 5 only (9 sibling stages skipped by design) — broader integrated real-Pi coverage belongs to Ticket 06; (b) a late real old-generation terminal is not inducible post-disposal through public seams (field 9) and that fence class rests on the executed deterministic rows plus Leg 1's real fenced-terminal coverage; (c) heavyweight checks await the closure gate; (d) closure/routing is WP-03's authority. Reopening follows PLAN §11 (measured source divergence, AC failure, provenance change, diagnostics untruthful, or a new accepted decision changing identity/restart/Resume/owner/cleanup/no-replay authority).

### 17. Proposed Ticket 06 planning frontier

Deferred to WP-03 per the WP-02 contract: no Ticket 06 routing or frontier text is proposed by this report.

## Unlock gate

Provider-bootstrap Resume, durable post-restart owner receipt, or any orphan
terminal exception requires explicit material decision; none is implied by this
ticket.
