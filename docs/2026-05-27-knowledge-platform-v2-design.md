# AI 驱动学习平台 — 设计文档 v2

> 日期: 2026-05-27 | 状态: 已确认

## 概述

知识管理平台，支持多格式文档导入 → 结构化解析 → 知识图谱构建 → 可视化检索。用户自行配置 LLM 进行知识问答。平台提供公共知识库，支持 Web/移动端/小程序多端访问。

### 核心功能

1. **知识库管理**: 多格式导入 → 结构化解析 → 知识图谱构建 → 可视化 → 检索
2. **AI 知识问答**: 用户自配 LLM Provider → Agent Loop → 图谱检索工具 → 知识问答
3. **链接自动更新**: URL 类知识点定时同步
4. **公共知识库**: 平台管理员管理公共库，全员只读共享

### 去除了什么

- 内置用户认证（注册/登录）
- 仪表盘、练习、理论课程模块
- 个人中心设置

---

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js (App Router) | 全栈应用，API Route + SSR |
| 语言 | TypeScript | 全栈类型安全 |
| 数据库 | SQLite (better-sqlite3) | MVP 轻量方案，WAL 模式，通过抽象层预留扩展空间 |
| ORM | Drizzle ORM | 类型安全、轻量、SQL-like API |
| 日志 | pino | 轻量 JSON 日志 |
| 图谱可视化 | D3.js | 力导向图，支持缩放/拖拽/点击 |
| 测试 | Vitest + Playwright | 单元/集成 + E2E |
| 加密 | Node.js crypto (AES-256-GCM) | 用户 LLM API Key 加密存储 |

---

## 一、项目结构

```
src/
├── core/                           # 核心能力层（纯逻辑，零框架依赖）
│   ├── pipeline/                   # 知识管道
│   │   ├── types.ts                # Document, Chunk, ParsedChunk, GraphNode, GraphEdge
│   │   ├── detector.ts             # 格式检测
│   │   ├── chunker.ts              # 大文件分段（流式读取，段落级切分）
│   │   ├── parsers/                # 格式解析器（可扩展注册）
│   │   │   ├── text.ts             # .txt
│   │   │   ├── markdown.ts         # .md → 标题节点 + 链接边
│   │   │   ├── link.ts             # URL 抓取 → HTML → 提取
│   │   │   └── code.ts             # tree-sitter 符号提取
│   │   ├── graph-builder.ts        # 图谱构建（实体抽取 + 关系建立）
│   │   ├── search.ts               # 检索引擎（关键词 + 子图遍历 BFS/DFS）
│   │   └── scheduler.ts            # 链接定时同步（默认 24h 间隔）
│   ├── ai/                         # AI 引擎
│   │   ├── types.ts                # Message, ToolDef, Provider, AgentConfig
│   │   ├── providers/              # openai / anthropic / deepseek
│   │   ├── agent-loop.ts           # ReAct 循环（最多 10 轮）
│   │   └── tools/                  # 8 个图谱检索工具
│   └── __tests__/                  # core 层单元测试

├── modules/                        # 业务模块层（编排 core 能力）
│   ├── knowledge-base/             # 知识库 CRUD + 导入编排
│   ├── chat/                       # 问答会话管理
│   └── llm-config/                 # 用户 LLM Provider 配置

├── clients/                        # 多端 UI（只消费 modules，不直接依赖 core）
│   ├── web/                        # Next.js App Router
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx            # 知识库列表（首页）
│   │   │   ├── kb/[id]/            # 知识库详情 + 图谱可视化
│   │   │   ├── chat/               # AI 知识问答
│   │   │   ├── llm-config/         # LLM 配置
│   │   │   ├── admin/              # 管理员设置（白名单 + 平台概览）
│   │   │   └── api/                # 薄 API 层
│   │   └── components/             # UI 组件
│   ├── mobile/                     # 移动端（后续）
│   └── miniprogram/                # 小程序（后续）

└── lib/                            # 基础设施
    ├── db/
    │   ├── interface.ts            # Database 接口
    │   └── sqlite.ts               # SQLite + Drizzle 实现
    ├── fs/                         # 文件系统抽象
    ├── logger.ts                   # pino 统一日志
    └── security.ts                 # API Key 加密（AES-256-GCM）
```

### 层间依赖规则

```
clients/ → modules/ → core/
          modules/ → lib/
          core/    → lib/（仅类型）
```

