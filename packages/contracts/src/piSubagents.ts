import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas";

export const PI_SUBAGENTS_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_MIN_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_MAX_PROTOCOL_VERSION = 1;

export const PI_SUBAGENT_CAPABILITIES = [
  "managed-spawn",
  "abort-propagation",
  "coalesced-progress",
  "terminal-outbox",
  "restart-reconciliation",
  "paginated-transcripts",
] as const;

export const PiSubagentCapability = Schema.Literals(PI_SUBAGENT_CAPABILITIES);
export type PiSubagentCapability = typeof PiSubagentCapability.Type;

export const PiSubagentDiagnosticCode = Schema.Literals([
  "pi_subagent_managed_enabled",
  "pi_subagent_bridge_absent",
  "pi_subagent_bridge_error",
  "pi_subagent_unsupported_version",
  "pi_subagent_capability_mismatch",
]);
export type PiSubagentDiagnosticCode = typeof PiSubagentDiagnosticCode.Type;

export const PiSubagentHandshakeRequest = Schema.Struct({
  protocolVersion: PositiveInt,
  supportedProtocolVersions: Schema.Array(PositiveInt),
  clientVersion: TrimmedNonEmptyString,
  requiredCapabilities: Schema.Array(PiSubagentCapability),
  optionalCapabilities: Schema.optional(Schema.Array(PiSubagentCapability)),
});
export type PiSubagentHandshakeRequest = typeof PiSubagentHandshakeRequest.Type;

export const PiSubagentHandshakeSuccessResponse = Schema.Struct({
  ok: Schema.Literal(true),
  protocolVersion: PositiveInt,
  extensionVersion: TrimmedNonEmptyString,
  capabilities: Schema.Array(PiSubagentCapability),
});
export type PiSubagentHandshakeSuccessResponse = typeof PiSubagentHandshakeSuccessResponse.Type;

export const PiSubagentHandshakeFailureResponse = Schema.Struct({
  ok: Schema.Literal(false),
  error: Schema.Literals([
    "unsupported_version",
    "missing_capabilities",
    "bridge_error",
    "invalid_request",
  ]),
  protocolVersion: Schema.optional(PositiveInt),
  supportedProtocolVersions: Schema.optional(Schema.Array(PositiveInt)),
  extensionVersion: Schema.optional(TrimmedNonEmptyString),
  missingCapabilities: Schema.optional(Schema.Array(PiSubagentCapability)),
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentHandshakeFailureResponse = typeof PiSubagentHandshakeFailureResponse.Type;

export const PiSubagentHandshakeResponse = Schema.Union([
  PiSubagentHandshakeSuccessResponse,
  PiSubagentHandshakeFailureResponse,
]);
export type PiSubagentHandshakeResponse = typeof PiSubagentHandshakeResponse.Type;

export const PiSubagentNegotiatedCapability = Schema.Struct({
  status: Schema.Literals([
    "managed_enabled",
    "bridge_absent",
    "unsupported_version",
    "bridge_error",
  ]),
  diagnosticCode: PiSubagentDiagnosticCode,
  isManaged: Schema.Boolean,
  protocolVersion: Schema.optional(PositiveInt),
  capabilities: Schema.optional(Schema.Array(PiSubagentCapability)),
  extensionVersion: Schema.optional(TrimmedNonEmptyString),
  offeredVersion: Schema.optional(PositiveInt),
  supportedVersions: Schema.optional(Schema.Array(PositiveInt)),
  diagnosticMessage: Schema.optional(TrimmedNonEmptyString),
});
export type PiSubagentNegotiatedCapability = typeof PiSubagentNegotiatedCapability.Type;
