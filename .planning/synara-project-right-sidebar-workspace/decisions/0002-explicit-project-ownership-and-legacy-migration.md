# Project-owned Right-sidebar workspace ownership and deterministic legacy collision migration

Status: Binding technical decision; accepted for planning and implementation.

## Context

The owner-confirmed Project Contract requires one Project to own one Right-sidebar workspace shared directly by every Main conversation in that Project. Existing implementation surfaces are predominantly keyed by `ThreadId`, including RightDock state, terminal presentation/runtime ownership, browser and browser-automation state, annotations, device state, and related IPC.

Existing installations may contain several valid legacy Thread-owned workspace records for one Project. Product migration must choose one coherent source without deleting conversations or legacy data. The owner-only cleanup in Decision 0001 is a separate, explicitly invoked operation; it remains unexecuted and is neither a product migration nor a prerequisite.

Governing references:

- Authoritative: `.planning/synara-project-right-sidebar-workspace/PROJECT.md`
- Authoritative: `docs/adr/0001-project-owned-right-sidebar-workspace.md`
- Authoritative: `CONTEXT.md`
- Authoritative for cleanup boundary only: `.planning/synara-project-right-sidebar-workspace/decisions/0001-one-time-synara-work-cleanup.md`

## Findings

1. Changing only the React selection key cannot satisfy the contract. Workspace ownership crosses persistence, APIs, runtime registries, lifecycle operations, desktop/native resources, reconnect behavior, and deletion handling.
2. A `ProjectId` disguised as, cast to, or encoded inside a synthetic `ThreadId` would preserve the old ownership model and violate identifier semantics. It would also create collisions and incorrect Thread lifecycle behavior.
3. Selecting an independent winner for each persisted slice could create a workspace that never existed—for example, RightDock tabs from one Thread, terminals from another, and browser/device state from a third.
4. The only deterministic and coherent collision policy is to choose one winning legacy Thread per Project, then migrate every workspace slice from that same winner.
5. Archived Threads remain part of an archived Project and are valid migration sources. Deleted Threads are ineligible.
6. Migration ordering must use durable Thread metadata. Browser-local access order, active navigation state, array order, object insertion order, hydration timing, and wall-clock migration time are not valid ordering authorities.
7. Conversation identity remains legitimately Thread-owned. Side-chat pane references, provider sessions, messages, turns, automation continuation conversations, and other conversation records must not be globally converted to `ProjectId`.

## Chosen direction

Introduce explicit `ProjectId` ownership for the Right-sidebar workspace end to end. Every workspace read, write, event, command, subscription, reconnect, and lifecycle operation identifies the owning Project directly.

Main-conversation changes select a different conversation without selecting, copying, resetting, or creating a different Right-sidebar workspace. Nested content identities remain in their native domains: a Project-owned Side-chat pane may reference a real `ThreadId`; a Project-owned browser workspace may contain browser tab IDs; a Project-owned terminal collection may contain terminal IDs.

Provider/conversation sessions remain Thread-owned unless they independently satisfy a Project-owned workspace responsibility. This decision does not authorize replacing unrelated `ThreadId` usage.

### Mandatory layers and ownership surfaces

1. **Contracts**
   - Add or revise schema-level workspace commands, results, state, events, subscriptions, and IPC contracts to carry a real `ProjectId`.
   - Represent Project-owned terminal, browser/automation, annotation, and device operations explicitly; do not rely on an accompanying Thread to infer the Project.
   - Preserve `ThreadId` only where it identifies an actual conversation or conversation-scoped resource.
2. **Shared runtime utilities**
   - Change workspace keys, helper inputs, lookup utilities, routing functions, and automation/browser ownership helpers to use `ProjectId`.
   - Provide one canonical ownership vocabulary and key derivation path shared by consumers where appropriate.
   - Do not add a synthetic alias function that returns a `ThreadId` for a Project.
3. **Web**
   - Key persisted and in-memory RightDock state by `ProjectId`, including visibility, preferred width, tab order, active tab, pane descriptors, and restorable pane context.
   - Key terminal presentation and Project-terminal selection by `ProjectId`.
   - Key browser, browser-automation, browser-annotation, and device workspace state by `ProjectId`.
   - Move any Right-sidebar geometry or split-view state that controls the Project workspace to Project ownership.
   - Resolve the active Project independently of the active Main conversation. Conversation switches must not trigger workspace cloning, fallback selection, reset, or rehydration under another key.
   - Preserve real `ThreadId` references inside Side-chat panes and other conversation-backed pane content.
4. **Server**
   - Key workspace services, registries, persistence, subscriptions, event routing, reconnect state, terminal ownership, browser/automation ownership, annotations, and device attachment state by explicit `ProjectId`.
   - Resolve authorization and lifecycle against the actual Project record, not whichever Thread happens to be active.
   - Project archive retains workspace state. Project deletion warns about and settles active terminals before removing the Project workspace.
   - Thread archive, deletion, navigation, or replacement must not remove the Project workspace. A missing content dependency leaves its pane present with an explicit diagnostic.
