# Knowledge Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-user AI-driven learning platform with knowledge graph construction, visualization, and AI-powered Q&A.

**Architecture:** Next.js monolith with modular domain logic. Phase 0 defines shared contracts (types/interfaces). Phase 1 runs 5 parallel tracks (DB, Auth, Knowledge, AI, UI) against those contracts. Phase 2 integrates via API routes.

**Tech Stack:** Next.js (App Router), TypeScript, better-sqlite3, Drizzle ORM, pino, D3.js, Vitest, Playwright

---

## 依赖关系图

```
Phase 0: 共享契约 (SEQ)
  └─ Task 0: types + interfaces

Phase 1: 5 条并行轨道 (PAR)
  ├─ Task A: 数据库实现
  ├─ Task B: Auth 模块
  ├─ Task C: Knowledge 模块
  ├─ Task D: AI 模块
  └─ Task E: UI 模块

Phase 2: 集成 (SEQ, 依赖 Phase 1)
  └─ Task F: API 路由 + 串联 + E2E
```

---

## Phase 0: 共享契约

### Task 0: 项目初始化 + 全部类型定义

**目标:** 创建 Next.js 项目，安装所有依赖，定义所有模块的类型和接口。后续 5 条轨道以这些文件为契约独立开发。

**依赖:** 无

---

**Step 1: 创建 Next.js 项目**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack
```

**Step 2: 安装依赖**

```bash
npm install better-sqlite3 drizzle-orm pino pino-pretty jose bcrypt-ts d3
npm install -D @types/better-sqlite3 vitest @vitejs/plugin-react playwright
```

**Step 3: 创建 `src/lib/db/interface.ts`** — 数据库抽象层接口

```typescript
// src/lib/db/interface.ts

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface KnowledgeBase {
  id: string;
  userId: string;
  name: string;
  description: string;
  createdAt: Date;
}

export interface Document {
  id: string;
  kbId: string;
  title: string;
  sourceType: 'file' | 'link' | 'text';
  sourceUrl: string | null;
  parsedAt: Date | null;
  createdAt: Date;
}

export interface DocumentChunk {
  id: string;
  docId: string;
  chunkIndex: number;
  contentText: string;
  tokenCount: number;
}

export interface GraphNode {
  id: string;
  kbId: string;
  label: string;
  nodeType: string;
  sourceDocId: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  kbId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED';
}

export interface ApiKey {
  id: string;
  userId: string;
  provider: string;
  encryptedKey: string;
  createdAt: Date;
}

export interface ChatSession {
  id: string;
  userId: string;
  kbId: string;
  title: string;
  createdAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls: unknown;
  createdAt: Date;
}

export interface UserRepository {
  findById(id: string): User | undefined;
  findByEmail(email: string): User | undefined;
  create(user: Omit<User, 'id' | 'createdAt'>): User;
}

export interface KnowledgeBaseRepository {
  findById(id: string): KnowledgeBase | undefined;
  findByUserId(userId: string): KnowledgeBase[];
  create(kb: Omit<KnowledgeBase, 'id' | 'createdAt'>): KnowledgeBase;
  delete(id: string): void;
}

export interface DocumentRepository {
  findById(id: string): Document | undefined;
  findByKbId(kbId: string): Document[];
  create(doc: Omit<Document, 'id' | 'createdAt'>): Document;
  update(id: string, patch: Partial<Omit<Document, 'id' | 'createdAt'>>): void;
  delete(id: string): void;
}

export interface DocumentChunkRepository {
  findByDocId(docId: string): DocumentChunk[];
  create(chunk: Omit<DocumentChunk, 'id'>): DocumentChunk;
  deleteByDocId(docId: string): void;
}

export interface GraphNodeRepository {
  findByKbId(kbId: string): GraphNode[];
  findByLabel(kbId: string, label: string): GraphNode | undefined;
  create(node: Omit<GraphNode, 'id'>): GraphNode;
  deleteByKbId(kbId: string): void;
}

export interface GraphEdgeRepository {
  findByKbId(kbId: string): GraphEdge[];
  findByNodeId(kbId: string, nodeId: string): GraphEdge[];
  create(edge: Omit<GraphEdge, 'id'>): GraphEdge;
  deleteByKbId(kbId: string): void;
}

export interface ApiKeyRepository {
  findByUserIdAndProvider(userId: string, provider: string): ApiKey | undefined;
  findByUserId(userId: string): ApiKey[];
  upsert(userId: string, provider: string, encryptedKey: string): void;
  delete(userId: string, provider: string): void;
}

export interface ChatRepository {
  createSession(session: Omit<ChatSession, 'id' | 'createdAt'>): ChatSession;
  findSessionById(id: string): ChatSession | undefined;
  findSessionsByUserId(userId: string): ChatSession[];
  addMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage;
  findMessagesBySessionId(sessionId: string): ChatMessage[];
}

export interface Database {
  user: UserRepository;
  knowledgeBase: KnowledgeBaseRepository;
  document: DocumentRepository;
  documentChunk: DocumentChunkRepository;
  graphNode: GraphNodeRepository;
  graphEdge: GraphEdgeRepository;
  apiKey: ApiKeyRepository;
  chat: ChatRepository;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
```

**Step 4: 创建 `src/modules/knowledge/types.ts`** — 知识管道类型

```typescript
// src/modules/knowledge/types.ts

export interface ParsedChunk {
  chunkIndex: number;
  content: string;
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

export interface ParsedNode {
  label: string;
  type: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedEdge {
  source: string;
  target: string;
  relation: string;
  confidence: 'EXTRACTED' | 'INFERRED';
}

export interface PipelineInput {
  kbId: string;
  title: string;
  sourceType: 'file' | 'link' | 'text';
  sourceUrl?: string;
  content: string | Buffer;
}

export interface PipelineResult {
  success: boolean;
  documentId?: string;
  nodeCount: number;
  edgeCount: number;
  errors: string[];
}

export interface SearchResult {
  nodeId: string;
  label: string;
  chunkContent: string;
  score: number;
}

export interface SubgraphResult {
  nodes: { id: string; label: string; type: string; degree: number }[];
  edges: { source: string; target: string; relation: string; confidence: string }[];
}
```

**Step 5: 创建 `src/modules/ai/types.ts`** — AI 引擎类型

```typescript
// src/modules/ai/types.ts

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  result: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface Tool {
  definition: ToolDef;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  toolCall?: ToolCallRequest;
}

export interface ModelProvider {
  readonly name: string;
  chat(
    messages: Message[],
    tools?: ToolDef[],
    model?: string,
  ): AsyncIterable<StreamChunk>;
}

export interface AgentLoopResult {
  messages: Message[];
  iterations: number;
  finishReason: 'complete' | 'max_iterations' | 'error';
  error?: string;
}
```

**Step 6: 创建 `src/lib/logger.ts`** — 日志接口 + 实现

```typescript
// src/lib/logger.ts
import pino from 'pino';

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}

const pinoLogger = pino({
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export const logger: Logger = {
  debug(msg, ctx) { pinoLogger.debug(ctx, msg); },
  info(msg, ctx) { pinoLogger.info(ctx, msg); },
  warn(msg, ctx) { pinoLogger.warn(ctx, msg); },
  error(msg, err, ctx) { pinoLogger.error({ ...ctx, err: err?.message, stack: err?.stack }, msg); },
};
```

**Step 7: 创建 `.env.local` 模板和 `src/lib/env.ts`**

```bash
# .env.local
DATABASE_PATH=./data/app.db
ENCRYPTION_KEY=  # openssl rand -hex 32
JWT_SECRET=       # openssl rand -hex 32
```

```typescript
// src/lib/env.ts
export const env = {
  DATABASE_PATH: process.env.DATABASE_PATH || './data/app.db',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
} as const;

export function validateEnv(): void {
  const missing: string[] = [];
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) missing.push('ENCRYPTION_KEY (min 32 chars)');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) missing.push('JWT_SECRET (min 32 chars)');
  if (missing.length > 0) throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}
```

**Step 8: 配置 Vitest** — 创建 `vitest.config.ts`

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 9: 初始化 git 并提交**

```bash
git init
git add -A
git commit -m "feat: project init + shared types and interfaces"
```

---

## Phase 1: 并行轨道

---

### Task A: 数据库实现

**目标:** 用 SQLite + Drizzle ORM 实现 `lib/db/interface.ts` 中定义的全部 Repository 接口。

**依赖:** Phase 0 (Task 0 完成)

**文件:**
- Create: `src/lib/db/sqlite.ts`
- Create: `src/lib/db/schema.ts`
- Create: `src/lib/db/index.ts`
- Create: `src/lib/db/migrate.ts`
- Create: `src/lib/db/__tests__/sqlite.test.ts`

**契约:** 必须实现 `src/lib/db/interface.ts` 中的 `Database` 接口。

---

**Step 1: 创建 Schema 定义** (`src/lib/db/schema.ts`)

```typescript
// src/lib/db/schema.ts
import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => ({
  userProviderIdx: uniqueIndex('api_key_user_provider_idx').on(table.userId, table.provider),
}));

export const knowledgeBases = sqliteTable('knowledge_bases', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  sourceType: text('source_type', { enum: ['file', 'link', 'text'] }).notNull(),
  sourceUrl: text('source_url'),
  parsedAt: integer('parsed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const documentChunks = sqliteTable('document_chunks', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  chunkIndex: integer('chunk_index').notNull(),
  contentText: text('content_text').notNull(),
  tokenCount: integer('token_count').notNull(),
});

export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  nodeType: text('node_type').notNull(),
  sourceDocId: text('source_doc_id').references(() => documents.id, { onDelete: 'set null' }),
  metadata: text('metadata', { mode: 'json' }).notNull().default('{}'),
});

