# 19 — Complete real-Pi capability negotiation

**What to build:** The actual Pi subagent extension used by Synara exposes the
versioned managed-execution bridge in production, while preserving its legacy
behavior in other hosts. Synara enables managed behavior only when protocol
compatibility and every required capability are proven. Missing, malformed,
failing, partial, or unsupported bridges remain unmanaged with distinct stable
diagnostics.

**Blocked by:** None — can start immediately.

**Status:** ready-for-review

- [x] **T19-AC1:** A production Pi provider session with the actual compatible
      extension negotiates the protocol version and complete capability set.
- [x] **T19-AC2:** Managed mode requires every requested required capability;
      an otherwise successful response missing one fails closed with
      `pi_subagent_capability_mismatch` and lists the missing capabilities.
- [x] **T19-AC3:** Bridge absent, malformed response, bridge failure, unsupported
      version, and missing capabilities produce distinguishable stable diagnostics.
- [x] **T19-AC4:** Probe result is idempotent and stable for the session lifetime
      and is available to the production admission owner.
- [x] **T19-AC5:** No successful negotiation creates an execution, transcript
      message, notification, completion-delivery claim, or model-context change.
- [x] **T19-AC6:** Outside Synara, and inside Synara without successful
      negotiation, the actual extension retains complete legacy Agent behavior.
- [x] **T19-AC7:** Synthetic replacement tools may support lower tests but
      cannot satisfy the production or real-Pi acceptance evidence for this ticket.

## Testing Seams

**Approval status:** Approved — owner approved the remediation breakdown and
known seams on 2026-08-16.

- **T19-AC1, T19-AC2, T19-AC3, T19-AC4, T19-AC5:** Production Pi
  provider-session handshake boundary using the actual extension — exercise
  compatible, partial, malformed, failing, unsupported, and repeated probes.
- **T19-AC2, T19-AC3:** Protocol contract boundary — validate required-set
  inclusion and diagnostic context.
- **T19-AC6:** Actual extension in a non-Synara or bridge-absent host fixture —
  prove legacy tool behavior remains unchanged.
- **T19-AC7:** Test provenance assertion — report whether the invoked Agent tool
  is production extension code or a synthetic fixture and fail acceptance for
  the latter.

## Implementation Report

**Implementation state:** ready-for-review

### Delivered scope

- **Version-controlled extension update (`@alfie/pi-subagents` repository `anhphamwork99/alfie` commit `29a1c1321`, follow-up fix commit `b34255e0c`):**
  - Updated `agent/extensions/pi-subagents/src/index.ts` to expose the versioned Synara Managed-Execution Bridge (`PI_SUBAGENTS_PROTOCOL_VERSION = 1`) via `pi.on("synara:subagents:bridge", ...)`, `pi.on("synara:subagents:handshake", ...)`, and `pi[Symbol.for("synara.pi.subagents.bridge")]`.
  - Truthful capability advertisement: advertises only capabilities backed by callable affordances on the production Agent/AgentManager path (`["managed-spawn", "abort-propagation"]`), omitting roadmap items (`coalesced-progress`, `terminal-outbox`, `restart-reconciliation`, `paginated-transcripts`).
  - Production affordances on `synaraBridge`: implemented callable `spawn: (command) => PiSubagentSpawnResult` wired directly to `manager.spawn(pi, currentCtx, subagentType, delegation, ...)` using the real `AgentManager`, alongside `abort`, `abortAll`, and `getActiveExecutions`.
  - Parent abort signal propagation: wired `signal` parameter into background and queued execution paths in `Agent.execute` and `AgentManager.spawn`/`startAgent`, ensuring both foreground and background children observe parent interruption.
  - Added dedicated bridge unit and integration tests in `test/synara-bridge.test.ts` (9 tests covering handshake, spawn, abort, abortAll, background abort propagation, and legacy parity).
  - Preserved full legacy Agent tool registration, structured 4-field delegation parameters (`task`, `context`, `link_references`, `expected_outcome`), and full 9-field public parameter schema (`subagent_type`, `thinking`, `run_in_background`, `resume`, `isolation`). All 443 unit tests pass in `pi-subagents` (441 baseline + 2 review-follow-up regression tests), hermetically from a clean checkout.
