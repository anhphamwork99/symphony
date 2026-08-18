import type { PiSubagentDiagnosticCode } from "@synara/contracts";

/**
 * Ticket 13 safe telemetry dimensions (T13-AC5).
 *
 * This is the single constructor for default-log/operator-event correlation
 * metadata. Its closed input/output shape makes prompt, result, transcript,
 * rejection-reason, and secret content impossible to add accidentally.
 */
export interface PiSubagentSafeCorrelationInput {
  readonly executionId: string;
  readonly attemptId: string;
  readonly threadId: string;
  readonly generation: number;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
}

export interface PiSubagentSafeCorrelation {
  readonly executionId: string;
  readonly attemptId: string;
  readonly threadId: string;
  readonly generation: number;
  readonly diagnosticCode: PiSubagentDiagnosticCode;
}

export function makePiSubagentSafeCorrelation(
  input: PiSubagentSafeCorrelationInput,
): PiSubagentSafeCorrelation {
  return {
    executionId: input.executionId,
    attemptId: input.attemptId,
    threadId: input.threadId.trim(),
    generation: input.generation,
    diagnosticCode: input.diagnosticCode,
  };
}
