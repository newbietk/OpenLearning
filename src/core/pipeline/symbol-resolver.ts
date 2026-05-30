import type { GraphNodeRecord, GraphEdgeRecord } from "./types";

// ============================================================================
// Types
// ============================================================================

export interface SymbolInfo {
  nodeId: string;
  label: string;
  filePath: string | undefined;
  type: string;
}

export interface ExportFact {
  symbolName: string;
  nodeId: string;
  filePath: string;
  isReExport: boolean;
  reExportSource?: string;
}

interface FileGroup {
  fileNodeId: string;
  filePath: string;
  symbolNodeIds: Set<string>;
}

interface ResolutionContext {
  nodeMap: Map<string, GraphNodeRecord>;
  fileGroups: FileGroup[];
  nodeToFile: Map<string, string>;
  resolvedImports: Map<string, Set<string>>;
}

// ============================================================================
// Extension resolution priority
// ============================================================================

const EXTENSION_PRIORITY = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const INDEX_FILES = EXTENSION_PRIORITY.map((ext) => `/index${ext}`);

// ============================================================================
// Path resolution helpers
// ============================================================================

function extractFilePath(node: GraphNodeRecord): string | undefined {
  return (node.metadata?.filePath as string | undefined)
    ?? (node.metadata?.sourceFilePath as string | undefined);
}

