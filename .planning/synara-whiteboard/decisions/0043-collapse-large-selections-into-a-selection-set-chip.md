# Collapse large selections into a selection-set chip

Below a measured safe threshold, every selected element appears as its own Whiteboard selection chip. Above that threshold, the composer displays one Whiteboard selection-set chip such as `327 elements selected` while Synara preserves the complete selected-ID set behind a lightweight reference. The agent reads the selection in bounded batches through the Whiteboard tool API.

## Consequences

Synara never silently truncates selected context. Closing the selection-set chip deselects the full set, and the composer returns to per-element chips when selection falls below the threshold. The threshold is a centralized measured policy value, not a board-level element limit.
