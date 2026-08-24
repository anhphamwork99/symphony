# Decision 0002 — Enable the Antigravity `fullyIdle` lifecycle by default

## Status

Accepted owner override

## Date

2026-08-24

## Candidate

The bounded follow-up on `main@cb6d0c73a` after the accepted integrated
background-lifecycle candidate.

## Question

Does the accepted Antigravity Stop `fullyIdle` aggregate lifecycle become
product-default behavior while retaining an explicit environment rollback
switch?

## Governing references

- `.planning/synara-antigravity-background-lifecycle/PROJECT.md`
- `decisions/0001-accept-integrated-antigravity-background-lifecycle.md`
- `docs/findings/ANTIGRAVITY-fullyIdle-probe.md`
- The production resolver and focused adapter/config tests.

## Owner decision

The human owner explicitly supersedes the prior default-OFF choice and
approves product default ON. This decision changes enablement policy only; it
does not reopen or alter the accepted lifecycle design, its bounds, or its
qualification requirements.

The lifecycle configuration contract is:

| Input to `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE` | Result |
| --- | --- |
| absent, empty, whitespace, or malformed | `true` product default |
| `true`, `1`, or `on` | `true` |
| explicit `false`, `0`, or `off` | `false`, legacy rollback path |

The direct adapter composition fallback uses the shared product default
constant. Legacy-only test harnesses may pass `stopIdleLifecycle: false`
explicitly so those tests remain scoped to the behavior they are exercising;
that test-only override is not a production default.

## Evidence

- The accepted integrated candidate already qualified the aggregate
  Stop/`fullyIdle` contract on `agy` 1.1.19: one `agy -p` process survives
  false Stops, background work completes, a later true Stop permits close,
  and the process exits only after that true Stop.
- Decision 0001 accepted the existing bounded continuation, background
  deadline, close-wait, stable-EOF drain, terminal-last, cancellation, and
  cleanup behavior. Those invariants remain binding.
- The lifecycle remains aggregate-only (`active`, `idle`, `finalizing`), with
  no per-job identity, no automatic transcript scrolling, and no change to
  the `agy` 1.1.19 qualification.
- The resolver treats absent, empty, and malformed input as the product
  default, while explicit `false`/`0`/`off` remains an operator-controlled
  kill switch.

## Rollback

Set `SYNARA_ANTIGRAVITY_STOP_IDLE_LIFECYCLE=false` (or `0` or `off`) and
restart the server. Rollback is environment-only, requires no persisted-state
migration, and returns Stop settlement to the legacy path. Unset, empty, and
malformed values are not rollback values after this decision; they resolve to
the enabled product default.

## Verification

- Focused adapter/config suite: 108/108 tests passed through the Node-based
  Vitest path invoked with `bun run`.
- Targeted Oxfmt check: all three changed TypeScript files passed.
- Targeted Oxlint check: zero errors; three existing
  `consistent-function-scoping` warnings remain in unchanged adapter logic.
- `git diff --check`: passed.
- The workspace-wide formatter, lint, typecheck, and full test suite were not
  rerun for this small follow-up because the accepted base had just completed
  that verification; Decision 0001 records those results.

## Relationship to Decision 0001

Decision 0001 remains an immutable historical acceptance record for the
integrated lifecycle under the then-approved default-OFF policy. This record
does not edit or invalidate Decision 0001. It supersedes only that prior
enablement choice and leaves its accepted behavioral evidence and constraints
in force.

## Reopening conditions

Reassess this decision if new `agy` evidence contradicts the 1.1.19 aggregate
qualification, any existing lifecycle bound or terminal-ordering invariant
fails, aggregate activity retriggers transcript auto-follow, or the explicit
false/0/off rollback path stops restoring legacy behavior.
