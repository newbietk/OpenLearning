import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Database as IDatabase } from '../db/interface';

describe('SqliteDatabase (sql.js)', () => {
  let db: IDatabase;
  let tmpPath: string;

  beforeEach(async () => {
    vi.resetModules();
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    tmpPath = path.join(os.tmpdir(), `test-kb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    const { setDbPath, createSqliteDatabase } = await import('../db/sqlite');
    setDbPath(tmpPath);
    db = await createSqliteDatabase();
  });

  afterEach(() => {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
  });

  it('should create and find a knowledge base', () => {
    const kb = db.knowledgeBase.create({
      ownerId: 'user1',
      name: 'Test KB',
      description: 'A test',
      kbType: 'private',
    });
    expect(kb.id).toBeDefined();
    expect(kb.name).toBe('Test KB');

    const found = db.knowledgeBase.findById(kb.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test KB');
  });

  it('should find by type', () => {
    db.knowledgeBase.create({ ownerId: 'u1', name: 'Public KB', description: '', kbType: 'public' });
    db.knowledgeBase.create({ ownerId: 'u2', name: 'Private KB', description: '', kbType: 'private' });
    const publicKbs = db.knowledgeBase.findByType('public');
    expect(publicKbs.length).toBe(1);
    expect(publicKbs[0].name).toBe('Public KB');
  });

  it('should manage platform admins', () => {
    const admin = db.platformAdmin.create('admin-user-1');
    expect(admin.externalId).toBe('admin-user-1');

    const found = db.platformAdmin.findByExternalId('admin-user-1');
    expect(found).toBeDefined();

    db.platformAdmin.deleteByExternalId('admin-user-1');
    expect(db.platformAdmin.findByExternalId('admin-user-1')).toBeUndefined();
  });

  it('should create and update documents', () => {
    const kb = db.knowledgeBase.create({ ownerId: 'u1', name: 'KB', description: '', kbType: 'private' });
    const doc = db.document.create({
      kbId: kb.id, title: 'doc1', sourceType: 'file',
      sourceUrl: null, filePath: '/tmp/test.txt', fileSize: 1024, status: 'pending', errorMessage: null, parsedAt: null,
    });
    expect(doc.id).toBeDefined();

    db.document.updateStatus(doc.id, 'done');
    const updated = db.document.findById(doc.id);
    expect(updated!.status).toBe('done');
  });

  it('should batch create chunks', () => {
    const kb = db.knowledgeBase.create({ ownerId: 'u1', name: 'KB', description: '', kbType: 'private' });
    const doc = db.document.create({
      kbId: kb.id, title: 'doc1', sourceType: 'text',
      sourceUrl: null, filePath: null, fileSize: null, status: 'pending', errorMessage: null, parsedAt: null,
    });
    db.documentChunk.batchCreate([
      { docId: doc.id, chunkIndex: 0, contentText: 'chunk A', tokenCount: 10 },
      { docId: doc.id, chunkIndex: 1, contentText: 'chunk B', tokenCount: 12 },
    ]);
    const chunks = db.documentChunk.findByDocId(doc.id);
    expect(chunks.length).toBe(2);
  });

  it('should batch create and search graph nodes', () => {
    const kb = db.knowledgeBase.create({ ownerId: 'u1', name: 'KB', description: '', kbType: 'private' });
    db.graphNode.batchCreate([
      { kbId: kb.id, label: 'React', nodeType: 'concept', sourceDocId: null, metadata: {} },
      { kbId: kb.id, label: 'TypeScript', nodeType: 'concept', sourceDocId: null, metadata: {} },
      { kbId: kb.id, label: 'Node.js', nodeType: 'runtime', sourceDocId: null, metadata: {} },
    ]);
    const results = db.graphNode.search(kb.id, 'Type');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should batch create graph edges', () => {
    const kb = db.knowledgeBase.create({ ownerId: 'u1', name: 'KB', description: '', kbType: 'private' });
    const nodes = db.graphNode.batchCreate([
      { kbId: kb.id, label: 'A', nodeType: 'type', sourceDocId: null, metadata: {} },
      { kbId: kb.id, label: 'B', nodeType: 'type', sourceDocId: null, metadata: {} },
    ]);
    db.graphEdge.batchCreate([
      { kbId: kb.id, sourceNodeId: nodes[0].id, targetNodeId: nodes[1].id, relation: 'depends_on', confidence: 0.9 },
    ]);
    const edges = db.graphEdge.findByKbId(kb.id);
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('depends_on');
  });

  it('should create chat session and messages', () => {
    const kb = db.knowledgeBase.create({ ownerId: 'u1', name: 'KB', description: '', kbType: 'private' });
    const session = db.chat.createSession({ kbId: kb.id, externalUserId: 'user1', title: 'Chat 1' });
    expect(session.id).toBeDefined();
    db.chat.addMessage({ sessionId: session.id, role: 'user', content: 'Hello', toolCalls: null });
    db.chat.addMessage({ sessionId: session.id, role: 'assistant', content: 'Hi there', toolCalls: null });
    const msgs = db.chat.findMessagesBySession(session.id);
    expect(msgs.length).toBe(2);
  });

  it('should manage LLM providers', () => {
    const p = db.llmProvider.create({
      externalUserId: 'user1', provider: 'openai',
      apiKeyEncrypted: 'encrypted_key', baseUrl: null, enabled: true,
    });
    const found = db.llmProvider.findEnabled('user1', 'openai');
    expect(found).toBeDefined();
    db.llmProvider.update(p.id, { enabled: false });
    expect(db.llmProvider.findEnabled('user1', 'openai')).toBeUndefined();
  });

  it('should support transactions', async () => {
    await db.transaction(async (tx) => {
      tx.knowledgeBase.create({ ownerId: 'u1', name: 'tx-kb', description: '', kbType: 'private' });
    });
    const all = db.knowledgeBase.findAll();
    expect(all.length).toBeGreaterThan(0);
  });
});
