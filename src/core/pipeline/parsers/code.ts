import type { Parser, ParseInput, ParseResult } from '../types';
import {
  TS_JS_FUNC_PATTERNS,
  TS_JS_ARROW_PATTERNS,
  TS_JS_CLASS_PATTERNS,
  TS_JS_METHOD_PATTERN,
  TS_JS_IMPORT_PATTERNS,
  TS_JS_INTERFACE_PATTERNS,
  TS_JS_TYPE_ALIAS_PATTERN,
  TS_JS_ENUM_PATTERN,
  GO_FUNC_PATTERNS,
  GO_STRUCT_PATTERN,
  GO_INTERFACE_PATTERN,
  GO_IMPORT_PATTERNS,
  RUST_FUNC_PATTERNS,
  RUST_STRUCT_PATTERN,
  RUST_ENUM_PATTERN,
  RUST_TRAIT_PATTERN,
  RUST_IMPL_PATTERN,
  RUST_IMPORT_PATTERNS,
  JAVA_CLASS_PATTERNS,
  JAVA_INTERFACE_PATTERNS,
  JAVA_METHOD_PATTERN,
  JAVA_IMPORT_PATTERNS,
  C_FUNC_PATTERNS,
  C_CLASS_PATTERNS,
  C_INCLUDE_PATTERNS,
  C_TYPEDEF_PATTERNS,
} from './code-patterns';

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
  confidence: 'EXTRACTED' | 'INFERRED';
}

interface BlockContext {
  name: string;
  depth: number;
  type: 'class' | 'interface' | 'struct' | 'impl';
}

interface ExtractionContext {
  depth: number;
  classStack: BlockContext[];
  nodes: SymbolNode[];
  edges: SymbolEdge[];
  definedSymbols: Set<string>;
  fileNodeId: string;
  sourceFile: string;
}

interface PythonContext {
  nodes: SymbolNode[];
  edges: SymbolEdge[];
  definedSymbols: Set<string>;
  fileNodeId: string;
  sourceFile: string;
}

// ============================================================================
// Constants
// ============================================================================
const NON_FUNC_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch',
  'return', 'throw', 'delete', 'typeof', 'instanceof',
  'import', 'export', 'class', 'interface', 'enum', 'type',
  'const', 'let', 'var', 'function', 'void', 'true', 'false',
  'null', 'undefined', 'this', 'super', 'yield', 'try',
  'break', 'continue', 'finally', 'default', 'extends',
  'implements', 'public', 'private', 'protected', 'static',
  'abstract', 'async', 'get', 'set', 'readonly', 'package',
  'from', 'as', 'in', 'of', 'with', 'goto',
]);

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  pyx: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
};

function isNotKeyword(name: string): boolean {
  return !NON_FUNC_KEYWORDS.has(name);
}

// ============================================================================
// makeId
// ============================================================================
export function makeId(...parts: string[]): string {
  const joined = parts.join('_');
  const normalized = joined.trim().toLowerCase().normalize('NFKC');
  const replaced = normalized.replace(/[^\p{L}\p{N}]+/gu, '_');
  const collapsed = replaced.replace(/__+/g, '_');
  return collapsed.replace(/^_|_$/g, '');
}

// ============================================================================
// detectLanguage
// ============================================================================
export function detectLanguage(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex < 0) {
    return 'unknown';
  }
  const ext = filePath.slice(dotIndex + 1).toLowerCase();
  if (ext === '') {
    return 'unknown';
  }
  return LANGUAGE_EXTENSIONS[ext] || 'unknown';
}



function addContainsEdges(ctx: ExtractionContext, name: string, depth: number): void {
  if (ctx.classStack.length > 0) {
    const parent = ctx.classStack[ctx.classStack.length - 1];
    if (depth > parent.depth) {
      ctx.edges.push({
        source: parent.name,
        target: name,
        relation: 'contains',
        confidence: 'EXTRACTED',
      });
      return;
    }
  }
  ctx.edges.push({
    source: ctx.fileNodeId,
    target: name,
    relation: 'contains',
    confidence: 'EXTRACTED',
  });
}

