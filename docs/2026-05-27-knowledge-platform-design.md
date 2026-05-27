# AI 驱动学习平台 — 整体设计文档

> 日期: 2026-05-27 | 状态: 已确认

## 概述

AI 驱动学习平台是一个多用户 Web 应用，支持从多种数据源构建知识图谱，并通过 AI Agent 在知识图谱上进行检索与问答。

### 核心功能

1. **知识库管理**: 多格式导入 → 结构化解析 → 知识图谱构建 → 可视化 → 检索
2. **基于知识库的内容生成**: Model Provider 适配 → Agent Loop → 图谱检索工具 → 知识问答
3. **链接自动更新**: URL 类知识点定时同步

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js (App Router) | 全栈应用，API Route + SSR |
| 语言 | TypeScript | 全栈类型安全 |
| 数据库 | SQLite (better-sqlite3) | MVP 轻量方案，通过抽象层预留扩展空间 |
| ORM | Drizzle ORM | 类型安全、轻量、SQL-like API |
| 日志 | pino | 轻量 JSON 日志 |
| 图谱可视化 | D3.js | 力导向图，参考 graphify 交互 |
| 测试 | Vitest + Playwright | 单元/集成 + E2E |
| 认证 | bcrypt + jose (JWT) | 密码哈希 + httpOnly cookie |
| 加密 | Node.js crypto (AES-256-GCM) | API Key 存储加密 |

---

## 一、项目结构

```
src/
├── app/                          # Next.js App Router
│   ├── layout.tsx                 # 根布局（Sidebar + 响应式）
│   ├── page.tsx                   # 仪表盘首页
│   ├── (auth)/login/              # 登录页
│   ├── (auth)/register/           # 注册页
│   ├── knowledge/                 # 知识库管理页
│   ├── knowledge/[id]/            # 知识库详情 + 图谱可视化
│   ├── chat/                      # AI 知识问答页
│   ├── settings/                  # 用户设置 (API Key)
│   └── api/                       # API 路由 (薄层，调用 modules)
│
├── modules/                       # 核心业务逻辑 (纯 TS，无 UI 依赖)
│   ├── auth/                      # 认证模块
│   │   ├── types.ts
│   │   ├── service.ts
│   │   └── __tests__/
│   ├── knowledge/                 # 知识管道
│   │   ├── types.ts               # Document, Chunk, GraphNode, GraphEdge
│   │   ├── pipeline.ts            # 编排: detect → chunk → parse → build → index
│   │   ├── chunker.ts             # 大文件分段
│   │   ├── parsers/               # 格式解析器 (text/md/link/code)
│   │   ├── graph.ts               # 图谱构建
│   │   ├── search.ts              # 检索 (关键词 + 子图)
│   │   ├── scheduler.ts           # 链接定时更新
│   │   └── __tests__/
│   └── ai/                        # AI 引擎
│       ├── types.ts               # Message, Tool, AgentConfig, Provider
│       ├── providers/             # openai / anthropic / deepseek
│       ├── agent-loop.ts          # ReAct 循环核心
│       ├── tools/                 # 8 个图谱检索工具
│       └── __tests__/
│
├── lib/
│   ├── db/                        # 数据库抽象层
│   │   ├── interface.ts           # Database 接口
│   │   └── sqlite.ts              # SQLite 实现 (better-sqlite3)
│   ├── graph-store.ts             # 图存储 (基于 db 抽象层)
│   ├── logger.ts                  # 统一日志
│   └── ui/                        # 共享基础 UI 组件
│
└── components/                    # 业务 UI 组件
    ├── sidebar.tsx
    ├── graph-viewer.tsx            # D3 力导向图
    └── chat-panel.tsx
```

### 设计原则

- `modules/` 纯逻辑，不依赖 React/Next.js，可独立测试
- `app/api/` 薄层，只做参数校验和调用 module，不写业务逻辑
- `lib/db/` 接口抽象，SQLite 实现后续可替换为 PostgreSQL
- 不做投机性抽象，三段相似代码好过一次不必要的抽象

---

## 二、数据模型

### 实体关系

```
User (1) ──→ (*) KnowledgeBase
User (1) ──→ (*) ApiKey
User (1) ──→ (*) ChatSession

KnowledgeBase (1) ──→ (*) Document
KnowledgeBase (1) ──→ (*) GraphNode
KnowledgeBase (1) ──→ (*) GraphEdge
Document (1) ──→ (*) DocumentChunk

ChatSession (1) ──→ (*) ChatMessage
```

### 表结构

