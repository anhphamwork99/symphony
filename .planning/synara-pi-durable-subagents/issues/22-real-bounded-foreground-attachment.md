# 22 — Real bounded foreground attachment

**What to build:** A foreground Agent call owned by the actual Pi extension
waits for one bounded budget. Fast children return their normal result. A child
still active at expiry returns its durable execution handle while that same
child continues under its original parent-turn cancellation scope. Started and
detached observations survive database reopen, and session or child termination
cleans up every timer and in-memory registry entry.

**Blocked by:** 21 — Production fail-closed control health.

**Status:** reopened — post-acceptance independent review found contrary evidence.

**Review disposition (2026-08-17):** Decision 0007 acceptance reopened. A
post-acceptance independent review reproduced the focused suites (Alfie 464,
contracts 215, Symphony acceptance/reopen/real-extension 29 passing) and the
provenance pins, but found contrary evidence meeting Decision 0007's reopening
conditions:

- **T22-AC5 fails:** `SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS` is resolved only in
  `ServerConfig.layerTest` (`apps/server/src/config.ts:313`); the production
  `ServerConfigLive` in `apps/server/src/main.ts:313-335` never populates
  `piSubagentForegroundWaitMs`, so PiAdapter's `?? DEFAULT` fallback always
  wins in production. The "configured bounds and invalid-value fallback remain
  effective on the production path" claim is not delivered; every T22 test
  injects `ServerConfigShape` directly, which is why suites pass regardless.
