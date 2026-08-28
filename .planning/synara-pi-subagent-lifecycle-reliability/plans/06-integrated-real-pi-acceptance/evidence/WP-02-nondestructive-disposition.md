# WP-02 non-destructive real-Pi disposition — Ticket 06

**State of this record:** executed (attempt 1, 2026-08-28) and stopped at
challenge; the authorized corrected attempt (attempt 2) then ran exactly once
and ALSO stopped at challenge (integrated leg exit 1, sole failure = teardown
user-Pi-home digest, exact FFF root cause recorded in §4c). WP-02 is NOT
completed. No behavioral PASS is claimed for any corrected leg; no further
run is authorized without a fresh owner decision (§4c/§6).

**Attempt-1 evidence classification: environment/runner evidence, NOT a
behavioral PASS.** Nothing in attempt 1 proves the pinned-composition
behavioral criteria at the integrated boundary. The three failed legs failed
for environment/runner reasons (missing gitignored ext-local `node_modules`
in the pristine worktree; Bun-only Effect `SocketCloseError` dispose
failures; external Pi-FFF frecency state perturbing the user-Pi-home
digest), and their raw logs are preserved verbatim under
`WP-02-attempt-01-*` names. The two passing legs (restart, resume) ARE
behavioral PASS evidence at their own boundary and keep their canonical
names unchanged for reuse as final WP-02 evidence.

Evidence class of everything below: **R** (controlled real-Pi, non-destructive)
with the provenance shell in **P** (`WP-02-realpi-provenance.txt`).

## 1. Executed legs (exact commands, totals, exits)

All runs: cwd `/tmp/symphony-t06/apps/server`,
`ALFIE_REPO_DIR=/tmp/alfie-t06`, `env -u SYNARA_T17_MANUAL_TEARDOWN`,
`set -o pipefail`, per-file standalone
`<runner> ../../node_modules/vitest/vitest.mjs run --project wallclock
--maxWorkers=1 --no-file-parallelism <file> 2>&1 | tee <evidence log>`;
`status=${PIPESTATUS[0]}` recorded. Serial, one process per file, run
exactly once each on 2026-08-28 (local UTC+7). No behavioral retry.

| # | File | Runner | Start | End | Vitest duration | Totals | Exit |
|---|------|--------|-------|-----|-----------------|--------|------|
| 1 | piSubagentRealPiAcceptance.test.ts | node v24.14.1 | 12:23:39 | 12:31:34 | 473.97s | 10 tests: 8 failed, 1 passed, 1 skipped | **1** |
| 2 | piSubagentCanonicalIdentityAcceptance.test.ts | bun 1.3.12 | 12:41:12 | 12:47:15 | 362.36s | 9 tests: 2 failed, 7 passed | **1** |
| 3 | piSubagentLifecycleContainmentRealPiAcceptance.test.ts | bun 1.3.12 | 12:47:26 | 12:51:29 | 242.12s | 1 test: 1 failed (240s timeout) | **1** |
| 4 | piSubagentRestartAcceptance.test.ts | bun 1.3.12 | 12:53:12 | 12:53:22 | 9.76s | 1 test: 1 passed | **0** |
| 5 | piSubagentResumeAcceptance.test.ts | bun 1.3.12 | 12:53:35 | 12:53:39 | 3.54s | 1 test: 1 passed | **0** |

Expected skip set, observed exactly: leg 1 skipped only the single MANUAL
T17-AC6 destructive test (`it.skipIf(SYNARA_T17_MANUAL_TEARDOWN !== "1")`).
All mandatory non-manual stages of the primary integrated producer were
collected and executed. No unexpected skip anywhere; no mock or provider-fake
success path was available (stage 0 proves the extension tree provenance and
real sessions produce the model traffic; see §3).

## 2. Isolation record

Asserted in-band by leg 1 stage 0 (the only passing integrated stage) and by
the harness design: one owned temp root containing state db (`.sqlite`),
home, workspace (git-initialized), parent/child agent dirs and `PI_HOME`, all
under the root and disjoint from the user home; loopback port 0 (non-default,
≠3000/≠8080); parent agent dir wired via the public `server.updateSettings`
Pi agentDir seam; `PI_CODING_AGENT_DIR` pointed at the owned child dir and
restored on dispose (`envWasRestored()` true at teardown). Post-run host
gates: Symphony worktree still detached at `12fd6686` with zero tracked delta
and an EMPTY named-surface diff; Alfie worktree still detached at `3fe340b4`,
clean; main checkout staged 0, protected WIP aggregate hash exact
(`ab8f8f54…eaa8`), zero-delta gate empty.

