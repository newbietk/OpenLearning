import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const knowledgeBases = sqliteTable('knowledge_bases', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  kbType: text('kb_type', { enum: ['public', 'private'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const platformAdmins = sqliteTable('platform_admins', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  externalId: text('external_id').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sourceType: text('source_type', { enum: ['file', 'link', 'text'] }).notNull(),
  sourceUrl: text('source_url'),
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  status: text('status', { enum: ['pending', 'parsing', 'done', 'failed'] }).notNull().default('pending'),
  errorMessage: text('error_message'),
  parsedAt: text('parsed_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  docId: text('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  contentText: text('content_text').notNull(),
  tokenCount: integer('token_count').notNull(),
});

export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  nodeType: text('node_type').notNull(),
  sourceDocId: text('source_doc_id'),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  sourceNodeId: text('source_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  targetNodeId: text('target_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(),
  confidence: real('confidence').notNull().default(1.0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  externalUserId: text('external_user_id').notNull(),
  title: text('title').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCalls: text('tool_calls'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const llmProviders = sqliteTable('llm_providers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  externalUserId: text('external_user_id').notNull(),
  provider: text('provider').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  baseUrl: text('base_url'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
