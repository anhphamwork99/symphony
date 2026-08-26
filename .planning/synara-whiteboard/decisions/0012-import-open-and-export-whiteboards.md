# Import safely and support interoperable exports

Importing `.excalidraw` creates a new Whiteboard by default rather than replacing the active one. Opening an `.excalidraw` file through Synara's file-opening flows opens a File canvas backed by that file; edits are saved to the file, and it does not appear in the Whiteboard launcher unless the user chooses Import as Whiteboard. Users can export editable `.excalidraw` files and rendered PNG or SVG assets.

## Consequences

Native Whiteboards and File canvases share the drawing experience but have different ownership, persistence, lifecycle, and conflict behavior. The UI must identify which kind is open without presenting two different editors.
