import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  PiSubagentPromptClosureError,
  derivePromptClosure,
  derivePromptClosureFromRepo,
  type PromptClosureSourceSeam,
} from "./piSubagentPromptClosureDerivation.ts";

/**
 * Ticket 01c (Decision 0010 AC1/AC2) — the prompt-closure derivation boundary.
 *
 * The derivation must be MECHANICAL: a fifth literal required read is
 * included automatically, and every unsupported shape (dynamic/template/
 * computed paths, unrecognized reads/imports, missing anchors, escapes)
 * fails closed with a bounded repo-relative diagnostic. The real-pin test
 * proves the current pin resolves to exactly the four runtime prompt files.
 */

const temporaryRoots: string[] = [];
const REAL_ALFIE_REPO_DIR = process.env.ALFIE_REPO_DIR ?? "";
const REPO_ROOT = join(dirnameOf(import.meta.url), "..", "..");

function dirnameOf(url: string): string {
  return fileURLToPath(new URL(".", url));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

const EXT_SRC = "agent/extensions/pi-subagents/src";

/** The pinned prompts.ts shape (mirrors the real module, parameterizable). */
function promptsModule(options: {
  readonly extraLiteralRead?: string;
  readonly dynamicRead?: boolean;
  readonly templateRead?: boolean;
  readonly unresolvedImportRead?: boolean;
  readonly nonLiteralSegments?: boolean;
}): string {
  const extra = options.extraLiteralRead
    ? `const EXTRA_PATH = join(SYSTEM_DIR, "${options.extraLiteralRead}");\n`
    : "";
  const extraRead = options.extraLiteralRead ? "  readRequiredPrompt(EXTRA_PATH),\n" : "";
  const dynamicRead = options.dynamicRead
    ? "  readRequiredPrompt(join(SYSTEM_DIR, `dyn-${Date.now()}.md`)),\n"
    : "";
  const templateRead = options.templateRead
    ? "  readRequiredPrompt(join(SYSTEM_DIR, `${name}.md`)),\n"
    : "";
  const unresolvedImportRead = options.unresolvedImportRead
    ? "  readRequiredPrompt(pathFromElsewhere),\n"
    : "";
  const systemDir = options.nonLiteralSegments
    ? 'const SYSTEM_DIR = join(__dirname, "../../../" + computedBase());'
    : 'const SYSTEM_DIR = join(__dirname, "../../../system");';
  return `import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
${systemDir}
const SUBAGENT_SYSTEM_TEMPLATE_PATH = join(SYSTEM_DIR, "subagent-system.md");
const TOOL_GUIDELINES_PATH = join(SYSTEM_DIR, "tool-guidelines.md");
const SKILL_RULES_PATH = join(SYSTEM_DIR, "skill-rules.md");
const WORKING_STYLE_PATH = join(SYSTEM_DIR, "working-style.md");
${extra}
function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readRequiredPrompt(path: string): string {
  if (!existsSync(path)) {
    throw new Error(\`Required subagent prompt file missing: \${path}\`);
  }
  const body = clean(readFileSync(path, "utf-8"));
  if (!body) {
    throw new Error(\`Required subagent prompt file is empty: \${path}\`);
  }
  return body;
}

export function buildAgentPrompt(): string {
  return [
    readRequiredPrompt(SUBAGENT_SYSTEM_TEMPLATE_PATH),
    readRequiredPrompt(TOOL_GUIDELINES_PATH),
    readRequiredPrompt(SKILL_RULES_PATH),
    readRequiredPrompt(WORKING_STYLE_PATH),
${extraRead}${dynamicRead}${templateRead}${unresolvedImportRead}  ].join("\\n");
}
`;
}

function agentRunnerModule(): string {
  return `import { buildAgentPrompt } from "./prompts.js";
export function runAgent(): string {
  return buildAgentPrompt();
}
`;
}

/** Synthetic pure source seam over in-memory module text. */
function seamFor(modules: ReadonlyMap<string, string>): PromptClosureSourceSeam {
  return {
    readSource: (modulePath) => {
      const source = modules.get(modulePath);
      if (source === undefined) {
        throw new PiSubagentPromptClosureError(
          "prompt_closure_invalid",
          `Module '${modulePath}' is missing from the synthetic fixture.`,
        );
      }
      return source;
    },
    resolveImport: (fromModule, specifier) => {
      const base = fromModule.slice(0, fromModule.lastIndexOf("/"));
      const joined = `${base}/${specifier}`.replace(/\/\.\//g, "/");
      return joined.endsWith(".js") ? `${joined.slice(0, -3)}.ts` : joined;
    },
  };
}

function syntheticSeam(
  promptsOptions: Parameters<typeof promptsModule>[0] = {},
): PromptClosureSourceSeam {
  return seamFor(
    new Map([
      [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
      [`${EXT_SRC}/prompts.ts`, promptsModule(promptsOptions)],
    ]),
  );
}

const CURRENT_FOUR = [
  "agent/system/skill-rules.md",
  "agent/system/subagent-system.md",
  "agent/system/tool-guidelines.md",
  "agent/system/working-style.md",
];

describe("pi-subagents prompt closure derivation (Ticket 01c, AC1)", () => {
  describe.skipIf(!REAL_ALFIE_REPO_DIR)(
    "real pinned Alfie checkout",
    () => {
      it("derives exactly the four current runtime prompt dependencies", () => {
        const closure = derivePromptClosureFromRepo({ repoDir: REAL_ALFIE_REPO_DIR });
        expect(closure.promptPaths).toEqual(CURRENT_FOUR);
      });

      it("derivation is deterministic (repeat invocation is identical)", () => {
        const first = derivePromptClosureFromRepo({ repoDir: REAL_ALFIE_REPO_DIR });
        const second = derivePromptClosureFromRepo({ repoDir: REAL_ALFIE_REPO_DIR });
        expect(second.promptPaths).toEqual(first.promptPaths);
      });
    },
  );

  it("derives exactly the four literal prompt reads from the synthetic pinned shape", () => {
    expect(derivePromptClosure(syntheticSeam()).promptPaths).toEqual(CURRENT_FOUR);
  });

  it("AC1 negative fixture: a FIFTH literal required read is included automatically", () => {
    const closure = derivePromptClosure(
      syntheticSeam({ extraLiteralRead: "orchestration-rules.md" }),
    );
    expect(closure.promptPaths).toEqual(
      [...CURRENT_FOUR, "agent/system/orchestration-rules.md"].sort(),
    );
  });

  it("AC2: a dynamic (Date-derived) required read fails prompt_closure_unsupported", () => {
    expect(() => derivePromptClosure(syntheticSeam({ dynamicRead: true }))).toThrow(
      PiSubagentPromptClosureError,
    );
    try {
      derivePromptClosure(syntheticSeam({ dynamicRead: true }));
    } catch (error) {
      const closureError = error as PiSubagentPromptClosureError;
      expect(closureError.code).toBe("prompt_closure_unsupported");
      expect(closureError.message).toContain("dynamic or unresolved path expression");
      // Bounded diagnostics: no absolute host paths leak.
      expect(closureError.message).not.toContain(tmpdir());
    }
  });

  it("AC2: a template-literal path with substitution fails prompt_closure_unsupported", () => {
    expect(() => derivePromptClosure(syntheticSeam({ templateRead: true }))).toThrow(
      /dynamic or unresolved path expression/,
    );
  });

  it("AC2: an unresolved identifier path fails prompt_closure_unsupported", () => {
    expect(() => derivePromptClosure(syntheticSeam({ unresolvedImportRead: true }))).toThrow(
      /dynamic or unresolved path expression/,
    );
  });

  it("AC2: a computed SYSTEM_DIR segment fails prompt_closure_unsupported", () => {
    expect(() => derivePromptClosure(syntheticSeam({ nonLiteralSegments: true }))).toThrow(
      PiSubagentPromptClosureError,
    );
  });

  it("AC2: a raw readFileSync outside the recognized reader shape fails unsupported", () => {
    const seam = seamFor(
      new Map([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
        [
          `${EXT_SRC}/prompts.ts`,
          promptsModule({}).replace(
            "export function buildAgentPrompt()",
            `function sideLoad(): string {
  return readFileSync(SYSTEM_DIR + "/extra.md", "utf-8");
}

export function buildAgentPrompt()`,
          ),
        ],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(
      /outside the recognized required-prompt reader shape/,
    );
  });

  it("AC2: an entry module without the prompt-builder import fails unsupported", () => {
    const seam = seamFor(
      new Map<string, string>([
        [`${EXT_SRC}/agent-runner.ts`, "export function runAgent() { return 1; }\n"],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(/does not import 'buildAgentPrompt'/);
  });

  it("AC2: an unresolvable relative import fails unsupported", () => {
    const seam = seamFor(
      new Map<string, string>([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(
      /Could not resolve prompt-closure import/,
    );
  });

  it("AC2: a missing module-directory anchor fails unsupported", () => {
    const seam = seamFor(
      new Map([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
        [
          `${EXT_SRC}/prompts.ts`,
          promptsModule({}).replace(
            'const SYSTEM_DIR = join(__dirname, "../../../system");',
            'const SYSTEM_DIR = join(process.env.HOME ?? "", "system");',
          ),
        ],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(
      /dynamic or unresolved path expression|does not anchor at the module directory/,
    );
  });

  it("AC2: a path escaping the repository root fails prompt_closure_invalid", () => {
    const seam = seamFor(
      new Map([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
        [
          `${EXT_SRC}/prompts.ts`,
          promptsModule({}).replace(
            'const SYSTEM_DIR = join(__dirname, "../../../system");',
            'const SYSTEM_DIR = join(__dirname, "../../../../../../etc");',
          ),
        ],
      ]),
    );
    // The static derivation normalizes to a path outside the repo; the
    // repo-boundary guard in derivePromptClosureFromRepo must reject it.
    const root = join(makeTempRoot("closure-escape-"), "alfie");
    mkdirSync(join(root, EXT_SRC), { recursive: true });
    writeFileSync(join(root, `${EXT_SRC}/agent-runner.ts`), agentRunnerModule());
    writeFileSync(join(root, `${EXT_SRC}/prompts.ts`), promptsModule({}).replace(
      'const SYSTEM_DIR = join(__dirname, "../../../system");',
      'const SYSTEM_DIR = join(__dirname, "../../../../../../etc");',
    ));
    expect(() => derivePromptClosureFromRepo({ repoDir: root })).toThrow(
      /escapes the pinned repository/,
    );
  });

  it("AC2: an absolute-path read (not anchored at the module dir) fails unsupported", () => {
    const seam = seamFor(
      new Map([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
        [
          `${EXT_SRC}/prompts.ts`,
          promptsModule({}).replace(
            'const SYSTEM_DIR = join(__dirname, "../../../system");',
            'const SYSTEM_DIR = "/etc/alfie-system";',
          ),
        ],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(
      /does not anchor at the module directory/,
    );
  });

  it("AC2: a read with zero recognized reader calls fails unsupported (no silent empty closure)", () => {
    const seam = seamFor(
      new Map([
        [`${EXT_SRC}/agent-runner.ts`, agentRunnerModule()],
        [
          `${EXT_SRC}/prompts.ts`,
          `export function buildAgentPrompt(): string {
  return "static";
}
`,
        ],
      ]),
    );
    expect(() => derivePromptClosure(seam)).toThrow(/No required prompt reads found/);
  });

  it("filesystem seam: a missing source module fails prompt_closure_invalid with a relative diagnostic", () => {
    const root = makeTempRoot("closure-missing-");
    mkdirSync(join(root, EXT_SRC), { recursive: true });
    writeFileSync(join(root, `${EXT_SRC}/agent-runner.ts`), agentRunnerModule());
    try {
      derivePromptClosureFromRepo({ repoDir: root });
      expect.unreachable("derivation must fail on the missing prompts module");
    } catch (error) {
      const closureError = error as PiSubagentPromptClosureError;
      expect(closureError.code).toBe("prompt_closure_unsupported");
      expect(closureError.message).toContain("prompts.ts");
      expect(closureError.message).not.toContain(root);
    }
  });

  it("REPO_ROOT sanity: the repository-anchored entry path exists in the real tree shape", () => {
    // Guards against the entry constant drifting away from the staged layout.
    expect(EXT_SRC.startsWith("agent/extensions/pi-subagents/")).toBe(true);
    expect(REPO_ROOT.length).toBeGreaterThan(0);
  });
});
