# Synara Project-owned Right-sidebar workspace

Status: product contract OWNER-CONFIRMED; implementation not started.

## Goal

Switching between Main conversations in one Project must leave the Right sidebar unchanged so the user can continue the same tool workflow across conversations.

## Current behavior and cause

Right-dock panes, terminal presentation, browser state, and split-view state are currently selected primarily by `ThreadId`. Switching conversations selects a different Thread-scoped state slice; a conversation without prior state therefore appears to reset the Right sidebar. The persistent Project expansion state in the left navigation is a separate concern and is not the reported defect.

## Accepted product contract

- One Project owns one Right-sidebar workspace.
- Every existing or new Main conversation in that Project uses the same workspace directly; no Thread copy or fallback workspace is created.
- Conversation switches preserve Right-sidebar visibility, preferred width, tab order, active tab, open tools, and restorable context inside each tool.
- Browser, Files, Source control, Side chats, and other tool tabs retain their working context. If content is unavailable, the tab remains and reports the failure explicitly.
- Project terminals preserve the same process and command history across conversation switches, continue running while another Project is active, and reconnect after restart when the process still exists.
- Closing an idle Terminal tab closes it immediately. Closing a Terminal tab with active work warns that the task will stop and requires confirmation.
- A Side chat remains open if that same conversation becomes the Main conversation.
- Each Project has an independent workspace. Switching Projects restores the destination Project's workspace.
- Archive preserves the Project, conversations, and workspace. Project deletion warns about active terminals, settles them, and removes the workspace.
- If the Synara window cannot fit the preferred Right-sidebar width, rendering may temporarily clamp it without overwriting the remembered preference.
- The existing tab design, tool types, and tool-opening interactions remain unchanged.

## Acceptance scenarios

1. Given Project A has Browser, Terminal, and Files tabs open in Conversation A1, when the user opens Conversation A2, then the same tabs, order, active tab, width, tool context, and Terminal process remain.
2. Given Project A and Project B have different workspaces, when the user moves between them, then each Project restores only its own workspace.
3. Given a Project Terminal is running, when the user changes conversation or Project, then the process continues; when the user returns, the same Terminal reconnects.
4. Given an active Terminal, when the user closes its tab, then Synara warns before stopping the task; cancellation leaves both process and UI in a truthful state.
5. Given stored tool content cannot be restored, when the workspace loads, then its tab remains visible with an actionable error and is not silently replaced.
6. Given an archived Project, when it is restored, then its conversations and workspace are unchanged.
7. Given a deleted Project, when deletion completes, then its terminals are settled and its Right-sidebar workspace is removed.
8. Given a window narrower than the preferred Right-sidebar width, when it narrows and later widens, then the Right sidebar clamps temporarily and returns to the preferred width.

## Non-goals

- Redesigning the Right-sidebar tab system.
- Changing the behavior or visual design of Browser, Terminal, Files, Source control, or Side chats.
- Changing the left navigation's Project expansion behavior.
- Shipping a product migration that automatically deletes conversations.

## Durable references

- Canonical vocabulary: `CONTEXT.md`
- Architecture decision: `docs/adr/0001-project-owned-right-sidebar-workspace.md`
- One-time local cleanup decision: `decisions/0001-one-time-synara-work-cleanup.md`
