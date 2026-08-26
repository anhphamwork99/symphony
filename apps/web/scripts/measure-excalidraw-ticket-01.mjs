#!/usr/bin/env node
// FILE: measure-excalidraw-ticket-01.mjs
// Purpose: Run the Ticket 01 Chromium performance suite and publish validated AC6 artifacts.
// Layer: Evidence runner (does not alter production wiring or package configuration)
// Validation: --validate-only <generated-baseline.json> validates a report;
//             --validate-raw-marker <raw-marker.json> validates browser marker evidence.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const evidenceDirectory = join(repositoryRoot, ".planning/synara-whiteboard/evidence/ticket-01");
const baselineJsonPath = join(evidenceDirectory, "excalidraw-baseline.json");
const baselineMarkdownPath = join(evidenceDirectory, "excalidraw-baseline.md");
const incompatibilitiesPath = join(evidenceDirectory, "incompatibilities.md");
const marker = "SYNARA_TICKET01_PERF_RESULT:";
const schemaVersion = "ticket01-excalidraw-baseline.v1";
const browserApiPort = process.env.VITEST_BROWSER_API_PORT ?? "51101";
const runtimeCommand = process.env.BUN_BIN ?? "bun";
const requiredMeasurementIds = [
  "hydrate-empty",
  "hydrate-normal",
  "hydrate-image",
  "serialize-normal",
  "update-progressive",
  "serialize-image",
  "export-svg-image",
  "export-png-image",
];

const suiteArgs = [
  "run",
  "--cwd",
  "apps/web",
  "test:browser",
  "--",
  "src/components/whiteboard/ticket01/SynaraExcalidrawAdapter.performance.browser.tsx",
  "--reporter=verbose",
];

function fail(message) {
  console.error(`Ticket 01 measurement runner: ${message}`);
  process.exitCode = 1;
}

function readRevision() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
  } catch (error) {
    throw new Error(
      `unable to read Synara revision: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function readSourceState() {
  return {
    revision: readRevision(),
    dirty:
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim().length > 0,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value, path) {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${path} must be a non-empty string`);
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
}

function requireNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${path} must be finite number`);
}

function validateMeasurement(value, index) {
  if (!isRecord(value)) throw new Error(`measurements[${index}] must be an object`);
  requireString(value.id, `measurements[${index}].id`);
  if (!Array.isArray(value.samplesMs) || value.samplesMs.length < 10) {
    throw new Error(`measurements[${index}].samplesMs must contain at least 10 raw samples`);
  }
  value.samplesMs.forEach((sample, sampleIndex) =>
    requireNumber(sample, `measurements[${index}].samplesMs[${sampleIndex}]`),
  );
}

function validateRawMarker(value) {
  if (!isRecord(value)) throw new Error("measurement marker must be an object");
  if (value.schemaVersion !== schemaVersion)
    throw new Error(`schemaVersion must be ${schemaVersion}`);
  if (value.packageVersion !== "0.18.1") throw new Error("packageVersion must be exactly 0.18.1");
  if (!isRecord(value.browser)) throw new Error("browser metadata is missing");
  requireString(value.browser.userAgent, "browser.userAgent");
  requireString(value.browser.platform, "browser.platform");
  if (!isRecord(value.protocol)) throw new Error("protocol metadata is missing");
  if (!Number.isSafeInteger(value.protocol.warmupCount) || value.protocol.warmupCount < 1)
    throw new Error("protocol.warmupCount must be declared and positive");
  if (!Number.isSafeInteger(value.protocol.sampleCount) || value.protocol.sampleCount < 10)
    throw new Error("protocol.sampleCount must be an integer of at least 10");
  requireString(value.protocol.timer, "protocol.timer");
  requireString(value.protocol.gc, "protocol.gc");
  requireString(value.protocol.memory, "protocol.memory");
  if (!isRecord(value.protocol.warmupCountByScenario))
    throw new Error("protocol.warmupCountByScenario is missing");
  for (const id of requiredMeasurementIds) {
    if (
      !Number.isSafeInteger(value.protocol.warmupCountByScenario[id]) ||
      value.protocol.warmupCountByScenario[id] < 1
    ) {
      throw new Error(`protocol.warmupCountByScenario.${id} must be a positive integer`);
    }
    if (value.protocol.warmupCountByScenario[id] !== value.protocol.warmupCount) {
      throw new Error(`protocol.warmupCountByScenario.${id} must match protocol.warmupCount`);
    }
  }
  if (!isRecord(value.fixtures)) throw new Error("fixture size metadata is missing");
  for (const category of ["empty", "normal", "image"]) {
    if (!isRecord(value.fixtures[category])) throw new Error(`fixtures.${category} is missing`);
    for (const field of ["elements", "files", "jsonBytes"])
      requireNumber(value.fixtures[category][field], `fixtures.${category}.${field}`);
  }
  if (!Array.isArray(value.measurements)) throw new Error("measurements must be an array");
  for (const [index, measurement] of value.measurements.entries())
    validateMeasurement(measurement, index);
  const actualIds = new Set(value.measurements.map((measurement) => measurement.id));
  for (const id of requiredMeasurementIds)
    if (!actualIds.has(id)) throw new Error(`required measurement ${id} is missing`);

  if (!isRecord(value.memoryObservation)) throw new Error("memoryObservation is missing");
  if (value.memoryObservation.status === "unavailable") {
    requireString(value.memoryObservation.reason, "memoryObservation.reason");
    if ("beforeBytes" in value.memoryObservation || "afterBytes" in value.memoryObservation) {
      throw new Error("unavailable memoryObservation must not contain byte values");
    }
  } else if (value.memoryObservation.status === "available") {
    requireString(value.memoryObservation.api, "memoryObservation.api");
    requireString(value.memoryObservation.kind, "memoryObservation.kind");
    requireNumber(value.memoryObservation.beforeBytes, "memoryObservation.beforeBytes");
    requireNumber(value.memoryObservation.afterBytes, "memoryObservation.afterBytes");
  } else {
    throw new Error("memoryObservation.status must be available or unavailable");
  }

  if (!isRecord(value.proofs)) throw new Error("proofs are missing");
  for (const key of [
    "orderedProgressiveUpdates",
    "nonRemount",
    "viewportRetention",
    "visibleCanvas",
    "hiddenRetainedCanvas",
    "separateMountUnmount",
    "imageSerialization",
    "imageSvgExport",
    "imagePngExport",
  ])
    requireBoolean(value.proofs[key], `proofs.${key}`);
  if (
    !Number.isSafeInteger(value.proofs.repeatedVisibilityCycles) ||
    value.proofs.repeatedVisibilityCycles < 1
  )
    throw new Error("repeatedVisibilityCycles must be positive");
  for (const key of [
    "orderedProgressiveUpdates",
    "nonRemount",
    "viewportRetention",
    "visibleCanvas",
    "hiddenRetainedCanvas",
    "separateMountUnmount",
    "imageSerialization",
    "imageSvgExport",
    "imagePngExport",
  ]) {
    if (value.proofs[key] !== true) throw new Error(`proofs.${key} did not pass`);
  }
  if (!Array.isArray(value.findings) || value.findings.length === 0)
    throw new Error("findings must be a non-empty array");
  for (const [index, finding] of value.findings.entries()) {
    if (!isRecord(finding)) throw new Error(`findings[${index}] must be an object`);
    requireString(finding.id, `findings[${index}].id`);
    requireString(finding.observation, `findings[${index}].observation`);
    if (
      !["none observed", "non-blocking limitation", "blocking incompatibility"].includes(
        finding.classification,
      )
    ) {
      throw new Error(`findings[${index}].classification is invalid`);
    }
  }
  if (value.findings.some((finding) => finding.classification === "blocking incompatibility")) {
    throw new Error("blocking incompatibility reported by measurement suite");
  }
}

function validateGeneratedBaseline(value) {
  validateRawMarker({
    schemaVersion: value.schemaVersion,
    packageVersion: value.package?.version,
    browser: value.environment?.browser,
    protocol: value.protocol,
    fixtures: value.fixtures,
    measurements: value.measurements,
    memoryObservation: value.memoryObservation,
    proofs: value.proofs,
    findings: value.findings,
  });
  if (value.ticket !== "01") throw new Error("ticket must be 01");
  if (value.ac !== "AC6") throw new Error("ac must be AC6");
  if (!isRecord(value.package)) throw new Error("package metadata is missing");
  requireString(value.package.name, "package.name");
  if (value.package.name !== "@excalidraw/excalidraw")
    throw new Error("package.name must be @excalidraw/excalidraw");
  if (value.package.version !== "0.18.1") throw new Error("package.version must be exactly 0.18.1");
  requireString(value.package.resolution, "package.resolution");

  if (!isRecord(value.environment)) throw new Error("environment metadata is missing");
  requireString(value.environment.synaraRevision, "environment.synaraRevision");
  if (!isRecord(value.environment.browser))
    throw new Error("environment.browser metadata is missing");
  if (!isRecord(value.environment.operatingSystem))
    throw new Error("environment.operatingSystem metadata is missing");
  for (const key of ["platform", "release", "architecture"])
    requireString(value.environment.operatingSystem[key], `environment.operatingSystem.${key}`);
  requireString(value.environment.buildMode, "environment.buildMode");
  requireString(value.environment.focusedCommand, "environment.focusedCommand");

  if (!isRecord(value.provenance)) throw new Error("provenance metadata is missing");
  requireString(value.provenance.measuredSourceRevision, "provenance.measuredSourceRevision");
  if (value.environment.synaraRevision !== value.provenance.measuredSourceRevision) {
    throw new Error("environment.synaraRevision must match provenance.measuredSourceRevision");
  }
  requireBoolean(
    value.provenance.measuredSourceRevisionDirty,
    "provenance.measuredSourceRevisionDirty",
  );
  if (value.provenance.evidenceCommit !== null) {
    requireString(value.provenance.evidenceCommit, "provenance.evidenceCommit");
  }
  requireString(value.provenance.evidenceCommitPolicy, "provenance.evidenceCommitPolicy");

  for (const [index, measurement] of value.measurements.entries()) {
    if (measurement.unit !== "ms") throw new Error(`measurements[${index}].unit must be ms`);
    if (!isRecord(measurement.summary))
      throw new Error(`measurements[${index}].summary is missing`);
    if (measurement.summary.count !== measurement.samplesMs.length)
      throw new Error(`measurements[${index}].summary.count does not match raw samples`);
    requireNumber(measurement.summary.medianMs, `measurements[${index}].summary.medianMs`);
    requireNumber(measurement.summary.p95Ms, `measurements[${index}].summary.p95Ms`);
    requireString(
      measurement.summary.percentileDefinition,
      `measurements[${index}].summary.percentileDefinition`,
    );
  }

  if (!isRecord(value.classificationCounts)) throw new Error("classificationCounts is missing");
  const expectedCounts = classificationCounts(value.findings);
  for (const classification of Object.keys(expectedCounts)) {
    if (value.classificationCounts[classification] !== expectedCounts[classification]) {
      throw new Error(`classificationCounts.${classification} does not match findings`);
    }
  }
}

function percentile(samples, percentileValue) {
  const sorted = samples.toSorted((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(samples) {
  return {
    count: samples.length,
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    percentileDefinition: "linear interpolation over sorted samples; p95 position=(n-1)*0.95",
  };
}

function classificationCounts(findings) {
  return findings.reduce((counts, finding) => {
    counts[finding.classification] = (counts[finding.classification] ?? 0) + 1;
    return counts;
  }, {});
}

function makeBaseline(rawEvidence, revision, sourceRevisionDirty) {
  return {
    schemaVersion,
    ticket: "01",
    ac: "AC6",
    package: {
      name: "@excalidraw/excalidraw",
      version: rawEvidence.packageVersion,
      resolution: "exact package pin 0.18.1",
    },
    environment: {
      synaraRevision: revision,
      browser: rawEvidence.browser,
      operatingSystem: {
        platform: platform(),
        release: release(),
        architecture: arch(),
      },
      buildMode:
        "Vite browser test build using the production-compatible apps/web toolchain; not production minification",
      focusedCommand: `VITEST_BROWSER_API_PORT=${browserApiPort} bun ${suiteArgs.join(" ")}`,
    },
    provenance: {
      measuredSourceRevision: revision,
      measuredSourceRevisionDirty: sourceRevisionDirty,
      evidenceCommit: null,
      evidenceCommitPolicy:
        "The measurement source revision is captured before the browser run. Evidence/report artifacts are committed separately by the integrator; this runner never claims that later commit.",
    },
    fixtures: rawEvidence.fixtures,
    protocol: rawEvidence.protocol,
    measurements: rawEvidence.measurements.map((measurement) => ({
      id: measurement.id,
      unit: "ms",
      samplesMs: measurement.samplesMs,
      summary: summarize(measurement.samplesMs),
    })),
    memoryObservation: rawEvidence.memoryObservation,
    proofs: rawEvidence.proofs,
    findings: rawEvidence.findings,
    classificationCounts: classificationCounts(rawEvidence.findings),
  };
}

function formatMs(value) {
  return `${value.toFixed(3)} ms`;
}

function makeMarkdown(baseline) {
  const lines = [
    "# Ticket 01 Excalidraw AC6 baseline",
    "",
    "This is a feasibility baseline from the real lazy Synara adapter and official `@excalidraw/excalidraw` 0.18.1 in Chromium. It is observational evidence, not a latency, memory, board-size, or image-size budget.",
    "",
    "## Environment and protocol",
    "",
    `- Package: \`${baseline.package.name}@${baseline.package.version}\` (${baseline.package.resolution})`,
    `- Measured Synara source revision: \`${baseline.provenance.measuredSourceRevision}\``,
    `- Evidence/report commit: ${baseline.provenance.evidenceCommit ?? "separate commit, not recorded by the measurement runner"}`,
    `- Browser: ${baseline.environment.browser.userAgent}`,
    `- OS/architecture: ${baseline.environment.operatingSystem.platform} ${baseline.environment.operatingSystem.release} / ${baseline.environment.operatingSystem.architecture}`,
    `- Build mode: ${baseline.environment.buildMode}`,
    `- Warm-up: ${baseline.protocol.warmupCount} warm-up operation(s) per repeatable scenario; retained in protocol and excluded from reported raw samples.`,
    `- Samples: ${baseline.protocol.sampleCount} raw latency samples per repeatable operation. Timer: ${baseline.protocol.timer}`,
    `- Percentiles: median and p95; ${baseline.measurements[0].summary.percentileDefinition}.`,
    `- GC: ${baseline.protocol.gc}`,
    "",
    "## Fixture sizes",
    "",
    "| Fixture | Elements | Files | JSON bytes |",
    "| --- | ---: | ---: | ---: |",
    ...Object.entries(baseline.fixtures).map(
      ([name, fixture]) =>
        `| ${name} | ${fixture.elements} | ${fixture.files} | ${fixture.jsonBytes} |`,
    ),
    "",
    "## Raw latency summaries",
    "",
    "Raw samples are retained in `excalidraw-baseline.json`. No threshold or pass/fail budget is inferred from these observations.",
    "",
    "| Scenario | Samples | Median | p95 |",
    "| --- | ---: | ---: | ---: |",
    ...baseline.measurements.map(
      (measurement) =>
        `| ${measurement.id} | ${measurement.summary.count} | ${formatMs(measurement.summary.medianMs)} | ${formatMs(measurement.summary.p95Ms)} |`,
    ),
    "",
    "## Boundary proofs",
    "",
    `- Ordered progressive updates: **${baseline.proofs.orderedProgressiveUpdates ? "observed" : "not observed"}**; update order and existing API identity were asserted.`,
    `- Non-remount and viewport retention: **${baseline.proofs.nonRemount && baseline.proofs.viewportRetention ? "observed" : "not observed"}**.`,
    `- Visible canvas and hidden retained canvas: **${baseline.proofs.visibleCanvas && baseline.proofs.hiddenRetainedCanvas ? "observed" : "not observed"}**.`,
    `- Repeated visibility cycles: **${baseline.proofs.repeatedVisibilityCycles}** cycles with identities retained.`,
    `- Separate mount/unmount probe: **${baseline.proofs.separateMountUnmount ? "observed" : "not observed"}**.`,
    `- Image-bearing serialization/SVG/PNG export: **${baseline.proofs.imageSerialization && baseline.proofs.imageSvgExport && baseline.proofs.imagePngExport ? "observed" : "not observed"}**.`,
    "",
    "## Memory instrumentation",
    "",
  ];
  if (baseline.memoryObservation.status === "unavailable") {
    lines.push(`- **Unavailable:** ${baseline.memoryObservation.reason}`);
  } else {
    lines.push(
      `- **Available, coarse process observation:** ${baseline.memoryObservation.api}; before=${baseline.memoryObservation.beforeBytes} bytes, after=${baseline.memoryObservation.afterBytes} bytes.`,
    );
    lines.push(`- Limitation: ${baseline.memoryObservation.limitation}`);
  }
  lines.push(
    '- Unavailable memory is represented as `{status:"unavailable", reason}` in JSON; it is never recorded as zero.',
    "",
    "## Known limitations",
    "",
    ...baseline.findings
      .filter((finding) => finding.classification === "non-blocking limitation")
      .map((finding) => `- **${finding.id}:** ${finding.observation}`),
    "",
    "See `incompatibilities.md` for the complete classification of observed findings. The suite found no blocking incompatibility and introduced no product budget.",
    "",
  );
  return lines.join("\n");
}

