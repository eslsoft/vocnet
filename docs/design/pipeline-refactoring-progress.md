# Pipeline 重构进度文档

## 重构目标

将Pipeline从基于语言学概念的阶段（discovery, lexical, relational, intellectual, synthesis）重构为基于数据工程标准流程的阶段（collection, evaluation, integration, snapshot），以建立稳定获取高质量数据的机制。

## 核心设计理念

### 数据融合Pipeline架构

```
Collection (采集碎片 + 契约验证)
    ↓
Evaluation (碎片质量评分)
    ↓
Integration (基于评分的智能拼图)
    ↓
Snapshot (生成最终快照)
```

### 关键特点

1. **部分数据契约（Partial Data Contract）**
   - 数据源只需提供它能提供的部分数据
   - 提供的数据必须符合标准化契约
   - 不符合契约的数据直接拒绝

2. **碎片化处理**
   - 每个数据源返回碎片（fragments）
   - 每个碎片独立评分
   - 字段级合并，选择最高分碎片

3. **数据溯源（Provenance）**
   - 记录每个字段来自哪个数据源
   - 记录质量评分
   - 记录有多少候选碎片被拒绝

## 已完成工作

### 1. 新的Phase定义 ✅

文件：`internal/usecase/pipeline/stage.go`

```go
type PipelinePhase string

const (
    PhaseCollection  PipelinePhase = "collection"   // 数据采集 + 契约验证
    PhaseEvaluation  PipelinePhase = "evaluation"   // 质量评分
    PhaseIntegration PipelinePhase = "integration"  // 智能拼图
    PhaseSnapshot    PipelinePhase = "snapshot"     // 快照生成
)

type Stage struct {
    Phase      PipelinePhase
    Number     int
    Processors []Processor
    Concurrent bool // Collection阶段可并发
}
```

### 2. 部分数据契约系统 ✅

文件：`internal/usecase/pipeline/contract.go`

**契约验证器**：
- `ContractValidator`: 验证数据源返回的部分数据
- `ValidateLexeme()`: 验证词条碎片
- `ValidateForm()`: 验证词形碎片
- `ValidateRelation()`: 验证关系碎片

**关键验证规则**：
- Lexeme: PartOfSpeech不能是Unspecified
- Form.Phonetic: IPA必须符合格式，Dialect必须是ISO 639格式（en-US而非US）
- Relation: Strength必须在[0, 1]范围，TargetRef必须是合法URI

**错误处理**：
- 契约违规返回`ContractViolationError`
- 包含详细的违规字段、规则、实际值
- 便于数据源调试和修复

### 3. 修复编译错误 ✅

- 更新`pipeline.go`中所有`stage.Name`引用为`stage.Phase`
- 修复`contract.go`中的entity字段引用错误
- 确保类型匹配（Language, PartOfSpeech, LexemeSense等）

## 待完成工作

### 4. 更新SourceRegistry

**当前问题**：
- `source_registry.go:92` - `NewStage(name, number, procs...)` 需要改为接受`PipelinePhase`

**解决方案**：
```go
// 需要建立旧stage名称到新Phase的映射
var stageToPhaseMapping = map[string]PipelinePhase{
    "discovery":    PhaseCollection,
    "lexical":      PhaseCollection, // 合并到Collection
    "relational":   PhaseCollection, // 合并到Collection
    "intellectual": PhaseEvaluation, // LLM评估移到Evaluation
    "synthesis":    PhaseSnapshot,
}

// 或者直接废弃旧的stageOrder，使用新的Phase系统
```

### 5. 实现碎片评分系统（FragmentEvaluator）

**新文件**：`internal/usecase/pipeline/fragment_evaluator.go`

```go
type FragmentEvaluator struct {
    scorer *RuleBasedScorer
    logger *slog.Logger
}

type FieldFragment struct {
    Type     string        // "lexeme", "form.phonetics", "metadata.level"
    Data     interface{}   // 实际数据
    Score    *QualityScore // 质量评分
    Provider string        // 数据源
}

type EvaluatedFragments struct {
    Provider  string
    Fragments map[string]*FieldFragment // key: fieldKey
}

// 为每个数据源的每个字段独立评分
func (fe *FragmentEvaluator) Evaluate(provider string, result *SourceResult) *EvaluatedFragments
```

### 6. 实现智能拼图系统（IntegrationProcessor）

**新文件**：`internal/usecase/pipeline/proc_integration.go`

```go
type IntegrationProcessor struct {
    evaluator *FragmentEvaluator
    logger    *slog.Logger
}

type IntegratedData struct {
    Lemma      *entity.Lemma
    Lexemes    []*entity.Lexeme
    Forms      map[string]*entity.LemmaForm // key: surface
    Relations  []*entity.SemanticRelation
    Provenance map[string]*DataProvenance   // 数据溯源
}

type DataProvenance struct {
    Provider     string
    Score        *QualityScore
    Timestamp    time.Time
    Alternatives int // 被拒绝的候选数
}

// 字段级拼图：选择最高分碎片
func (ip *IntegrationProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error)
```

**拼图逻辑**：
1. 收集所有数据源的评估碎片
2. 按字段分组（如`form:run:phonetics`, `metadata:level`）
3. 对每个字段，按评分排序，选择最高分
4. 合并到IntegratedData
5. 记录Provenance

