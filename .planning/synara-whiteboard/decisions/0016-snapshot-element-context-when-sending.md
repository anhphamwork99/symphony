# Snapshot element context when sending a message

Before send, each Whiteboard selection chip remains a lightweight live reference to one selected element. At send time Synara materializes an immutable snapshot of that element into the message context so later Whiteboard edits cannot change the meaning of an earlier request. Sent chips are context records only and do not reopen, select, or navigate to their former Whiteboard elements.
