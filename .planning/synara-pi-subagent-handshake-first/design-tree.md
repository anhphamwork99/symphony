# Design tree — Synara Pi subagent handshake-first harness

## Goal

Prevent Synara desktop execution cards from remaining falsely live after a
managed Pi child settles or disappears.

## 1. Trust the lifecycle only when its producer is controlled

- **1.1 Which extension supplies managed Agent behavior?**
  - **Settled:** a release-controlled `pi-subagents` artifact selected by
    Synara. See Decision 0001.
  - **Rejected:** mutable user-global extension discovery.
- **1.2 What proves the artifact is adequate?**
  - **Settled by source handoff:** a mandatory session bootstrap handshake,
    including `journal-terminal-lifecycle`.
  - **Invariant:** version text alone is not evidence of compatibility.
- **1.3 What if the artifact is missing or incompatible?**
  - **Settled:** early managed-harness initialization failure with actionable
    diagnostics, before child/admission/card creation.
- **1.4 Is there an alternate unmanaged path?**
  - **Settled:** no. See Decision 0002.
- **1.5 What happens to the user's Pi sign-in and model configuration?**
  - **Settled:** use only the runtime configuration required to operate Pi,
    never the user's extension tree or credentials in release resources. See
    Decision 0003.

## 2. Preserve durable lifecycle truth

- **2.1 How does a child become visible?**
  - Existing sequence-1 accepted, sequence-2 started, and sequence-3 detached
    ordering remains binding.
- **2.2 How is terminal outcome established?**
  - Only a fenced, journal-first committed `succeeded` or `failed` terminal
    observation may settle the execution.
- **2.3 What does detached mean?**
  - It means the parent stopped waiting while the exact child remains owned and
    active. It is not completion.
- **2.4 What does missing owner plus missing terminal mean?**
  - Non-terminal `orphaned`; never fabricated success, failure, or
    cancellation.
- **2.5 What does teardown uncertainty mean?**
  - `owner_unproven` remains non-terminal and must not fence or claim
    cancellation.

## 3. Present the durable truth clearly

- Attached live child → `Running`.
- Detached but live owner → `Running in background`.
- Cancellation desired before proof → `Cancelling`.
- Teardown owner cannot be proven → `Cancellation unverified`.
- No owner and no terminal evidence → `Outcome unknown (orphaned)`, not live,
  no cancel affordance, explicit Resume only.
- Fenced committed terminal → `Succeeded` or `Failed`.

## 4. Deliver the controlled artifact

- **Open implementation fact:** determine the repository's release/resource
  pipeline and choose the narrowest delivery mechanism that embeds or locates
  the selected artifact without global Pi fallback.
- Candidate mechanisms are not product choices: a controlled `agentDir`, an
  injected real extension factory, or another release-owned resource path.
- The selected mechanism must compose a session-local managed runtime
  configuration from the release-controlled extension and permitted user
  runtime configuration, while excluding global extensions.
- Any external Alfie artifact/release work must remain separately identified;
  Synara must not claim a production composition it cannot ship.

## 5. Prove the result

- Supported desktop boot completes handshake before managed Agent exposure.
- A conflicting global old extension is not selected.
- Missing/incompatible controlled artifact fails before managed side effects.
- A supported detached child reports progress/heartbeat and one fenced
  terminal.
- Terminal, cancellation, orphaning, and stale-generation rules retain their
  existing durable invariants.
- The visible card matches the states in section 3.
