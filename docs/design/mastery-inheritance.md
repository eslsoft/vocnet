# 词汇掌握度继承机制

## 问题背景

在英语学习中,用户收藏了词根形式"run",当遇到其变形"running"时,希望系统能自动识别为"已学习"状态。但对于不规则变形(如"went"←"go"),由于语义和形态差异较大,不应该自动继承掌握度。

**核心需求**:
1. 批量查询300+单词时保持高性能(目标~10ms)
2. 用户收藏精确性:收藏什么就存储什么,不做隐式转换
3. 智能继承:规则变形(如running、runs)能继承lemma(如run)的掌握度
4. 区分规则/不规则:不规则变形(如went、gone)需要独立学习

## 核心设计原则

1. **收藏透明性**:用户收藏什么就存储什么,不做隐式转换
2. **查询继承性**:查询时统一处理继承逻辑,规则变形继承lemma的掌握度
3. **逻辑集中化**:继承逻辑集中在usecase层维护,避免重复实现
4. **性能优先**:批量查询保持高性能(目标2次SQL查询)

## 实现状态

### ✅ 已实现

1. **CollectWord (收藏单词)**
   - 收藏规则变形时自动创建lemma记录
   - 位置: `internal/usecase/learned_word_usecase.go:45-131`

2. **ListLearnedWords (列表查询)**
   - 支持掌握度继承机制
   - 通过 `auto_inherit_mastery` 参数控制 (默认 false)
   - 位置: `internal/usecase/learned_word_usecase.go:177-191`

### ❌ 未实现

以下功能文档曾提及支持继承,但当前仅实现大小写不敏感查询,未实现掌握度继承:

1. **StatsByTerms (单词本统计)**
   - 位置: `internal/adapter/repository/learned_word.go:254`
   - 调用方: 单词本统计、复习计划统计

2. **GetByReviewPlan (复习计划单词获取)**
   - 位置: `internal/adapter/repository/learned_word.go:439`
   - 调用方: 复习计划闪卡生成

**影响**: 单词本和复习计划功能暂不支持变形词继承lemma掌握度。如单词本包含"runs"但用户只学习了"run",统计时不会显示"runs"已学习。

## 存储策略

### 收藏行为与存储

| 用户行为 | 示例 | 数据库存储 | 说明 |
|---------|------|-----------|------|
| 收藏lemma | 收藏"run" | "run" | 直接存储 |
| 收藏规则变形 | 收藏"running" | "running" + "run"(自动) | 存储原词 + 自动创建lemma(如不存在)|
| 收藏不规则变形 | 收藏"went" | "went" | 只存储原词(不创建"go") |

### 自动创建Lemma的规则

**触发条件**:
- 用户收藏的词是**规则变形**(通过Wikidata lexeme判断)
- 对应的**lemma不存在**于用户词库

**创建行为**:
- 自动创建lemma记录,继承相同的初始掌握度
- 如果lemma已存在,**不更新**其掌握度(保护用户数据)

**不创建的情况**:
- 不规则变形(irregular=true)
- 用户收藏的就是lemma本身
- Lemma已存在于用户词库

## 查询继承机制

### 继承规则

查询时,系统根据词形特征决定是否继承:

| 查询词类型 | 继承行为 | 示例 |
|----------|---------|------|
| Lemma | 查询自己 | "run" → "run" |
| 规则变形 | 查询自己+继承lemma | "running" → "running"或"run" |
| 不规则变形 | 只查询自己 | "went" → "went"(不继承"go") |

### 精确匹配优先

当数据库中同时存在变形和lemma时,优先返回精确匹配:

```
数据库: ["run" (mastery=5), "running" (mastery=3)]

查询"running" → 返回 mastery=3 (精确匹配)
查询"runs"    → 返回 mastery=5 (继承自"run")
```

### 查询示例 (ListLearnedWords with auto_inherit_mastery=true)

**场景**:数据库存储了`["run" (mastery=5), "running" (mastery=3), "went" (mastery=2)]`

**查询请求** `["run", "running", "runs", "went", "go"]`:

