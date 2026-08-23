# Domain documentation

Synara is a single-context repository.

Before exploring or changing a feature, read the relevant material from:

1. root [CONTEXT.md](../../CONTEXT.md);
2. relevant ADRs under `docs/adr/` when that directory contains them; and
3. the active Project Home's `terms.md` and `decisions/`.

If an ADR directory does not exist, proceed without creating empty scaffolding.
The domain-modeling workflow creates an ADR only when a decision is durable,
hard to reverse, and broader than one project.

Project-specific vocabulary belongs in `.planning/<project-slug>/terms.md`.
Project-specific decisions belong in
`.planning/<project-slug>/decisions/`. Promote either to root documentation
only once it is stable and shared across independent project work.
