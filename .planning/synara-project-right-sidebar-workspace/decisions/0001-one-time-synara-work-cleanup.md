# One-time Synara Work cleanup

Before implementing or validating the Project-owned Right-sidebar workspace in the owner's current Synara Work environment, create a timestamped database backup, then perform an explicitly invoked one-time cleanup that removes all existing conversations, conversation history, and legacy Thread-scoped Right-sidebar data, including data associated with archived Projects. Preserve Project records and filesystem content. Each preserved Project starts afterward with no conversations and an empty Right-sidebar workspace.

This is an owner-specific operational reset, not a product migration. It must never run automatically for other users or be inferred from application upgrade. The cleanup itself remains unexecuted until separately requested and authorized.
