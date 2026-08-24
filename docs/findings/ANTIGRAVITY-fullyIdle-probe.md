# Findings — Antigravity Stop `fullyIdle` qualification probe (agy 1.1.19)

- **Ngày / Date:** 2026-08-24
- **Grounded revision:** `main@fcee132d4` (docs-only WP — no code change)
- **Probe binary:** `~/.local/bin/agy`, `agy --version` = `1.1.19` (Mach-O arm64, macOS)
- **Qualifying run:** attempt 6 of 6 — one `agy` process (PID 71476), exit 0, wall time 37.52 s, model `gemini-3.7-flash-high`
- **Authoritative upstream contract:** <https://antigravity.google/docs/hooks.md> — the Stop hook input carries `fullyIdle`; decision `"continue"` re-enters the agent loop
- **Related local context:** `docs/findings/RECAP-antigravity-layer.md` (confirmed gap §4: background jobs outliving turn settlement), `.planning/synara-antigravity-terminal-recovery/` (accepted terminal-recovery architecture and the `SYNARA_ANTIGRAVITY_*` env prefix convention)
- **Provenance / sanitization:** sanitized probe evidence (`GATE_ANALYSIS.md`, `hooks.ndjson`, liveness log, `run_summary.txt`) was captured 2026-08-24 in an orchestrator-owned temp evidence directory that is **ephemeral**; this document is the durable record. The evidence logs contain only sanitized fields (event name, timestamps, PIDs, `executionNum`/`invocationNum`/`stepIdx`, `terminationReason`, `fullyIdle`, `modelName`, `waitMsBeforeAsync`). No auth tokens, no conversation IDs, and no transcript/prompt content are reproduced in this document.

## 1. Verdict

**Qualified.** On `agy 1.1.19` print mode, the Stop hook's `fullyIdle` flag is a reliable aggregate signal for "background work still running", and the documented `"continue"` decision keeps the same process alive until background work finishes. All seven qualification gates (G1–G7) passed on a single bounded run. This qualifies the *aggregate* Stop/`fullyIdle` contract only — see §6 for what it does **not** establish.

## 2. Fixture and bounded command shape (no secrets)

Two scratch dirs (both `mktemp`-style, disposable):

- `TMPWS` — the task workspace (cwd). Sentinel files land here.
- `HOOKWS` — the hook carrier workspace. `HOOKWS/.agents/hooks.json` registers three command hooks: `PreInvocation`, `PreToolUse` (matcher `run_command`), and `Stop`. Each appends one sanitized NDJSON row to a probe log; the Stop hook answers `{"decision":"continue"}` iff `fullyIdle === false`, else `{}` (neutral).

Prompt shape (bounded, no private content): the model is told to launch exactly two background `run_command` tasks — `sleep 25; echo A > snt_a.done` and `sleep 10; echo B > snt_b.done` (WaitMsBeforeAsync 1500) — to reply `LAUNCHED` and nothing else, and it is forbidden from polling the tasks itself.

Exact command shape (no secrets, placeholders for paths/prompt):

```
cd <TMPWS> && agy --output-format json --print-timeout 3m --dangerously-skip-permissions \
  --add-dir <HOOKWS> -p "<bounded prompt>"   # run in background, capture PID
```

Outer bound: a 1 s liveness poller (checks `agy` PID alive + existence of both sentinel files) with a hard 200 s cap; `--print-timeout 3m` bounds the CLI itself. Six total attempts, each individually bounded: 1–2 fixture bring-up (flag misuse; permission denial before `--dangerously-skip-permissions`), 3–4 hook-load discovery (the `--add-dir` quirk, §5), 5 a no-gap control run (model polled tasks itself; single Stop with `fullyIdle=true`), 6 the qualifying run. Attempt logs 1–5 were removed during cleanup; only attempt 6 evidence was retained.

## 3. Gate evidence G1–G7 (timestamp ordering)

All times UTC, from `hooks.ndjson` (`ts` field) and the 1 s liveness poller. Monotonic chain for the qualifying run (PID 71476 throughout):

| # | Event | Timestamp (UTC) |
|---|---|---|
| 1 | Liveness poller start (`alive=yes`, no sentinels) | 03:30:11.340 |
| 2 | `PreInvocation` inv 0 | 03:30:15.987 |
| 3 | `PreToolUse` run_command, stepIdx 3, waitMsBeforeAsync 1500 | 03:30:20.505 |
| 4 | `PreToolUse` run_command, stepIdx 4, waitMsBeforeAsync 1500 | 03:30:22.072 |
| 5 | Stop exec 0 — `fullyIdle=false` | 03:30:25.521 |
| 6 | Stop exec 1 — `fullyIdle=false` | 03:30:31.191 |
| 7 | `snt_b.done` first observed (poll window 03:30:31.2–32.2; first `b=yes` 03:30:32.184) | 03:30:32.184 |
| 8 | Stop exec 2 … exec 8 — all `fullyIdle=false` | 03:30:34.073 → 03:30:45.046 |
| 9 | `snt_a.done` first observed (poll window 03:30:44.7–45.7; first `a=yes` 03:30:45.718) | 03:30:45.718 |
| 10 | **Stop exec 9 — `fullyIdle=true`** (last `alive=yes` sample 03:30:47.718) | 03:30:47.440 |
| 11 | Process exit detected, exit code 0 | 03:30:47.807 |

