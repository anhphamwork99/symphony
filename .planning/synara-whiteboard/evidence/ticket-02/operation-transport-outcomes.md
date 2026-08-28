# Ticket 02 — Operation Transport Outcomes Evidence

Status: active package evidence; bounded PASS candidate only — subject to independent review; package PASS not yet claimed
Authority: Decisions 0063, 0064, and 0065
Routing: `active-operation-transport-outcomes`

## WP1 — Contracts and canonical RPC membership

Bounded result: **PASS**

This result covers only the strict, bounded, image-free operation-session contracts, compatibility capability, and canonical `WsFeatureRpcGroup` membership. It does not establish the server authority, production WebSocket handlers/stream, browser bridge, coordinator integration, package PASS, AC6, or Ticket 02 acceptance.

### Integrated source

Candidate reviewed:

```text
base:      d9442ace7fbaed014b8d2ecef2ab842816870022
candidate: 6bb6792b735b3781164bd3ff75125cb31a7f7b92
```

Integrated on `main` as the exact linear source chain:

```text
9d45c7433 feat(contracts): add whiteboard operation-session schemas and canonical RPC membership
5164cf132 fix(contracts): make whiteboard operation wire fail closed
bcb5a1fc8 fix(contracts): bind whiteboard operation lifecycle truth
aabb44aeb fix(contracts): tighten whiteboard terminal counters
```

### Authorized path inventory

```text
apps/server/src/wsCompatibility.test.ts
packages/contracts/src/index.ts
packages/contracts/src/rpc.ts
packages/contracts/src/whiteboardOperation.test.ts
packages/contracts/src/whiteboardOperation.ts
packages/contracts/src/ws.test.ts
packages/contracts/src/ws.ts
packages/contracts/src/wsCompatibility.ts
```

All paths are inside Decision 0063's contract/compatibility/test write set as amended by Decision 0064 for canonical `packages/contracts/src/rpc.ts` membership. No supplemental Whiteboard RPC group was added.

### Verification

Fresh supported command in the reviewed candidate worktree:

```bash
bun run --cwd packages/contracts test -- src/whiteboardOperation.test.ts src/ws.test.ts
```

Result:

```text
Test Files  2 passed (2)
Tests       38 passed (38)
```

Additional checks:

```text
candidate worktree: clean
git diff --check: clean
exact changed-path audit: 8 authorized paths
```

Workspace-wide `bun fmt`, `bun lint`, and `bun typecheck` were not run because Decision 0063 explicitly defers and does not authorize those package-level gates.

### Independent review

One native read-only reviewer compared `d9442ace7..6bb6792b7`, reran the supported Bun test, and returned:

```text
State: completed
WP1 verdict: PASS
Blocking findings: None
Tests: 2 files passed, 38 tests passed
Scope: exact authorized WP1 write set
```

The reviewer confirmed strict/fail-closed schema behavior, full identity and lifecycle truth, terminal semantic constraints, six canonical browser RPC methods, optional compatibility capability, clean scope, and no file modifications.

### Deferred claims

The following remain open and are not implied by this WP1 PASS:

- ephemeral server operation-session authority;
- authoritative admission, sequencing, idempotency, generation fencing, Retry and Take Over state;
- production WebSocket RPC handlers and progressive stream;
- containment dispatch and terminal derivation;
- browser acknowledgement bridge and AI-history coordinator integration;
- same-authority reconnect and lost-session fail-closed behavior;
- AI assets/restore/failure;
- cap/lifecycle/accessibility/RightDock/persistence;
- provider or production Whiteboard UI mounting;
- package bounded PASS, AC6, Ticket 02, feature review, or final acceptance.

## WP-B1/B2/B3 — Browser transport, AI-history bridge, and Chromium outcome proof

Bounded result: **PASS candidate — recorded as evidence only; not yet independently reviewed, so package PASS is not claimed.**

This section records raw-log-backed evidence for the browser operation transport (`wsTransport` typed seam), the dormant AI-history bridge, and the operation-outcome behavior in stable Chromium, at the reviewed source commit. It does not establish server authority, production mounting, package PASS, AC6, or Ticket 02 acceptance.

### Recorded commits and reviewed source