function addInheritsEdge(ctx: ExtractionContext, child: string, parent: string): void {
  ctx.edges.push({
    source: child,
    target: parent,
    relation: 'inherits',
    confidence: 'EXTRACTED',
  });
  if (!ctx.definedSymbols.has(parent)) {
    ctx.nodes.push({ label: parent, type: 'stub' });
    ctx.definedSymbols.add(parent);
  }
}

function addImportEdge(ctx: ExtractionContext, target: string): void {
  ctx.edges.push({
    source: ctx.fileNodeId,
    target,
    relation: 'imports',
    confidence: 'EXTRACTED',
  });
}

function updateBraceDepth(
  line: string,
  classStack: { name: string; depth: number }[],
  currentDepth: number,
): number {
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;
  const newDepth = currentDepth + opens - closes;
  while (classStack.length > 0 && newDepth <= classStack[classStack.length - 1].depth) {
    classStack.pop();
  }
  return newDepth;
}

// ============================================================================
// Process Python (indentation-based)
// ============================================================================
function processPython(
  lines: string[],
  pyCtx: PythonContext,
): void {
  const classStack: { name: string; indent: number }[] = [];

  for (const line of lines) {
    const stripped = line.trimStart();
    if (stripped.length === 0 || stripped.startsWith('#')) {
      continue;
    }
    const indent = line.length - stripped.length;

    // Pop classes when indent drops
    while (classStack.length > 0 && indent <= classStack[classStack.length - 1].indent) {
      classStack.pop();
    }

    // Class definition
    {
      const classMatch = stripped.match(/class\s+(\w+)\s*(?:\(([^)]*)\))?\s*:/);
      if (classMatch && !pyCtx.definedSymbols.has(classMatch[1])) {
        pyCtx.nodes.push({ label: classMatch[1], type: 'class' });
        pyCtx.definedSymbols.add(classMatch[1]);
        classStack.push({ name: classMatch[1], indent });
        addPyTopLevelEdge(pyCtx, classMatch[1], classStack);
        // Extract single base class for inherits edge (first word in parens)
        if (classMatch[2]) {
          const baseMatch = classMatch[2].trim().match(/^(\w+)/);
          if (baseMatch) {
            const baseClass = baseMatch[1];
            pyCtx.edges.push({
              source: classMatch[1],
              target: baseClass,
              relation: 'inherits',
              confidence: 'EXTRACTED',
            });
            if (!pyCtx.definedSymbols.has(baseClass)) {
              pyCtx.nodes.push({ label: baseClass, type: 'stub' });
              pyCtx.definedSymbols.add(baseClass);
            }
          }
        }
        continue;
      }
    }

    // Function definition
    {
      const funcMatch = stripped.match(/(?:async\s+)?def\s+(\w+)\s*\(/);
      if (funcMatch && isNotKeyword(funcMatch[1]) && !pyCtx.definedSymbols.has(funcMatch[1])) {
        pyCtx.nodes.push({ label: funcMatch[1], type: 'function' });
        pyCtx.definedSymbols.add(funcMatch[1]);
        if (classStack.length > 0 && indent > classStack[classStack.length - 1].indent) {
          pyCtx.edges.push({
            source: classStack[classStack.length - 1].name,
            target: funcMatch[1],
            relation: 'contains',
            confidence: 'EXTRACTED',
          });
        } else {
          pyCtx.edges.push({
            source: pyCtx.fileNodeId,
            target: funcMatch[1],
            relation: 'contains',
            confidence: 'EXTRACTED',
          });
        }
        continue;
      }
    }

    // Import statements
    {
      const fromMatch = stripped.match(/from\s+([^\s]+)\s+import\s+/);
      if (fromMatch) {
        pyCtx.edges.push({
          source: pyCtx.fileNodeId,
          target: fromMatch[1],
          relation: 'imports',
          confidence: 'EXTRACTED',
        });
        continue;
      }
      const importMatch = stripped.match(/^import\s+([^\s]+)/);
      if (importMatch) {
        pyCtx.edges.push({
          source: pyCtx.fileNodeId,
          target: importMatch[1],
          relation: 'imports',
          confidence: 'EXTRACTED',
        });
        continue;
      }
    }
  }
}

