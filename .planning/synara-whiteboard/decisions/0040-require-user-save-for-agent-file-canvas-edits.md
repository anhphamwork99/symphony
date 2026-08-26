# Require user Save for agent File canvas edits

Status: Superseded by Decision 0046

An agent may edit an explicitly referenced File canvas in memory so the user can review progressive results, use Take Over, and Undo or Redo within the bounded session history. The canvas becomes `Unsaved`, and the agent cannot persist the result into the Project `.excalidraw` file. Only an explicit user Save or Save As writes to the filesystem and makes the change visible to Git.
