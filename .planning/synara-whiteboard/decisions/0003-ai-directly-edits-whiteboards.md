# Allow AI to edit Whiteboards directly

When the user asks AI to work on a Whiteboard, AI may directly create, modify, and delete its content rather than being limited to read-only access or proposed changes. The design must therefore make edits observable and recoverable; the exact undo, history, and targeting behavior remains open in the interview.

## Considered Options

- Read-only AI access.
- Preview changes and require confirmation before applying them.
- Apply user-requested AI edits directly.
