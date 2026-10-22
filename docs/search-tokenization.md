# 中文与代码检索

普通会话搜索与 RAG 的关键词召回共用 `search-tokenizer.mts`。不再使用 trigram，也不在 HanLP 不可用时偷偷切回其他中文分词器。

## 本地准备

需要 Python 3.10–3.12。仓库开发环境执行：

```powershell
corepack pnpm setup:hanlp
corepack pnpm app:dev
```

准备脚本创建 `.venv-hanlp`、安装锁定的 HanLP/Transformers 依赖并下载 `FINE_ELECTRA_SMALL_ZH`。首次安装需要联网；实际会话通过子进程 stdin/stdout 在本机分词，不发送到远程 API。模型、Python 环境不打入 Electron 安装包；其他机器或打包应用需要自行准备运行环境，用 `AGENT_SNAPSHOTS_HANLP_PYTHON` 指定 Python 可执行文件。

## 处理规则

- 中文：HanLP ELECTRA Small 按上下文识别词边界；长连续中文按 200 字符窗口推理，超长无标点文本仍可能在窗口边界切断词。
- 术语：`src/server/hanlp/terms.json` 保存技术词及其检索组成词。HanLP `dict_combine` 合并词典术语，索引端另加组成词。例如 `连接池` 保留整体，并补充 `连接`、`池`。查询 `连接池` 使用整体，避免单独的 `池` 扩大召回。
- 代码：保留大小写归一化的完整标识符、错误码和 ASCII 路径；索引端补充驼峰、下划线和路径组成词。例如 `getUserSession` 同时索引 `getusersession/get/user/session`。完整查询不展开成 OR，防止 `ERR_CONNECTION_RESET` 因共享 `connection` 命中其他错误码。
- Unicode：先做 NFKC 归一化；停用词在索引和查询端一致移除。
- 每个 token 编码为一个 ASCII 单词再交给 FTS5，避免 SQLite 再次拆分标点或把用户输入解释成 MATCH 操作符。原文另存，用于摘要、定位和引用。

普通搜索要求所有查询词命中；RAG 使用 OR 召回和 BM25 排序，再与向量结果融合。普通搜索仍保留原有摘要与字段评分。关键词搜索不再提供任意子串匹配；两字词可直接入索引，但单字只有作为独立词或明确词典组成词被索引时才命中。

## 索引与性能

新版本在原 SQLite 缓存中迁移 FTS 表。模型标识、处理代码和词典内容共同生成分词版本，普通索引文档及文件指纹、RAG 会话指纹都包含版本。后台同步会重新处理旧文档，查询排除旧版本，避免不同规则混用。原始会话日志不会修改。RAG 向量按原文 hash 复用，无需仅因改分词就重新计算向量。

Python 分词进程按需启动，空闲五分钟后退出；热查询复用已加载模型，并缓存最多 256 条查询。首次查询需要加载模型，因此冷启动与热查询应分开测量。会话分词在 SQLite 写事务之外执行，不会在等待模型期间持有数据库写锁。

验证命令：

```powershell
corepack pnpm test:hanlp
corepack pnpm test:rag
corepack pnpm test:search-sync
node scripts/eval-hanlp-keyword.mjs
```

`test:hanlp` 使用真实模型，验证术语、短词、代码、更新删除、旧索引迁移，并输出首次请求与未缓存热查询延迟。Node 缺少 FTS5 时测相同 token 边界的扫描路径；Electron 的 node 模式另测真实 FTS5 迁移。分词变化不代表检索准确率必然提高，旧评测数据不能直接当作新版本成绩。

本机实测：首次请求含模型加载约 4.8–8.2 秒，短查询热分词约 8–22 毫秒（不同测试负载下的样本，不是性能保证）。50 条合成问题中的 40 条可回答问题，关键词 Recall@5 为 97.5%、MRR@5 为 0.9333；10 条不可回答问题均无关键词候选。最终运行的完整关键词查询 P95 约 25 毫秒。完整数据和运行环境见 [评测结果](evaluations/hanlp-keyword.json)。这些数据只覆盖合成语料和关键词检索，不代表真实会话、混合检索或答案正确率。

参考：[HanLP 分词器](https://hanlp.hankcs.com/docs/api/hanlp/components/tokenizers/transformer.html)、[FTS5](https://www.sqlite.org/fts5.html)。

同语料对照另见 [普通搜索 AND 评测](evaluations/tokenizer-comparison.md) 与 [RAG OR/BM25 评测](evaluations/rag-tokenizer-comparison.md)。两条链路的查询规则和用途不同，不应直接比较它们的命中率。
