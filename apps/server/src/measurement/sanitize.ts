// FILE: sanitize.ts
// Purpose: Report-surface sanitization (Decision 34 §3/§5). The committed
// report must never contain raw sensitive filesystem paths, credentials, or
// secrets. Paths are relativized against the user's home directory ("~"),
// and credential-shaped values are redacted.
import os from "node:os";

const CREDENTIAL_VALUE_PATTERN =
  /(api[_-]?key|token|secret|password|credential|authorization)\s*[=:]\s*[^\s,;)]+/gi;
const BEARER_HEADER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

export function sanitizePathForReport(value: string): string {
  const home = os.homedir();
  if (home.length > 1 && value.includes(home)) {
    return value.split(home).join("~");
  }
  return value;
}

export function redactCredentialShapes(value: string): string {
  // Bearer-header form first so its token is never left behind by the
  // key=value rule (which would consume the "Bearer" keyword as the value).
  return value
    .replace(BEARER_HEADER_PATTERN, "<redacted>")
    .replace(CREDENTIAL_VALUE_PATTERN, "$1=<redacted>");
}

export function sanitizeFailureForReport(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return redactCredentialShapes(sanitizePathForReport(message)).slice(0, 500);
}
