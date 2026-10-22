# 向历史会话提问

在查看器中打开搜索（Ctrl/⌘K），选择 **问历史**，选择全部项目或当前项目，输入问题后点击 **提问**。输入过程不会自动调用模型。答案中的编号对应可展开的原文卡片，也可以打开原会话。

首次使用可以先点击 **建立索引**。每批同步最多 10 个变化会话；建立索引每批生成最多 256 个片段的向量，普通问答最多补齐 96 个。批次完成后会显示剩余数量，可以继续建立索引。尚未完成时仍允许提问，但会明确显示覆盖不完整的提示。同步优先处理所选项目，完整会话列表用于检测删除；未变化会话不重新解析，未变化片段复用向量。

## 本地模型与资源设置

历史问答支持 DeepSeek 生成答案，embedding 仍使用 Ollama。配置 `DEEPSEEK_API_KEY` 或将密钥保存到用户目录 `.config/agent-snapshots/deepseek-api-key` 后，默认回答模型切换为 `deepseek-flash`。密钥只由服务端读取，不放入仓库或发送到浏览器；本机密钥文件应限制为当前用户可读。提问时，问题与检索选中的相关原文片段会发送到 DeepSeek，向量化不发送到 DeepSeek。接口返回结构化 JSON，继续沿用原文引用校验。

可用 `AGENT_SNAPSHOTS_RAG_PROVIDER=deepseek` 明确指定生成服务，或设置为 `ollama` 使用本地生成；`AGENT_SNAPSHOTS_RAG_MODEL` 覆盖对应服务的模型名。未配置密钥和生成服务时，仍默认使用本地 `qwen3:4b`。DeepSeek 模式不需要安装本地回答模型，只需安装 embedding 模型。余额不足、密钥错误或请求失败会显示错误并保留证据，不会静默切换回答模型。

```sh
ollama pull qwen3-embedding:0.6b
ollama pull qwen3:4b
pnpm app:dev
```

Ollama 需运行在 `http://127.0.0.1:11434`。状态接口和界面会显示缺失模型。向量模型不可用时降级为关键词检索；生成模型不可用时保留已找到的证据，展示错误，不伪造答案。

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `AGENT_SNAPSHOTS_RAG_PROVIDER` | 配有密钥时默认 `deepseek`，否则 `ollama` |
| `DEEPSEEK_API_KEY` | DeepSeek 密钥，优先于本机密钥文件；不会出现在状态接口中 |
| `AGENT_SNAPSHOTS_RAG_MODEL` | DeepSeek 默认 `deepseek-flash`；Ollama 默认 `qwen3:4b` |
| `SNAPSHOT_EMBEDDING_MODEL` | `qwen3-embedding:0.6b`，沿用现有向量配置 |
| `SNAPSHOT_OLLAMA_URL` | `http://127.0.0.1:11434`，沿用现有 Ollama 地址 |
| `AGENT_SNAPSHOTS_RAG_INDEX` | 缓存目录中的 `agent-snapshots/rag-index.v1.db` |
| `AGENT_SNAPSHOTS_RAG_KEEP_ALIVE` | `0`，每次模型请求完成后卸载，减少两种模型同时驻留的内存压力；内存充足时可设置 `5m` 以减少加载耗时 |
| `AGENT_SNAPSHOTS_RAG_EMBED_GPU` | `-1`，由 Ollama 使用 GPU；设置 `0` 可使用 CPU |

生成使用 8192 上下文、最多 1200 个输出 token。证据包按序列化后的 UTF-8 字节计预算，为问题、提示词、协议和生成结果预留空间。过长的问题会要求缩短；长原文的截断在证据卡片中标出。默认地址为本机；如果自行把 Ollama 地址配置为远程，问题和脱敏证据会发送到该地址。脱敏规则不保证识别所有敏感信息。

