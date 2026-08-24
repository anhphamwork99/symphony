# Decision 0005 — Final-acceptance reassessment of candidate 9dd2fd5db

- **Status:** Binding Reassessment — rejected
- **Trigger:** Owner-authorized final-acceptance reassessment after Decision 0003
- **Candidate:** `9dd2fd5db98e3b528a9a7c38ce16b60648bb7ca2`
- **Write set:** none
- **Date:** 2026-08-24

## Question

May candidate `9dd2fd5db98e3b528a9a7c38ce16b60648bb7ca2` be accepted as the complete integrated Project-owned Right-sidebar workspace feature after Decision 0003 remediation and under Desktop Decision 0004?

## Governing references

- `../PROJECT.md`
- `../IMPLEMENTATION-PLAN.md`
- `0002-explicit-project-ownership-and-legacy-migration.md`
- `0003-final-acceptance-candidate-8b4a1bc63.md`
- `0004-desktop-authoritative-lazy-project-workspace-activation.md`
- `0001-one-time-synara-work-cleanup.md`

The owner-approved ownership, one-winner/all-slices migration, marker-last publication, no-pseudo-Thread, archive-retention, settle-before-delete, and no-cleanup decisions remain unchanged.

## Evidence

Candidate HEAD was confirmed as `9dd2fd5db98e3b528a9a7c38ce16b60648bb7ca2`.

Exact-candidate verification:

- targeted Web: 42 passing;
- targeted server: 24 passing;
- Desktop: 120 passing;
- lint: 0 warnings and 0 errors over 2,624 files;
- typecheck: 7/7;
- full test command: 8/8 Turbo tasks passing:
  server 5,051 pass/18 expected skips, Web 3,971/3,971,
  Desktop 624 pass/5 expected skips, scripts 150/150,
  contracts 327/327, shared 602 pass/1 expected skip.

## Reassessment

Decision 0003 remediation items 1–3 and 5–7 are closed. Desktop remediation item 4 is substantially implemented: authoritative lazy activation from real `ProjectId`, complete IPC and automation gating, marker-last publication, fresh published hydration, diagnostics, isolation, retry, and manager-level deletion invalidation.

One integrated criterion remains open: `DesktopBrowserManager.handleProjectRemoved(projectId)` has no production caller. Tests call it directly. No production Desktop path consumes committed `project.deleted`, and the durable Desktop publication is not removed or terminally invalidated. A later activation can therefore restore a deleted Project.

Project scenarios 1–6 and 8 pass. Scenario 7 rejects at the integrated Desktop boundary. Decision 0002 obligations pass except obligation 8 because all scenarios are not yet satisfied. Decision 0004 passes except binding item 8.

The owner-only cleanup remains unexecuted.

## Binding verdict

Reject candidate `9dd2fd5db98e3b528a9a7c38ce16b60648bb7ca2`.

The candidate must not be marked accepted, complete, merge-ready, or cleanup-ready. Preserve current remediation and v1 data. Do not run cleanup.

## Exact required remediation

Wire committed Project deletion to one production Desktop boundary that:

1. receives the deleted real `ProjectId`;
2. invokes `DesktopBrowserManager.handleProjectRemoved(projectId)`;
3. clears `DesktopProjectWorkspaceActivation` bookkeeping for only that Project;
4. removes or terminally invalidates that Project’s durable staged slices, publication marker, and diagnostic without touching other Projects or retained v1 data;
5. cannot race concurrent activation into republishing or reapplying the deleted workspace;
6. is tested through the real production event/command path, including restart or subsequent activation proving deleted Desktop state cannot reappear.

Rerun bounded Desktop deletion/activation/acceptance suites and final verification.

## Rejected alternatives

The existence of an uncalled method or direct unit test is insufficient. Server deletion does not prove Desktop deletion. Browser unmount, hide, navigation, process exit, restart, or merely clearing in-memory bookkeeping cannot terminate ownership. Old Desktop publication cannot remain activatable. Owner-only cleanup cannot substitute for product deletion.

## Downstream effect

Decision 0003’s rejection remains operative. Acceptance, merge-ready status, and cleanup remain blocked. Work is limited to the exact Desktop deletion lifecycle defect and its verification.

## Reopening conditions

Reopen after production source connects committed Project deletion to Desktop manager, activation, and durable-publication invalidation; integrated tests prove only that Project is cleared and cannot reappear after retry/restart; and the owner authorizes the next consultation.
