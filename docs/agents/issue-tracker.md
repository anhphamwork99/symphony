# Issue tracker: Local Markdown

Issues and specs for Synara live as Markdown files under the durable planning
namespace `.planning/`. Each effort has a Project Home at
`.planning/<project-slug>/` with `PROJECT.md` as its entrypoint.

## Project Home convention

- Use one stable kebab-case directory per project.
- `PROJECT.md` is routing metadata: owner, lifecycle, triage state, tracker,
  and links to the artifacts that exist. It is not a duplicate spec.
- Create artifacts only when they contain useful content.
- Preserve a Project Home after completion; update lifecycle metadata instead
  of renaming or deleting it.

## Local artifacts

- The canonical spec is `.planning/<project-slug>/spec.md`.
- Implementation tickets are individual files under
  `.planning/<project-slug>/issues/`, numbered in dependency order.
- Every local ticket has a `Status:` line using the labels in
  [triage-labels.md](triage-labels.md).
- Conversation or updates append under a `## Comments` heading in the relevant
  ticket.

## Local versus remote work

The durable-subagent work already uses Local Markdown. A ticket has one
normative home: do not duplicate a local ticket into a remote issue or a
remote issue into a local ticket. References are allowed; duplicate bodies are
not.
