# 21 — Production fail-closed control health

**What to build:** When managed lifecycle persistence becomes unavailable, the
production control plane records degraded health and rejects every new managed
admission before child start. Existing execution truth remains unchanged.
After durable writes recover, health returns to available and a fresh command
can be admitted without replaying prior rejected work. Legacy behavior remains
available but is never represented as managed.

**Blocked by:** 20 — Atomic authorized production admission.

**Status:** completed

- [x] **T21-AC1:** A persistence failure at requested or accepted lifecycle
      commit prevents actual child start and returns a stable persistence
      diagnostic at the production Agent boundary.
- [x] **T21-AC2:** Failed admission projects neither accepted nor running state,
      and atomic rollback leaves no partial execution or journal truth.
- [x] **T21-AC3:** Production managed control health becomes degraded and
      prevents subsequent managed admissions while persistence remains unavailable.
- [x] **T21-AC4:** Existing running, orphaned, and terminal aggregates and
      journal entries are unchanged during degraded admission.
- [x] **T21-AC5:** Recovery returns health to available and admits one fresh
      command without replaying rejected commands or duplicating children.
- [x] **T21-AC6:** Health and rejection diagnostics are observable through an
      existing stable operator/runtime surface without leaking prompt or result
      content.
- [x] **T21-AC7:** Legacy sessions remain usable according to negotiated policy
      and are never mislabeled managed, durable, or restart-recoverable.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T21-AC1, T21-AC2, T21-AC3, T21-AC5:** Highest production Agent admission
  boundary with durable-store fault injection and recovery.
- **T21-AC4:** Durable aggregate snapshot before/during/after degradation —
  prove byte-for-byte or field-equivalent preservation of existing truth.
- **T21-AC6:** Existing operator/runtime observation boundary — verify stable
  diagnostics and forbidden content.
- **T21-AC7:** Managed-capability boundary comparing compatible and legacy
  sessions during degraded persistence.

## Implementation Report

**Implementation state:** completed

### Delivered scope

Degradation is **entered** by the first failed atomic durable admission write
(`recordAdmission`) at the production admission boundary: control health
transitions `available → degraded` exactly once, the offending command is
rejected before child start with the stable
`pi_subagent_lifecycle_persistence_failed` diagnostic, and no execution or
journal row is projected. Degradation is **observed** through one adapter-lifetime
`PiSubagentControlHealth` controller that `makePiAdapter` auto-creates and
shares across every Pi session (`options.controlHealth` remains the explicit
test override), plus one bounded `runtime.warning` per status change on the
existing provider runtime-event operator surface. While degraded, **recovery is
admission-driven and single-flight**: every fresh managed command enters the
shared recovery gate; the gate holder re-reads health and, if still degraded,
executes its own normal atomic `recordAdmission` as the durable recovery probe
(authorization is evaluated first, so degraded health can never mask an
authorization diagnostic). A failing probe keeps health degraded, rejects that
command (no child, no row, no new transition); a succeeding probe marks health
available and admits that same fresh command. Waiters re-read health and then
perform their own normal admissions. Recovery and degradation are **kept
separate from execution outcomes**: existing running, orphaned, and terminal
aggregates and journals are field-equivalent across degradation, and no
rejected command is ever auto-replayed — only a fresh command recovers and only
it is admitted. Legacy/unhandshaked sessions bypass control health entirely and
remain usable during degradation. There is no timer, no background probe, no
auto-replay, no schema/migration/contract change, and no Alfie source change.

### Changed production call chain

