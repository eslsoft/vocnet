# Lexeme Import Fixes

## 修复 1: ECDICT Word Forms 合并

### 问题
ECDICT enrichment 时，exchange 字段中的 word forms 没有被合并到 Wikidata 词中。

### 修复位置
- `scripts/lexeme_import/ecdict_enricher.go:384-392` - `mergeEnrichment()` 中添加 forms 合并
- `scripts/lexeme_import/ecdict_enricher.go:453-488` - 新增 `addForms()` 函数
- `scripts/lexeme_import/wikidata_stage.go:87` - enrichment 后重新注册 forms

### 修复内容
```go
// In mergeEnrichment()
if enrich.exchange != "" {
    _, forms := parseExchange(lexeme.GetLemma(), enrich.exchange)
    if len(forms) > 0 {
        if addForms(lexeme, forms) {
            changed = true
        }
    }
}

// In wikidata stage
s.enricher.RegisterWord(lexeme)
s.enricher.Enrich(lexeme)
s.enricher.RegisterWord(lexeme)  // ✅ 重新注册 enrichment 新增的 forms
```

## 修复 2: ECDICT POS 匹配优化

### 问题
当 ECDICT 导入的词在 Wikidata 中已存在时，相同 POS 的 definitions 没有合并，而是创建了新的 definition。

**案例**：`can` 词
- Wikidata: L14718 (noun) - 1 sense
- ECDICT: TL-xxx (noun) - 4 senses

结果：两个 noun definitions 并存，应该合并为一个

### 根本原因
导入流程问题：
1. L1888 (verb) 被处理时，创建 "can" 词，然后被 ECDICT 数据 enrichment
2. ECDICT 有 noun senses，于是 `ensureDefinition(lexeme, "noun")` 创建 TL-xxx noun definition
3. L14718 (noun) 稍后被处理，尝试创建 "can" 时遇到 AlreadyExists 错误
4. 系统查询现有词（已有 L1888 verb + TL-xxx noun），然后 merge L14718 noun
5. 结果：L1888 verb + TL-xxx noun + L14718 noun（重复）

问题在于：**enrichment 发生在各个 Wikidata lexeme 合并之前**，导致第一个被处理的 lexeme enrichment 时产生的 TL-xxx definition 无法被后续真实的 Wikidata lexeme 替换。

### 修复位置
`scripts/lexeme_import/wikidata_stage.go:321-361` - `mergeWords()` 函数中的 Wikidata definition 合并逻辑

### 修复策略
在合并 Wikidata definition 时：

1. **ECDICT definitions (TL prefix)**:
   - 按 **POS 匹配**到第一个现有的 Wikidata definition
   - 将 ECDICT senses 合并到该 definition
   - 如果没有匹配的 POS，才添加为新的 definition

2. **Wikidata definitions (L prefix)** - **新增逻辑**:
   - 使用 `LexemeId + POS` 保持唯一性
   - **在添加新 Wikidata definition 前，检查是否已存在同 POS 的 TL-xxx definition**
   - 如果存在，将 TL-xxx definition 的 senses 合并到新 Wikidata definition
   - 删除 TL-xxx definition，用 Wikidata definition 替换
   - 同一个词可以有多个相同 POS 但不同 LexemeId 的 definitions（来自不同 Wikidata lexemes，这是正常的）

### 修复效果

**修复前** (`can` 词有 5 个 definitions):
```
1. TL-xxx (ECDICT)  - noun      - 4 senses
2. L1888 (Wikidata) - verb      - 7 senses
3. TL-yyy (ECDICT)  - auxiliary - 1 sense
4. L14718 (Wikidata) - noun     - 1 sense  ← 重复！
5. L30365 (Wikidata) - verb     - 1 sense
```

**修复后** (`can` 词应该有 4 个 definitions):
```
1. L14718 (Wikidata) - noun      - 5 senses (1 Wikidata + 4 ECDICT)
2. L1888 (Wikidata)  - verb      - 7 senses
3. L30365 (Wikidata) - verb      - 1 sense
4. TL-yyy (ECDICT)   - auxiliary - 1 sense
```

## 测试

所有测试通过：
```bash
go test ./scripts/lexeme_import/... -v
```

## 重新导入

修复后需要重新运行导入脚本以应用更改：
```bash
make run -- import
```
