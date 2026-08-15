// FILE: stimulus.ts
// Purpose: The fixed two-turn prompt stimulus (Decision 34 §2). Identical
// prompt bytes in the same turn positions for every mode; requests a
// deterministic, bounded text response; explicitly instructs the model not to
// call tools. The exact text and its byte hash are committed with the report.
import { createHash } from "node:crypto";

export const STIMULUS_TEXT = [
  "Reply with exactly the following text and nothing else. Do not use any tools.",
  "",
  "Measurement stimulus v1: deterministic bounded response.",
  "",
  "Do not call any tool. Do not read files, do not list directories, do not run commands, do not edit anything.",
  "Output only the exact sentence: Token overhead measurement stimulus acknowledged.",
].join("\n");

export const STIMULUS_HASH_ALGORITHM = "sha256" as const;

const encoder = new TextEncoder();

export function stimulusBytes(): Uint8Array {
  return encoder.encode(STIMULUS_TEXT);
}

export function stimulusByteLength(): number {
  return stimulusBytes().byteLength;
}

export function hashUtf8(value: string, algorithm: string = STIMULUS_HASH_ALGORITHM): string {
  return createHash(algorithm).update(encoder.encode(value)).digest("hex");
}

export function hashBytes(bytes: Uint8Array, algorithm: string = STIMULUS_HASH_ALGORITHM): string {
  return createHash(algorithm).update(bytes).digest("hex");
}

export const STIMULUS_HASH = hashUtf8(STIMULUS_TEXT);