- `core/` 不依赖任何框架、不依赖 `modules/`、不依赖 `clients/`
- `modules/` 可依赖 `core/` + `lib/`，但不可依赖 `clients/`
- `clients/` 只通过 `modules/` 调用业务能力，不直接引用 `core/`
- 跨层调用只通过 interface 契约

### 设计原则

- `core/` 纯逻辑，不依赖 React/Next.js，可独立测试
- `app/api/` 薄层，只做参数校验和调用 module，不写业务逻辑
- `lib/db/` 接口抽象，SQLite 实现后续可替换为 PostgreSQL
- 不做投机性抽象，三段相似代码好过一次不必要的抽象

---

## 二、数据模型

### 实体关系

```
KnowledgeBase (1) ──→ (*) Document
KnowledgeBase (1) ──→ (*) GraphNode
KnowledgeBase (1) ──→ (*) GraphEdge
Document (1) ──→ (*) DocumentChunk
ChatSession (N) ──→ (1) KnowledgeBase
ChatSession (1) ──→ (*) ChatMessage
ExternalUser (1) ──→ (*) LlmProvider
ExternalUser (1) ──→ (*) ChatSession
```

### 表结构

| 表 | 核心字段 | 说明 |
|---|---|---|
| `knowledge_bases` | id, owner_id, name, description, kb_type, created_at | kb_type: `public` / `private` |
| `platform_admins` | id, external_id, created_at | 平台管理员白名单 |
| `documents` | id, kb_id, title, source_type, source_url, file_path, file_size, parsed_at, status | status: pending/parsing/done/failed |
| `document_chunks` | id, doc_id, chunk_index, content_text, token_count | 大文件分段存储 |
| `graph_nodes` | id, kb_id, label, node_type, source_doc_id, metadata(JSON) | 图谱节点 |
| `graph_edges` | id, kb_id, source_node_id, target_node_id, relation, confidence | 图谱边 |
| `chat_sessions` | id, kb_id, external_user_id, created_at | 用户级会话 |
| `chat_messages` | id, session_id, role, content, tool_calls(JSON) | role: user/assistant/tool |
| `llm_providers` | id, external_user_id, provider, api_key_encrypted, base_url, enabled | 用户自配 LLM |

### 数据库抽象层接口

```typescript
interface Database {
  knowledgeBase: KnowledgeBaseRepository;
  document: DocumentRepository;
  documentChunk: DocumentChunkRepository;
  graphNode: GraphNodeRepository;
  graphEdge: GraphEdgeRepository;
  platformAdmin: PlatformAdminRepository;
  chat: ChatRepository;
  llmProvider: LlmProviderRepository;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
```

---

## 三、平台管理员

### 管理员来源

**初始管理员**通过环境变量注入，系统启动时自动同步到 `platform_admins` 表：

```env
PLATFORM_ADMINS=oa_user_001,oa_user_002
```

**后续管理员**由已存在的管理员在界面上添加/移除。

### 管理员判定

```
请求 → 提取 x-external-user → 查 platform_admins 表 + 环境变量 → 判定 isAdmin
```

### 权限矩阵

| 操作 | 普通用户 | 平台管理员 |
|---|---|---|
| 创建/查看个人知识库 | ✓ | ✓ |
| 创建/编辑公共知识库 | ✗ | ✓ |
| 导入文档到公共知识库 | ✗ | ✓ |
| 删除公共知识库 | ✗ | ✓ |
| 回复用户问答 | ✗ | ✓ |
| 管理管理员白名单 | ✗ | ✓ |
| 查看平台统计 | ✗ | ✓ |
| 配置个人 LLM | ✓ | ✓ |

### 管理员界面入口

```
知识库管理
├── 个人知识库（Tab）       ← 所有用户可见
├── 公共知识库（Tab）       ← 管理员独有，可编辑模式
└── 管理员设置（入口）     ← 管理员独有
    └── 白名单管理 + 平台概览
```

---

## 四、知识管道

### 流水线

```
输入 → [检测] → [分段] → [解析] → [构建图谱] → [索引存储] → 可检索
```

### 各阶段职责

| 阶段 | 输入 | 输出 | DFX 措施 |
|---|---|---|---|
| 检测 | 用户输入（文件/URL/文本） | Document 记录 | 格式校验、大小限制（100MB）、MIME 白名单 |
| 分段 | Document | DocumentChunk[] | 流式读取、按 `\n\n` 段落切分、单段 ≤ 8K token |
| 解析 | DocumentChunk[] | ParsedChunk[] | 超时 30s、异常隔离、可扩展 parser 注册 |
| 构建图谱 | ParsedChunk[] | GraphNode[] + GraphEdge[] | 事务写入、去重（label + node_type） |
| 索引存储 | 节点 + 边 + 分段文本 | FTS5 全文索引 | 批量插入（单事务）、索引重建不阻塞查询 |

