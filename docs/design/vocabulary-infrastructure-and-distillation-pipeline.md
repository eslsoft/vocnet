# VocNet 词汇资产基础设施及语义蒸馏流水线架构白皮书

**状态**: Final Design
**版本**: v10.0 (Master Integrated Specification)
**更新日期**: 2026-02-07

---

## 1. 总体愿景与核心定位 (Vision & Positioning)

### 1.1 核心定位
VocNet 是一个**现代化的、深度结构化的词汇数据库**。它超越了传统“平面词典”的范畴，致力于将零散的语言学数据（WordNet, Wikidata, ConceptNet, LLM）通过工程化手段聚合成高价值的、可分析的语义资产。

### 1.2 愿景目标
*   **汇总零散数据**：建立一个权威的语义中枢，将前人总结的零散数据结构化。
*   **支撑多维应用**：为 3D 语义空间（Universe）、智能语言学习系统和深度数据分析提供精准的基础底座。
*   **实现质量进化**：通过流水线机制，解决数据质量无法迭代提升的问题，使每一次处理都能在原有质量基础上实现阶梯式上升。

---

## 2. 现状分析与技术债剖析 (Current Status & Technical Debt)

### 2.1 现有架构综述 (Legacy Architecture)
目前 VocNet 的核心数据模型包含：
*   **Lemma (词原型)**：存储词典头词（Headword），如 `run`。
*   **Lexeme (义项)**：存储特定的语义感官（Sense），一个 Lemma 对应多个 Lexeme。
*   **LemmaForm (词形)**：存储形态变化，如 `ran`, `running`。
*   **初始化逻辑**：依赖 `dictinit` 脚本进行一次性、全量同步导入。

### 2.2 核心痛点
1.  **无法迭代的质量**：脚本重跑是“重置”而非“进化”，新逻辑的引入往往伴随旧数据的丢失。
2.  **语义噪声严重**：由于缺乏“义项级消歧”，ConceptNet 导入的关系中混杂了大量的语义噪声（如 `apple` 同时关联水果和电脑）。
3.  **资产流失与浪费**：昂贵的 LLM 处理结果未被持久化，导致高昂的 Token 重复支出。
4.  **查询性能瓶颈**：查询一个单词的完整视图需要跨 Lemma、Lexeme、Form 及关系表进行多次表关联，无法支撑大规模图谱的高速渲染。
5.  **业务强耦合**：数据库中出现了 `galaxy_id` 等特定业务字段，破坏了基础设施的中立性。

---

## 3. 设计核心哲学 (Design Philosophy)

1.  **确定性生产 (Deterministic Production)**：通过指纹锁定和哈希校验，确保 LLM 的概率性输出转化为确定性的数字资产。
2.  **证据不可逆性 (Evidence Immutability)**：原始证据库（Evidence Vault）记录所有 Provider 的原始响应。支持在不重新抓取数据的情况下重演合成逻辑。
3.  **上下文叠加 (Context Stacking)**：流水线后一阶段的输入是前序所有阶段输出的叠加。Phase 4 的 LLM 能看到 Phase 2 的定义和 Phase 3 的关联词。
4.  **物化视图架构 (Materialized View Architecture)**：高性能 API 直接访问扁平化的快照（Snapshot），而非执行复杂的实时图谱。

---

## 4. 系统总体架构设计 (System Architecture)

### 4.1 生产内环 (The Production Loop)
*   **特点**：异步、重计算、有状态、支持断点重试。
*   **核心组件**：
    *   **Task Orchestrator**：基于事件驱动的状态机调度引擎。
    *   **Evidence Vault**：采用 **Envelope Pattern (信封模式)** 存储的原始响应数据库。
    *   **Atomic Store**：Lemma、Lexeme 及结构化关系（SemanticRelation）实体库。

### 4.2 分发外环 (The Distribution Loop)
*   **特点**：极速、只读、版本化、低延迟。
*   **核心组件**：
    *   **Snapshot Repository**：存储预生产好的、自包含的 `WordSnapshot`。
    *   **Projector API**：支持根据不同应用方需求进行实时投影的轻量级接口。

---

## 5. 现有数据结构的集成与演进 (Entity Integration)

新架构将现有实体作为生产内环的原子结构，并通过流水线进行深度注能。