| 表 | 核心字段 | 说明 |
|---|---|---|
| `users` | id, email, password_hash, created_at | 用户认证 |
| `api_keys` | id, user_id, provider, encrypted_key, created_at | AES-256-GCM 加密存储 |
| `knowledge_bases` | id, user_id, name, description, created_at | 知识库 |
| `documents` | id, kb_id, title, source_type, source_url, parsed_at | source_type: file/link/text |
| `document_chunks` | id, doc_id, chunk_index, content_text, token_count | 大文件分段存储 |
| `graph_nodes` | id, kb_id, label, node_type, source_doc_id, metadata(JSON) | 图谱节点 |
| `graph_edges` | id, kb_id, source_node_id, target_node_id, relation, confidence | relation: references/contains/related_to |
| `chat_sessions` | id, user_id, kb_id, title, created_at | 对话会话 |
| `chat_messages` | id, session_id, role, content, tool_calls(JSON) | role: user/assistant/tool |

### 数据库抽象层接口

```typescript
interface Database {
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

每个 Repository 定义标准操作: findById, findAll, create, update, delete。SQLite 用 `better-sqlite3` 实现，使用 Drizzle ORM 做 schema 管理。

---

## 三、知识管道

### 流水线

```
输入 → [检测] → [分段] → [解析] → [构建图谱] → [索引存储] → 可检索知识库
```

### 各阶段职责

| 阶段 | 输入 | 输出 | 说明 |
|---|---|---|---|
| **检测** | 用户上传文件/URL/文本 | `Document[]` | 识别格式，创建文档记录 |
| **分段** | `Document` | `DocumentChunk[]` | 大文件(>10MB)按段落切分，小文件直接通过 |
| **解析** | `DocumentChunk[]` | `ParsedChunk[]` | 按格式调用对应 parser，提取结构化内容 |
| **构建图谱** | `ParsedChunk[]` | `GraphNode[] + GraphEdge[]` | 从片段中抽取实体和关系 |
| **索引存储** | 节点 + 边 + 分段文本 | 入库 + FTS5 索引 | 检索时返回相关段落 |

### 解析器

| 格式 | 解析策略 | MVP |
|---|---|---|
| `.txt` | 直接读取，按段落分片 | ✅ |
| `.md` | 解析标题/链接/代码块，标题→节点，链接→边 | ✅ |
| URL 链接 | 抓取 HTML → 提取文本，用 meta/title/headings 建节点 | ✅ |
| 代码文件 | 用 tree-sitter 提取符号和导入关系 | ✅ |
| Word/PPT/Excel | (后续迭代) | ❌ |
| 图片 | (后续迭代) | ❌ |

### 分段策略

- 阈值: 10MB
- 切分方式: 按 `\n\n` 段落边界切分
- 每段不超过预设 token 数
- FTS5 索引以分段为粒度建立

### 解析输出格式

```typescript
interface ParsedChunk {
  chunkIndex: number;
  content: string;
  nodes: { label: string; type: string; metadata?: Record<string, unknown> }[];
  edges: { source: string; target: string; relation: string; confidence: 'EXTRACTED' | 'INFERRED' }[];
}
```

---

## 四、AI 引擎

### Model Provider 适配

```typescript
interface ModelProvider {
  readonly name: string;
  chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk>;
}
```

三个实现: `OpenAIProvider` / `AnthropicProvider` / `DeepSeekProvider`。
API Key 从 `api_keys` 表读取（用户自配置，AES-256-GCM 加密存储）。

### Agent Loop (ReAct)

```
用户消息 → LLM 思考 → 决定动作
                      ├── 调用工具 → 执行 → 结果回传 → 继续循环
                      └── 回复用户 → 结束
