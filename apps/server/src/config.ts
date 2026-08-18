/**
 * ServerConfig - Runtime configuration services.
 *
 * Defines process-level server configuration and networking helpers used by
 * startup and runtime layers.
 *
 * @module ServerConfig
 */
import { Effect, FileSystem, Layer, Path, ServiceMap } from "effect";
import { existsSync } from "node:fs";
import OS from "node:os";
import path from "node:path";
import pathPosix from "node:path/posix";
import pathWin32 from "node:path/win32";

import {
  ensurePrivateDirectorySync,
  ensurePrivateFileSync,
  repairPrivateTreeSync,
} from "./privatePathPermissions";
import { realpathNearestExisting } from "./realpathNearestExisting";
import { isLoopbackHost } from "./startupAccess";

export const DEFAULT_PORT = 3773;
export const PRIVATE_STATE_REPAIR_MARKER = ".permissions-v1";

export const DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS = 10000;
export const MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS = 100;
export const MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS = 60000;

// Ticket 23: progress / heartbeat / lease knobs follow the exact resolver
// contract of resolvePiSubagentForegroundWaitMs — nullish → default, range
// check, invalid anything → default, never clamped (T23-AC7).
export const DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ = 2;
export const MIN_PI_SUBAGENT_PROGRESS_RATE_HZ = 0.1;
export const MAX_PI_SUBAGENT_PROGRESS_RATE_HZ = 10;

export const DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = 10000;
export const MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = 100;
export const MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS = 600000;

export const DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS = 30000;
export const MIN_PI_SUBAGENT_LEASE_DURATION_MS = 1000;
export const MAX_PI_SUBAGENT_LEASE_DURATION_MS = 3600000;

// Ticket 06: durable cancellation dispatch knobs follow the same resolver
// contract as the ticket-23 knobs — nullish → default, range check, invalid
// anything → default, never clamped.
export const DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS = 5000;
export const MIN_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS = 100;
export const MAX_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS = 60000;

export const DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT = 2;
export const MIN_PI_SUBAGENT_CANCEL_RETRY_LIMIT = 0;
export const MAX_PI_SUBAGENT_CANCEL_RETRY_LIMIT = 5;

// Ticket 07: terminal payload bounding knob (T07-AC5) — the server truncates
// any producer-supplied terminal summary to this length before it is stored
// or emitted. Same resolver contract: nullish → default, range check,
// invalid anything → default, never clamped.
export const DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS = 2000;
export const MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS = 64;
export const MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS = 32768;

// Ticket 08: completion-delivery retry budget knob (T08-AC5) — the number of
// delivery attempts the outbox pump may make for one completion entry before
// it stops auto-recovering (the entry and its evidence stay readable). Same
// resolver contract: nullish → default, range check, invalid → default.
export const DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT = 5;
export const MIN_PI_SUBAGENT_COMPLETION_RETRY_LIMIT = 0;
export const MAX_PI_SUBAGENT_COMPLETION_RETRY_LIMIT = 100;

// Ticket 09: per-thread completion batching window (T09-AC1) — near-
// simultaneous managed child terminals inside this window coalesce into ONE
// bounded parent follow-up turn. 0 disables batching (each terminal delivers
// in its own follow-up). Same resolver contract: nullish → default, range
// check, invalid anything → default, never clamped.
export const DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS = 2000;
export const MIN_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS = 0;
export const MAX_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS = 30000;

export function resolvePiSubagentCompletionBatchWindowMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS ||
      rawInput > MAX_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS ||
      parsed > MAX_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_COMPLETION_BATCH_WINDOW_MS;
}

// Ticket 10: lease-expiry orphan threshold (T10-AC7) — how long a non-terminal
// execution may remain without renewed live-owner evidence (lease expired,
// no heartbeat) before the same owner-loss reconciliation that runs at
// restart orphans it. Approximately 60 seconds initially. Same resolver
// contract: nullish → default, range check, invalid → default, never clamped.
export const DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS = 60000;
export const MIN_PI_SUBAGENT_ORPHAN_AFTER_MS = 1000;
export const MAX_PI_SUBAGENT_ORPHAN_AFTER_MS = 3600000;