- **Contracts (`packages/contracts/src/piSubagents.ts`):**
  - Added dedicated stable diagnostic code `pi_subagent_bridge_malformed_response` to `PiSubagentDiagnosticCode`.
  - Added `bridge_malformed_response` and `capability_mismatch` status to `PiSubagentNegotiatedCapability.status`.
  - Added schema decoding support for capability mismatch with missing capabilities tracking.
  - Stripped all ticket 04/05/22/23 synthetic coordinator/lease/heartbeat/progress schemas from the Issue 19 surface.
- **Bridge negotiation (`apps/server/src/provider/piSubagentBridge.ts`):**
  - Self-contained implementation without uncommitted coordinator imports.
  - Aligned `PiSubagentExtensionBridge` interface with real Alfie bridge affordances (`handshake`, `spawn`, `abort`, `abortAll`, `getActiveExecutions`, `emitLifecycleEvent`).
  - Updated `negotiatePiSubagentCapability` to strictly distinguish all 5 negative diagnostic outcomes:
    - Malformed handshake response -> `status: "bridge_malformed_response"`, `diagnosticCode: "pi_subagent_bridge_malformed_response"`.
    - Bridge invocation throws -> `status: "bridge_error"`, `diagnosticCode: "pi_subagent_bridge_error"`.
    - Unsupported protocol version -> `status: "unsupported_version"`, `diagnosticCode: "pi_subagent_unsupported_version"`.
    - Capability mismatch -> `status: "capability_mismatch"`, `diagnosticCode: "pi_subagent_capability_mismatch"` with `missingCapabilities` list.
    - Bridge absent -> `status: "bridge_absent"`, `diagnosticCode: "pi_subagent_bridge_absent"`.
- **Provenance manifest (`apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`):**
  - Pins exact Alfie repository URL (`https://github.com/anhphamwork99/alfie.git`), pinned commit SHA (`b34255e0c09aed5c43900254b4dbd1b8f2792fa6`, parent `29a1c1321aac815fb53de8c17001d6176c22aaf7`), package identity (`@alfie/pi-subagents@0.10.0-alfie.1`), and deterministic SHA-256 artifact hashes for `package.json`, `src/index.ts`, and `src/agent-manager.ts`.
- **Pi provider adapter (`apps/server/src/provider/Layers/PiAdapter.ts`):**
  - Added `onSubagentCapability` observation seam to `PiAdapterLiveOptions`.
  - Probes subagent capability on session startup, caches result on `context.subagentCapability` and probe cache for session lifetime.
  - Emits runtime warning for negative outcomes (`bridge_malformed_response`, `unsupported_version`, `capability_mismatch`, `bridge_error`).
  - Production call chain ends cleanly at stored session capability (admission wiring is deferred to Issue 20).
- **Portable hermetic real-Pi tests (`apps/server/src/provider/piSubagentRealExtension.test.ts`):**
  - Replaced hardcoded machine-specific paths with portable relative resolution of the version-controlled `@alfie/pi-subagents` extension directory (`resolveVersionedExtensionDir` / `resolveAlfieRepoDir`).
  - Full Git and cryptographic provenance verification (`verifyExtensionGitProvenance`): verifies git repo, normalized origin URL, pinned commit SHA, clean extension working tree, package identity, and SHA-256 hashes.
  - Realistic on-disk lookalike negative test: constructs a full on-disk package with real `package.json`, matching name/version, entry file, full 9-field Agent schema, and bridge handler, and proves that it fails provenance because git origin/commit/hashes differ from the pinned artifact.
  - Production `PiAdapter.startSession` boundary integration test (Section E): provisions a hermetic temporary Pi agent directory with symlink to the pinned Alfie extension, boots through `PiAdapter.startSession`, verifies `context.subagentCapability` and `onSubagentCapability` receive `managed_enabled`, verifies probe cache stability, and proves that no child execution/transcript/notification side effects occurred during startup.

