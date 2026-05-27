import type { DocumentRecord, DocumentChunkRecord, GraphNodeRecord, GraphEdgeRecord } from '../../core/pipeline/types';

export type KbType = 'public' | 'private';

export interface KnowledgeBaseRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  kbType: KbType;
  createdAt: string;
}

export interface PlatformAdminRecord {
  id: string;
  externalId: string;
  createdAt: string;
}

export interface LlmProviderRecord {
  id: string;
  externalUserId: string;
  provider: string;
  apiKeyEncrypted: string;
  baseUrl: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface ChatSessionRecord {
  id: string;
  kbId: string;
  externalUserId: string;
  title: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: string | null;
  createdAt: string;
}

export interface KnowledgeBaseRepository {
  findById(id: string): KnowledgeBaseRecord | undefined;
  findAll(): KnowledgeBaseRecord[];
  findByOwner(ownerId: string): KnowledgeBaseRecord[];
  findByType(kbType: KbType): KnowledgeBaseRecord[];
  create(data: Omit<KnowledgeBaseRecord, 'id' | 'createdAt'>): KnowledgeBaseRecord;
  update(id: string, data: Partial<Pick<KnowledgeBaseRecord, 'name' | 'description'>>): KnowledgeBaseRecord;
  delete(id: string): void;
}

export interface PlatformAdminRepository {
  findAll(): PlatformAdminRecord[];
  findByExternalId(externalId: string): PlatformAdminRecord | undefined;
  create(externalId: string): PlatformAdminRecord;
  deleteByExternalId(externalId: string): void;
}

export interface DocumentRepository {
  findById(id: string): DocumentRecord | undefined;
  findByKbId(kbId: string): DocumentRecord[];
  create(data: Omit<DocumentRecord, 'id' | 'createdAt'>): DocumentRecord;
  updateStatus(id: string, status: string, errorMessage?: string): void;
  delete(id: string): void;
}

export interface DocumentChunkRepository {
  findByDocId(docId: string): DocumentChunkRecord[];
  batchCreate(chunks: Omit<DocumentChunkRecord, 'id'>[]): void;
  deleteByDocId(docId: string): void;
}

export interface GraphNodeRepository {
  findByKbId(kbId: string): GraphNodeRecord[];
  findByLabel(kbId: string, label: string): GraphNodeRecord | undefined;
  findNeighbors(nodeId: string, kbId: string): GraphNodeRecord[];
  search(kbId: string, query: string): GraphNodeRecord[];
  batchCreate(nodes: Omit<GraphNodeRecord, 'id' | 'createdAt'>[]): GraphNodeRecord[];
  deleteByKbId(kbId: string): void;
}

export interface GraphEdgeRepository {
  findByKbId(kbId: string): GraphEdgeRecord[];
  findByNode(nodeId: string, kbId: string): GraphEdgeRecord[];
  batchCreate(edges: Omit<GraphEdgeRecord, 'id' | 'createdAt'>[]): void;
  deleteByKbId(kbId: string): void;
}

export interface ChatRepository {
  createSession(data: Omit<ChatSessionRecord, 'id' | 'createdAt'>): ChatSessionRecord;
  findSessionById(id: string): ChatSessionRecord | undefined;
  findSessionsByUser(externalUserId: string): ChatSessionRecord[];
  addMessage(data: Omit<ChatMessageRecord, 'id' | 'createdAt'>): ChatMessageRecord;
  findMessagesBySession(sessionId: string): ChatMessageRecord[];
  deleteSession(id: string): void;
}

export interface LlmProviderRepository {
  findByUser(externalUserId: string): LlmProviderRecord[];
  findEnabled(externalUserId: string, provider: string): LlmProviderRecord | undefined;
  create(data: Omit<LlmProviderRecord, 'id' | 'createdAt'>): LlmProviderRecord;
  update(id: string, data: Partial<Pick<LlmProviderRecord, 'apiKeyEncrypted' | 'baseUrl' | 'enabled'>>): void;
  delete(id: string): void;
}

export interface Database {
  knowledgeBase: KnowledgeBaseRepository;
  platformAdmin: PlatformAdminRepository;
  document: DocumentRepository;
  documentChunk: DocumentChunkRepository;
  graphNode: GraphNodeRepository;
  graphEdge: GraphEdgeRepository;
  chat: ChatRepository;
  llmProvider: LlmProviderRepository;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