function matchFilePath(basePath: string, allFilePaths: string[]): string | undefined {
  if (allFilePaths.includes(basePath)) {
    return basePath;
  }
  for (const ext of EXTENSION_PRIORITY) {
    const candidate = `${basePath}${ext}`;
    if (allFilePaths.includes(candidate)) {
      return candidate;
    }
  }
  for (const indexFile of INDEX_FILES) {
    const candidate = `${basePath}${indexFile}`;
    if (allFilePaths.includes(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolveRelativeSegments(
  importPath: string,
  sourceFile: string,
): string | undefined {
  const sourceDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";

  if (importPath === ".") {
    return sourceDir || undefined;
  }

  if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
    return undefined;
  }

  const sourceParts = sourceDir ? sourceDir.split("/") : [];
  const relParts = importPath.split("/");

  for (const part of relParts) {
    if (part === "..") {
      sourceParts.pop();
    } else if (part !== ".") {
      sourceParts.push(part);
    }
  }

  const result = sourceParts.join("/");
  return result || undefined;
}

// ============================================================================
// Graph structure helpers
// ============================================================================

function buildNodeMap(nodes: GraphNodeRecord[]): Map<string, GraphNodeRecord> {
  return new Map(nodes.map((n) => [n.id, n]));
}

function buildFileGroups(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  nodeMap: Map<string, GraphNodeRecord>,
): FileGroup[] {
  const fileGroups: FileGroup[] = [];

  for (const node of nodes) {
    if (node.nodeType !== "file") {
      continue;
    }

    const filePath = extractFilePath(node) ?? node.label;

    fileGroups.push({
      fileNodeId: node.id,
      filePath,
      symbolNodeIds: new Set(),
    });
  }

  for (const edge of edges) {
    if (edge.relation !== "contains") {
      continue;
    }
    const targetNode = nodeMap.get(edge.targetNodeId);
    if (!targetNode || targetNode.nodeType === "file") {
      continue;
    }
    const group = fileGroups.find((g) => g.fileNodeId === edge.sourceNodeId);
    if (group) {
      group.symbolNodeIds.add(edge.targetNodeId);
    }
  }

  return fileGroups;
}

function buildNodeToFileMap(fileGroups: FileGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of fileGroups) {
    for (const symbolId of group.symbolNodeIds) {
      map.set(symbolId, group.fileNodeId);
    }
  }
  return map;
}

function buildFileImports(
  edges: GraphEdgeRecord[],
  nodeMap: Map<string, GraphNodeRecord>,
): Map<string, string[]> {
  const imports = new Map<string, string[]>();

  for (const edge of edges) {
    if (edge.relation !== "imports") {
      continue;
    }
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    const targetNode = nodeMap.get(edge.targetNodeId);
    if (!sourceNode || sourceNode.nodeType !== "file") {
      continue;
    }
    if (!targetNode) {
      continue;
    }

    const modulePath = targetNode.label;

    const existing = imports.get(edge.sourceNodeId);
    if (existing) {
      existing.push(modulePath);
    } else {
      imports.set(edge.sourceNodeId, [modulePath]);
    }
  }

  return imports;
}

function resolveModuleImports(
  fileImports: Map<string, string[]>,
  fileGroups: FileGroup[],
  filePaths: string[],
): Map<string, Set<string>> {
  const resolved = new Map<string, Set<string>>();

  for (const [fileNodeId, modulePaths] of fileImports) {
    const sourceGroup = fileGroups.find((g) => g.fileNodeId === fileNodeId);
    if (!sourceGroup) {
      continue;
    }

    const targets = new Set<string>();

    for (const modulePath of modulePaths) {
      const resolvedPath = resolveImportPath(modulePath, sourceGroup.filePath, filePaths);
      if (!resolvedPath) {
        continue;
      }
      const targetGroup = fileGroups.find((g) => g.filePath === resolvedPath);
      if (targetGroup) {
        targets.add(targetGroup.fileNodeId);
      }
    }

    if (targets.size > 0) {
      resolved.set(fileNodeId, targets);
    }
  }

  return resolved;
}

function buildResolutionContext(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  filePaths: string[],
): ResolutionContext {
  const nodeMap = buildNodeMap(nodes);
  const fileGroups = buildFileGroups(nodes, edges, nodeMap);
  const nodeToFile = buildNodeToFileMap(fileGroups);
  const fileImports = buildFileImports(edges, nodeMap);
  const resolvedImports = resolveModuleImports(fileImports, fileGroups, filePaths);

  return { nodeMap, fileGroups, nodeToFile, resolvedImports };
}

function buildLabelIndex(nodes: GraphNodeRecord[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.nodeType === "file") {
      continue;
    }
    const existing = index.get(node.label);
    if (existing) {
      existing.push(node.id);
    } else {
      index.set(node.label, [node.id]);
    }
  }
  return index;
}

// ============================================================================
// buildSymbolIndex
// ============================================================================

/**
 * Build a global symbol index from all graph nodes.
 * Maps each label to an array of SymbolInfo entries (one per node with that label).
 */
export function buildSymbolIndex(nodes: GraphNodeRecord[]): Map<string, SymbolInfo[]> {
  const index = new Map<string, SymbolInfo[]>();

  for (const node of nodes) {
    const filePath = extractFilePath(node);

    const entry = index.get(node.label);
    const info: SymbolInfo = {
      nodeId: node.id,
      label: node.label,
      filePath,
      type: node.nodeType,
    };
    if (entry) {
      entry.push(info);
    } else {
      index.set(node.label, [info]);
    }
  }

  return index;
}

// ============================================================================
// resolveImportPath
// ============================================================================

/**
 * Resolve an import path like './foo' relative to a source file,
 * against a list of known file paths.
 * Returns the resolved file path or undefined if not found.
 */
export function resolveImportPath(
  importPath: string,
  sourceFile: string,
  allFilePaths: string[],
): string | undefined {
  if (allFilePaths.length === 0) {
    return undefined;
  }

  const basePath = resolveRelativeSegments(importPath, sourceFile);
  if (!basePath) {
    return undefined;
  }

  return matchFilePath(basePath, allFilePaths);
}

// ============================================================================
// collectExportFacts
// ============================================================================

/**
 * Collect export facts for a given file path.
 * Returns the symbols defined (contained) by that file's file node.
 */
export function collectExportFacts(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  filePath: string,
): ExportFact[] {
  const nodeMap = buildNodeMap(nodes);

  const fileNode = nodes.find(
    (n) =>
      n.nodeType === "file" &&
      (n.metadata?.filePath === filePath || n.metadata?.sourceFilePath === filePath),
  );

  if (!fileNode) {
    return [];
  }

  const facts: ExportFact[] = [];

  for (const edge of edges) {
    if (edge.relation !== "contains" || edge.sourceNodeId !== fileNode.id) {
      continue;
    }

    const targetNode = nodeMap.get(edge.targetNodeId);
    if (!targetNode || targetNode.nodeType === "file") {
      continue;
    }

    facts.push({
      symbolName: targetNode.label,
      nodeId: targetNode.id,
      filePath,
      isReExport: false,
    });
  }

  return facts;
}

// ============================================================================
// resolveCrossFileEdges
// ============================================================================

/**
 * Creates cross-file import edges for edges that reference symbols
 * in a different file, when import evidence exists.
 */
function createCrossFileEdges(
  edges: GraphEdgeRecord[],
  ctx: ResolutionContext,
): GraphEdgeRecord[] {
  const newEdges: GraphEdgeRecord[] = [];

  for (const edge of edges) {
    const sourceFileId = ctx.nodeToFile.get(edge.sourceNodeId);
    const targetFileId = ctx.nodeToFile.get(edge.targetNodeId);

    if (!sourceFileId || !targetFileId || sourceFileId === targetFileId) {
      continue;
    }
    if (edge.relation === "contains" || edge.relation === "imports") {
      continue;
    }

    const sourceImports = ctx.resolvedImports.get(sourceFileId);
    if (!sourceImports || !sourceImports.has(targetFileId)) {
      continue;
    }

    const alreadyExists = newEdges.some(
      (e) =>
        e.sourceNodeId === sourceFileId &&
        e.targetNodeId === edge.targetNodeId &&
        e.relation === "imports",
    );

    if (alreadyExists) {
      continue;
    }

    const sourceFileNode = ctx.nodeMap.get(sourceFileId);
    newEdges.push({
      id: `cross_${sourceFileId}_${edge.targetNodeId}`,
      kbId: sourceFileNode?.kbId ?? "unknown",
      sourceNodeId: sourceFileId,
      targetNodeId: edge.targetNodeId,
      relation: "imports",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    });
  }

  return newEdges;
}

/**
 * Resolve cross-file edges by matching symbol references across files
 * based on import evidence.
 */
export function resolveCrossFileEdges(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  filePaths: string[],
): { nodes: GraphNodeRecord[]; edges: GraphEdgeRecord[] } {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const ctx = buildResolutionContext(nodes, edges, filePaths);
  const newEdges = createCrossFileEdges(edges, ctx);

  return { nodes: [...nodes], edges: [...edges, ...newEdges] };
}

// ============================================================================
// resolveCrossFileCalls helpers
// ============================================================================

function makeCallResultEdge(
  sourceNodeId: string,
  targetNodeId: string,
  kbId: string,
  confidence: number,
): GraphEdgeRecord {
  return {
    id: `cross_call_${sourceNodeId}_${targetNodeId}`,
    kbId,
    sourceNodeId,
    targetNodeId,
    relation: "calls",
    confidence,
    createdAt: new Date().toISOString(),
  };
}

function tryResolveUnambiguousCall(
  sourceNodeId: string,
  targetNodeId: string,
  targetFileId: string | undefined,
  sourceImports: Set<string> | undefined,
  targetNode: GraphNodeRecord,
): GraphEdgeRecord | undefined {
  if (!targetFileId) {
    return undefined;
  }
  const hasImportEvidence = sourceImports
    ? sourceImports.has(targetFileId)
    : false;
  return makeCallResultEdge(
    sourceNodeId,
    targetNodeId,
    targetNode.kbId,
    hasImportEvidence ? 1.0 : 0.8,
  );
}

function tryResolveAmbiguousCall(
  sourceNodeId: string,
  matchingIds: string[],
  currentTargetId: string,
  sourceImports: Set<string>,
  ctx: ResolutionContext,
  fallbackKbId: string,
): GraphEdgeRecord | undefined {
  const candidates = [...matchingIds, currentTargetId];
  for (const candidateId of candidates) {
    const candidateFileId = ctx.nodeToFile.get(candidateId);
    if (candidateFileId && sourceImports.has(candidateFileId)) {
      const candidateNode = ctx.nodeMap.get(candidateId);
      return makeCallResultEdge(
        sourceNodeId,
        candidateId,
        candidateNode?.kbId ?? fallbackKbId,
        1.0,
      );
    }
  }
  return undefined;
}

function resolveCallEdge(
  edge: GraphEdgeRecord,
  ctx: ResolutionContext,
  labelIndex: Map<string, string[]>,
): GraphEdgeRecord | undefined {
  const sourceFileId = ctx.nodeToFile.get(edge.sourceNodeId);
  const targetNode = ctx.nodeMap.get(edge.targetNodeId);
  if (!sourceFileId || !targetNode) {
    return undefined;
  }

  const targetFileId = ctx.nodeToFile.get(edge.targetNodeId);
  if (targetFileId === sourceFileId) {
    return undefined;
  }

  const matchingNodes = labelIndex.get(targetNode.label) ?? [];
  const matchingIds = matchingNodes.filter((id) => id !== edge.targetNodeId);
  const sourceImports = ctx.resolvedImports.get(sourceFileId);

  if (matchingIds.length === 0) {
    return tryResolveUnambiguousCall(
      edge.sourceNodeId, edge.targetNodeId, targetFileId, sourceImports, targetNode,
    );
  }

  if (sourceImports) {
    return tryResolveAmbiguousCall(
      edge.sourceNodeId, matchingIds, edge.targetNodeId, sourceImports, ctx, targetNode.kbId,
    );
  }

  return undefined;
}

// ============================================================================
// resolveCrossFileCalls
// ============================================================================

/**
 * Resolve cross-file call edges.
 * For each 'calls' edge where target is in a different file:
 * - With import evidence: confidence 1.0 (EXTRACTED)
 * - Without import evidence but unambiguous: confidence 0.8 (INFERRED)
 * - Ambiguous without import evidence: skipped
 */
export function resolveCrossFileCalls(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
): GraphEdgeRecord[] {
  if (nodes.length === 0 || edges.length === 0) {
    return [];
  }

  // Collect file paths from file nodes for import resolution
  const filePaths: string[] = [];
  for (const node of nodes) {
    if (node.nodeType === "file") {
      const fp = extractFilePath(node);
      if (fp) {
        filePaths.push(fp);
      }
    }
  }

  const ctx = buildResolutionContext(nodes, edges, filePaths);
  const labelIndex = buildLabelIndex(nodes);

  const result: GraphEdgeRecord[] = [];

  for (const edge of edges) {
    if (edge.relation !== "calls") {
      continue;
    }

    const resolved = resolveCallEdge(edge, ctx, labelIndex);
    if (resolved) {
      result.push(resolved);
    }
  }

  return result;
}