## 3. What the executed evidence proves (mapped to T06 criteria) — and what it cannot prove

- **T06-AC1 (composition/provenance/isolation): R-PARTIAL.** Provenance shell
  PASS (fixture 5/5, pins, Pi SDK 0.83.0 — see provenance artifact §1–§3) and
  stage 0 isolation PASS. But the integrated composition FAILED from stage 1
  onward (see §4), so AC1's real-Pi behavior leg is not proven at this
  boundary.
- **T06-AC2 (executionId through detached output/read/terminal/reconnect/
  control): R-FAILED.** Stage 2 (detach+reconnect hydration) and stage 4
  (batch completion + read RPC) never reached their assertions — no managed
  admission.
- **T06-AC3 (progress, terminal-before-cleanup, cancellation, watchdog
  handoff, truthful diagnostics): R-FAILED at the integrated leg.** Stage 3
  cancellation timed out awaiting admission. The dedicated containment leg
  (leg 3) DID produce real positive evidence — its `T03_REAL_PI_EVIDENCE`
  line records admissions=1, delegatedModelRequests=1,
  extensionSteerEmissions=1 (one real steer through the pinned extension),
  journal sequences [1,2,3,40], full band ordering 74→75→77→78 with
  proven-76 fence and stale-terminal ignored — but the leg itself then timed
  out at the survivors-recording step and exited 1.
- **T06-AC4 (restart/reconnect truth, no auto replay, explicit Resume):
  R-PARTIAL via legs 4–5.** `piSubagentRestartAcceptance.test.ts` executed its
  real-Pi test (T10-AC3/AC1/AC5: live bridge refresh, orphan view, late fenced
  terminal ignored) exit 0; `piSubagentResumeAcceptance.test.ts` executed its
  real-Pi test (T14-AC1/AC4/AC6: exactly one explicit resume, no implicit
  resume) exit 0. The integrated stage-5 no-auto-replay row inside leg 1 did
  not run to assertion (timed out awaiting admission).
- **T06-AC5 (stale attempt/generation and duplicate control fenced):
  R-MIXED.** Unit-simulation rows inside leg 2 (7 passed) cover fencing
  logic but are simulation-class within the R file; the real-Pi F5 steer-race
  rows (terminal-first, enqueue-first) timed out — exit 1.
- **T06-AC6 (three-leg destructive split): R leg ends at band-74 handoff —
  explicitly no destructive claim.** Leg 1's stage 6 timed out before its
  bands; leg 3's journal reached durable bands 74/75/77/78 and a fenced
  proven-76 write, i.e. real-Pi-through-handoff plus repository band
  fencing, and NOTHING beyond: no zero-owned-child claim, no band-76
  destructive claim, no PID enumeration or signalling was performed or is
  claimed anywhere in this record. WP-03 remains the sole M authority for the
  zero-owned-child destructive leg; the manual test was excluded from every
  producer by explicit env removal and skipped exactly as designed.
- **T06-AC7 (stage + stable diagnostics on every failure; mock-only success
  impossible): R-PARTIAL.** Failure diagnostics WERE produced with stage
  labels (e.g. `T17-AC4 stage 4 failed: …; modelRequests=[…]`,
  `pi_subagent_watchdog_t17_stage6_guard`), and the only fixture is the
  loopback model endpoint — provider fakes cannot satisfy the file because
  the card/journal truth flows through the real adapter/bridge/repository
  chain and stage 0 pins the real extension tree. However, the systematic
  extension-load failure (§4) means the negative controls (stage 7
  bridge-absent vs capability-mismatch) could not be discriminated in leg 1 —
  itself a truthful diagnostic, but not the designed discrimination proof.

## 4a. Attempt-1 classification and durable artifact naming

- Attempt-1 raw logs of the three failed legs are durably preserved as
  `WP-02-attempt-01-realpi-acceptance.log`,
  `WP-02-attempt-01-canonical-identity-acceptance.log`, and
  `WP-02-attempt-01-lifecycle-containment-realpi.log` (byte-identical to the
  originally recorded runs; preservation-time SHA-256:
  realpi `c666c1e644bcd4c2dd74cb14a4bff177ac540b22c8290af3c40da3ed492f24f2`,
  canonical `8543253556bf745a7fa3480582f42281e1189e4501d12e696d06b9158949876c`,
  lifecycle `14c505321efc374a32fda4c75dbfc299c86742499c38ab764fe4be152d9a93cd`).
  They are environment/runner evidence and must never be overwritten or
  deleted.
