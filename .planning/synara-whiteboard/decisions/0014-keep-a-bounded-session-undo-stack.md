# Keep a bounded session Undo and Redo stack

Each open Whiteboard retains at most the 20 most recent Undo/Redo events in memory for the current application session. The limit covers both human and AI changes; one complete or interrupted AI edit batch counts as one event. The stack is not restored after Synara restarts.
