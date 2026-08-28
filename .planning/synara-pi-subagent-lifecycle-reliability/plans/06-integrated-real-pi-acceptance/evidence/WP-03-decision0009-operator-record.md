# WP-03 Decision 0009 — manual destructive operator record

**Disposition:** PASS
**Executed:** 2026-08-29 (UTC+7)
**Candidate:** `9b55649050b76feffdc4279ceaec92ac74a78686`
**Alfie:** `3fe340b401ca86bcbe8b55abd4de107e1d93482e`

## Authorization and scope

The owner's current-session instruction `TIếp tục hoàn thiện ticket đi` authorized continuation at the then-current WP-03 boundary. This record covers exactly one manual destructive T17-AC6 run. Authority was limited to the run-owned Bash root and descendant; it did not authorize PID guessing, process-name killing, parent fallback, external signalling, retry, or any Symphony-owned general kill capability.

## Exact producer

Working directory: `/tmp/symphony-t06/apps/server`

```sh
SYNARA_T17_MANUAL_TEARDOWN=1 \
HOME="$T06_HOME" \
ALFIE_REPO_DIR=/tmp/alfie-t06 \
node ../../node_modules/vitest/vitest.mjs run \
  --project wallclock \
  --maxWorkers=1 \
  --no-file-parallelism \
  src/provider/piSubagentRealPiAcceptance.test.ts \
  -t 'MANUAL T17-AC6'
```

The process used fresh outer HOME `/var/folders/_v/54jgtd2x4nq1h94b1c5qnv400000gn/T/tmp.MfAMEkOxCa`, installed an EXIT cleanup trap, and streamed raw output to `WP-03-decision0009-manual-destructive.log` under `set -o pipefail`, preserving Vitest's `PIPESTATUS[0]`.

## Result

- Producer exit: `0`.
- Test files: `1 passed (1)`.
- Tests selected: `1 passed`; `10` non-selected tests reported skipped by the `-t` filter.
- Duration: `34.85s`.
- Execution: `exec_c5fcab13-1c13-40f7-91ca-73b725a981fd`.
- Attempt: `att_e2a5d51f-29ca-43cc-8640-fc4adc0bd3cb`.
- Exact owned root PID: `29538`.
- Exact owned descendant PID: `29552`.
- TERM evidence: `root,descendant`.
- No band 76 while either exact child was live: `true`.
- Durable bands after teardown: `75,76`.
- Generation fence: `1 -> 2`.

Post-run verification proved:

- outer HOME `tmp.MfAMEkOxCa` absent;
- harness root `synara-realpi-t17-h0XFZK` absent;
- `kill -0` failed for both exact owned PIDs, proving zero survivors at verification time;
- candidate checkout remained exact and tracked-clean;
- protected owner WIP remained unstaged with aggregate diff hash `ab8f8f54fe818819721f737aa337156ed6348c7410c55083ce3a67785bb7eaa8`.

This was the sole Decision 0009 WP-03 attempt. No retry occurred or is authorized by this record.