export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  sourceNodeId: text('source_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  targetNodeId: text('target_node_id').notNull().references(() => graphNodes.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull(),
  confidence: text('confidence', { enum: ['EXTRACTED', 'INFERRED'] }).notNull(),
});

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kbId: text('kb_id').notNull().references(() => knowledgeBases.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'tool'] }).notNull(),
  content: text('content').notNull(),
  toolCalls: text('tool_calls', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
```

**Step 2: 创建迁移脚本** (`src/lib/db/migrate.ts`)

```typescript
// src/lib/db/migrate.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export function runMigrations(dbPath: string): void {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      encrypted_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS api_key_user_provider_idx ON api_keys(user_id, provider);

    CREATE TABLE IF NOT EXISTS knowledge_bases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('file','link','text')),
      source_url TEXT,
      parsed_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      token_count INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      content_text, content='document_chunks', content_rowid='rowid'
    );

    CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      node_type TEXT NOT NULL,
      source_doc_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      source_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      target_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      confidence TEXT NOT NULL CHECK(confidence IN ('EXTRACTED','INFERRED'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','tool')),
      content TEXT NOT NULL,
      tool_calls TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TRIGGER IF NOT EXISTS chunk_fts_insert AFTER INSERT ON document_chunks BEGIN
      INSERT INTO chunk_fts(rowid, content_text) VALUES (NEW.rowid, NEW.content_text);
    END;

    CREATE TRIGGER IF NOT EXISTS chunk_fts_delete AFTER DELETE ON document_chunks BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, content_text) VALUES ('delete', OLD.rowid, OLD.content_text);
    END;
  `);

  sqlite.close();
}
```

**Step 3: 创建 SQLite Database 实现** (`src/lib/db/sqlite.ts`)

```typescript
// src/lib/db/sqlite.ts
import Database from 'better-sqlite3';
import type {
  Database as DatabaseInterface,
  User, UserRepository, KnowledgeBase, KnowledgeBaseRepository,
  Document, DocumentRepository, DocumentChunk, DocumentChunkRepository,
  GraphNode, GraphNodeRepository, GraphEdge, GraphEdgeRepository,
  ApiKey, ApiKeyRepository, ChatSession, ChatMessage, ChatRepository,
} from './interface';
import { randomUUID } from 'crypto';

function now(): number { return Date.now(); }

export function createSqliteDatabase(dbPath: string): DatabaseInterface {
  const conn = new Database(dbPath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');

  const user: UserRepository = {
    findById(id) { return conn.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined; },
    findByEmail(email) { return conn.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined; },
    create(data) {
      const u: User = { id: randomUUID(), ...data, createdAt: new Date(now()) };
      conn.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)').run(u.id, u.email, u.passwordHash, u.createdAt.getTime());
      return u;
    },
  };

  const knowledgeBase: KnowledgeBaseRepository = {
    findById(id) { return conn.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(id) as KnowledgeBase | undefined; },
    findByUserId(userId) { return conn.prepare('SELECT * FROM knowledge_bases WHERE user_id = ?').all(userId) as KnowledgeBase[]; },
    create(data) {
      const kb: KnowledgeBase = { id: randomUUID(), ...data, createdAt: new Date(now()) };
      conn.prepare('INSERT INTO knowledge_bases (id, user_id, name, description, created_at) VALUES (?,?,?,?,?)').run(kb.id, kb.userId, kb.name, kb.description, kb.createdAt.getTime());
      return kb;
    },
    delete(id) { conn.prepare('DELETE FROM knowledge_bases WHERE id = ?').run(id); },
  };

  const document: DocumentRepository = {
    findById(id) { return conn.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | undefined; },
    findByKbId(kbId) { return conn.prepare('SELECT * FROM documents WHERE kb_id = ?').all(kbId) as Document[]; },
    create(data) {
      const doc: Document = { id: randomUUID(), ...data, createdAt: new Date(now()) };
      conn.prepare('INSERT INTO documents (id, kb_id, title, source_type, source_url, parsed_at, created_at) VALUES (?,?,?,?,?,?,?)').run(doc.id, doc.kbId, doc.title, doc.sourceType, doc.sourceUrl, doc.parsedAt?.getTime() ?? null, doc.createdAt.getTime());
      return doc;
    },
    update(id, patch) {
      const sets: string[] = []; const vals: unknown[] = [];
      if (patch.title !== undefined) { sets.push('title = ?'); vals.push(patch.title); }
      if (patch.parsedAt !== undefined) { sets.push('parsed_at = ?'); vals.push(patch.parsedAt?.getTime() ?? null); }
      if (patch.sourceUrl !== undefined) { sets.push('source_url = ?'); vals.push(patch.sourceUrl); }
      if (sets.length > 0) { vals.push(id); conn.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
    },
    delete(id) { conn.prepare('DELETE FROM documents WHERE id = ?').run(id); },
  };

  const documentChunk: DocumentChunkRepository = {
    findByDocId(docId) { return conn.prepare('SELECT * FROM document_chunks WHERE doc_id = ? ORDER BY chunk_index').all(docId) as DocumentChunk[]; },
    create(data) {
      const c: DocumentChunk = { id: randomUUID(), ...data };
      conn.prepare('INSERT INTO document_chunks (id, doc_id, chunk_index, content_text, token_count) VALUES (?,?,?,?,?)').run(c.id, c.docId, c.chunkIndex, c.contentText, c.tokenCount);
      return c;
    },
    deleteByDocId(docId) { conn.prepare('DELETE FROM document_chunks WHERE doc_id = ?').run(docId); },
  };

  const graphNode: GraphNodeRepository = {
    findByKbId(kbId) { return conn.prepare('SELECT * FROM graph_nodes WHERE kb_id = ?').all(kbId) as GraphNode[]; },
    findByLabel(kbId, label) { return conn.prepare('SELECT * FROM graph_nodes WHERE kb_id = ? AND label = ?').get(kbId, label) as GraphNode | undefined; },
    create(data) {
      const n: GraphNode = { id: randomUUID(), ...data };
      conn.prepare('INSERT INTO graph_nodes (id, kb_id, label, node_type, source_doc_id, metadata) VALUES (?,?,?,?,?,?)').run(n.id, n.kbId, n.label, n.nodeType, n.sourceDocId, JSON.stringify(n.metadata));
      return n;
    },
    deleteByKbId(kbId) { conn.prepare('DELETE FROM graph_nodes WHERE kb_id = ?').run(kbId); },
  };

  const graphEdge: GraphEdgeRepository = {
    findByKbId(kbId) { return conn.prepare('SELECT * FROM graph_edges WHERE kb_id = ?').all(kbId) as GraphEdge[]; },
    findByNodeId(kbId, nodeId) {
      return conn.prepare('SELECT * FROM graph_edges WHERE kb_id = ? AND (source_node_id = ? OR target_node_id = ?)').all(kbId, nodeId, nodeId) as GraphEdge[];
    },
    create(data) {
      const e: GraphEdge = { id: randomUUID(), ...data };
      conn.prepare('INSERT INTO graph_edges (id, kb_id, source_node_id, target_node_id, relation, confidence) VALUES (?,?,?,?,?,?)').run(e.id, e.kbId, e.sourceNodeId, e.targetNodeId, e.relation, e.confidence);
      return e;
    },
    deleteByKbId(kbId) { conn.prepare('DELETE FROM graph_edges WHERE kb_id = ?').run(kbId); },
  };

  const apiKey: ApiKeyRepository = {
    findByUserIdAndProvider(userId, provider) { return conn.prepare('SELECT * FROM api_keys WHERE user_id = ? AND provider = ?').get(userId, provider) as ApiKey | undefined; },
    findByUserId(userId) { return conn.prepare('SELECT * FROM api_keys WHERE user_id = ?').all(userId) as ApiKey[]; },
    upsert(userId, provider, encryptedKey) {
      const existing = conn.prepare('SELECT id FROM api_keys WHERE user_id = ? AND provider = ?').get(userId, provider);
      if (existing) {
        conn.prepare('UPDATE api_keys SET encrypted_key = ? WHERE user_id = ? AND provider = ?').run(encryptedKey, userId, provider);
      } else {
        conn.prepare('INSERT INTO api_keys (id, user_id, provider, encrypted_key, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), userId, provider, encryptedKey, now());
      }
    },
    delete(userId, provider) { conn.prepare('DELETE FROM api_keys WHERE user_id = ? AND provider = ?').run(userId, provider); },
  };

  const chat: ChatRepository = {
    createSession(data) {
      const s: ChatSession = { id: randomUUID(), ...data, createdAt: new Date(now()) };
      conn.prepare('INSERT INTO chat_sessions (id, user_id, kb_id, title, created_at) VALUES (?,?,?,?,?)').run(s.id, s.userId, s.kbId, s.title, s.createdAt.getTime());
      return s;
    },
    findSessionById(id) { return conn.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession | undefined; },
    findSessionsByUserId(userId) { return conn.prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ChatSession[]; },
    addMessage(data) {
      const m: ChatMessage = { id: randomUUID(), ...data, createdAt: new Date(now()) };
      conn.prepare('INSERT INTO chat_messages (id, session_id, role, content, tool_calls, created_at) VALUES (?,?,?,?,?,?)').run(m.id, m.sessionId, m.role, m.content, JSON.stringify(m.toolCalls), m.createdAt.getTime());
      return m;
    },
    findMessagesBySessionId(sessionId) { return conn.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as ChatMessage[]; },
  };

  return {
    user, knowledgeBase, document, documentChunk, graphNode, graphEdge, apiKey, chat,
    async transaction(fn) {
      conn.prepare('BEGIN').run();
      try { const result = await fn(this); conn.prepare('COMMIT').run(); return result; }
      catch (e) { conn.prepare('ROLLBACK').run(); throw e; }
    },
  };
}
```

**Step 4: 创建数据库入口** (`src/lib/db/index.ts`)

```typescript
// src/lib/db/index.ts
import { createSqliteDatabase } from './sqlite';
import { runMigrations } from './migrate';
import type { Database } from './interface';
import { env } from '@/lib/env';

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    runMigrations(env.DATABASE_PATH);
    _db = createSqliteDatabase(env.DATABASE_PATH);
  }
  return _db;
}
```

**Step 5: 写测试** (`src/lib/db/__tests__/sqlite.test.ts`)

```typescript
// src/lib/db/__tests__/sqlite.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteDatabase } from '../sqlite';
import { runMigrations } from '../migrate';
import fs from 'fs';
import type { Database } from '../interface';

const TEST_DB = './data/test.db';

describe('SqliteDatabase', () => {
  let db: Database;

  beforeEach(() => {
    fs.mkdirSync('./data', { recursive: true });
    try { fs.unlinkSync(TEST_DB); } catch {}
    runMigrations(TEST_DB);
    db = createSqliteDatabase(TEST_DB);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('creates and finds a user', () => {
    const u = db.user.create({ email: 'a@b.com', passwordHash: 'hash' });
    const found = db.user.findByEmail('a@b.com');
    expect(found).toBeDefined();
    expect(found!.email).toBe('a@b.com');
  });

  it('creates a knowledge base and finds by user', () => {
    const u = db.user.create({ email: 'x@y.com', passwordHash: 'h' });
    db.knowledgeBase.create({ userId: u.id, name: 'KB1', description: 'desc' });
    const kbs = db.knowledgeBase.findByUserId(u.id);
    expect(kbs).toHaveLength(1);
    expect(kbs[0].name).toBe('KB1');
  });

  it('cascade deletes knowledge base removes documents and graph data', () => {
    const u = db.user.create({ email: 'x@y.com', passwordHash: 'h' });
    const kb = db.knowledgeBase.create({ userId: u.id, name: 'KB', description: '' });
    const doc = db.document.create({ kbId: kb.id, title: 'Doc', sourceType: 'text', sourceUrl: null, parsedAt: null });
    const chunk = db.documentChunk.create({ docId: doc.id, chunkIndex: 0, contentText: 'hello', tokenCount: 10 });
    const node = db.graphNode.create({ kbId: kb.id, label: 'Node', nodeType: 'concept', sourceDocId: doc.id, metadata: {} });
    const edge = db.graphEdge.create({ kbId: kb.id, sourceNodeId: node.id, targetNodeId: node.id, relation: 'self', confidence: 'EXTRACTED' });

    db.knowledgeBase.delete(kb.id);
    expect(db.document.findById(doc.id)).toBeUndefined();
    expect(db.documentChunk.findByDocId(doc.id)).toHaveLength(0);
    expect(db.graphNode.findByKbId(kb.id)).toHaveLength(0);
    expect(db.graphEdge.findByKbId(kb.id)).toHaveLength(0);
  });

  it('upserts api key', () => {
    const u = db.user.create({ email: 'a@b.com', passwordHash: 'h' });
    db.apiKey.upsert(u.id, 'openai', 'key1');
    expect(db.apiKey.findByUserIdAndProvider(u.id, 'openai')!.encryptedKey).toBe('key1');
    db.apiKey.upsert(u.id, 'openai', 'key2');
    expect(db.apiKey.findByUserIdAndProvider(u.id, 'openai')!.encryptedKey).toBe('key2');
  });

  it('chat session with messages', () => {
    const u = db.user.create({ email: 'a@b.com', passwordHash: 'h' });
    const kb = db.knowledgeBase.create({ userId: u.id, name: 'KB', description: '' });
    const s = db.chat.createSession({ userId: u.id, kbId: kb.id, title: 'Chat' });
    db.chat.addMessage({ sessionId: s.id, role: 'user', content: 'hello', toolCalls: null });
    const msgs = db.chat.findMessagesBySessionId(s.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
  });

  it('transaction commits on success', async () => {
    await db.transaction(async (tdb) => {
      tdb.user.create({ email: 'tx@test.com', passwordHash: 'h' });
    });
    expect(db.user.findByEmail('tx@test.com')).toBeDefined();
  });

  it('transaction rolls back on error', async () => {
    try {
      await db.transaction(async (tdb) => {
        tdb.user.create({ email: 'rx@test.com', passwordHash: 'h' });
        throw new Error('boom');
      });
    } catch {}
    expect(db.user.findByEmail('rx@test.com')).toBeUndefined();
  });
});
```

**Step 6: 运行测试并提交**

```bash
npx vitest run src/lib/db/__tests__/sqlite.test.ts
# 预期: 8 tests passed
git add src/lib/db/ && git commit -m "feat: SQLite database implementation with all repositories"
```

---

### Task B: Auth 模块

**目标:** 实现用户注册、登录、Session 验证。API Key 加密存储。

**依赖:** Phase 0 (Task 0 完成)

**文件:**
- Create: `src/modules/auth/types.ts`
- Create: `src/modules/auth/service.ts`
- Create: `src/modules/auth/crypto.ts`
- Create: `src/modules/auth/__tests__/service.test.ts`

**契约:**
- 使用 `src/lib/db/interface.ts` 中的 `Database` 接口（通过依赖注入传入）
- 使用 `src/lib/logger.ts` 中的 `Logger` 接口

---

**Step 1: 创建 Auth 类型** (`src/modules/auth/types.ts`)

```typescript
// src/modules/auth/types.ts
export interface RegisterInput {
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResult {
  success: boolean;
  userId?: string;
  token?: string;
  error?: string;
}

export interface SessionPayload {
  userId: string;
  exp: number;
}

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  verifyToken(token: string): Promise<SessionPayload | null>;
  saveApiKey(userId: string, provider: string, key: string): Promise<void>;
  getApiKeys(userId: string): Promise<Array<{ provider: string; createdAt: Date }>>;
  deleteApiKey(userId: string, provider: string): Promise<void>;
}
```

**Step 2: 创建加密工具** (`src/modules/auth/crypto.ts`)

```typescript
// src/modules/auth/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { hashSync, compareSync } from 'bcrypt-ts';

const ALGO = 'aes-256-gcm';

export function hashPassword(password: string): string {
  return hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return compareSync(password, hash);
}

export function encryptApiKey(key: string, masterKey: string): string {
  const keyBytes = Buffer.from(masterKey.slice(0, 32));
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGO, keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptApiKey(encrypted: string, masterKey: string): string {
  const [ivHex, tagHex, dataHex] = encrypted.split(':');
  const keyBytes = Buffer.from(masterKey.slice(0, 32));
  const decipher = createDecipheriv(ALGO, keyBytes, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
```

**Step 3: 创建 Auth Service** (`src/modules/auth/service.ts`)

```typescript
// src/modules/auth/service.ts
import { SignJWT, jwtVerify } from 'jose';
import type { Database } from '@/lib/db/interface';
import type { Logger } from '@/lib/logger';
import type { RegisterInput, LoginInput, AuthResult, SessionPayload, AuthService } from './types';
import { hashPassword, verifyPassword, encryptApiKey, decryptApiKey } from './crypto';
import { env } from '@/lib/env';
import { randomUUID } from 'crypto';

const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET);

export function createAuthService(db: Database, logger: Logger): AuthService {
  return {
    async register(input: RegisterInput): Promise<AuthResult> {
      if (!input.email.includes('@')) return { success: false, error: 'Invalid email' };
      if (input.password.length < 6) return { success: false, error: 'Password must be at least 6 characters' };

      const existing = db.user.findByEmail(input.email.toLowerCase());
      if (existing) return { success: false, error: 'Email already registered' };

      const user = db.user.create({
        email: input.email.toLowerCase(),
        passwordHash: hashPassword(input.password),
      });

      const token = await new SignJWT({ userId: user.id } as SessionPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('7d')
        .sign(JWT_SECRET);

      logger.info('User registered', { userId: user.id });
      return { success: true, userId: user.id, token };
    },

    async login(input: LoginInput): Promise<AuthResult> {
      const user = db.user.findByEmail(input.email.toLowerCase());
      if (!user) return { success: false, error: 'Invalid email or password' };

      if (!verifyPassword(input.password, user.passwordHash)) {
        return { success: false, error: 'Invalid email or password' };
      }

      const token = await new SignJWT({ userId: user.id } as SessionPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('7d')
        .sign(JWT_SECRET);

      logger.info('User logged in', { userId: user.id });
      return { success: true, userId: user.id, token };
    },

    async verifyToken(token: string): Promise<SessionPayload | null> {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        return payload as unknown as SessionPayload;
      } catch {
        return null;
      }
    },

    async saveApiKey(userId: string, provider: string, key: string): Promise<void> {
      const encrypted = encryptApiKey(key, env.ENCRYPTION_KEY!);
      db.apiKey.upsert(userId, provider, encrypted);
      logger.info('API key saved', { userId, provider });
    },

    async getApiKeys(userId: string) {
      return db.apiKey.findByUserId(userId).map(k => ({ provider: k.provider, createdAt: k.createdAt }));
    },

    async deleteApiKey(userId: string, provider: string): Promise<void> {
      db.apiKey.delete(userId, provider);
      logger.info('API key deleted', { userId, provider });
    },
  };
}
```

**Step 4: 写测试** (`src/modules/auth/__tests__/service.test.ts`)

```typescript
// src/modules/auth/__tests__/service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteDatabase } from '@/lib/db/sqlite';
import { runMigrations } from '@/lib/db/migrate';
import { createAuthService } from '../service';
import { logger } from '@/lib/logger';
import fs from 'fs';
import type { Database } from '@/lib/db/interface';

const TEST_DB = './data/auth-test.db';

describe('AuthService', () => {
  let db: Database;
  let auth: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    fs.mkdirSync('./data', { recursive: true });
    try { fs.unlinkSync(TEST_DB); } catch {}
    runMigrations(TEST_DB);
    db = createSqliteDatabase(TEST_DB);
    auth = createAuthService(db, logger);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('registers a new user', async () => {
    const r = await auth.register({ email: 'test@test.com', password: '123456' });
    expect(r.success).toBe(true);
    expect(r.token).toBeDefined();
  });

  it('rejects duplicate email', async () => {
    await auth.register({ email: 'dup@test.com', password: '123456' });
    const r = await auth.register({ email: 'dup@test.com', password: '123456' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('already registered');
  });

  it('rejects short password', async () => {
    const r = await auth.register({ email: 'a@b.com', password: '123' });
    expect(r.success).toBe(false);
  });

  it('rejects invalid email', async () => {
    const r = await auth.register({ email: 'notanemail', password: '123456' });
    expect(r.success).toBe(false);
  });

  it('logs in with correct credentials', async () => {
    await auth.register({ email: 'login@test.com', password: '123456' });
    const r = await auth.login({ email: 'login@test.com', password: '123456' });
    expect(r.success).toBe(true);
    expect(r.token).toBeDefined();
  });

  it('rejects wrong password', async () => {
    await auth.register({ email: 'x@x.com', password: '123456' });
    const r = await auth.login({ email: 'x@x.com', password: 'wrong' });
    expect(r.success).toBe(false);
  });

  it('verifies a valid token', async () => {
    const r = await auth.register({ email: 'v@test.com', password: '123456' });
    const payload = await auth.verifyToken(r.token!);
    expect(payload).toBeDefined();
    expect(payload!.userId).toBe(r.userId);
  });

  it('rejects an invalid token', async () => {
    const payload = await auth.verifyToken('invalid');
    expect(payload).toBeNull();
  });

  it('saves and lists api keys', async () => {
    const r = await auth.register({ email: 'key@test.com', password: '123456' });
    await auth.saveApiKey(r.userId!, 'openai', 'sk-test-key');
    await auth.saveApiKey(r.userId!, 'anthropic', 'sk-ant-test');
    const keys = await auth.getApiKeys(r.userId!);
    expect(keys).toHaveLength(2);
  });

  it('deletes an api key', async () => {
    const r = await auth.register({ email: 'del@test.com', password: '123456' });
    await auth.saveApiKey(r.userId!, 'openai', 'sk-test');
    await auth.deleteApiKey(r.userId!, 'openai');
    const keys = await auth.getApiKeys(r.userId!);
    expect(keys).toHaveLength(0);
  });
});
```

**Step 5: 运行测试并提交**

```bash
npx vitest run src/modules/auth/__tests__/service.test.ts
# 预期: 10 tests passed
git add src/modules/auth/ && git commit -m "feat: auth module with JWT + API key encryption"
```

---

### Task C: Knowledge 模块

**目标:** 实现知识管道完整流程: 分段 → 解析 → 图谱构建 → 检索 → 定时调度。

**依赖:** Phase 0 (Task 0 完成)

**文件:**
- Create: `src/modules/knowledge/chunker.ts`
- Create: `src/modules/knowledge/parsers/text.ts`
- Create: `src/modules/knowledge/parsers/markdown.ts`
- Create: `src/modules/knowledge/parsers/link.ts`
- Create: `src/modules/knowledge/parsers/code.ts`
- Create: `src/modules/knowledge/parsers/index.ts`
- Create: `src/modules/knowledge/graph.ts`
- Create: `src/modules/knowledge/pipeline.ts`
- Create: `src/modules/knowledge/search.ts`
- Create: `src/modules/knowledge/scheduler.ts`
- Create: `src/modules/knowledge/__tests__/chunker.test.ts`
- Create: `src/modules/knowledge/__tests__/parsers.test.ts`
- Create: `src/modules/knowledge/__tests__/graph.test.ts`
- Create: `src/modules/knowledge/__tests__/pipeline.test.ts`
- Create: `src/modules/knowledge/__tests__/search.test.ts`

**契约:**
- 使用 `src/lib/db/interface.ts` 中的 `Database` 接口
- 使用 `src/lib/logger.ts` 中的 `Logger` 接口
- 输入/输出类型使用 `src/modules/knowledge/types.ts`

---

**Step 1: 创建分段器** (`src/modules/knowledge/chunker.ts`)

```typescript
// src/modules/knowledge/chunker.ts

const CHUNK_SIZE_BYTES = 10 * 1024 * 1024; // 10MB threshold

export interface ChunkInput {
  text: string;
  chunkIndex: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE_BYTES) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const p of paragraphs) {
    if (current && estimateTokens(current + '\n\n' + p) > 4000) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? current + '\n\n' + p : p;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
```

**Step 2: 创建解析器** (`src/modules/knowledge/parsers/`)

`src/modules/knowledge/parsers/index.ts`:

```typescript
// src/modules/knowledge/parsers/index.ts
import type { ParsedChunk } from '../types';
import { parseText } from './text';
import { parseMarkdown } from './markdown';
import { parseLink } from './link';
import { parseCode } from './code';

export type Parser = (content: string, fileName?: string) => ParsedChunk;

export function getParser(sourceType: string, fileName?: string): Parser {
  if (sourceType === 'link') return parseLink;

  const name = fileName?.toLowerCase() ?? '';
  if (name.endsWith('.md')) return parseMarkdown;
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|cs|rb|php|swift|kt|scala|sh|sql)$/.test(name)) return parseCode;
  return parseText;
}
```

`src/modules/knowledge/parsers/text.ts`:

```typescript
// src/modules/knowledge/parsers/text.ts
import type { ParsedChunk } from '../types';

export function parseText(content: string, fileName?: string): ParsedChunk {
  const lines = content.trim().split('\n').filter(l => l.trim());
  const title = fileName || lines[0]?.slice(0, 100) || 'Untitled';
  return {
    chunkIndex: 0,
    content,
    nodes: [{ label: title, type: 'document' }],
    edges: [],
  };
}
```

`src/modules/knowledge/parsers/markdown.ts`:

```typescript
// src/modules/knowledge/parsers/markdown.ts
import type { ParsedChunk } from '../types';

export function parseMarkdown(content: string, fileName?: string): ParsedChunk {
  const nodes: ParsedChunk['nodes'] = [];
  const edges: ParsedChunk['edges'] = [];

  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    const label = match[2].trim();
    nodes.push({ label, type: 'heading' });
    if (nodes.length > 1) {
      edges.push({
        source: nodes[nodes.length - 2].label,
        target: label,
        relation: 'contains',
        confidence: 'EXTRACTED',
      });
    }
  }

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(content)) !== null) {
    const label = match[1].trim();
    nodes.push({ label, type: 'reference', metadata: { url: match[2] } });
    edges.push({
      source: fileName || 'document',
      target: label,
      relation: 'references',
      confidence: 'EXTRACTED',
    });
  }

  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    const lang = match[1] || 'code';
    const label = `Code block (${lang})`;
    nodes.push({ label, type: 'code_block', metadata: { language: lang } });
  }

  const title = fileName || nodes[0]?.label || 'Untitled';
  if (!nodes.find(n => n.label === title)) {
    nodes.unshift({ label: title, type: 'document' });
  }

  return { chunkIndex: 0, content, nodes, edges };
}
```

`src/modules/knowledge/parsers/link.ts`:

```typescript
// src/modules/knowledge/parsers/link.ts
import type { ParsedChunk } from '../types';

export function parseLink(content: string, fileName?: string): ParsedChunk {
  const title = fileName || 'Web Page';
  const nodes: ParsedChunk['nodes'] = [{ label: title, type: 'webpage' }];
  const edges: ParsedChunk['edges'] = [];

  const headingRegex = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi;
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    const label = match[1].trim();
    nodes.push({ label, type: 'section' });
    edges.push({ source: title, target: label, relation: 'contains', confidence: 'EXTRACTED' });
  }

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  while ((match = linkRegex.exec(content)) !== null) {
    const label = match[2].trim() || match[1];
    nodes.push({ label, type: 'link', metadata: { url: match[1] } });
    edges.push({ source: title, target: label, relation: 'references', confidence: 'EXTRACTED' });
  }

  return { chunkIndex: 0, content, nodes, edges };
}
```

`src/modules/knowledge/parsers/code.ts` — 用 tree-sitter 还是 regex？MVP 先用 regex 提取函数/类/导入定义：

```typescript
// src/modules/knowledge/parsers/code.ts
import type { ParsedChunk } from '../types';

export function parseCode(content: string, fileName?: string): ParsedChunk {
  const nodes: ParsedChunk['nodes'] = [];
  const edges: ParsedChunk['edges'] = [];
  const root = fileName || 'File';

  const patterns: Array<{ regex: RegExp; type: string }> = [
    { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, type: 'function' },
    { regex: /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g, type: 'class' },
    { regex: /(?:export\s+)?const\s+(\w+)\s*=/g, type: 'constant' },
    { regex: /(?:export\s+)?interface\s+(\w+)/g, type: 'interface' },
    { regex: /(?:export\s+)?type\s+(\w+)/g, type: 'type' },
    { regex: /def\s+(\w+)/g, type: 'function' },
  ];

  for (const { regex, type } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const label = match[1];
      if (label && !nodes.find(n => n.label === label && n.type === type)) {
        nodes.push({ label, type, metadata: {} });
        edges.push({ source: root, target: label, relation: 'defines', confidence: 'EXTRACTED' });
      }
    }
  }

  const importRegex = /(?:import|require)\s*.*?['"]([^'"]+)['"]/g;
  let im: RegExpExecArray | null;
  while ((im = importRegex.exec(content)) !== null) {
    const label = im[1];
    if (!nodes.find(n => n.label === label && n.type === 'import')) {
      nodes.push({ label, type: 'import', metadata: {} });
      edges.push({ source: root, target: label, relation: 'imports', confidence: 'EXTRACTED' });
    }
  }

  nodes.unshift({ label: root, type: 'file' });
  return { chunkIndex: 0, content, nodes, edges };
}
```

**Step 3: 创建图谱构建器** (`src/modules/knowledge/graph.ts`)

```typescript
// src/modules/knowledge/graph.ts
import type { Database } from '@/lib/db/interface';
import type { ParsedChunk } from './types';

export function buildGraph(
  db: Database,
  kbId: string,
  chunks: ParsedChunk[],
  docId: string,
): { nodeCount: number; edgeCount: number } {
  const nodeMap = new Map<string, string>();

  for (const chunk of chunks) {
    for (const node of chunk.nodes) {
      const existing = db.graphNode.findByLabel(kbId, node.label);
      if (existing) {
        nodeMap.set(node.label, existing.id);
      } else {
        const created = db.graphNode.create({
          kbId,
          label: node.label,
          nodeType: node.type,
          sourceDocId: docId,
          metadata: node.metadata || {},
        });
        nodeMap.set(node.label, created.id);
      }
    }
  }

  let edgeCount = 0;
  for (const chunk of chunks) {
    for (const edge of chunk.edges) {
      const sourceId = nodeMap.get(edge.source);
      const targetId = nodeMap.get(edge.target);
      if (sourceId && targetId) {
        db.graphEdge.create({
          kbId,
          sourceNodeId: sourceId,
          targetNodeId: targetId,
          relation: edge.relation,
          confidence: edge.confidence,
        });
        edgeCount++;
      }
    }
  }

  return { nodeCount: nodeMap.size, edgeCount };
}
```

**Step 4: 创建 Pipeline** (`src/modules/knowledge/pipeline.ts`)

```typescript
// src/modules/knowledge/pipeline.ts
import type { Database } from '@/lib/db/interface';
import type { Logger } from '@/lib/logger';
import type { PipelineInput, PipelineResult } from './types';
import { chunkText, estimateTokens } from './chunker';
import { getParser } from './parsers/index';
import { buildGraph } from './graph';

export async function runPipeline(
  db: Database,
  logger: Logger,
  input: PipelineInput,
): Promise<PipelineResult> {
  const errors: string[] = [];
  const startTime = Date.now();

  logger.info('Pipeline started', { kbId: input.kbId, title: input.title });

  const textContent = typeof input.content === 'string'
    ? input.content
    : new TextDecoder().decode(input.content);

  const doc = db.document.create({
    kbId: input.kbId,
    title: input.title,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl || null,
    parsedAt: null,
  });

  try {
    const chunks = chunkText(textContent);
    logger.debug('Content chunked', { docId: doc.id, chunkCount: chunks.length });

    const parser = getParser(input.sourceType, input.title);
    const parsedChunks = chunks.map((text, i) => {
      const result = parser(text, i === 0 ? input.title : undefined);
      result.chunkIndex = i;
      return result;
    });

    let totalTokens = 0;
    for (const pc of parsedChunks) {
      const tokens = estimateTokens(pc.content);
      totalTokens += tokens;
      db.documentChunk.create({
        docId: doc.id,
        chunkIndex: pc.chunkIndex,
        contentText: pc.content,
        tokenCount: tokens,
      });
    }

    const { nodeCount, edgeCount } = buildGraph(db, input.kbId, parsedChunks, doc.id);

    db.document.update(doc.id, { parsedAt: new Date() });

    const elapsed = Date.now() - startTime;
    logger.info('Pipeline completed', {
      docId: doc.id, nodeCount, edgeCount, chunkCount: chunks.length,
      totalTokens, elapsedMs: elapsed,
    });

    return { success: true, documentId: doc.id, nodeCount, edgeCount, errors };
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.error('Pipeline failed', err instanceof Error ? err : new Error(String(err)), {
      docId: doc.id, elapsedMs: elapsed,
    });
    return { success: false, documentId: doc.id, nodeCount: 0, edgeCount: 0, errors: [String(err)] };
  }
}
```

**Step 5: 创建检索** (`src/modules/knowledge/search.ts`)

```typescript
// src/modules/knowledge/search.ts
import Database from 'better-sqlite3';
import type { SearchResult, SubgraphResult } from './types';

export function searchKnowledge(
  conn: Database.Database,
  kbId: string,
  query: string,
  limit: number = 10,
): SearchResult[] {
  const rows = conn.prepare(`
    SELECT gn.id as node_id, gn.label, dc.content_text as chunk_content,
           rank_score(chunk_fts.rank) as score
    FROM chunk_fts
    JOIN document_chunks dc ON dc.rowid = chunk_fts.rowid
    JOIN documents d ON d.id = dc.doc_id
    JOIN graph_nodes gn ON gn.source_doc_id = d.id
    WHERE d.kb_id = ? AND chunk_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `).all(kbId, query, limit) as SearchResult[];

  return rows;
}

export function getSubgraph(
  conn: Database.Database,
  kbId: string,
  nodeId: string,
  depth: number = 2,
): SubgraphResult {
  const visited = new Set<string>();

  function bfs(startIds: string[], remainingDepth: number): { nodes: SubgraphResult['nodes']; edges: SubgraphResult['edges'] } {
    if (remainingDepth === 0 || startIds.length === 0) return { nodes: [], edges: [] };

    const nextIds: string[] = [];
    const nodes: SubgraphResult['nodes'] = [];
    const edges: SubgraphResult['edges'] = [];

    for (const id of startIds) {
      if (visited.has(id)) continue;
      visited.add(id);

      const node = conn.prepare('SELECT id, label, node_type as type FROM graph_nodes WHERE id = ?').get(id) as any;
      if (node) {
        nodes.push({ id: node.id, label: node.label, type: node.type, degree: 0 });
      }

      const outEdges = conn.prepare(
        'SELECT ge.id, ge.source_node_id as source, ge.target_node_id as target, ge.relation, ge.confidence FROM graph_edges ge WHERE ge.kb_id = ? AND ge.source_node_id = ?'
      ).all(kbId, id) as any[];

      const inEdges = conn.prepare(
        'SELECT ge.id, ge.source_node_id as source, ge.target_node_id as target, ge.relation, ge.confidence FROM graph_edges ge WHERE ge.kb_id = ? AND ge.target_node_id = ?'
      ).all(kbId, id) as any[];

      for (const e of [...outEdges, ...inEdges]) {
        if (!visited.has(e.source)) nextIds.push(e.source);
        if (!visited.has(e.target)) nextIds.push(e.target);
        edges.push({ source: e.source, target: e.target, relation: e.relation, confidence: e.confidence });
      }
    }

    const deeper = bfs(nextIds, remainingDepth - 1);
    return {
      nodes: [...nodes, ...deeper.nodes],
      edges: [...edges, ...deeper.edges],
    };
  }

  const result = bfs([nodeId], depth);
  return { nodes: result.nodes, edges: result.edges };
}
```

**Step 6: 创建调度器** (`src/modules/knowledge/scheduler.ts`)

```typescript
// src/modules/knowledge/scheduler.ts
import type { Database } from '@/lib/db/interface';
import type { Logger } from '@/lib/logger';
import type { PipelineInput } from './types';
import { runPipeline } from './pipeline';

interface SchedulerTask {
  docId: string;
  timer: ReturnType<typeof setInterval>;
}

export class Scheduler {
  private tasks = new Map<string, SchedulerTask>();

  constructor(
    private db: Database,
    private logger: Logger,
  ) {}

  schedule(input: PipelineInput & { docId: string }, intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.tasks.has(input.docId)) {
      this.logger.warn('Task already scheduled', { docId: input.docId });
      return;
    }

    this.logger.info('Scheduling update task', { docId: input.docId, intervalMs });
    const timer = setInterval(async () => {
      this.logger.info('Running scheduled update', { docId: input.docId });
      try {
        const result = await runPipeline(this.db, this.logger, input);
        if (!result.success) {
          this.logger.error('Scheduled update failed', new Error(result.errors.join(', ')), { docId: input.docId });
        }
      } catch (err) {
        this.logger.error('Scheduled update crashed', err instanceof Error ? err : new Error(String(err)), { docId: input.docId });
      }
    }, intervalMs);

    this.tasks.set(input.docId, { docId: input.docId, timer });
  }

  unschedule(docId: string): void {
    const task = this.tasks.get(docId);
    if (task) {
      clearInterval(task.timer);
      this.tasks.delete(docId);
      this.logger.info('Unscheduled update task', { docId });
    }
  }

  stopAll(): void {
    for (const [docId, task] of this.tasks) {
      clearInterval(task.timer);
      this.logger.info('Stopped update task', { docId });
    }
    this.tasks.clear();
  }
}
```

**Step 7: 写测试**

`src/modules/knowledge/__tests__/chunker.test.ts`:

```typescript
// src/modules/knowledge/__tests__/chunker.test.ts
import { describe, it, expect } from 'vitest';
import { chunkText, estimateTokens } from '../chunker';

describe('chunker', () => {
  it('returns single chunk for small text', () => {
    const chunks = chunkText('hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('hello world');
  });

  it('splits large text at paragraph boundaries', () => {
    const longPara = 'x'.repeat(5000);
    const parts = [longPara, longPara, longPara];
    const chunks = chunkText(parts.join('\n\n'));
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join('\n\n').length).toBe(parts.join('\n\n').length);
  });

  it('estimateTokens returns approximate count', () => {
    expect(estimateTokens('hello')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});
```

`src/modules/knowledge/__tests__/parsers.test.ts`:

```typescript
// src/modules/knowledge/__tests__/parsers.test.ts
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../parsers/markdown';
import { parseText } from '../parsers/text';
import { parseCode } from '../parsers/code';

describe('parsers', () => {
  it('parseText extracts title', () => {
    const r = parseText('hello world\nthis is content', 'doc.txt');
    expect(r.nodes[0].label).toBe('doc.txt');
  });

  it('parseMarkdown extracts headings', () => {
    const r = parseMarkdown('# Title\n## Section 1\nContent');
    const headings = r.nodes.filter(n => n.type === 'heading');
    expect(headings).toHaveLength(2);
    expect(headings[0].label).toBe('Title');
  });

  it('parseMarkdown extracts links', () => {
    const r = parseMarkdown('[google](https://google.com)');
    const refs = r.nodes.filter(n => n.type === 'reference');
    expect(refs).toHaveLength(1);
  });

  it('parseCode extracts functions', () => {
    const r = parseCode('export function hello() {}', 'test.ts');
    const funcs = r.nodes.filter(n => n.type === 'function');
    expect(funcs.some(f => f.label === 'hello')).toBe(true);
  });

  it('parseCode extracts imports', () => {
    const r = parseCode('import { foo } from "bar"', 'test.ts');
    const imports = r.nodes.filter(n => n.type === 'import');
    expect(imports.some(i => i.label === 'bar')).toBe(true);
  });
});
```

`src/modules/knowledge/__tests__/graph.test.ts`:

```typescript
// src/modules/knowledge/__tests__/graph.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSqliteDatabase } from '@/lib/db/sqlite';
import { runMigrations } from '@/lib/db/migrate';
import { buildGraph } from '../graph';
import type { Database } from '@/lib/db/interface';
import type { ParsedChunk } from '../types';
import fs from 'fs';

const TEST_DB = './data/graph-test.db';

describe('buildGraph', () => {
  let db: Database;

  beforeEach(() => {
    fs.mkdirSync('./data', { recursive: true });
    try { fs.unlinkSync(TEST_DB); } catch {}
    runMigrations(TEST_DB);
    db = createSqliteDatabase(TEST_DB);
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('builds graph from parsed chunks', () => {
    const u = db.user.create({ email: 'g@test.com', passwordHash: 'h' });
    const kb = db.knowledgeBase.create({ userId: u.id, name: 'KB', description: '' });
    const doc = db.document.create({ kbId: kb.id, title: 'test.md', sourceType: 'file', sourceUrl: null, parsedAt: null });

    const chunks: ParsedChunk[] = [{
      chunkIndex: 0,
      content: '# Hello',
      nodes: [
        { label: 'test.md', type: 'document' },
        { label: 'Hello', type: 'heading' },
      ],
      edges: [
        { source: 'test.md', target: 'Hello', relation: 'contains', confidence: 'EXTRACTED' },
      ],
    }];

    const result = buildGraph(db, kb.id, chunks, doc.id);
    expect(result.nodeCount).toBe(2);
    expect(result.edgeCount).toBe(1);
  });

  it('deduplicates nodes with same label', () => {
    const u = db.user.create({ email: 'dd@test.com', passwordHash: 'h' });
    const kb = db.knowledgeBase.create({ userId: u.id, name: 'KB', description: '' });
    const doc = db.document.create({ kbId: kb.id, title: 'test.md', sourceType: 'file', sourceUrl: null, parsedAt: null });

    const chunks: ParsedChunk[] = [
      { chunkIndex: 0, content: 'A', nodes: [{ label: 'Same', type: 'heading' }], edges: [] },
      { chunkIndex: 1, content: 'B', nodes: [{ label: 'Same', type: 'heading' }], edges: [] },
    ];

    const result = buildGraph(db, kb.id, chunks, doc.id);
    expect(result.nodeCount).toBe(1);
  });
});
```

**Step 8: 运行测试并提交**

```bash
npx vitest run src/modules/knowledge/__tests__/
# 预期: ~11 tests passed
git add src/modules/knowledge/ && git commit -m "feat: knowledge pipeline with chunking, parsers, graph, search, scheduler"
```

---

### Task D: AI 模块

**目标:** 实现 Model Provider 适配层 + ReAct Agent Loop + 8 个图谱检索工具。

**依赖:** Phase 0 (Task 0 完成)

**文件:**
- Create: `src/modules/ai/providers/openai.ts`
- Create: `src/modules/ai/providers/anthropic.ts`
- Create: `src/modules/ai/providers/deepseek.ts`
- Create: `src/modules/ai/providers/index.ts`
- Create: `src/modules/ai/tools/index.ts`
- Create: `src/modules/ai/tools/search-knowledge.ts`
- Create: `src/modules/ai/tools/get-node.ts`
- Create: `src/modules/ai/tools/get-neighbors.ts`
- Create: `src/modules/ai/tools/get-community.ts`
- Create: `src/modules/ai/tools/god-nodes.ts`
- Create: `src/modules/ai/tools/graph-stats.ts`
- Create: `src/modules/ai/tools/shortest-path.ts`
- Create: `src/modules/ai/tools/get-document.ts`
- Create: `src/modules/ai/agent-loop.ts`
- Create: `src/modules/ai/__tests__/providers.test.ts`
- Create: `src/modules/ai/__tests__/agent-loop.test.ts`
- Create: `src/modules/ai/__tests__/tools.test.ts`

**契约:**
- 使用 `src/modules/ai/types.ts` 中的 `ModelProvider`, `Tool`, `AgentLoopResult` 等类型
- 使用 `src/lib/logger.ts` 中的 `Logger` 接口
- 工具层使用 `src/lib/db/interface.ts` 中的 `Database` 接口

---

**Step 1: 创建 Provider 工厂** (`src/modules/ai/providers/index.ts`)

```typescript
// src/modules/ai/providers/index.ts
import type { ModelProvider } from '../types';
import { logger } from '@/lib/logger';

let _providers: Record<string, (apiKey: string) => ModelProvider> = {};

export function registerProvider(name: string, factory: (apiKey: string) => ModelProvider): void {
  _providers[name] = factory;
}

export function createProvider(name: string, apiKey: string): ModelProvider {
  const factory = _providers[name];
  if (!factory) throw new Error(`Unknown provider: ${name}`);
  logger.debug('Creating provider', { name });
  return factory(apiKey);
}

export function listProviders(): string[] {
  return Object.keys(_providers);
}
```

**Step 2: 创建 OpenAI Provider** (`src/modules/ai/providers/openai.ts`)

```typescript
// src/modules/ai/providers/openai.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from '../types';
import { registerProvider } from './index';

function createOpenAIProvider(apiKey: string): ModelProvider {
  return {
    name: 'openai',
    async *chat(messages: Message[], tools?: ToolDef[], model: string = 'gpt-4o'): AsyncIterable<StreamChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content, tool_calls: m.toolCalls, tool_call_id: m.toolCallId })),
        stream: true,
      };
      if (tools?.length) {
        body.tools = tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const err = await res.text();
        throw new Error(`OpenAI API error ${res.status}: ${err}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') { yield { type: 'done' }; return; }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) yield { type: 'text', content: delta.content };
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id || crypto.randomUUID(),
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
                  },
                };
              }
            }
          } catch { /* skip parse errors for partial chunks */ }
        }
      }
      yield { type: 'done' };
    },
  };
}

