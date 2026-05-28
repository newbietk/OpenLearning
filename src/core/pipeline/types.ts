export type SourceType = 'file' | 'link' | 'text';
export type DocStatus = 'pending' | 'parsing' | 'done' | 'failed';

export interface DocumentInput {
  title: string;
  sourceType: SourceType;
  sourceUrl?: string;
  content?: string;
  filePath?: string;
  fileSize?: number;
}

export interface DocumentRecord {
  id: string;
  kbId: string;
  title: string;
  sourceType: SourceType;
  sourceUrl: string | null;
  filePath: string | null;
  fileSize: number | null;
  status: DocStatus;
  errorMessage: string | null;
  parsedAt: string | null;
  createdAt: string;
}

export interface DocumentChunkRecord {
  id: string;
  docId: string;
  chunkIndex: number;
  contentText: string;
  tokenCount: number;
}

export interface GraphNodeRecord {
  id: string;
  kbId: string;
  label: string;
  nodeType: string;
  sourceDocId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface GraphEdgeRecord {
  id: string;
  kbId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  confidence: number;
  createdAt: string;
}

export interface ParsedChunk {
  chunkIndex: number;
  content: string;
  nodes: { label: string; type: string; metadata?: Record<string, unknown> }[];
  edges: { source: string; target: string; relation: string; confidence: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' }[];
}

export interface ParseInput {
  content: string;
  sourceUrl?: string;
  filePath?: string;
}

export interface ParseResult {
  text: string;
  chunks: ParsedChunk[];
}

export interface Parser {
  readonly name: string;
  readonly supportedTypes: string[];
  parse(input: ParseInput): Promise<ParseResult>;
}

export interface ChunkInput {
  filePath?: string;
  content?: string;
  maxTokensPerChunk?: number;
  maxChunks?: number;
}

export interface ChunkOutput {
  chunks: { index: number; text: string; tokenCount: number }[];
  totalTokens: number;
}

export interface SearchResult {
  nodes: GraphNodeRecord[];
  edges: GraphEdgeRecord[];
  chunks: DocumentChunkRecord[];
  score: number;
}

export interface MinHashLSH {
  insert(key: string, minhash: number[]): void;
  query(minhash: number[]): string[];
}

export interface SearchOptions {
  query: string;
  kbId: string;
  maxDepth?: number;
  maxResults?: number;
}
