// ============================================================================
// TypeScript / JavaScript patterns
// ============================================================================
export const TS_JS_FUNC_PATTERNS: RegExp[] = [
  /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(/,
];

export const TS_JS_ARROW_PATTERNS: RegExp[] = [
  // Handles: const fn = (...) =>, const fn = <T>(...): RetType =>, const fn = async (...) =>
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\s*(?:<[^>]*>\s*)?\([^)]*\).*?=>/,
  // Handles: const fn = x => x (single-param, no parens, no generic)
  /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\s*(?:<[^>]*>\s*)?\w+\s*=>/,
];

export const TS_JS_CLASS_PATTERNS: RegExp[] = [
  /(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?\s*\{/,
];

export const TS_JS_METHOD_PATTERN =
  /^\s*(?:(?:public|private|protected)\s+)?(?:(?:static|abstract)\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*[<(]/;

export const TS_JS_IMPORT_PATTERNS: RegExp[] = [
  // import X from 'Y' or import {X} from 'Y' or import X, {X} from 'Y'
  /import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:,\s*(?:\{[^}]*\}|\w+))?\s*from\s*['"]([^'"]+)['"]/,
  // import 'Y' (side-effect)
  /import\s*['"]([^'"]+)['"]/,
  // import(...)
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  // require('Y')
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

export const TS_JS_INTERFACE_PATTERNS: RegExp[] = [
  /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/,
];

export const TS_JS_TYPE_ALIAS_PATTERN = /(?:export\s+)?type\s+(\w+)\s*=/;

export const TS_JS_ENUM_PATTERN = /(?:export\s+)?(?:const\s+)?enum\s+(\w+)/;

// ============================================================================
// Go patterns
// ============================================================================
export const GO_FUNC_PATTERNS: RegExp[] = [
  /func\s+(?:\(\s*\w+\s+[\w.*]+\s*\)\s*)?(\w+)\s*\(/,
];

export const GO_STRUCT_PATTERN = /type\s+(\w+)\s+struct/;

export const GO_INTERFACE_PATTERN = /type\s+(\w+)\s+interface/;

export const GO_IMPORT_PATTERNS: RegExp[] = [
  /^\s*"([^"]+)"/,
  /import\s+"([^"]+)"/,
];

// ============================================================================
// Rust patterns
// ============================================================================
export const RUST_FUNC_PATTERNS: RegExp[] = [
  /(?:pub(?:\s*\(\s*(?:crate|super|self)\s*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+(\w+)\s*[<(]/,
];

export const RUST_STRUCT_PATTERN = /(?:pub\s+)?struct\s+(\w+)/;

export const RUST_ENUM_PATTERN = /(?:pub\s+)?enum\s+(\w+)/;

export const RUST_TRAIT_PATTERN = /(?:pub\s+)?trait\s+(\w+)/;

export const RUST_IMPL_PATTERN = /impl\s+(?:[\w:]+\s+for\s+)?(\w+)/;

export const RUST_IMPORT_PATTERNS: RegExp[] = [
  /use\s+([^;]+);/,
  /mod\s+(\w+)\s*;/,
];

// ============================================================================
// Java patterns
// ============================================================================
export const JAVA_CLASS_PATTERNS: RegExp[] = [
  /(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?(?:\s+implements\s+[^{]+)?\s*\{/,
];

export const JAVA_INTERFACE_PATTERNS: RegExp[] = [
  /(?:public\s+|private\s+|protected\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+))?[^{]*\{/,
];

export const JAVA_METHOD_PATTERN =
  /^\s*(?:(?:public|private|protected)\s+)?(?:(?:static|final|abstract|synchronized|native)\s+)*(?:(?:[\w<>[\],\s]+)\s+)?(\w+)\s*\(/;

export const JAVA_IMPORT_PATTERNS: RegExp[] = [
  /import\s+(?:static\s+)?([\w.*]+);/,
];

// ============================================================================
// C / C++ patterns
// ============================================================================
export const C_FUNC_PATTERNS: RegExp[] = [
  /^\s*(?:(?:static|inline|extern|virtual|const)\s+)*(?:[\w:]+\s+)+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{/,
];

export const C_CLASS_PATTERNS: RegExp[] = [
  /(?:class|struct)\s+(\w+)(?:\s*:\s*(?:public|private|protected)\s+(\w+))?\s*\{/,
];

export const C_INCLUDE_PATTERNS: RegExp[] = [
  /#include\s+[<"]([^>"]+)[>"]/,
];

export const C_TYPEDEF_PATTERNS: RegExp[] = [
  // typedef struct { ... } Name; or typedef struct tag { ... } Name;
  /typedef\s+(?:struct|enum|union)\s+(?:\w+\s+)?(?:[^{]*\{[^}]*\}|\w+)\s*(\w+)\s*;/,
];