// Ticket 13 (T13-AC1/AC7): managed admission resource policies. The
// per-provider concurrency default of four running agents preserves the
// legacy extension's compatibility behavior (spec Further Notes); the
// server-wide and per-project queue caps bound admitted non-terminal work
// before spawn. Same resolver contract: nullish → default, range check,
// invalid → default, never clamped — an invalid value can never produce
// unlimited concurrency or queueing.
export const DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY = 4;
export const MIN_PI_SUBAGENT_PROVIDER_CONCURRENCY = 1;
export const MAX_PI_SUBAGENT_PROVIDER_CONCURRENCY = 64;

export const DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP = 64;
export const MIN_PI_SUBAGENT_SERVER_QUEUE_CAP = 1;
export const MAX_PI_SUBAGENT_SERVER_QUEUE_CAP = 1024;

export const DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP = 16;
export const MIN_PI_SUBAGENT_PROJECT_QUEUE_CAP = 1;
export const MAX_PI_SUBAGENT_PROJECT_QUEUE_CAP = 256;

// Ticket 13 (T13-AC3/AC7): per-execution wall-time budget. Two hours
// initially (spec Further Notes); expiry records a stable diagnostic and
// emits the durable escalation trigger consumed by ticket 15 — it never
// settles projection by itself.
export const DEFAULT_PI_SUBAGENT_WALL_TIME_MS = 7200000;
export const MIN_PI_SUBAGENT_WALL_TIME_MS = 60000;
export const MAX_PI_SUBAGENT_WALL_TIME_MS = 86400000;

export function resolvePiSubagentCompletionRetryLimit(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_COMPLETION_RETRY_LIMIT ||
      rawInput > MAX_PI_SUBAGENT_COMPLETION_RETRY_LIMIT
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_COMPLETION_RETRY_LIMIT ||
      parsed > MAX_PI_SUBAGENT_COMPLETION_RETRY_LIMIT
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_COMPLETION_RETRY_LIMIT;
}

// Decision 0016 (Ticket 09 remediation): per-follow-up bounded entry cap — the
// maximum outbox members one immutable completion-dispatch batch may contain
// (overflow joins the NEXT batch, so ONE follow-up stays bounded under any
// burst). Same resolver contract: nullish → default, range check, invalid
// anything → default, never clamped. The existing coordinator default (8)
// becomes the production knob default.
export const DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES = 8;
export const MIN_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES = 1;
export const MAX_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES = 64;

export function resolvePiSubagentCompletionMaxBatchEntries(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES ||
      rawInput > MAX_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES ||
      parsed > MAX_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES
    ) {
      return DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_COMPLETION_MAX_BATCH_ENTRIES;
}

export function resolvePiSubagentOrphanAfterMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_ORPHAN_AFTER_MS ||
      rawInput > MAX_PI_SUBAGENT_ORPHAN_AFTER_MS
    ) {
      return DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_ORPHAN_AFTER_MS ||
      parsed > MAX_PI_SUBAGENT_ORPHAN_AFTER_MS
    ) {
      return DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_ORPHAN_AFTER_MS;
}

// Ticket 13 (T13-AC1/AC7): per-provider running-agent concurrency cap.
export function resolvePiSubagentProviderConcurrency(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_PROVIDER_CONCURRENCY ||
      rawInput > MAX_PI_SUBAGENT_PROVIDER_CONCURRENCY
    ) {
      return DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_PROVIDER_CONCURRENCY ||
      parsed > MAX_PI_SUBAGENT_PROVIDER_CONCURRENCY
    ) {
      return DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_PROVIDER_CONCURRENCY;
}

// Ticket 13 (T13-AC1/AC7): server-wide admitted non-terminal work cap.
export function resolvePiSubagentServerQueueCap(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_SERVER_QUEUE_CAP ||
      rawInput > MAX_PI_SUBAGENT_SERVER_QUEUE_CAP
    ) {
      return DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_SERVER_QUEUE_CAP ||
      parsed > MAX_PI_SUBAGENT_SERVER_QUEUE_CAP
    ) {
      return DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_SERVER_QUEUE_CAP;
}

// Ticket 13 (T13-AC1/AC7): per-project admitted non-terminal work cap.
export function resolvePiSubagentProjectQueueCap(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_PROJECT_QUEUE_CAP ||
      rawInput > MAX_PI_SUBAGENT_PROJECT_QUEUE_CAP
    ) {
      return DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_PROJECT_QUEUE_CAP ||
      parsed > MAX_PI_SUBAGENT_PROJECT_QUEUE_CAP
    ) {
      return DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_PROJECT_QUEUE_CAP;
}

