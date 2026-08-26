# Snapshot current element state at send

When the user sends a message, Synara resolves each selected element at its current Whiteboard revision and snapshots that latest state with minimal related context. The revision stored by the lightweight chip is provenance and diagnostic input rather than a requirement that the element remain unchanged after selection.

## Consequences

Element edits do not republish composer draft state while selection identity remains unchanged. A deleted element removes its unsent chip, and send-time resolution never fabricates stale or missing context.
