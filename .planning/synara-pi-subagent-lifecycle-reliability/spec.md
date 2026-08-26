# Project specification — Synara Pi subagent lifecycle reliability

**Project home:** [PROJECT.md](PROJECT.md)
**Status:** active; exact frontier Ticket 01
**Primary repository:** Symphony at `a7827cae7`
**Conditional secondary:** Alfie at `aa6fa4a8540644d2509b10d6df854486ddc67d1d`

## Problem statement

A public detached Agent result can expose `executionId`, while its hidden
renderer details retain the Alfie `agentId`. Alfie's `get_subagent_result`
currently performs a strict in-memory AgentManager lookup by `agent_id`.
Consequently, calling the result tool with the public durable identity returns
`Agent not found` even while the child continues progressing. Restart
reconciliation may correctly orphan uncertain work, watchdog stages may reach
cleanup uncertainty, and teardown may remain owner-unproven, but the user then
receives an unusable result/read/control surface. Resume can be offered while
provider runtime is inactive and be rejected at dispatch, which is truthful at
the server boundary but not yet an end-to-end reliable lifecycle.

## Required outcome

Make the managed execution lifecycle reliable across:

1. public identity exposure;
2. durable result retrieval;
3. live lifecycle observation and control;
4. terminal-before-cleanup settlement;
5. restart and reconnect projection truth;
6. explicit, truthful Resume eligibility;
7. integrated real-Pi acceptance.

The outcome must preserve the inherited durable-subagent and handshake-first
invariants. It must not silently choose one of the candidate architectures
listed in [PROJECT.md](PROJECT.md).

## Normative invariants

- `executionId` is the durable public identity; it remains stable across
  attempts and explicit Resume.
- `attemptId` and generation identify a concrete run and fence stale evidence.
- Terminal outcome is distinct from cleanup proof and completion delivery.
- Terminal evidence is journal-first and bounded before public delivery.
- `cleanup_uncertain`, `survivors`, and `owner_unproven` are non-terminal
  uncertainty unless an accepted proof path settles them.
- No raw PID, PID file, process name, or guessed process group grants kill
  authority to Symphony.
- No automatic replay or Resume of side-effecting or uncertain work.
- All read/control surfaces are bounded and authorized.
- Accepted watchdog bands 70–74 and teardown bands 75–78 remain stable unless
  a binding reassessment explicitly changes them.
- Controlled Alfie provenance and production composition remain mandatory.

## Acceptance model

A project candidate is acceptable only when the six tickets collectively supply:

- a deterministic incident reproduction and decision matrix;
- a canonical identity/result-read contract;
- terminal-before-cleanup and live containment evidence;
- cancellation/watchdog/owned teardown retry evidence;
- restart/reconnect/Resume/crash-diagnostic evidence;
- an isolated integrated real-Pi acceptance path using the inherited evidence
  split and pin rules.

Every ticket must report both normal behavior and material failure/diagnostic
behavior. A compile or typecheck result alone is not acceptance evidence.

## Prohibited interpretations

The following are supporting candidate directions only, pending explicit gates:

- a designer crash guardian as a required owner;
- an orphan-terminal exception that fabricates finality from uncertainty;
- a durable post-restart owner receipt that creates kill authority without a
  live identity-capturing owner;
- provider-bootstrap Resume that silently turns restart into replay.

## Verification envelope

The project follows inherited Decision 0001 and applicable decisions:

- deterministic lower-level tests may prove state-machine and repository
  contracts;
- wall-clock tests use the accepted standalone/isolation discipline;
- real-Pi evidence must use the controlled pinned artifact and isolated runtime;
- destructive process-tree claims require the accepted deterministic plus
  isolated manual evidence split, not a mock-only or invented CI claim;
- exact source locators and candidate provenance are recorded in reports.

## Delegation contract

Only Ticket 01 is ready at initial creation. Ticket 01 is read-only and must
produce no source changes. Tickets 02–06 remain blocked until their dependency
and material decision gates are explicitly discharged in the sole router
[PROJECT.md](PROJECT.md).
