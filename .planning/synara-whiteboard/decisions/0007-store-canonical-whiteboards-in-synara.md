# Store canonical Whiteboards in Synara

Synara's own persistent store is the source of truth for Whiteboards. Users can explicitly import and export `.excalidraw` files, but Synara does not continuously mirror the canonical document into the Project filesystem and AI does not edit exported JSON files directly.

## Considered Options

- Store only inside Synara.
- Use a Project `.excalidraw` file as the canonical document.
- Keep the canonical document in Synara with explicit import and export.

## Consequences

Repository folders stay clean by default and Synara controls reliable saves and recovery, while users retain an interoperability path with Excalidraw.
