# Project-owned Right-sidebar workspace

Synara treats the Right-sidebar workspace as Project-owned rather than Thread-owned. Every Main conversation in a Project uses the same open tools, tab arrangement, tool context, and Project terminals, so moving between conversations does not reset the user's working environment. Each Project retains its own workspace across Project switches, application restarts, and archive/restore; deleting a Project removes its workspace and settles its running terminals after explicit warning.

This replaces the existing Thread-scoped model because conversations are alternate discussion contexts inside one Project workspace, not separate tool workspaces. The existing tab UI and tool behavior remain unchanged; only state ownership and lifecycle boundaries change.

## Consequences

- New conversations immediately use the Project's current Right-sidebar workspace instead of creating or copying their own state.
- Project terminals remain attached to the shared workspace and continue running across conversation and Project navigation.
- Unavailable tool content remains visible with an explicit diagnostic instead of being silently reset or replaced.
- Right-sidebar visibility, active tab, preferred width, tab order, and restorable tool context survive conversation changes. A constrained window may temporarily clamp the rendered width without overwriting the preferred width.
- Archived Projects retain their workspace. Deleting a Project clears it and requires explicit handling of running terminals.
- Redesigning tabs, changing tool behavior, and automatically deleting user conversations during product migration are outside this decision.
