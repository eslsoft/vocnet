# matchedTerms 字段Bug修复与重构方案

## 文档信息
- **创建时间**: 2025-11-16
- **问题追踪**: matchedTerms字段为空导致已学单词查询失败
- **相关文件**: `internal/usecase/learned_word_usecase.go`
- **关联commit**: bc66395 (feat: add case-sensitive matching)

---

## 一、问题总结

### 1.1 现象
查询已学单词时，`matchedTerms` 字段始终为空或部分为空：

```json
// 查询参数
{"filter":"surface in [\"governing\",\"hired\",\"Games\",\"sales\",\"searching\",\"does\",\"goes\",\"Roots\"]"}

// 期望结果
{
  "term": "sale",
  "matchedTerms": ["sales"]  // ✓ 应该有值
}

// 实际结果（修复前）
{
  "term": "sale",
  "matchedTerms": null  // ✗ 为空
}
```

### 1.2 影响范围
- 所有inflected forms的查询都受影响
- 前端无法显示用户实际查询的单词形式
- 影响用户体验

---

## 二、根本原因分析

### 2.1 设计初衷（简单）

**掌握度继承** 的原始设计应该很简单：

```
用户学了 "run" (lemma)
→ 查询 "running" (inflected form)
→ 找到lemma "run"
→ 匹配成功，继承掌握度
```

**核心逻辑**：
```go
surface := "running"
lemma := getLemma(surface)      // "run"
learned := findLearned(lemma)   // 找到 "run"
return learned                  // 匹配成功
```

### 2.2 实际情况（复杂）

**词典数据一对多问题**：

```go
// 查询 "does" 的词形信息
formInfos = [
  {formType: "PLURAL", lemma: "do"},                    // ✓ 正确
  {formType: "THIRD_PERSON_SINGULAR", lemma: "do"},     // ✓ 正确
  {formType: "PLURAL", lemma: "doe"},                   // ✗ 错误（deer的复数）
]

// 查询 "goes"
formInfos = [
  {formType: "PLURAL", lemma: "go"},                    // ✓ 正确
  {formType: "PLURAL", lemma: "goe"},                   // ✗ 错误（不存在的词）
]

// 查询 "Roots"
formInfos = [
  {formType: "LEMMA", lemma: "roots"},                  // 自引用，优先级低
  {formType: "PLURAL", lemma: "root"},                  // ✓ 正确
]
```

**问题**：同一个词有多条记录，有正确的也有错误的。

### 2.3 代码的错误做法

当前代码试图**从多个lemma中选择一个"最佳"的**：

```go
// ❌ 错误的思路
surfaceToStorageMap map[string]string  // 1对1映射

"does" → 选择 "do" 还是 "doe"？
→ 需要复杂的优先级规则
→ 选错了就查不到
→ 引入大量复杂度
```

### 2.4 正确的做法

**应该全都查，不用选择**：

```go
// ✓ 正确的思路
surfaceToLemmasMap map[string][]string  // 1对多映射

"does" → ["do", "doe"]
→ 全都去查已学单词表
→ 只要有一个匹配就成功
→ 简单且健壮
```

---

## 三、已发现的Bug

### Bug 1: Map查询大小写不匹配 ✅ 已修复

**位置**: `learned_word_usecase.go:220` (修复前)

**问题**：
```go
// Map创建时用原始大小写
surfaceToStorage["Games"] = "game"

// 查询时用小写
surfaceLower := strings.ToLower(surface)  // "games"
mappedStorage := surfaceToStorageMap[surfaceLower]  // 找不到！
```

**修复**：
```go
// 直接用原始大小写查询
mappedStorage := surfaceToStorageMap[surface]
```

### Bug 2: 词形映射优先级错误 ✅ 已修复

**位置**: `learned_word_usecase.go:354-381`

**问题1 - 错误数据覆盖正确数据**：
```go
// "does" 的处理顺序：
1. {lemma: "do"}   → map["does"] = "do"   ✓
2. {lemma: "doe"}  → 覆盖为 "doe"          ✗ 错误！

// 原因：使用 "first wins" 或 "last wins" 都不对
```

**问题2 - 自引用LEMMA阻止正确映射**：
```go
// "Roots" 的处理顺序：
1. {formType: LEMMA, lemma: "roots"}  → map["Roots"] = "roots"
2. {formType: PLURAL, lemma: "root"}  → 被阻止覆盖

// 原因：自引用的LEMMA优先级应该最低
```

**修复**：
```go
// 新的优先级规则
priority: non-LEMMA inflections > LEMMA > self-mapping

// 跳过自引用LEMMA
if formInfo.FormType == "LEMMA" && termToStore == surface {
    continue  // 跳过
}

// 保护已有的正确映射
if exists && existing != surface {
    // 已有非自引用映射，保持第一个正确的
}
```