```
Actual Agent tool invocation (real Pi extension, loaded from disk)
   │
   ▼
PiAdapter wrapAgentTool
   ├─ makePiAdapter: ONE adapter-lifetime control-health controller
   │  (auto-created; options.controlHealth = test override)
   ├─ admitSubagentSpawn({ controlHealth: adapterControlHealth,
   │                       onHealthTransition: offerSubagentControlHealthWarning })
   │    ├─ 1. capability handshake (legacy bypasses everything; T21-AC7)
   │    ├─ 2. control health
   │    │     ├─ available → normal managed admission
   │    │     └─ degraded → withRecoveryProbe (single-flight gate)
   │    │           ├─ re-read health
   │    │           ├─ still degraded → this command IS the recovery probe
   │    │           └─ recovered by a concurrent probe → normal admission
   │    ├─ runManagedAdmission
   │    │     ├─ provider authority / ownership / projection / approval /
   │    │     │  subject authority (unchanged, T20)
   │    │     └─ recordAdmission (atomic journal seq-1 + execution row)
   │    │           ├─ failure → markDegraded (one transition) → REJECT
   │    │           │            (no child start, no partial row)
   │    │           └─ success + probe → markAvailable (one recovery
   │    │                        transition) → this same command is ADMITTED
   │    └─ child start ONLY on accepted/already-applied identities (unchanged)
   ▼
offerSubagentControlHealthWarning (transition only)
   → bounded runtime.warning scoped to the admission thread
     (from/to status, diagnostic code, timestamp; nothing else)
   → existing provider runtime-event pipeline (operator stream/journal)
```

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result  |
| --------- | --------------- | --------------------- | ------- |
| T21-AC1 | Coordinator `runManagedAdmission` rejects on `recordAdmission` failure before the adapter ever invokes the child; PiAdapter wrapper returns the terminal error and never calls `originalExecute` | Real-extension test: injected `recordAdmission` fault at the production boundary → tool result is an error containing `pi_subagent_lifecycle_persistence_failed`, zero child transcript files, `recordAdmissionAttempts === 1` | Passed |
| T21-AC2 | `recordAdmission` is one transaction (T20); the failure path returns before any child or projection effect; rejected identity is `exec_rejected_*` with no durable row | Real-extension test: `listByThreadId` empty after failed admission; coordinator test: `getByCommandId` empty for both degraded commands; T20 repo mid-transaction rollback test unchanged and passing | Passed |
| T21-AC3 | `makePiAdapter` auto-creates one shared adapter-lifetime health controller; degraded admissions re-prove the outage via the single-flight probe and fail closed | Real-extension test: second fresh command on session A and a fresh command on session B (same adapter) both rejected with the same stable diagnostic, no children; coordinator tests: repeated and 4-way concurrent degraded admissions all rejected, `recordAdmissionAttempts` counted per probe, `maxInFlight === 1`, exactly one degraded transition | Passed |
| T21-AC4 | Degraded admission performs only its own atomic write; it never rewrites existing aggregates or journals | Coordinator test (durable snapshot seam via repository reads): running + orphaned + succeeded aggregates and journals captured before are `toEqual` after two degraded admissions (field-equivalent), zero rows for the degraded commands | Passed |
| T21-AC5 | `withRecoveryProbe` single-flight gate + `markAvailable` on probe success admits the same fresh command; waiters re-read health; nothing replays rejected commandIds | Real-extension test: after the store recovers, session B's fresh command is admitted (`exec_*`/`att_*`/generation 1), exactly one child transcript file, one recovery transition scoped to thread B, rejected commands have no rows, post-recovery admission adds no transition; coordinator tests: probe admits + marks available once, no rejected row created; concurrent waiter re-reads available health, gets its own execution, no second recovery transition | Passed |
| T21-AC6 | `offerSubagentControlHealthWarning` emits a bounded `runtime.warning` only on transitions with `detail = {from,to,diagnosticCode,occurredAt}`; adapter passes `onHealthTransition` to admissions | Real-extension test: exactly one degraded warning and one recovery warning on the operator event stream, scoped to the driving thread, message/detail assertions; serialized payload contains neither the prompt marker, `SQLITE`, the injected outage message, nor the rejection-reason prefix | Passed |
| T21-AC7 | Capability gate runs before any health handling; the wrapper is installed only for managed sessions | Real-extension test: legacy session (no extension) on the degraded adapter starts and probes `bridge_absent`/`isManaged === false` with zero admission events and zero durable rows; the ACTUAL legacy Agent tool is then executed at the approved managed-capability seam during the same degraded window (real production extension loaded from disk, provenance-asserted, no Synara admission wrapper installed) — it answers normally (`started in background` + extension-minted `Agent ID`, one child transcript file) with **no** `executionId`/`attemptId`/`generation` on the result, **no** `managedExecution` on the child transcript, no `exec_`/`att_` identity anywhere in the result or transcript, no restart/durable claim, zero admission events, zero repository writes, and no control-health transition; coordinator test: `bridge_absent` and `capability_mismatch` sessions rejected as unmanaged with zero durable writes while degraded, health untouched | Passed |

