# impl-03 — Remove default Synara tools and add dormant MCP extension

**What to build:** Make default Pi sessions use only coding-agent-configured tools and load a side-effect-free Synara MCP extension that activates later.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Remove unconditional Synara catalog injection from default Pi sessions.
- [ ] Load the Pi extension without connection, discovery, credentials, registration, or retry activity.
- [ ] Expose lifecycle hooks for later safe-boundary activation.
- [ ] Prove default sessions have no Synara catalog or startup MCP activity.

## Testing Seams

**Approval status:** Approved by owner on 2026-08-12, following designer review.

- **AC1:** Pi session creation/runtime tool-surface boundary — default sessions expose the complete configured coding-agent tool set, contain no Synara catalog, and preserve configured non-Synara tools and existing lifecycle behavior.
- **AC2:** Dormant extension load/bind side-effect boundary — before activation there is no MCP connection, discovery, credential minting, Synara registration, retry, delayed startup activity, or catalog injection. Any unexpected pre-activation invocation returns the stable disabled refusal without an operation.

Observe side effects through the extension's transport/credential/discovery boundaries; do not couple tests to private extension methods or introduce a universal side-effect abstraction prematurely.