function addPyTopLevelEdge(
  pyCtx: PythonContext,
  name: string,
  classStack: { name: string; indent: number }[],
): void {
  if (classStack.length > 1) {
    // Nested class
    const parent = classStack[classStack.length - 2];
    pyCtx.edges.push({
      source: parent.name,
      target: name,
      relation: 'contains',
      confidence: 'EXTRACTED',
    });
  } else {
    pyCtx.edges.push({
      source: pyCtx.fileNodeId,
      target: name,
      relation: 'contains',
      confidence: 'EXTRACTED',
    });
  }
}

// ============================================================================
// Process Rust (special handling for impl blocks)
// ============================================================================
function processRust(
  lines: string[],
  rsCtx: ExtractionContext,
): void {
  let currentDepth = 0;

  for (const line of lines) {
    const stripped = line.trimStart();

    // --- Functions ---
    for (const pat of RUST_FUNC_PATTERNS) {
      const m = line.match(pat);
      if (m && isNotKeyword(m[1]) && !rsCtx.definedSymbols.has(m[1])) {
        rsCtx.nodes.push({ label: m[1], type: 'function' });
        rsCtx.definedSymbols.add(m[1]);
        addContainsEdges(rsCtx, m[1], currentDepth);
      }
    }

    // --- Struct ---
    {
      const m = line.match(RUST_STRUCT_PATTERN);
      if (m && !rsCtx.definedSymbols.has(m[1])) {
        rsCtx.nodes.push({ label: m[1], type: 'struct' });
        rsCtx.definedSymbols.add(m[1]);
        addContainsEdges(rsCtx, m[1], currentDepth);
        rsCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'struct' });
      }
    }

    // --- Enum ---
    {
      const m = line.match(RUST_ENUM_PATTERN);
      if (m && !rsCtx.definedSymbols.has(m[1])) {
        rsCtx.nodes.push({ label: m[1], type: 'enum' });
        rsCtx.definedSymbols.add(m[1]);
        addContainsEdges(rsCtx, m[1], currentDepth);
        rsCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'enum' });
      }
    }

    // --- Trait ---
    {
      const m = line.match(RUST_TRAIT_PATTERN);
      if (m && !rsCtx.definedSymbols.has(m[1])) {
        rsCtx.nodes.push({ label: m[1], type: 'trait' });
        rsCtx.definedSymbols.add(m[1]);
        addContainsEdges(rsCtx, m[1], currentDepth);
        rsCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'trait' });
      }
    }

    // --- Impl ---
    {
      const m = line.match(RUST_IMPL_PATTERN);
      if (m && !rsCtx.definedSymbols.has(m[1])) {
        rsCtx.nodes.push({ label: m[1], type: 'impl' });
        rsCtx.definedSymbols.add(m[1]);
        addContainsEdges(rsCtx, m[1], currentDepth);
        rsCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'impl' });
      }
    }

    // --- Import (use) ---
    for (const pat of RUST_IMPORT_PATTERNS) {
      const m = line.match(pat);
      if (m) {
        addImportEdge(rsCtx, m[1].trim());
      }
    }

    currentDepth = updateBraceDepth(line, rsCtx.classStack, currentDepth);
  }
}