### Failure and diagnostic evidence

| Injected failure | Health state | Child starts | Projected state | Diagnostic code | Recovery result |
| --- | --- | --- | --- | --- | --- |
| `recordAdmission` fails (session A, first command) | degraded (1 transition) | 0 | no row, no journal | `pi_subagent_lifecycle_persistence_failed` | — |
| Same outage, second fresh command (session A) | stays degraded (no new transition) | 0 | no row | `pi_subagent_lifecycle_persistence_failed` | — |
| Same outage, fresh command on session B (shared adapter health) | stays degraded | 0 | no row | `pi_subagent_lifecycle_persistence_failed` | — |
| 4 concurrent fresh commands during outage (coordinator) | stays degraded (1 transition total) | 0 | no rows | `pi_subagent_lifecycle_persistence_failed` per caller | probes serialized (`maxInFlight === 1`) |
| Store recovers; fresh command on session B | available (1 recovery transition) | 1 (exactly one child transcript) | exactly one `accepted` execution + sequence-1 journal for that command | `pi_subagent_managed_enabled` | admitted; rejected commandIds never replayed |
| Provider mismatch while degraded (coordinator) | stays degraded | 0 | no row | `pi_subagent_admission_provider_mismatch` (degraded health does not mask authorization) | — |
| Legacy/unhandshaked capability while degraded (adapter session without the extension) | stays degraded | n/a (legacy path) | zero durable writes | `pi_subagent_bridge_absent` / `pi_subagent_capability_mismatch` | — |
| Actual legacy Agent executed during the same outage (real extension, no Synara wrapper) | stays degraded (no transition) | 1 (extension-minted legacy child, one transcript file, no `managedExecution`) | zero repository writes, zero admission events | none (normal legacy `started in background` response) | — |

Operator warnings: exactly two `runtime.warning` events for the whole
degrade→recover arc (`raw.method = "subagents/control-health-transition"`), each
scoped to the admission thread that drove the transition, with bounded
fixed-template messages and `detail = { from, to, diagnosticCode, occurredAt }`.
Forbidden-content assertions prove the serialized payloads contain no prompt
marker, no `SQLITE`/injected-error text, and no rejection-reason text.

### Verification commands and results

All commands run in the isolated worktree `/private/tmp/t21-symphony`
(branch `t21-production-fail-closed-control-health`, parent `991bd616`) with
`PATH="$HOME/.bun/bin:$PATH"` and `ALFIE_REPO_DIR=/Users/anhpham99/alfie`
(Alfie pinned commit `2a3f69bd6`, clean; provenance verified by the
real-extension suite). The conformance-review follow-up (F2/F3) re-ran the
focused ticket-21 suites on current main (`93cac45c` + the follow-up commit)
in the canonical Symphony checkout with the same environment: the 7-file
focused suite above passes (7 files, 81 tests), and the full real-extension
file passes (10 tests) with the legacy Agent leg executing during the
degraded window.

```
# Focused ticket suites (red demonstrated before each minimal green slice)
bun run --cwd apps/server test \
  src/provider/piSubagentControlHealth.test.ts \
  src/provider/piSubagentAdmissionCoordinator.test.ts \
  src/provider/piSubagentRealExtension.test.ts \
  src/provider/piSubagentSession.test.ts \
  src/provider/piSubagentBridge.test.ts \
  src/provider/piSubagentAdmissionGuard.test.ts \
  src/persistence/Layers/PiSubagentExecutionRepository.test.ts
```

