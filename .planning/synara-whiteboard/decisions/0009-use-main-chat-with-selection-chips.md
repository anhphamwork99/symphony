# Use Main conversation with Whiteboard selection chips

Whiteboard will not contain a separate chat. Every selected element automatically appears as its own Whiteboard selection chip in the Main composer so the next request can reference those elements while conversation history remains in one place. Selection is synchronized both ways: canvas deselection removes the corresponding chip, and closing a chip deselects the corresponding canvas element.

## Consequences

Each chip must be a lightweight element reference rather than a copied element or scene payload. Synara must diff settled selected-element IDs, update chips without publishing pointer-move noise, and materialize referenced content only when the user sends the request.