- The two passing logs keep their canonical names
  (`WP-02-restart-acceptance.log`, `WP-02-resume-acceptance.log`), remain
  unchanged, and are reusable as final WP-02 evidence for their legs.
- Attempt 1 does NOT count as a behavioral PASS for any of the three failed
  legs, and no completion of WP-02 is claimed from attempt 1.

## 4b. Source-grounded correction and authorized corrected attempt (exactly one — SPENT, see §4c)

Owner-resolved correction (full contract: WP-02 §"Attempt 2"; PLAN §7a):

1. **Bounded environment preparation, not an Alfie source/pin change.** The
   pristine `/tmp/alfie-t06` worktree lacks extension-local `node_modules`
   (gitignored by `agent/extensions/pi-subagents/.gitignore`); the extension
   package ships `package-lock.json` and loads from
   `"pi": {"extensions": ["./src/index.ts"]}`, so its runtime deps
   (`@sinclair/typebox`, `croner`, `nanoid`, `yaml`) must exist at install
   time. The provenance verifier
   (`apps/server/src/provider/piSubagentRealPiAcceptanceHelpers.ts:561–580`)
   explicitly filters `node_modules` lines out of `git status --porcelain`,
   so installing them is invisible to provenance and clean-status gates:
   `cd /tmp/alfie-t06/agent/extensions/pi-subagents && npm ci`, exactly once,
   followed by the zero-tracked-delta proof defined in WP-02 §"Attempt 2"
   item 1. No tracked Alfie byte changes; no other install target.
2. **Node runner for all three corrected legs.** Attempt 1's canonical and
   lifecycle legs each ended with uncaught Effect `SocketCloseError`
   uncaught exceptions (schema `Expected number, got undefined` at ["code"])
   from the harness dispose path (`piSubagentRealPiAcceptanceHelpers.ts:2151`)
   under Bun 1.3.12 — a Bun WebSocket-close schema artifact, distinct from
   the behavioral timeouts. The corrected attempt uses the supported Node
   v24.14.1 for ALL THREE rerun legs (root `engines.node ^24.13.1`,
   `apps/server` `>=24.10`, `node:sqlite` policy already Node-based),
   commands identical to WP-02 §"Exact commands" with `node
   ../../node_modules/vitest/vitest.mjs` as runner.
3. **No-concurrent-tool producer window.** Attempt 1's only remaining
   integrated-leg failure mode — the user-Pi-home digest — was bounded to
   `~/.pi/agent/fff/frecency/data.mdb` (mtime = teardown minute; Pi FFF
   frecency index written by concurrent agent-tool use, outside the
   harness). The corrected producer window therefore forbids ALL concurrent
   FFF/semantic/search or other agent-tool activity by the executing
   worker: after launching each of the three rerun commands, the worker
   only waits for that command; no inspection or search until it exits.
   The executing worker must record this discipline in the corrected
   disposition.
4. **Scope:** only the three failed legs rerun, exactly once each, serially,
   after the `npm ci`; corrected-attempt logs take the original canonical
   WP-02 names; stop gates per WP-02 §"Attempt 2" item 6. The option list
   below (the original challenge question) was answered with option (a) in
   this bounded form, with `npm ci` (lockfile-pinned, provenance-excluded)
   chosen over `bun install`, and options (b)/(c) rejected.

## 4c. Corrected-attempt (attempt 2) outcome — integrated leg, challenge record

The exactly-one authorized corrected attempt (WP-02 §"Attempt 2", PLAN §7a)
ran 2026-08-28. Scope executed: environment preparation + the integrated leg
only. No canonical-identity or lifecycle-containment corrected leg ran in
attempt 2; the restart/resume PASS logs remain unchanged.

1. **Environment preparation — PASS.** `cd /tmp/alfie-t06/agent/extensions/pi-subagents
   && npm ci` succeeded (exactly once; no second install). Post-install proof:
   only gitignored `node_modules` in `git -C /tmp/alfie-t06 status
   --porcelain`; zero tracked delta; HEAD still `3fe340b4` detached; fixture
   hashes and clean-status invariants preserved.