| 查询词 | 继承映射 | 数据库匹配 | 返回结果 |
|-------|---------|-----------|---------|
| run | run → run | ✅ "run" | mastery=5 |
| running | running → running | ✅ "running" | mastery=3 (精确匹配优先) |
| runs | runs → run | ✅ "run" | mastery=5 (继承自lemma) |
| went | went → went | ✅ "went" | mastery=2 |
| go | go → go | ❌ 不存在 | Unknown (不规则不继承) |

## 性能优化

### SQL查询优化

**收藏流程**(per word):
- 1次 lexeme form查询(判断是否规则变形)
- 1次 lemma存在性检查
- 1-2次 Create/Update(原词 + 可能的lemma)

**批量查询流程**(300+ words):
- 1次 批量lexeme form查询
- 1次 批量learned_word查询

**总计**: 2次SQL查询 ⚡

### 去重优化

通过继承映射,大幅减少实际查询词数:

```
单词本: ["run", "running", "runs", "ran"]
映射后: ["run", "ran"]  ← 查询词数从4减少到2
```

对于包含大量规则变形的单词本,实际查询词数可减少50-80%。

## 继承表

完整的继承规则矩阵:

| 查询词 | 数据库状态 | 映射结果 | 返回掌握度 | 说明 |
|-------|-----------|---------|-----------|------|
| "run" | "run"存在 | run→run | mastery(run) | 精确匹配 |
| "running" | "running"存在 | running→running | mastery(running) | 精确匹配优先 |
| "running" | 只有"run"存在 | running→run | mastery(run) | 继承lemma |
| "runs" | "run"存在 | runs→run | mastery(run) | 继承lemma |
| "went" | "went"存在 | went→went | mastery(went) | 不规则不继承 |
| "went" | 只有"go"存在 | went→went | Unknown | 不规则不继承 |

## 实现架构

### 分层职责

```
┌─────────────────────────────────────────┐
│  API Layer (ConnectRPC)                 │
│  - 接收AutoInheritMastery参数          │
│  - 调用usecase层                       │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Usecase Layer                          │
│  - CollectWord: 自动创建lemma逻辑      │
│  - MapSurfaceTermsToStorageTerms:       │
│    统一继承映射(核心逻辑)               │
│  - ListLearnedWords: 应用继承映射      │
└─────────────────────────────────────────┘
                  ↓
┌─────────────────────────────────────────┐
│  Repository Layer                       │
│  - FindByTerm: 精确匹配优先            │
│  - List: 根据映射后的terms查询         │
│  - 使用normal字段做case-insensitive查询│
└─────────────────────────────────────────┘
```

### 核心接口

**MapSurfaceTermsToStorageTerms**

统一的继承逻辑入口,负责:
1. 批量查询词形信息(lexeme forms)
2. 构建继承映射关系(surface → lemma)
3. 返回去重后的存储词列表

**应用场景**:
- ListLearnedWords (列表查询) - **唯一应用场景,通过 auto_inherit_mastery 参数控制**

### 数据流示例

```
用户查询 ["running", "runs", "went"]
         ↓
MapSurfaceTermsToStorageTerms
  ├→ 查询lexeme forms
  ├→ 构建映射: {"running":"run", "runs":"run", "went":"went"}
  └→ 返回: ["run", "running", "went"] (去重后)
         ↓
Repository.List
  └→ WHERE term IN ("run", "running", "went")
         ↓
Usecase层应用映射
  ├→ "running" 匹配到 "running" (精确) → mastery=3
  ├→ "runs" 映射到 "run" → mastery=5
  └→ "went" 匹配到 "went" → mastery=2
```

## 掌握度更新策略

```
场景1: 数据库空 → 收藏"running" (mastery=3)
   结果: ["run" (3), "running" (3)]  ← 自动创建lemma

场景2: 数据库有"run" (5) → 收藏"running" (3)
   结果: ["run" (5), "running" (3)]  ← 不更新lemma

场景3: 数据库有"running" (3) → 收藏"run" (5)
   结果: ["run" (5), "running" (3)]  ← 正常更新
```

**设计理念**:保护用户已有数据,避免自动覆盖。

## 数据迁移

### 向后兼容性

**旧数据兼容**:无需迁移,新旧数据都能正确处理

**迁移策略**:
- 保持旧数据不变
- 新收藏遵循新规则
- 查询时统一通过继承映射处理

