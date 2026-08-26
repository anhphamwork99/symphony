# Target Whiteboards deterministically and undo AI edits as a batch

AI resolves its target Whiteboard from an explicitly named Whiteboard, otherwise the Active Whiteboard, otherwise the Project's sole Whiteboard; if multiple unresolved candidates remain, it asks the user. Selected element chips provide context but do not constrain the elements the agent may update. All changes produced by one AI request form one AI edit batch that can be undone with one action.

## Consequences

AI must not silently infer a target Whiteboard from semantic similarity alone. Element selection is not an authorization boundary, while the integration must still preserve one change boundary above Excalidraw's individual element operations.