// Ticket 13 (T13-AC3/AC7): per-execution wall-time budget in milliseconds.
export function resolvePiSubagentWallTimeMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_WALL_TIME_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_WALL_TIME_MS ||
      rawInput > MAX_PI_SUBAGENT_WALL_TIME_MS
    ) {
      return DEFAULT_PI_SUBAGENT_WALL_TIME_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_WALL_TIME_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_WALL_TIME_MS ||
      parsed > MAX_PI_SUBAGENT_WALL_TIME_MS
    ) {
      return DEFAULT_PI_SUBAGENT_WALL_TIME_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_WALL_TIME_MS;
}

export function resolvePiSubagentTerminalSummaryMaxChars(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS ||
      rawInput > MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS
    ) {
      return DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS ||
      parsed > MAX_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS
    ) {
      return DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_TERMINAL_SUMMARY_MAX_CHARS;
}

export function resolvePiSubagentProgressRateHz(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_PROGRESS_RATE_HZ ||
      rawInput > MAX_PI_SUBAGENT_PROGRESS_RATE_HZ
    ) {
      return DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (trimmed === "" || !/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      parsed < MIN_PI_SUBAGENT_PROGRESS_RATE_HZ ||
      parsed > MAX_PI_SUBAGENT_PROGRESS_RATE_HZ
    ) {
      return DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_PROGRESS_RATE_HZ;
}

export function resolvePiSubagentHeartbeatIntervalMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS ||
      rawInput > MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS
    ) {
      return DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS ||
      parsed > MAX_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS
    ) {
      return DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS;
}

export function resolvePiSubagentLeaseDurationMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_LEASE_DURATION_MS ||
      rawInput > MAX_PI_SUBAGENT_LEASE_DURATION_MS
    ) {
      return DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_LEASE_DURATION_MS ||
      parsed > MAX_PI_SUBAGENT_LEASE_DURATION_MS
    ) {
      return DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_LEASE_DURATION_MS;
}

export function resolvePiSubagentForegroundWaitMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS ||
      rawInput > MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS
    ) {
      return DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_FOREGROUND_WAIT_MS ||
      parsed > MAX_PI_SUBAGENT_FOREGROUND_WAIT_MS
    ) {
      return DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_FOREGROUND_WAIT_MS;
}

export function resolvePiSubagentCancelAckTimeoutMs(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS ||
      rawInput > MAX_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS
    ) {
      return DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS ||
      parsed > MAX_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS
    ) {
      return DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_CANCEL_ACK_TIMEOUT_MS;
}

export function resolvePiSubagentCancelRetryLimit(
  rawInput?: string | number | null | undefined | unknown,
): number {
  if (rawInput === undefined || rawInput === null) {
    return DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
  }
  if (typeof rawInput === "number") {
    if (
      !Number.isFinite(rawInput) ||
      !Number.isInteger(rawInput) ||
      rawInput < MIN_PI_SUBAGENT_CANCEL_RETRY_LIMIT ||
      rawInput > MAX_PI_SUBAGENT_CANCEL_RETRY_LIMIT
    ) {
      return DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
    }
    return rawInput;
  }
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
    }
    const parsed = Number(trimmed);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < MIN_PI_SUBAGENT_CANCEL_RETRY_LIMIT ||
      parsed > MAX_PI_SUBAGENT_CANCEL_RETRY_LIMIT
    ) {
      return DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
    }
    return parsed;
  }
  return DEFAULT_PI_SUBAGENT_CANCEL_RETRY_LIMIT;
}

export type RuntimeMode = "web" | "desktop";
export type AntigravityTerminalRecoveryMode = "off" | "shadow" | "enforce";

export function normalizeHttpsPublicOrigin(publicUrl: URL): URL | null {
  if (
    publicUrl.protocol !== "https:" ||
    publicUrl.username !== "" ||
    publicUrl.password !== "" ||
    publicUrl.pathname !== "/" ||
    publicUrl.search !== "" ||
    publicUrl.hash !== ""
  ) {
    return null;
  }
  return new URL(publicUrl.origin);
}

