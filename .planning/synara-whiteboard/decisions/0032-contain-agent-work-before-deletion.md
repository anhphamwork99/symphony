# Contain agent work before deleting a Whiteboard

A Whiteboard with an active agent operation cannot be deleted until the operation is stopped. The user may Take Over first or explicitly confirm Stop agent and delete; Synara waits for confirmed containment, deletes the Whiteboard and owned image assets, and rejects every stale update from the deleted operation generation.