5. **Desktop/native boundary**
   - Revise preload, IPC, desktop process managers, browser/native panel registries, browser automation, annotation routing, terminal process ownership, and device managers to accept and store `ProjectId`.
   - Native resources survive Main-conversation and Project navigation as required; visibility changes are not ownership termination.
   - Reconnect and replay restore the resource into the owning Project workspace without inventing a host Thread.
6. **Persistence and migration tooling**
   - Implement one versioned migration coordinator covering every legacy workspace slice.
   - Use schema validators/sanitizers for each slice and a durable migration publication record or equivalent version marker.
   - Keep migration selection logic pure and shared so web, server, and desktop tests cannot encode different collision policies.

## Prohibited shortcuts

- No `ProjectId as ThreadId`, branded-type cast, prefixed pseudo-Thread ID, hidden host Thread, default Thread, or other synthetic Thread alias.
- No selecting the active, first, newest-created, first-enumerated, or first-hydrated Thread as an implicit workspace host.
- No copy-on-conversation-switch, lazy Thread fallback workspace, or per-Thread mirror treated as canonical.
- No independent winner selection per workspace slice.
- No merging panes, terminal sessions, browser tabs, automation state, or device state from different legacy Threads.
- No automatic deletion, archival, mutation, or reassignment of conversations.
- No invocation or incorporation of the owner-only cleanup.
- No silent removal or replacement of tabs whose backing content cannot be restored.
- No overwriting the remembered preferred width with a temporary viewport clamp.
- No publication of a partially migrated Project workspace.
- No deletion or destructive rewriting of v1 data as part of migration.

## Exact legacy migration algorithm

### A. Inputs and snapshot

1. Read a stable snapshot of Projects, Threads, and every v1 Thread-owned Right-sidebar workspace slice before selecting winners.
2. The complete slice set includes RightDock visibility/preferred width; pane order, active pane, descriptors, and restoration context; Right-sidebar geometry; terminal presentation and durable runtime/reconnect metadata; browser tabs, native state, automation, and annotations; and device attachment/reconnect metadata.
3. Validate each legacy slice with its version-appropriate schema. Malformed data does not become valid merely because a key exists.

### B. Candidate eligibility

1. Evaluate candidates separately for each non-deleted Project.
2. A Thread is eligible exactly when its durable `projectId` equals the Project ID, its durable `deletedAt` is `null`, and at least one workspace slice contains valid, non-default workspace data after validation.
3. An archived Thread is eligible. `archivedAt` does not disqualify it.
4. A deleted Thread is ineligible even if stale v1 workspace data remains.
5. A Thread whose slices are all absent, malformed, or canonically default is not a candidate.
6. “Non-default” is defined by canonical, slice-specific predicates—not raw serialized-byte inequality, key presence, or incidental metadata.

### C. Deterministic winner ordering

1. Sort eligible Threads by durable Thread `updatedAt`, newest first.
2. Compare normalized instants, not locale-formatted strings or migration-time clocks.
3. For equal durable `updatedAt`, sort by lexicographically ascending canonical `ThreadId`.
4. Select the first Thread after that ordering.
5. If no eligible Thread exists, the Project reads the canonical empty Project workspace.

### D. All-slices rule

1. After selecting the winner, read every workspace slice from that one winning Thread.
2. Validate and migrate each winning slice into its Project-owned schema.
3. If a winning slice is absent, malformed, or default, publish the corresponding canonical default Project-owned slice.
4. Never fill such a slice from another Thread.
5. Preserve valid pane descriptors and their real nested identities. If a backing resource is unavailable, retain the pane and represent restoration failure explicitly.
6. Record migration provenance sufficient to diagnose the source version and winning `ThreadId`; provenance does not make the winner a continuing runtime owner.

### E. Existing Project-owned data

1. A valid, already-published current-version Project workspace is authoritative and is not overwritten by legacy migration.
2. An incomplete or unpublished target is not successfully migrated.
3. Recovery may deterministically reconstruct the same target from retained v1 inputs.

### F. Idempotent commit and publication

1. Derive the complete Project-owned target payload before making it visible.
2. Stage or transactionally write every destination slice under the real `ProjectId`.
3. Use deterministic keys and upserts so rerunning from the same snapshot produces no duplicate resources.
4. Publish the workspace version/migration marker only after every destination slice is durably committed.
5. Readers use Project-owned data only after publication; they do not compose published and legacy slices.
6. Failure leaves the target unpublished, observable, and retryable.
7. Retry verifies or replaces incomplete deterministic data without reselecting because partial writes changed timestamps.
8. Process Projects independently so one failure does not falsely publish another Project’s incomplete state.

### G. Retention