function makeIncompatibilityReport(baseline) {
  const lines = [
    "# Ticket 01 incompatibility report",
    "",
    `Evidence source: \`excalidraw-baseline.json\`, schema \`${baseline.schemaVersion}\`, package \`${baseline.package.name}@${baseline.package.version}\`, measured Synara source revision \`${baseline.provenance.measuredSourceRevision}\`.`,
    "",
    "Decision 0048 classifications are limited to: none observed, non-blocking limitation, or blocking incompatibility. A finite timing or memory observation is not a failure because Ticket 01 defines no product budget.",
    "",
    "| Finding | Classification | Observation |",
    "| --- | --- | --- |",
    ...baseline.findings.map(
      (finding) => `| ${finding.id} | **${finding.classification}** | ${finding.observation} |`,
    ),
    "",
    "## Required-boundary disposition",
    "",
    "- Real Chromium package runtime, lazy adapter boundary, ordered imperative updates, non-remount, viewport retention, visible/hidden retained canvases, repeated visibility cycles, separate mount/unmount, and image serialization/export completed in the focused suite.",
    "- No mocked editor or mocked export substituted for the material Excalidraw measurements.",
    "- Exact one-event AI Undo remains Ticket 02 scope; this evidence records no product Undo guarantee.",
    "- Dot-grid rendering/export remains outside Ticket 01 scope and is not classified as a failure.",
    "",
    baseline.findings.some((finding) => finding.classification === "blocking incompatibility")
      ? "**Blocking incompatibility present: dependent Whiteboard work must stop for reassessment.**"
      : "**No blocking incompatibility observed in this run.**",
    "",
  ];
  return lines.join("\n");
}