Gate-by-gate:

- **G1 — Stop with `fullyIdle=false` observed: PASS.** Stop exec 0 @03:30:25.521Z, `fullyIdle=false`, `terminationReason=NO_TOOL_CALL`; exec 0–8 all `fullyIdle=false`, `modelName=gemini-3.7-flash-high`, `error` absent.
- **G2 — `{"decision":"continue"}` returned exactly when `fullyIdle===false`: PASS.** The hook code returns `{decision:"continue"}` iff `fullyIdle===false`, else `{}`. Effect is visible in behavior — the loop re-entered and the final stdout response contained repeated `LAUNCHED` lines — and in the transcript `SYSTEM_MESSAGE` rows injected by the continuation carrying the hook's reason string (9 of 11 injections, per the sanitized transcript observations recorded in `GATE_ANALYSIS.md`; the transcript file itself was not retained, and its content is intentionally not reproduced here).
- **G3 — same `agy` process alive across Stop false → Stop true: PASS.** Every hook row (10 Stop + 13 PreInvocation + 2 PreToolUse = 25 rows) reports `parentPid=71476`; the liveness poller saw PID 71476 alive from 03:30:11.340 through 03:30:47.718, i.e. across all ten Stop events.
- **G4 — both sentinels complete: PASS.** `snt_b.done` observed 03:30:31.2–03:30:32.2 (poll interval bounds), `snt_a.done` 03:30:44.7–03:30:45.7; both files verified present in `TMPWS` with the expected 2-byte payloads (`A\n`, `B\n`).
- **G5 — subsequent Stop with `fullyIdle=true`: PASS.** Stop exec 9 @03:30:47.440Z, `fullyIdle=true` — ≈1.7 s after the poller first saw `snt_a.done` (≈2–2.8 s depending on which edge of the 1 s poll window the file actually landed). The hook returned `{}`: no probe-reason injection appears after exec 9, and the final `SYSTEM_MESSAGE` rows lack the probe marker.
- **G6 — process closes only after Stop true: PASS.** Exit detected 03:30:47.807Z (exit 0), 0.37 s after Stop exec 9 `fullyIdle=true`. The process never exited during the nine `fullyIdle=false` stops.
- **G7 — transcript/hook ordering shows no late loss: PASS.** Per the sanitized transcript observations: 28 rows interleaving `PLANNER_RESPONSE`/`SYSTEM_MESSAGE` pairs matching the PreInvocation count (13); the final `PLANNER_RESPONSE` (row 27) follows the last injected `SYSTEM_MESSAGE` (row 26); both `run_command` steps (rows 3–4, status RUNNING → background) precede all Stop events. Final stdout JSON: repeated `LAUNCHED` response, `duration_seconds` 31.7, `num_turns` 1, exit 0.

## 4. Counts as recorded

- Stop fired 10× (exec 0–9): 9× `fullyIdle=false` → `continue`; exec 9 `fullyIdle=true` → `{}` → process closed.
- PreInvocation rows: 13 (inv 0–12).
- Final stdout response text: 12 `LAUNCHED` lines; CLI-reported `num_turns=1`.

These three counts do not map 1:1 onto each other (13 invocations vs 1 initial + 9 Stop-continuations vs 12 response lines vs `num_turns=1`), and the probe did not establish the reconciliation — some loop re-entries may occur on background-task completion paths without an intervening Stop. None of the gates depend on that mapping; G1–G7 only require (and prove) that Stop false → `continue` keeps the process alive, and Stop true → `{}` lets it close.

## 5. Workspace-hook `--add-dir` loadability quirk (print mode, 1.1.19)

A `.agents/hooks.json` placed in the **single cwd workspace is not loaded** by `agy` print mode in 1.1.19 — the hooks manager logged `loaded 0 named hooks from 0 hooks.json file(s)` on every single-workspace run, including a workspace under a trusted user home directory. Registering a **second** workspace via `--add-dir <HOOKWS>` whose `.agents/hooks.json` exists makes startup load it (`loaded 3 named hooks from 1 hooks.json file(s)`). Cross-check: a historical AionUi session log (2026-08-23) shows the same deferred load — 0 hooks.json at conversation create, 1 after a workspace change.

This is a **loadability quirk of print mode, not a Stop-contract deviation**. It is why the fixture carries hooks in a separate `--add-dir` workspace (§2). Scope note for production: Synara's real hook capture loads through the Antigravity **plugin** install (`synara-capture` under the CLI's plugin dir), a different load path that demonstrably works today; this quirk does not affect it.

## 6. What this probe does NOT establish — no per-job native events