1. Retain all v1 Thread-owned workspace records through the migration and rollback window; do not delete or destructively rewrite them.
2. Retain every conversation, message, history record, archived Thread, and other conversation-owned datum.
3. Product migration must not invoke the owner-only cleanup or mark it completed.
4. Any later v1 retirement requires a separately reviewed retention decision and evidence that rollback and compatibility obligations are discharged.

## Scope

In scope: ownership and lifecycle conversion for RightDock, terminal, browser and browser automation, browser annotations, device state, Right-sidebar geometry, durable persistence, IPC, server routing, desktop/native resources, restart/reconnect, archive/restore, Project deletion, and deterministic migration.

Out of scope: tab redesign; changes to existing tool behavior or visuals; left-navigation Project expansion; conversion of conversation/provider semantics to Project ownership; automatic conversation deletion; execution of the owner-only cleanup.

## Downstream planning constraints

- Treat contracts, shared utilities, web, server, desktop/native, persistence, and migration as one integrated ownership change.
- Work may be divided into implementation units, but no unit may establish a synthetic Thread host as an intermediate architecture.
- Contract and persistence versions land before or atomically with consumers that require them.
- Dual-read compatibility, if temporarily necessary, is bounded and versioned: published Project data wins; otherwise deterministic migration runs.
- Project deletion and terminal settlement are designed together so state cannot be removed while owned processes remain falsely reported as settled.
- Unavailable resources use explicit restoration-error states, not tab deletion or default replacement.
- Migration behavior and tests complete before claiming safety for existing installations.

## Verification obligations

1. Unit-test candidate eligibility, including archived, deleted, malformed, absent, and canonical-default records.
2. Unit-test descending durable `updatedAt` ordering and lexicographically ascending `ThreadId` tie-breaking.
3. Prove all slices come from one winner, including when another Thread has richer data in a missing winner slice.
4. Prove repeated migration is idempotent and cannot duplicate resources.
5. Inject failure between destination writes and prove no partial workspace is published; retry converges to the same result.
6. Prove valid current-version Project data is not overwritten.
7. Prove v1 records and all conversations remain unchanged.
8. Test every Project Contract acceptance scenario across conversation switches, Project switches, restart/reconnect, archive/restore, narrow-window clamping, unavailable content, active-terminal close confirmation, and Project deletion.
9. Verify explicit `ProjectId` propagation across contracts, web, shared helpers, server, preload/IPC, and desktop managers.
10. Add negative tests or static checks showing synthetic Thread aliases and implicit active-Thread ownership are absent.
11. Verify terminal processes continue across conversation and Project navigation and reconnect after restart when still alive.
12. Verify deletion settles active terminals before workspace removal and reports uncertain or failed settlement truthfully.
13. Verify malformed or unavailable browser/device/terminal state retains its tab with an actionable diagnostic.
14. Run focused migration and ownership tests first, then the repository’s required final verification suite before completion.

## Rejected alternatives

- Synthetic Thread host per Project: violates explicit ownership and contaminates Thread lifecycle semantics.
- Active or first Thread as host: navigation-dependent and nondeterministic.
- Newest slice independently: fabricates a workspace from inconsistent histories.
- Merge all valid legacy state: conflict semantics and resource identity are unpredictable and require unapproved UI.
- Only unarchived Threads: contradicts archive preservation.
- Owner cleanup as migration: owner-specific, destructive, unexecuted, and prohibited as automatic migration.
- Delete v1 after successful write: weakens rollback and violates retention.

## Assumptions and residual uncertainty

- Durable Thread `updatedAt`, `deletedAt`, `archivedAt`, and `projectId` are available from authoritative persisted orchestration state.
- Each legacy workspace slice can expose a canonical validator and non-default predicate.
- Cross-store publication may require a migration journal or publication marker if one physical transaction cannot span browser, server, and desktop persistence.
- Exact schema and storage version numbers remain implementation detail if they preserve this algorithm and publication invariant.

## Failure and rollback implications

- Before publication, normal readers remain on the prior compatible path and do not observe staged Project data.
- After publication, rollback disables Project-owned reads for the affected version and reads retained v1 data; it does not attempt lossy reverse migration.
- Runtime rollback involving live terminals, browser automation, or devices first settles or detaches newly owned native resources truthfully to avoid duplicate ownership.
- A failed migration remains retryable and observable; it does not silently reset the Project workspace.
- Conversation records and v1 workspace data remain the rollback source.

## Reopening conditions

Reopen only if durable Thread ordering metadata is unavailable or unsuitable; a required workspace resource cannot be addressed by `ProjectId` without violating an owner-approved fact; atomic publication cannot be achieved with a journal, marker, or equivalent recovery protocol; retained v1 data cannot support safe rollback; or the owner changes the Project Contract.

Implementation inconvenience, migration complexity, existing Thread-keyed APIs, or preference for a smaller diff are not reopening conditions.