export function remoteAccessPolicyError(
  config: Pick<
    ServerConfigShape,
    "host" | "authToken" | "devUrl" | "publicUrl" | "allowInsecureRemote"
  >,
): string | null {
  const isRemoteBind = !isLoopbackHost(config.host);
  if (config.publicUrl && !normalizeHttpsPublicOrigin(config.publicUrl)) {
    return "SYNARA_PUBLIC_URL/--public-url must be an HTTPS root origin without credentials, path, query, or fragment (for example https://synara.example.com).";
  }
  const isPubliclyExposed = isRemoteBind || Boolean(config.publicUrl);
  if (!isPubliclyExposed) return null;
  if (!config.authToken?.trim()) {
    return config.publicUrl
      ? "Refusing to publish Synara through SYNARA_PUBLIC_URL/--public-url without SYNARA_AUTH_TOKEN/--auth-token."
      : `Refusing to bind Synara to non-loopback host ${config.host ?? "<unspecified>"} without SYNARA_AUTH_TOKEN/--auth-token.`;
  }
  if (config.devUrl) {
    return "Remote server binds cannot be combined with VITE_DEV_SERVER_URL/--dev-url yet; use a loopback host for development or run the built web UI for remote access.";
  }
  if (isRemoteBind && !config.publicUrl && !config.allowInsecureRemote) {
    return "Refusing plaintext remote access. Configure an HTTPS reverse-proxy origin with SYNARA_PUBLIC_URL/--public-url, or explicitly accept unencrypted LAN traffic with SYNARA_ALLOW_INSECURE_REMOTE/--allow-insecure-remote.";
  }
  return null;
}

/**
 * ServerDerivedPaths - Derived paths from the base directory.
 */
export interface ServerDerivedPaths {
  readonly stateDir: string;
  readonly secretsDir: string;
  readonly dbPath: string;
  readonly settingsPath: string;
  readonly keybindingsConfigPath: string;
  readonly worktreesDir: string;
  readonly attachmentsDir: string;
  readonly logsDir: string;
  readonly serverLogPath: string;
  readonly serverRuntimeStatePath: string;
  readonly providerLogsDir: string;
  readonly providerEventLogPath: string;
  readonly terminalLogsDir: string;
  readonly environmentIdPath: string;
}

/**
 * ServerConfigShape - Process/runtime configuration required by the server.
 */
export interface ServerConfigShape extends ServerDerivedPaths {
  readonly mode: RuntimeMode;
  readonly port: number;
  readonly host: string | undefined;
  readonly cwd: string;
  readonly homeDir: string;
  readonly chatWorkspaceRoot: string;
  readonly studioWorkspaceRoot: string;
  readonly baseDir: string;
  readonly staticDir: string | undefined;
  readonly devUrl: URL | undefined;
  readonly publicUrl: URL | undefined;
  readonly allowInsecureRemote: boolean;
  readonly noBrowser: boolean;
  readonly authToken: string | undefined;
  readonly desktopShutdownToken?: string | undefined;
  readonly autoBootstrapProjectFromCwd: boolean;
  readonly logProviderEvents: boolean;
  readonly logWebSocketEvents: boolean;
  readonly antigravityTerminalRecoveryMode?: AntigravityTerminalRecoveryMode;
  readonly antigravityTerminalRecoveryGraceMs?: number;
  readonly piSubagentForegroundWaitMs?: number;
  readonly piSubagentProgressRateHz?: number;
  readonly piSubagentHeartbeatIntervalMs?: number;
  readonly piSubagentLeaseDurationMs?: number;
  readonly piSubagentCancelAckTimeoutMs?: number;
  readonly piSubagentCancelRetryLimit?: number;
  readonly piSubagentTerminalSummaryMaxChars?: number;
  readonly piSubagentCompletionRetryLimit?: number;
  /** Ticket 09: per-thread completion batching window in milliseconds. */
  readonly piSubagentCompletionBatchWindowMs?: number;
  /** Decision 0016: immutable dispatch-batch member cap (1–64, default 8). */
  readonly piSubagentCompletionMaxBatchEntries?: number;
  /** Ticket 10: lease-expiry orphan threshold (T10-AC7), ~60s initially. */
  readonly piSubagentOrphanAfterMs?: number;
  /** Ticket 13: per-provider running-agent concurrency cap (compat default 4). */
  readonly piSubagentProviderConcurrency?: number;
  /** Ticket 13: server-wide admitted non-terminal work cap. */
  readonly piSubagentServerQueueCap?: number;
  /** Ticket 13: per-project admitted non-terminal work cap. */
  readonly piSubagentProjectQueueCap?: number;
  /** Ticket 13: per-execution wall-time budget (default two hours). */
  readonly piSubagentWallTimeMs?: number;
}

