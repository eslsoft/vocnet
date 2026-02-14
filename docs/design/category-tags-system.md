# 分类标签系统 (Category Tags System)

## 概述

为了更好地组织和筛选词条，我们实现了一个多层级、可组合的分类标签系统。该系统通过 `words.categories` JSONB 数组字段来存储各种标签，支持高效查询和灵活扩展。

## 分类体系结构

### 层级1 - 基础类型
用于区分词条的基本语法/词法类别：
- `proper-noun` - 专有名词（人名、地名、组织名等）
- `common-noun` - 普通名词
- `phrasal-verb` - 短语动词
- `phrase` - 短语、习语
- `compound` - 复合词
- `affix` - 词缀（前缀/后缀）

### 层级2 - 实体类型
用于细分专有名词的具体类型：
- `person-name` - 人名
- `place-name` - 地名
- `organization` - 组织机构
- `brand` - 品牌
- `event` - 事件
- `language` - 语言名称
- `ethnic-group` - 民族/族群
- `temporal` - 时间相关（月份、星期等）

### 层级3 - 细分类型
更具体的实体子类型：

**人名细分：**
- `given-name` - 名字
- `family-name` - 姓氏
- `surname` - 姓
- `male-name` - 男性名字
- `female-name` - 女性名字
- `unisex-name` - 中性名字

**地名细分：**
- `city` - 城市
- `town` - 城镇
- `village` - 乡村
- `municipality` - 自治市
- `country` - 国家
- `state` - 州/省
- `province` - 省份
- `region` - 地区
- `territory` - 领地
- `capital` - 首都
- `river` - 河流
- `mountain` - 山脉
- `lake` - 湖泊
- `island` - 岛屿

**时间相关：**
- `weekday` - 星期几
- `month` - 月份

**组织细分：**
- `company` - 公司
- `university` - 大学
- `government` - 政府机构

**动物相关：**
- `animal` - 动物
- `dog-breed` - 犬种
- `cat-breed` - 猫种

### 层级4 - 领域标记
来自 ECDICT 的领域标签，使用 `domain:` 前缀：
- `domain:computing` - 计算机 [计]
- `domain:law` - 法律 [法]
- `domain:medicine` - 医学 [医]
- `domain:chemistry` - 化学 [化]
- `domain:biology` - 生物 [生]
- `domain:mathematics` - 数学 [数]
- `domain:physics` - 物理 [物]
- `domain:economics` - 经济 [经]
- `domain:military` - 军事 [军]
- `domain:architecture` - 建筑 [建]
- `domain:electronics` - 电子 [电]
- `domain:mechanics` - 机械 [机]
- `domain:geography` - 地理 [地]
- `domain:astronomy` - 天文 [天]
- `domain:music` - 音乐 [音]
- `domain:sports` - 体育 [体]

### 层级5 - 学习等级（现有）
用于按考试/难度级别筛选：
- `gk` - 高考
- `cet4` - 大学英语四级
- `cet6` - 大学英语六级
- `ky` - 考研
- `toefl` - 托福
- `ielts` - 雅思
- `gre` - GRE

## 实现细节

### 1. Wikidata 来源的分类

在 `internal/usecase/pipeline/collection/wikidata_helpers.go` 中，通过 `inferCategoriesFromSenses()` 函数从 gloss 文本推断分类：

```go
// 示例：识别人名
if strings.Contains(gloss, "male given name") {
    categories = ["proper-noun", "person-name", "given-name", "male-name"]
    POS = "noun"
}

// 示例：识别地名
if strings.Contains(gloss, "city in") {
    categories = ["proper-noun", "place-name", "city"]
    POS = "noun"
}
```

**支持的 gloss 模式：**
- 人名：`family name`, `surname`, `given name`, `male/female/unisex given name`, `first name`
- 地名：`city in/of`, `town in/of`, `village in/of`, `municipality in`, `capital of`, `state in`, `American state`, `country`, `territory`, `province`, `region`, `river in`, `mountain`, `lake in`, `island`, `place name`
- 时间：`day after`, `day of the week`, `month of the year`
- 组织：`company`, `organization`, `university`
- 其他：`language`, `ethnic group`, `dog breed`, `cat breed`
- 短语：`phrase`, `idiom`, `saying`, `proverb`

### 2. ECDICT 来源的分类

ECDICT 作为 contrib source 通过 `contrib/sources/ecdict.py` 提供领域标记：

```python
# 从定义中提取领域标记
# 输入: "[计][法] legal computing term"
# 输出: domains = ["computing", "law"]

# 在合并时转换为 categories
domainCategories = ["domain:computing", "domain:law"]
```

**领域标记映射：**
- 中文标记（如 `[计]`, `[法]`）会被映射到英文域名
- 多个领域标记会被去重
- 最终以 `domain:` 前缀形式存储在 categories 中

### 3. 数据库结构

```sql
-- words 表中的 categories 字段
CREATE TABLE words (
    ...
    categories JSONB,  -- 存储标签数组，如 ["proper-noun", "place-name", "city", "gk", "cet4"]
    ...
);

-- 推荐创建 GIN 索引以提高查询效率
CREATE INDEX idx_words_categories ON words USING GIN (categories);
```

### 4. 查询示例