This qualification covers **only** the aggregate Stop/`fullyIdle` contract: one boolean per Stop event describing whether *all* background work is finished, plus the `continue` decision that bridges the gap. The probe observed **no per-job / per-task native lifecycle events** — there is no evidence that `agy` 1.1.19 exposes, and this document must not be read as claiming, events for individual background tasks (start/progress/completion per job). Any per-job surfacing in Synara remains a projection concern (e.g. the WP2 aggregate `turn.background-activity.changed` projection), not a native CLI capability.

## 7. Enablement policy

- **Server flag remains default OFF.** The stop-idle lifecycle is opt-in; the default is `false` (`DEFAULT_ANTIGRAVITY_STOP_IDLE_LIFECYCLE`). Nothing changes for existing installs.
- **Qualified version: `agy` 1.1.19.** The qualification evidence covers 1.1.19 only. Earlier binaries are not covered — 1.1.13 is the known-wedged version that motivated the terminal-recovery project. Note the existing health check minimum (`1.0.12`) does **not** enforce ≥ 1.1.19; respecting the qualified floor is an operational rule, not a code guarantee, until a version gate lands.
- **Opt-in (WP2 env names, `SYNARA_ANTIGRAVITY_*` prefix per the accepted config convention):**
  - `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE` — `true`/`1`/`on` enables; `false`/`0`/`off`/unset disables; invalid input falls back to the default (false), never clamped.
  - Related knobs (same resolver contract — nullish → default, range check, invalid → default, never clamped):
    - `SYNARA_ANTIGRAVITY_STOP_IDLE_MAX_CONTINUATIONS` (default 64, range 0–1024)
    - `SYNARA_ANTIGRAVITY_STOP_IDLE_BACKGROUND_DEADLINE_MS` (default 600000, range 1000–2147483647)
    - `SYNARA_ANTIGRAVITY_STOP_IDLE_CLOSE_WAIT_MS` (default 5000, range 100–600000)
    - `SYNARA_ANTIGRAVITY_STOP_IDLE_STABLE_EOF_QUIET_MS` (default 500, range 50–60000)
    - `SYNARA_ANTIGRAVITY_STOP_IDLE_FINAL_DRAIN_MS` (default 5000, range 100–60000)
  - Internal (not operator-facing): when enabled, the adapter injects the child-side hook environment (`SYNARA_ANTIGRAVITY_STOP_IDLE=1` plus the continuation budget) into the `agy` child env.
- The bounded continuation budget is what prevents a runaway `continue` loop from spinning forever — the probe's 9-continuation run stayed well inside the default budget of 64.

## 8. Rollback

Env-only, no persisted-state migration: unset `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE` (or set it to `false`/`0`/`off`) and restart the server. Turn settlement returns to the legacy stop-hook behavior immediately; stop-idle state is turn-scoped and in-memory, so there is nothing to clean up after the flag flips. Invalid/typo'd values also fail safe to the disabled default.

## 9. Reproducible manual recipe

Bounded, single-process, no secrets. Adapt paths as needed.

1. **Workspaces.** `TMPWS=$(mktemp -d)` (task workspace), `HOOKWS=$(mktemp -d)` (hook carrier). Create `HOOKWS/.agents/hooks.json` registering three command hooks — `PreInvocation`, `PreToolUse` (matcher `run_command`), `Stop` — each appending one sanitized NDJSON row (event, ts, PIDs, counters, `terminationReason`, `fullyIdle`, `modelName` only) to a probe log file. The Stop hook must answer `{"decision":"continue"}` iff `fullyIdle === false`, else `{}`.
2. **Prompt.** Instruct the model to launch exactly two background `run_command` tasks (`sleep 25; echo A > snt_a.done`, `sleep 10; echo B > snt_b.done`, WaitMsBeforeAsync 1500), reply `LAUNCHED` only, and never poll the tasks.
3. **Launch (background, bounded).**
   ```
   cd "$TMPWS" && agy --output-format json --print-timeout 3m \
     --dangerously-skip-permissions --add-dir "$HOOKWS" -p "<bounded prompt>" &
   AGYPID=$!
   ```
4. **Poll.** Every 1 s (hard cap 200 s): record whether `$AGYPID` is alive and whether `$TMPWS/snt_a.done` / `snt_b.done` exist. Capture the exit code on death.
5. **Verify the gates.** From the probe log + poller log, check:
   - at least one Stop with `fullyIdle=false` while a sentinel is missing (G1);
   - the loop re-entered after each false Stop (continuation evidence) (G2);
   - constant `parentPid` across all hook rows and liveness spanning every Stop (G3);
   - both sentinel files present with expected bytes (G4);
   - a final Stop with `fullyIdle=true` after both sentinels (G5);
   - process exit (code 0) only after that true Stop, never between a false Stop and the true one (G6);
   - no late loss: final transcript response follows the last injected system message, background tool steps precede all Stop events (G7).
6. **Expectation on 1.1.19:** ~9–10 Stop events, exit 0 in ~35–40 s for the 25 s/10 s sentinel pair.

## 10. Status

Investigation/qualification complete. This document records the durable evidence and the enablement/rollback policy; the implementation seam (config knobs, hook `continue` budgeting, aggregate projection) is owned by the WP2 stop-idle workstream and referenced here by name only.