### Changed production call chain

Pi session startup (`startSession` in `PiAdapter.ts`) → SDK runtime initialization (`createSdkRuntime`) → Production extension auto-discovery (`DefaultResourceLoader.loadCurrentExtensionSet()` loads `@alfie/pi-subagents`) → Bridge extraction (`extractBridge` retrieves `synara:subagents:bridge` / `PI_SUBAGENT_BRIDGE_KEY` from loaded extension) → Capability negotiation (`probePiSubagentBridge` / `negotiatePiSubagentCapability` executes `bridge.handshake` and validates protocol version and required capabilities set inclusion) → Stored session capability (`context.subagentCapability` cached on session context and probe cache) → Observation seam dispatch (`onSubagentCapability`).

*(Note: The Issue-19 call chain ends at the stored negotiated session capability on session context. Atomic production admission is Issue 20).*

### Acceptance evidence matrix

| Criterion | Source evidence | Verification evidence | Result |
| --------- | --------------- | --------------------- | ------ |
| T19-AC1 | `alfie: agent/extensions/pi-subagents/src/index.ts:2490-2570`, `apps/server/src/provider/piSubagentRealExtension.test.ts:310-335` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |
| T19-AC2 | `apps/server/src/provider/piSubagentBridge.ts:80-120`, `apps/server/src/provider/piSubagentRealExtension.test.ts:337-370` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |
| T19-AC3 | `packages/contracts/src/piSubagents.ts:29-47,103-169`, `apps/server/src/provider/piSubagentBridge.ts:60-150`, `apps/server/src/provider/piSubagentRealExtension.test.ts:372-445` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |
| T19-AC4 | `apps/server/src/provider/piSubagentBridge.ts:200-240`, `apps/server/src/provider/piSubagentRealExtension.test.ts:447-460` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |
| T19-AC5 | `apps/server/src/provider/piSubagentRealExtension.test.ts:462-480` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |
| T19-AC6 | `alfie: agent/extensions/pi-subagents/src/index.ts:758-846`, `apps/server/src/provider/piSubagentRealExtension.test.ts:482-510` | `bun run --cwd agent/extensions/pi-subagents test` in the Alfie repo (443 tests passed) | passed |
| T19-AC7 | `apps/server/src/provider/piSubagentRealExtension.test.ts:100-280`, `apps/server/src/provider/piSubagentRealExtension.test.ts:512-615` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |

### Failure and diagnostic evidence

- **Bridge absent:** `status: "bridge_absent"`, `diagnosticCode: "pi_subagent_bridge_absent"`, `isManaged: false`.
- **Malformed handshake response:** `status: "bridge_malformed_response"`, `diagnosticCode: "pi_subagent_bridge_malformed_response"`, `isManaged: false`.
- **Bridge invocation failure (throws):** `status: "bridge_error"`, `diagnosticCode: "pi_subagent_bridge_error"`, `isManaged: false`, returns error message.
- **Unsupported protocol version:** `status: "unsupported_version"`, `diagnosticCode: "pi_subagent_unsupported_version"`, `isManaged: false`, returns offered vs supported version details.
- **Missing required capabilities:** `status: "capability_mismatch"`, `diagnosticCode: "pi_subagent_capability_mismatch"`, `isManaged: false`, returns complete `missingCapabilities` array.
- **Unique diagnostic codes verified:** All 5 negative diagnostic codes are unique and distinct.

### Verification commands and results

