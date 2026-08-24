# Ticket 04 — Independent production-composition review

- **Review date:** 2026-08-24
- **Candidate:** `59c06c413`
- **Reviewer role:** independent feature-level reviewer
- **Review authority:** evidence only; final acceptance remains with the
  Project Supervisor.
- **Overall recommendation:** **PASS**

## Governing records

- `../PROJECT.md`
- `../issues/04-prove-desktop-production-composition-and-accept.md`
- `../decisions/0016-t04-production-composition-acceptance-boundary.md`
- `../spec.md`

## Criterion verdicts

### AC1 — PASS

The candidate proves the exact production chain required by Decision 0016:
release-shaped resources flow through the production
`buildBackendChildSpawnEnv` / `applyPiSubagentArtifactBackendEnv`
implementation, the complete derived environment reaches the desktop-managed
server gate, and the official packaged artifact is selected. A planted global
extension and decoy artifact remain byte-for-byte unchanged and are not loaded.

Commit `59c06c413` moved the pure environment implementation to the explicit
shared subpath `@synara/shared/piSubagentDesktopArtifactEnvironment`; the
desktop path is a compatibility re-export. This removes an invalid
server-to-desktop TypeScript dependency without copying or changing the
production logic under test.

### AC2 — PASS

`piSubagentDesktopProductionCompositionAcceptance.test.ts` proves all required
capabilities are negotiated before admission, exactly one managed admission
occurs after readiness, journal order is accepted → running → detached,
foreground attachment stays within its bounded envelope, heartbeat and
progress continue after detach, a fresh WebSocket client observes the running
card and then the terminal card, and exactly one fenced terminal journal result
is committed.

The reviewer reran the Ticket 04 suite twice at the exact candidate: both runs
passed `3/3`; observed detach times were 372 ms and 308 ms for the 300 ms
budget. The orchestrator's exact-candidate run observed 356 ms. All are inside
the accepted `[budget - 50 ms, budget + 500 ms)` envelope.

### AC3 — PASS

The same composition covers missing and malformed manifests, digest mismatch,
unsupported capability, hostile protocol version, malformed handshake, and
invalid runtime-model configuration. Every leg fails closed with bounded,
redacted diagnostics, no model-server request, and zero execution, journal,
outbox, or batch rows. Hostile protocol checks use contextual patterns so host
path digits cannot create false positives while actual protocol leakage remains
covered.

### AC4 — PASS

The reviewer reran focused terminal, restart, Resume, watchdog,
completion-ownership, desktop-managed-real-Pi, and global projection snapshot
suites at `59c06c413`. Results were respectively `2/2`, `2/2`, `2/2`, `2/2`,
`2/2`, `7/7`, and `24/24`. These preserve journal-first terminal truth,
restart/orphan behavior, stale-generation fencing, teardown uncertainty, and
the global snapshot alias regression fixed by `0573494c2`.

### AC5 — PASS for verification and independent-review portions

The exact candidate passed:

- `bun fmt`: exit 0. Its mechanical changes to 47 pre-existing out-of-scope
  files were restored; restoration does not invalidate successful formatter
  execution and prevents unrelated churn entering this ticket.
- `bun lint`: 0 warnings and 0 errors.
- `bun typecheck`: 7/7 workspace tasks successful.
- `ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test -- --env-mode=loose`:
  8/8 Turbo tasks successful in 11m19s. The server test orchestrator separately
  reported all 16 invocations green: one unit project plus 15 standalone
  wall-clock files. Server unit coverage was 400 files / 4,913 passing tests;
  the Ticket 04 suite passed `3/3`. No retry was logged in this run.

The single-retry policy cannot hide a deterministic failure: a failed
invocation is retried once after the first pass settles, and a second failure
remains gate-failing. The exact-candidate run did not exercise that allowance.

This record is the one independent feature-level review required by AC5.
Supervisor final acceptance remains outstanding at the time this review is
persisted.

## Findings and residual risk

No high-severity finding was found.

- The “8/8” metric is the root Turbo task summary, not the server invocation
  count; the server count is 16/16. Both are now stated with their units.
- Full formatter, lint, and typecheck outputs were supplied by the orchestrator
  rather than independently rerun by the read-only reviewer. The reviewer
  confirmed a clean exact-candidate worktree and independently reran the
  feature and AC4-focused suites.
- Electron/OS child spawn is intentionally outside the required proof boundary
  under Decision 0016. The accepted proof still traverses the exact production
  resolver, complete backend environment, server gate, real Pi runtime,
  WebSocket, durable journal, and execution-card projection.

## Recommendation

Use this review as the sole feature-level reviewer evidence package for one
Project Supervisor final-acceptance consultation. The candidate is recommended
for **PASS**.
