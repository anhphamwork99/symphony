# Auto-save native Whiteboards

Status: Amended by Decision 0046 for File-canvas persistence only

Native Synara Whiteboards save automatically after changes settle rather than requiring a Save action. The UI exposes `Saving...`, `Saved`, and a persistent retryable `Not saved` state, and it must not silently discard unsaved changes when closing a tab. File-canvas persistence is governed by Decision 0046.
