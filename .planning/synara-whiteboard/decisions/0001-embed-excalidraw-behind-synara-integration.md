# Embed Excalidraw behind a Synara-owned integration

Synara will embed the official `@excalidraw/excalidraw` package rather than fork the Excalidraw source. Synara will own the surrounding persistence, tool integration, AI operations, and product behavior so the drawing engine can be upgraded or replaced without making Excalidraw's internal source structure the feature boundary.

## Considered Options

- Embed the official package and integrate through its public API.
- Fork Excalidraw and maintain a Synara-specific drawing engine.

## Consequences

Deep customizations that are not exposed by Excalidraw's public API may be deferred or require this decision to be revisited.