```

- 最多 10 轮迭代防死循环
- 每轮追加 assistant/tool 消息到历史
- 单轮工具调用失败不中断，错误信息回传 LLM 自行决策

### 内置工具

| 工具 | 对标 graphify | 功能 |
|---|---|---|
| `search_knowledge` | `query_graph` | 自然语言/关键词搜索图谱，BFS/DFS，深度/预算可控 |
| `get_node` | `get_node` | 按标签/ID 获取节点详情（来源文档、类型、关联度） |
| `get_neighbors` | `get_neighbors` | 获取节点邻接子图，可按关系类型过滤 |
| `get_community` | `get_community` | 获取知识社群全部节点 |
| `god_nodes` | `god_nodes` | 获取知识库核心概念（连接度最高节点） |
| `graph_stats` | `graph_stats` | 知识库统计：节点/边/社群分布 |
| `shortest_path` | `shortest_path` | 查找两个知识点之间关联路径 |
| `get_document` | 新增 | 获取文档原始内容（Agent 深入阅读） |

---

## 五、UI 设计

参考 `.reference/index.html` 的设计风格。

### 布局

侧边栏 + 主内容区，移动端折叠为底部导航栏。

### 核心页面

| 路由 | 页面 | 内容 |
|---|---|---|
| `/` | 仪表盘 | 统计卡片 + 最近知识库 + 快捷入口 |
| `/knowledge` | 知识库列表 | 创建/导入/管理知识库 |
| `/knowledge/[id]` | 知识库详情 | 文档列表 + 图谱可视化（两栏：左图右文档） |
| `/chat` | AI 问答 | 对话面板（左消息流 + 右知识上下文） |
| `/login` | 登录 | 邮箱 + 密码 |
| `/register` | 注册 | 邮箱 + 密码 |
| `/settings` | 设置 | API Key 管理，Provider 启用配置 |

### 图谱可视化

D3.js 力导向图，支持缩放/拖拽/点击查看节点详情。

### 响应式

侧边栏在移动端自动切换为底部导航栏。

---

## 六、认证与会话

- **注册**: 邮箱 + 密码，bcrypt 哈希存储
- **登录**: 验证凭据 → 签发 JWT → httpOnly cookie
- **中间件**: `middleware.ts` 保护除 `/login` `/register` 外的页面路由
- **API Key**: AES-256-GCM 加密存储，加密密钥来自 `ENCRYPTION_KEY` 环境变量

---

## 七、链接定时更新

URL 类型 Document 导入时注册定时任务，默认 24h 间隔：

1. `scheduler.ts` 管理所有定时任务
2. 触发时重新抓取 URL 内容
3. 内容 diff 检测差异
4. 仅在有变化时更新图谱（重新解析 → 更新节点/边）

---

## 八、日志与 DFX

### 日志系统

```typescript
interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}
```

- `pino` 底层实现，`lib/logger.ts` 统一导出
- 开发环境 `pino-pretty`，生产环境 JSON

### 日志覆盖

| 模块 | 记录内容 |
|---|---|
| 知识管道 | 导入开始/完成/失败，各阶段耗时，解析错误详情 |
| AI 引擎 | API 调用耗时，Agent 每轮迭代，工具调用及结果 |
| 认证 | 登录/注册事件（不记录密码） |
| 调度器 | 定时更新触发/完成/失败 |
| 数据库 | 慢查询（阈值 100ms） |

### 健康检查

```
GET /api/health → { status: "ok", uptime: 12345, db: "connected" }
```

### 错误边界

- **前端**: React Error Boundary 包裹每个 page
- **后端**: API 全局 error handler → 统一格式 `{ success: false, error: string }`

### 后续扩展

MVP 后接入 Prometheus metrics + Sentry 错误追踪。

---

## 九、测试策略

| 层级 | 范围 | 工具 | 目标覆盖率 |
|---|---|---|---|
| 单元测试 | `modules/` 纯逻辑 | Vitest | ≥80% |
| 集成测试 | API 路由 + 数据库 | Vitest + 测试 SQLite | ≥80% |
| E2E | 关键用户流程 | Playwright | 核心流程 100% |

### E2E 核心流程

1. 注册 → 登录
2. 创建知识库 → 导入文档 → 查看图谱
3. 配置 API Key → 知识库问答对话

### TDD 要求

遵循 RED → GREEN → IMPROVE 循环，先写测试再写实现。

---

## 十、架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js App                          │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐             │
│  │ app/     │  │components│  │ lib/ui/  │  UI 层      │
│  │ (pages)  │  │          │  │          │             │
│  └────┬─────┘  └──────────┘  └──────────┘             │
│       │                                                 │
│  ┌────┴─────────────────────────────────┐              │
│  │          app/api/ (薄 API 层)         │              │
│  └────┬─────────────────────────────────┘              │
│       │                                                 │
│  ┌────┴─────────────────────────────────┐              │
│  │            modules/ (业务逻辑)         │              │
│  │  ┌────────┐ ┌──────────┐ ┌────────┐  │              │
│  │  │ auth   │ │knowledge │ │  ai    │  │              │
│  │  └────────┘ └────┬─────┘ └───┬────┘  │              │
│  │                  │           │        │              │
│  └──────────────────┼───────────┼────────┘              │
│                     │           │                        │
│  ┌──────────────────┴───────────┴────────┐              │
│  │            lib/ (基础设施)              │              │
│  │  ┌────────┐ ┌───────────┐ ┌────────┐  │              │
│  │  │db/     │ │graph-store│ │logger  │  │              │
│  │  └────────┘ └───────────┘ └────────┘  │              │
│  └───────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

---

## 关键决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 框架 | Next.js | 全栈统一，API Route 无需单独后端 |
| 图谱引擎 | TypeScript 重实现 | 技术栈统一，参考 graphify 设计但不依赖 Python |
| 数据库 | SQLite + 抽象层 | MVP 轻量，接口预留未来切 PostgreSQL |
| API Key | 用户自配置 | 降低平台管理负担，用户控制用量 |
| Agent 工具 | 对标 graphify 8 工具 | graphify 已验证的图谱检索模式 |
| 分段策略 | 段落级切分 | 大文件可控，检索粒度合理 |
| 日志 | pino | 轻量高性能 JSON 日志 |
