import type {
  BrowserToolName,
  ProjectId,
  ProviderKind,
  ThreadId,
} from "@synara/contracts";
import { ServiceMap, type Effect } from "effect";

import type { BrowserHostRpcError } from "../browserHostRpcClient.ts";

export interface BrowserAutomationHostCall {
  readonly sessionKey: string;
  readonly provider: ProviderKind;
  /**
   * The authenticated caller conversation. Provenance only (Decision 0002):
   * the Right-sidebar browser/automation workspace belongs to the Project
   * that owns this Thread, and the server resolves that Project
   * authoritatively — never from whichever Thread happens to be active.
   */
  readonly threadId: ThreadId;
  /**
   * The real owning Project of the browser automation workspace, resolved
   * server-side from the caller Thread's durable `projectId`. Never accepted
   * from MCP arguments and never a `ProjectId` disguised as a `ThreadId`.
   * Absent only while the caller Thread cannot be resolved to an active
   * Project (legacy provenance-only frame until the v2 capability is live).
   */
  readonly projectId?: ProjectId;
  readonly name: BrowserToolName;
  readonly arguments: Record<string, unknown>;
  /** Server-resolved authenticated thread workspace. Never accepted from MCP arguments. */
  readonly workspaceRoot?: string;
  readonly timeoutMs: number;
}

export interface BrowserAutomationHostShape {
  readonly available: boolean;
  readonly execute: (
    input: BrowserAutomationHostCall,
  ) => Effect.Effect<unknown, BrowserHostRpcError>;
}

export class BrowserAutomationHost extends ServiceMap.Service<
  BrowserAutomationHost,
  BrowserAutomationHostShape
>()("synara/browserAutomation/Services/BrowserAutomationHost") {}