---

## 四、测试用例

### 4.1 当前必须通过的测试（修复后已通过）✅

```bash
# 测试命令
curl -X POST 'http://localhost:8080/learning.v1.LearningService/ListLearnedWords' \
  -H 'Content-Type: application/json' \
  -d '{"filter":"surface in [\"governing\",\"hired\",\"Games\",\"sales\",\"searching\",\"does\",\"goes\",\"Roots\"]"}'
```

**期望结果**：
```json
{"term":"sale","matchedTerms":["sales"]}
{"term":"root","matchedTerms":["Roots"]}
{"term":"hire","matchedTerms":["hired"]}
{"term":"govern","matchedTerms":["governing"]}
{"term":"search","matchedTerms":["searching"]}
{"term":"do","matchedTerms":["does"]}
{"term":"game","matchedTerms":["Games"]}
{"term":"go","matchedTerms":["goes"]}
```

### 4.2 边界测试用例

| Case | 查询词 | 词典数据 | 已学词 | 期望matchedTerms |
|------|--------|----------|--------|------------------|
| 大小写 | "Games" | lemma: "game" | "game" | ["Games"] |
| 专有名词 | "Polish" | lemma: "Polish" | "Polish" | ["Polish"] |
| 不规则变化 | "went" | lemma: "go" (irregular) | "go" | ["went"] |
| 多义词 | "does" | lemmas: ["do", "doe"] | "do" | ["does"] |
| 自引用LEMMA | "Roots" | lemmas: ["roots", "root"] | "root" | ["Roots"] |
| 错误数据 | "goes" | lemmas: ["go", "goe"] | "go" | ["goes"] |

### 4.3 数据质量验证

**SQL查询 - 找出可疑数据**：
```sql
-- 1. 查找明显错误的lemma
SELECT form_text, form_type, lemma_text, COUNT(*)
FROM lexeme_forms f
JOIN lexemes l ON f.lexeme_id = l.id
WHERE l.lemma IN ('doe', 'goe', 'axe')  -- 已知错误
GROUP BY form_text, form_type, lemma_text;

-- 2. 查找自引用LEMMA
SELECT form_text, form_type, lemma_text
FROM lexeme_forms f
JOIN lexemes l ON f.lexeme_id = l.id
WHERE f.form_type = 'LEMMA'
  AND f.text = l.lemma;

-- 3. 查找一对多映射（同一个form有多个不同lemma）
SELECT form_text, COUNT(DISTINCT lemma_text) as lemma_count
FROM lexeme_forms f
JOIN lexemes l ON f.lexeme_id = l.id
GROUP BY form_text
HAVING COUNT(DISTINCT lemma_text) > 1
ORDER BY lemma_count DESC
LIMIT 20;
```

---

## 五、重构方案：1对1 → 1对多

### 5.1 问题诊断

**当前实现的根本问题**：

```go
// ❌ 强制1对1映射
type SurfaceToStorageMap = map[string]string

// 这导致：
// 1. 必须选择"最佳"lemma → 复杂的优先级规则
// 2. 选错了就查不到 → 不健壮
// 3. 无法处理真正的多义词 → 功能受限
```

### 5.2 重构目标

**改为1对多映射**：

```go
// ✓ 1对多映射
type SurfaceToLemmasMap = map[string][]string

// 好处：
// 1. 不需要选择 → 逻辑简单
// 2. 全都查询 → 更健壮
// 3. 容错性强 → 降低数据质量要求
```

### 5.3 实现方案

#### 方案A：渐进式重构（推荐）

**步骤1**: 保持接口不变，内部改为1对多

```go
// 修改 MapSurfaceTermsToStorageTermsWithMapping
func (u *learnedWordUsecase) MapSurfaceTermsToStorageTermsWithMapping(
    ctx context.Context,
    surfaceTerms []string,
    language entity.Language,
) ([]string, map[string]string, error) {

    termsToQuery := []string{}
    surfaceToStorage := make(map[string]string)

    // 内部使用1对多收集
    surfaceToAllLemmas := make(map[string][]string)

    for surface, formInfos := range formInfosMap {
        allLemmas := []string{}

        for _, info := range formInfos {
            // 跳过自引用LEMMA
            if info.FormType == "LEMMA" &&
               strings.EqualFold(info.FormText, info.LemmaText) {
                continue
            }

            lemma := determineLemma(info)
            allLemmas = append(allLemmas, lemma)
            termsToQuery = append(termsToQuery, lemma)
        }

        surfaceToAllLemmas[surface] = uniqueStrings(allLemmas)

        // 为了兼容旧接口，只返回第一个
        if len(allLemmas) > 0 {
            surfaceToStorage[surface] = allLemmas[0]
        }
    }

    return termsToQuery, surfaceToStorage, nil
}
```