- Result: **7 files, 81 tests passed** (per file:
  `piSubagentControlHealth.test.ts` 6 — baseline 3, +3 new;
  `piSubagentAdmissionCoordinator.test.ts` 33 — baseline 26, +7 new;
  `piSubagentRealExtension.test.ts` 10 — baseline 9, +1 new (the ticket-21
  scenario test additionally executes the actual legacy Agent during the
  degraded window per review F2);
  `piSubagentSession.test.ts` 10; `piSubagentBridge.test.ts` 8;
  `piSubagentAdmissionGuard.test.ts` 6;
  `persistence/Layers/PiSubagentExecutionRepository.test.ts` 8 — unmodified).
  All pre-existing tests retained and passing.
- Red-first evidence (focused runs before the matching minimal green):
  - health unit tests: 3 failed (`transition` assertions,
    `withRecoveryProbe is not a function`) before the controller change;
  - coordinator tests: 3 failed (probe evidence `expected 1 to be 2`,
    provider-mismatch masking) before the coordinator restructure;
  - recovery tests: 2 failed with the probe-recovery marking reverted
    (`expected available`, missing recovery transition) and 6 failed with the
    degraded branch reverted to the baseline short-circuit;
  - real-extension test: 1 failed (`expected [] to have a length of 1`) before
    the adapter wiring — no `runtime.warning` transitions existed.
- Full apps/server suite: `bun run --cwd apps/server test` →
  **365 files passed | 3 skipped (368); 4250 tests passed | 17 skipped (4267);
  exit 0** (≈296 s).
- Full workspace suite: `bun run test -- --env-mode=loose` →
  **8/8 turbo tasks, exit 0**: contracts 214, scripts 86, shared 534,
  desktop 568, web 3881, server 4250 (17 skipped).
  (Note: a first root run without `--env-mode=loose` failed only the
  real-extension suite because turbo's strict env mode dropped
  `ALFIE_REPO_DIR`; the same suite passes when the variable reaches the task.)
- Typecheck: `bun run --cwd apps/server typecheck` → **75 pre-existing errors
  on the touched packages, 0 new** (baseline at `991bd616`: 77 in apps/server;
  the ticket-21 work fixed the 2 pre-existing
  `piSubagentControlHealth.ts` `exactOptionalPropertyTypes` errors and added
  none; the remaining coordinator/PiAdapter/repository/contract errors are
  line-shifted pre-existing baseline errors). Root `bun typecheck` still fails
  in `@synara/contracts` on 12 pre-existing baseline errors in
  `packages/contracts/src/piSubagents.test.ts` (unchanged files, present at
  `991bd616`) — recorded as the pre-existing typecheck blocker, not introduced
  by this ticket.
- `bun fmt` / `bun lint`: not run (not authorized).

### Final canonical verification (report finalization)

All evidence above was re-confirmed at the final main HEAD in the canonical
checkout `/Users/anhpham99/symphony` using the exact Decision 0001 command
forms. Results are exact; no source or test file changed in this pass — the
only change is this report.

- **Exact root test command** — `PATH=$HOME/.bun/bin:$PATH bun run test`
  run from the exact repository root at final HEAD `94ec9e46`:
  **8/8 Turbo tasks passed, exit 0**. (Note: the first attempt at this exact
  command aborted before any test executed because the background shell's
  `PATH` did not yet contain the package-manager binary, so `bun` was not
  found; retrying with the `PATH` prefix set — exactly as written above —
  passed. This is an environment/invocation note, not a code or test
  failure, and no suite result was affected.)
- **Server summary at final HEAD** (`bun run --cwd apps/server test`):
  **365 files passed / 3 skipped (368); 4250 tests passed / 17 skipped
  (4267); exit 0; total 5m22.854s.**
- **Focused ticket suite** (the 7 files listed above) run independently at
  final HEAD: **7 files, 81 tests passed** — unchanged from the candidate and
  follow-up runs.