// ============================================================================
// Process Go
// ============================================================================
function processGo(
  lines: string[],
  goCtx: ExtractionContext,
): void {
  let currentDepth = 0;

  for (const line of lines) {
    // --- Functions ---
    for (const pat of GO_FUNC_PATTERNS) {
      const m = line.match(pat);
      if (m && isNotKeyword(m[1]) && !goCtx.definedSymbols.has(m[1])) {
        goCtx.nodes.push({ label: m[1], type: 'function' });
        goCtx.definedSymbols.add(m[1]);
        addContainsEdges(goCtx, m[1], currentDepth);
      }
    }

    // --- Struct ---
    {
      const m = line.match(GO_STRUCT_PATTERN);
      if (m && !goCtx.definedSymbols.has(m[1])) {
        goCtx.nodes.push({ label: m[1], type: 'struct' });
        goCtx.definedSymbols.add(m[1]);
        addContainsEdges(goCtx, m[1], currentDepth);
      }
    }

    // --- Interface ---
    {
      const m = line.match(GO_INTERFACE_PATTERN);
      if (m && !goCtx.definedSymbols.has(m[1])) {
        goCtx.nodes.push({ label: m[1], type: 'interface' });
        goCtx.definedSymbols.add(m[1]);
        addContainsEdges(goCtx, m[1], currentDepth);
      }
    }

    // --- Imports ---
    for (const pat of GO_IMPORT_PATTERNS) {
      const m = line.match(pat);
      if (m) {
        addImportEdge(goCtx, m[1]);
      }
    }

    currentDepth = updateBraceDepth(line, [], currentDepth);
  }
}

// ============================================================================
// Process Java
// ============================================================================
function processJava(
  lines: string[],
  javaCtx: ExtractionContext,
): void {
  let currentDepth = 0;

  for (const line of lines) {
    // --- Classes ---
    for (const pat of JAVA_CLASS_PATTERNS) {
      const m = line.match(pat);
      if (m && !javaCtx.definedSymbols.has(m[1])) {
        javaCtx.nodes.push({ label: m[1], type: 'class' });
        javaCtx.definedSymbols.add(m[1]);
        addContainsEdges(javaCtx, m[1], currentDepth);
        javaCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'class' });
        if (m[2]) {
          addInheritsEdge(javaCtx, m[1], m[2]);
        }
      }
    }

    // --- Interfaces ---
    for (const pat of JAVA_INTERFACE_PATTERNS) {
      const m = line.match(pat);
      if (m && !javaCtx.definedSymbols.has(m[1])) {
        javaCtx.nodes.push({ label: m[1], type: 'interface' });
        javaCtx.definedSymbols.add(m[1]);
        addContainsEdges(javaCtx, m[1], currentDepth);
        javaCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'interface' });
        if (m[2]) {
          addInheritsEdge(javaCtx, m[1], m[2]);
        }
      }
    }

    // --- Methods inside classes ---
    if (javaCtx.classStack.length > 0) {
      const m = line.match(JAVA_METHOD_PATTERN);
      // Note: definedSymbols check is skipped for methods to allow
      // constructors (same name as class) and overloaded methods
      if (m && isNotKeyword(m[1])) {
        javaCtx.nodes.push({ label: m[1], type: 'function' });
        javaCtx.definedSymbols.add(m[1]);
        const parent = javaCtx.classStack[javaCtx.classStack.length - 1];
        javaCtx.edges.push({
          source: parent.name,
          target: m[1],
          relation: 'contains',
          confidence: 'EXTRACTED',
        });
      }
    }

    // --- Imports ---
    for (const pat of JAVA_IMPORT_PATTERNS) {
      const m = line.match(pat);
      if (m) {
        addImportEdge(javaCtx, m[1]);
      }
    }

    currentDepth = updateBraceDepth(line, javaCtx.classStack, currentDepth);
  }
}

