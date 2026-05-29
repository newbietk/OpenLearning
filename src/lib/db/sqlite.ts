import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { eq, and, like } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as schema from './schema';
import type {
  Database as IDatabase,
  KnowledgeBaseRecord,
  PlatformAdminRecord,
  LlmProviderRecord,
  ChatSessionRecord,
  ChatMessageRecord,
} from './interface';
import type { DocumentRecord, DocumentChunkRecord, GraphNodeRecord, GraphEdgeRecord } from '../../core/pipeline/types';

// DB path — can be overridden for tests
let _dbPath: string | null = null;

export function setDbPath(p: string): void {
  _dbPath = p;
}

function getDbPath(): string {
  if (_dbPath) return _dbPath;
  return path.join(process.cwd(), 'data', 'knowledge.db');
}

async function loadDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs({
    locateFile: () => {
      return path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
    },
  });
  if (fs.existsSync(getDbPath())) {
    const buffer = fs.readFileSync(getDbPath());
    return new SQL.Database(buffer);
  }
  return new SQL.Database();
}

function saveDatabase(sqldb: SqlJsDatabase): void {
  const data = sqldb.export();
  const buffer = Buffer.from(data);
  const p = getDbPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, buffer);
}

let _db: IDatabase | null = null;
let _sqldb: SqlJsDatabase | null = null;

export async function getDb(): Promise<IDatabase> {
  if (_db) return _db;
  _db = await createSqliteDatabase();
  return _db;
}

