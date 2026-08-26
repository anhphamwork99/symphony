# Research 001 — live incident and current seam map

**Classification:** Supporting evidence only; not authority and not an
acceptance record.

## Incident statement

The public detached Agent output exposes `executionId`, while hidden details
retain Alfie's provider-local `agentId`. A subsequent `get_subagent_result`
call using the public identity returns `Agent not found` because the pinned
Alfie GET_RESULT path performs strict `manager.getRecord(params.agent_id)`.
The child can continue progressing after this failed read, so the error is an
identity/read-continuity defect rather than proof of child termination.

Observed incident context:

- restart reconciliation orphaned correctly when owner/terminal proof was
  unavailable;
- watchdog bands 70–74 reached `cleanup_uncertain`;
- teardown bands 75/78 recorded owner-unproven uncertainty;
- an OS test process was reparented to PPID 1 and later exited without terminal
  proof;
- Resume was offered but rejected because the provider runtime was inactive.

## Source locators

Pinned Alfie (`/Users/anhpham99/alfie`, commit
`aa6fa4a8540644d2509b10d6df854486ddc67d1d`):

- `agent/extensions/pi-subagents/src/index.ts:2219-2255` —
  `get_subagent_result` schema and strict `manager.getRecord(agent_id)`;
  missing records return `Agent not found`.
- `agent/extensions/pi-subagents/src/index.ts:1265-1347` — hidden details,
  detached rendering, and status display.
- `agent/extensions/pi-subagents/src/index.ts:1948-2219` — Agent result
  construction and detached result details.
- `agent/extensions/pi-subagents/src/agent-manager.ts:326` — Manager record
  keyed by provider-local Agent id.
- `agent/extensions/pi-subagents/src/agent-runner.ts:388-625` — child agent
  id creation and run options.

Symphony at base `a7827cae7`:

- `apps/server/src/provider/Layers/PiAdapter.ts:4268-4435` — managed Agent
  wrapper and admission path; `:4174-4235` — durable start/detach journal.
- `apps/server/src/persistence/Services/PiSubagentExecutionRepository.ts:715-1125`
  — admission, terminal, restart, and teardown repository contracts.
- `apps/server/src/provider/piSubagentRestartReconciliation.ts:21-56,183-482`
  — read-only reconciliation; terminal restore, live-owner probe, or orphan.
- `apps/server/src/provider/piSubagentWatchdogEscalation.ts:21-59,196-238`
  — bands 70–74 and non-terminal teardown handoff.
- `apps/server/src/provider/piSubagentProcessTeardown.ts:15-65,205-265`
  — proof-before-fence, owned-only teardown, bands 75–78.
- `apps/server/src/provider/piSubagentForegroundAcceptance.test.ts:905-940,1127-1128,1614-1660`
  — detached public `executionId`, durable journal, and legacy split seams.

## Seam map

| Layer | Current seam | Reliability risk to investigate |
| --- | --- | --- |
| Alfie public Agent result | `executionId` in detached result | Must be accepted by all public read/control calls. |
| Alfie hidden details | `agentId` and renderer metadata | Can diverge from durable identity. |
| Alfie GET_RESULT | strict Manager lookup | Cannot read durable terminal after eviction/restart. |
| Symphony admission | mints/persists execution identity | Must become canonical and remain bounded. |
| Symphony lifecycle repository | terminal/outbox/journal | Must expose result continuity without weakening auth/fencing. |
| Restart reconciliation | terminal/live-owner/orphan | Must not replay and must explain Resume limits. |
| Watchdog/teardown | 70–78 evidence bands | Uncertainty must not be relabeled terminal. |
| Provider session | runtime may be inactive | Resume/control dispatch failure must remain truthful. |

## Reproduction recipe for Ticket 01

Read-only only:

1. Confirm Symphony is at the stated base and Alfie is at the stated pin.
2. Inspect the detached Agent result and hidden details for one managed child.
3. Record public identity, hidden `agentId`, durable row identity, attempt, and
   generation without changing source or runtime state.
4. Invoke/read the provider GET_RESULT seam with each identity in an isolated
   test fixture or existing test seam; record strict lookup behavior.
5. Compare live progress, durable journal, terminal evidence, and result-read
   outcome while the child remains active.
6. Produce a matrix for normal, provider-record-evicted, restart, stale,
   unauthorized, and inactive-provider cases.

## Evidence limits

This record does not decide whether to alias `agentId`, change Alfie output,
add a durable read API, or add a provider bootstrap. Those are Ticket 02/05
decision gates.
