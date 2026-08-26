# Ticket 01 Excalidraw AC6 baseline

This is a feasibility baseline from the real lazy Synara adapter and official `@excalidraw/excalidraw` 0.18.1 in Chromium. It is observational evidence, not a latency, memory, board-size, or image-size budget.

## Environment and protocol

- Package: `@excalidraw/excalidraw@0.18.1` (exact package pin 0.18.1)
- Measured Synara source revision: `0a8f095b43c701ce3c7e2ad0236bf427c9d0c52a`
- Evidence/report commit: separate commit, not recorded by the measurement runner
- Browser: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.7632.6 Safari/537.36
- OS/architecture: darwin 25.4.0 / arm64
- Build mode: Vite browser test build using the production-compatible apps/web toolchain; not production minification
- Warm-up: 2 warm-up operation(s) per repeatable scenario; retained in protocol and excluded from reported raw samples.
- Samples: 12 raw latency samples per repeatable operation. Timer: performance.now() in the Chromium page; operation timers exclude mount/unmount except hydration timers
- Percentiles: median and p95; linear interpolation over sorted samples; p95 position=(n-1)\*0.95.
- GC: No forced garbage collection; samples include normal browser scheduling and allocator state.

## Fixture sizes

| Fixture | Elements | Files | JSON bytes |
| ------- | -------: | ----: | ---------: |
| empty   |        0 |     0 |         26 |
| normal  |        5 |     0 |       3184 |
| image   |        6 |     1 |       3987 |

## Raw latency summaries

Raw samples are retained in `excalidraw-baseline.json`. No threshold or pass/fail budget is inferred from these observations.

| Scenario           | Samples |    Median |       p95 |
| ------------------ | ------: | --------: | --------: |
| hydrate-empty      |      12 | 21.900 ms | 22.545 ms |
| hydrate-normal     |      12 | 22.200 ms | 22.735 ms |
| hydrate-image      |      12 | 22.100 ms | 22.790 ms |
| serialize-normal   |      12 |  0.000 ms |  0.100 ms |
| update-progressive |      12 |  0.000 ms |  0.100 ms |
| serialize-image    |      12 |  0.000 ms |  0.100 ms |
| export-svg-image   |      12 | 15.250 ms | 16.160 ms |
| export-png-image   |      12 |  9.300 ms | 11.330 ms |

## Boundary proofs

- Ordered progressive updates: **observed**; update order and existing API identity were asserted.
- Non-remount and viewport retention: **observed**.
- Visible canvas and hidden retained canvas: **observed**.
- Repeated visibility cycles: **8** cycles with identities retained.
- Separate mount/unmount probe: **observed**.
- Image-bearing serialization/SVG/PNG export: **observed**.

## Memory instrumentation

- **Available, coarse process observation:** performance.memory.usedJSHeapSize; before=68000000 bytes, after=68000000 bytes.
- Limitation: Chrome coarse process heap telemetry; it is not precise per-canvas retained memory.
- Unavailable memory is represented as `{status:"unavailable", reason}` in JSON; it is never recorded as zero.

## Known limitations

- **memory-attribution:** Memory readings are unavailable or coarse process-wide browser telemetry and are not precise per-canvas retained-size measurements.
- **undo-transaction-boundary:** Ticket 01 records updateScene feasibility only; exact one-event AI Undo remains owned by Ticket 02 and no product budget is inferred here.
- **dot-grid:** Dot-grid rendering and export policy are intentionally outside Ticket 01 scope.

See `incompatibilities.md` for the complete classification of observed findings. The suite found no blocking incompatibility and introduced no product budget.
