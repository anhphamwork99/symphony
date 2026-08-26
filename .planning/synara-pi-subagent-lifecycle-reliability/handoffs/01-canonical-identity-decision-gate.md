# Supervisor handoff — Ticket 02 canonical identity decision gate

**Status:** consultation required; no option selected
**Project:** [Synara Pi subagent lifecycle reliability](../PROJECT.md)
**Origin:** accepted [Ticket 01 grounding report](../issues/01-baseline-reproduction-and-decision-matrix.md)
**Scope:** planning decision only; this handoff authorizes no source edits

## Exact Supervisor question

Which public identity and durable result-read contract shall Ticket 02 bind so
that the detached public handle remains readable and controllable without
conflating Symphony's durable `executionId` with Alfie's provider-local
`agentId`, including after provider-record eviction or restart?

The answer must name the canonical public identity, the owner of any mapping,
the authorized live-versus-durable read boundary, bounded payload/diagnostic
rules, and whether the choice requires an Alfie provenance re-pin.

## Alternatives for consultation

1. **Minimal visible `agentId`/text fix.** Keep provider lookup canonical and
   change the visible detached output/text so callers receive the provider
   record identity. The Supervisor must explicitly decide whether this is
   compatible with the already durable Symphony `executionId` contract and how
   restart/eviction continuity is preserved.
2. **`executionId` alias in Alfie.** Keep `executionId` as the public logical
   identity and add a bounded provider-side alias/mapping for result/control
   calls, with explicit behavior when the Manager record is absent. This may
   require a pinned Alfie change and provenance verification.
3. **Symphony durable LLM-callable result tool.** Keep `executionId` canonical
   and expose an authorized bounded durable read boundary from Symphony,
   consulting live provider state when present and durable terminal evidence
   after eviction/restart. The Supervisor must define how public control calls
   relate to that read path.
4. **Explicit combination.** The Supervisor may approve a bounded combination
   of the above, but must state ownership, precedence, compatibility/version
   behavior, and why the combination does not create two competing public
   identities or weaken authorization/fencing.

These are alternatives and combinations for consultation, not accepted
architecture. Ticket 02 must not become ready until one contract is named and
its material risks/gates are recorded.

## Required decision outputs

- canonical public logical identity and provider-local correlation identity;
- mapping/alias owner and compatibility/version/observability behavior;
- live result behavior while the provider record exists;
- durable terminal/result behavior after record eviction or restart;
- authorization, attempt/generation fencing, payload bounds, and diagnostics;
- explicit treatment of inactive provider runtime;
- Alfie change/provenance requirement, if any; and
- explicit non-goals preserving no automatic replay or automatic Resume.

## Acceptance boundary

This consultation only unlocks Ticket 02 planning/implementation. It does not
select terminal ordering, lifecycle containment, watchdog/teardown settlement,
Resume, crash guardian, orphan-terminal exception, or durable owner receipt.
Those remain later gates under the project's single integrated review and one
Supervisor final-acceptance governance.