2. **Integrated leg rerun (Node v24.14.1, exactly once) — FAILED, exit 1.**
   Command per WP-02 §"Attempt 2" item 2 (cwd /tmp/symphony-t06/apps/server,
   ALFIE_REPO_DIR=/tmp/alfie-t06, `env -u SYNARA_T17_MANUAL_TEARDOWN`,
   pipefail + PIPESTATUS[0], tee to `WP-02-realpi-acceptance.log`).
   No-concurrent-tool producer window observed. Start 13:33:00 local,
   Duration 62.26s. Result: **8 passed, 1 failed (teardown user-Pi-home
   digest), 1 skipped (only the MANUAL T17-AC6 destructive test, by design)**,
   exit 1. The managed behavioral pipeline is now FUNCTIONING: managed
   capability negotiation, detach/reconnect, cancellation, batch completion,
   restart generation bump, and watchdog handoff stages all passed — the
   attempt-1 extension-load and Bun `SocketCloseError` failures are gone.
3. **Root cause of the sole failure (exact, source-grounded).** The only host
   path changed in-window was `~/.pi/agent/fff/frecency/data.mdb` (mtime at
   producer start). User `~/.pi/agent/settings.json` enables
   `npm:@ff-labs/pi-fff`; the harness snapshots `os.homedir()` before setting
   ONLY `PI_CODING_AGENT_DIR` and `PI_HOME`
   (piSubagentRealPiAcceptanceHelpers.ts:1541–1553) and anchors the digest
   walk at `os.homedir()/.pi` (helpers :488–549), so the outer Vitest process
   still discovered user Pi settings and the harness-launched Pi loaded Pi
   FFF, whose frecency write landed in the user `~/.pi` tree outside every
   harness-owned dir (test assertions: piSubagentRealPiAcceptance.test.ts:157–185
   snapshot before harness, :1864–1878 teardown digest equality).
   `harness.envWasRestored()` was true; dispose was idempotent; the owned temp
   root was removed. This is external-tool state, NOT a Symphony harness
   write-path violation; NO destructive or user-content-mutation claim is made.
4. **Evidence preservation.** Corrected-attempt raw log preserved byte-identical
   as `evidence/WP-02-attempt-02-realpi-acceptance.log` — SHA-256
   `cf6db25f045030cb7be2949322820d283c9a32b5bf7459c44051b9ee12a9d1b0`. The
   canonical `WP-02-realpi-acceptance.log` currently holds those same bytes
   and must not be read as a PASS record.
5. **Owner-decision gate (STOP).** The §4b authorization is SPENT. Per WP-02
   §"Attempt 2" item 5, a further attempt requires a fresh owner decision.
   The identified next correction: process-level HOME isolation for the
   Vitest process (fresh temporary outer HOME; removes user Pi settings from
   discovery while `ALFIE_REPO_DIR` and all harness-owned dirs stay
   explicit), covering the integrated leg plus the pending canonical-identity
   and lifecycle-containment corrected legs under Node. Authorization, scope,
   and gating are the owner's decision; this record neither requests-executes
   nor presumes it.

## 4. Failing-row detail and differential root-cause evidence (challenge package)

**Observed vs required (leg 1):** every real-Pi session composed by the
production graph ran WITHOUT the pinned Alfie extension's tools —
`hasAgentTool:false` on every model request, `delegated:false`, managed
negotiation `isManaged=false` (required `managed_enabled`/`managed-spawn`),
and the stripped-capability control read as `bridge_absent` (required
`capability_mismatch`). Minimum gap: the extension module fails to load in
real child/parent sessions launched from the isolated composition.

**Differential evidence gathered after the runs (no files modified; reads
only):**

- Alfie pins the extension's entry via `package.json` → `"pi": {"extensions":
  ["./src/index.ts"]}`; `src/index.ts` imports bare packages
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` (aliased by the
  SDK loader) AND `@sinclair/typebox` plus ext-local runtime deps declared in
  `agent/extensions/pi-subagents/package.json` (`@sinclair/typebox`,
  `croner`, `nanoid`, `yaml`).
- `/tmp/alfie-t06` (fresh detached worktree at `3fe340b4`) has **no
  `node_modules` anywhere**: not ext-local (gitignored by
  `agent/extensions/pi-subagents/.gitignore`), not at the repo root (the
  Alfie repo has no root install in the worktree). Its `dist/` contains only
  the 2 tracked files (`invocation-config.js`, `ui/agent-widget.js`);
  `index.js` re-exports `./dist/index.js`, which exists only as a gitignored
  build output.