function extractMarker(output) {
  const matches = [...output.matchAll(new RegExp(`${marker}(\\{[^\\n]*\\})`, "g"))];
  if (matches.length === 0)
    throw new Error("focused browser suite produced no complete measurement marker");
  if (matches.length !== 1)
    throw new Error(
      `focused browser suite produced ${matches.length} measurement markers; expected exactly one`,
    );
  try {
    return JSON.parse(matches[0][1]);
  } catch (error) {
    throw new Error(
      `measurement marker is malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function readJson(path) {
  const content = readFileSync(path, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(
      `validation input is malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function validateOnly(path, kind) {
  const value = readJson(path);
  if (kind === "raw-marker") validateRawMarker(value);
  else validateGeneratedBaseline(value);
  console.log(`validated ${path}`);
}

function runSuite() {
  const result = spawnSync(runtimeCommand, suiteArgs, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: "0", VITEST_BROWSER_API_PORT: browserApiPort },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error)
    throw new Error(`focused browser suite could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(
      `focused browser suite failed with exit code ${result.status}; reports were not written\n${output.slice(-8_000)}`,
    );
  }
  return extractMarker(output);
}

function main() {
  const validateIndex = process.argv.indexOf("--validate-only");
  if (validateIndex !== -1) {
    const firstArgument = process.argv[validateIndex + 1];
    if (!firstArgument)
      throw new Error(
        "--validate-only requires a generated baseline JSON path; use --validate-raw-marker for marker JSON",
      );
    if (firstArgument === "raw-marker") {
      const path = process.argv[validateIndex + 2];
      if (!path) throw new Error("--validate-only raw-marker requires a JSON path");
      validateOnly(resolve(path), "raw-marker");
    } else {
      validateOnly(resolve(firstArgument), "generated-baseline");
    }
    return;
  }
  const rawMarkerIndex = process.argv.indexOf("--validate-raw-marker");
  if (rawMarkerIndex !== -1) {
    const path = process.argv[rawMarkerIndex + 1];
    if (!path) throw new Error("--validate-raw-marker requires a JSON path");
    validateOnly(resolve(path), "raw-marker");
    return;
  }
  const sourceState = readSourceState();
  const rawEvidence = runSuite();
  validateRawMarker(rawEvidence);
  const baseline = makeBaseline(rawEvidence, sourceState.revision, sourceState.dirty);
  validateGeneratedBaseline(baseline);
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(baselineJsonPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  writeFileSync(baselineMarkdownPath, makeMarkdown(baseline), "utf8");
  writeFileSync(incompatibilitiesPath, makeIncompatibilityReport(baseline), "utf8");
  console.log(`wrote ${baselineJsonPath}`);
  console.log(`wrote ${baselineMarkdownPath}`);
  console.log(`wrote ${incompatibilitiesPath}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
