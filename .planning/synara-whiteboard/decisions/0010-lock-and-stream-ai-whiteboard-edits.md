# Lock input while streaming AI Whiteboard edits

While AI is working, the Whiteboard prevents direct user edits but progressively displays the AI's changes. A status bar below the panel reads `Agent is working on it...` and offers Take Over, which stops further AI work and returns control to the user. The whole AI edit batch, including an interrupted partial result, must remain undoable as one action.

## Consequences

Take Over retains already-applied partial edits, ends the Whiteboard operation and current agent turn in a controlled way, and prevents automatic retry. The integration needs explicit operation identity, ordered update handling, interruption, stale-update fencing, and an undo boundary spanning multiple visible scene updates.