- **Typecheck at final HEAD:** root `bun typecheck` still exits **2** at the
  same unchanged location — `packages/contracts/src/piSubagents.test.ts`,
  **12 baseline errors** (pre-existing; `packages/contracts` is byte-unchanged
  since `991bd616`). Direct `tsc --noEmit` on apps/server with the same
  installed toolchain produced **75 errors at final HEAD vs 78 on a detached
  `991bd616` baseline worktree** (net −3, all attributable to this ticket's
  `piSubagentControlHealth.ts` fix, 2 → 0). Per-file ticket-relevant counts
  remained at baseline — PiAdapter 3, coordinator 3, real-extension test 11 —
  and **no new ticket-related error was introduced**.
- **`bun fmt` / `bun lint`: still not run — not explicitly authorized.**
- Status semantics: this report records implementer evidence only; owner /
  Supervisor acceptance is a later, separate step and is not claimed here.

### Migration compatibility evidence

No schema or migration change. The accepted ticket 18 migration lineage
(Decision 0002, Symphony `42694412`, migrations 090–099) and ticket 20's
migration 100 remain the terminal lineage; all migration suites pass unchanged
in the full run above (`Migrations`, `MigrationReplay`,
`MigrationLineageReconciliation`, and the lineage checker are included in the
apps/server suite). Ticket 21 adds only adapter-lifetime in-process control
state — durable truth shapes and the atomic admission transaction are
untouched, so released databases remain compatible by construction.

### Real-Pi evidence

The production Agent boundary was exercised against the actual
`@alfie/pi-subagents` extension loaded from disk (Git origin, pinned HEAD
`2a3f69bd6af47dda4ef1966eaa709d47cc0d7d39`, clean extension path, package
identity `@alfie/pi-subagents@0.10.0-alfie.1`, SHA-256 manifest — asserted by
the suite's provenance checks):

- **Persistence failure prevents child start (AC1/AC2):** with the atomic
  `recordAdmission` fault injected at the repository seam, the real Agent tool
  call returned a terminal error carrying `pi_subagent_lifecycle_persistence_failed`;
  the real extension wrote **zero** child transcript output files and the
  durable store held zero executions for the thread.
- **Shared degradation across sessions (AC3):** a second managed Pi session on
  the same adapter was rejected with the same stable diagnostic while the store
  was unavailable; still no child artifacts.
- **Admission-driven recovery (AC5):** once durable writes recovered, a fresh
  command on that second session was admitted with server-minted
  `exec_*`/`att_*`/generation 1 identities and the real child started exactly
  once (exactly one new child transcript output file); the previously rejected
  commands produced no executions and no children (no auto-replay).
- **Operator surface (AC6):** the adapter's runtime-event stream carried
  exactly one degraded and one recovery `runtime.warning`, each scoped to the
  driving thread, with safe metadata only.
- **Legacy usability (AC7):** a session started in an agent dir without the
  extension remained fully usable on the degraded adapter, negotiated
  `bridge_absent` (never managed), and created no managed truth. During that
  same degraded window the ACTUAL legacy Agent tool was executed directly at
  the approved managed-capability seam: a real Pi session loading the same
  proven production extension from disk (Git origin, pinned `2a3f69bd6`,
  package identity and SHA-256 manifest asserted), with **no Synara admission
  wrapper installed** (`__synaraAdmissionWrapped` absent on the tool entry and
  its definition), drove the extension's own legacy spawn path. It returned a
  normal legacy response (`started in background` with an extension-minted
  `Agent ID`), started exactly one child whose transcript was written without
  any `managedExecution` label, carried no `executionId`/`attemptId`/
  `generation` on the tool result, no `exec_`/`att_` identity and no restart or
  durable-recovery claim in either the result or the child transcript, fired
  zero admission events, attempted zero `recordAdmission` writes, left all
  durable execution tables empty, and produced no control-health transition.
  Legacy execution is therefore proven usable and unlabeled while managed
  health is degraded, not merely negotiated as unmanaged.

A coordinator-only test is insufficient for this ticket; the real-extension
test above is the primary AC1/AC2/AC3/AC5/AC6/AC7 evidence — including an
actual legacy Agent execution during the degraded window (AC7) — complemented
by the coordinator seam for deterministic waiter/single-flight/concurrency
mechanics and the control-health unit seam for deterministic transition
idempotency/single-flight mechanics (both permitted lower seams; see
Deviations).

### Deviations and remaining risks

- **Requested-phase commit (AC1):** the admission phase durably records one
  atomic sequence-1 `accepted`/`rejected` event (accepted T20 interpretation,
  Decision 0004 recorded risk 5). There is no separate `requested`-phase write
  yet; the durable queue phase (later tickets) owns that period. The AC1 fault
  surface is therefore the accepted/rejected lifecycle commit, which is the
  only lifecycle write that exists at this boundary today.
- **Coordinator seam retained (permitted boundary substitution):** concurrent
  waiter/single-flight interleavings and 4-way concurrent degradation cannot be
  induced deterministically at the real Agent boundary; per Decision 0001 these
  are covered at the admission-coordinator seam while the real boundary keeps
  the end-to-end degrade/reject/recover arc.
- **Control-health unit tests are deterministic lower-seam support, not primary
  evidence (permitted boundary substitution, review F3):** the
  `piSubagentControlHealth.test.ts` unit tests exercise the shared health
  controller's transition idempotency (one `available → degraded` and one
  `degraded → available` transition per arc, no duplicate or back-transition)
  and the `withRecoveryProbe` single-flight gate's mutual exclusion under
  concurrent entrants. Both invariants are timing/interleaving properties: a
  real Agent tool call admits at most one probe per command, the public
  boundary serializes admission per session, and the degrade/recover windows
  depend on an injected durable-write fault that the public boundary cannot
  observe or schedule — so the interleavings cannot be induced reliably at the
  public boundary. Per Decision 0001's permitted boundary substitutions, these
  unit tests document that insufficiency, retain the nearest useful
  public-boundary test (the real-extension degrade/reject/recover arc and the
  coordinator concurrency tests), and add only the smallest lower-level test
  required. The real-Pi real-extension test and the operator runtime-event
  surface remain the PRIMARY evidence for AC1/AC2/AC3/AC5/AC6/AC7; the unit
  tests only pin the deterministic mechanics underneath them and would pass or
  fail independently of that boundary evidence.