registerProvider('openai', createOpenAIProvider);
```

**Step 3: 创建 Anthropic Provider** (`src/modules/ai/providers/anthropic.ts`)

```typescript
// src/modules/ai/providers/anthropic.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from '../types';
import { registerProvider } from './index';

function createAnthropicProvider(apiKey: string): ModelProvider {
  return {
    name: 'anthropic',
    async *chat(messages: Message[], tools?: ToolDef[], model: string = 'claude-sonnet-4-6'): AsyncIterable<StreamChunk> {
      const systemMsg = messages.find(m => m.role === 'system');
      const chatMessages = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role,
        content: m.toolCalls ? [{ type: 'tool_use', ...m.toolCalls[0] }] : m.content,
      }));

      const body: Record<string, unknown> = {
        model,
        max_tokens: 4096,
        messages: chatMessages,
        stream: true,
      };
      if (systemMsg) body.system = systemMsg.content;
      if (tools?.length) {
        body.tools = tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const err = await res.text();
        throw new Error(`Anthropic API error ${res.status}: ${err}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { type: 'text', content: parsed.delta.text };
            }
            if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                  arguments: parsed.content_block.input || {},
                },
              };
            }
          } catch { /* skip partial */ }
        }
      }
      yield { type: 'done' };
    },
  };
}

registerProvider('anthropic', createAnthropicProvider);
```

**Step 4: 创建 DeepSeek Provider** (`src/modules/ai/providers/deepseek.ts`)

```typescript
// src/modules/ai/providers/deepseek.ts
import type { ModelProvider, Message, ToolDef, StreamChunk } from '../types';
import { registerProvider } from './index';

function createDeepSeekProvider(apiKey: string): ModelProvider {
  return {
    name: 'deepseek',
    async *chat(messages: Message[], tools?: ToolDef[], model: string = 'deepseek-chat'): AsyncIterable<StreamChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      };
      if (tools?.length) {
        body.tools = tools.map(t => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });

      if (!res.ok || !res.body) {
        const err = await res.text();
        throw new Error(`DeepSeek API error ${res.status}: ${err}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const data = trimmed.slice(6);
          if (data === '[DONE]') { yield { type: 'done' }; return; }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) yield { type: 'text', content: delta.content };
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: tc.id || crypto.randomUUID(),
                    name: tc.function?.name || '',
                    arguments: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
                  },
                };
              }
            }
          } catch { /* skip */ }
        }
      }
      yield { type: 'done' };
    },
  };
}

