# Require explicit Whiteboard context for agent edits

An agent may edit a Whiteboard only when the request names it, includes its element chips, clearly refers to the active Whiteboard, or explicitly requests creation of a diagram. A clear diagram request automatically creates `board` when no Whiteboard exists. The agent does not proactively choose and modify an unrelated existing Whiteboard.
