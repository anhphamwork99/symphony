# Design tree — lifecycle reliability

## 0. Authority and lifecycle

- **0.1 Router:** `PROJECT.md` alone owns project status/frontier.
- **0.2 Inheritance:** durable-subagents and handshake-first accepted decisions
  remain authoritative by aspect.
- **0.3 Acceptance:** one integrated feature review, then exactly one
  Supervisor final acceptance for the full project.
- **0.4 Evidence:** research supports; it does not decide.

## 1. Identity and read continuity

- **1.1 What identity is public?**
  - Settled invariant: `executionId` is the durable public identity.
  - Gate: compatibility alias vs protocol migration vs Alfie output change.
- **1.2 What identity does provider lookup accept?**
  - Current seam: Alfie GET_RESULT accepts strict `agent_id` and Manager map
    lookup.
  - Required evidence: public detached identity reaches a bounded result read
    without an unbounded/global scan.
- **1.3 What survives provider eviction/restart?**
  - Required: durable terminal/result read continuity where evidence exists.
  - Prohibited: fabricate result from missing owner or replay uncertain work.

## 2. Terminal and cleanup truth

- **2.1 Terminal before delivery?** Journal-first, inherited and settled.
- **2.2 Terminal before cleanup?** Open implementation gate: define exact
  ordering when provider output, terminal evidence, watchdog handoff, and owned
  teardown race.
- **2.3 Does cleanup uncertainty settle?** No. Bands 70–78 semantics and
  proof-before-fence remain binding.
- **2.4 Can same-generation late terminal win?** Only according to the accepted
  first-applicable terminal rule; teardown handoff does not fence by itself.

## 3. Live containment and control

- **3.1 Who owns a live child?** The provider/Alfie runtime and its exact live
  owner boundary; Symphony has durable control/observation authority, not raw
  PID authority.
- **3.2 What if provider runtime is inactive?** Preserve honest unavailable
  diagnostics; do not claim Resume or control success.
- **3.3 What can retry?** Durable intent/evidence operations under attempt /
  generation fencing; no automatic replay of side effects.

## 4. Restart, reconnect, and Resume

- **4.1 Reconnect:** hydrate durable projection and bounded cursor/event state.
- **4.2 Restart:** recover terminal, prove live owner, or settle uncertainty /
  orphaned with diagnostics; no automatic replay.
- **4.3 Resume:** explicit-only, authorized, same execution/new attempt, only
  when provider/runtime eligibility is truthful.
- **4.4 Candidate directions:** crash guardian, orphan-terminal exception,
  durable post-restart owner receipt, and provider-bootstrap Resume remain open
  gates, not selected designs.

## 5. Acceptance evidence map

| Gate | Required evidence | Owner |
| --- | --- | --- |
| G1 incident | reproduction and source seam map; no source edits | Ticket 01 |
| G2 identity | public/hidden/durable identity matrix and chosen contract | Ticket 02 + decision gate |
| G3 lifecycle | terminal-before-cleanup race matrix and containment proof | Ticket 03 |
| G4 controls | cancellation/watchdog/teardown retries and failure diagnostics | Ticket 04 |
| G5 recovery | restart/reconnect/Resume truth and crash diagnostics | Ticket 05 |
| G6 integrated | pinned real-Pi, deterministic, and approved manual boundaries | Ticket 06 |

## Material decision gates

1. **DG-1 canonical identity:** no implementation may alias identities silently.
2. **DG-2 result continuity:** durable read authority and provider-local read
   authority must be separated explicitly.
3. **DG-3 terminal/cleanup ordering:** settle races without treating cleanup
   uncertainty as terminal proof.
4. **DG-4 owner boundary:** no new kill authority from persisted PIDs/receipts.
5. **DG-5 Resume eligibility:** unavailable provider runtime cannot be papered
   over by provider bootstrap.
6. **DG-6 candidate architecture:** any guardian/receipt/exception proposal
   requires an explicit accepted decision.
7. **DG-7 integrated evidence:** preserve inherited three-leg destructive
   boundary and exact Alfie provenance.

## Dependency and status rule

The only initial leaf is Ticket 01. Every later node is blocked until the prior
node's evidence and gates are accepted and PROJECT.md advances the frontier.