### 7. 重构Collection阶段

**修改**：`internal/usecase/pipeline/generic_processor.go`

在GenericSourceProcessor中增加契约验证：

```go
func (gp *GenericSourceProcessor) Process(ctx context.Context, pctx *PipelineContext) (*ProcessResult, error) {
    result, err := gp.source.Lookup(ctx, req)
    if err != nil {
        return nil, err
    }

    // 契约验证
    validator := NewContractValidator()
    if err := validator.ValidateSourceResult(result, gp.source.Manifest().Name); err != nil {
        gp.logger.Error("contract violation, rejecting source data",
            "provider", gp.source.Manifest().Name,
            "error", err)
        return &ProcessResult{
            Status: ProcessStatusRejected,
        }, nil
    }

    // 返回碎片
    return convertToProcessResult(result), nil
}
```

### 8. 更新cmd/serve.go

**重构Pipeline构建**：

```go
stages := []*pipeline.Stage{
    pipeline.NewConcurrentStage(pipeline.PhaseCollection, 1,
        // 所有数据源并发获取碎片
        pipeline.NewCollectionProcessor(wikidataProvider, validator),
        pipeline.NewCollectionProcessor(ecdictProvider, validator),
        pipeline.NewCollectionProcessor(wordnetProvider, validator),
        pipeline.NewCollectionProcessor(conceptnetProvider, validator),
        pipeline.NewCollectionProcessor(mobyProvider, validator),
        pipeline.NewCollectionProcessor(cefrjProvider, validator),
    ),

    pipeline.NewStage(pipeline.PhaseEvaluation, 2,
        pipeline.NewFragmentEvaluator(scorer),
    ),

    pipeline.NewStage(pipeline.PhaseIntegration, 3,
        pipeline.NewIntegrationProcessor(evaluator),
    ),

    pipeline.NewStage(pipeline.PhaseSnapshot, 4,
        pipeline.NewLemmaSnapshotProcessor(),
    ),
}
```

### 9. 测试用例

**新文件**：`internal/usecase/pipeline/fragment_integration_test.go`

测试场景：
- 多数据源返回相同字段，验证选择最高分
- 数据源返回部分数据，验证拼图完整性
- 契约违规，验证数据被拒绝
- Provenance记录，验证溯源信息

### 10. 更新文档

需要更新：
- `docs/design/pipeline-stage-data-sources.md` - 新的阶段说明
- `docs/design/data-evaluation-adoption.md` - 碎片评分机制
- `docs/guides/data-evaluation-adoption-guide.md` - 使用指南
- 新增：`docs/contracts/v1/README.md` - 数据契约文档

## 数据契约文档示例

### VocNet Data Contract v1

**Lexeme契约**：
- `part_of_speech`: 禁止使用`unspecified`，必须是有效POS
- `senses`: 每个sense的gloss至少1字符
- `categories`: 每个category至少1字符

**Form契约**：
- `phonetics.ipa`: 必须是合法IPA格式（`/rʌn/` 或 `[rʌn]`）
- `phonetics.dialect`: 必须是ISO 639格式（`en-US`, `en-GB`）
  - ❌ 禁止：`US`, `UK`, `BrE`, `NAmE`
  - ✅ 正确：`en-US`, `en-GB`
- `syllables`: 每个syllable至少1字符

**Relation契约**：
- `relation_type`: 不能为空
- `target_ref`: 必须是合法URI（`wikidata://lexeme/L123`, `conceptnet://c/en/dog`）
- `strength`: 必须在[0.0, 1.0]范围
- `provider`: 必须指定

## 实施路线图

### Phase 1: 基础设施（已完成 80%）
- [x] 定义新Phase常量
- [x] 实现部分契约验证器
- [x] 修复编译错误
- [ ] 更新SourceRegistry映射

### Phase 2: 核心功能（待实施）
- [ ] 实现FragmentEvaluator
- [ ] 实现IntegrationProcessor
- [ ] 更新Collection处理器
- [ ] 更新Pipeline构建逻辑

### Phase 3: 测试与文档（待实施）
- [ ] 编写集成测试
- [ ] 更新设计文档
- [ ] 编写数据契约文档
- [ ] 编写迁移指南

### Phase 4: 数据源适配（待实施）
- [ ] 适配built-in数据源（Wikidata, Moby, CEFRJ）
- [ ] 更新contrib协议
- [ ] 适配external数据源（ECDICT, ConceptNet, WordNet）

## 预期收益

1. **清晰的阶段划分**：Collection → Evaluation → Integration → Snapshot
2. **并发优化**：Collection阶段所有数据源并发获取
3. **质量保证**：契约验证 + 评分机制
4. **数据溯源**：每个字段记录来源和评分
5. **易扩展**：新增数据源只需遵守契约
6. **可观测性**：契约违规自动监控和告警

## 注意事项

1. **兼容性**：保持现有Pipeline可运行，通过Feature Flag切换
2. **数据迁移**：Evidence表需增加`phase`字段
3. **渐进式**：先实现新Pipeline，验证后再替换
4. **文档先行**：数据契约文档需先编写，让数据源知道标准