// ============================================================================
// Process C / C++
// ============================================================================
function processC(
  lines: string[],
  cCtx: ExtractionContext,
): void {
  let currentDepth = 0;
  // Track whether we are inside a typedef struct/enum/union body
  // so we can extract the alias name from the closing line: } Name;
  let inTypedefStruct = false;

  for (const line of lines) {
    // --- Functions ---
    for (const pat of C_FUNC_PATTERNS) {
      const m = line.match(pat);
      if (m && isNotKeyword(m[1]) && !cCtx.definedSymbols.has(m[1])) {
        cCtx.nodes.push({ label: m[1], type: 'function' });
        cCtx.definedSymbols.add(m[1]);
        addContainsEdges(cCtx, m[1], currentDepth);
      }
    }

    // --- Classes/Structs ---
    for (const pat of C_CLASS_PATTERNS) {
      const m = line.match(pat);
      if (m && !cCtx.definedSymbols.has(m[1])) {
        const isStruct = m[0].includes('struct') && !m[0].includes('class');
        const nodeType = isStruct ? 'struct' : 'class';
        cCtx.nodes.push({ label: m[1], type: nodeType });
        cCtx.definedSymbols.add(m[1]);
        addContainsEdges(cCtx, m[1], currentDepth);
        cCtx.classStack.push({ name: m[1], depth: currentDepth, type: 'class' });
        if (m[2]) {
          addInheritsEdge(cCtx, m[1], m[2]);
        }
      }
    }

    // --- Detect typedef struct/enum/union start ---
    {
      const typedefStart = line.match(/typedef\s+(?:struct|enum|union)\b/);
      if (typedefStart && line.includes('{')) {
        inTypedefStruct = true;
      }
    }

    // --- Extract typedef alias from closing line ---
    if (inTypedefStruct) {
      const closingMatch = line.match(/^\}\s*(\w+)\s*;/);
      if (closingMatch && !cCtx.definedSymbols.has(closingMatch[1])) {
        const typeName = closingMatch[1];
        cCtx.nodes.push({ label: typeName, type: 'struct' });
        cCtx.definedSymbols.add(typeName);
        addContainsEdges(cCtx, typeName, currentDepth);
        inTypedefStruct = false;
      }
    }

    // --- Typedefs (single-line) ---
    for (const pat of C_TYPEDEF_PATTERNS) {
      const m = line.match(pat);
      if (m && !cCtx.definedSymbols.has(m[1])) {
        // Typedef structs get 'struct' type since they define a struct type
        const typeName = m[1];
        cCtx.nodes.push({ label: typeName, type: 'struct' });
        cCtx.definedSymbols.add(typeName);
        addContainsEdges(cCtx, typeName, currentDepth);
        inTypedefStruct = false;
      }
    }

    currentDepth = updateBraceDepth(line, cCtx.classStack, currentDepth);
  }
}

// ============================================================================
// extractSymbols
// ============================================================================
export function extractSymbols(
  content: string,
  language: string,
  filePath?: string,
): { nodes: SymbolNode[]; edges: SymbolEdge[] } {
  const sourceFile = filePath || 'unknown';
  const fileNodeId = makeId('file', sourceFile);
  const fileName = sourceFile.replace(/^.*[\\/]/, '');
  const nodes: SymbolNode[] = [
    { label: fileName, type: 'file', metadata: { filePath: sourceFile } },
  ];

  const definedSymbols = new Set<string>();

  const lines = content.split('\n');

  if (language === 'python') {
    const pyCtx: PythonContext = {
      nodes,
      edges: [],
      definedSymbols,
      fileNodeId,
      sourceFile,
    };
    processPython(lines, pyCtx);
    return { nodes: pyCtx.nodes, edges: pyCtx.edges };
  }

  if (language === 'rust') {
    const rsCtx: ExtractionContext = {
      depth: 0,
      classStack: [],
      nodes,
      edges: [],
      definedSymbols,
      fileNodeId,
      sourceFile,
    };
    processRust(lines, rsCtx);
    return { nodes: rsCtx.nodes, edges: rsCtx.edges };
  }

  if (language === 'go') {
    const goCtx: ExtractionContext = {
      depth: 0,
      classStack: [],
      nodes,
      edges: [],
      definedSymbols,
      fileNodeId,
      sourceFile,
    };
    processGo(lines, goCtx);
    return { nodes: goCtx.nodes, edges: goCtx.edges };
  }

  if (language === 'java') {
    const javaCtx: ExtractionContext = {
      depth: 0,
      classStack: [],
      nodes,
      edges: [],
      definedSymbols,
      fileNodeId,
      sourceFile,
    };
    processJava(lines, javaCtx);
    return { nodes: javaCtx.nodes, edges: javaCtx.edges };
  }

  if (language === 'c' || language === 'cpp') {
    const cCtx: ExtractionContext = {
      depth: 0,
      classStack: [],
      nodes,
      edges: [],
      definedSymbols,
      fileNodeId,
      sourceFile,
    };
    processC(lines, cCtx);
    return { nodes: cCtx.nodes, edges: cCtx.edges };
  }

  // TypeScript / JavaScript (default for curly-brace languages)
  const tsCtx: ExtractionContext = {
    depth: 0,
    classStack: [],
    nodes,
    edges: [],
    definedSymbols,
    fileNodeId,
    sourceFile,
  };
  processTSJS(lines, tsCtx);
  return { nodes: tsCtx.nodes, edges: tsCtx.edges };
}