export function preparePrivateServerPaths(
  paths: ServerDerivedPaths,
  platform: NodeJS.Platform = process.platform,
): void {
  for (const directoryPath of [
    paths.stateDir,
    paths.secretsDir,
    paths.attachmentsDir,
    paths.logsDir,
    paths.providerLogsDir,
    paths.terminalLogsDir,
  ]) {
    ensurePrivateDirectorySync(directoryPath, platform);
  }
  const repairMarkerPath = path.join(paths.stateDir, PRIVATE_STATE_REPAIR_MARKER);
  if (!existsSync(repairMarkerPath)) {
    repairPrivateTreeSync(paths.stateDir, platform);
  }
  // Create or repair the main database before any SQLite client can open it.
  // SQLite sidecars are created inside this 0700 state directory, which is the
  // portable privacy boundary while SQLite owns their creation; POSIX startup
  // repair additionally narrows existing regular files to 0600.
  ensurePrivateFileSync(paths.dbPath, { platform });
  ensurePrivateFileSync(repairMarkerPath, { platform });
}

export const deriveServerPaths = Effect.fn(function* (
  baseDir: ServerConfigShape["baseDir"],
  devUrl: ServerConfigShape["devUrl"],
): Effect.fn.Return<ServerDerivedPaths, never, Path.Path> {
  const { join } = yield* Path.Path;
  const stateDir = join(baseDir, devUrl !== undefined ? "dev" : "userdata");
  const secretsDir = join(stateDir, "secrets");
  const dbPath = join(stateDir, "state.sqlite");
  const attachmentsDir = join(stateDir, "attachments");
  const logsDir = join(stateDir, "logs");
  const providerLogsDir = join(logsDir, "provider");
  return {
    stateDir,
    secretsDir,
    dbPath,
    settingsPath: join(stateDir, "settings.json"),
    keybindingsConfigPath: join(stateDir, "keybindings.json"),
    worktreesDir: join(baseDir, "worktrees"),
    attachmentsDir,
    logsDir,
    serverLogPath: join(logsDir, "server.log"),
    serverRuntimeStatePath: join(stateDir, "server-runtime.json"),
    providerLogsDir,
    providerEventLogPath: join(providerLogsDir, "events.log"),
    terminalLogsDir: join(logsDir, "terminals"),
    environmentIdPath: join(stateDir, "environment-id"),
  };
});

export function resolveDefaultChatWorkspaceRoot(input: {
  readonly homeDir: string;
  readonly platform?: NodeJS.Platform;
}): string {
  const homeDir = input.homeDir.trim();
  const platform = input.platform ?? process.platform;
  const pathApi = platform === "win32" ? pathWin32 : pathPosix;
  return pathApi.join(homeDir, "Documents", "Synara");
}

export function resolveDefaultStudioWorkspaceRoot(input: {
  readonly homeDir: string;
  readonly platform?: NodeJS.Platform;
}): string {
  const pathApi = (input.platform ?? process.platform) === "win32" ? pathWin32 : pathPosix;
  return pathApi.join(resolveDefaultChatWorkspaceRoot(input), "Studio");
}

export interface ResolvedWorkspaceRoots {
  readonly homeDir: string;
  readonly chatWorkspaceRoot: string;
  readonly studioWorkspaceRoot: string;
}

/**
 * resolveCanonicalWorkspaceRoots - Derives homeDir/chatWorkspaceRoot/studioWorkspaceRoot
 * and canonicalizes each via {@link realpathNearestExisting}.
 *
 * Project rows store REALPATH-canonicalized workspace roots (see
 * `canonicalizeProjectWorkspaceRoot` in wsRpc.ts), so the roots the server
 * reports in config/welcome payloads must be canonicalized the same way.
 * Otherwise a symlinked chat/Studio ancestor (e.g. a symlinked `~/Documents`)
 * makes client-side classifiers mis-detect which container a thread belongs
 * to. The Studio root in particular may not exist yet (it's created lazily),
 * so canonicalization walks up to the nearest existing ancestor and
 * re-appends the not-yet-created remainder.
 */