### 解析器

| 格式 | 策略 | 优先级 |
|---|---|---|
| `.txt` | 直接读取，按段落分片 | MVP |
| `.md` | 解析标题/链接/代码块 → 标题→节点，链接→边 | MVP |
| URL 链接 | 抓取 HTML → 提取文本 + meta/title/headings | MVP |
| 代码文件 | tree-sitter 提取符号和导入关系 | MVP |
| PDF/Office | 后续迭代 | 二期 |

### 解析器扩展机制

```typescript
interface Parser {
  readonly name: string;
  readonly supportedTypes: string[];
  parse(input: ParseInput): Promise<ParsedChunk[]>;
}
```

新解析器实现 `Parser` 接口后注入 `parserRegistry`，无需修改 pipeline 代码。

---

## 五、AI 引擎

### 架构定位

- **平台提供**: 知识检索工具（图谱查询、文档搜索）
- **用户提供**: LLM Provider（OpenAI / Anthropic / DeepSeek API Key）
- **Agent Loop**: 平台运行 ReAct 循环，协调用户 LLM 和平台工具

### Model Provider 适配

```typescript
interface ModelProvider {
  readonly name: string;
  chat(messages: Message[], tools?: ToolDef[]): AsyncIterable<StreamChunk>;
}
```

三种实现: `OpenAIProvider` / `AnthropicProvider` / `DeepSeekProvider`。API Key 从用户配置的 `llm_providers` 表读取，AES-256-GCM 运行时解密。

### Agent Loop (ReAct)

```
用户消息 → LLM 思考（用户Key）→ 决定动作
                                   ├── 调用工具（平台执行）→ 结果回传 → 继续
                                   └── 回复用户 → 结束
```

- 最多 10 轮迭代防死循环
- 流式响应，SSE 推送至前端
- 单轮工具失败不中断，错误回传 LLM 自行决策

### 内置工具

| 工具 | 功能 |
|---|---|
| `search_knowledge` | 自然语言/关键词搜索图谱，BFS/DFS，深度可控 |
| `get_node` | 按标签/ID 获取节点详情 |
| `get_neighbors` | 获取邻接子图，按关系类型过滤 |
| `get_community` | 获取知识社群全部节点 |
| `god_nodes` | 连接度最高的核心概念节点 |
| `graph_stats` | 统计：节点/边/社群分布 |
| `shortest_path` | 两个知识点之间关联路径 |
| `get_document` | 获取文档原始内容 |

---

## 六、DFX 设计

### 大文件处理

| 风险点 | 防护措施 |
|---|---|
| 内存溢出 | 流式读取，不在内存中持有完整文件 |
| 超大文件 | 单文件 100MB + 分段数 1000 硬上限，超标立即拒绝 |
| 长时间阻塞 | 单文件解析超时 30s |
| 解析失败扩散 | 分段级异常隔离，单段失败记录位置供重试 |
| 临时文件泄漏 | 统一 `tmp/` 管理，解析后清理，scheduler 定期扫描残留 |

### 数据存储

| 风险点 | 防护措施 |
|---|---|
| 写入中断 | 图谱构建事务写入，全成功或全回滚 |
| 索引损坏 | FTS5 索引定期校验，异常自动重建 |
| 锁冲突 | SQLite WAL 模式 |
| 大数据库 | WAL checkpoint 定期触发，预留 `VACUUM INTO` 备份 |

### 无单点异常

| 组件 | 容错策略 |
|---|---|
| URL 抓取 | 超时 15s、重试 3 次（间隔递增）、失败不阻塞其他 |
| 链接同步（scheduler） | 独立 timer，单 URL 失败不影响其他，失败告警日志 |
| 图谱构建 | 单文档异常隔离，不中断整批处理 |
| Agent Loop | 工具调用失败返回错误给 LLM，LLM 决策重试或跳过 |
| 前端 | React Error Boundary 包裹每个页面 |

### 日志

```typescript
interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, err?: Error, ctx?: Record<string, unknown>): void;
}
```

