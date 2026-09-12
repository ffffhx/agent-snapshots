# 会话解析缓存与 Worker（2026-09-12）

本次优化位于 Agent Snapshots 消费方，`agent-session-core` 的解析 API 和 Token 语义保持不变。Open Token Board 不在本次修改范围。

## 已有能力与新增能力

已有的搜索同步 Worker 负责文件监听、通知防抖、持续写入时的最长等待、周期补扫，以及 SQLite 文件指纹持久化；列表读取已有 200 行摘要路径。本次验证这些机制，不重复实现另一套监听器。

新增 `src/sources/session-parse-cache.mts` 与 `session-parse-worker.mts`，由生产 `asc-adapter.mts` 的会话详情、ID 回退查找和 Claude 子会话加载调用：

1. 每次访问异步 stat 文件，以路径、引擎、解析模式及文件的 dev / inode / size / mtime / ctime 判断缓存是否可用；不依赖文件监听通知才能失效。
2. 同一文件与解析模式的并发请求共享正在执行的任务。修改后的文件重新全量解析，其他文件继续命中缓存。
3. 同步 core 解析在一个按需启动的 Worker 内执行。结果经结构化克隆传回；每个消费调用再取得独立副本，避免脱敏或指令清理修改原始缓存。
4. 解析前后比较文件状态，期间发生写入则重试，最多尝试三次。持续变化时向调用方报出可重试错误，不缓存混合读取结果。
5. LRU 默认最多 64 项、32 MiB 序列化结果预算。超大单项不缓存；该预算不等于进程实际堆占用，克隆和解析过程仍需额外内存。最多允许 128 个待返回的 Worker 任务。
6. Worker 空闲时不阻止 CLI 退出，30 秒后释放；查看器关闭时释放缓存。Worker 异常会拒绝待处理请求，后续请求可以重新启动 Worker。

缓存仅在内存中，不新增会话内容的磁盘副本。重启后首次读取会重新解析。这仍然是“变化文件全量解析”，没有实现字节偏移增量解析。

## 实测

运行 `node scripts/bench-session-parse-cache.mjs`，只读取真实本地日志，输出文件大小、时间和事件数量，不输出对话或路径。以下是 2026-09-12 本机的一次样本运行，单位 ms：

| 引擎 / 文件大小 | 原同步完整解析 | Worker 首次读取 | 缓存命中 |
| --- | ---: | ---: | ---: |
| Codex / 0.76 MiB | 5.89 | 44.23 | 0.39 |
| Codex / 82.33 MiB | 353.16 | 370.08 | 6.07 |
| Claude / 0.56 MiB | 5.67 | 6.07 | 0.49 |
| Claude / 10.40 MiB | 54.27 | 71.62 | 6.59 |

每个文件的“Worker 首次 + 缓存读取”只执行一次底层解析。首次 Codex 小文件还包含 Worker 启动成本，其余复用同一 Worker。

82.33 MiB 样本中，用 5 ms 计时器观察主线程最大延迟：同步解析约 349 ms，Worker 首次读取约 13 ms。缓存命中约 6 ms，对比原同步完整解析约快 58 倍。Worker 首次读取总耗时并未降低，收益是主线程更容易响应其他任务。

这些数字包含读取、解析、Worker 通信和缓存副本成本，但不包含完整页面渲染、搜索索引写入或网络上报；未清空系统文件缓存，也不是跨机器性能承诺。Markdown 渲染、文件发现、Claude structured patch 提取等仍有同步路径，不应据此宣称整个详情接口没有阻塞。

## 验证

- `node --test scripts/test-session-parse-cache.mjs`：8 项通过。包括与 core 结果一致、12 个并发请求只解析一次、调用间数据隔离、只刷新变化文件、追加/截断/替换/删除、半行补全、摘要与全量隔离、LRU/容量预算、Worker 失败恢复、读取期间写入，以及父文件不变时子会话更新。
- `node scripts/test-search-sync.mjs`：8 个已有监听场景通过，覆盖新目录、新文件、连续写入、归档、删除、队列积压、重启跳过未变化文件和漏通知补扫。
- `node scripts/test-local-history.mjs`：19 项通过。
- `node scripts/test-desktop-api.mjs`：18 项通过。
- TypeScript typecheck 与 dist 构建通过。

缓存测试和基准分别提供 `pnpm test:session-parse-cache`、`pnpm bench:session-parse-cache` 入口。
