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

- **Version-controlled extension update (`@alfie/pi-subagents` repository `anhphamwork99/alfie` commit `29a1c1321`):**
  - Updated `agent/extensions/pi-subagents/src/index.ts` to expose the versioned Synara Managed-Execution Bridge (`PI_SUBAGENTS_PROTOCOL_VERSION = 1`) via `pi.on("synara:subagents:bridge", ...)`, `pi.on("synara:subagents:handshake", ...)`, and `pi[Symbol.for("synara.pi.subagents.bridge")]`.
  - Truthful capability advertisement: advertises only capabilities backed by callable affordances on the production Agent/AgentManager path (`["managed-spawn", "abort-propagation"]`), omitting roadmap items (`coalesced-progress`, `terminal-outbox`, `restart-reconciliation`, `paginated-transcripts`).
  - Production affordances on `synaraBridge`: implemented callable `spawn: (command) => PiSubagentSpawnResult` wired directly to `manager.spawn(pi, currentCtx, subagentType, delegation, ...)` using the real `AgentManager`, alongside `abort`, `abortAll`, and `getActiveExecutions`.
  - Parent abort signal propagation: wired `signal` parameter into background and queued execution paths in `Agent.execute` and `AgentManager.spawn`/`startAgent`, ensuring both foreground and background children observe parent interruption.
  - Added dedicated bridge unit and integration tests in `test/synara-bridge.test.ts` (9 tests covering handshake, spawn, abort, abortAll, background abort propagation, and legacy parity).
  - Preserved full legacy Agent tool registration, structured 4-field delegation parameters (`task`, `context`, `link_references`, `expected_outcome`), and full 9-field public parameter schema (`subagent_type`, `thinking`, `run_in_background`, `resume`, `isolation`). All 441 unit tests pass in `pi-subagents`.
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
  - Pins exact Alfie repository URL (`https://github.com/anhphamwork99/alfie.git`), pinned commit SHA (`29a1c1321aac815fb53de8c17001d6176c22aaf7`), package identity (`@alfie/pi-subagents@0.10.0-alfie.1`), and deterministic SHA-256 artifact hashes for `package.json`, `src/index.ts`, and `src/agent-manager.ts`.
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
| T19-AC6 | `alfie: agent/extensions/pi-subagents/src/index.ts:758-846`, `apps/server/src/provider/piSubagentRealExtension.test.ts:482-510` | `bun run --cwd /Users/anhpham99/alfie/agent/extensions/pi-subagents test` (441 tests passed) | passed |
| T19-AC7 | `apps/server/src/provider/piSubagentRealExtension.test.ts:100-280`, `apps/server/src/provider/piSubagentRealExtension.test.ts:512-615` | `bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts` | passed |

### Failure and diagnostic evidence

- **Bridge absent:** `status: "bridge_absent"`, `diagnosticCode: "pi_subagent_bridge_absent"`, `isManaged: false`.
- **Malformed handshake response:** `status: "bridge_malformed_response"`, `diagnosticCode: "pi_subagent_bridge_malformed_response"`, `isManaged: false`.
- **Bridge invocation failure (throws):** `status: "bridge_error"`, `diagnosticCode: "pi_subagent_bridge_error"`, `isManaged: false`, returns error message.
- **Unsupported protocol version:** `status: "unsupported_version"`, `diagnosticCode: "pi_subagent_unsupported_version"`, `isManaged: false`, returns offered vs supported version details.
- **Missing required capabilities:** `status: "capability_mismatch"`, `diagnosticCode: "pi_subagent_capability_mismatch"`, `isManaged: false`, returns complete `missingCapabilities` array.
- **Unique diagnostic codes verified:** All 5 negative diagnostic codes are unique and distinct.

### Verification commands and results

1. `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `8 passed` (including Section E PiAdapter startup test and realistic on-disk lookalike provenance test)
2. `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentBridge.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `8 passed`
3. `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/Layers/PiAdapter.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `39 passed`
4. `$HOME/.bun/bin/bun run --cwd packages/contracts test src/piSubagents.test.ts`
   - Exit code: `0`
   - Test files: `1 passed`
   - Tests: `7 passed`
5. `$HOME/.bun/bin/bun run --cwd /Users/anhpham99/alfie/agent/extensions/pi-subagents test`
   - Exit code: `0`
   - Test files: `28 passed`
   - Tests: `441 passed`

### Migration compatibility evidence

Issue 18 baseline (`commit 42694412`) is strictly preserved. No migrations (090–099) or persistence code were modified.

### Real-Pi evidence

- **Pi SDK runtime:** `@earendil-works/pi-coding-agent@0.83.0`.
- **Extension repository:** `anhphamwork99/alfie` (`/Users/anhpham99/alfie`), commit `29a1c1321aac815fb53de8c17001d6176c22aaf7`.
- **Extension package:** `@alfie/pi-subagents@0.10.0-alfie.1`.
- **Package discovery:** Resolved dynamically from hermetic test agent directory without `extensionFactories` injection or hardcoded machine paths.
- **Handshake outcome:** `isManaged: true`, `status: "managed_enabled"`, `protocolVersion: 1`, `extensionVersion: "0.10.0-alfie.1"`, `capabilities: ["managed-spawn", "abort-propagation"]`.
- **Legacy host parity:** 441 unit tests pass in `@alfie/pi-subagents`, structured delegation parameter schema (`task`, `context`, `link_references`, `expected_outcome`, `subagent_type`, `thinking`, `run_in_background`, `resume`, `isolation`) is verified intact.
- **Provenance gate:** `assertProductionExtensionProvenance` derives package identity directly from loaded artifact manifest on disk, verifies git origin/commit/hashes against `piSubagentExtensionProvenance.json`, and rejects synthetic lookalikes.

### Deviations and remaining risks

None for Issue 19 capability negotiation. Atomic admission and child execution routing are explicitly scoped to Issue 20.

### Commits

- **Extension repository (`anhphamwork99/alfie`):** `29a1c1321aac815fb53de8c17001d6176c22aaf7` (`feat(pi-subagents): expose synara managed execution bridge and capability negotiation`)
- **Symphony repository (`anhphamwork99/symphony`):** Staged and committed for Issue 19 remediation.

### Reviewer handoff

1. Run real extension capability negotiation test:
   `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentRealExtension.test.ts`
2. Run bridge protocol tests:
   `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/piSubagentBridge.test.ts`
3. Run PiAdapter provider tests:
   `$HOME/.bun/bin/bun run --cwd apps/server test src/provider/Layers/PiAdapter.test.ts`
4. Run shared contracts tests:
   `$HOME/.bun/bin/bun run --cwd packages/contracts test src/piSubagents.test.ts`
5. Run Alfie extension test suite:
   `$HOME/.bun/bin/bun run --cwd /Users/anhpham99/alfie/agent/extensions/pi-subagents test`
