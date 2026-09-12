# RAG 质量评测

本流程把检索、证据完整性、答案质量分开评估。合成回归继续使用 `pnpm eval:rag`；真实语料使用 `pnpm eval:rag:quality`，默认输出到被 Git 忽略的 `.agent-snapshots/rag-eval/`。不要将真实语料或逐题证据提交到仓库。评测生成服务沿用当前配置，DeepSeek 模式会发送问题和检索片段，并产生调用费用。

## 数据与独立测试

先选择真实技术会话，去掉同一 UUID 在多个 home 的镜像，排除正在编写评测的对话。按项目或其他不会重叠的业务组划分 dev/test；同一组、同一问题的改写不能分到两边。测试题的标注可以提前审阅，但不得根据测试结果调整切块、模型、阈值或提示词后仍将它称为未见测试集。

导出所选会话的脱敏文字（默认排除工具输出、图片和子 Agent）：

```sh
node scripts/export-rag-eval.mjs /path/to/selection.json .agent-snapshots/rag-eval/dataset.json
```

`selection.json` 为数组，每项包含 `ref`、`group` 和 `split`（dev/test）。导出不会覆盖已有文件。原始 ref 与轮次保留用于定位，项目路径替换为 `/projects/组名`；即使脱敏也需人工核对是否适合发送到生成服务。

数据格式为 version 2，含 `provenance`、`sessions`、`snapshots` 和 `questions`。标注示例：

```json
{
  "id": "release-01",
  "query": "当时为什么推送代码后没有新安装包？",
  "group": "project-a",
  "split": "test",
  "tags": ["temporal", "multi-session"],
  "answerable": true,
  "gold": [{"ref": "codex:会话ID", "turn": 12, "role": "assistant", "quote": "从原文逐字复制的依据"}],
  "keyPoints": ["需要回答的事实要点", "应区分的早期尝试与最终结果"]
}
```

多段必要依据全部写入 gold，允许跨会话。无答案题必须为 `answerable:false`、`gold:[]`，并填写 `absenceReason`，说明在冻结语料内为何无从回答。不能因为第一次搜索没命中就标成无答案。标签必须注明人、Agent 或模型标注；Agent 核对不能冒充人工审阅。标注程序会校验原文引用、组间隔离和重复问题。

第一版真实集为便利抽样：7 个完整技术会话的文字、30 个新编问题，18 dev / 12 test，来源涉及 4 个项目。问题基于真实记录编写，不是用户自然搜索日志；标签由 Agent 核对，尚待独立人工复核。它比合成集贴近实际，但仍不是全量生产准确率。

## 固定检索与生成比较

```sh
pnpm eval:rag:quality --dataset .agent-snapshots/rag-eval/dataset.json --output .agent-snapshots/rag-eval/baseline --models deepseek:deepseek-flash --repeats 2
```

默认分别报告 dev/test，不汇成一个掩盖差异的总分。`--split dev` 只评开发题；完成开发冻结后用 `--split test`。`--retrieval-only` 不调用回答模型。索引按数据哈希隔离，并复用已生成向量。原语料、切块与检索代码哈希、提示词哈希、服务地址和模型名写入报告。

对生成模型做公平比较时，复用同一份证据，不再次检索：

```sh
pnpm eval:rag:quality --dataset .agent-snapshots/rag-eval/dataset.json --replay .agent-snapshots/rag-eval/baseline/retrieval.json --output .agent-snapshots/rag-eval/comparison --models deepseek:deepseek-flash,ollama:qwen3:4b --repeats 2
```

Replay 检查数据、提示词和 split，一旦不一致直接拒绝。问题和证据逐项哈希；金标准和答案要点不会进入生成提示词。两轮反转问题与模型顺序，减轻固定冷启动顺序影响，但不等于消除了硬件、网络或缓存差异。模型别名的底层版本可能变化，长期对比需记录供应商版本。现有本地模型报告同时改过多项参数，不能拿来直接宣称 DeepSeek 更好。

## 检索指标

- Hit@5：前五个不同会话是否至少命中一个标注来源。
- Recall@5：命中的不同标注来源数 / 全部标注来源数；多会话问题不再把“命中一个”误算成全部召回。
- Precision@5：前五个不同会话中相关的数量 / 5；少于五条也以 5 为分母。
- MRR@5：第一个相关会话排名的倒数。
- nDCG@5：二元相关性下的排序质量，理想排序归一化。
- Quote coverage proxy：最终证据包包含多少逐字标注依据。只检查文字与来源一致，不等于语义完整性或忠实性。
- 检索 P50/P95、索引耗时、候选数量和门槛拒答情况。

空分组返回 null，不当成零分或满分。Hit 的 Wilson 95% 区间只作描述；同项目问题相关，不能把它当作严格独立样本的置信保证。两次生成不应把 30 道题说成 60 道独立题。未标注但实际上相关的其他会话会影响 Precision，人工审核时应补正 gold 并重新冻结版本，不能悄悄修改已评分数据。

## 答案与引用评分

运行生成 `generation.json`、`review-packet.json`、`review-template.json`。审阅包包含问题、必要答案要点、完整冻结原文、实际证据和答案。复制模板为 `reviews.json`，明确 `reviewerType`（human/agent/llm）和审阅者，逐题填写：

| 维度 | 0 | 1 | 2 |
| --- | --- | --- | --- |
| correctness | 错误或无根据回答 | 部分正确、混入错误 | 与原文和标注要点一致 |
| completeness | 缺失核心答案 | 遗漏部分必要点 | 覆盖必要点 |
| relevance | 未回答问题 | 有明显无关内容 | 直接回答 |
| temporalAccuracy | 混淆旧方案与新结果 | 时间/验证程度不够清楚 | 正确区分历史阶段及验证程度 |
| 每条 claim.support | 原文不支持/矛盾 | 只支持部分结论 | 检索证据支持整条结论 |
| 每条 claim.citationSupport | 所引编号的原文不支持 | 部分支持 | 所引来源支持整条结论 |

每题必须写审阅理由，每条结论都需评分并解释。无结论拒答的忠实性和引用支持率为 null，正确拒答是否合理由 correctness 等维度判断。编号有效性仍由产品代码检查，不能替代语义支持评分。低分应注明原因：未进索引、召回失败、证据截断、时间混淆、无依据补全或错误引用。

```sh
node scripts/score-rag-quality.mjs .agent-snapshots/rag-eval/baseline/generation.json .agent-snapshots/rag-eval/baseline/reviews.json .agent-snapshots/rag-eval/baseline/scores.json
```

评分绑定完整运行与逐条答案哈希，拒绝串用旧评分；待审项不计分，并报告覆盖率。所有 0/1/2 分除以 2 后聚合，这是审阅量表平均分，不是事实正确率。可以使用另一个模型辅助填写，但必须标明 llm，并用人工复核校准；目前第一轮由 Agent 核对，不宣称已完成独立人工验证。

生成另外记录两轮结果、模型拒答/检索门槛拒答、错误、P50/P95、输入输出 token。DeepSeek Flash 费用给出当日公开峰谷费率估算区间，考虑已返回的缓存命中 token；不是账单，失败请求费用与本地计算成本不包含。

指标概念参考：[Ragas](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)。费用来源：[DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/)。本工具是项目自有评测实现，不宣称通过了某种 RAG 标准认证。