### 5.1 Lemma：词形入口与聚合根
*   **定位**：`Lemma` 作为词形层入口，负责承载标准拼写、变体和聚合上下文。
*   **操作**：Phase 1 负责准入校验与标准命名。后续实体（Lexeme, Relation）通过 Lemma 形成流水线聚合边界。

### 5.2 Lexeme：语义图谱的核心节点
*   **定位**：`Lexeme` (义项) 是关系边的真实起点和终点。
*   **操作**：Phase 4 的核心任务是执行 **Sense Mapping**，将 Phase 3 获取的“词间关系”精确映射到具体的 `Lexeme` 实例上。

### 5.3 LemmaForm：自动化的形态构建
*   **操作**：Phase 2 采集的形态证据（Inflections）将自动更新 `LemmaForm` 表。
*   **合成**：在 Phase 5 合成时，所有词义作为属性打入快照，提高检索覆盖率。

---

## 6. 五阶段流水线（The 5-Phase Pipeline）深度设计

每一个单词的进化都必须经历以下五个抽象阶段：

### 6.1 Phase 1: Discovery (准入与标准化)
*   **职责**：验证词条可用性并完成标准化准入。
*   **具体任务**：
    *   **词条检索**：利用词原型检索词汇数据源，拒绝非标准词汇。
    *   **标准命名**：提取官方拼写规范（如 `iPhone` 非 `iphone`）。
    *   **歧义标记**：若一个词存在多义候选，标记为 `Ambiguous` 待后续消歧。

### 6.2 Phase 2: Lexical (语言学证据采集)
*   **职责**：构建词法基座。
*   **Provider**：WordNet 3.1, ECDICT, Oxford, Cambridge, Wiktionary。
*   **操作**：并行抓取定义、音标、词性、形态变化。将原始 JSON 封装进 `RawEvidence`，严禁在此时进行字段裁剪。

### 6.3 Phase 3: Relational (图谱骨架建立)
*   **职责**：建立初始关系网络。
*   **核心逻辑**：
    *   **Taxonomy Path**：递归提取 `Hypernym` 全路径，构建至 `entity` 的全路径树。记录路径上所有节点。
    *   **Graph Extraction**：抓取 ConceptNet 原始关联词（UsedFor, HasProperty, AtLocation 等）。
    *   **噪声剪枝**：根据内置统计学权重（Weight > 1.0）过滤低相关边。

### 6.4 Phase 4: Intellectual (语义精炼与智能蒸馏)
*   **职责**：利用 AI 蒸馏，将数据提纯为高质量资产。
*   **任务编排**：
    1.  **Sense Mapping**：利用 Phase 2 定义对 Phase 3 的模糊关联进行义项级消歧与绑定。
    2.  **Attribute Enrichment**：补全缺失的功能事实、属性事实和典型场景。
    3.  **Intensity Scoring**：为每条边标定关系的显著性强度（0.0-1.0）。
*   **资产锁定 (Distill Idempotency)**：
    *   计算 `Hash = SHA256(Context + Prompt + Model)`。
    *   若缓存命中，直接复用 `data/assets/distilled/` 下的 JSON 资产。

### 6.5 Phase 5: Synthesis (物化合成与审计)
*   **职责**：生成 `WordSnapshot` 资产并执行质量审计。
*   **冲突仲裁 (Arbiter Algorithm)**：
    *   采用加权信任模型解决多源冲突。
    *   `Definition` 权重：Oxford (0.9) > WordNet (0.8) > LLM (0.3) > ECDICT (0.2)。
    *   `Relations` 权重：WordNet (1.0) > LLM (0.7) > ConceptNet (0.5)。
*   **物化生成**：将 Lemma/Lexeme/Relation 的层级结构打平为自包含的物化 JSON。

---

## 7. 质量治理模型 (Quality Governance)

### 7.1 质量评分向量 (QScore Formula)
系统为每一个 Snapshot 计算一个由四个维度组成的质量向量：
$$QScore = W_c \cdot C + W_d \cdot D + W_r \cdot R + W_v \cdot V$$
*   **Completeness (C)**: 释义、音标、词义、词性等基础字段的覆盖率。
*   **Depth (D)**: 上位词层级路径完整度，必须确保能追溯至根节点。
*   **Density (R)**: 有效语义关系边的丰富度（连接密度）。
*   **Validity (V)**: 跨源证据的一致性评分（基于共识算法的冲突率）。

