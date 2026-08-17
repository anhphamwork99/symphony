# Synara–Pi token-overhead measurement

This directory records the accepted `impl-11` paired measurement run. The
machine-readable source of truth is [`report.json`](report.json).

## Run configuration

- Date: 2026-08-15
- Harness: 1.0.0
- Pi SDK: 0.81.1
- Model: `cockpit/gpt-5.6-sol`
- Thinking level: `medium`
- Matrix: 3 modes × 3 fresh repetitions × 2 measured turns
- Prompt: identical 327-byte, no-tool stimulus in every measured turn
- Fixture digest:
  `64cb17d400e45402129b990892438e2ea72b14efcf748ef5e17d47ddb99c4e00`
- Reconciliation:
  `total == input + cacheRead + cacheWrite + output`

All 18 measured turns reconciled with the real Pi `SessionStats` components.
Every mode completed 3/3 valid repetitions. Full schemas were measured from
the live effective catalog and retained only in the ignored local measurement
area; this committed report contains complete tool names, canonical byte
counts, hashes, and the canonicalization method, but not raw schemas or raw
filesystem paths.

## Results

| Mode                 | Effective tools | Canonical schema bytes | Cold turn total tokens   | Turn-2 incremental total |
| -------------------- | --------------: | ---------------------: | ------------------------ | -----------------------: |
| Pi standalone        |              44 |                 54,303 | 22,206 / 22,205 / 22,205 |             79 / 79 / 79 |
| Synara default       |              48 |                 63,752 | 24,021 / 24,022 / 24,020 |             79 / 79 / 79 |
| Synara MCP activated |             105 |                170,798 | 65,111 / 65,111 / 65,109 |             79 / 79 / 79 |

Against the paired standalone runs:

- Synara default added 4 tools and 9,449 canonical schema bytes. Cold-turn
  processed tokens increased by 1,815–1,817 tokens (about 8.2%).
- Activated Synara MCP added 61 tools and 116,495 canonical schema bytes.
  Cold-turn processed tokens increased by 42,904–42,906 tokens (about 193%).
- Subsequent-turn incremental totals were identical across all nine runs
  (`79`), so the measured overhead is concentrated in the effective
  policy/catalog context rather than the bounded response itself.

Activated-mode measured turns occur after a real enable operation. Its
unmeasured bootstrap turn starts the session while Synara MCP is dormant; the
bootstrap accounting is retained in each repetition's `startup` field, and
the activated cold-turn cumulative total therefore includes that prior
session cost.

## Conclusion

The evidence supports a separate investigation of compaction or
artifact-backed output because every valid paired repetition showed the same
positive cold-start direction. This is a non-binding technical recommendation:
it does not establish an overhead budget and does not authorize either
optimization.

## Reproduce

From the repository root:

```bash
~/.bun/bin/bun apps/server/scripts/token-overhead/measure.ts \
  --agent-dir="$HOME/.pi/agent" \
  --model=cockpit/gpt-5.6-sol \
  --thinking=medium \
  --repetitions=3 \
  --turns=2 \
  --local-manifest-dir=.synara-measurements/impl11-manifests \
  --output=benchmarks/synara-pi-token-overhead/report.json
```

The run requires valid credentials for the selected Pi model. It starts
isolated Synara instances on dynamically selected loopback ports and removes
their temporary homes, workspaces, and full-schema artifacts on success or
failure.
