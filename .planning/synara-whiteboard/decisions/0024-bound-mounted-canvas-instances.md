# Bound mounted canvas instances

Status: Amended by Decision 0046 for File-canvas unmount behavior

Synara keeps at most two canvas instances mounted for the current workspace: the active canvas and the most recently used canvas. Other clean canvases are saved, retain restorable viewport state, and unload from memory. A File canvas with unsaved changes cannot be evicted until its save state is resolved.

## Consequences

Tab switching among many Whiteboards may require rehydration, but memory use does not grow linearly with every open Excalidraw tab.
