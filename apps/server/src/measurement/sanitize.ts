// FILE: sanitize.ts
// Purpose: Report-surface sanitization (Decision 34 §3/§5, Decision 35). The
// committed report must never contain raw sensitive filesystem paths,
// credentials, or secrets. Absolute paths are projected to safe non-absolute
// placeholders: paths under the user's home stay "~/<relative>" (the approved
// projection for values such as agentDir), paths under os.tmpdir() become a
// stable "<tmp>/<relative>" label that never exposes the random temp root
// (checked before home because on Windows the temp root lives under home), and
// every other absolute path (POSIX or Windows drive/UNC) becomes "<abs>" plus
// at most a non-sensitive basename. Relative paths are left untouched, and
// embedded absolute paths inside failure/diagnostic strings are projected
// before truncation. No path value used for runtime behavior is modified —
// only report/diagnostic projection.
import os from "node:os";
import path from "node:path";

const CREDENTIAL_VALUE_PATTERN =
  /(api[_-]?key|token|secret|password|credential|authorization)\s*[=:]\s*[^\s,;)]+/gi;
const BEARER_HEADER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

// Embedded absolute-path patterns for failure/diagnostic strings. Each match
// is projected with the same whole-path rules so a message never retains a
// raw machine-specific root. Lookbehinds exclude word chars, separators, "~"
// and "-" so relative tokens ("a/b", "./x"), already-projected "~/..." forms
// and flag-like tokens are never treated as absolute paths. Drive-letter
// matches accept a doubled separator ("C:\\dir") because JSON-serialized
// error messages escape backslashes, and reject "://" URLs by requiring a
// non-separator after the separator.
const EMBEDDED_POSIX_PATH_PATTERN =
  /(?<![A-Za-z0-9_\-./~>])\/(?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]+/g;
const EMBEDDED_WINDOWS_DRIVE_PATH_PATTERN =
  /(?<![A-Za-z0-9\\/:])[A-Za-z]:[\\/]{1,2}(?![\\/])[^\s]*/g;
const EMBEDDED_UNC_PATH_PATTERN = /(?<![A-Za-z0-9\\/])\\{2,}[^\\\s]+\\[^\s]*/g;
const EMBEDDED_PATH_PATTERN = new RegExp(
  [
    EMBEDDED_WINDOWS_DRIVE_PATH_PATTERN.source,
    EMBEDDED_UNC_PATH_PATTERN.source,
    EMBEDDED_POSIX_PATH_PATTERN.source,
  ].join("|"),
  "g",
);

// mkdtemp-style trailing random suffix ("name-<6 alnum>") is stripped from
// temp-relative labels so reports are deterministic and never carry random
// directory names.
const TEMP_RANDOM_SUFFIX_PATTERN = /-[A-Za-z0-9]{6}$/;

// Basenames that must never be echoed next to "<abs>": dotfiles and known
// credential/secret file shapes.
const SENSITIVE_BASENAME_PATTERN =
  /^\.[^/\\]*$|\.(?:pem|key|p12|pfx|env)$|^(?:id_rsa|id_ed25519|id_ecdsa|credentials|netrc)$/i;

/** Trailing punctuation that may cling to an embedded path in a message. */
function trimTrailingPunctuation(match: string): string {
  return match.replace(/[)\]"',.;:]+$/, "");
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/**
 * The relative part of `child` under `parent`, or null when `child` is not
 * under `parent` (boundary-aware: a sibling like "/Users/name2" is not under
 * "/Users/name"). Comparison is case-insensitive on Windows.
 */
function relativeToParent(child: string, parent: string): string | null {
  const normalizedParent = stripTrailingSeparators(parent);
  if (normalizedParent.length < 2) return null;
  const fold = (value: string) => (process.platform === "win32" ? value.toLowerCase() : value);
  const childFolded = fold(child);
  const parentFolded = fold(normalizedParent);
  if (childFolded === parentFolded) return "";
  if (
    childFolded.startsWith(parentFolded + "\\") ||
    childFolded.startsWith(parentFolded + "/")
  ) {
    return child.slice(normalizedParent.length).replace(/^[\\/]+/, "");
  }
  return null;
}

function isWindowsStylePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\") || value.includes("\\");
}

/** Strip mkdtemp-style random suffixes from every segment of a temp-relative path. */
function stripTempRandomSuffix(relative: string): string {
  return relative
    .split(/[\\/]/)
    .map((segment) => {
      const stripped = segment.replace(TEMP_RANDOM_SUFFIX_PATTERN, "");
      return stripped.length > 0 ? stripped : segment;
    })
    .join(path.sep);
}

/** Project one absolute path to its safe non-absolute report label. */
function projectAbsolutePath(value: string): string {
  // The temp root is checked before home because on Windows os.tmpdir() lives
  // under the home directory; temp paths must project to "<tmp>" even then.
  const tmp = os.tmpdir();
  if (tmp.length > 1) {
    const relative = relativeToParent(value, tmp);
    if (relative !== null) {
      if (relative.length === 0) return "<tmp>";
      return `<tmp>${path.sep}${stripTempRandomSuffix(relative)}`;
    }
  }
  const home = os.homedir();
  if (home.length > 1) {
    const relative = relativeToParent(value, home);
    if (relative !== null) {
      return relative.length === 0 ? "~" : `~${path.sep}${relative}`;
    }
  }
  const basename = isWindowsStylePath(value) ? path.win32.basename(value) : path.posix.basename(value);
  const safeBasename = SENSITIVE_BASENAME_PATTERN.test(basename) ? "" : basename;
  return safeBasename.length > 0 ? `<abs>${path.sep}${safeBasename}` : "<abs>";
}

function isAbsolutePathValue(value: string): boolean {
  if (value.startsWith("~")) return false;
  if (path.posix.isAbsolute(value)) return true;
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

export function sanitizePathForReport(value: string): string {
  if (value.length === 0) return value;
  if (isAbsolutePathValue(value)) {
    return projectAbsolutePath(value);
  }
  // Failure/diagnostic strings may embed absolute paths; project each one.
  return value.replace(EMBEDDED_PATH_PATTERN, (match) =>
    projectAbsolutePath(trimTrailingPunctuation(match)),
  );
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
  // Paths are projected before truncation so a path that sits beyond the
  // 500-char bound can never be cut in a state that leaks its raw root.
  return redactCredentialShapes(sanitizePathForReport(message)).slice(0, 500);
}