示例:
```
旧数据: ["run" (mastery=4)]  # 可能来自收藏"running"
新查询: ["running"]
结果: 继承映射 "running"→"run" → 返回 mastery=4 ✅
```

## AutoInheritMastery参数

### API控制

**唯一支持继承的API**: `ListLearnedWords`

该API提供`auto_inherit_mastery`参数,允许客户端选择是否启用掌握度继承:

```protobuf
message ListLearnedWordsRequest {
  bool auto_inherit_mastery = 4;  // 默认false
}
```

**参数说明**:
- `true`: 启用掌握度继承,规则变形可以继承lemma的掌握度
- `false` (默认): 禁用继承,仅精确匹配查询

**适用场景**:
- 单词本应用场景(显示学习进度): 设置为 `true`
- 精确查询、数据导出: 保持 `false` (默认值)

**限制**:
- 其他API(如单词本统计、复习计划获取)暂不支持掌握度继承,仅使用大小写不敏感查询

### 行为差异

| auto_inherit_mastery | 查询行为 | 示例 |
|---------------------|---------|------|
| false | 1:1精确查询 | "runs" → 只查"runs" |
| true | 应用继承映射 | "runs" → 查"runs"和"run" |

## 优势总结

| 优势 | 说明 |
|------|------|
| **用户透明** | 收藏什么存什么,行为可预测 |
| **逻辑集中** | 继承逻辑只在usecase层维护,易于修改 |
| **性能高效** | 2次SQL查询,去重后查询词数大幅减少 |
| **灵活性高** | 支持精确收藏(override lemma) |
| **可控性强** | 通过参数控制是否启用继承,默认关闭 |
| **向后兼容** | 无需数据迁移 |

## 注意事项

### 1. 自动创建Lemma的时机

✅ **会自动创建**:
- 用户收藏规则变形(如"running")
- Lemma不存在于用户词库

❌ **不会自动创建**:
- 不规则变形(如"went")
- Lemma已存在(保护用户数据)
- 用户收藏的就是lemma本身

### 2. Lexeme查询失败的处理

如果Wikidata lexeme查询失败:
- 当前实现:返回错误,阻止收藏
- 建议优化:降级策略,按原词存储(不自动创建lemma)

### 3. 多义词处理

当前实现限制:如果一个词有多个lexeme记录,不会自动创建lemma。这是为了避免歧义。

未来可以考虑支持多义词的智能选择。

### 4. 性能监控建议

监控指标:
- Lemma自动创建失败率
- 继承映射去重率(体现性能提升)
- 批量查询响应时间

## 测试覆盖

### 核心测试用例

**收藏测试**:
- 收藏规则变形自动创建lemma
- Lemma已存在时不更新
- 不规则变形不创建lemma

**查询测试**:
- ListLearnedWords 继承映射正确性
- 精确匹配优先
- 不规则变形不继承
- auto_inherit_mastery 参数开关测试

### 测试文件

- `internal/usecase/mastery_inheritance_test.go` - 继承机制核心测试
- `internal/usecase/learned_word_usecase_test.go` - usecase层测试

## 未来扩展

如需为其他API添加掌握度继承支持,可复用现有的 `MapSurfaceTermsToStorageTerms` 方法:

### 潜在扩展场景

1. **StatsByTerms (单词本统计)**
   - 在 `internal/adapter/repository/learned_word.go:254` 添加继承逻辑
   - 调用 `MapSurfaceTermsToStorageTerms` 预处理terms
   - 应用继承映射到统计结果

2. **GetByReviewPlan (复习计划)**
   - 在 `internal/adapter/repository/learned_word.go:439` 添加继承逻辑
   - 同样调用 `MapSurfaceTermsToStorageTerms` 预处理
   - 复习时能识别更多变形词

### 实现建议

由于 `MapSurfaceTermsToStorageTerms` 已经在 usecase 层实现,扩展时需要:
1. 考虑是否在 repository 方法中添加继承参数
2. 或在调用方(usecase层)预处理terms再传入repository
3. 保持与 ListLearnedWords 的行为一致性

## 相关文档

- `/api/proto/learning/v1/learning_service.proto` - API定义
- `/internal/usecase/learned_word_usecase.go` - 核心实现
- `/internal/repository/learned_word.go` - Repository接口
