# Confirm unsaved content before close

Status: Amended by Decision 0046 for File-canvas Auto-save wording

Closing a native Whiteboard in `Not saved` state requires Retry save, Discard changes, or Cancel. Closing an `Unsaved` File canvas requires Retry save, Discard changes, or Cancel. Quitting Synara presents one consolidated resolution flow and quits only after each unresolved document is saved, discarded, or the user explicitly accepts loss.

## Consequences

An orderly close never silently discards visible changes. After a crash or force-kill, a native Whiteboard restores its latest confirmed durable revision and a File canvas may lose changes that were never written; the feature does not add durable draft recovery or Version history.
