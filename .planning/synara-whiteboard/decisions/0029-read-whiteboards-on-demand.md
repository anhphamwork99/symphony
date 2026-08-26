# Read Whiteboards on demand through the tool API

Without selected element chips, Synara sends a lightweight Whiteboard reference rather than serializing the entire document into the Main-chat prompt. The agent uses the Whiteboard tool API to inspect summaries, relevant regions, or required elements on demand. Selected chips are materialized at send because they are explicit user-provided context.