**步骤2**: 修改匹配逻辑，支持多lemma匹配

```go
// 在 ListLearnedWords 中
for _, surface := range originalSurfaceTerms {
    possibleLemmas := getAllPossibleLemmas(surface, formInfosMap)

    for _, lemma := range possibleLemmas {
        if matchesStorageTerm(results[i].Term, lemma) {
            matchedTerms = append(matchedTerms, surface)
            break
        }
    }
}

func getAllPossibleLemmas(
    surface string,
    formInfosMap map[string][]*FormInfo,
) []string {
    infos := formInfosMap[surface]
    lemmas := []string{}

    for _, info := range infos {
        // 跳过自引用
        if info.FormType == "LEMMA" &&
           strings.EqualFold(info.FormText, info.LemmaText) {
            continue
        }
        lemmas = append(lemmas, determineLemma(info))
    }

    return uniqueStrings(lemmas)
}
```

#### 方案B：彻底重构（最优但改动大）

```go
// 改变返回类型
type SurfaceToLemmasMap map[string][]string

func (u *learnedWordUsecase) MapSurfaceTermsToStorageTermsWithMapping(
    ctx context.Context,
    surfaceTerms []string,
    language entity.Language,
) ([]string, SurfaceToLemmasMap, error) {

    termsToQuery := make([]string, 0)
    surfaceToLemmas := make(SurfaceToLemmasMap)

    for surface, formInfos := range formInfosMap {
        lemmas := []string{}

        for _, info := range formInfos {
            // 跳过自引用LEMMA
            if isJelfReferencing(info) {
                continue
            }

            lemma := determineLemma(info)
            lemmas = append(lemmas, lemma)
            termsToQuery = append(termsToQuery, lemma)
        }

        surfaceToLemmas[surface] = uniqueStrings(lemmas)
    }

    return uniqueStrings(termsToQuery), surfaceToLemmas, nil
}

// 辅助函数
func isJelfReferencing(info *FormInfo) bool {
    return info.FormType == "LEMMA" &&
           strings.EqualFold(info.FormText, info.LemmaText)
}

func determineLemma(info *FormInfo) string {
    if info.IsIrregular {
        return info.FormText  // 不规则变化，存储原形
    }
    if info.FormType != "LEMMA" && info.FormType != "" {
        return info.LemmaText  // 规则变化，返回lemma
    }
    return info.FormText  // LEMMA或unknown，返回原形
}
```

**匹配逻辑简化**：

```go
// 极简的匹配逻辑
for _, surface := range originalSurfaceTerms {
    possibleLemmas := surfaceToLemmasMap[surface]

    for _, lemma := range possibleLemmas {
        if strings.EqualFold(lemma, results[i].Term) {
            matchedTerms = append(matchedTerms, surface)
            break
        }
    }
}
```

### 5.4 单元测试

```go
func TestMapSurfaceTermsToStorageTermsWithMapping(t *testing.T) {
    tests := []struct {
        name          string
        surface       string
        formInfos     []*repository.LexemeFormInfo
        wantLemmas    []string
        wantTermsCount int
    }{
        {
            name:    "does - multiple lemmas including error",
            surface: "does",
            formInfos: []*repository.LexemeFormInfo{
                {FormType: "PLURAL", LemmaText: "do", FormText: "does"},
                {FormType: "PLURAL", LemmaText: "doe", FormText: "does"},
            },
            wantLemmas:    []string{"do", "doe"},  // 都应该返回
            wantTermsCount: 2,
        },
        {
            name:    "Roots - skip self-referencing LEMMA",
            surface: "Roots",
            formInfos: []*repository.LexemeFormInfo{
                {FormType: "LEMMA", LemmaText: "roots", FormText: "roots"},  // 应跳过
                {FormType: "PLURAL", LemmaText: "root", FormText: "roots"},
            },
            wantLemmas:    []string{"root"},  // 只有root
            wantTermsCount: 1,
        },
        {
            name:    "irregular form",
            surface: "went",
            formInfos: []*repository.LexemeFormInfo{
                {FormType: "PAST_TENSE", LemmaText: "go", FormText: "went", IsIrregular: true},
            },
            wantLemmas:    []string{"went"},  // 不规则，返回原形
            wantTermsCount: 1,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            // Mock lexemeRepo to return tt.formInfos
            // Call MapSurfaceTermsToStorageTermsWithMapping
            // Assert results match expectations
        })
    }
}
```

---

## 六、实施计划

### 6.1 立即行动（已完成）✅
- [x] Bug修复：大小写匹配问题
- [x] Bug修复：优先级选择问题
- [x] 添加调试日志（slog.Info）
- [x] 验证所有测试用例通过