All runs below are from the final pinned commits in disposable clean worktrees:
Symphony `d323ec06` + follow-up commit (this report), Alfie `b34255e0c` (parent `29a1c1321`); the Alfie suite additionally passes the
bare-clean path (`bun install` then `bun run test`, exit `0`, no prebuilt `dist/`, no sibling `node_modules`).

1. `ALFIE_REPO_DIR=<alfie worktree at b34255e0c> $HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `8 passed` (including Section E PiAdapter startup test and realistic on-disk lookalike provenance test)
2. `ALFIE_REPO_DIR=<alfie worktree at b34255e0c> $HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentBridge.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `8 passed`
3. `ALFIE_REPO_DIR=<alfie worktree at b34255e0c> $HOME/.bun/bin/bun run --cwd apps/server test src/provider/Layers/PiAdapter.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `39 passed`
4. `$HOME/.bun/bin/bun run --cwd packages/contracts test src/piSubagents.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `7 passed`
5. `$HOME/.bun/bin/bun run --cwd agent/extensions/pi-subagents test` (in the Alfie worktree pinned to `b34255e0c`)
   - Exit code: `0`
   - Test files: `28 passed`
   - Tests: `443 passed`

**Alfie clean-checkout setup (hermetic, tracked steps only):**

1. `bun install` inside `agent/extensions/pi-subagents` — the tracked `package-lock.json` pins the
   `@earendil-works/pi-*` peer versions (`0.83.0`); no sibling `node_modules` is required.
2. `bun run test` — the tracked `pretest` script (`tsc`) builds the gitignored `dist/` consumed by the runtime
   discovery entry `agent-discovery.js`, then runs vitest. Result: `28` files / `443` tests, exit `0`.
   No gitignored prebuilt `dist/` and no out-of-band sibling Pi dependencies are required.

### Migration compatibility evidence

Issue 18 baseline (`commit 42694412`) is strictly preserved. No migrations (090–099) or persistence code were modified.

### Real-Pi evidence

- **Pi SDK runtime (Symphony, actual):** `@earendil-works/pi-coding-agent@0.81.1` (with `pi-ai@0.81.1`, `pi-tui@0.81.1`) — the version the production Pi provider resolves in this repository's lockfile. This is the runtime the extension is loaded into.
- **Alfie extension peer/test versions:** the extension declares `@earendil-works/pi-* >=0.83.0` peers; the tracked `package-lock.json` pins the test/dev resolution to `0.83.0` (verified by the bare `bun install`). The canonical machine's extra out-of-band sibling install at `agent/extensions/node_modules` (`0.84.2`) is NOT used by the suite and is not required (F2 fix).
- **Extension repository:** `anhphamwork99/alfie`, pinned commit `b34255e0c09aed5c43900254b4dbd1b8f2792fa6` (parent `29a1c1321aac815fb53de8c17001d6176c22aaf7`).
- **Extension package:** `@alfie/pi-subagents@0.10.0-alfie.1`.
- **Package discovery:** Resolved dynamically from hermetic test agent directory without `extensionFactories` injection or hardcoded machine paths.
- **Handshake outcome:** `isManaged: true`, `status: "managed_enabled"`, `protocolVersion: 1`, `extensionVersion: "0.10.0-alfie.1"`, `capabilities: ["managed-spawn", "abort-propagation"]`.
- **Legacy host parity:** 443 unit tests pass in `@alfie/pi-subagents` (from a clean checkout), structured delegation parameter schema (`task`, `context`, `link_references`, `expected_outcome`, `subagent_type`, `thinking`, `run_in_background`, `resume`, `isolation`) is verified intact.
- **Provenance gate (scope is test/acceptance-only):** `assertProductionExtensionProvenance` derives package identity directly from loaded artifact manifest on disk, verifies git origin/commit/hashes against `piSubagentExtensionProvenance.json`, and rejects synthetic lookalikes. This enforcement lives in the Issue-19 acceptance suite only; it is not yet wired into the production admission path — atomic runtime trust/admission of the managed bridge (fail-closed gating of `managed-spawn`/`abort-propagation` on `context.subagentCapability`) is explicitly scoped to Issue 20 (`atomic-authorized-production-admission`), which also owns the production fallback when provenance cannot be proven.