export async function createSqliteDatabase(): Promise<IDatabase> {
  const sqldb = await loadDatabase();
  _sqldb = sqldb;
  const db = drizzle(sqldb, { schema });

  // Create tables
  sqldb.run(`CREATE TABLE IF NOT EXISTS knowledge_bases (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', kb_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS platform_admins (
    id TEXT PRIMARY KEY, external_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    title TEXT NOT NULL, source_type TEXT NOT NULL, source_url TEXT, file_path TEXT,
    file_size INTEGER, status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT, parsed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL, content_text TEXT NOT NULL, token_count INTEGER NOT NULL
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    label TEXT NOT NULL, node_type TEXT NOT NULL, source_doc_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    external_user_id TEXT NOT NULL, title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, tool_calls TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  sqldb.run(`CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY, external_user_id TEXT NOT NULL,
    provider TEXT NOT NULL, api_key_encrypted TEXT NOT NULL,
    base_url TEXT, enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  function toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  }

  function mapKeys<T>(row: Record<string, unknown>): T {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(row)) {
      result[toCamelCase(key)] = row[key];
    }
    return result as T;
  }

  function query<T = any>(sql: string, params: any[] = []): T[] {
    const stmt = sqldb.prepare(sql);
    stmt.bind(params);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(mapKeys<T>(stmt.getAsObject() as Record<string, unknown>));
    }
    stmt.free();
    return rows;
  }

  function run(sql: string, params: any[] = []): void {
    sqldb.run(sql, params);
    saveDatabase(sqldb);
  }

  function uuid(): string {
    return crypto.randomUUID();
  }

  function now(): string {
    return new Date().toISOString();
  }

  const database: IDatabase = {
    knowledgeBase: {
      findById(id) {
        const rows = query<KnowledgeBaseRecord>('SELECT * FROM knowledge_bases WHERE id = ?', [id]);
        return rows[0];
      },
      findAll() {
        return query<KnowledgeBaseRecord>('SELECT * FROM knowledge_bases ORDER BY created_at DESC');
      },
      findByOwner(ownerId) {
        return query<KnowledgeBaseRecord>('SELECT * FROM knowledge_bases WHERE owner_id = ? ORDER BY created_at DESC', [ownerId]);
      },
      findByType(kbType) {
        return query<KnowledgeBaseRecord>('SELECT * FROM knowledge_bases WHERE kb_type = ? ORDER BY created_at DESC', [kbType]);
      },
      create(data) {
        const id = uuid();
        const ts = now();
        run('INSERT INTO knowledge_bases (id, owner_id, name, description, kb_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, data.ownerId, data.name, data.description, data.kbType, ts]);
        return { id, ...data, createdAt: ts };
      },
      update(id, data) {
        if (data.name !== undefined) run('UPDATE knowledge_bases SET name = ? WHERE id = ?', [data.name, id]);
        if (data.description !== undefined) run('UPDATE knowledge_bases SET description = ? WHERE id = ?', [data.description, id]);
        return database.knowledgeBase.findById(id)!;
      },
      delete(id) {
        run('DELETE FROM knowledge_bases WHERE id = ?', [id]);
      },
    },

    platformAdmin: {
      findAll() { return query<PlatformAdminRecord>('SELECT * FROM platform_admins ORDER BY created_at DESC'); },
      findByExternalId(externalId) {
        const rows = query<PlatformAdminRecord>('SELECT * FROM platform_admins WHERE external_id = ?', [externalId]);
        return rows[0];
      },
      create(externalId) {
        const id = uuid();
        const ts = now();
        run('INSERT INTO platform_admins (id, external_id, created_at) VALUES (?, ?, ?)', [id, externalId, ts]);
        return { id, externalId, createdAt: ts };
      },
      deleteByExternalId(externalId) {
        run('DELETE FROM platform_admins WHERE external_id = ?', [externalId]);
      },
    },

    document: {
      findById(id) {
        const rows = query<DocumentRecord>('SELECT * FROM documents WHERE id = ?', [id]);
        return rows[0];
      },
      findByKbId(kbId) {
        return query<DocumentRecord>('SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC', [kbId]);
      },
      create(data) {
        const id = uuid();
        const ts = now();
        run(`INSERT INTO documents (id, kb_id, title, source_type, source_url, file_path, file_size, status, error_message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, data.kbId, data.title, data.sourceType, data.sourceUrl ?? null, data.filePath ?? null,
           data.fileSize ?? null, data.status ?? 'pending', data.errorMessage ?? null, ts]);
        return { id, ...data, createdAt: ts, errorMessage: data.errorMessage ?? null, sourceUrl: data.sourceUrl ?? null, filePath: data.filePath ?? null, fileSize: data.fileSize ?? null, parsedAt: null, status: data.status ?? 'pending' as DocumentRecord['status'] };
      },
      updateStatus(id, status, errorMessage) {
        run('UPDATE documents SET status = ?, error_message = ?, parsed_at = CASE WHEN ? = ? THEN ? END WHERE id = ?',
          [status, errorMessage ?? null, status, 'done', now(), id]);
      },
      delete(id) { run('DELETE FROM documents WHERE id = ?', [id]); },
    },

    documentChunk: {
      findByDocId(docId) {
        return query<DocumentChunkRecord>('SELECT * FROM document_chunks WHERE doc_id = ? ORDER BY chunk_index', [docId]);
      },
      batchCreate(chunks) {
        for (const c of chunks) {
          const id = uuid();
          run('INSERT INTO document_chunks (id, doc_id, chunk_index, content_text, token_count) VALUES (?, ?, ?, ?, ?)',
            [id, c.docId, c.chunkIndex, c.contentText, c.tokenCount]);
        }
      },
      deleteByDocId(docId) { run('DELETE FROM document_chunks WHERE doc_id = ?', [docId]); },
    },

    graphNode: {
      findByKbId(kbId) {
        return query<Record<string, unknown>>('SELECT *, json(metadata) as metadata FROM graph_nodes WHERE kb_id = ?', [kbId])
          .map((r: Record<string, unknown>) => parseNodeMeta(r) as unknown as GraphNodeRecord);
      },
      findByLabel(kbId, label) {
        const rows = query<Record<string, unknown>>('SELECT *, json(metadata) as metadata FROM graph_nodes WHERE kb_id = ? AND label = ?', [kbId, label])
          .map((r: Record<string, unknown>) => parseNodeMeta(r) as unknown as GraphNodeRecord);
        return rows[0];
      },
      findNeighbors(nodeId, kbId) {
        const edges = query<{target_node_id: string}>('SELECT DISTINCT target_node_id FROM graph_edges WHERE kb_id = ? AND source_node_id = ?', [kbId, nodeId]);
        if (edges.length === 0) return [];
        const ids = edges.map(e => `'${e.target_node_id}'`).join(',');
        return query<Record<string, unknown>>(`SELECT *, json(metadata) as metadata FROM graph_nodes WHERE id IN (${ids})`)
          .map((r: Record<string, unknown>) => parseNodeMeta(r) as unknown as GraphNodeRecord);
      },
      search(kbId, queryTerm) {
        return query<Record<string, unknown>>(
          `SELECT *, json(metadata) as metadata FROM graph_nodes WHERE kb_id = ? AND (label LIKE ? OR node_type LIKE ?) LIMIT 20`,
          [kbId, `%${queryTerm}%`, `%${queryTerm}%`]
        ).map((r: Record<string, unknown>) => parseNodeMeta(r) as unknown as GraphNodeRecord);
      },
      batchCreate(nodes): GraphNodeRecord[] {
        const result: GraphNodeRecord[] = [];
        for (const n of nodes) {
          const id = uuid();
          const ts = now();
          const metaStr = JSON.stringify(n.metadata ?? {});
          run('INSERT INTO graph_nodes (id, kb_id, label, node_type, source_doc_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, n.kbId, n.label, n.nodeType, n.sourceDocId ?? null, metaStr, ts]);
          result.push({ id, kbId: n.kbId, label: n.label, nodeType: n.nodeType, sourceDocId: n.sourceDocId ?? null, metadata: n.metadata ?? {}, createdAt: ts });
        }
        return result;
      },
      deleteByKbId(kbId) { run('DELETE FROM graph_nodes WHERE kb_id = ?', [kbId]); },
    },

    graphEdge: {
      findByKbId(kbId) {
        return query<GraphEdgeRecord>('SELECT * FROM graph_edges WHERE kb_id = ?', [kbId]);
      },
      findByNode(nodeId, kbId) {
        return query<GraphEdgeRecord>('SELECT * FROM graph_edges WHERE kb_id = ? AND source_node_id = ?', [kbId, nodeId]);
      },
      batchCreate(edges) {
        for (const e of edges) {
          const id = uuid();
          const ts = now();
          run('INSERT INTO graph_edges (id, kb_id, source_node_id, target_node_id, relation, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, e.kbId, e.sourceNodeId, e.targetNodeId, e.relation, e.confidence, ts]);
        }
      },
      deleteByKbId(kbId) { run('DELETE FROM graph_edges WHERE kb_id = ?', [kbId]); },
    },

    chat: {
      createSession(data) {
        const id = uuid();
        const ts = now();
        run('INSERT INTO chat_sessions (id, kb_id, external_user_id, title, created_at) VALUES (?, ?, ?, ?, ?)',
          [id, data.kbId, data.externalUserId, data.title, ts]);
        return { id, ...data, createdAt: ts };
      },
      findSessionById(id) {
        const rows = query<ChatSessionRecord>('SELECT * FROM chat_sessions WHERE id = ?', [id]);
        return rows[0];
      },
      findSessionsByUser(externalUserId) {
        return query<ChatSessionRecord>('SELECT * FROM chat_sessions WHERE external_user_id = ? ORDER BY created_at DESC', [externalUserId]);
      },
      addMessage(data) {
        const id = uuid();
        const ts = now();
        run('INSERT INTO chat_messages (id, session_id, role, content, tool_calls, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, data.sessionId, data.role, data.content, data.toolCalls ?? null, ts]);
        return { id, ...data, createdAt: ts };
      },
      findMessagesBySession(sessionId) {
        return query<ChatMessageRecord>('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC', [sessionId]);
      },
      deleteSession(id) { run('DELETE FROM chat_sessions WHERE id = ?', [id]); },
    },

    llmProvider: {
      findByUser(externalUserId) {
        return query<LlmProviderRecord>('SELECT * FROM llm_providers WHERE external_user_id = ? ORDER BY created_at DESC', [externalUserId]);
      },
      findEnabled(externalUserId, provider) {
        const rows = query<LlmProviderRecord>('SELECT * FROM llm_providers WHERE external_user_id = ? AND provider = ? AND enabled = 1', [externalUserId, provider]);
        return rows[0];
      },
      create(data) {
        const id = uuid();
        const ts = now();
        run('INSERT INTO llm_providers (id, external_user_id, provider, api_key_encrypted, base_url, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, data.externalUserId, data.provider, data.apiKeyEncrypted, data.baseUrl ?? null, data.enabled ? 1 : 0, ts]);
        return { id, ...data, baseUrl: data.baseUrl ?? null, createdAt: ts };
      },
      update(id, data) {
        if (data.apiKeyEncrypted !== undefined) run('UPDATE llm_providers SET api_key_encrypted = ? WHERE id = ?', [data.apiKeyEncrypted, id]);
        if (data.baseUrl !== undefined) run('UPDATE llm_providers SET base_url = ? WHERE id = ?', [data.baseUrl, id]);
        if (data.enabled !== undefined) run('UPDATE llm_providers SET enabled = ? WHERE id = ?', [data.enabled ? 1 : 0, id]);
      },
      delete(id) { run('DELETE FROM llm_providers WHERE id = ?', [id]); },
    },

    async transaction<T>(fn: (db: IDatabase) => Promise<T>): Promise<T> {
      const result = await fn(database);
      saveDatabase(sqldb);
      return result;
    },
  };

  // Sync env var admins
  const envAdmins = (process.env.PLATFORM_ADMINS || '').split(',').filter(Boolean);
  for (const extId of envAdmins) {
    if (!database.platformAdmin.findByExternalId(extId)) {
      database.platformAdmin.create(extId);
    }
  }

  saveDatabase(sqldb);
  return database;
}

function parseNodeMeta(row: Record<string, unknown>): Record<string, unknown> {
  const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : (row.metadata ?? {});
  return { ...row, metadata: meta };
}
