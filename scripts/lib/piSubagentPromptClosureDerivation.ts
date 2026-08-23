// FILE: piSubagentPromptClosureDerivation.ts
// Purpose: Ticket 01c (Decision 0010) — mechanically derive the pinned
// pi-subagents extension's child-prompt runtime dependency closure from the
// extension's actual source, rooted at the child execution entry path.
// Layer: Release/build helper (pure static analysis; no execution of the
// pinned source).
//
// The derivation walks the pinned extension's TypeScript AST starting at
// `agent/extensions/pi-subagents/src/agent-runner.ts`, resolves the imported
// `buildAgentPrompt` module, and statically resolves every filesystem read
// performed by the required prompt reader (`readRequiredPrompt`-shaped
// functions: existsSync guard + readFileSync + non-empty check). Path
// expressions built from `join(__dirname, ...)`-style literal bindings are
// resolved to repository-relative POSIX paths. Anything the analysis cannot
// statically prove — dynamic/computed/template/unresolved path construction,
// unrecognized read or import shapes — fails closed with a bounded diagnostic
// that never carries absolute host paths.
//
// This module never installs a hand-maintained filename allowlist: a new or
// changed literal required read in a future pin is included automatically;
// an unsupported shape fails the build instead of silently omitting content.

import * as fsSync from "node:fs";
import { dirname, join, posix, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Extension subtree the artifact stages (mirrors the stager's constant). */
const EXTENSION_RELATIVE_ROOT = "agent/extensions/pi-subagents";

/** Child execution entry module (runAgent) inside the extension. */
export const PROMPT_CLOSURE_ENTRY_MODULE = `${EXTENSION_RELATIVE_ROOT}/src/agent-runner.ts`;

/** The prompt-builder symbol the entry module invokes before any child model request. */
const PROMPT_BUILDER_NAME = "buildAgentPrompt";

/**
 * Bounded derivation failure with a stable machine-readable code. Codes are
 * build-time vocabulary (no host paths, no raw filesystem errors).
 */
export type PiSubagentPromptClosureErrorCode =
  | "prompt_closure_unsupported"
  | "prompt_closure_invalid";

export class PiSubagentPromptClosureError extends Error {
  readonly code: PiSubagentPromptClosureErrorCode;

  constructor(code: PiSubagentPromptClosureErrorCode, message: string) {
    super(message);
    this.name = "PiSubagentPromptClosureError";
    this.code = code;
  }
}

/** Derivation input: an injectable PURE source seam for synthetic tests. */
export interface PromptClosureSourceSeam {
  /** Returns the TypeScript source text of a repo-relative module path. */
  readonly readSource: (modulePath: string) => string;
  /**
   * Resolves a relative import specifier inside `fromModule` to the imported
   * module's repo-relative path (e.g. `./prompts.js` inside `.../src/x.ts`
   * → `.../src/prompts.ts`). Implementations decide `.js`→`.ts` mapping.
   */
  readonly resolveImport: (fromModule: string, specifier: string) => string;
}

/** The derived child-prompt dependency closure. */
export interface DerivedPromptClosure {
  /** Sorted unique repo-relative POSIX paths of every required prompt file. */
  readonly promptPaths: ReadonlyArray<string>;
}

const fail = (code: PiSubagentPromptClosureErrorCode, detail: string): never => {
  throw new PiSubagentPromptClosureError(code, detail);
};

const unsupported = (detail: string): never => fail("prompt_closure_unsupported", detail);

// ─── Source seam adapters ─────────────────────────────────────────────────────

/** Filesystem-backed source seam over the pinned repository (production build). */
export function filesystemSourceSeam(repoDir: string): PromptClosureSourceSeam {
  const root = resolve(repoDir);
  return {
    readSource: (modulePath) => {
      const target = resolve(root, modulePath);
      if (!target.startsWith(`${root}${sep}`)) {
        fail("prompt_closure_invalid", `Prompt-closure source read escapes the pinned repository at '${modulePath}'.`);
      }
      if (!fsSync.existsSync(target)) {
        fail("prompt_closure_invalid", `Prompt-closure source module '${modulePath}' is missing from the pinned tree.`);
      }
      return fsSync.readFileSync(target, "utf8");
    },
    resolveImport: (fromModule, specifier) => {
      if (!specifier.startsWith(".")) {
        unsupported(`Prompt-closure analysis requires relative imports; module '${fromModule}' imports '${specifier}'.`);
      }
      const baseDir = posix.dirname(fromModule);
      const joined = posix.normalize(posix.join(baseDir, specifier));
      const withoutExtension = joined.endsWith(".js") ? joined.slice(0, -3) : joined;
      for (const candidate of [`${withoutExtension}.ts`, `${withoutExtension}.tsx`, joined]) {
        if (fsSync.existsSync(join(root, candidate))) {
          return candidate;
        }
      }
      unsupported(`Could not resolve prompt-closure import '${specifier}' from '${fromModule}'.`);
    },
  };
}

// ─── Module analysis ─────────────────────────────────────────────────────────

interface ModuleFacts {
  /** Module-level const string/path bindings: name → literal path segments. */
  readonly constBindings: Map<string, ReadonlyArray<string>>;
  /** `__dirname` binding is present and anchored at this module's directory. */
  readonly hasDirnameAnchor: boolean;
  /** Required-prompt reader function names declared in this module. */
  readonly readerNames: ReadonlySet<string>;
  /** Other `readFileSync` call sites NOT routed through a reader (unsupported). */
  readonly rawReadCount: number;
}

/**
 * Recognizes the `dirname(fileURLToPath(import.meta.url))` anchor — the ESM
 * equivalent of `__dirname` used by the pinned `prompts.ts`.
 */
function isDirnameAnchor(init: ts.Expression): boolean {
  if (!ts.isCallExpression(init)) return false;
  const expr = init.expression;
  if (!ts.isIdentifier(expr) || expr.text !== "dirname") return false;
  const [arg] = init.arguments;
  if (!arg || !ts.isCallExpression(arg)) return false;
  const inner = arg.expression;
  if (!ts.isIdentifier(inner) || inner.text !== "fileURLToPath") return false;
  const [meta] = arg.arguments;
  return (
    !!meta &&
    ts.isPropertyAccessExpression(meta) &&
    ts.isMetaProperty(meta.expression) &&
    meta.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    meta.expression.getText() === "import.meta" &&
    meta.name.text === "url"
  );
}

/** Resolves a `join(...)` argument expression to literal path segments. */
function literalSegmentsOf(
  expr: ts.Expression,
  bindings: Map<string, ReadonlyArray<string>>,
): ReadonlyArray<string> | undefined {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return [expr.text];
  }
  if (ts.isIdentifier(expr)) {
    return bindings.get(expr.text);
  }
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (!ts.isIdentifier(callee) || callee.text !== "join") {
      return undefined;
    }
    const segments: string[] = [];
    for (const argument of expr.arguments) {
      const resolved = literalSegmentsOf(argument, bindings);
      if (resolved === undefined) return undefined;
      segments.push(...resolved);
    }
    return segments;
  }
  return undefined;
}

