import type { Parser, ParseInput, ParseResult } from "../types";
import { makeId, extractSymbols } from "./code";
import { getLogger } from "../../../lib/logger";

// ============================================================================
// Types
// ============================================================================
interface SymbolNode {
  label: string;
  type: string;
  metadata?: Record<string, unknown>;
}

interface SymbolEdge {
  source: string;
  target: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED";
}

interface LanguageConfig {
  name: string;
  wasmPath: string;
  extensions: string[];
  classTypes: string[];
  functionTypes: string[];
  importTypes: string[];
  nameField: string;
}

interface ExtractionState {
  nodes: SymbolNode[];
  edges: SymbolEdge[];
  definedNames: Set<string>;
  fileNodeId: string;
  sourceFile: string;
  fileName: string;
}

// ============================================================================
// Tree-sitter Query Patterns
// ============================================================================
export const TS_QUERIES: Record<string, string> = {
  class: "(class_declaration name: (identifier) @name) @class",
  function: "(function_declaration name: (identifier) @name) @func",
  arrow:
    "(variable_declarator name: (identifier) @name value: (arrow_function) @func)",
  method:
    "(method_definition name: (property_identifier) @name) @method",
  interface:
    "(interface_declaration name: (type_identifier) @name) @interface",
  import_: "(import_statement source: (string) @module) @import",
  export_:
    "(export_statement (function_declaration name: (identifier) @name)) @export_func",
  call: "(call_expression function: (identifier) @name) @call",
};

export const PYTHON_QUERIES: Record<string, string> = {
  class: "(class_definition name: (identifier) @name) @class",
  function:
    "(function_definition name: (identifier) @name) @func",
  import_: "(import_statement) @import",
  import_from: "(import_from_statement) @import_from",
  call: "(call function: (identifier) @name) @call",
};

export const GO_QUERIES: Record<string, string> = {
  function:
    "(function_declaration name: (identifier) @name) @func",
  type: "(type_declaration (type_spec name: (type_identifier) @name)) @type",
  import_: "(import_declaration) @import",
  call: "(call_expression function: (identifier) @name) @call",
};

export const JAVA_QUERIES: Record<string, string> = {
  class: "(class_declaration name: (identifier) @name) @class",
  method:
    "(method_declaration name: (identifier) @name) @method",
  interface:
    "(interface_declaration name: (identifier) @name) @interface",
  import_: "(import_declaration) @import",
  call: "(method_invocation name: (identifier) @name) @call",
};

const QUERY_MAP: Record<string, Record<string, string>> = {
  typescript: TS_QUERIES,
  tsx: TS_QUERIES,
  javascript: TS_QUERIES,
  python: PYTHON_QUERIES,
  go: GO_QUERIES,
  java: JAVA_QUERIES,
};

// ============================================================================
// Language Configurations
// ============================================================================
export const languageConfigs: LanguageConfig[] = [
  {
    name: "typescript",
    wasmPath: "tree-sitter-typescript.wasm",
    extensions: ["ts", "mts"],
    classTypes: ["class", "interface", "method"],
    functionTypes: ["function", "method"],
    importTypes: ["import"],
    nameField: "name",
  },
  {
    name: "tsx",
    wasmPath: "tree-sitter-tsx.wasm",
    extensions: ["tsx"],
    classTypes: ["class", "interface", "method"],
    functionTypes: ["function", "method"],
    importTypes: ["import"],
    nameField: "name",
  },
  {
    name: "javascript",
    wasmPath: "tree-sitter-javascript.wasm",
    extensions: ["js", "jsx", "mjs", "cjs"],
    classTypes: ["class", "interface", "method"],
    functionTypes: ["function", "method"],
    importTypes: ["import"],
    nameField: "name",
  },
  {
    name: "python",
    wasmPath: "tree-sitter-python.wasm",
    extensions: ["py", "pyi", "pyx"],
    classTypes: ["class"],
    functionTypes: ["function"],
    importTypes: ["import", "import_from"],
    nameField: "name",
  },
  {
    name: "go",
    wasmPath: "tree-sitter-go.wasm",
    extensions: ["go"],
    classTypes: ["type"],
    functionTypes: ["function"],
    importTypes: ["import"],
    nameField: "name",
  },
  {
    name: "java",
    wasmPath: "tree-sitter-java.wasm",
    extensions: ["java"],
    classTypes: ["class", "interface"],
    functionTypes: ["function", "method"],
    importTypes: ["import"],
    nameField: "name",
  },
];