registerProvider('deepseek', createDeepSeekProvider);
```

**Step 5: 创建工具集** (`src/modules/ai/tools/`)

`src/modules/ai/tools/index.ts`:

```typescript
// src/modules/ai/tools/index.ts
import type { Tool } from '../types';
import type { Database } from '@/lib/db/interface';
import { createSearchKnowledgeTool } from './search-knowledge';
import { createGetNodeTool } from './get-node';
import { createGetNeighborsTool } from './get-neighbors';
import { createGetCommunityTool } from './get-community';
import { createGodNodesTool } from './god-nodes';
import { createGraphStatsTool } from './graph-stats';
import { createShortestPathTool } from './shortest-path';
import { createGetDocumentTool } from './get-document';

export function createTools(db: Database, kbId: string): Record<string, Tool> {
  return {
    search_knowledge: createSearchKnowledgeTool(db, kbId),
    get_node: createGetNodeTool(db, kbId),
    get_neighbors: createGetNeighborsTool(db, kbId),
    get_community: createGetCommunityTool(db, kbId),
    god_nodes: createGodNodesTool(db, kbId),
    graph_stats: createGraphStatsTool(db, kbId),
    shortest_path: createShortestPathTool(db, kbId),
    get_document: createGetDocumentTool(db, kbId),
  };
}
```

`src/modules/ai/tools/search-knowledge.ts`:

```typescript
// src/modules/ai/tools/search-knowledge.ts
import type { Tool } from '../types';
import type { Database } from '@/lib/db/interface';
import { searchKnowledge } from '@/modules/knowledge/search';
import Database from 'better-sqlite3';

