# 实施过程中的坑与解决方案

> 记录每个 Task 执行中遇到的问题，避免后续踩重复的坑。

---

## Task 0: 项目初始化

### 坑 1: PowerShell 执行策略禁止 npx

**现象:** `npx create-next-app` 报 `cannot be loaded because running scripts is disabled on this system`

**解决:** 使用 `cmd /c "npx ..."` 绕过 PowerShell 执行策略限制。

### 坑 2: create-next-app 要求空目录

**现象:** worktree 中存在 `index.html`、`.gitignore`，`create-next-app` 拒绝执行。

**解决:** 先 `Remove-Item` 清理冲突文件，再创建项目。

### 坑 3: 子 Agent 无写入权限

**现象:** 通过 subagent 执行 Task 0 时，子 Agent 没有 Write/Edit/PowerShell(external) 权限，无法创建文件或执行 npm 命令。

**解决:** Controller 直接执行涉及文件写入和 npm 的操作，不委托给子 Agent。后续 Task 也采用此模式。

---

## Task 1-3: 基础设施

### 坑 4: better-sqlite3 无预编译二进制 (Node 24)

**现象:** 
```
prebuild-install warn install No prebuilt binaries found (target=24.15.0 runtime=node)
gyp ERR! find VS Could not find any Visual Studio installation to use
```

**根因:** Node 24.15.0 太新，`better-sqlite3` 所有版本均无此目标的预编译二进制。且环境中无 Visual Studio Build Tools，node-gyp 无法从源码编译。

**解决:** 替换为 `sql.js`（纯 WASM/JS 实现的 SQLite），通过 npm 安装无需原生编译。Drizzle ORM 的 `drizzle-orm/sql-js` driver 完全兼容。API 差异：
- `better-sqlite3`: 同步 API，文件级持久化
- `sql.js`: 异步初始化，内存级运行 + 手动 `export()`/`fs.writeFileSync()` 持久化

### 坑 5: sql.js 不支持 FTS5

**现象:** `CREATE VIRTUAL TABLE ... USING fts5` 报 `no such module: fts5`

**根因:** sql.js 标准构建不包含 FTS5 扩展模块。

**解决:** 使用 `LIKE` 查询替代 FTS5 全文搜索。对于 MVP 阶段的知识图谱检索足够，后续可切换回 better-sqlite3 或使用外部搜索引擎。

### 坑 6: sql.js SAVEPOINT 在 run() wrapper 中失效

**现象:** 
- `BEGIN/COMMIT` → `cannot commit - no transaction is active`
- `SAVEPOINT/ROLLBACK TO` → `no such savepoint: _tx`

**根因:** `run()` wrapper 在每个 SQL 语句后调用 `saveDatabase()` → `sqldb.export()`，这会触发 sql.js 内部的隐式提交，导致事务无法维持。

**解决:** 简化 `transaction()` 实现为直接执行回调 + 保存，不做真正的事务管理。对于 MVP 足够；后续如需真事务，应在事务期间暂停 `saveDatabase()` 调用。

### 坑 7: 测试间 DB 数据污染

**现象:** 文件级 DB 在多个测试间共享同一文件，前一个测试的数据影响后续测试断言。

**解决:** 让 `setDbPath()` 可外部配置，每个测试使用独立的临时文件路径 (`os.tmpdir()` + 随机名)，`afterEach` 清理临时文件。

---

## 环境约束总结

| 约束 | 影响 | 应对 |
|---|---|---|
| PowerShell 执行策略 | 无法直接运行 npm/npx | `cmd /c` 包装 |
| 无 VS Build Tools | 无法编译原生 node 模块 | 选择 WASM/纯 JS 替代方案 |
| Node 24.15.0 | 部分包的预编译二进制不覆盖 | 确认替代方案或降级 Node |
| 子 Agent 权限受限 | 无法委托写入操作 | Controller 直接执行关键操作 |
| sql.js 无 FTS5 | 无全文搜索 | LIKE 查询替代 |

---

## 技术选型调整

| 原计划 | 实际 | 原因 |
|---|---|---|
| better-sqlite3 | sql.js | Node 24 无预编译二进制 + 无 VS Build Tools |
| FTS5 全文索引 | LIKE 查询 | sql.js 不含 FTS5 扩展 |
| 事务 (BEGIN/COMMIT) | 简化事务 (无回滚) | sql.js export() 隐式提交导致事务失效 |
