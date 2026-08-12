# Decision 16: Project enable rollback propagation

Status: Accepted reassessment
Date: 2026-08-12

## Decision

Decision 10 governs every project-shared enable failure. The earlier Decision 09
outcome of retaining `desired=enabled` with a degraded runtime is superseded for
this failure branch.

An authorized project enable is committed and fan-outs to current sessions, but
activation success requires every current session activation required by the
project contract to complete identity validation, fresh credentials, MCP
initialization, complete catalog discovery/validation, and safe-boundary runtime
exposure successfully.

If any current session's activation fails, the project desired state is rolled
back to `disabled`. The committed disabled update propagates to every project
session, including sessions that had already activated successfully or were
still staging. All sessions fence MCP, clean candidate/current resources, revoke
credentials, discard catalogs and registrations, invalidate old generations,
and retain normal coding-agent tools only. A failed session cannot retain
authority, and a successful sibling cannot remain active.

Future sessions hydrate the disabled projection, start dormant, and do not retry
without a new explicit `/Enable Synara MCP` command.

Project events are the propagation boundary. Session reconciliation is isolated,
idempotent, generation-guarded, and serialized. Active turns retain their
current tool surface until a safe boundary, but rollback immediately determines
the durable project outcome and prevents new MCP admission. Stale completion,
callback, credential, catalog, or failure from an older operation cannot
re-enable tools or overwrite a newer project state.

## Rejected alternatives

Retaining `enabled/degraded`, rolling back only the failed session, allowing a
successful sibling to remain enabled, sharing credentials/identity, automatic
retry while disabled, and stale-generation re-exposure are rejected.

## Evidence

Supervisor reassessment against Decisions 08, 09, 10, and 15 plus scout evidence
for the project aggregate/event/projection path, project-to-thread enumeration,
provider session directory, per-thread lifecycle generations, and Pi runtime
reconciliation.
