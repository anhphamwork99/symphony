# Project-owned Right-sidebar workspace — Implementation Plan

Status: approved technical direction; implementation ready.

Planning base: `93b833172`

## Strategy and dependency graph

Move Right-sidebar workspace ownership to the real `ProjectId` across contracts, shared migration policy, server persistence/runtime, web, and desktop. Conversation-backed pane content keeps legitimate `ThreadId` references. Each persistence boundary stages every owned slice and publishes its own version marker only after the complete boundary payload is durable; a shared pure policy keeps legacy collision behavior identical.

```text
WP1 Contracts
  └─ WP2 Shared migration policy
       └─ WP3 Server persistence and publication
            └─ WP4 Project terminal runtime and deletion
                 └─ WP5 Browser, device, and annotations
                      ├─ WP6 Web workspace
                      └─ WP7 Desktop workspace
                           └─ WP8 Integrated acceptance
```

Cherry-pick order is WP1 → WP2 → WP3 → WP4 → WP5 → WP6 → WP7 → WP8. Only WP6 and WP7 are parallel-safe; their write sets are disjoint.

## Global invariants

- Use real `ProjectId`; never cast it to `ThreadId`, create a pseudo-Thread, or select a host conversation.
- Use one legacy winning Thread per Project and migrate all slices from that winner. Do not merge per-slice winners.
- Keep v1 workspace data and all conversations unchanged. Never invoke the owner-only cleanup.
- Published Project data wins. An incomplete staged target is never visible as canonical.
- Missing or malformed backing content retains its pane with an explicit diagnostic.
- Viewport clamping never overwrites the preferred Right-sidebar width.
- No tab redesign, new pane type, unrelated conversation change, TODO, or stub.
- One worker, one clean worktree, one focused commit per WP.
- Use `bun run test` or `bunx vitest run`, never `bun test`.
- `bun fmt`, `bun lint`, and `bun typecheck` require explicit owner authorization and are reserved for one final pass.

## WP1 — Contracts and schemas

**Objective:** Define schema-level Project ownership for RightDock, terminal, browser/automation/annotations, and device operations, plus v1 sanitizers, v2 slice schemas, capability, and publication marker.

**Allowed write set:** `packages/contracts/src/projectWorkspace.ts` and test; ownership-specific changes and tests in `packages/contracts/src/terminal.ts`, `ipc.ts`, `device.ts`, `browserAnnotations.ts`, `browserAutomationIds.ts`; explicit export registration only.

**Forbidden:** runtime logic in contracts; synthetic aliases; replacing legitimate conversation `ThreadId`.

**Completion:** valid Project payloads round-trip; malformed/missing Project IDs and malformed v1 slices fail; Side-chat conversation IDs remain Thread IDs.

**Verification:** focused contracts tests via `bun run --cwd packages/contracts test`.

**Commit:** `feat(contracts): add project-owned right sidebar workspace schemas`

## WP2 — Shared pure migration policy

**Objective:** Provide the single pure implementation of candidate eligibility, deterministic ordering, one-winner/all-slices conversion, published-target precedence, staging completeness, and deterministic keys.

**Allowed write set:** new `packages/shared/src/projectWorkspaceMigration.ts` and test; `packages/shared/package.json` subpath export.

**Forbidden:** I/O, storage access, clocks, Effect layers, per-slice winner selection, cleanup behavior.

**Completion:** tests cover archived/deleted/malformed/default candidates; newest `updatedAt`; ascending `ThreadId` tie-break; no borrowing from richer losers; published current data wins; incomplete staging cannot publish.

**Verification:** `bun run --cwd packages/shared test -- projectWorkspaceMigration`

**Commit:** `feat(shared): add pure project workspace migration policy`

## WP3 — Server Migration 105 and publication coordinator

**Objective:** Add durable Project-owned workspace slices and publication records, then coordinate snapshot → policy → transactional staging → publication independently per Project.

**Allowed write set:** Migration 105 and migration lineage tests/registrations; new `apps/server/src/projectWorkspace/`; narrowly required persistence-layer wiring.

**Forbidden:** modifying or deleting v1 rows/conversations; runtime terminal/browser/device behavior.

**Completion:** repeated migration is idempotent; injected mid-write failure publishes nothing; retry converges; valid v2 is not overwritten; v1 and conversations remain unchanged.

**Verification:** focused server migration and project-workspace coordinator tests using `bun run test`/`bunx vitest run`.

**Commit:** `feat(server): add migration 105 project workspace staged publication`

## WP4 — Project-owned terminal runtime and deletion settlement

**Objective:** Key terminal processes, history, events, reconnect, and lifecycle by `ProjectId`; preserve processes across conversation/Project navigation; settle truthfully before Project workspace deletion.

**Allowed write set:** `apps/server/src/terminal/**`; terminal-only RPC route sections; narrowly bounded Project deletion/Thread deletion reactor paths and tests.

