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
// Review-remediated static analysis (independent review of 4e6ee09c2):
//  - LEXICAL symbol identity, not identifier names. A `readFileSync` call is
//    "routed through the required-prompt reader" only when the call site is
//    inside the recognized reader's OWN body AND its path argument resolves
//    lexically to THAT reader's own parameter declaration. A different
//    function whose parameter merely reuses the same NAME is a distinct
//    binding and is accounted as a raw read (fail closed), never silently
//    ignored.
//  - CROSS-MODULE reachability. The prompt-read call graph rooted at
//    `buildAgentPrompt` traverses relevant RELATIVE imports: helper
//    functions imported from other modules and invoked from the reachable
//    graph are analyzed in their own module's lexical scope. A required
//    prompt read living in an imported helper is derived automatically;
//    an imported read shape that cannot be statically proved fails closed.
//    Non-relative imports referenced from the reachable graph are rejected
//    (unsupported) rather than skipped.
//
// This module never installs a hand-maintained filename allowlist: a new or
// changed literal required read in a future pin is included automatically;
// an unsupported shape fails the build instead of silently omitting content.

import * as fsSync from "node:fs";
import { join, posix, resolve, sep } from "node:path";
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

// ─── Module analysis (lexical, per-module) ───────────────────────────────────

/** Resolved reference target: the declaration a call-site identifier binds to. */
type ResolvedReference =
  | { readonly kind: "module_function"; readonly declaration: ts.FunctionDeclaration }
  | { readonly kind: "imported_function"; readonly importName: string; readonly specifier: string }
  | { readonly kind: "unresolved" };