- **`PiSubagentExecutionRepository.test.ts` not modified:** AC4 is covered at
  its approved durable-snapshot seam inside the coordinator test, which reads
  the same repository snapshot API (`getById`/`listJournalEvents`/
  `listByThreadId`) before/during/after degradation. No additional
  repository-level coverage was needed.
- **Probe semantics on non-admitting durable answers:** a recovery probe that
  resolves `already_applied` or `command_identity_mismatch` proves the store
  answered from durable truth, so health is marked available; the command
  itself still starts no duplicate child (T20 semantics). A probe rejected for
  authorization reasons never reaches the store and cannot recover health.
- **Post-recovery admission serialization:** admissions that arrived while
  degraded and are still parked on the recovery gate perform their normal
  admission inside the gate (serialized) before the queue drains; new arrivals
  after recovery take the normal unserialized path. Bounded to the degradation
  window.
- **Health is adapter-lifetime only:** it is deliberately not persisted and not
  a service; a server restart starts from `available` and the first failing
  durable write re-degrades (T20 restart reconciliation is unchanged).
- **Pre-existing heavyweight-check failures (not introduced here):** root
  `bun typecheck` fails on 12 baseline errors in
  `packages/contracts/src/piSubagents.test.ts` and apps/server carries 75
  baseline errors (77 before this ticket); recorded because the owner has not
  authorized fixing unrelated files in this ticket.
- Not exercised: tickets 22–24 scope (bounded foreground detach, progress/
  heartbeat/saturation, integrated acceptance) — untouched by this change.