// ============================================================================
// Process TypeScript / JavaScript
// ============================================================================
function processTSJS(
  lines: string[],
  ctx: ExtractionContext,
): void {
  let currentDepth = 0;

  for (const line of lines) {
    // --- Functions ---
    for (const pat of TS_JS_FUNC_PATTERNS) {
      const m = line.match(pat);
      if (m && isNotKeyword(m[1]) && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'function' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
      }
    }

    // --- Arrow functions ---
    for (const pat of TS_JS_ARROW_PATTERNS) {
      const m = line.match(pat);
      if (m && isNotKeyword(m[1]) && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'function' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
      }
    }

    // --- Classes ---
    for (const pat of TS_JS_CLASS_PATTERNS) {
      const m = line.match(pat);
      if (m && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'class' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
        ctx.classStack.push({ name: m[1], depth: currentDepth, type: 'class' });
        if (m[2]) {
          addInheritsEdge(ctx, m[1], m[2]);
        }
      }
    }

    // --- Interfaces ---
    for (const pat of TS_JS_INTERFACE_PATTERNS) {
      const m = line.match(pat);
      if (m && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'interface' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
        ctx.classStack.push({ name: m[1], depth: currentDepth, type: 'interface' });
        if (m[2]) {
          addInheritsEdge(ctx, m[1], m[2]);
        }
      }
    }

    // --- Type aliases ---
    {
      const m = line.match(TS_JS_TYPE_ALIAS_PATTERN);
      if (m && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'type' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
      }
    }

    // --- Enums ---
    {
      const m = line.match(TS_JS_ENUM_PATTERN);
      if (m && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'enum' });
        ctx.definedSymbols.add(m[1]);
        addContainsEdges(ctx, m[1], currentDepth);
        ctx.classStack.push({ name: m[1], depth: currentDepth, type: 'class' });
      }
    }

    // --- Methods inside classes ---
    if (ctx.classStack.length > 0) {
      const m = line.match(TS_JS_METHOD_PATTERN);
      if (m && isNotKeyword(m[1]) && !ctx.definedSymbols.has(m[1])) {
        ctx.nodes.push({ label: m[1], type: 'function' });
        ctx.definedSymbols.add(m[1]);
        const parent = ctx.classStack[ctx.classStack.length - 1];
        ctx.edges.push({
          source: parent.name,
          target: m[1],
          relation: 'contains',
          confidence: 'EXTRACTED',
        });
      }
    }

    // --- Imports ---
    for (const pat of TS_JS_IMPORT_PATTERNS) {
      const m = line.match(pat);
      if (m) {
        addImportEdge(ctx, m[1]);
      }
    }

    currentDepth = updateBraceDepth(line, ctx.classStack, currentDepth);
  }
}

// ============================================================================
// createCodeParser
// ============================================================================
export function createCodeParser(): Parser {
  return {
    name: 'code',
    supportedTypes: [
      'code', 'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'java',
      'c', 'cpp', 'rs', 'rb', 'php',
    ],

    async parse(input: ParseInput): Promise<ParseResult> {
      const filePath = input.filePath || 'unknown';
      const lang = detectLanguage(filePath);
      const effectiveLang =
        lang !== 'unknown' ? lang : (input.filePath ? 'javascript' : 'unknown');

      const { nodes, edges } = extractSymbols(input.content, effectiveLang, filePath);

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