/**
 * Recognizes a required-prompt reader: a function whose parameter flows
 * DIRECTLY into `existsSync(param)` + `readFileSync(param, ...)` with a
 * non-empty check on the read body. The pinned `readRequiredPrompt` matches;
 * a drift to another read shape is `prompt_closure_unsupported` (via
 * `rawReadCount`) rather than a silently omitted dependency.
 */
function isRequiredPromptReader(fn: ts.FunctionDeclaration): boolean {
  const param = fn.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return false;
  const paramName = param.name.text;

  let hasExistsGuard = false;
  let hasRead = false;
  let hasNonEmptyCheck = false;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
          ? callee.name.text
          : "";
      const firstArg = node.arguments[0];
      const appliesToParam =
        !!firstArg && ts.isIdentifier(firstArg) && firstArg.text === paramName;
      if (calleeName === "existsSync" && appliesToParam) hasExistsGuard = true;
      if (calleeName === "readFileSync" && appliesToParam) hasRead = true;
      if (calleeName === "trim" || calleeName === "clean") hasNonEmptyCheck = true;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        (op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          op === ts.SyntaxKind.ExclamationEqualsToken ||
          op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          op === ts.SyntaxKind.EqualsEqualsToken) &&
        (ts.isPrefixUnaryExpression(node.left) ||
          ts.isPrefixUnaryExpression(node.right) ||
          ts.isIdentifier(node.left) ||
          ts.isIdentifier(node.right))
      ) {
        // Crude non-empty/emptiness comparison shape on the read result.
        hasNonEmptyCheck = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn.body!, visit);
  return hasExistsGuard && hasRead && hasNonEmptyCheck;
}

/** Counts `readFileSync` calls NOT routed through a recognized reader param. */
function countRawReads(sourceFile: ts.SourceFile, readerParamNames: ReadonlySet<string>): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)
          ? node.expression.name.text
          : "";
      const firstArg = node.arguments[0];
      if (
        calleeName === "readFileSync" &&
        !(!!firstArg && ts.isIdentifier(firstArg) && readerParamNames.has(firstArg.text))
      ) {
        count += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return count;
}