- **Conformance-review follow-up (F2/F3), current main `93cac45c`:** the
  independent conformance review accepted production behavior and returned two
  evidence gaps, both closed on main without production changes:
  - **F2 (legacy leg executed):** the real-extension legacy leg previously
    proved only `bridge_absent`/`isManaged === false` negotiation. It now
    directly executes the ACTUAL legacy Agent at the approved managed-capability
    seam while managed health is degraded (real production extension, no Synara
    admission wrapper) and asserts normal legacy usability, no
    `executionId`/`attemptId`/`generation`/`managedExecution` labeling, no
    managed admission or repository write, and no durable/restart-recoverable
    claim — see the AC7 row and the Real-Pi evidence above.
  - **F3 (lower-seam rationale):** the report now states explicitly that the
    control-health unit tests are deterministic lower-seam support for
    transition idempotency and single-flight concurrency, which cannot reliably
    be induced at the public boundary, while the real-Pi/operator tests remain
    primary — satisfying Decision 0001's permitted boundary substitutions (see
    Deviations above). Decision 0004's accepted lack of a separate
    `requested`-phase write is unchanged.

### Commits

- Symphony isolated worktree `/private/tmp/t21-symphony`, branch
  `t21-production-fail-closed-control-health`, parent `991bd616`:
  - `25437ecb` — "fix(pi): enforce fail-closed shared control health with
    admission-driven recovery (issue 21)" (production + tests).
  - report commit — "docs(planning): complete issue 21 implementation
    report" (integrated on main as `93cac45c`, candidate `a029687a`).
  - Final working-tree status: clean (`git status` empty). Not pushed.
- Conformance-review follow-up on main (parent `93cac45c`): one commit adding
  the F2 legacy-Agent execution leg to
  `apps/server/src/provider/piSubagentRealExtension.test.ts` and the F2/F3
  report updates to this file. No production change; not pushed. Integrated
  on main as `94ec9e46`.
- **Final main lineage for this ticket:** `a029687a` (fix) → `93cac45c`
  (implementation report) → `94ec9e46` (F2/F3 follow-up). This report's
  finalization edit (final canonical verification evidence above, this file
  only) is committed as one further **docs-only** commit on top of
  `94ec9e46`; it cannot self-reference its own hash, so it is identified here
  as the *report-finalization commit* and the exact hash is left to git
  history / reviewer handoff.
- Canonical checkout: during implementation the `/Users/anhpham99/symphony`
  checkout was never modified, staged, committed, or reset; at finalization
  it was used read-only for the verification pass above, and the only change
  committed from it is this docs-only report update (working tree clean
  afterward). Alfie source (`2a3f69bd6`) is unchanged and clean. Nothing
  pushed; no commit amended.

### Reviewer handoff

```bash
# Original candidate: /private/tmp/t21-symphony (branch
# t21-production-fail-closed-control-health, parent 991bd616).
# Conformance-review follow-up (F2/F3): verified on current main after
# 93cac45c in the Symphony checkout itself.
export PATH="$HOME/.bun/bin:$PATH"
export ALFIE_REPO_DIR=/Users/anhpham99/alfie   # pinned 2a3f69bd, clean

# 1. Degrade → child never starts → one safe warning; legacy Agent usable,
#    unlabeled, no managed truth (real Agent boundary)
bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts -t "T21-AC1..AC7"

# 2. Repeated + concurrent fail-closed rejection, one degraded transition
bun run --cwd apps/server test src/provider/piSubagentAdmissionCoordinator.test.ts -t "T21-AC1/T21-AC3"
bun run --cwd apps/server test src/provider/piSubagentAdmissionCoordinator.test.ts -t "concurrent fresh commands"

# 3. Existing running/orphaned/terminal truth preserved during degradation
bun run --cwd apps/server test src/provider/piSubagentAdmissionCoordinator.test.ts -t "T21-AC2/T21-AC4"

# 4. Recovery: probe admits the fresh command, waiters re-read, no replay
bun run --cwd apps/server test src/provider/piSubagentAdmissionCoordinator.test.ts -t "T21-AC5"

# 5. Full suites
bun run --cwd apps/server test
bun run test -- --env-mode=loose
```
