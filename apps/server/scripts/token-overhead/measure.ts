// FILE: scripts/token-overhead/measure.ts
// Purpose: Launcher for the impl-11 token-overhead measurement harness.
// All logic lives in apps/server/src/measurement/**; this file only forwards
// to the CLI entry so the harness can be invoked with a stable script path:
//
//   bun apps/server/scripts/token-overhead/measure.ts --repetitions=3
import { main as runCli } from "../../src/measurement/cli.ts";

const exitCode = await runCli();
process.exit(exitCode);