**Forbidden:** browser/device route sections; termination on navigation; unproven settlement claims; conversation mutation.

**Completion:** same Project reuses one process/history; Project switch leaves it alive; restart reconnects when alive; dead/uncertain state is truthful; Thread archive/delete preserves workspace; Project deletion settles before removal.

**Verification:** focused terminal, RPC, and deletion lifecycle tests.

**Commit:** `feat(server): own project terminal runtime and deletion settlement`

## WP5 — Project-owned browser, device, and annotations

**Objective:** Key server browser automation, annotations, and device attachments/events by explicit `ProjectId`; retain truthful diagnostics on restore failure.

**Allowed write set:** browser-automation server services/layers/gateway; `apps/server/src/device/**`; server annotation routing; browser/device/annotation RPC sections and tests.

**Forbidden:** WP4 terminal route sections; inference from active Thread; visual redesign; resource termination on visibility change.

**Completion:** different conversations in one Project share runtime; Projects stay isolated; malformed state emits restoration error without default replacement.

**Verification:** focused server browser/device/annotation tests.

**Commit:** `feat(server): own project browser device and annotation state`

## WP6 — Web Project workspace

**Objective:** Key RightDock, terminal presentation, browser, device, and relevant geometry by Project; stage/publish localStorage v2 with shared policy; route all consumers by active Project; preserve confirmation, diagnostic, and preferred-width behavior.

**Allowed write set:** web workspace stores and tests; web migration module; `SingleChatSurface`, `ChatView`, `DockTerminalPane`, Browser panel, terminal runtime/event plumbing, relevant route cleanup/activation code, and RightDock sizing helpers/tests.

**Forbidden:** left-sidebar Project expansion; tab redesign; v1 deletion; copy-on-switch; pseudo-Thread scopes; silent pane removal.

**Completion:** same-Project conversation switch causes no workspace reset; Project switch restores destination workspace; v1→v2 migration is idempotent/marker-gated; active Terminal close confirms; unavailable panes remain; narrow clamp does not persist.

**Verification:** focused web workspace store, migration, component, and sizing tests.

**Commit:** `feat(web): key right sidebar workspace stores by project`

## WP7 — Desktop Project workspace

**Objective:** Carry Project ownership through IPC/preload, browser manager, automation host, annotations, device/native state, reconnect/replay, and desktop publication marker.

**Allowed write set:** desktop browser manager/IPC/preload/channels; browser automation and annotations; bounded desktop migration and tests; narrow composition wiring.

**Forbidden:** deriving owner from active Thread; terminating native resources on navigation; v1 deletion; server/web writes.

**Completion:** browser/automation/annotation/device resources survive conversation changes and reconnect to the owning Project; marker is idempotent and never exposes partial state.

**Verification:** focused desktop browser/automation/annotation/migration tests.

**Commit:** `feat(desktop): key browser automation and annotations by project`

## WP8 — Integrated acceptance

**Objective:** Prove all Project Contract scenarios and Decision 0002 obligations across the integrated stack. Production-file changes are prohibited except bounded fixes for integration defects discovered by these tests.

**Allowed write set:** new focused acceptance tests under web/server/desktop; previously owned WP files only for verified integration defects.

**Completion:** scenarios 1–8 pass; obligations 1–14 have evidence; ProjectId propagation is explicit end to end; negative checks reject pseudo-Thread ownership; per-boundary markers prevent mixed canonical activation.

**Verification:** focused project-workspace suites in contracts/shared/server/web/desktop. Full workspace checks remain pending explicit authorization.

**Commit:** `test: prove project-owned right sidebar acceptance`

## Traceability

| Requirement | Owning WP(s) |
|---|---|
| Scenario 1 — conversation switch preserves workspace | WP4, WP6, WP8 |
| Scenario 2 — Project isolation | WP5, WP6, WP7, WP8 |
| Scenario 3 — Terminal continuity/reconnect | WP4, WP8 |
| Scenario 4 — active Terminal close confirmation | WP4, WP6, WP8 |
| Scenario 5 — unavailable content remains diagnostic | WP5, WP6, WP7, WP8 |
| Scenario 6 — archive/restore preservation | WP3, WP4, WP6, WP8 |
| Scenario 7 — settle then delete | WP4, WP8 |
| Scenario 8 — temporary width clamp | WP6, WP8 |
| Decision obligations 1–3 | WP2 |
| Obligations 4–7 | WP3 plus WP6/WP7 boundary markers |
| Obligation 8 | WP8 |
| Obligation 9 | WP1–WP8 |
| Obligation 10 | WP2, WP6, WP8 |
| Obligations 11–12 | WP4, WP8 |
| Obligation 13 | WP5–WP8 |
| Obligation 14 | focused checks per WP; final full pass pending authorization |
