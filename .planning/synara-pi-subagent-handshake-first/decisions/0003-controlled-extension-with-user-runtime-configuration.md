# Decision 0003 — Controlled extension with user runtime configuration

- **Date:** 2026-08-21
- **Status:** Accepted by owner
- **Owner evidence:** “A”
- **Scope:** Synara desktop managed Pi subagent harness

## Context

A controlled Pi `agentDir` is the best-supported delivery mechanism for the
release-selected `pi-subagents` extension. An agent directory also normally
contains user-specific authentication and model configuration, not only
extensions. Fully bundling that configuration would require users to configure
their Pi identity and models again in Synara.

## Decision

Synara-managed sessions will assemble a managed runtime configuration that:

1. loads the release-controlled `pi-subagents` artifact and no user-global
   extension;
2. uses only the user's authentication and model configuration required to run
   Pi; and
3. never packages, logs, mutates, or copies user credentials into the Synara
   release artifact.

The managed runtime configuration is session-local and must fail early with an
actionable diagnostic if the required user runtime configuration is absent or
invalid. The failure occurs before managed child, admission, or execution-card
creation.

## Consequences

- Updating a user's global extensions cannot change managed-subagent lifecycle
  behavior.
- A user's legitimate authentication or model-configuration changes may affect
  which Pi models can run, but cannot replace the managed extension or weaken
  its handshake.
- The implementation must explicitly exclude the global `extensions/` tree;
  a broad copy of the user's Pi agent directory is prohibited.
- Credentials remain user-local runtime material and must not appear in shipped
  application resources, logs, diagnostics, fixtures, or provenance records.