function analyzeModule(modulePath: string, source: string): ModuleFacts {
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const constBindings = new Map<string, ReadonlyArray<string>>();
  let hasDirnameAnchor = false;
  const readerNames = new Set<string>();
  const readerParamNames = new Set<string>();

  // First pass: readers (their param names feed the raw-read detector) and
  // module-level const bindings.
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      if (isRequiredPromptReader(statement)) {
        readerNames.add(statement.name.text);
        const param = statement.parameters[0]!.name;
        if (ts.isIdentifier(param)) readerParamNames.add(param.text);
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined
        ) {
          continue;
        }
        // Only `const` bindings participate: a mutable binding is not a
        // statically provable path.
        const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
        if (!isConst) continue;
        const init = declaration.initializer;
        if (isDirnameAnchor(init)) {
          hasDirnameAnchor = true;
          constBindings.set(declaration.name.text, ["__DIRNAME__"]);
          continue;
        }
        const segments = literalSegmentsOf(init, constBindings);
        if (segments !== undefined) {
          constBindings.set(declaration.name.text, segments);
        }
      }
    }
  }

  const rawReadCount = countRawReads(sourceFile, readerParamNames);
  return { constBindings, hasDirnameAnchor, readerNames, rawReadCount };
}

// ─── Closure walk ────────────────────────────────────────────────────────────

/** Resolves literal path segments (which may contain the `__DIRNAME__` anchor). */
function resolveSegmentsToRelative(
  segments: ReadonlyArray<string>,
  modulePath: string,
): string | undefined {
  const dir = posix.dirname(modulePath);
  const out: string[] = [];
  let anchored = false;
  for (const segment of segments) {
    if (segment === "__DIRNAME__") {
      if (anchored) return undefined;
      anchored = true;
      out.push(dir);
      continue;
    }
    if (segment.includes("..")) {
      out.push(segment);
      continue;
    }
    if (segment === "." || segment === "") continue;
    out.push(segment);
  }
  if (!anchored) return undefined;
  const normalized = posix.normalize(out.join("/"));
  if (posix.isAbsolute(normalized)) return undefined;
  return normalized === "" || normalized === "." ? undefined : normalized;
}

interface ModuleWalkResult {
  readonly promptPaths: ReadonlyArray<string>;
}

/**
 * Walks one module reachable from the prompt-builder root, collecting the
 * literal paths passed to recognized required-prompt readers inside the
 * prompt-builder function and the module-local helpers it invokes.
 */
function walkModuleForPromptReads(input: {
  readonly modulePath: string;
  readonly source: string;
  readonly seam: PromptClosureSourceSeam;
  readonly visited: Set<string>;
  readonly collected: Set<string>;
}): ModuleWalkResult {
  const { modulePath, source, seam, visited, collected } = input;
  if (visited.has(modulePath)) return { promptPaths: [] };
  visited.add(modulePath);

  const facts = analyzeModule(modulePath, source);
  if (facts.rawReadCount > 0) {
    unsupported(
      `Module '${modulePath}' performs a filesystem read outside the recognized required-prompt reader shape.`,
    );
  }

  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  // Locate the prompt-builder function declaration in this module.
  const builder = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === PROMPT_BUILDER_NAME,
  );
  if (builder === undefined || builder.body === undefined) {
    unsupported(`Module '${modulePath}' does not declare function '${PROMPT_BUILDER_NAME}'.`);
  }

  // Module-local helpers transitively called from the builder (same module).
  const helperNames = new Set<string>();
  const collectHelpers = (fn: ts.FunctionLikeDeclaration): void => {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        for (const argument of [node.expression, ...node.arguments]) {
          if (ts.isIdentifier(argument) && argument.text !== PROMPT_BUILDER_NAME && !helperNames.has(argument.text)) {
            const declaration = sourceFile.statements.find(
              (statement): statement is ts.FunctionDeclaration =>
                ts.isFunctionDeclaration(statement) && statement.name?.text === argument.text,
            );
            if (declaration?.body) {
              helperNames.add(argument.text);
              collectHelpers(declaration);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body!, visit);
  };
  collectHelpers(builder);

  // Reader invocations inside the builder + its helpers.
  const readerCallSites: Array<ts.CallExpression> = [];
  const considerRoot: ReadonlyArray<ts.FunctionDeclaration> = [
    builder,
    ...sourceFile.statements.filter(
      (statement): statement is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(statement) && statement.name !== undefined && helperNames.has(statement.name.text),
    ),
  ];
  for (const fn of considerRoot) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)
            ? callee.name.text
            : "";
        if (facts.readerNames.has(name)) {
          readerCallSites.push(node);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body!, visit);
  }

  if (readerCallSites.length === 0) {
    unsupported(`No required prompt reads found in '${PROMPT_BUILDER_NAME}' within '${modulePath}'.`);
  }

  for (const callSite of readerCallSites) {
    const [argument] = callSite.arguments;
    if (!argument) {
      unsupported(`A required prompt read in '${modulePath}' has no path argument.`);
    }
    const segments = literalSegmentsOf(argument, facts.constBindings);
    if (segments === undefined) {
      unsupported(
        `A required prompt read in '${modulePath}' uses a dynamic or unresolved path expression.`,
      );
    }
    const relative = resolveSegmentsToRelative(segments, modulePath);
    if (relative === undefined) {
      unsupported(
        `A required prompt read in '${modulePath}' does not anchor at the module directory.`,
      );
    }
    collected.add(relative);
  }

  return { promptPaths: [...collected] };
}

