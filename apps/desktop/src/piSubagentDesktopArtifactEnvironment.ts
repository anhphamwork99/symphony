// FILE: piSubagentDesktopArtifactEnvironment.ts
// Purpose: Compatibility re-export shim for the desktop backend env boundary.
// The production implementation moved to
// `@synara/shared/piSubagentDesktopArtifactEnvironment` (Ticket 04 repair) so
// the desktop main process and the server-side production composition
// acceptance test exercise the SAME code under test. This module preserves
// every existing desktop import path with byte-for-byte identical runtime
// behavior; no desktop-side logic may be re-declared here.
// Layer: Desktop main-process startup helper (re-export only)
// Depends: `@synara/shared` subpath export only.
// Exports: everything the shared managed-artifact environment module exports.

export * from "@synara/shared/piSubagentDesktopArtifactEnvironment";