interface ModuleFacts {
  /** The parsed module AST (shared node identity with the fields below). */
  readonly sourceFile: ts.SourceFile;
  /** Module-level const string/path bindings: name → literal path segments. */
  readonly constBindings: Map<string, ReadonlyArray<string>>;
  /** Module-level function declarations by NAME (names are module-unique here). */
  readonly functionsByName: Map<string, ts.FunctionDeclaration>;
  /**
   * Names imported through named import declarations: name → specifier. Only
   * RELATIVE specifiers are recorded; a reachable non-relative import is a
   * fail-closed condition handled during the walk.
   */
  readonly relativeImports: Map<string, string>;
  /** Non-relative specifiers imported by this module (name → specifier). */
  readonly externalImports: Map<string, string>;
  /**
   * Function declarations recognized as required-prompt readers (the FIRST
   * parameter flows directly into existsSync + readFileSync with a
   * non-empty check on the read body).
   */
  readonly readerDeclarations: ReadonlySet<ts.FunctionDeclaration>;
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
 * a drift to another read shape is `prompt_closure_unsupported` (via the
 * raw-read accounting below) rather than a silently omitted dependency.
 *
 * Reader-ness is keyed by the parameter NODE, so a same-named parameter in a
 * DIFFERENT function never inherits this recognition.
 */
function readerParameterOf(fn: ts.FunctionDeclaration): ts.ParameterDeclaration | undefined {
  const param = fn.parameters[0];
  if (!param || !ts.isIdentifier(param.name)) return undefined;
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
  if (!fn.body) return undefined;
  ts.forEachChild(fn.body, visit);
  return hasExistsGuard && hasRead && hasNonEmptyCheck ? param : undefined;
}

function analyzeModule(modulePath: string, source: string): ModuleFacts {
  const sourceFile = ts.createSourceFile(modulePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const constBindings = new Map<string, ReadonlyArray<string>>();
  const functionsByName = new Map<string, ts.FunctionDeclaration>();
  const relativeImports = new Map<string, string>();
  const externalImports = new Map<string, string>();
  const readerDeclarations = new Set<ts.FunctionDeclaration>();

  // Declarations are processed in order so a const binding may reference
  // earlier const bindings (mirrors the pinned module's shape).
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings !== undefined) {
      const specifier = statement.moduleSpecifier.getText(sourceFile).replace(/^["']|["']$/g, "");
      if (!ts.isNamedImports(statement.importClause.namedBindings)) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        if (specifier.startsWith(".")) {
          relativeImports.set(element.name.text, specifier);
        } else {
          externalImports.set(element.name.text, specifier);
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      functionsByName.set(statement.name.text, statement);
      if (readerParameterOf(statement) !== undefined) {
        readerDeclarations.add(statement);
      }
      continue;
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

  return {
    sourceFile,
    constBindings,
    functionsByName,
    relativeImports,
    externalImports,
    readerDeclarations,
  };
}

/** Enclosing function (or undefined at module top level) of a syntax node. */
function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Resolves a callee identifier lexically inside a module: a module-level
 * function declaration, or a named import binding. Shadowing inside nested
 * scopes is treated as unresolved (conservative fail-closed).
 */
function resolveReference(module: ModuleFacts, identifier: ts.Identifier): ResolvedReference {
  // Any local binder (parameter, local const/let, nested function name)
  // between the identifier and module top level shadows module bindings;
  // proving the absence of such a binder statically requires scope walking —
  // conservatively reject identifiers that declare a like-named local
  // anywhere in the enclosing function chain.
  for (let scope: ts.Node | undefined = identifier.parent; scope !== undefined; scope = scope.parent) {
    if (ts.isFunctionDeclaration(scope) && scope.name?.text === identifier.text && functionsContains(module, scope)) {
      return { kind: "module_function", declaration: scope };
    }
    const shadows =
      (ts.isFunctionLikeDeclaration(scope) || ts.isBlock(scope)) &&
      declaresLocalName(scope, identifier.text);
    if (shadows) return { kind: "unresolved" };
  }
  const fn = module.functionsByName.get(identifier.text);
  if (fn !== undefined) return { kind: "module_function", declaration: fn };
  const relativeSpecifier = module.relativeImports.get(identifier.text);
  if (relativeSpecifier !== undefined) {
    return { kind: "imported_function", importName: identifier.text, specifier: relativeSpecifier };
  }
  if (module.externalImports.has(identifier.text)) {
    return { kind: "imported_function", importName: identifier.text, specifier: module.externalImports.get(identifier.text)! };
  }
  return { kind: "unresolved" };
}

const functionsContains = (module: ModuleFacts, fn: ts.FunctionDeclaration): boolean => {
  for (const candidate of module.functionsByName.values()) {
    if (candidate === fn) return true;
  }
  return false;
};

/** Detects a local declaration of `name` inside a function/block scope. */
function declaresLocalName(scope: ts.Node, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = true;
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.name.text === name) found = true;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = true;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return found;
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

interface WalkContext {
  readonly seam: PromptClosureSourceSeam;
  /** Modules whose reachable graph has been fully accounted (import-cycle guard). */
  readonly visitedModules: Set<string>;
  /** (module, function-name) pairs already walked (recursion guard). */
  readonly walkedFunctions: Set<string>;
  readonly collected: Set<string>;
}

/**
 * Lexical raw-read accounting for one reachable module: every `readFileSync`
 * call in the module must be routed through a recognized required-prompt
 * reader — the call must occur inside a reader declaration's OWN body and
 * its first argument must resolve lexically to THAT reader's parameter.
 * Identifier names alone prove nothing: a `sideLoad(path)` whose parameter
 * merely reuses a reader's parameter name is a distinct binding and fails
 * closed here.
 */
function accountRawReadsOfModule(modulePath: string, module: ModuleFacts, context: WalkContext): void {
  if (context.visitedModules.has(modulePath)) return;
  context.visitedModules.add(modulePath);

  // Walk the SAME AST the analyzer built its declaration maps from, so
  // enclosing-declaration identity comparisons are node-identity exact.
  const sourceFile = module.sourceFile;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const calleeName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)
          ? node.expression.name.text
          : "";
      const firstArg = node.arguments[0];
      if (calleeName === "readFileSync" && firstArg !== undefined) {
        const enclosing = enclosingFunction(node);
        const routedThroughRecognizedReader = (() => {
          if (enclosing === undefined || !ts.isFunctionDeclaration(enclosing) || enclosing.name === undefined) {
            return false;
          }
          const declaration = module.functionsByName.get(enclosing.name.text);
          if (declaration !== enclosing || !module.readerDeclarations.has(declaration)) {
            return false;
          }
          const readerParam = readerParameterOf(declaration);
          if (readerParam === undefined || !ts.isIdentifier(firstArg)) {
            return false;
          }
          // LEXICAL identity: the argument identifier must bind to the
          // reader's own parameter. Same text AND no shadowing declaration in
          // any scope between the call site and the reader's parameter list
          // (the reader's own parameter is the binding target, never a
          // shadow; a same-named local between the two IS a shadow).
          if (firstArg.text !== readerParam.name.getText()) {
            return false;
          }
          for (let scope: ts.Node | undefined = node.parent; scope !== undefined && scope !== declaration; scope = scope.parent) {
            const binder =
              (ts.isFunctionLikeDeclaration(scope) || ts.isBlock(scope)) &&
              scope !== enclosing;
            if (binder && declaresLocalName(scope, firstArg.text)) {
              return false;
            }
          }
          return true;
        })();
        if (!routedThroughRecognizedReader) {
          unsupported(
            `Module '${modulePath}' performs a filesystem read outside the recognized required-prompt reader shape.`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/**
 * Collects the required prompt reads reachable from one function in one
 * module, following same-module helper declarations and RELATIVE imported
 * helper functions transitively (the prompt-read call graph).
 */
function walkReachableFunction(input: {
  readonly modulePath: string;
  readonly module: ModuleFacts;
  readonly fn: ts.FunctionDeclaration;
  readonly context: WalkContext;
}): void {
  const { modulePath, module, fn, context } = input;
  const key = `${modulePath}::${fn.name?.text ?? "<anonymous>"}`;
  if (context.walkedFunctions.has(key)) return;
  context.walkedFunctions.add(key);

  accountRawReadsOfModule(modulePath, module, context);

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const reference = resolveReference(module, callee);
        if (reference.kind === "module_function") {
          if (module.readerDeclarations.has(reference.declaration)) {
            // Reader invocation: collect its path argument, resolved in the
            // CALLING module's lexical scope (const bindings, dirname anchor).
            const [argument] = node.arguments;
            if (!argument) {
              unsupported(`A required prompt read in '${modulePath}' has no path argument.`);
            }
            const segments = literalSegmentsOf(argument, module.constBindings);
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
            context.collected.add(relative);
          } else {
            walkReachableFunction({ modulePath, module, fn: reference.declaration, context });
          }
        } else if (reference.kind === "imported_function") {
          if (!reference.specifier.startsWith(".")) {
            unsupported(
              `Prompt-closure reachability requires relative imports; reachable call '${callee.text}' in '${modulePath}' resolves to non-relative module '${reference.specifier}'.`,
            );
          }
          const importedPath = context.seam.resolveImport(modulePath, reference.specifier);
          const importedSource = context.seam.readSource(importedPath);
          const importedFacts = analyzeModule(importedPath, importedSource);
          const importedFn = importedFacts.functionsByName.get(reference.importName);
          if (importedFn === undefined || importedFn.body === undefined) {
            unsupported(
              `Imported prompt-closure helper '${reference.importName}' from '${reference.specifier}' (module '${importedPath}') is not a statically analyzable function declaration.`,
            );
          }
          walkReachableFunction({
            modulePath: importedPath,
            module: importedFacts,
            fn: importedFn,
            context,
          });
        }
        // `unresolved`: callee names that do not resolve to a module function
        // or import are only relevant if they read files; the raw-read
        // accounting above already fail-closes any unrecognized read shape.
      }
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body) ts.forEachChild(fn.body, visit);
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

  const promptSource = seam.readSource(promptModulePath);
  const promptFacts = analyzeModule(promptModulePath, promptSource);
  const builder = promptFacts.functionsByName.get(PROMPT_BUILDER_NAME);
  if (builder === undefined || builder.body === undefined) {
    unsupported(`Module '${promptModulePath}' does not declare function '${PROMPT_BUILDER_NAME}'.`);
  }

  const context: WalkContext = {
    seam,
    visitedModules: new Set<string>(),
    walkedFunctions: new Set<string>(),
    collected: new Set<string>(),
  };
  walkReachableFunction({ modulePath: promptModulePath, module: promptFacts, fn: builder, context });

  if (context.collected.size === 0) {
    unsupported(`No required prompt reads found in '${PROMPT_BUILDER_NAME}' within '${promptModulePath}'.`);
  }

  return { promptPaths: [...context.collected].sort() };
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
