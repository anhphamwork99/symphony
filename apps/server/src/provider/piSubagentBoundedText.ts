// FILE: piSubagentBoundedText.ts
// Purpose: Shared bounded-text helpers for the Pi subagent surface. Every
// site that truncates a producer-supplied or artifact-derived string to a
// char cap uses ONE implementation so bounds stay single-sourced
// (AGENTS.md maintainability: no duplicated logic across files).
// Layer: Server provider support
// Exports: truncateWithEllipsis, boundedOptionalString

/** Truncate `value` to at most `maxChars` characters, appending an ellipsis
 * marker when truncation occurred. The marker occupies the final character,
 * so a truncated value is never longer than the cap. */
export function truncateWithEllipsis(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

/** Bound an optional producer-supplied string; `undefined` stays `undefined`
 * and empty-after-trim values collapse to `undefined`. */
export function boundedOptionalString(
  value: string | undefined,
  maxChars: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const truncated = truncateWithEllipsis(value, maxChars);
  return truncated.trim().length > 0 ? truncated : undefined;
}
