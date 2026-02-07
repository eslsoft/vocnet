# Pipeline Implementation Status

**创建时间**: 2026-02-07
**状态**: MVP 已完成，需要数据源调整

---

## 实现完成情况

### ✅ 已完成（100% MVP）

#### 1. 数据结构（Database Schema）
- [x] `raw_evidences` - 证据信封库
- [x] `pipeline_tasks` - 流水线任务状态机
- [x] `semantic_relations` - 语义关系表（替代 Lexeme.Relations JSONB）
- [x] `word_snapshots` - 物化快照
- [x] `distill_caches` - LLM 蒸馏缓存（仅表结构）
- [x] `lemmas` 表增加 `wikidata_qid` 字段
- [x] `lexemes` 表移除 `relations` JSONB

#### 2. Protobuf 设计
- [x] `api/proto/pipeline/v1/pipeline_service.proto` - 完整服务定义
  - 仅设计，未生成 gRPC 服务端代码（符合 MVP 计划）

#### 3. Entity & Repository
- [x] 5个新 Entity: RawEvidence, PipelineTask, SemanticRelation, WordSnapshot, DistillCache
- [x] 4个新 Repository 接口和实现
- [x] LemmaRepository 增加 `CreateMinimal()` 方法

#### 4. Pipeline 五阶段
- [x] **Phase 1 (Discovery)** - Wikidata QID 锚定
  - 通过 Wikidata API 获取实体 Q-ID
  - 保存原始证据到 RawEvidence

- [x] **Phase 2 (Lexical)** - 词法证据采集
  - 当前为 stub（返回空结果）
  - 表结构已就绪

- [x] **Phase 3 (Relational)** - 关系图谱建立
  - 当前实现：调用 ConceptNet REST API
  - 创建 SemanticRelation 记录

- [x] **Phase 4 (Intellectual)** - LLM 蒸馏
  - 返回 nil（SKIPPED 状态，符合 MVP）

- [x] **Phase 5 (Synthesis)** - 物化合成
  - 聚合 Lexeme + Relations
  - 计算 QScore（完整性、深度、密度、有效性）
  - 生成 WordSnapshot

#### 5. Provider 适配器
- [x] `WikidataProvider` - REST API 客户端
- [x] `ConceptNetProvider` - REST API 客户端

#### 6. CLI 命令
```bash
vocnet pipeline process-word <term> [--language en] [--tier 2]
vocnet pipeline status <term>
vocnet pipeline snapshot <term>
```

#### 7. Orchestrator
- [x] 按序执行 5 个 Phase
- [x] 任务状态管理（PENDING → RUNNING → COMPLETED/FAILED/SKIPPED）
- [x] 自动创建 minimal lemma（词不存在时）
- [x] 错误处理：单个 Phase 失败不影响后续

---

## ⚠️ 重要变更需求

### 数据源架构调整

**现状问题：**
当前 Phase 3 (Relational) 实现依赖 ConceptNet REST API，但该 API 已不再提供服务。

**需要调整：**
所有外部数据源都应改为**本地数据文件**读取，而非 REST API 调用。

### 受影响的数据源

| 数据源 | 当前实现 | 需要改为 |
|--------|---------|---------|
| **ConceptNet** | REST API 调用 | 本地数据文件读取 |
| **ECDICT** | 未实现（在 hack/dictinit 中使用） | 本地数据文件读取 |
| **YdDict (有道词典)** | 未实现（在 hack/dictinit 中使用） | 本地数据文件读取 |
| **Wikidata** | REST API 调用 | 保持不变（Wikidata API 仍可用） |

### 需要修改的文件

#### Phase 3 (Relational)
**当前文件：**
- `internal/adapter/provider/conceptnet/client.go` - REST API 客户端
- `internal/usecase/pipeline/phase3_relational.go` - 使用 ConceptNetProvider

**修改方向：**
```go
// 改为本地数据读取器
type ConceptNetDataReader interface {
    // 从本地 assertions.csv 文件读取关系
    FindRelations(ctx context.Context, term string, language string) ([]ConceptNetEdge, error)
}
```

**数据文件格式：**
ConceptNet 提供 CSV 格式的 assertions 文件：
```csv
/c/en/hello	/r/RelatedTo	/c/en/greeting	...
/c/en/hello	/r/Synonym	/c/en/hi	...
```

#### 其他数据源
**ECDICT (stardict-ecdict):**
- 格式：SQLite 数据库或 CSV
- 位置：需要下载到 `data/ecdict/`
- 用途：英文单词定义、音标、词形