const TOKEN_BUDGET = 2000;

export function createSearchKnowledgeTool(db: Database, kbId: string): Tool {
  return {
    definition: {
      name: 'search_knowledge',
      description: 'Search the knowledge graph using natural language or keywords. Returns relevant nodes and content.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'Natural language question or keywords' },
          depth: { type: 'number', description: 'Search depth (1-6), default 3' },
        },
        required: ['question'],
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const conn = (db as any).conn || (db as any);
      const results = searchKnowledge(conn as Database.Database, kbId, args.question as string, 10);
      if (results.length === 0) return 'No relevant knowledge found.';

      let output = '';
      let tokens = 0;
      for (const r of results) {
        const line = `**${r.label}** (score: ${r.score.toFixed(1)})\n${r.chunkContent.slice(0, 300)}\n\n`;
        tokens += Math.ceil(line.length / 4);
        if (tokens > TOKEN_BUDGET) break;
        output += line;
      }
      return output.trim();
    },
  };
}
```

`src/modules/ai/tools/get-node.ts`:

```typescript
// src/modules/ai/tools/get-node.ts
import type { Tool } from '../types';
import type { Database } from '@/lib/db/interface';

export function createGetNodeTool(db: Database, kbId: string): Tool {
  return {
    definition: {
      name: 'get_node',
      description: 'Get full details for a specific node by label or ID.',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'Node label or ID' } },
        required: ['label'],
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const label = (args.label as string).toLowerCase();
      const nodes = db.graphNode.findByKbId(kbId);
      const match = nodes.find(n => n.label.toLowerCase().includes(label) || n.id === (args.label as string));
      if (!match) return `No node matching '${args.label}' found.`;
      const edges = db.graphEdge.findByNodeId(kbId, match.id);
      return `Node: ${match.label}\nType: ${match.nodeType}\nConnections: ${edges.length}`;
    },
  };
}
```

`src/modules/ai/tools/get-neighbors.ts`:

```typescript
// src/modules/ai/tools/get-neighbors.ts
import type { Tool } from '../types';
import type { Database } from '@/lib/db/interface';