### 7.2 分级治理策略
*   **Tier 1 (Core)**：5,000 核心词。必须全 Phase 运行，QScore 目标 > 95。
*   **Tier 2/3**：扩展词与长尾词。Phase 4 按需触发，侧重于结构化层级的完整性。

---

## 8. 关键算法与技术难题解决方案

### 8.1 跨源义项对齐算法 (Sense Alignment)
*   **挑战**：如何将不同来源（如 ECDICT）的释义挂载到统一的义项节点（如 WordNet Synset）上？
*   **方案**：**“语义向量距离 + 语法特征过滤”**。
    1.  计算待对齐释义的文本 Embedding。
    2.  计算其与候选义项定义的余弦相似度。
    3.  在 `Similarity > 0.85` 且 `POS` 匹配时建立关联，否则标记为 `Pending_Review`。

### 8.2 异步任务流控 (Task Scheduling)
*   **挑战**：Phase 4 LLM 调用极慢且受限，Phase 1-3 极快。
*   **方案**：采用 **“分速双轨异步队列”**。
    *   **Fast Lane**: 并行处理 Phase 1-3，快速填充数据库骨架。
    *   **Slow Lane**: 受控并发处理 Phase 4，支持基于词汇 Tier 的优先级调度。
    *   **Back-pressure**: 当 Slow Lane 积压超过阈值时，自动暂停 Fast Lane 的任务摄入。

### 8.3 证据归一化 (The Envelope Pattern)
*   **设计**：`RawEvidence` 表不预先清洗数据，而是存储原始响应信封。
*   **结构**：包含 `ProviderID`, `PhaseID`, `Content (JSONB)`, `SchemaHash`, `SourceTimestamp`。
*   **价值**：支持在不重刷数据的情况下，通过更新合成逻辑（Synthesis）来提取新字段。

---

## 9. 存储与分发设计

### 9.1 资产存储目录规范
```bash
data/
├── evidence/              # 原始证据库 (按 Provider/Phase 分层存储)
│   ├── wordnet/
│   ├── conceptnet/
│   └── oxford/
├── assets/                # 固化资产库
│   ├── distilled/         # LLM 蒸馏后的原始响应 JSON (以 word_hash 命名)
│   └── snapshots/         # 最终生成的物化快照 JSON 文件
└── logs/                  # 流水线执行详细审计日志
```

---

## 10. 管理端与运维 (Admin & Ops)

### 10.1 证据溯源视图 (The Lineage View)
*   **功能**：管理端支持从物化快照的任何字段直接反推至所有原始证据片段。
*   **价值**：实现对 AI 推理结果和仲裁逻辑的精准审计与调试。

### 10.2 运营干预工具
*   **Overrule 机制**：支持管理员插入 `Manual` 来源的证据，强制覆盖自动化合成结果。
*   **Selective Retry**：支持针对特定词汇、特定阶段（如仅重跑消歧）或特定 Provider 执行强制刷新。
*   **CLI**：
    *   `add-word [word]`: 单词手动注入。
    *   `pipeline-status`: 监控全局流水线热力图。
    *   `snapshot-diff [v1] [v2]`: 对比快照版本的全局数据差异。

---

## 11. 应用对接规范 (以 Universe 为例)

VocNet 保持其中立的基础设施地位，应用方负责业务表现：
1.  **数据订阅**：Universe 订阅 VocNet 的 `SnapshotUpdate` 事件。
2.  **映射转换**：Universe 映射引擎根据快照中的 `Semantic Tags` 和层级路径，执行其内部规则定义的星系（Galaxy）映射逻辑。
3.  **渲染控制**：Universe 将快照中的 `Strength` 分值映射为 3D 节点的缩放、颜色深度或连线粗细。

---

## 12. 总结与价值

通过本流水线机制的设计，VocNet 实现了从“一次性导入”到“持续性迭代进化”的根本转变。

*   **数据层面**：实现了质量的阶梯式累积，确保了每一条语义事实的可溯源性和准确性。
*   **资产层面**：通过哈希锁定和持久化，将昂贵的计算成本转化为了核心竞争力的数字资产库。
*   **架构层面**：成功解决了基础设施中立性与应用多变性之间的矛盾，为 VocNet 未来的多维应用打下了坚实的工程底座。

---

**文档结束**
