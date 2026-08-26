# Expose validated Whiteboard operations to agents

Agents interact through a Synara-owned Whiteboard tool API for reading elements and creating, updating, moving, resizing, styling, connecting, grouping, or deleting them by stable identity. Agents do not write raw Excalidraw JSON. Synara validates operations and translates them into ordered Excalidraw scene updates.

## Consequences

The API is a maintained product boundary rather than a thin JSON pass-through. Invalid operations must fail diagnostically without corrupting the current board or partially escaping the AI edit-batch boundary.
