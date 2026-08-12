# Decision 12: Synara MCP command activity contract

Status: Accepted technical decision
Date: 2026-08-12

## Decision

Synara-owned MCP command acknowledgements use the existing durable
`thread.activity.append` -> `thread.activity-appended` path. No new orchestration
event or activity schema is required.

Use exactly these activity kinds:

- `synara.mcp.command.pending`
- `synara.mcp.command.succeeded`
- `synara.mcp.command.failed`

An accepted command gets one stable `requestId`. Pending and terminal activities
have distinct deterministic activity IDs derived from the request ID, while
sharing the request ID in their payload. Pending is emitted only when the
command waits for an active turn; exactly one terminal activity is emitted.
Each phase also has a distinct deterministic orchestration `commandId` so
command-receipt deduplication cannot suppress the terminal phase.

All acknowledgement activities use `turnId: null`: they are Synara control-plane
facts, not Pi turn content. The payload is:

```ts
{
  requestId: string;
  command: "enable" | "disable";
  phase: "pending" | "terminal";
  status: "pending" | "succeeded" | "failed";
  requestedState: "enabled" | "disabled";
  finalState?: "enabled" | "disabled"; // terminal only
  detail?: string; // failed terminal only, sanitized and <= 1 KiB UTF-8
}
```

The server owns interception, persistence, deferred reconciliation, terminal
outcome, and both activity emissions. Activities are not assistant messages,
model input, browser-only toasts, or direct projection writes.

The web work log explicitly retains all three null-turn kinds. They do not enter
sidebar summary activity kinds or pending-interaction state. Replay and live
reduction must yield the same two durable rows; pending and terminal are not
collapsed.

## Rejected alternatives

Assistant messages, client-only acknowledgements, direct projection writes,
provider lifecycle kinds, one shared activity ID, one shared append command ID,
random IDs per retry, active-turn binding, raw diagnostics in summaries, and
sidebar-summary participation are rejected.

## Evidence and verification

Supervisor decision based on scout evidence from
`packages/contracts/src/orchestration.ts`, orchestration decider and journal,
activity projectors, `apps/web/src/storeEventReducer.ts`, normalization and
`workLog.ts`. Tests must cover interception ownership, active/idle pending
behavior, deterministic idempotency and restart recovery, strict payload and
sanitized diagnostics, journal/projection replay, null-turn visibility, and
absence from assistant/sidebar state.
