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
| T21-AC7 | Capability gate runs before any health handling; the wrapper is installed only for managed sessions | Real-extension test: legacy session (no extension) on the degraded adapter starts and probes `bridge_absent`/`isManaged === false` with zero admission events and zero durable rows; coordinator test: `bridge_absent` and `capability_mismatch` sessions rejected as unmanaged with zero durable writes while degraded, health untouched | Passed |

### Failure and diagnostic evidence

| Injected failure | Health state | Child starts | Projected state | Diagnostic code | Recovery result |
| --- | --- | --- | --- | --- | --- |
| `recordAdmission` fails (session A, first command) | degraded (1 transition) | 0 | no row, no journal | `pi_subagent_lifecycle_persistence_failed` | — |
| Same outage, second fresh command (session A) | stays degraded (no new transition) | 0 | no row | `pi_subagent_lifecycle_persistence_failed` | — |
| Same outage, fresh command on session B (shared adapter health) | stays degraded | 0 | no row | `pi_subagent_lifecycle_persistence_failed` | — |
| 4 concurrent fresh commands during outage (coordinator) | stays degraded (1 transition total) | 0 | no rows | `pi_subagent_lifecycle_persistence_failed` per caller | probes serialized (`maxInFlight === 1`) |
| Store recovers; fresh command on session B | available (1 recovery transition) | 1 (exactly one child transcript) | exactly one `accepted` execution + sequence-1 journal for that command | `pi_subagent_managed_enabled` | admitted; rejected commandIds never replayed |
| Provider mismatch while degraded (coordinator) | stays degraded | 0 | no row | `pi_subagent_admission_provider_mismatch` (degraded health does not mask authorization) | — |
| Legacy/unhandshaked capability while degraded | stays degraded | n/a (legacy path) | zero durable writes | `pi_subagent_bridge_absent` / `pi_subagent_capability_mismatch` | — |

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
real-extension suite).

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
  `piSubagentRealExtension.test.ts` 10 — baseline 9, +1 new;
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
  `bridge_absent` (never managed), and created no managed truth.

A coordinator-only test is insufficient for this ticket; the real-extension
test above is the primary AC1/AC2/AC3/AC5/AC6/AC7 evidence, complemented by the
coordinator seam for deterministic waiter/single-flight/concurrency mechanics.

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

### Commits

- Symphony isolated worktree `/private/tmp/t21-symphony`, branch
  `t21-production-fail-closed-control-health`, parent `991bd616`:
  - `25437ecb` — "fix(pi): enforce fail-closed shared control health with
    admission-driven recovery (issue 21)" (production + tests).
  - this report commit — "docs(planning): complete issue 21 implementation
    report".
  - Final working-tree status: clean (`git status` empty). Not pushed.
- The canonical `/Users/anhpham99/symphony` checkout was never modified,
  staged, committed, or reset. Alfie source (`2a3f69bd6`) is unchanged and
  clean.

### Reviewer handoff

```bash
cd /private/tmp/t21-symphony
export PATH="$HOME/.bun/bin:$PATH"
export ALFIE_REPO_DIR=/Users/anhpham99/alfie   # pinned 2a3f69bd, clean

# 1. Degrade → child never starts → one safe warning (real Agent boundary)
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