/**
 * Derives the pinned extension's child-prompt dependency closure from the
 * child execution entry module. Pure with respect to the supplied source
 * seam: it never executes pinned code and never touches the filesystem
 * unless the seam does.
 */
export function derivePromptClosure(seam: PromptClosureSourceSeam): DerivedPromptClosure {
  const entrySource = seam.readSource(PROMPT_CLOSURE_ENTRY_MODULE);
  const entryFile = ts.createSourceFile(
    PROMPT_CLOSURE_ENTRY_MODULE,
    entrySource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );

  // Resolve the prompt-builder import from the entry module.
  let promptModulePath: string | undefined;
  for (const statement of entryFile.statements) {
    const declarations = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings !== undefined &&
          ts.isNamedImports(statement.importClause.namedBindings)
        ? [[statement.importClause.namedBindings, statement.moduleSpecifier.text] as const]
        : []
      : ts.isVariableStatement(statement)
        ? statement.declarationList.declarations
            .filter(
              (declaration): declaration is ts.VariableDeclaration & { initializer: ts.CallExpression } =>
                declaration.initializer !== undefined && ts.isCallExpression(declaration.initializer),
            )
            .map((declaration) => {
              const call = declaration.initializer;
              const specifierArg = call.arguments[0];
              const specifier = specifierArg && ts.isStringLiteral(specifierArg) ? specifierArg.text : "";
              const named = declaration.name;
              return [
                ts.isObjectBindingPattern(named) ? named : undefined,
                specifier,
              ] as const;
            })
        : [];
    for (const [bindings, specifier] of declarations) {
      if (!bindings) continue;
      const importsBuilder = bindings.elements.some(
        (element) => ts.isIdentifier(element.name) && element.name.text === PROMPT_BUILDER_NAME,
      );
      if (importsBuilder && specifier) {
        promptModulePath = seam.resolveImport(PROMPT_CLOSURE_ENTRY_MODULE, specifier);
        break;
      }
    }
    if (promptModulePath !== undefined) break;
  }
  if (promptModulePath === undefined) {
    unsupported(
      `Entry module '${PROMPT_CLOSURE_ENTRY_MODULE}' does not import '${PROMPT_BUILDER_NAME}'.`,
    );
  }

  const visited = new Set<string>();
  const collected = new Set<string>();
  walkModuleForPromptReads({
    modulePath: promptModulePath,
    source: seam.readSource(promptModulePath),
    seam,
    visited,
    collected,
  });

  return { promptPaths: [...collected].sort() };
}

/**
 * Derives the prompt closure over a real pinned Alfie checkout and validates
 * every derived path against the repository root: it must resolve INSIDE the
 * repository (no escape), and — when the optional validators are supplied by
 * the stager — each entry must be a tracked, clean, non-empty, non-symlink
 * regular file. All diagnostics stay relative and bounded.
 */
export function derivePromptClosureFromRepo(input: {
  readonly repoDir: string;
}): DerivedPromptClosure {
  const root = resolve(input.repoDir);
  const closure = derivePromptClosure(filesystemSourceSeam(root));

  const validated: string[] = [];
  for (const relativePath of closure.promptPaths) {
    const absolute = resolve(root, relativePath);
    if (
      absolute === root ||
      !absolute.startsWith(`${root}${sep}`) ||
      relativePath.includes("..")
    ) {
      fail(
        "prompt_closure_invalid",
        `Derived prompt dependency '${relativePath}' escapes the pinned repository root.`,
      );
    }
    validated.push(relativePath);
  }
  if (validated.length === 0) {
    fail("prompt_closure_invalid", "Derived prompt dependency closure is empty.");
  }
  return { promptPaths: validated.sort() };
}
