# Do not add durable Whiteboard Version history

Whiteboard will not expose a persistent timeline of historical versions or restoration points after application restart. Undo and Redo exist only in memory for the current application session and retain at most the 20 most recent events. The feature still requires reliable current-state persistence and treats one AI edit batch as one event, but it will not become a document-versioning product.