- `/Users/anhpham99/alfie` (user checkout) HAS ext-local `node_modules`
  (98 packages incl. `@sinclair/typebox@0.34.49`, `croner`, `nanoid`, `yaml`,
  `@earendil-works/*@0.83.0`) and a fully built `dist/` — both gitignored
  build/install outputs dated 2026-08-05.
- Ticket 05's passing real-Pi legs ran with
  `ALFIE_REPO_DIR=/Users/anhpham99/alfie` (recorded verbatim in
  `plans/05-restart-reconnect-resume-and-crash-diagnostics/evidence/
  WP-02-nondestructive-real-pi-disposition.md` and the WP-02 report), i.e.
  they implicitly consumed those gitignored outputs. Ticket 06's plan
  (§6) redirects `ALFIE_REPO_DIR` to the pristine detached worktree, which
  byte-matches every tracked/hashed surface but lacks exactly the untracked
  runtime state the extension needs to load.

**Why legs 4–5 passed under the same condition:** their real-Pi flows do not
require the extension's Agent/steer tools to register in the child session
(restart reconciles durable bridge truth; resume creates the new attempt
through the coordinator), so they complete without extension load. This is
consistent with, and does not contradict, the root-cause hypothesis.

**Exact material question for the owner/main agent (RESOLVED — see §4b):**
the Ticket 06 plan requires the isolated pinned Alfie worktree as the
controlled provider boundary, but that boundary as planned cannot load the
extension (missing gitignored ext-local `node_modules`/built `dist`), while
the previously accepted Ticket 05 method used the user checkout. The
question was decided with option (a) in its bounded, lockfile-pinned,
provenance-excluded form (`npm ci` only; no extension build, no Bun
install; details and constraints in §4b and WP-02 §"Attempt 2"); options
(b) and (c) were rejected. The original option text is preserved below for
the decision record:
(a) authorize a bounded environment-preparation step inside `/tmp/alfie-t06`
only (e.g. `bun install --frozen-lockfile` at the extension dir and/or an
extension build), keeping all 5 fixture hashes and clean-status invariants
intact (gitignored outputs only; zero tracked delta), then re-run the three
failed legs under a renewed WP-02 contract; or
(b) amend the plan's controlled-provider boundary to point
`ALFIE_REPO_DIR` at the user checkout as Ticket 05 did, accepting its
weaker isolation and recording the difference; or
(c) treat the composition as environmentally unsatisfiable at this boundary
and renegotiate the acceptance path.
No source/test/harness/fixture/config/manifest/lockfile change is proposed or
implied by this record; option (a) required an explicit owner authorization
because the WP-02 prohibited-changes list forbids modifying Alfie — granted
in the bounded §4b form above.

## 5. Boundary statements (mandatory)

- The destructive leg was NOT run here. No zero-owned-child or band-76
  destructive claim is made or implied by any artifact of this WP. WP-03 is
  the sole authority for M evidence.
- The historical 2026-08-20 manual operator run is H (supporting-only) and is
  NOT used as acceptance evidence here.
- AC6's R leg ends at the band-74/77/78 handoff and fenced band-76 repository
  ordering observed by leg 3; nothing destructive is claimed beyond it.
- No automatic replay or Resume was introduced or observed; no provider
  bootstrap was added; evidence classes D/R/M/H remain separate.
- No commit was created by the attempt-1 run itself; this correction/
  failure-evidence package (PLAN §7a, WP-02 §"Attempt 2", this disposition,
  provenance, and the five attempt-1/current logs) is committed FIRST, so
  the failure evidence is durable before any corrected-attempt rerun.
  Corrected-attempt evidence commits afterwards under the WP-02 boundary.

## 6. Remaining gate

WP-02 (five legs exit 0 — restart/resume PASS from attempt 1; integrated leg
FAILED in attempt 2 on the external FFF digest interference with all managed
stages passing; canonical-identity and lifecycle-containment corrected legs
NOT yet rerun) → a FRESH owner decision is required before any attempt 3
(process-HOME-isolated run covering the three corrected legs under Node) →
then WP-03 (owner-authorized exactly-one manual destructive run) → WP-04
quality gate + Implementation Report → WP-05 integrated review → WP-06
Supervisor acceptance → WP-07 closure.
