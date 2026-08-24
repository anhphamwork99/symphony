# Decision 0004 — Desktop authoritative lazy Project workspace activation

- **Status:** Binding — accepted
- **Trigger:** Material technical decision verification for Decision 0003 remediation item 4
- **Candidate baseline:** `96381a6f5`
- **Date:** 2026-08-24

## Question

How must Desktop obtain authoritative Project IDs and applicable legacy inputs, publish canonical state, and activate `DesktopBrowserManager` without introducing an unjustified Project-list subsystem?

## Authority

- `../PROJECT.md`
- `0002-explicit-project-ownership-and-legacy-migration.md`
- `0003-final-acceptance-candidate-8b4a1bc63.md`, remediation item 4

This decision does not reopen Project ownership, deterministic one-winner migration, marker-last publication, v1 retention, or the no-cleanup boundary.

## Evidence

Desktop startup currently retries only Project IDs represented in its migration document, so a fresh document discovers none. Desktop has no server Project-list consumer. Every `projectBrowser` IPC input already carries a real `ProjectId`. Project IPC handlers currently call `DesktopBrowserManager` directly. No durable v1 Desktop browser-manager workspace source was identified. Browser and browser-annotation slices have Desktop consumers; device runtime state is server-owned in the inspected architecture.

## Binding decision

Use the existing real `ProjectId` on Project-owned Desktop operations as authoritative lazy enumeration. Do not add a Desktop-to-server Project-list protocol.

Introduce one activation boundary, conceptually `ensureProjectWorkspaceActivated(projectId)`, with this contract:

1. Startup, before Project IPC registration, retries Project IDs already named by staged keys, publication markers, or diagnostics in the durable Desktop document.
2. A Project absent from the document is discovered by the first Project-owned IPC operation carrying its real `ProjectId`.
3. Every Project browser and annotation operation must await activation before invoking a manager method, including reads, mutations, visibility, bounds, developer tools, and annotation methods.
4. Concurrent first calls for one Project share one in-flight activation. Success is remembered per manager lifetime and is not reapplied over newer live mutations.
5. Projects activate independently; one failure cannot activate or block another.
6. Startup and lazy activation use the same implementation and invariants.
7. Any non-IPC Project entry point that can create Project state before IPC must use the same boundary.
8. Project deletion clears only that Project's manager state and activation bookkeeping.

## Migration inputs

1. A valid current publication for the exact Project wins.
2. Without a current publication, legacy input may come only from an explicit durable schema-validated stable Desktop source.
3. Active/Main Thread, navigation state, insertion order, and arbitrary in-memory Thread manager state are forbidden sources.
4. No durable v1 Desktop manager source is currently identified, so production legacy input is honestly empty and canonical defaults are published.
5. Test fixtures do not establish a production legacy source.
6. A later-discovered source must use Decision 0002's authoritative winner and metadata. If it cannot, activation fails diagnostically instead of choosing or merging independently.

## Publication and manager application

1. Stage the complete five-slice target and write the marker last.
2. Freshly read and validate the publication: current schema, exact Project, complete slice set, no mixed or malformed slices.
3. Drive the manager from the published read, never only an in-memory migration result.
4. Before the requested operation, atomically apply applicable Desktop-owned slices:
   - browser tabs, active tab, and open state;
   - annotation projection referencing only valid tabs.
5. Restored metadata fabricates no live native runtime; normal runtime restoration owns that transition.
6. Device, dock, and terminal-presentation slices are validated but not invented as Desktop manager ownership.
7. Validate the entire bundle before mutation and prevent observable partial application.
8. Mark activated only after complete application succeeds.
9. Hydration must not call Thread methods, create a pseudo-Thread, infer a host Thread, or emit normal Project state before completion.
10. This creates no second durable store and does not change ownership of post-activation mutations.

## Failure behavior

- Stage, publication, read, validation, or application failure leaves the Project unactivated and blocks the requested operation.
- Retain an actionable diagnostic under the exact Project and surface it to the caller.
- Never fall back to Thread APIs, another Project, active-Thread state, or unvalidated defaults.
- Incomplete staging has no marker. Application failure does not destroy a valid publication.
- Retry on a later call; concurrent callers observe the same attempt.
- The fire-and-forget bounds path must become request/response or use an equivalent acknowledged error contract.

## Required verification

Tests must prove startup retry of known IDs; lazy first-use activation from real ProjectId; gating of every Project browser/annotation operation; one in-flight activation; Project isolation; published-current precedence; manager hydration before first operation; no fabricated runtime; canonical defaults when no durable legacy source; forbidden input sources never consulted; malformed/incomplete/mixed/stale/application failures block, diagnose, and retry; no partial manager state; marker-last/read-before-apply; deletion clears only one Project; no Project-list protocol; focused migration/manager/IPC/preload/acceptance suites and permitted targeted diagnostics pass.

## Bounded write surface

- `apps/desktop/src/desktopProjectWorkspaceMigration.ts` or one adjacent activation module
- `apps/desktop/src/browserManager.ts`
- `apps/desktop/src/browserIpc.ts`
- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts` and IPC channel/contract files only for acknowledged bounds errors
- corresponding Desktop migration, manager, IPC, preload, annotation, and acceptance tests

No new server Project-list route/client/cache or unrelated subsystem is authorized.

## Rejected alternatives

Server Project-list startup fetch, active/visible Thread enumeration, arbitrary in-memory Thread migration, invented Project IDs, logging then continuing with default manager state, and adding Desktop device ownership without a real consumer are rejected.

## Reopening conditions

Reopen if a durable Desktop legacy source is discovered; Project IPC lacks an authoritative admitted ProjectId; an entry point necessarily bypasses activation; atomic application conflicts with a governing invariant; device ownership evidence changes; or the owner changes the Project Contract.