// Map extension to config for fast lookup
const extensionToConfig: Map<string, LanguageConfig> = new Map();
for (const config of languageConfigs) {
  for (const ext of config.extensions) {
    extensionToConfig.set(ext, config);
  }
}

// ============================================================================
// Module State
// ============================================================================
let treeSitterInitialized = false;
let treeSitterInitFailed = false;
let treeSitterModule: Record<string, unknown> | null = null;
const languageCache: Map<string, unknown> = new Map();
let wasmDirPath: string | null = null;

const logger = getLogger();

// ============================================================================
// Path Resolution
// ============================================================================
function resolveWasmDir(): string {
  if (wasmDirPath) {
    return wasmDirPath;
  }
  // Try import.meta.url path resolution (works in ESM / vitest)
  if (typeof import.meta !== "undefined" && import.meta.url) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fileURLToPath } = require("node:url");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dirname, join } = require("node:path");
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      wasmDirPath = join(moduleDir, "wasm");
      return wasmDirPath as string;
    } catch {
      // Fall through to cwd-based fallback
    }
  }
  // Fallback: resolve relative to current working directory
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path");
    wasmDirPath = join(process.cwd(), "src", "core", "pipeline", "parsers", "wasm");
    return wasmDirPath as string;
  } catch {
    wasmDirPath = "";
    return "";
  }
}

// ============================================================================
// getLanguageConfig
// ============================================================================
export function getLanguageConfig(
  filePath: string,
): LanguageConfig | undefined {
  const dotIndex = filePath.lastIndexOf(".");
  if (dotIndex < 0) {
    return undefined;
  }
  const ext = filePath.slice(dotIndex + 1).toLowerCase();
  if (ext === "") {
    return undefined;
  }
  return extensionToConfig.get(ext);
}

// ============================================================================
// isTreeSitterReady
// ============================================================================
export function isTreeSitterReady(): boolean {
  return treeSitterInitialized && treeSitterModule !== null;
}

// ============================================================================
// initTreeSitter
// ============================================================================
export async function initTreeSitter(): Promise<void> {
  if (treeSitterInitialized || treeSitterInitFailed) {
    return;
  }

  try {
    const ParserModule = await import("web-tree-sitter");
    treeSitterModule = ParserModule as unknown as Record<string, unknown>;

    // web-tree-sitter exports both a default and named exports.
    // The default export is the Parser class with init().
    // In test mocks, the mock object itself may be flat (no .default).
    const mod = treeSitterModule as Record<string, unknown>;
    const Parser = (
      (mod.default as Record<string, unknown> | undefined) ?? mod
    ) as {
      init: () => Promise<void>;
      Language: {
        load: (bytes: Uint8Array) => Promise<unknown>;
      };
    };

    await Parser.init();

    treeSitterInitialized = true;
    logger.info("tree-sitter initialized", { wasmDir: resolveWasmDir() });
  } catch (err) {
    logger.warn("tree-sitter initialization failed, will use regex fallback", {
      error: String(err),
    });
    treeSitterModule = null;
    treeSitterInitialized = false;
    treeSitterInitFailed = true;
  }
}

// ============================================================================
// loadLanguageWasm
// ============================================================================
async function loadLanguageWasm(
  wasmPath: string,
): Promise<unknown | null> {
  if (languageCache.has(wasmPath)) {
    return languageCache.get(wasmPath) ?? null;
  }

  if (!treeSitterModule || !treeSitterInitialized) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFile } = require("node:fs/promises");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path");
    const fullPath = join(resolveWasmDir(), wasmPath);
    const bytes = await readFile(fullPath);

    const Language = (
      (treeSitterModule as Record<string, unknown>).Language ??
      ((treeSitterModule as Record<string, unknown>).default as Record<string, unknown> | undefined)
        ?.Language
    ) as {
      load: (bytes: Uint8Array) => Promise<unknown>;
    };

    const lang = await Language.load(bytes);
    languageCache.set(wasmPath, lang);
    logger.info("tree-sitter language loaded", { wasmPath });
    return lang;
  } catch (err) {
    logger.warn("Failed to load tree-sitter language WASM", {
      wasmPath,
      error: String(err),
    });
    languageCache.set(wasmPath, null);
    return null;
  }
}