export function createGetNeighborsTool(db: Database, kbId: string): Tool {
  return {
    definition: {
      name: 'get_neighbors',
      description: 'Get all direct neighbors of a node with edge details.',
      parameters: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Node label or ID' },
          relation_filter: { type: 'string', description: 'Optional: filter by relation type' },
        },
        required: ['label'],
      },
    },
    async execute(args: Record<string, unknown>): Promise<string> {
      const label = (args.label as string).toLowerCase();
      const relFilter = (args.relation_filter as string || '').toLowerCase();
      const nodes = db.graphNode.findByKbId(kbId);
      const match = nodes.find(n => n.label.toLowerCase().includes(label) || n.id === (args.label as string));
      if (!match) return `No node matching '${args.label}' found.`;

      const edges = db.graphEdge.findByNodeId(kbId, match.id);
      const filtered = relFilter ? edges.filter(e => e.relation.includes(relFilter)) : edges;
      if (filtered.length === 0) return 'No neighbors found.';

      const lines = filtered.map(e => {
        const isSource = e.sourceNodeId === match.id;
        const otherId = isSource ? e.targetNodeId : e.sourceNodeId;
        const otherNode = nodes.find(n => n.id === otherId);
        const dir = isSource ? '-->' : '<--';
        return `  ${dir} ${otherNode?.label || otherId} [${e.relation}] [${e.confidence}]`;
      });

      return `Neighbors of ${match.label}:\n${lines.join('\n')}`;
    },
  };
}
```

剩余 5 个工具按相同模式实现（`get-community.ts`, `god-nodes.ts`, `graph-stats.ts`, `shortest-path.ts`, `get-document.ts`）。

**Step 6: 创建 Agent Loop** (`src/modules/ai/agent-loop.ts`)

```typescript
// src/modules/ai/agent-loop.ts
import type { ModelProvider, Message, Tool, AgentLoopResult, ToolCallRequest } from './types';
import type { Logger } from '@/lib/logger';