**YdDict (有道词典):**
- 格式：JSON 或自定义格式
- 位置：需要下载到 `data/yddict/`
- 用途：中英翻译

### 实施步骤

1. **下载数据文件**
   ```bash
   # ConceptNet Assertions
   mkdir -p data/conceptnet
   wget https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz
   gunzip conceptnet-assertions-5.7.0.csv.gz
   mv conceptnet-assertions-5.7.0.csv data/conceptnet/

   # ECDICT
   mkdir -p data/ecdict
   # 下载 stardict-ecdict 数据库

   # YdDict
   mkdir -p data/yddict
   # 下载有道词典数据
   ```

2. **重构 Provider 层**
   ```
   internal/adapter/provider/
   ├── conceptnet/
   │   ├── reader.go       # 本地文件读取器（新增）
   │   └── client.go       # REST API（废弃）
   ├── ecdict/
   │   └── reader.go       # 本地数据库读取器
   └── yddict/
       └── reader.go       # 本地文件读取器
   ```

3. **更新 Phase 实现**
   - Phase 2 (Lexical) - 使用 ECDICT/YdDict 本地数据
   - Phase 3 (Relational) - 使用 ConceptNet 本地数据

4. **配置文件**
   ```yaml
   # config.yaml
   pipeline:
     data_paths:
       conceptnet: "./data/conceptnet/conceptnet-assertions-5.7.0.csv"
       ecdict: "./data/ecdict/ecdict.db"
       yddict: "./data/yddict/yddict.json"
   ```

---

## 代码位置索引

### 核心文件
```
internal/
├── entity/
│   ├── evidence.go              # RawEvidence 实体
│   ├── pipeline_task.go         # PipelineTask 实体
│   ├── semantic_relation.go     # SemanticRelation 实体
│   ├── word_snapshot.go         # WordSnapshot 实体
│   └── distill_cache.go         # DistillCache 实体
│
├── repository/
│   ├── evidence_repository.go           # 证据库接口
│   ├── pipeline_task_repository.go      # 任务状态接口
│   ├── semantic_relation_repository.go  # 关系图谱接口
│   └── word_snapshot_repository.go      # 快照接口
│
├── adapter/
│   ├── repository/
│   │   ├── evidence_repo.go             # 证据库实现
│   │   ├── pipeline_task_repo.go        # 任务状态实现
│   │   ├── semantic_relation_repo.go    # 关系图谱实现
│   │   └── word_snapshot_repo.go        # 快照实现
│   │
│   └── provider/
│       ├── provider.go                  # Provider 接口定义
│       ├── wikidata/
│       │   └── client.go                # Wikidata REST API
│       └── conceptnet/
│           └── client.go                # ⚠️ 需要改为本地读取
│
├── usecase/pipeline/
│   ├── phase.go                 # Phase 接口
│   ├── orchestrator.go          # 编排器
│   ├── phase1_discovery.go      # Phase 1: Wikidata QID
│   ├── phase2_lexical.go        # Phase 2: 词法（stub）
│   ├── phase3_relational.go     # Phase 3: 关系（⚠️ 需要改为本地读取）
│   ├── phase4_intellectual.go   # Phase 4: LLM（stub）
│   └── phase5_synthesis.go      # Phase 5: 合成
│
└── infrastructure/database/entschema/
    ├── raw_evidence.go          # 证据表 schema
    ├── pipeline_task.go         # 任务表 schema
    ├── semantic_relation.go     # 关系表 schema
    ├── word_snapshot.go         # 快照表 schema
    ├── distill_cache.go         # 缓存表 schema
    ├── lemma.go                 # Lemma schema（已修改）
    └── lexeme.go                # Lexeme schema（已修改）

cmd/
└── pipeline.go                  # CLI 命令入口

api/proto/pipeline/v1/
└── pipeline_service.proto       # Protobuf 定义（仅设计）
```

---

## 测试验证

### 端到端测试
```bash
# 重置数据库
rm -f data/vocnet-pipeline-test.db

# 执行流水线
DATABASE_URL="file:./data/vocnet-pipeline-test.db" \
./bin/vocnet pipeline process-word hello --language en

# 查看状态
DATABASE_URL="file:./data/vocnet-pipeline-test.db" \
./bin/vocnet pipeline status hello

# 查看快照
DATABASE_URL="file:./data/vocnet-pipeline-test.db" \
./bin/vocnet pipeline snapshot hello
```

