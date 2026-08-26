# Clear Whiteboard chips on Main-conversation switch

Switching away from the active Main conversation clears all unsent Whiteboard selection chips and deselects their canvas elements. Synara does not persist, copy, or restore those chips in another conversation draft. Other composer content remains governed by its existing draft behavior.

## Consequences

Whiteboard remains Project-owned, but unsent visual context is intentionally ephemeral across Main-conversation switches. This avoids cross-conversation context transfer, inactive-draft mutation, and selection-projection feedback loops.