API 对接依据：[Ollama Chat](https://docs.ollama.com/api/chat)、[Ollama Embed](https://docs.ollama.com/api/embed)。

## 实现链路

```text
Codex / Claude JSONL → 现有解析适配器 → 脱敏
  → 用户消息开始一个父块（保留助手、工具和结果）
  → 1200 字符子块，150 字符重叠，不截掉会话尾部
  → SQLite 父块 / 子块 / 向量缓存
  → 关键词 BM25 + 向量余弦召回（分别最多 40 个）
  → RRF 排名融合 + 候选证据筛选
  → 当前父块和紧邻的下一父块，保持主会话 / 子 Agent 来源隔离
  → 去重、每会话最多 2 个证据、总计最多 4 个证据、上下文预算
  → DeepSeek / Ollama 结构化答案 → 引用编号校验 → 答案与原文卡片
```

`rag-core.mts` 实现分词、切块、RRF、上下文组装和引用验证；`rag-index.mts` 管理持久化；`rag-service.mts` 编排检索和生成；`viewer-ui/js/rag.mts` 负责界面。

- **中文与代码检索**：普通搜索和 RAG 统一使用本地 HanLP ELECTRA Small、技术术语词典及代码切分规则。FTS5 可用时使用 SQLite BM25；缺少 FTS5 的 Node 运行时使用相同分词的 BM25 扫描降级。trigram 已从运行链路移除，详见 [中文与代码检索](search-tokenization.md)。
- **融合**：`RRF(d) = Σ 1 / (60 + rank(d))`，避免直接相加不同量纲的检索分数。RRF 不表示正确概率。进入证据包前还会依据各检索器自身的分数筛选会话：关键词保留最高分的 80% 以上；向量保留不低于最高相似度 90%，并达到最低相似度的会话。存在关键词候选时最低值为 0.5，完全没有关键词候选时提高到 0.65，以保守拒答换取较少的无关上下文。这是待独立数据校准的启发式，会影响召回。
- **结果确认**：上下文保留失败反馈和后续方案，提示词要求区分建议、助手声称成功、工具验证和后续否定。当前没有专门训练的结果分类器，也没有对所有结论做自动语义证明。
- **缓存与一致性**：会话键包含来源 home 和 ref，指纹包含修改时间、标题、项目和切块版本。更新以事务替换父子块；未成功更新的旧记录不参与查询。片段内容哈希、模型名和服务地址共同决定向量缓存复用；删除会话后清除孤立向量。模型同名原地替换时应重建索引。
- **向量扫描**：使用分页读取和精确余弦扫描，保留 Top-K；没有 ANN/HNSW 索引。个人语料的基线实现仍随片段数量线性增长。同步和计算目前由请求驱动，不是复用旧全文索引 Worker 的后台向量同步。
- **引用与展示**：每个结论必须带有效证据编号，非法编号或缺少引用会被拒绝。编号存在只证明出处可定位，不证明原文支持结论。界面把模型和历史文本按纯文本渲染。主会话可跳到轮次；子 Agent 目前提供来源卡片并打开所属会话，不承诺精确跳到子 Agent 内部轮次。
- **请求生命周期**：POST 沿用本地 Origin 和 CSRF 保护；单实例只允许一条 RAG 请求，冲突返回 409；取消向下传递到模型请求，防止旧响应覆盖新问题。NDJSON 流式返回阶段进度与证据，结构化答案完整校验后才展示，不逐 token 展示未校验结论。

## 回归与质量评测

真实历史评测、项目隔离的 dev/test、答案与引用评分，以及固定证据的模型比较，见 [RAG 质量评测流程](rag-evaluation.md)。首轮结果见 [真实历史 DeepSeek 评测报告](evaluations/rag-real-2026-09-11.md)。下文保留的是合成回归流程。

评测脚本沿用当前生成服务配置。复现已有 Ollama 评测报告时，显式设置 `AGENT_SNAPSHOTS_RAG_PROVIDER=ollama` 和 `AGENT_SNAPSHOTS_RAG_MODEL=qwen3:4b`；选择 DeepSeek 时，生成评测会调用其 API 并产生费用，旧报告不能代表新模型的效果。

```sh
pnpm test:rag
pnpm eval:rag --generate 12 --output docs/evaluations/rag-local.json
```

测试替身用于验证协议和边界条件，不作为模型质量证据。默认质量评测使用真实 Ollama 模型，以及人工编写的 **10 个合成调试会话、40 个可回答问题、10 个无答案问题**。这套数据是开发回归集，不是隔离的真实生产测试集。

评测比较关键词、向量、混合检索，报告按不同会话去重后的 Recall@5、MRR@5、子块/父块上下文是否包含标注方案的文本、检索 P95。`--generate 12` 选择 8 个可回答问题和 4 个无答案问题跑生成，保留输出和引用供人工核对。精确短语命中只是自动代理指标，不能称为事实正确率；引用语义支持率和失败方案误判率需要人工标注。

可提供自有、经过许可的标注集：

```sh
pnpm eval:rag --dataset /path/to/labels.json --generate 30 --output /path/to/report.json
```

输入 JSON 字段：`sessions`（含 ref/title/cwd/mtime）、`snapshots`（ref 到带 turns 的快照映射）、`questions`（id/query/answerable/expectedRef/expectedText，可选 cwd）。输出含证据原文，真实数据的报告应保存在本地受控目录，先审核再分享。不要把合成回归的指标包装成真实会话准确率；本轮没有评估 Cross-encoder 重排或 GraphRAG。