### Deviations and remaining risks

- **Reviewer follow-up fixes (this revision):** (F2) the Alfie suite is now hermetic from a bare clean checkout
  (`bun install` + `bun run test`, tracked `pretest` builds `dist/`; the real-session lifecycle test no longer depends on
  live `search-the-web` sibling module resolution); (F4) the parent-abort listener is attached exactly once per child and
  detached exactly once by the owning terminal path (queue→start no longer accumulates a duplicate listener), with two
  focused regression tests added (443 total).
- **Unpushed commits (real, not `None`):** BOTH follow-up commits are local-only and unpushed — Alfie
  `b34255e0c09aed5c43900254b4dbd1b8f2792fa6` (on top of unpushed parent `29a1c1321`) and the Symphony follow-up commit
  (on top of unpushed `d323ec06`). Publishing is intentionally out of scope for this ticket; acceptance must not assume
  remote availability.
- **Canonical-vs-worktree status:** canonical checkouts are untouched by this task. `~/alfie` is clean at
  `29a1c1321` (ahead of `origin/main` by 38 commits). `~/symphony` is at `d323ec06`; it carries 128 PRE-EXISTING
  unrelated dirty lines (other planning docs, `116 M` + `12 ??`) from other sessions, but the Issue-19-relevant paths
  (`apps/server/src/provider/test-fixtures/piSubagentExtensionProvenance.json`, this issue doc) are clean at the
  baseline commit. The follow-up commits exist only in disposable worktrees: Symphony runtime-supplied worktree at
  `d323ec06` + follow-up (relevant area clean), Alfie worktree pinned at `29a1c1321` + `b34255e0c` (relevant area
  clean; the only repo-local dirty state is the expected `node_modules`/`dist` test artifacts, both gitignored).
- **Issue 20 boundary:** atomic admission, child execution routing, and runtime trust enforcement of the managed bridge
  remain explicitly scoped to Issue 20 and are not implemented here.

### Commits

- **Extension repository (`anhphamwork99/alfie`):**
  - `29a1c1321aac815fb53de8c17001d6176c22aaf7` (`feat(pi-subagents): expose synara managed execution bridge and capability negotiation`) — accepted baseline
  - `b34255e0c09aed5c43900254b4dbd1b8f2792fa6` (`fix(pi-subagents): hermetic test setup and single parent-abort listener ownership (issue 19 follow-up)`) — review follow-up
- **Symphony repository (`anhphamwork99/symphony`):**
  - `d323ec0658c12e0dd95496d4fcec7292046948f5` (Issue 19 remediation baseline)
  - Follow-up commit on top of `d323ec06`: updates `piSubagentExtensionProvenance.json` pin to `b34255e0c` and this report.
- **Pushed:** no — both repositories: `pushed: no` (no push was authorized).

### Reviewer handoff

Alfie side (in a clean worktree pinned to `b34255e0c`):

1. `$HOME/.bun/bin/bun install` inside `agent/extensions/pi-subagents`
2. `$HOME/.bun/bin/bun run --cwd agent/extensions/pi-subagents test` — expect 28 files / 443 tests, exit `0`

Symphony side (worktree at `d323ec06` + follow-up; `ALFIE_REPO_DIR` must point at the Alfie worktree at `b34255e0c`):

1. `ALFIE_REPO_DIR=<alfie worktree> $HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts`
2. `ALFIE_REPO_DIR=<alfie worktree> $HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentBridge.test.ts`
3. `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/Layers/PiAdapter.test.ts`
4. `$HOME/.bun/bin/bun run --cwd packages/contracts test src/piSubagents.test.ts`
