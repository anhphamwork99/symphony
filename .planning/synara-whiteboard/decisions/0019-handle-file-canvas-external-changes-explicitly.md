# Handle File canvas external changes explicitly

When a backing `.excalidraw` file changes outside Synara, a clean File canvas reloads it automatically. A File canvas with unsaved local changes preserves those changes and presents explicit Reload, Save As, or Keep Editing choices. Synara will not attempt to auto-merge divergent Excalidraw JSON.
