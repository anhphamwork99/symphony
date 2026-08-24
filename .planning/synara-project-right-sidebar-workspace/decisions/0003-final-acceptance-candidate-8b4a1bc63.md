# Decision 0003 — Final acceptance of candidate 8b4a1bc63

- **Status:** Binding — rejected
- **Trigger:** One and only final acceptance consultation
- **Candidate:** `8b4a1bc635e238d67da7b9eecfad2d638ba8b188`
- **Write set:** none
- **Date:** 2026-08-24

## Question

May candidate `8b4a1bc635e238d67da7b9eecfad2d638ba8b188` be accepted as the complete integrated Project-owned Right-sidebar workspace feature under the owner-confirmed Project Contract, Implementation Plan, and Decision 0002?

## Authority

- `../PROJECT.md` governs the Project goal and scenarios.
- `../IMPLEMENTATION-PLAN.md` governs Work Package completion and verification.
- `0002-explicit-project-ownership-and-legacy-migration.md` governs ownership and migration.
- `0001-one-time-synara-work-cleanup.md` governs the owner-only cleanup boundary.

The owner-approved decisions remain binding: Project owns the workspace; one deterministic winning Thread supplies every migrated slice; publication follows complete staging; no pseudo-Thread, hidden host Thread, prefixed Thread ID, or Project-to-Thread cast; archive retains state; deletion settles resources before removing state; cleanup remains unexecuted.

## Evidence considered

The consultation inspected integrated WP1–WP8 source and acceptance tests and considered remediation commit `e085fec70`, WP8 commit `8b4a1bc63`, focused results (contracts 59, shared 68, server 83, web 96, desktop 124), earlier full Web results (313 files and 3,955 tests), earlier full Desktop results (61 files and 605 tests), zero shared diagnostics after remediation, and the clean candidate identity.

Full `bun fmt`, `bun lint`, and `bun typecheck` were not required because the Implementation Plan reserves them for explicit owner authorization. This rejection does not require those unauthorized checks.

## Prior-review reconciliation

- Shared diagnostics were repaired, but WP8 introduced a TypeScript defect by referencing `TerminalProjectEvent` without importing it.
- Capability advertisement and Web activation gating were added, but Project Terminal and Browser paths retain prohibited Thread-owned fallbacks.
- Server migration wiring is present. Desktop startup invokes migration, but an empty document supplies no Project IDs or legacy inputs, and published state does not drive `DesktopBrowserManager`.
- WP8 exists, but some negative tests tolerate forbidden fallback and pseudo-Thread behavior instead of rejecting it.

## Criterion verdict

### Project scenarios

1. **Same-Project continuity — reject.** Project-keyed dock state is preserved, but Terminal state uses a Project-derived value branded as `ThreadId`, and BrowserPanel may choose active-Thread legacy state.
2. **Project isolation — pass.**
3. **Terminal continuity and reconnect — pass for the Project server path.**
4. **Active-Terminal confirmation, cancellation, and truthful failure — pass.**
5. **Unavailable content remains with a diagnostic — pass with bounded residual uncertainty.**
6. **Archive/restore preservation — pass.**
7. **Settle before deletion — pass.**
8. **Temporary preferred-width clamp — pass.**

### Decision 0002 obligations

Obligations 1–7 and 11–13 pass. Obligation 8 rejects because Scenario 1 violates explicit ownership. Obligations 9–10 reject because Project ownership is not explicit end to end and a prefixed Project-derived `ThreadId` plus legacy Thread fallback remain. Obligation 14 rejects because the WP8 TypeScript defect and ownership defects remain; unauthorized full workspace checks are not the reason. The no-cleanup boundary passes.

## Binding decision

Reject candidate `8b4a1bc635e238d67da7b9eecfad2d638ba8b188`.

The candidate must not be marked accepted, complete, merge-ready, or cleanup-ready. Preserve its usable infrastructure and retained v1 data. Do not roll back or run cleanup.

## Required bounded remediation

1. Replace `dockTerminalProjectScope(...): ThreadId` and its branded cast with a non-Thread local key or explicit owner-kind/ProjectId store key.
2. For Project-owned Terminal state, fail explicitly when the Project API or capability is unavailable; never invoke the Thread API with a Project-derived key.
3. Remove BrowserPanel's active-Thread fallback for a Project-owned pane; migrate deterministically or retain an unavailable diagnostic.
4. Connect Desktop migration to the authoritative Project set and applicable legacy Desktop slices and consume published state in Desktop manager state. Removing this obligation requires a separately authorized reassessment.
5. Import `TerminalProjectEvent` in WP8 server tests and remove or correct the unrelated `TerminalProjectSessionSnapshot` import.
6. Strengthen WP8 negative tests to reject every Project-derived `ThreadId`, pseudo-Thread, active-Thread fallback, and legacy API invocation for Project-owned entries.
7. Rerun focused Project-workspace suites and permitted targeted diagnostics.

## Rejected alternatives

A correct common Project API path does not excuse forbidden fallbacks. Calling a prefixed key “correlation only” does not cure branding it as `ThreadId` or sending it to a Thread API. A Desktop startup call without authoritative Project/legacy inputs or a manager read path is insufficient. Cleanup cannot avoid migration.

## Reopening conditions

Reopen only after source and test evidence closes the bounded remediation and the human owner explicitly authorizes another final-acceptance consultation.
