# impl-01 — Canonicalize Pi runtime events before persistence

**What to build:** Normalize Pi tool event details at the provider adapter boundary so valid runtime events survive strict journal persistence.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Normalize leading/trailing whitespace and CRLF in Pi tool detail fields.
- [x] Omit whitespace-only detail without weakening the canonical schema.
- [x] Preserve raw output in the raw/data payload where required.
- [x] Add regression coverage for newline, CRLF, whitespace-only, and malformed output.

**Implementation:** Merged in `2e9ad12c` with follow-up seam cleanup in
`b5a0adb4`. Focused worker verification passed 126 tests; the final public-seam
cleanup passed 29 tests. The main checkout could not rerun Vitest because the
local `vitest` dependency is unavailable.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** PiAdapter runtime-event normalization boundary → canonical journal — leading/trailing whitespace and CRLF are normalized, whitespace-only canonical detail is omitted, raw output remains lossless, and valid events persist successfully.
- **AC2:** Runtime ingestion/quarantine boundary — malformed detail shape or payload that remains invalid after normalization is rejected or quarantined diagnostically; journal-first delivery is not bypassed and invalid events do not disappear silently.

Failure ownership is intentionally narrow: this ticket owns canonicalization and malformed-event diagnostics, not a general cross-provider normalizer or broad provider-failure suite.