```text
WP-B1: 8bea5c509 feat(whiteboard): typed browser transport for operation-session seam
WP-B2: 9b9436e05 feat(whiteboard): bridge operation outcomes into AI history
WP-B3: 8a737d430 test(whiteboard): prove operation transport outcomes in stable Chromium
```

```text
baseline: 9a78a0bc0cd491bbbbe0b97c93f9354e6e71ae50
source:   8a737d4302b377340b4df7a4b72afb4ea29a54e6
```

### Raw evidence logs and SHA-256

Logs are committed unmodified; hashes were computed over the exact committed bytes.

| Log | Content | SHA-256 |
|---|---|---|
| `operation-transport-outcomes.focused.log` | focused unit/contract retry run (initial environment failure + clean retry) | `938f5a45e350ce9da8c42a43af9c53909f940ff032216bd92277a2ac445a3d0d` |
| `operation-transport-outcomes.run-a.browser.log` | browser run A (port 63351) | `b353a7dcd87dd1766b168bb2f6ef89478870d51f5bf8f94d2f837585669df357` |
| `operation-transport-outcomes.run-b.browser.log` | browser run B (port 63352) | `83e7423f63136d544ae65d10adfbfb6666b8469ea640465eec84bed6c36c0521` |

All three logs record `SOURCE_SHA=8a737d4302b377340b4df7a4b72afb4ea29a54e6`, matching the reviewed source commit.

### Focused run — counts, exits, and disclosed retry

The focused log intentionally contains an initial environment failure followed by an appended clean retry; both legs are recorded verbatim and unmodified:

- Initial leg: `vitest run src/whiteboardOperation.test.ts src/ws.test.ts` failed with `Cannot find package '@effect/vitest'` in both suites because the gitignored worktree dependency symlink was absent at start time. `Test Files 2 failed (2)`, `FOCUSED_EXIT=1`. This leg evidences an environment resolution failure, not a source regression.
- Retry leg (`FOCUSED_RETRY_STARTED_AT=2026-08-28T17:40:30Z`, reason: worktree dependency symlinks restored after the `@effect/vitest` resolution failure):
  - `packages/contracts` direct Vitest — `Test Files 2 passed (2)`, `Tests 38 passed (38)`;
  - `apps/server` direct Vitest — `Test Files 3 passed (3)`, `Tests 32 passed (32)` (run directly via `vitest` because the package test script ignores filters);
  - `apps/web` — `vitest run --passWithNoTests` over `SynaraWhiteboardOperationBridge.test.ts`, `SynaraHistoryGate.test.ts`, `wsTransport.test.ts` — `Test Files 3 passed (3)`, `Tests 107 passed (107)`;
  - `FOCUSED_RETRY_EXIT=0`.

### Browser runs — ports, counts, exits

Both runs execute `vitest run --config vitest.browser.stable.config.ts` over `SynaraOperationTransportOutcomes.acceptance.browser.tsx` in stable Chromium against the real pinned `@excalidraw/excalidraw@0.18.1` harness:

| Run | Port | Files | Tests | Exit |
|---|---|---|---|---|
| A (`RUN_A_STARTED_AT=2026-08-28T17:40:56Z`) | 63351 | 1 passed | 8 passed | 0 |
| B (`RUN_B_STARTED_AT=2026-08-28T17:41:10Z`) | 63352 | 1 passed | 8 passed | 0 |

Both browser logs contain non-fatal Vite `server.fs.allow` warnings for the pinned Excalidraw font assets resolved through the worktree dependency symlink path (`@excalidraw/excalidraw@0.18.1` under the host `node_modules/.bun` store). The warnings are font-asset serving notices only; the tests use the real pinned Excalidraw 0.18.1 harness and pass in both runs.

### Exact changed paths baseline → source

`git diff --name-status 9a78a0bc0..8a737d430` — 9 paths, all inside the Decision 0063 `apps/web` write set:

```text
M  apps/web/src/components/whiteboard/ticket02/ExcalidrawTicket02Harness.tsx
M  apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryCoordinator.ts
M  apps/web/src/components/whiteboard/ticket02/SynaraAiHistoryTypes.ts
M  apps/web/src/components/whiteboard/ticket02/SynaraHistoryGate.test.ts
A  apps/web/src/components/whiteboard/ticket02/SynaraOperationTransportOutcomes.acceptance.browser.tsx
A  apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.test.ts
A  apps/web/src/components/whiteboard/ticket02/SynaraWhiteboardOperationBridge.ts
M  apps/web/src/wsTransport.test.ts
M  apps/web/src/wsTransport.ts
```