| 模块 | 记录内容 |
|---|---|
| 知识管道 | 导入开始/完成/失败，各阶段耗时，解析错误+片段位置 |
| AI 引擎 | API 调用耗时，Agent 每轮迭代，工具调用及结果 |
| 调度器 | 定时更新触发/完成/失败，URL 不可达告警 |
| 数据库 | 慢查询（≥100ms），连接状态 |
| 文件系统 | 上传/清理操作，临时文件残留告警 |

### 健康检查

```
GET /api/health → { status: "ok", uptime: 12345, db: "connected", disk: "85% free" }
```

### 错误边界

- **前端**: React Error Boundary 包裹每个 page
- **后端**: API 全局 error handler → 统一格式 `{ success: false, error: string }`

---

## 七、OA 预留设计

### 当前身份传递

```
请求 → x-external-user header → 提取 external_id → 注入 request context
```

### OA 接入预留点

1. `x-external-user` header — 为 OA 网关/反向代理预留
2. `platform_admins` 表 + `PLATFORM_ADMINS` 环境变量 — 管理员白名单
3. `owner_id` / `external_user_id` — 字符串类型，不预设 OA 格式
4. 预留 `app/api/auth/callback` 路由 — OA 回调占位
5. `modules/` 层接口参数均使用 `externalId: string`

OA 接入时只需网关层适配，`core/` 和 `modules/` 层代码零改动。

---

## 八、多端架构

```
src/clients/
├── web/                    # Next.js App Router（Web 端）
├── mobile/                 # React Native / H5（后续预留）
└── miniprogram/            # 微信小程序（后续预留）
```

- `core/` 和 `modules/` 不感知客户端类型
- API 响应格式统一: `{ success: boolean, data: T, error?: string }`
- 各客户端只处理 UI 和路由，共用同一套 REST API

---

## 九、测试策略

| 层级 | 范围 | 工具 | 重点 |
|---|---|---|---|
| 单元测试 | `core/` 纯逻辑 | Vitest | 解析器、图谱构建、检索、chunker |
| 集成测试 | `modules/` + API | Vitest + 测试 SQLite | API 路由、权限中间件、知识管道端到端 |
| E2E | 关键流程 | Playwright | 导入→解析→图谱→问答 |

### 核心流程

1. 配置 LLM Provider → 创建知识库 → 导入文档 → 查看图谱
2. 公共知识库问答
3. 管理员创建/编辑公共知识库

---

## 十、架构总览

```
┌──────────────────────────────────────────────────────┐
│  clients/                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
│  │   web    │  │  mobile  │  │ miniprogram  │       │
│  │ (Next.js)│  │ (后续)    │  │  (后续)       │      │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘       │
│       └──────────────┼───────────────┘               │
│                      │ HTTP / REST API               │
├──────────────────────┼───────────────────────────────┤
│  modules/            │                               │
│  ┌───────────────────┼───────────────────┐           │
│  │ knowledge-base │ chat │ llm-config    │ 业务编排  │
│  └───────┬─────────┴──┬───┴───────┬───────┘           │
├──────────┼────────────┼───────────┼───────────────────┤
│  core/   │            │           │                   │
│  ┌───────┴────────────┴───────────┴───────┐           │
│  │       pipeline + ai + tools            │ 核心能力  │
│  └───────────────────┬────────────────────┘           │
├──────────────────────┼───────────────────────────────┤
│  lib/                │                                │
│  ┌───────────────────┴────┐  ┌───────┐ ┌────────┐    │
│  │ db (SQLite + Drizzle)  │  │ logger│ │  fs    │    │
│  └────────────────────────┘  └───────┘ └────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 关键决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| 认证 | 去除内置认证，OA 预留 | 聚焦知识库核心能力，后续接入 OA 零改动 |
| LLM | 用户自配 API Key | 降低平台成本和管理负担 |
| 分层 | core/ → modules/ → clients/ | 核心能力可独立测试，多端共用 |
| 框架 | Next.js | 全栈统一，API Route 无需单独后端 |
| 图谱引擎 | TypeScript 重实现 | 技术栈统一，参考 graphify 但无 Python 依赖 |
| 数据库 | SQLite + 抽象层 + WAL | MVP 轻量，接口预留未来切 PostgreSQL |
| 分段策略 | 流式段落级，单段 ≤ 8K token | 大文件不爆内存，检索粒度合理 |
| 管理员 | 环境变量初始 + 界面管理 | 无单点启动依赖，管理自助 |
| 日志 | pino | 轻量高性能 JSON 日志 |