### 当前输出
```
Pipeline completed for: hello
Lemma ID: 1
Wikidata QID: Q57531726

Phase Status:
  Phase 1 (discovery): COMPLETED
  Phase 2 (lexical): COMPLETED (stub)
  Phase 3 (relational): FAILED (ConceptNet API 502)
  Phase 4 (intellectual): SKIPPED
  Phase 5 (synthesis): COMPLETED

Snapshot generated (v1)
  Quality Score: 12.5
  Lexemes: 1
  Relations: 0
```

### 单元测试
```bash
make test  # 全部通过 ✅
```

---

## 已知问题

### 1. ConceptNet API 不可用
- **问题**: Phase 3 调用 ConceptNet REST API 返回 502
- **原因**: ConceptNet 官方 API 已停止服务
- **解决方案**: 改为本地数据文件读取（见上文）

### 2. Phase 2 未实现
- **当前状态**: 返回空结果（标记为 COMPLETED）
- **缺失功能**: 从证据中提取 senses 和 forms
- **优先级**: 中

### 3. Phase 4 未实现
- **当前状态**: 返回 nil（标记为 SKIPPED）
- **缺失功能**: LLM 蒸馏
- **优先级**: 低（符合 MVP 计划）

---

## 下一步工作清单

### 🔥 高优先级（必须）
- [ ] **重构 Phase 3** - 改为本地 ConceptNet 数据读取
  - 下载 ConceptNet assertions CSV
  - 实现 ConceptNetDataReader
  - 更新 phase3_relational.go
  - 测试验证

- [ ] **完善 Phase 2** - 实现词法证据提取
  - 下载 ECDICT 数据
  - 实现 ECDICTReader
  - 从 Wikidata 证据提取 senses
  - 更新 Lexeme 实体

### 📋 中优先级（增强）
- [ ] **实现 gRPC 服务** - PipelineServiceServer
- [ ] **RetryPhase 功能** - 允许重试失败阶段
- [ ] **批量处理** - 支持处理词表
- [ ] **增加单元测试** - 覆盖 pipeline 逻辑

### 🔮 低优先级（未来）
- [ ] **Phase 4 (LLM)** - 集成 LLM 蒸馏
- [ ] **异步队列** - worker pool 处理
- [ ] **监控告警** - Prometheus 集成

---

## 数据文件下载清单

### ConceptNet
```bash
# 官方下载地址
https://github.com/commonsense/conceptnet5/wiki/Downloads

# 推荐版本: 5.7.0
wget https://s3.amazonaws.com/conceptnet/downloads/2019/edges/conceptnet-assertions-5.7.0.csv.gz

# 文件大小: ~1.5GB (压缩), ~5GB (解压)
# 格式: CSV
# 字段: relation_uri, start, end, context, weight, sources, ...
```

### ECDICT (stardict-ecdict)
```bash
# GitHub 仓库
https://github.com/skywind3000/ECDICT

# 下载地址
https://github.com/skywind3000/ECDICT/releases

# 推荐格式: SQLite (.db)
# 字段: word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, ...
```

### YdDict (有道词典)
```bash
# 需要自行爬取或购买数据集
# 或使用有道智云 API（需要 API key）

# 备选方案：使用其他中英词典数据
# 例如：CC-CEDICT (中文-英文词典)
https://www.mdbg.net/chinese/dictionary?page=cc-cedict
```

---

## 配置建议

### 数据文件存储结构
```
data/
├── conceptnet/
│   ├── conceptnet-assertions-5.7.0.csv
│   └── README.md
├── ecdict/
│   ├── ecdict.db
│   └── README.md
└── yddict/
    ├── yddict.json
    └── README.md
```

### 环境变量
```bash
# .env
DATABASE_URL=file:./data/vocnet.db

# Pipeline 数据路径
CONCEPTNET_DATA_PATH=./data/conceptnet/conceptnet-assertions-5.7.0.csv
ECDICT_DATA_PATH=./data/ecdict/ecdict.db
YDDICT_DATA_PATH=./data/yddict/yddict.json
```

---

## 参考文档

- [原始设计文档](./design/vocabulary-infrastructure-and-distillation-pipeline.md)
- [实施计划](../.claude/plans/wiggly-bouncing-owl.md)
- [Ent 文档](https://entgo.io/)
- [ConceptNet 数据格式](https://github.com/commonsense/conceptnet5/wiki/API)
- [ECDICT 文档](https://github.com/skywind3000/ECDICT/blob/master/README.md)

---

## 联系信息

如有问题，请参考：
1. 代码注释
2. Git commit history
3. 本文档的"代码位置索引"章节
4. 单元测试示例

**最后更新**: 2026-02-07