```sql
-- 查询所有专有名词
SELECT * FROM words WHERE categories @> '["proper-noun"]';

-- 查询所有城市名称
SELECT * FROM words WHERE categories @> '["city"]';

-- 查询计算机领域的词汇
SELECT * FROM words WHERE categories @> '["domain:computing"]';

-- 查询适合 CET4 学习的地名
SELECT * FROM words
WHERE categories @> '["place-name"]'
  AND categories @> '["cet4"]';

-- 统计各领域的词汇数量
SELECT
    category,
    COUNT(*) as count
FROM words, jsonb_array_elements_text(categories) AS category
WHERE category LIKE 'domain:%'
GROUP BY category
ORDER BY count DESC;
```

## 数据示例

### 专有名词示例

**人名 - John:**
```json
{
  "lemma": "John",
  "pos": "noun",
  "categories": ["proper-noun", "person-name", "given-name", "male-name"]
}
```

**地名 - Paris:**
```json
{
  "lemma": "Paris",
  "pos": "noun",
  "categories": ["proper-noun", "place-name", "city", "capital"]
}
```

**州名 - Texas:**
```json
{
  "lemma": "Texas",
  "pos": "noun",
  "categories": ["proper-noun", "place-name", "state"]
}
```

**星期 - Monday:**
```json
{
  "lemma": "Monday",
  "pos": "noun",
  "categories": ["proper-noun", "temporal", "weekday"]
}
```

### 领域词汇示例

**计算机术语 - algorithm:**
```json
{
  "lemma": "algorithm",
  "pos": "noun",
  "categories": ["domain:computing", "gk", "cet6"]
}
```

**医学术语 - pharmacodynamics:**
```json
{
  "lemma": "pharmacodynamics",
  "pos": "noun",
  "categories": ["domain:medicine"]
}
```

## 扩展建议

### 1. 前端筛选功能

可以基于 categories 实现多维度筛选：
```typescript
interface FilterOptions {
  entityType?: string[];     // ["person-name", "place-name", ...]
  domain?: string[];          // ["computing", "law", ...]
  level?: string[];           // ["cet4", "cet6", ...]
  baseType?: string[];        // ["proper-noun", "common-noun", ...]
}
```

### 2. 智能推荐

基于用户学习历史和 categories，可以：
- 推荐同领域的词汇（如学习 `algorithm` 后推荐其他 `domain:computing` 词汇）
- 推荐相似实体类型（如学习人名后推荐地名）
- 按学习等级循序渐进

### 3. 统计分析

利用 categories 进行数据分析：
- 词汇覆盖度分析（各领域、各级别的词汇数量）
- 学习进度追踪（已掌握的专有名词比例、领域词汇比例等）
- 缺口识别（哪些类别的词汇掌握较少）

### 4. 未来扩展方向

**可能新增的分类：**
- `technical-term` - 技术术语
- `colloquial` - 口语
- `formal` - 正式用语
- `archaic` - 古语
- `slang` - 俚语
- `abbreviation` - 缩写
- `acronym` - 首字母缩略词

**语义关系标签：**
- `synonym-group:xxx` - 同义词组
- `antonym-of:xxx` - 反义词
- `related-to:xxx` - 相关词

## 性能考虑

### 1. 索引优化
```sql
-- GIN 索引支持高效的 @> 包含查询
CREATE INDEX idx_words_categories ON words USING GIN (categories);

-- 查询性能测试
EXPLAIN ANALYZE
SELECT * FROM words WHERE categories @> '["proper-noun", "city"]';
```

### 2. 数据大小
- 每个词条平均 3-5 个 categories
- JSONB 格式压缩存储，空间效率高
- 估计每个词条 categories 字段约占 50-100 字节

### 3. 查询优化
- 使用 `@>` 操作符而非 `?` 或 `?&`，充分利用 GIN 索引
- 避免在 categories 上进行 LIKE 查询
- 组合条件时，先筛选 categories 再做其他条件过滤

## 测试覆盖

所有分类相关功能都有完整的单元测试：
- `TestInferCategoriesFromSenses_PersonNames` - 测试人名识别
- `TestInferCategoriesFromSenses_Places` - 测试地名识别
- `TestInferCategoriesFromSenses_Time` - 测试时间相关词识别
- `TestInferCategoriesFromSenses_Organizations` - 测试组织名识别

运行测试：
```bash
go test ./internal/usecase/pipeline/collection/... -v -run "InferCategories"
```

## 迁移指南

如果需要为现有数据添加 categories：

```sql
-- 1. 为专有名词添加基础标签（基于 gloss 中的模式）
UPDATE words
SET categories = categories || '["proper-noun", "person-name", "given-name"]'::jsonb
WHERE lemma IN (
    SELECT lemma FROM lexemes
    WHERE senses::text LIKE '%given name%'
);

-- 2. 为计算机术语添加领域标签（基于已有的 categories）
UPDATE words
SET categories =
    CASE
        WHEN categories @> '["zk"]'::jsonb THEN categories || '["domain:computing"]'::jsonb
        ELSE categories
    END
WHERE categories @> '["zk"]'::jsonb;

-- 3. 验证结果
SELECT
    jsonb_array_length(categories) as tag_count,
    COUNT(*) as word_count
FROM words
WHERE categories IS NOT NULL
GROUP BY tag_count
ORDER BY tag_count;
```

## 总结

分类标签系统提供了：
1. **多维度组织** - 支持按类型、实体、领域、等级等多个维度分类
2. **灵活扩展** - JSONB 数组结构易于添加新标签
3. **高效查询** - GIN 索引支持快速筛选
4. **自动推断** - 从 Wikidata gloss 和 ECDICT 域标记自动提取分类
5. **可组合性** - 一个词可以有多个标签，支持交叉筛选

这为构建强大的词汇学习和管理功能奠定了坚实基础。