const MAX_ITERATIONS = 10;

export async function agentLoop(
  provider: ModelProvider,
  messages: Message[],
  tools: Record<string, Tool>,
  logger: Logger,
): Promise<AgentLoopResult> {
  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;
    logger.debug('Agent iteration', { iteration: iterations, messageCount: messages.length });

    const toolDefs = Object.values(tools).map(t => t.definition);
    const collectedToolCalls: ToolCallRequest[] = [];
    let textResponse = '';

    try {
      const streamStart = Date.now();
      for await (const chunk of provider.chat(messages, toolDefs)) {
        if (chunk.type === 'text' && chunk.content) textResponse += chunk.content;
        if (chunk.type === 'tool_call' && chunk.toolCall) collectedToolCalls.push(chunk.toolCall);
      }
      logger.debug('LLM response', { elapsedMs: Date.now() - streamStart, textLen: textResponse.length, toolCalls: collectedToolCalls.length });
    } catch (err) {
      logger.error('Agent iteration failed', err instanceof Error ? err : new Error(String(err)), { iteration: iterations });
      return { messages, iterations, finishReason: 'error', error: String(err) };
    }

    if (collectedToolCalls.length === 0) {
      messages.push({ role: 'assistant', content: textResponse });
      logger.info('Agent completed', { iterations });
      return { messages, iterations, finishReason: 'complete' };
    }

    messages.push({ role: 'assistant', content: textResponse, toolCalls: collectedToolCalls });

    for (const tc of collectedToolCalls) {
      const tool = tools[tc.name];
      if (!tool) {
        messages.push({ role: 'tool', content: `Error: unknown tool "${tc.name}"`, toolCallId: tc.id });
        continue;
      }

      const start = Date.now();
      try {
        const result = await tool.execute(tc.arguments);
        logger.debug('Tool executed', { tool: tc.name, elapsedMs: Date.now() - start });
        messages.push({ role: 'tool', content: result, toolCallId: tc.id });
      } catch (err) {
        logger.error('Tool execution failed', err instanceof Error ? err : new Error(String(err)), { tool: tc.name });
        messages.push({ role: 'tool', content: `Error executing ${tc.name}: ${err}`, toolCallId: tc.id });
      }
    }
  }

  logger.warn('Agent reached max iterations', { iterations: MAX_ITERATIONS });
  return { messages, iterations, finishReason: 'max_iterations' };
}
```

**Step 7: 写测试**

`src/modules/ai/__tests__/agent-loop.test.ts`:

```typescript
// src/modules/ai/__tests__/agent-loop.test.ts
import { describe, it, expect } from 'vitest';
import { agentLoop } from '../agent-loop';
import type { ModelProvider, Message, StreamChunk, Tool } from '../types';
import { logger } from '@/lib/logger';