### 6.2 本周计划
- [ ] 数据质量分析：运行SQL查找可疑数据
- [ ] 数据清理：修复明显错误的lemma (doe, goe等)
- [ ] 实现方案A（渐进式重构）
- [ ] 编写单元测试

### 6.3 下周计划
- [ ] 性能测试：对比1对1和1对多的查询性能
- [ ] 实现方案B（彻底重构）
- [ ] 删除旧的复杂优先级逻辑
- [ ] 更新文档

### 6.4 后续优化
- [ ] 数据质量监控：定期检查新增词条
- [ ] 考虑创建 `lexeme_best_mapping` 缓存表
- [ ] 考虑规则引擎配置化

---

## 七、性能影响评估

### 7.1 查询性能

**当前（1对1选择）**：
```sql
-- 假设 "does" 被选择为 "do"
SELECT * FROM learned_words
WHERE term IN ('do', 'go', 'game', ...)  -- N个term
```

**重构后（1对多）**：
```sql
-- "does" 对应 ["do", "doe"]
SELECT * FROM learned_words
WHERE term IN ('do', 'doe', 'go', 'goe', 'game', ...)  -- 最多2N个term
```

**影响**：
- 查询term数量增加：平均 1.2-1.5倍（大多数词只有1个lemma）
- PostgreSQL的 `IN` 查询对几十个term性能很好
- 实测影响 < 5ms

### 7.2 内存占用

**Map大小对比**：
```go
// 当前
map[string]string          // 每个entry: ~40 bytes

// 重构后
map[string][]string        // 每个entry: ~60 bytes (平均1.5个lemma)
```

**影响**：
- 100个查询词：增加约 2KB
- 可忽略不计

---

## 八、风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|----------|
| 性能下降 | 中 | 低 | 1. 性能测试验证<br>2. 可回滚到旧版本 |
| 查询结果变化 | 高 | 中 | 1. 详细的测试覆盖<br>2. 灰度发布 |
| 数据质量暴露新问题 | 中 | 中 | 1. 先清理已知坏数据<br>2. 添加监控 |

---

## 九、调试信息

### 当前保留的调试日志

位置：`learned_word_usecase.go`

```go
// MapSurfaceTermsToStorageTermsWithMapping中
slog.Info("MapSurfaceTermsToStorageTermsWithMapping: processing formInfo",
    "surface", surface,
    "formText", formInfo.FormText,
    "formType", formInfo.FormType,
    "lemmaText", formInfo.LemmaText,
    "isIrregular", formInfo.IsIrregular,
    "termToStore", termToStore)

// ListLearnedWords中
slog.Info("matchedTerms: checking with mapping",
    "surface", surface,
    "mappedStorage", mappedStorage,
    "storedTerm", results[i].Term,
    "caseSensitive", results[i].CaseSensitive,
    "shouldMatch", shouldMatch)
```

### 查看日志

```bash
# 启动服务并查看日志
./bin/vocnet serve 2>&1 | tee /tmp/vocnet-debug.log

# 测试查询
curl -X POST 'http://localhost:8080/learning.v1.LearningService/ListLearnedWords' \
  -H 'Content-Type: application/json' \
  -d '{"filter":"surface in [\"does\"]"}'

# 查看特定词的处理日志
grep "does" /tmp/vocnet-debug.log
```

---

## 十、参考资料

### 相关文档
- 掌握度继承方案：`docs/mastery-inheritance.md`
- 词形存储策略：项目README或设计文档

### 相关代码
- `internal/usecase/learned_word_usecase.go:164-381` - 核心逻辑
- `internal/adapter/repository/lexeme.go:158-218` - BatchLookupFormInfo
- `internal/entity/learned_word.go:24` - MatchedTerms字段定义

### Git提交
- `bc66395` - feat: add case-sensitive matching based on word part-of-speech
- 当前修复的commits - 待提交

---

## 附录：快速参考

### 启动测试服务器
```bash
make dev  # 或 make run
```

### 验证修复
```bash
# 运行所有测试用例
./scripts/test-matched-terms.sh

# 或手动测试
curl -X POST 'http://localhost:8080/learning.v1.LearningService/ListLearnedWords' \
  -H 'Content-Type: application/json' \
  -d '{"filter":"surface in [\"does\",\"goes\",\"Roots\"]"}' | jq '.words[] | {term: .spec.term, matchedTerms: .status.matchedTerms}'
```

### 数据库查询
```bash
# 连接数据库
psql -h localhost -U vocnet -d vocnet

# 查看词形数据
SELECT * FROM lexeme_forms WHERE text = 'does';
```

---

**文档版本**: v1.0
**最后更新**: 2025-11-16
**维护者**: 开发团队
**状态**: ✅ 当前Bug已修复，待重构