// ============================================================================
// ensureLanguage
// ============================================================================
async function ensureLanguage(config: LanguageConfig): Promise<unknown | null> {
  return loadLanguageWasm(config.wasmPath);
}

// ============================================================================
// extractNodesFromQuery
// ============================================================================
function extractNodesFromQuery(
  tree: { rootNode: { descendantForIndex: (idx: number) => unknown } },
  query: unknown,
  state: ExtractionState,
  nodeType: string,
): void {
  const q = query as {
    matches: (
      node: unknown,
    ) => Array<{
      captures: Array<{ name: string; node: { text: string; startPosition: { row: number } } }>;
    }>;
  };

  const matches = q.matches((tree as { rootNode: unknown }).rootNode);

  for (const match of matches) {
    const nameCapture = match.captures.find((c) => c.name === "name");
    if (!nameCapture) {
      continue;
    }

    const name = nameCapture.node.text.trim();
    if (name.length === 0 || state.definedNames.has(name)) {
      continue;
    }

    state.nodes.push({ label: name, type: nodeType });
    state.definedNames.add(name);

    // Add contains edge
    state.edges.push({
      source: state.fileNodeId,
      target: name,
      relation: "contains",
      confidence: "EXTRACTED",
    });
  }
}

// ============================================================================
// extractImportsFromQuery
// ============================================================================
function extractImportsFromQuery(
  tree: { rootNode: { descendantForIndex: (idx: number) => unknown } },
  query: unknown,
  state: ExtractionState,
): void {
  const q = query as {
    matches: (
      node: unknown,
    ) => Array<{
      captures: Array<{ name: string; node: { text: string } }>;
    }>;
  };

  const matches = q.matches((tree as { rootNode: unknown }).rootNode);

  for (const match of matches) {
    const moduleCapture = match.captures.find((c) => c.name === "module");
    if (!moduleCapture) {
      continue;
    }

    // Strip quotes from strings like '"react"' or "'express'"
    const moduleName = moduleCapture.node.text.replace(/^['"]|['"]$/g, "").trim();
    if (moduleName.length === 0) {
      continue;
    }

    state.edges.push({
      source: state.fileNodeId,
      target: moduleName,
      relation: "imports",
      confidence: "EXTRACTED",
    });
  }
}

// ============================================================================
// extractCallsFromQuery
// ============================================================================
function extractCallsFromQuery(
  tree: { rootNode: { descendantForIndex: (idx: number) => unknown } },
  query: unknown,
  state: ExtractionState,
): void {
  const q = query as {
    matches: (
      node: unknown,
    ) => Array<{
      captures: Array<{ name: string; node: { text: string } }>;
    }>;
  };

  const matches = q.matches((tree as { rootNode: unknown }).rootNode);

  for (const match of matches) {
    const nameCapture = match.captures.find((c) => c.name === "name");
    if (!nameCapture) {
      continue;
    }

    const calledName = nameCapture.node.text.trim();
    if (
      calledName.length === 0 ||
      !state.definedNames.has(calledName)
    ) {
      continue;
    }

    state.edges.push({
      source: state.fileNodeId,
      target: calledName,
      relation: "calls",
      confidence: "INFERRED",
    });
  }
}

// ============================================================================
// extractSymbolsTreeSitter
// ============================================================================
async function extractSymbolsTreeSitter(
  content: string,
  config: LanguageConfig,
  filePath: string,
): Promise<{ nodes: SymbolNode[]; edges: SymbolEdge[] }> {
  const lang = await ensureLanguage(config);
  if (!lang || !treeSitterModule) {
    logger.warn("tree-sitter language not available, falling back", {
      language: config.name,
    });
    return extractSymbols(content, config.name, filePath);
  }

  try {
    const ParserCtor = (
      (treeSitterModule as Record<string, unknown>).default ??
      treeSitterModule
    ) as {
      new (): unknown;
    };
    const parser = new ParserCtor() as {
      setLanguage: (lang: unknown) => void;
      parse: (code: string) => {
        rootNode: { descendantForIndex: (idx: number) => unknown };
      };
      getLanguage: () => unknown;
    };

    parser.setLanguage(lang);
    const tree = parser.parse(content);

    const sourceFile = filePath || "unknown";
    const fileName = sourceFile.replace(/^.*[\\/]/, "");
    const fileNodeId = makeId("file", sourceFile);

    const state: ExtractionState = {
      nodes: [
        { label: fileName, type: "file", metadata: { filePath: sourceFile } },
      ],
      edges: [],
      definedNames: new Set<string>(),
      fileNodeId,
      sourceFile,
      fileName,
    };

    const queries = QUERY_MAP[config.name];
    if (queries) {
      const LangObj = lang as {
        query: (source: string) => unknown;
      };

      // Extract classes
      if (queries.class) {
        try {
          const q = LangObj.query(queries.class);
          extractNodesFromQuery(tree, q, state, "class");
        } catch {
          // Query not supported by this language
        }
      }

      // Extract functions
      if (queries.function) {
        try {
          const q = LangObj.query(queries.function);
          extractNodesFromQuery(tree, q, state, "function");
        } catch {
          // Query not supported
        }
      }

      // Extract methods (nested in classes)
      if (queries.method) {
        try {
          const q = LangObj.query(queries.method);
          const qTyped = q as {
            matches: (
              node: unknown,
            ) => Array<{
              captures: Array<{
                name: string;
                node: { text: string };
              }>;
            }>;
          };
          const matches = qTyped.matches(tree.rootNode);
          for (const match of matches) {
            const nameCapture = match.captures.find((c) => c.name === "name");
            if (!nameCapture) {
              continue;
            }
            const name = nameCapture.node.text.trim();
            if (name.length === 0 || state.definedNames.has(name)) {
              continue;
            }
            state.nodes.push({ label: name, type: "function" });
            state.definedNames.add(name);
            // Method belongs to last class in classStack would need context,
            // but for simplicity we attach to file node here
            state.edges.push({
              source: state.fileNodeId,
              target: name,
              relation: "contains",
              confidence: "EXTRACTED",
            });
          }
        } catch {
          // Query not supported
        }
      }

      // Extract imports
      if (queries.import_) {
        try {
          const q = LangObj.query(queries.import_);
          extractImportsFromQuery(tree, q, state);
        } catch {
          // Query not supported
        }
      }

      // Extract calls
      if (queries.call) {
        try {
          const q = LangObj.query(queries.call);
          extractCallsFromQuery(tree, q, state);
        } catch {
          // Query not supported
        }
      }
    }

    return { nodes: state.nodes, edges: state.edges };
  } catch (err) {
    logger.warn("tree-sitter extraction failed, falling back to regex", {
      language: config.name,
      error: String(err),
    });
    return extractSymbols(content, config.name, filePath);
  }
}

// ============================================================================
// createTreeSitterParser
// ============================================================================
export function createTreeSitterParser(): Parser {
  return {
    name: "code-tree-sitter",
    supportedTypes: ["code", ...Array.from(extensionToConfig.keys())],

    async parse(input: ParseInput): Promise<ParseResult> {
      const filePath = input.filePath || "unknown";
      const config = getLanguageConfig(filePath);

      if (!config) {
        // Unknown language — return minimal parse result
        return {
          text: input.content,
          chunks: [
            {
              chunkIndex: 0,
              content: input.content,
              nodes: [],
              edges: [],
            },
          ],
        };
      }

      // Try tree-sitter first
      if (treeSitterInitialized && treeSitterModule) {
        try {
          const { nodes, edges } = await extractSymbolsTreeSitter(
            input.content,
            config,
            filePath,
          );
          return {
            text: input.content,
            chunks: [
              {
                chunkIndex: 0,
                content: input.content,
                nodes,
                edges,
              },
            ],
          };
        } catch (err) {
          logger.warn("tree-sitter parse failed, falling back to regex", {
            filePath,
            error: String(err),
          });
        }
      }

      // Fallback to regex parser
      const { nodes, edges } = extractSymbols(
        input.content,
        config.name,
        filePath,
      );

      return {
        text: input.content,
        chunks: [
          {
            chunkIndex: 0,
            content: input.content,
            nodes,
            edges,
          },
        ],
      };
    },
  };
}
