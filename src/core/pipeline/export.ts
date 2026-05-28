import type { GraphNodeRecord, GraphEdgeRecord } from "./types";

// ─── types ────────────────────────────────────────────────────────────────────

interface ExportedNode {
  id: string;
  label: string;
  file_type?: string;
  source_file?: string;
  community?: number;
  metadata: Record<string, unknown>;
}

interface ExportedLink {
  source: string;
  target: string;
  relation: string;
  confidence: number;
}

interface ExportedCommunity {
  id: number;
  members: string[];
}

interface GraphMeta {
  node_count: number;
  edge_count: number;
  communities?: ExportedCommunity[];
  modularity?: number;
}

interface ExportResult {
  nodes: ExportedNode[];
  links: ExportedLink[];
  graph: GraphMeta;
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function buildIdToLabelMap(nodes: GraphNodeRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of nodes) {
    map.set(node.id, node.label);
  }
  return map;
}

function buildCommunityMap(
  communities?: Map<number, string[]>,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!communities) {
    return map;
  }
  for (const [commId, memberIds] of communities) {
    for (const memberId of memberIds) {
      map.set(memberId, commId);
    }
  }
  return map;
}

function mapNodeToExported(
  node: GraphNodeRecord,
  communityMap: Map<string, number>,
): ExportedNode {
  const exported: ExportedNode = {
    id: node.id,
    label: node.label,
    metadata: { ...node.metadata },
  };

  const fileType = node.metadata.file_type;
  if (typeof fileType === "string") {
    exported.file_type = fileType;
  }

  const sourceFile = node.metadata.source_file;
  if (typeof sourceFile === "string") {
    exported.source_file = sourceFile;
  }

  const commId = communityMap.get(node.id);
  if (commId !== undefined) {
    exported.community = commId;
  }

  return exported;
}

function buildExportedCommunities(
  communities?: Map<number, string[]>,
): ExportedCommunity[] | undefined {
  if (!communities || communities.size === 0) {
    return undefined;
  }
  const result: ExportedCommunity[] = [];
  for (const [commId, memberIds] of communities) {
    result.push({ id: commId, members: [...memberIds] });
  }
  return result;
}

function computeModularity(
  cohesionScores?: Map<number, number>,
): number | undefined {
  if (!cohesionScores || cohesionScores.size === 0) {
    return undefined;
  }
  let maxScore = 0;
  for (const score of cohesionScores.values()) {
    if (score > maxScore) {
      maxScore = score;
    }
  }
  return maxScore;
}

// ─── exportGraphJson ───────────────────────────────────────────────────────────

export function exportGraphJson(
  nodes: GraphNodeRecord[],
  edges: GraphEdgeRecord[],
  communities?: Map<number, string[]>,
  cohesionScores?: Map<number, number>,
): ExportResult {
  const idToLabel = buildIdToLabelMap(nodes);
  const communityMap = buildCommunityMap(communities);

  const exportedNodes = nodes.map((node) =>
    mapNodeToExported(node, communityMap),
  );

  const exportedLinks: ExportedLink[] = edges.map((edge) => ({
    source: idToLabel.get(edge.sourceNodeId) ?? edge.sourceNodeId,
    target: idToLabel.get(edge.targetNodeId) ?? edge.targetNodeId,
    relation: edge.relation,
    confidence: edge.confidence,
  }));

  const graphMeta: GraphMeta = {
    node_count: nodes.length,
    edge_count: edges.length,
  };
  const communitiesList = buildExportedCommunities(communities);
  if (communitiesList) {
    graphMeta.communities = communitiesList;
  }
  const modularity = computeModularity(cohesionScores);
  if (modularity !== undefined) {
    graphMeta.modularity = modularity;
  }

  return { nodes: exportedNodes, links: exportedLinks, graph: graphMeta };
}

// ─── generateReport ───────────────────────────────────────────────────────────

