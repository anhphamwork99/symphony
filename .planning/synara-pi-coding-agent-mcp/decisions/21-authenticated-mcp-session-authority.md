# Decision 21: Authenticated MCP session authority

Status: Accepted technical decision
Date: 2026-08-13

## Scope

This decision governs `impl-04`: propagation of the authenticated subject into
Agent Gateway credentials and fail-closed MCP admission.

## Context

`AuthenticatedSession.subject` currently terminates at the trusted WebSocket
upgrade boundary. Trusted loopback sessions have no `AuthenticatedSession`, and
shared Agent Gateway credentials currently carry neither subject,
authentication expiry, nor runtime/lifecycle generation authority.

The accepted project contract requires subject isolation, session-local
credentials and generations, preservation of every existing authorization
guard, and fail-closed admission before operation creation. It forbids
request-supplied identity, provider/session/thread identity fallback, and a new
permission model.

## Decision

### Trusted loopback principal

A trusted loopback session with no `AuthenticatedSession` receives an opaque,
server-minted synthetic local-owner principal at trusted connection/session
establishment.

The principal is scoped to the local Synara installation and trusted loopback
session context. It is never accepted from WebSocket payloads, MCP arguments,
headers, provider state, `sessionKey`, `threadId`, or `projectId`. It uses the
same subject-binding mechanism as `AuthenticatedSession.subject` and is
unavailable when the server cannot prove the trusted loopback boundary.

The synthetic principal preserves compatibility with the existing local-owner
path; it is not a permission bypass. Existing project/thread ownership,
capability, approval, active-turn, Stop, cancellation, rotation, and audit
checks remain mandatory.

Reconnect or runtime recreation creates fresh session authority. It may bind
the same server-controlled local-owner principal, but it must not reuse the
previous credential, callback, transport, or runtime-generation authority.

### Mandatory shared-gateway subject binding

Subject binding is mandatory for every credential presented to the shared
Agent Gateway MCP admission boundary, regardless of provider.

Existing provider MCP paths must mint and carry the same server-issued
subject-bound authority. A path unable to provide valid trusted authority is
rejected. There is no legacy credential bypass, implicit subject inference, or
compatibility mode that weakens fail-closed behavior. Provider identity remains
runtime-routing metadata, not an authorization principal.

Unrelated provider operations that never enter Synara MCP admission do not need
an MCP subject binding.

### Session-authority record

At trusted session establishment or activation, the server creates one
session-local authority record containing:

- `subject`
- `sessionId`
- credential identity and protected secret/reference
- `authExpiresAt` and `credentialExpiresAt`
- `issuedAt`
- `sessionGeneration` and `lifecycleGeneration`
- `status: active | revoked | expired`
- revocation time/reason when applicable
- `provider`, `projectId`, and `threadId`

Admission succeeds only when:

1. The credential is present, valid, active, unexpired, and belongs to the
   current session.
2. The trusted server-side subject binding is present and matches the current
   authenticated subject or trusted server-minted local-owner subject.
3. Authentication is unexpired.
4. Session and MCP lifecycle generations match current trusted runtime state.
5. Session, provider, project, and thread bindings match trusted runtime
   context.
6. The MCP lifecycle is admitting calls rather than dormant, fenced,
   deactivating, revoked, degraded, or otherwise uncertain.
7. Existing capability, project/thread ownership, approval, active-turn, Stop,
   cancellation, rotation, and audit checks all pass.

These checks occur before creation of an MCP operation, request lease, external
side effect, or durable operation record. A denial creates no operation and no
provider/MCP side effect.

Missing subject or credential, missing trusted authority, expired
authentication or credential, revoked authority, stale session or lifecycle
generation, subject/session/provider/project/thread mismatch, request identity
override, uncertain lifecycle state, or failure of an existing authorization
guard all fail closed.

Request-supplied identity is never authoritative. A conflicting supplied
identity is denied deterministically.

Rotation revokes old authority before or atomically with replacement
publication. Reconnect, disable, runtime recreation, rotation, and equivalent
authority invalidation advance the relevant generation. Old credentials,
callbacks, sockets, leases, and completions then fail admission and cannot bind
to newer authority. Cancelled or ambiguously failed MCP calls are not replayed.

## Invariants

- A credential operates only within its bound subject, session, and current
  authority generations.
- Missing, expired, stale, revoked, or mismatched authority creates no MCP
  operation or side effect.
- Request identity cannot override server-trusted identity.
- Project-shared activation never transfers subject, credential, catalog,
  transport, callback, or generation between users.
- Trusted loopback uses only its server-minted local-owner subject;
  non-loopback unauthenticated sessions are denied.
- Reconnect and runtime recreation require fresh authority.
- Existing authorization boundaries remain mandatory in addition to authority
  admission.
- Non-MCP provider paths remain unchanged unless they enter the shared MCP
  admission boundary.

## Compatibility and migration

Migration is fail-closed. New MCP credentials contain or resolve to the complete
authority record. Existing credentials without trusted subject, expiry, and
generation are rejected at shared MCP admission and must be reissued through
the server-side minting path. Legacy credentials may remain usable only on
provider paths that do not enter shared Synara MCP admission.

Credential issuance and admission validation form one compatibility boundary:
partially migrated MCP providers fail safely. No fallback to provider, thread,
project, session-key, or request-supplied identity is allowed. The local-owner
principal is minted only by the trusted server and is not serialized into
client-controlled state.

## Consequences

- Trusted session establishment is the sole authority-minting seam.
- Shared MCP admission requires one common subject-bound authority validator.
- Pi is the immediate implementation focus, while every provider using the
  shared MCP gateway conforms to the same admission contract.
- Default trusted-loopback operation remains compatible through server-minted
  local-owner authority.
- Existing unbound MCP credentials are invalid after enforcement.
- Failure is deterministic and observable before operation creation.

## Rejected alternatives

- Anonymous-but-allowed loopback MCP authority.
- Identity supplied by browser, MCP request, Pi prompt, or provider payload.
- Principal inference from session, thread, project, provider, or extension
  state.
- Pi-only binding while shared-gateway credentials remain ambiguous.
- Legacy MCP credentials without subject, expiry, or generation.
- Provider-specific admission semantics.
- Credential or authority reuse across users, reconnects, or generations.
- Operation creation before subject and generation validation.
- Loopback bypass of existing authorization and lifecycle guards.

## Evidence

Project Supervisor binding decision on 2026-08-13, based on `PROJECT.md`,
`spec.md`, Decisions 08, 09, 15, and 20, `impl-04` AC1/AC2, and repository
evidence that the current trusted subject stops after WebSocket upgrade while
shared Agent Gateway credentials and admission lack subject, expiry, and
generation binding.

## Reopening conditions

Reopen only if the owner changes canonical-principal or user-isolation
boundaries, the trusted-loopback security boundary changes, the shared gateway
is split into independently authoritative admission domains, a provider cannot
preserve these invariants, or implementation evidence proves a required
invariant cannot be enforced before operation creation.