### Prohibited path audit

No path outside the authorized `apps/web` write set changed between baseline and source (audited via `git diff --name-only 9a78a0bc0..8a737d430` filtered against non-`apps/web` prefixes): none. The evidence delta itself is limited to the four evidence files listed below.

### Evidence write set (this record)

```text
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.md
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.focused.log
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-a.browser.log
.planning/synara-whiteboard/evidence/ticket-02/operation-transport-outcomes.run-b.browser.log
```

WP1 content above is preserved unchanged; only this section was appended and the status line updated to reflect the bounded PASS candidate wording.

### Canonical six-method surface audit

The canonical `WsFeatureRpcGroup` (WP1, `packages/contracts/src/rpc.ts`) contains exactly six Whiteboard operation RPC members, and the browser transport exposes the matching six-method surface in `apps/web/src/wsTransport.ts`:

```text
whiteboardOperationAttachSession
whiteboardOperationSubscribe        (progressive stream)
whiteboardOperationAcknowledgeApplication
whiteboardOperationTakeOver
whiteboardOperationRetry
whiteboardOperationReleaseSession
```

plus the optional capability probe `hasWhiteboardOperationCapability()` gating every call (fail-closed `capabilityMissing` when the server does not advertise `whiteboard.operation-session-v1`), and the fail-closed subscription failure listener `onWhiteboardOperationFailure`.

### No-producer audit

The browser transport and bridge never fabricate operation-session truth: the transport only forwards server-delivered operation session events to subscribers and surfaces subscription failures through the fail-closed failure listener; no synthetic operation-session event is produced anywhere in `wsTransport.ts` or `SynaraWhiteboardOperationBridge.ts`. The acceptance suite drives outcomes exclusively by emitting contract-typed fixture events into the real transport surface.

### Dormancy

`SynaraWhiteboardOperationBridge.ts` is explicitly dormant: "not mounted in any production UI". No provider or production Whiteboard surface mounts the bridge; dormancy is asserted by the suite and required by Decision 0065 until server authority lands.

### Behavioral matrices proven in Chromium (8 tests, both runs PASS)

- **Identity / admission**: attach result identity (`serverInstanceId`, `operationSessionId`, `sessionEpoch`, project/document/canvas identity, revision) is consumed as contract truth; same-authority resume replays snapshots gap-free and duplicate admission applies each mutation exactly once before live continuation.
- **Acknowledge**: delayed truthful acknowledgements are resent without reapplication; every non-acknowledged containment path stays protected with no interruption success.
- **Retry**: exactly-one settlement semantics — completed outcomes settle exactly once through the real coordinator and duplicate terminals are idempotent; failed-partial commits exactly one event for the verified valid prefix and never applies the failed remainder.
- **Outcome**: zero-valid outcomes create no AI event, no native-history clear, and no cursor movement; resumed terminal outcomes are adopted from the snapshot without re-running settlement and post-terminal progress is fenced.
- **Reconnect / lost session**: a lost active operation session stays protected with no event, no clear, and no unlock; recovery is an explicit re-attach.
- **TakeOver**: the Take Over pending lock is held until acknowledged containment, unlocks on exactly one interrupted event, and post-TakeOver producer input is fenced.

These matrices are recorded as raw-log-backed evidence from the two browser runs; they remain bounded PASS candidate claims subject to independent review and do not establish package PASS, AC6, or Ticket 02 acceptance.

### Deferred claims

Everything in the WP1 deferred list remains deferred. Additionally, this section does not claim:

- server-side operation-session authority or production WebSocket handlers/stream (Decision 0065 frontier);
- production mounting of the bridge or provider integration;
- package bounded PASS, AC6, Ticket 02 acceptance, or final acceptance — the WP-B1/B2/B3 result is recorded strictly as a **bounded PASS candidate pending independent review**.

## Current frontier

Proceed within Decision 0065 to the server operation-session authority and production WebSocket seam. The package remains `active-operation-transport-outcomes`; the WP-B1/B2/B3 result awaits independent review before any PASS upgrade.