export const resolveCanonicalWorkspaceRoots = Effect.fn(function* (input: {
  readonly homeDir: string;
  readonly platform?: NodeJS.Platform;
}): Effect.fn.Return<ResolvedWorkspaceRoots, never, FileSystem.FileSystem | Path.Path> {
  const platform = input.platform ?? process.platform;
  const homeDir = yield* realpathNearestExisting(input.homeDir);
  const chatWorkspaceRoot = yield* realpathNearestExisting(
    resolveDefaultChatWorkspaceRoot({ homeDir, platform }),
  );
  const studioWorkspaceRoot = yield* realpathNearestExisting(
    resolveDefaultStudioWorkspaceRoot({ homeDir, platform }),
  );
  return { homeDir, chatWorkspaceRoot, studioWorkspaceRoot };
});

/**
 * ServerConfig - Service tag for server runtime configuration.
 */
export class ServerConfig extends ServiceMap.Service<ServerConfig, ServerConfigShape>()(
  "synara/config/ServerConfig",
) {
  static readonly layerTest = (cwd: string, baseDirOrPrefix: string | { prefix: string }) =>
    Layer.effect(
      ServerConfig,
      Effect.gen(function* () {
        const devUrl = undefined;

        const fs = yield* FileSystem.FileSystem;
        const baseDir =
          typeof baseDirOrPrefix === "string" && path.resolve(baseDirOrPrefix) !== path.resolve(cwd)
            ? baseDirOrPrefix
            : yield* fs.makeTempDirectoryScoped({
                prefix:
                  typeof baseDirOrPrefix === "string"
                    ? "synara-server-config-test-"
                    : baseDirOrPrefix.prefix,
              });
        const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);

        yield* Effect.sync(() => preparePrivateServerPaths(derivedPaths));

        const { homeDir, chatWorkspaceRoot, studioWorkspaceRoot } =
          yield* resolveCanonicalWorkspaceRoots({ homeDir: OS.homedir() });

        return {
          cwd,
          homeDir,
          chatWorkspaceRoot,
          studioWorkspaceRoot,
          baseDir,
          ...derivedPaths,
          mode: "web",
          autoBootstrapProjectFromCwd: false,
          logProviderEvents: false,
          logWebSocketEvents: false,
          port: 0,
          host: undefined,
          authToken: undefined,
          desktopShutdownToken: undefined,
          staticDir: undefined,
          devUrl,
          publicUrl: undefined,
          allowInsecureRemote: false,
          noBrowser: false,
          piSubagentForegroundWaitMs: resolvePiSubagentForegroundWaitMs(
            process.env.SYNARA_PI_SUBAGENT_FOREGROUND_WAIT_MS,
          ),
          piSubagentProgressRateHz: resolvePiSubagentProgressRateHz(
            process.env.SYNARA_PI_SUBAGENT_PROGRESS_RATE_HZ,
          ),
          piSubagentHeartbeatIntervalMs: resolvePiSubagentHeartbeatIntervalMs(
            process.env.SYNARA_PI_SUBAGENT_HEARTBEAT_INTERVAL_MS,
          ),
          piSubagentLeaseDurationMs: resolvePiSubagentLeaseDurationMs(
            process.env.SYNARA_PI_SUBAGENT_LEASE_DURATION_MS,
          ),
        } satisfies ServerConfigShape;
      }),
    );
}

export const resolveStaticDir = Effect.fn(function* () {
  const { join, resolve } = yield* Path.Path;
  const { exists } = yield* FileSystem.FileSystem;

  // The desktop shell passes a real-disk snapshot of the bundled client so static
  // serving survives app.asar being replaced beneath the running app (a stale
  // in-process asar header otherwise serves bytes from the wrong offsets).
  // Honored only when it actually contains the client, so a stale or bogus env
  // value degrades to the normal lookup instead of breaking serving.
  const snapshotDir = process.env.SYNARA_STATIC_DIR?.trim();
  if (snapshotDir) {
    const snapshotClient = resolve(snapshotDir);
    const snapshotStat = yield* exists(join(snapshotClient, "index.html")).pipe(
      Effect.orElseSucceed(() => false),
    );
    if (snapshotStat) {
      return snapshotClient;
    }
  }

  const bundledClient = resolve(join(import.meta.dirname, "client"));
  const bundledStat = yield* exists(join(bundledClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (bundledStat) {
    return bundledClient;
  }

  const monorepoClient = resolve(join(import.meta.dirname, "../../web/dist"));
  const monorepoStat = yield* exists(join(monorepoClient, "index.html")).pipe(
    Effect.orElseSucceed(() => false),
  );
  if (monorepoStat) {
    return monorepoClient;
  }
  return undefined;
});