interface ReportParams {
  graphName: string;
  nodeCount: number;
  edgeCount: number;
  communities: Map<number, string[]>;
  cohesionScores: Map<number, number>;
  communityLabels: Map<number, string>;
  godNodes: Array<{ label: string; nodeType: string; degree: number }>;
  surprisingConnections: Array<{
    from: string;
    to: string;
    relation: string;
    reason: string;
  }>;
  suggestedQuestions: string[];
  detection: { totalFiles: number; totalWords: number; byType: Record<string, number> };
  tokens: { input: number; output: number };
}

function renderTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return "None\n";
  }

  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.join(" | ")} |`);

  return [headerLine, separatorLine, ...rowLines, ""].join("\n");
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "None\n";
  }
  return items.map((item) => `- ${item}`).join("\n") + "\n";
}

function formatCohesion(score?: number): string {
  if (score === undefined) {
    return "N/A";
  }
  return score.toFixed(3);
}

function renderOverview(params: ReportParams): string {
  return `## Overview

- **Nodes:** ${params.nodeCount}
- **Edges:** ${params.edgeCount}
- **Files Processed:** ${params.detection.totalFiles}
- **Total Words:** ${params.detection.totalWords}
`;
}

function renderGodNodes(godNodes: ReportParams["godNodes"]): string {
  const headers = ["Label", "Type", "Degree"];
  const rows = godNodes.map((gn) => [gn.label, gn.nodeType, String(gn.degree)]);
  return `## God Nodes\n\n${renderTable(headers, rows)}`;
}

function renderCommunities(params: ReportParams): string {
  if (params.communities.size === 0) {
    return "## Communities\n\nNone\n";
  }

  const entries = Array.from(params.communities.entries());
  const multiNode = entries.filter(([, members]) => members.length > 1);
  multiNode.sort((a, b) => b[1].length - a[1].length);
  const omittedCount = entries.length - multiNode.length;

  if (multiNode.length === 0) {
    let result = "## Communities\n\nNone\n";
    if (omittedCount > 0) {
      result += `\n(${omittedCount} single-node ${omittedCount === 1 ? "community" : "communities"} omitted)\n`;
    }
    return result;
  }

  const headers = ["Community", "Label", "Size", "Cohesion"];
  const rows: string[][] = multiNode.map(([commId, memberIds]) => {
    const label = params.communityLabels.get(commId) ?? `Community ${commId}`;
    const cohesion = params.cohesionScores.get(commId);
    return [
      String(commId),
      label,
      String(memberIds.length),
      formatCohesion(cohesion),
    ];
  });

  let result = `## Communities\n\n${renderTable(headers, rows)}`;
  if (omittedCount > 0) {
    result += `\n(${omittedCount} single-node ${omittedCount === 1 ? "community" : "communities"} omitted)\n`;
  }
  return result;
}

function renderSurprisingConnections(
  connections: ReportParams["surprisingConnections"],
): string {
  const headers = ["From", "To", "Relation", "Reason"];
  const rows = connections.map((sc) => [sc.from, sc.to, sc.relation, sc.reason]);
  return `## Surprising Connections\n\n${renderTable(headers, rows)}`;
}

function renderSuggestedQuestions(questions: string[]): string {
  return `## Suggested Questions\n\n${renderList(questions)}`;
}

function renderGraphStats(params: ReportParams): string {
  const byTypeLines = Object.entries(params.detection.byType)
    .map(([type, count]) => `- **${type}:** ${count}`)
    .join("\n");

  return `## Graph Statistics

- **Total Files:** ${params.detection.totalFiles}
- **Total Words:** ${params.detection.totalWords}
- **By Type:**
${byTypeLines}
- **Input Tokens:** ${params.tokens.input}
- **Output Tokens:** ${params.tokens.output}
`;
}

export function generateReport(params: ReportParams): string {
  const sections = [
    `# ${params.graphName}`,
    "",
    renderOverview(params),
    renderGodNodes(params.godNodes),
    renderCommunities(params),
    renderSurprisingConnections(params.surprisingConnections),
    renderSuggestedQuestions(params.suggestedQuestions),
    renderGraphStats(params),
  ];

  return sections.join("\n") + "\n";
}