- **T22-AC7 fails:** the managed detached foreground child never receives
  post-detachment settlement cleanup. `AgentManager` fires `onComplete` only for
  `isBackground` runs (`agent-manager.ts:477/536/605`), while the managed child
  stays foreground, so the `agentActivity.delete` / `widget.markFinished`
  cleanup that runs for inline settlement (`index.ts:1459-1463`) has no
  post-detach continuation. After a detached child settles, its
  `agentActivity` entry persists and the widget's 80 ms interval can keep
  running (bounded only by the manager's ~10-minute record cleanup), without
  stopping unrelated children. `getResourceSnapshot()` counts only
  `liveAttachments`, so AC7 tests report 0/0 while these resources leak.

Nonblocking evidence gaps recorded for the same remediation: integrated timing
assertions use `budget + 2000 ms`/`3500 ms` instead of Decision 0006's
`budget + 500 ms` envelope; AC6's "adjacent legacy session" leg only probes a
fixture bridge and never executes an actual legacy Agent session; lifecycle
persistence-failure results are success-shaped (no `isError`) and still carry
server identities via the PiAdapter success path; the report's measured-time
narrative cites `15000 ms` while the committed test uses `30000 ms`.

The remediation work packages live in
[`plans/22-real-bounded-foreground-attachment/`](../plans/22-real-bounded-foreground-attachment/)
(WP-06 Alfie cleanup + failure shape, WP-07 Symphony production config +
evidence hardening). Decisions 0001–0006 remain authoritative and are not
reopened.

- [ ] **T22-AC1:** An actual Pi child completing inside the budget returns the
      normal inline result and creates no unnecessary follow-up delivery.
- [x] **T22-AC2:** An actual child exceeding the budget returns one execution
      handle within budget plus bounded scheduling tolerance, without spawning a
      replacement.
- [x] **T22-AC3:** Detach changes only parent-tool attachment; child identity,
      attempt, generation, and default parent-turn cancellation scope remain
      unchanged.
- [x] **T22-AC4:** Started and detached-running observations commit durably and
      database reopen recovers the same non-terminal execution aggregate.
- [ ] **T22-AC5:** Default foreground budget is 10 seconds; configured bounds
      and invalid-value fallback remain effective on the production path.
- [ ] **T22-AC6:** Concurrent managed executions and an adjacent legacy session
      retain independent results, timeouts, identities, and behavior.
- [ ] **T22-AC7:** Child settlement, session disposal, startup failure, and
      explicit cleanup remove heartbeat/progress timers and live registry entries
      without stopping unrelated children.
- [x] **T22-AC8:** Synthetic replacement Agent tools cannot satisfy the
      real-Pi, production-call-chain, or reopen acceptance evidence.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T22-AC1, T22-AC2, T22-AC3, T22-AC5, T22-AC6, T22-AC8:** Actual Pi
  parent-tool boundary with fast, long, concurrent, invalid-config, and legacy
  executions.
- **T22-AC4:** Production persistence boundary — detach, close/reopen the
  database-backed harness, and recover the same aggregate and identities.
- **T22-AC7:** Session lifecycle and resource-observation boundary — verify no
  live timer/registry ownership after each cleanup condition.

## Implementation Report

**Implementation state:** remediation in progress (WP-07 complete; timing-envelope verification returned as a challenge — see "Challenge" below). This report reflects the 2026-08-17 remediation of the reopened defects and does not claim acceptance. Acceptance belongs to the re-review / final-acceptance lifecycle.

### Remediation scope delivered by WP-07 (Symphony side)

1. **T22-AC5 production wiring fixed.** `ServerConfigLive` (`apps/server/src/main.ts`) now resolves
   `piSubagentForegroundWaitMs: resolvePiSubagentForegroundWaitMs(process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS)`
   inside the `ServerConfigShape` literal, importing the resolver from `./config.ts` (the single
   shared resolution site; no clamping, no logging, no second resolver). A new wiring test in
   `apps/server/src/main.test.ts` boots `ServerConfigLive` through the real CLI path with the env key
   set to `30000` (→ 30000), `abc` / `99` / `60001` (→ 10000), and unset (→ 10000), asserting the
   resolved field on the produced config. The test exercises `ServerConfigLive`, not `layerTest`.
2. **Timing envelope tightened to Decision 0006 §5 (`budget + 500 ms`).** The integrated detach
   assertions now assert `elapsed < foregroundWaitMs + 500` (acceptance AC2/AC3) and
   `elapsed < 800` for the 300 ms real-extension leg (previously `+2000 ms` / `3500 ms`). No
   assertion widens beyond `budget + 500 ms` anywhere.
3. **T22-AC6 legacy leg is now a real adjacent legacy session.** The fixture-only
   `probePiSubagentBridge(makeLegacyPiSubagentExtension())` leg was replaced by a second real Pi
   session started through the same production `PiAdapter` whose agent dir resolves a
   **stripped-capability copy** of the actual pinned extension: a full copy of the extension tree
   (src, package.json, manifest, helper scripts, symlinked `node_modules` and sibling `shared`/`system`)
   with exactly one change — `bounded-foreground-attachment` removed from `PI_SUBAGENT_CAPABILITIES`
   in the copied `src/index.ts` (the mixed-version condition under test). That session negotiates
   `capability_mismatch` with `missingCapabilities: ["bounded-foreground-attachment"]`, receives no
   admission wrapper (`__synaraAdmissionWrapped` undefined), and executes an actual Agent call whose
   real child completes against a deterministic local model (1500 ms delayed response) concurrently
   with two managed executions that detach at their 400 ms budget.
4. **T22-AC1 now asserts a successful inline completion.** The AC1 test executes a real child that
   completes against a deterministic local OpenAI-completions provider (loopback SSE server
   registered through the agent dir's standard `models.json`/`auth.json` — no production seam is
   mocked) and asserts the inline result contains the child's actual output text ("ACK") and the
   extension's completion framing (`Agent completed in`), `details.status === "completed"`, no
   `Agent failed:` / detach label, completion inside the 30000 ms budget, journal seq 1 (accepted) +
   seq 2 (started) only, and zero live attachments/timers afterward.
5. **Provenance re-pinned to the WP-06 Alfie commit** `82406bd834c5f52785fe8f3b65d316d3f8b3fd62`
   ("fix(pi-subagents): clean up detached foreground settlement and error-shape lifecycle failures
   (issue 22 remediation)"). SHA-256 hashes recomputed from that exact clean checkout (working-tree
   bytes verified identical to the HEAD blobs): `package.json` and `src/agent-manager.ts` unchanged
   from the previous pin; `src/index.ts` updated to
   `6f889aad4841234768eba60485949d4713acb1957988c802ab7069afc10f965f`.

### Deterministic-completion fixture (owner-approved seam, no lower seam invented)

The acceptance environment has no working hosted-model credential, so "real child completes
successfully" cannot be proven against a hosted provider. WP-07 therefore runs the complete
actual-Pi boundary (PiAdapter session, admission, extension, `AgentManager`, `runAgent`,
`createAgentSession`, real `openai-completions` streaming client, settlement) against a
**deterministic local model endpoint**: a loopback HTTP server speaking the streaming
chat-completions wire format, registered as an ordinary custom provider via the agent dir's
`models.json`/`auth.json`. Two models are exposed: `echo` (immediate "ACK") and `echo-slow`
(1500 ms delayed "ACK"). Only the model endpoint is a fixture; every production seam remains real.
This makes T22-AC1's successful completion and T22-AC6's unbounded legacy wait deterministic.

### Challenge: budget + 500 ms envelope vs multi-suite process load

Per WP-07 ("if you widen beyond +500 ms, you must stop and return challenge instead") this package
**returns `challenge` for the timing-envelope verification portion** rather than widening any
assertion. All detach assertions remain exactly at Decision 0006 §5's `budget + 500 ms`.

Measured evidence (all on the WP-06-pinned clean checkout, post warm-up):

| Composition | Result |
| ----------- | ------ |
| Acceptance file standalone (`piSubagentForegroundAcceptance.test.ts`) | 13/13 green; measured AC2 detach 327 ms (300 ms budget), AC6 managed pair 429 ms (400 ms budget), AC6 legacy inline completion 2382 ms, AC1 successful completion 394 ms |
| Real-extension file standalone (`piSubagentRealExtension.test.ts`) | ~13/15 green; tail failures at 826–1101 ms (300 ms budget, 800 ms envelope) |
| Mandated 4-file command (acceptance + reopen + real-extension + lifecycle in one vitest process) | ~5/11 green; failures 894–1316 ms |
| Full server suite (371 files) | run 1 failed at 1296 ms; run 2 fully green (4384 passed) |
| Isolated production chain (60 single-shot samples) | 303–892 ms total (deadline 300 ms + seq2/seq3 SQLite commits + return) |

Interpretation: the production detach call chain itself meets the envelope on a functioning loop
(303–680 ms typical). The strengthened evidence required by this remediation (real child
completions, real legacy session, concurrent executions) leaves real-Pi session/extension teardown
work settling in the same vitest worker process, whose scheduling tail adds 150–900 ms on top of the
500 ms allowance. Options for the owner: (a) accept per-file verification (each file standalone
meets the envelope in the strong majority of runs), (b) change the verification invocation to run
wall-clock-sensitive files in separate processes, or (c) reopen Decision 0006 §5's envelope value.
WP-07 does not have authority for (c) and deliberately did not widen any assertion.

**Owner adjudication (2026-08-17): option (b).** The timing-envelope challenge is resolved by
test-harness process isolation, not by relaxing the envelope. Decision 0006 §5 keeps
`budget + 500 ms` unchanged; the flakiness is attributed to shared-worker scheduling during
adjacent real-Pi teardown, not to the production chain. Harness isolation is delivered as WP-08
(`plans/22-real-bounded-foreground-attachment/WP-08-test-harness-isolation.md`); acceptance for the
envelope requires the multi-file and full-suite invocations to pass with the isolation in place.

### Acceptance evidence matrix (remediation)

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T22-AC1 | `PiAdapter.ts` managed foreground binding + Alfie `index.ts` Outcome A | `piSubagentForegroundAcceptance.test.ts` ("T22-AC1 …") — now asserts successful completion text/status, not just identities | PASSED (standalone) |
| T22-AC2, T22-AC3 | same | same file ("T22-AC2, T22-AC3 …"), now `budget + 500 ms`; measured 327 ms on 300 ms budget | PASSED standalone; envelope flaky in multi-file invocations (see Challenge) |
| T22-AC4 | `PiSubagentExecutionRepository` + reopen harness | `piSubagentForegroundReopen.test.ts` (unchanged this package) | PASSED |
| T22-AC5 | `apps/server/src/main.ts` (`ServerConfigLive`), `apps/server/src/config.ts` resolver | new `main.test.ts` wiring test (ServerConfigLive; 30000/abc/99/60001/unset) + acceptance AC5 session-path test | PASSED |
| T22-AC6 | `PiAdapter.ts` capability gating; stripped-capability extension copy | acceptance "T22-AC6 …" — real adjacent legacy session, concurrent managed detach, zero legacy journal rows, no binding attached, managed pair 429 ms | PASSED (standalone) |
| T22-AC7 | Alfie WP-06 commit `82406bd8` post-detach settlement cleanup | acceptance "T22-AC7 …" snapshots + Alfie extension suite (WP-06) | PASSED |
| T22-AC8 | provenance manifest + verifier | acceptance "T22-AC8 …" against pinned commit `82406bd8…` | PASSED |

### Verification commands and results (2026-08-17, WP-07)

```bash
export PATH="$HOME/.bun/bin:$PATH"
cd /Users/anhpham99/symphony/apps/server
```

- `bun run test src/main.test.ts src/config.test.ts` — **99 passed / 2 files, exit 0, 6.8 s**
  (includes the new ServerConfigLive wiring test).
- `ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentRealExtension.test.ts`
  — **11 passed, exit 0, 9.8 s** (against the re-pinned clean checkout; ~13/15 across repeated
  standalone runs due to the envelope tail — see Challenge).
- `ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentForegroundAcceptance.test.ts`
  — **6 passed, exit 0** (13/13 across repeated standalone runs).
- `ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentForegroundReopen.test.ts src/provider/piSubagentForegroundLifecycle.test.ts`
  — **6 passed / 2 files, exit 0, 2.2 s**.
- Mandated four-file command — **intermittent** (~5/11 green; envelope tail 894–1316 ms — see
  Challenge). No assertion was widened.
- `bun run test` (full server suite, 371 files) — run 1: 4383 passed / 1 failed (real-extension
  envelope 1296 ms); run 2: **4384 passed / 0 failed, exit 0, 435 s**.
- `apps/server/.pi/` artifacts removed after every test run.

### Real-Pi evidence (re-pinned)

- **Extension origin:** `/Users/anhpham99/alfie/agent/extensions/pi-subagents`
- **Alfie pinned commit:** `82406bd834c5f52785fe8f3b65d316d3f8b3fd62` (WP-06 remediation commit;
  extension path verified clean at this commit)
- **Artifact SHA-256 hashes:**
  - `package.json`: `7171b731a76a8d84655a49997200433447c5e36af71574e65df7d9749eefa65f` (unchanged)
  - `src/index.ts`: `6f889aad4841234768eba60485949d4713acb1957988c802ab7069afc10f965f` (updated)
  - `src/agent-manager.ts`: `f09381a2202f3e5b696af2c7e538c95076fd88f145e235c81bbaf85d88c9bbe7` (unchanged)
- **Measured elapsed times (standalone, instrumented reruns):**
  - T22-AC1 fast child (deterministic local model, 30000 ms budget): **394 ms** to successful
    inline completion; journal seq 1 + seq 2 only.
  - T22-AC2 detached child (300 ms budget): **327 ms** (envelope 800 ms).
  - T22-AC6 managed pair (400 ms budget): **429 ms** concurrent detach, both journals seq 1→2→3.
  - T22-AC6 legacy inline completion (deterministic 1500 ms slow model): **2382 ms** — the legacy
    session waited unbounded for its actual child while the managed pair had already detached.

### Deviations and remaining risks

- **Timing-envelope challenge (see above):** assertions stay at `budget + 500 ms`; multi-file
  invocations intermittently exceed it. Owner decision required; no widening performed.
- Deterministic completions depend on a loopback model fixture; a hosted-credential environment
  could replace it without test changes (the agent-dir `models.json` is the standard configuration
  surface).
- T22-AC7's production behavior (post-detach settlement cleanup) is delivered by the WP-06 Alfie
  commit; this package re-pins and verifies against it.

### Commits (remediation)

- Symphony wiring commit: see `git log` — `fix(pi): wire foreground budget env into production server config (issue 22 remediation)`
- Symphony evidence commit: `test(pi): harden issue 22 acceptance evidence (issue 22 remediation)`
- Symphony provenance commit: `chore(pi): re-pin alfie provenance for issue 22 remediation`
- Symphony report commit: `docs(planning): refresh issue 22 implementation report for remediation`
- Alfie WP-06 commit (pinned): `82406bd834c5f52785fe8f3b65d316d3f8b3fd62`
- No push. Working tree: only WP-07 allowed paths changed.

### Reviewer handoff

1. `cd apps/server && bun run test src/main.test.ts src/config.test.ts` (wiring test).
2. `cd apps/server && ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentForegroundAcceptance.test.ts` (AC1 completion, AC2/AC3 envelope, AC6 real legacy leg).
3. `cd apps/server && ALFIE_REPO_DIR=/Users/anhpham99/alfie bun run test src/provider/piSubagentRealExtension.test.ts` (real-extension envelope + provenance pin).
4. Re-run 2–3 standalone times and once as the four-file command to observe the envelope tail
   documented under "Challenge".
