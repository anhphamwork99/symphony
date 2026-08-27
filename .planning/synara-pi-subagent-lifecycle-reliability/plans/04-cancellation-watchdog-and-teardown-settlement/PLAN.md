# Ticket 04 Plan — cancellation, watchdog, and owned teardown retry settlement

**Plan state:** completed — Ticket 04 accepted; Ticket 05 routed as the sole `ready-for-planning` frontier

**Authoritative router baseline:** Symphony `83620ab07760ac45cdf314a4d0df8d96f83a1300`.

**Execution-start provenance rule:** At planning time, repository HEAD was `03b64d4122483e6284a6fa3c47c8203ec0d73e77`; the only committed delta from router baseline `83620ab07` was unrelated Synara Whiteboard planning. Re-record HEAD at execution start and stop if `83620ab07..HEAD` changes any Ticket 04 production, contract, test, manifest, or lifecycle-planning authority path.

**Grounded evidence:** accepted scout trace `/tmp/scout-report-04-cancellation-watchdog-teardown-micro.md`, spot-checked by the main agent; Ticket 04 issue; Project Home; local Decision 0006; inherited durable-subagents Decisions 0025, 0027, 0028, 0033, and 0034.

**Controlled provider:** Alfie `3fe340b401ca86bcbe8b55abd4de107e1d93482e`, `@alfie/pi-subagents@0.15.0-alfie.6`; Pi SDK `@earendil-works/pi-coding-agent@0.83.0`.

## 1. Objective and planning conclusion

Close T04-AC1–T04-AC5 by freezing and reporting criterion-level evidence for the already-implemented cancellation, watchdog, owned-teardown, diagnostic, and replay behavior. The grounded trace found no open source defect and no material design decision.

**No production, contract, migration, configuration, package, lockfile, Alfie, or test-source change is initially authorized.** This is an evidence-first plan. A failing criterion does not authorize ad-hoc repair; it activates the defect challenge in §9.

## 2. Binding invariants

1. Durable authorization and the exact current `(executionId, attemptId, generation, providerSessionInstance)` route are resolved before provider access.
2. Cancellation intent is journal-first at sequence 90. Sequence 92 settles only from an accepted child acknowledgement or accepted owner-death evidence.
3. Watchdog sequences 70–74 are bounded, observable, non-terminal, and non-fencing.
4. Teardown request 75 is journal-first. Outcome 76 is proven, 77 is survivors, and 78 is owner-unproven.
5. Only a committed proven-76 outcome may atomically settle `cancelled` and advance the generation fence.
6. The teardown authority is only the current exact, opaque, live child-owner endpoint. No parent fallback, Symphony PID discovery/signalling, replay, reconstruction, bootstrap, automatic Resume, migration, new lifecycle band, or fabricated cancellation is allowed.
7. `cleanup_uncertain`, `survivors`, and `owner_unproven` remain immutable non-terminal evidence and retry inputs.
8. Graceful terminal and accepted graceful cancellation paths never invoke destructive teardown.
9. Deterministic CI evidence is authoritative. Destructive real-Pi remains isolated/manual under Decisions 0028 and 0034; this plan neither requires nor claims a new destructive run.
10. Ticket-level independent review and Ticket-level Supervisor acceptance are intentionally omitted. The Project Home reserves one integrated project review and exactly one Supervisor final-acceptance consultation for the complete multi-ticket project.

## 3. Plan-persistence transaction and routing

Persist the four plan files in this directory, then make only these routing edits:

- `../../issues/04-cancellation-watchdog-and-teardown-settlement.md`
  - `Status: blocked` → `Status: ready-for-agent`;
  - replace the stale pre-Ticket-03 blocker text with: `Dependencies: Ticket 03 accepted; inherited Decisions 0021–0034, DG-4, and this evidence-first plan remain binding`;
  - replace `Implementation: forbidden while blocked` with: `Execution authorization: evidence-only WPs below; no source/test remediation is authorized without the §9 challenge/replan gate`.
- `../../PROJECT.md`
  - keep Ticket 04 the sole frontier;
  - change Ticket 04 from `ready-for-planning — sole frontier` to `ready-for-agent — sole frontier`;
  - update the routing narrative to say that the accepted plan authorizes evidence execution only and initially authorizes no source change;
  - keep Tickets 05–06 blocked and keep the integrated review/Supervisor reservation unchanged.

Recommended plan-persistence commit:

```text
docs(planning): plan Ticket 04 cancellation settlement
```

### Exact plan-persistence write set

- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/PLAN.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-01-focused-deterministic-evidence.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-02-controlled-provider-and-implementation-report.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/plans/04-cancellation-watchdog-and-teardown-settlement/WP-03-ticket-closure-and-routing.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/issues/04-cancellation-watchdog-and-teardown-settlement.md`
- `.planning/synara-pi-subagent-lifecycle-reliability/PROJECT.md`

No other path may be staged in this transaction.

## 4. Serial dependency graph

```text
plan persistence + Ticket 04 ready-for-agent
  └──> WP-01 focused deterministic evidence
        └──> WP-02 controlled-provider disposition + Implementation Report
              └──> WP-03 Ticket 04 closure + route Ticket 05
```

The graph is strictly serial. No WP is parallel-safe because WP-02 consumes WP-01's frozen evidence and WP-03 consumes the completed report.

## 5. Work packages

| WP | Outcome | Initial source authorization |
|---|---|---|
| [WP-01](WP-01-focused-deterministic-evidence.md) | Frozen candidate, deterministic T04 matrix, failure/diagnostic evidence | none |
| [WP-02](WP-02-controlled-provider-and-implementation-report.md) | Controlled-Alfie provenance, honest non-destructive real-Pi disposition, complete Implementation Report | none |
| [WP-03](WP-03-ticket-closure-and-routing.md) | Ticket 04 accepted only from passing evidence; Ticket 05 becomes sole ready-for-planning frontier | none |

## 6. Acceptance traceability

| Criterion | Owning WP(s) | Existing concrete tests |
|---|---|---|
| T04-AC1 | WP-01, WP-02 | `piSubagentCancellationCoordinator.test.ts` (journal before dispatch; replay idempotency; stale/mismatched acknowledgement; owner-death conjunction; dispatch failure/timeout stays cancelling); `ProviderCommandReactor.test.ts` cancellation routing; conditional non-destructive `piSubagentCancellationAcceptance.test.ts` |
| T04-AC2 | WP-01, WP-02 | `piSubagentWatchdogEscalation.test.ts` (70–74, terminal windows, timeout/handoff, non-terminal replay); `piSubagentWatchdogSweep.test.ts`; `piSubagentExecutionCardSurface.test.ts`; conditional non-destructive `piSubagentWatchdogAcceptance.test.ts` |
| T04-AC3 | WP-01, WP-02 | `piSubagentProcessTeardown.test.ts` (75 before dispatch; 76 proof/fence; 77 survivors; 78 owner-unproven; retry escalation; cap 16; graceful skip); `piSubagentProcessTeardownSweep.test.ts`; `piSubagentChildOwnerTeardownWiring.test.ts`; `piSubagentTeardownWiring.test.ts`; teardown slice of `piSubagentBridge.test.ts` |
| T04-AC4 | WP-01, WP-02 | cancellation failure cases; watchdog persistence/stage diagnostic cases; teardown persistence/thrown/timeout/malformed/mismatched owner cases; `piSubagentLiveLifecycleContainment.test.ts` unavailable/outcome-unknown/stale classification |
| T04-AC5 | WP-01, WP-02 | graceful cancel/terminal skip in `piSubagentProcessTeardown.test.ts`; duplicate cancel/watchdog/teardown sweeps; survivors→proven retry; already-fenced replay; retired/cleared late-response cases in `piSubagentLiveLifecycleContainment.test.ts` |

WP-03 performs the final matrix completeness check for every criterion; it does not create new evidence.

## 7. Verification policy

- Commands are run from `apps/server` where stated.
- Use `bun run`; never use `bun test`.
- Manifest self-check: `apps/server/package.json` maps `bun run test` to `node scripts/run-tests.ts`. That orchestrator ignores positional file filters and runs the complete unit project plus every wallclock manifest entry. Therefore `bun run test <focused files>` is not a focused command and must not be represented as one.
- Focused verification uses the repository-pinned Vitest CLI through `bun run ../../node_modules/vitest/vitest.mjs ...`; the package-wide command, if separately authorized, is exactly `bun run test`.
- Capture the producer command's exit status with `set -o pipefail` and `${PIPESTATUS[0]}`; a green `tee` must never mask a failed test command.
- Deterministic evidence must include both success behavior and failure/diagnostic surfaces.
- Controlled-Alfie or non-destructive real-Pi runs require an exact clean controlled checkout, the pinned version, isolated temporary state, bounded tests, and cleanup. Their absence is recorded honestly and does not create a destructive-manual requirement when production seams are unchanged.
- No destructive manual run may be required, implied, or claimed without an owner-operated run record containing environment and operator identity.
- `bun fmt`, `bun lint`, and `bun typecheck` are not authorized by this plan. They may run only after explicit current-session owner authorization. If authorized, run once from repository root, preserve exit codes/counts, and do not modify or stage unrelated owner files. If not authorized, report `not run — no current-session authorization`; because this is an evidence/docs-only ticket, do not silently turn that into a source-remediation gate.

## 8. Git and workspace safety

Known unrelated owner work at planning time:

- `apps/web/package.json`
- `apps/web/src/main.tsx`
- `bun.lock`

These paths are excluded from every Ticket 04 write/stage/commit set. Also exclude the committed Whiteboard planning delta after `83620ab07` from Ticket 04 claims.

Required controls before each commit:

```bash
git status --short
git diff --check
git diff --cached --name-only
git diff --cached -- apps/web/package.json apps/web/src/main.tsx bun.lock
```

Use explicit `git add <allowlisted-path>...`; never use `git add .` or `git add -A`. The final command above must print no staged diff. Stop if any staged path is outside the active WP write set.

## 9. Conditional defect branch — mandatory stop/challenge/replan

A focused failure is classified before action:

1. **Environment/harness failure:** preserve command, exit code, stderr, candidate SHA, and environment facts; return `blocked`; do not edit source.
2. **Criterion-level product/test defect:** preserve the minimal failing test and observed invariant breach; return `challenge`; do not edit source, tests, contracts, manifests, migration, or Alfie.
3. **Authority conflict:** if a fix would add/reinterpret bands, cleanup authority, PID access, fallback, replay, Resume, migration, API, compatibility, or destructive automation, return `challenge` and request an explicit governing decision.

Only a newly persisted amended plan may authorize remediation. It must name the failed T04 criterion, exact source/test write set, callers/impact, preserved invariants, regression command, rollback, and whether controlled-provider re-pin is required. None of the WPs in this plan authorizes such writes.

## 10. Completion and routing

Ticket 04 may close only when:

1. WP-01 passes at one frozen candidate and proves every T04 criterion's normal and material failure/diagnostic surface;
2. no Ticket 04 source, contract, migration, config, manifest, lockfile, or Alfie delta exists;
3. WP-02 verifies controlled-provider provenance or records a precise blocker; any non-destructive real-Pi rerun is truthfully separated from deterministic evidence; no destructive run is claimed;
4. the issue Implementation Report is complete and cites commands, exits, evidence paths, candidate, provenance, AC matrix, diagnostics, manual-run disposition, and residual uncertainty;
5. workspace/staging safety passes and unrelated owner changes remain excluded;
6. no integrated project review or Supervisor consultation is consumed.

On completion, WP-03 sets Ticket 04 to `accepted`, changes Ticket 05 to `ready-for-planning — sole frontier`, keeps Ticket 06 blocked, and preserves the integrated-review/Supervisor reservation. This advances planning authority only; it does not claim the complete project is accepted.

## 11. Reopening conditions

Replan on any Ticket 04 seam change after the frozen candidate, failed criterion, dirty/unpinned controlled Alfie, nondeterministic evidence that cannot be reproduced deterministically, a request for destructive automation, or any proposed change to the accepted identity, band, proof, owner, fallback, replay, Resume, migration, or governance contracts.

## 12. Completion record

- WP-01 completed at evidence commit
  `bab07af82d31c7fc128fd561fc0dc06eed0f7300`: frozen candidate
  `08b65ebb466470d71814c4467d74e68f43991138`, 11/11 files, 177/177
  tests, producer exit 0.
- WP-02 completed at report commit
  `e160ccd8c6bfbd9839b67618ffdbaf7d85ee8e11`: controlled Alfie
  `3fe340b401ca86bcbe8b55abd4de107e1d93482e` /
  `@alfie/pi-subagents@0.15.0-alfie.6`, clean checkout, all fixture hashes
  matched; non-destructive real-Pi cancellation 2/2 PASS (12.01 s) and
  watchdog 2/2 PASS (6.62 s), producer exit 0.
- T04-AC1–T04-AC5 PASS from the recorded evidence. The
  `stopProviderSession` failed-stop named-case gap remains an explicit
  residual and does not defeat AC4.
- No Ticket 04 production, test, contract, manifest, lockfile, migration,
  configuration, or Alfie change exists from the frozen candidate through
  closure.
- Destructive manual real-Pi was not run or claimed.
- The explicitly authorized final gate passed: `bun fmt` exit 0 (3,111
  files), `bun lint` exit 0 (0 warnings/0 errors; 2,658 files; 149 rules),
  and `bun typecheck` exit 0 (7/7 packages; 13.434 s) with non-failing Vite
  deprecation warnings and two TS44 advisory messages recorded.
- The three unrelated owner files remained byte-identical, modified-unstaged,
  and excluded. Ticket-level review/Supervisor acceptance remained unused;
  the integrated project review and exactly one Supervisor final acceptance
  remain reserved.
- Ticket 05 is the sole `ready-for-planning` frontier; Ticket 06 remains
  blocked.
