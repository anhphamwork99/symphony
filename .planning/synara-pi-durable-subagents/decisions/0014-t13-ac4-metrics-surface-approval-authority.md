# Decision 0014 — Ticket 13 T13-AC4 metrics-surface approval authority

## Status

**Decision (binding)** — Project Supervisor adjudication, activation class 1
(material technical decision verification/escalation).

**Date:** 2026-08-18

## Question

Does the persisted T13-AC4 proposal to extend `ServerDiagnosticsResult` with
an optional `piSubagents` metrics block (served through the existing
`serverGetDiagnostics` RPC) fall under already-approved ticket-level seam
authority such that metrics-surface testing may begin, or does Ticket 13
require a fresh human-owner approval first?

## Governing references

- Project Home (`.planning/synara-pi-durable-subagents/PROJECT.md`).
- Decision 0001 (testing strategy governance).
- Issue 13 Testing Seams (normative pending-approval condition for T13-AC4).
- Decision 0011, finding F4 (diagnostic/telemetry taxonomy ownership assigned
  to Ticket 13; "existing operator surface without unnecessary public-schema
  change" constraint).
- `packages/contracts/src/server.ts` (`ServerDiagnosticsResult`).
- `apps/server/src/wsRpc.ts` (`serverGetDiagnostics` handler).

## Settled verdict — \*\*Fresh human-owner approval is required before the

first T13-AC4 metrics-surface test.\*\*

The claim that already-delegated ticket-level authority clears the approval
gate is rejected:

- Decision 0001 makes the concrete metrics surface an ordinary ticket-owned
  seam; selecting `serverGetDiagnostics` therefore needs **no** new
  project-scoped testing-strategy Decision Record.
- Ticket 13 nevertheless establishes a **more specific procedural condition**:
  `/matt-implement` must identify and persist the concrete AC4 mapping and then
  obtain owner approval before writing the first metrics-surface test.
  Delegated authority to design or propose a seam is not authority to
  self-approve a checkpoint the normative ticket expressly reserves to the
  human owner.
- Neither the owner's earlier approval of admission/saturation/telemetry-safety
  seams (2026-08-16 ticket-breakdown review) nor Decision 0011 F4 constitutes
  approval of the subsequently identified
  `ServerDiagnosticsResult.piSubagents` mapping.
- This adjudication confirms which authority applies; it does not and cannot
  substitute for the required owner approval.

The proposed `serverGetDiagnostics` surface itself is **not rejected** —
evidence supports it as the plausible highest existing stable operator
boundary, and it creates no new public endpoint. Its additive public-contract
mapping remains pending until the owner expressly approves it.

## Binding instructions

Before approval:

- Keep Issue 13's Testing Seams approval status `Pending`.
- Do not write the first T13-AC4 metrics-surface test.
- Do not describe the mapping as approved by delegated authority.
- Cite this adjudication as the authority **requiring** owner approval; the
  citation is not itself approval.

After the human owner expressly approves:

- Change Issue 13's `## Testing Seams` overall status from `Pending` to
  `Approved`.
- Replace both `pending owner approval` markers in the T13-AC4 entry with an
  owner-approval record (owner identity, date, verbatim or precisely quoted
  approval text).
- Preserve the approved `serverGetDiagnostics →
ServerDiagnosticsResult.piSubagents` mapping in that section.
- Metrics-surface tests may then proceed without another project-scoped
  Decision Record, provided the approved mapping is not materially changed.
  A materially changed surface or field set requires a fresh approval and
  re-persisted mapping.

Latency percentile observation windows, reset/restart behavior, and bounded
sample derivation remain ordinary implementation choices unless the owner
conditions approval on them; tests must ultimately encode deterministic,
bounded semantics consistent with T13-AC6.

## Rejected alternatives

- Treating Decision 0001's delegation of ordinary seam design as advance
  approval of every later concrete seam (delegation ≠ approval; Ticket 13
  reserves the concrete mapping approval).
- Treating the earlier generic telemetry-safety seam approval as approval of
  `ServerDiagnosticsResult.piSubagents` (the concrete surface had not been
  identified then).
- Using this Supervisor adjudication as the required owner approval (outside
  Supervisor authority).
- Rejecting `serverGetDiagnostics` merely for being an additive schema change
  (no evidence favors another surface or a new endpoint).
- Requiring a new owner-approved project-scoped Decision Record (unnecessary
  unless the owner materially changes the feature-wide strategy;
  ticket-local recorded approval is sufficient).

## Reopening conditions

- Evidence surfaces that the human owner had already expressly approved this
  exact mapping.
- The owner amends Issue 13 to remove or delegate the explicit approval
  checkpoint.
- Governing records change so ticket-level seam ownership explicitly includes
  authority to clear owner-reserved approvals.
- The proposed implementation materially changes from the persisted
  `serverGetDiagnostics` mapping and requires a new authority determination.
