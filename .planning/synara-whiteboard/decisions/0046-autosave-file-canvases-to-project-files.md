# Auto-save File canvases to Project files

File canvases Auto-save settled human and agent edits directly to their backing Project `.excalidraw` files. Opening a third canvas flushes any pending File-canvas Auto-save before the older drawing engine is unmounted. A successful write updates the backing fingerprint and may create a Git working-tree change without a separate Save-button action.

## Consequences

This supersedes Decision 0040 and amends the File-canvas portion of Decision 0015. Auto-save must use server-authorized Project paths, expected backing fingerprints, atomic writes, truthful `Saving...`/`Saved`/`Not saved` states, and external-change conflict handling. A failed or conflicting write leaves the File canvas unsaved and follows the confirmed close-resolution flow. The agent still has no direct filesystem-write command; persistence is a host-owned consequence of accepted canvas edits.