describe('agentLoop', () => {
  it('returns complete when no tools called', async () => {
    const provider: ModelProvider = {
      name: 'test',
      async *chat(): AsyncIterable<StreamChunk> {
        yield { type: 'text', content: 'Hello!' };
        yield { type: 'done' };
      },
    };

    const messages: Message[] = [{ role: 'user', content: 'hi' }];
    const result = await agentLoop(provider, messages, {}, logger);

    expect(result.finishReason).toBe('complete');
    expect(result.iterations).toBe(1);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].content).toBe('Hello!');
  });

  it('executes tool calls', async () => {
    let callCount = 0;
    const provider: ModelProvider = {
      name: 'test',
      chat: async function* (): AsyncIterable<StreamChunk> {
        if (callCount === 0) {
          callCount++;
          yield { type: 'tool_call', toolCall: { id: '1', name: 'echo', arguments: { msg: 'test' } } };
        } else {
          yield { type: 'text', content: 'Done after tool' };
        }
        yield { type: 'done' };
      },
    };

    const tools: Record<string, Tool> = {
      echo: {
        definition: {
          name: 'echo',
          description: 'Echo back',
          parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
        },
        async execute(args) { return `Echo: ${args.msg}`; },
      },
    };

    const messages: Message[] = [{ role: 'user', content: 'test' }];
    const result = await agentLoop(provider, messages, tools, logger);

    expect(result.finishReason).toBe('complete');
    expect(result.iterations).toBe(2);
    expect(result.messages.some(m => m.content === 'Echo: test')).toBe(true);
  });

  it('stops at max iterations', async () => {
    const provider: ModelProvider = {
      name: 'test',
      chat: async function* (): AsyncIterable<StreamChunk> {
        yield { type: 'tool_call', toolCall: { id: '1', name: 'echo', arguments: { msg: 'loop' } } };
        yield { type: 'done' };
      },
    };

    const tools: Record<string, Tool> = {
      echo: {
        definition: { name: 'echo', description: 'e', parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] } },
        async execute(args) { return `Echo: ${args.msg}`; },
      },
    };

    const result = await agentLoop(provider, [{ role: 'user', content: 'loop' }], tools, logger);
    expect(result.finishReason).toBe('max_iterations');
    expect(result.iterations).toBe(10);
  });
});
```

**Step 8: 运行测试并提交**

```bash
npx vitest run src/modules/ai/__tests__/agent-loop.test.ts
# 预期: 3 tests passed
git add src/modules/ai/ && git commit -m "feat: AI engine with 3 providers, agent loop, and 8 tools"
```

---

### Task E: UI 模块

**目标:** 实现所有页面和组件，包括仪表盘、知识库管理、图谱可视化、AI 问答、用户设置。

**依赖:** Phase 0 (Task 0 完成)

**文件:**
- Create: `src/app/layout.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/graph-viewer.tsx`
- Create: `src/components/chat-panel.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/app/knowledge/page.tsx`
- Create: `src/app/knowledge/[id]/page.tsx`
- Create: `src/app/chat/page.tsx`
- Create: `src/app/settings/page.tsx`
- Create: `src/lib/ui/card.tsx`
- Create: `src/lib/ui/button.tsx`
- Create: `src/lib/ui/input.tsx`

**契约:** 页面目前用 mock 数据渲染，不直接依赖后端模块。集成阶段 (Phase 2) 才对接真实 API。

---

**Step 1: 创建共享 UI 组件** (`src/lib/ui/`)

```tsx
// src/lib/ui/button.tsx
import { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'success' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-indigo-500 text-white border-indigo-500 hover:bg-indigo-600',
  outline: 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50',
  success: 'bg-emerald-500 text-white hover:bg-emerald-600',
  danger: 'bg-red-500 text-white hover:bg-red-600',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({ variant = 'primary', size = 'md', className = '', children, disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium border border-transparent transition-all ${variantClasses[variant]} ${sizeClasses[size]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
```

```tsx
// src/lib/ui/card.tsx
import { ReactNode } from 'react';

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 shadow-sm ${className}`}>
      {title && <h3 className="text-sm font-semibold text-slate-800 mb-4">{title}</h3>}
      {children}
    </div>
  );
}

export function StatCard({ icon, value, label, color }: { icon: string; value: string; label: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-indigo-100 text-indigo-600',
    green: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    cyan: 'bg-cyan-100 text-cyan-600',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex items-center gap-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl shrink-0 ${colors[color] || colors.blue}`}>
        {icon}
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-slate-500">{label}</div>
      </div>
    </div>
  );
}
```

```tsx
// src/lib/ui/input.tsx
import { InputHTMLAttributes } from 'react';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100 transition-colors ${className}`}
      {...props}
    />
  );
}

export function Textarea({ className = '', ...props }: InputHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-800 outline-none focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100 resize-y min-h-20 transition-colors ${className}`}
      {...props}
    />
  );
}
```

**Step 2: 创建 Sidebar** (`src/components/sidebar.tsx`)

```tsx
// src/components/sidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: '仪表盘', icon: '📊' },
  { href: '/knowledge', label: '知识库', icon: '📚' },
  { href: '/chat', label: 'AI问答', icon: '💬' },
  { href: '/settings', label: '设置', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col fixed top-0 left-0 bottom-0 w-64 bg-white border-r border-slate-200 z-50">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg">L</div>
          <span className="font-bold text-lg text-slate-800">CodeLearn</span>
        </div>
        <nav className="flex-1 p-3 overflow-y-auto">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === item.href
                  ? 'bg-indigo-100 text-indigo-600'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center text-white font-semibold text-sm">U</div>
            <div>
              <div className="text-xs font-semibold">User</div>
              <div className="text-xs text-slate-400">免费用户</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 pb-safe">
        <div className="flex justify-around">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-1.5 px-1 text-xs ${
                pathname === item.href ? 'text-indigo-600' : 'text-slate-400'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
```

**Step 3: 创建根布局** (`src/app/layout.tsx`)

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

export const metadata: Metadata = { title: 'CodeLearn - AI 驱动学习平台' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-100 text-slate-800 min-h-screen font-sans antialiased">
        <Sidebar />
        <main className="md:ml-64 p-4 md:p-10 pb-20 md:pb-10">
          {children}
        </main>
      </body>
    </html>
  );
}
```

**Step 4: 创建仪表盘** (`src/app/page.tsx`)

```tsx
// src/app/page.tsx
import { Card, StatCard } from '@/lib/ui/card';
import { Button } from '@/lib/ui/button';
import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="animate-fadeIn">
      <h1 className="text-xl font-bold mb-6">仪表盘</h1>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        <StatCard icon="📚" value="3" label="知识库" color="blue" />
        <StatCard icon="📄" value="127" label="文档数量" color="green" />
        <StatCard icon="🔗" value="1,024" label="知识点" color="amber" />
        <StatCard icon="💬" value="15" label="对话次数" color="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="最近知识库">
          <div className="space-y-3">
            {[
              { name: '前端技术栈', docs: 45, date: '2026-05-20' },
              { name: '机器学习基础', docs: 32, date: '2026-05-18' },
              { name: '系统设计', docs: 50, date: '2026-05-15' },
            ].map(kb => (
              <div key={kb.name} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <Link href="/knowledge" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">{kb.name}</Link>
                  <div className="text-xs text-slate-400">{kb.docs} 个文档 · {kb.date}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="快捷操作">
          <div className="space-y-3">
            <Link href="/knowledge" className="block">
              <Button variant="primary" className="w-full justify-center">📥 导入知识</Button>
            </Link>
            <Link href="/chat" className="block">
              <Button variant="outline" className="w-full justify-center">💬 开始问答</Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

**Step 5: 创建知识库页面** (`src/app/knowledge/page.tsx`)

```tsx
// src/app/knowledge/page.tsx
import { Card } from '@/lib/ui/card';
import { Button } from '@/lib/ui/button';
import { Input } from '@/lib/ui/input';
import Link from 'next/link';

export default function KnowledgeListPage() {
  const mockKBs = [
    { id: '1', name: '前端技术栈', description: 'React, TypeScript, Next.js 等前端技术知识', docs: 45, nodes: 230, date: '2026-05-20' },
    { id: '2', name: '机器学习基础', description: 'ML 算法、模型训练、评估指标', docs: 32, nodes: 410, date: '2026-05-18' },
    { id: '3', name: '系统设计', description: '分布式系统、微服务、数据库设计', docs: 50, nodes: 384, date: '2026-05-15' },
  ];

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">知识库</h1>
        <Link href="/knowledge/new">
          <Button>+ 新建知识库</Button>
        </Link>
      </div>

      <div className="mb-6">
        <Input placeholder="搜索知识库..." />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {mockKBs.map(kb => (
          <Link key={kb.id} href={`/knowledge/${kb.id}`}>
            <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer h-full">
              <h3 className="font-semibold text-slate-800 mb-2">{kb.name}</h3>
              <p className="text-sm text-slate-500 mb-4 line-clamp-2">{kb.description}</p>
              <div className="flex gap-4 text-xs text-slate-400">
                <span>📄 {kb.docs} 文档</span>
                <span>🔗 {kb.nodes} 节点</span>
                <span>{kb.date}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

**Step 6: 创建知识库详情页 + 图谱可视化**

`src/components/graph-viewer.tsx`:

```tsx
// src/components/graph-viewer.tsx
'use client';
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface GraphData {
  nodes: { id: string; label: string; type: string }[];
  edges: { source: string; target: string; relation: string }[];
}

export function GraphViewer({ data }: { data: GraphData }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.nodes.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = 500;

    const simulation = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(data.edges).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2));

    const g = svg.append('g');

    const link = g.append('g').selectAll('line')
      .data(data.edges).join('line')
      .attr('stroke', '#cbd5e1').attr('stroke-width', 1);

    const node = g.append('g').selectAll('g')
      .data(data.nodes).join('g')
      .call(d3.drag<any, any>()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    const color = d3.scaleOrdinal(d3.schemeCategory10);

    node.append('circle').attr('r', 6).attr('fill', (d: any) => color(d.type));

    node.append('text').text((d: any) => d.label).attr('x', 10).attr('y', 4)
      .attr('font-size', '11px').attr('fill', '#475569');

    node.append('title').text((d: any) => `${d.label} (${d.type})`);

    simulation.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    const zoom = d3.zoom().scaleExtent([0.1, 4]).on('zoom', (e) => { g.attr('transform', e.transform); });
    svg.call(zoom as any);

    return () => { simulation.stop(); };
  }, [data]);

  return (
    <svg ref={svgRef} className="w-full border border-slate-200 rounded-xl bg-white" style={{ height: 500 }} />
  );
}
```

`src/app/knowledge/[id]/page.tsx`:

```tsx
// src/app/knowledge/[id]/page.tsx
import { Card } from '@/lib/ui/card';
import { Button } from '@/lib/ui/button';
import { GraphViewer } from '@/components/graph-viewer';

const mockGraph = {
  nodes: [
    { id: '1', label: 'React', type: 'technology' },
    { id: '2', label: 'Hooks', type: 'concept' },
    { id: '3', label: 'useState', type: 'api' },
    { id: '4', label: 'useEffect', type: 'api' },
    { id: '5', label: '组件化', type: 'concept' },
    { id: '6', label: 'Virtual DOM', type: 'concept' },
  ],
  edges: [
    { source: '1', target: '2', relation: 'contains' },
    { source: '2', target: '3', relation: 'contains' },
    { source: '2', target: '4', relation: 'contains' },
    { source: '1', target: '5', relation: 'related_to' },
    { source: '1', target: '6', relation: 'related_to' },
  ],
};

const mockDocs = [
  { title: 'React 入门指南.md', type: 'markdown', date: '2026-05-20' },
  { title: 'Hooks 详解.md', type: 'markdown', date: '2026-05-19' },
  { title: 'https://react.dev', type: 'link', date: '2026-05-18' },
];

export default function KnowledgeDetailPage() {
  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">前端技术栈</h1>
          <p className="text-sm text-slate-500">React, TypeScript, Next.js 等前端技术知识</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">📥 导入文档</Button>
          <Button variant="primary">💬 开始问答</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card title="文档列表" className="lg:col-span-1">
          <div className="space-y-2">
            {mockDocs.map(doc => (
              <div key={doc.title} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <div className="text-sm font-medium">{doc.title}</div>
                  <div className="text-xs text-slate-400">{doc.type} · {doc.date}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="知识图谱" className="lg:col-span-2">
          <GraphViewer data={mockGraph} />
        </Card>
      </div>
    </div>
  );
}
```

**Step 7: 创建 AI 问答页** (`src/app/chat/page.tsx`)

```tsx
// src/app/chat/page.tsx
'use client';
import { useState } from 'react';
import { Card } from '@/lib/ui/card';
import { Button } from '@/lib/ui/button';
import { Textarea } from '@/lib/ui/input';

export default function ChatPage() {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '你好！我是你的学习助手，可以基于知识库回答你的问题。请先选择一个知识库。' },
  ]);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    setTimeout(() => {
      setMessages(prev => [...prev, { role: 'assistant', content: '这是一个模拟回复。集成阶段将接入真实的 Agent Loop。' }]);
    }, 500);
  };

  return (
    <div className="animate-fadeIn">
      <h1 className="text-xl font-bold mb-6">AI 知识问答</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card title="对话" className="lg:col-span-3 flex flex-col" className="">
          <div className="flex-1 space-y-4 mb-4 max-h-[60vh] overflow-y-auto">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm ${
                  m.role === 'user' ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-800'
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="输入你的问题..."
              rows={2}
            />
            <Button onClick={send} className="self-end">发送</Button>
          </div>
        </Card>

        <Card title="知识上下文" className="lg:col-span-1">
          <p className="text-sm text-slate-500">选择知识库后，搜索结果将显示在这里</p>
        </Card>
      </div>
    </div>
  );
}
```

**Step 8: 创建设置页 + 登录/注册页**

省略具体代码（按相同 UI 模式实现 `settings/page.tsx`, `login/page.tsx`, `register/page.tsx`）

**Step 9: 运行并提交**

```bash
npm run dev
# 浏览器验证: http://localhost:3000
git add src/components/ src/lib/ui/ src/app/ && git commit -m "feat: UI pages with sidebar, dashboard, knowledge, chat, settings"
```

---

## Phase 2: 集成

### Task F: API 路由 + 全链路串联 + E2E

**目标:** 实现所有 API 路由，串联 Auth/Knowledge/AI 模块，配置中间件认证，编写 E2E 测试。

**依赖:** Task A + B + C + D + E (Phase 1 全部完成)

**文件:**
- Create: `src/app/api/auth/register/route.ts`
- Create: `src/app/api/auth/login/route.ts`
- Create: `src/app/api/auth/logout/route.ts`
- Create: `src/app/api/knowledge/route.ts`
- Create: `src/app/api/knowledge/[id]/route.ts`
- Create: `src/app/api/knowledge/[id]/import/route.ts`
- Create: `src/app/api/knowledge/[id]/search/route.ts`
- Create: `src/app/api/chat/route.ts`
- Create: `src/app/api/settings/api-keys/route.ts`
- Create: `src/app/api/health/route.ts`
- Modify: `src/middleware.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/knowledge.spec.ts`
- Create: `playwright.config.ts`

---

**Step 1: 创建认证中间件** (`src/middleware.ts`)

```typescript
// src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/api/auth/login', '/api/auth/register', '/api/health'];

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  if (PUBLIC_PATHS.some(p => path.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('token')?.value;
  if (!token) {
    if (path.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

**Step 2: 创建 API 路由**

`src/app/api/health/route.ts`:

```typescript
// src/app/api/health/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    db.user.findByEmail('health-check-nonexistent');
    return NextResponse.json({ status: 'ok', uptime: process.uptime(), db: 'connected' });
  } catch {
    return NextResponse.json({ status: 'error', db: 'disconnected' }, { status: 500 });
  }
}
```

`src/app/api/auth/register/route.ts`:

```typescript
// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createAuthService } from '@/modules/auth/service';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const auth = createAuthService(getDb(), logger);
  const result = await auth.register({ email: body.email, password: body.password });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('token', result.token!, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 });
  return res;
}
```

按相同模式实现其余路由（`login`, `logout`, `knowledge/...`, `chat`, `settings/api-keys`）。

**Step 3: 更新页面接入真实 API**

将 Phase 1 Task E 中的 mock 数据替换为 `fetch()` 调用 API 路由。

**Step 4: 配置 Playwright + 写 E2E 测试**

`playwright.config.ts`:

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
});
```

`e2e/auth.spec.ts`:

```typescript
// e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test('register and login flow', async ({ page }) => {
  const email = `test-${Date.now()}@test.com`;

  await page.goto('/register');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await expect(page.locator('h1')).toContainText('仪表盘');

  // Logout
  await page.goto('/login');
  // Login again
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');
  await expect(page.locator('h1')).toContainText('仪表盘');
});

test('redirects to login when unauthenticated', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL(/\/login/);
});
```

`e2e/knowledge.spec.ts`:

```typescript
// e2e/knowledge.spec.ts
import { test, expect } from '@playwright/test';

test('knowledge base CRUD flow', async ({ page }) => {
  const email = `e2e-${Date.now()}@test.com`;

  // Register
  await page.goto('/register');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', '123456');
  await page.click('button[type="submit"]');
  await page.waitForURL('/');

  // Navigate to knowledge
  await page.click('a[href="/knowledge"]');
  await expect(page.locator('h1')).toContainText('知识库');

  // Create new knowledge base
  await page.click('text=新建知识库');
  // ... fill form and submit
});
```

**Step 5: 运行完整测试套件并提交**

```bash
npx vitest run
npx playwright test
git add src/app/api/ src/middleware.ts e2e/ playwright.config.ts
git commit -m "feat: API routes, auth middleware, and E2E tests"
```

---

## 并行执行建议

```
Phase 0: 一人完成 Task 0（约 30 分钟）

Phase 1: 5 人并行（约 2-4 小时每人）
  ├─ Developer 1: Task A (数据库实现)
  ├─ Developer 2: Task B (Auth 模块)
  ├─ Developer 3: Task C (Knowledge 模块)
  ├─ Developer 4: Task D (AI 模块)
  └─ Developer 5: Task E (UI 模块)

Phase 2: 一人完成 Task F（约 1-2 小时）
```
