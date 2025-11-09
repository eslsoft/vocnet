# Lexeme 重构（阶段 1：Proto + 内部数据结构）

> 范围：重新设计词典/学习层的 Proto、数据库 schema、核心逻辑，不包含具体的数据导入。

---

## 1. 目标

- **统一词条建模**：单词、短语、表达都抽象为 Lexeme，底层 schema 不再重复“words/phrases”。
- **对外语义稳定**：API 暴露单一 `Lexeme`（沿用 `dict.v1.Word` 名称亦可，但结构与本方案一致），客户端无需理解 Wikidata 细节。
- **用户数据简化**: `learned_lexemes` 仅引用 `lexeme_id`，彻底移除 `word_id`/`wikidata_lid`。
- **Connect-only 接口**：保留现有 RPC 名称，不再在 proto 中声明 `google.api.http` 路径。

---

## 2. 数据模型（Ent / DB）

| 表/实体         | 说明 |
|-----------------|------|
| `lexemes`       | 主体表，字段：`lexeme_id`（Wikidata LID 或本地 ID）、`language`、`lexical_category`、`entry_type`（WORD / PHRASE / EXPRESSION）、`metadata`、`created_at/updated_at`。`source` 可存放 `wikidata/ecdict/manual`。 |
| `lexeme_forms`  | 形态表：`form_id`（LID-Fx 或 UUID）、`lexeme_id` FK、`text`、`form_type`（LEMMA/PLURAL/...）、`is_irregular`、`pronunciation`、`features`（jsonb，可选）、`created_at/updated_at`。 |
| `lexeme_senses` | 释义表：`sense_id`、`lexeme_id`、`language`、`part_of_speech`、`gloss`、`examples`、`created_at/updated_at`。 |
| `lexeme_relations` | 描述同义/反义/派生/相关短语：`lexeme_id_a`、`lexeme_id_b`、`relation_type`、`metadata`。 |
| `learned_lexemes` | 用户词条，仅保留 `lexeme_id` 外键；新增可选 `form_status`（JSON）用于记录特定 form 的掌握度。其它掌握度、复习字段沿用既有设计。 |

特性：
- 无需与旧 `words` 表兼容，可直接替换；旧数据若要保留，另行编写一次性迁移脚本。
- 文章/高亮场景可通过 form 表快速查出 `lexeme_id + form_id`。

---

## 3. Proto 结构

### 3.1 dict.v1 Lexeme

```proto
message Lexeme {
  string id = 1;
  common.v1.Language language = 2;
  LexemeLexemeEntryType entry_type = 3; // WORD / PHRASE / EXPRESSION ...
  string lemma = 4;
  repeated LexemeForm forms = 5;
  repeated LexemeSense senses = 6;
  repeated LexemeRelation relations = 7;
  repeated Phonetic phonetics = 8;
  repeated string categories = 9;
  google.protobuf.Timestamp created_at = 100;
  google.protobuf.Timestamp updated_at = 101;
}

message LexemeForm {
  string id = 1;
  string text = 2;
  FormType form_type = 3;      // 归一化枚举（LEMMA, PLURAL, PAST, 3SG, ...）
  bool is_irregular = 4;       // true = 非规则形态（例如 went）
  bool is_matched = 5;         // Lookup 返回时标记命中项
  // repeated string grammatical_features = 6; // 若暂不需要可省略
}

message LexemeSense {
  string id = 1;
  common.v1.Language language = 2;
  string part_of_speech = 3;   // “n.”、“v.”、“web.” 等
  string gloss = 4;
  repeated Example examples = 5;
}

message LexemeRelation {
  string target_lexeme_id = 1;
  common.v1.RelationType relation_type = 2;
}
```

- `Lexeme` 对外替代现有 `Word`/`Phrase`，所有条目用 `entry_type` 区分。
- `is_irregular` 供 UI 判断是否需要单独提示/收藏该形态。

### 3.2 learning.v1 LearnedLexeme

```proto
message LearnedLexeme {
  int64 id = 1;
  string lexeme_id = 2;               // required
  LearnedLexemeSpec spec = 3;
  LearnedLexemeStatus status = 4;
}

message LearnedLexemeStatus {
  string lexeme_id = 1;
  MasteryBreakdown mastery = 2;
  ReviewTiming review_timing = 3;
  // map<string, FormMastery> form_status = 4; // 预留给形态级掌握度
  int64 query_count = 5;
  string created_by = 20;
  google.protobuf.Timestamp created_at = 21;
  google.protobuf.Timestamp updated_at = 22;
}
```

- RPC 保持现有命名（Collect/Update/List/Delete），仅在 message 结构上升级。
- 学习层永远以 `lexeme_id` 为唯一键；如需基于词面查询，可在请求里新增 filter，由服务端内部解析 term→lexeme。

---

## 4. 实施步骤

1. **Schema & Ent**
   - 新增 `lexemes` 相关 schema（entgo），生成 client。
   - `learned_lexemes` 更新字段，去掉 `word_id/wikidata_lid`，替换为 `lexeme_id`（string 或 bigint）。
   - 可引入 `form_status` JSON 字段，初期可为空。

2. **Repository / Usecase**
   - 重写词典 Repository：查询/列表/lookup 基于 `lexemes + forms + senses`。
   - `learned_lexeme` Repository 按 `lexeme_id` 读写，补充 form-status 读写接口。

3. **Connect RPC 层**
   - 更新 `dict.v1` 与 `learning.v1` proto，移除所有 `google.api.http` 注解。
   - Connect handler 仅依赖 gRPC/Connect，HTTP gateway 行为交给 Connect runtime。

4. **批量/高亮场景**
   - `ListLearnedLexemes` 支持通过 filter 传入 `lexeme_id` 列表或词面；服务端内部完成 lookup + 掌握度聚合，客户端只需调用一次。
   - 文章高亮：客户端先请求词典 lookup（可批量）获取 form 元数据，再调用 `ListLearnedLexemes` 更新颜色；若有 form-specific 状态则据此高亮。

5. **测试与回归**
   - 单元测试覆盖词典 repository、learned usecase，确保 `lexeme_id` 贯穿。
   - API 兼容性：旧客户端必须升级 proto，否则将无法工作，无需保旧字段。

---

## 5. 示例

### senses（多词性释义）

```json
"senses": [
  { "id": "L99999-S1", "language": "zh", "partOfSpeech": "n.",  "gloss": "吊桶；大量；（有提梁的）桶" },
  { "id": "L99999-S2", "language": "zh", "partOfSpeech": "v.",  "gloss": "用桶装；〈美〉用桶打（水）；〈英口〉催马猛奔" },
  { "id": "L99999-S3", "language": "zh", "partOfSpeech": "web", "gloss": "水桶；铲斗；桶子" }
]
```

### forms（命中形态 + 非规则标记）

```json
"forms": [
  { "id": "L45678-F1", "text": "run",   "formType": "FORM_LEMMA",             "isIrregular": false, "isMatched": false },
  { "id": "L45678-F2", "text": "runs",  "formType": "FORM_3SG",               "isIrregular": false, "isMatched": false },
  { "id": "L45678-F3", "text": "running","formType": "FORM_PRESENT_PARTICIPLE","isIrregular": false, "isMatched": false },
  { "id": "L45678-F4", "text": "ran",   "formType": "FORM_PAST",              "isIrregular": true,  "isMatched": true  }
]
```

---

## 6. Prompt / 注意事项

- **单一消息**：对外只暴露一个 `Lexeme`（或升级版 `Word`）结构，使用 `entry_type` 判断单词/短语；禁止创建独立 `Phrase` message。
- **字段约束**：
  - `LexemeForm` 必须包含 `form_type`、`is_irregular`、`is_matched`；
  - `LexemeSense` 必须包含 `part_of_speech` 与 `gloss`，以还原多词性展示；
  - `LearnedLexeme` 只能使用 `lexeme_id` 关联词典。
- **Connect-only**：proto 中不再出现 `google.api.http`；现有 RPC 名称/签名保持一致。
- **批量查询**：`ListLearnedLexemes` 负责一次性返回多条掌握度（支持传 `lexeme_id` 列表或词面 filter）；禁止要求客户端分步调用。
- **Form 掌握度**：默认记录在 `LearnedLexeme.mastery`（整体），当客户端传 `form_id` 时可更新 `form_status[form_id]`；文章高亮可读该 map 决定颜色。
- **实现顺序**：先完成 schema/ent/proto，再改 repository/usecase，再更新 Connect handler，最后补测试。

---

阶段 1 完成后，服务即可使用新的 Lexeme 数据结构对外提供查询/学习能力。数据初始化、Wikidata/ECDICT 导入等实现，见《docs/lexeme-import-plan.md》。***
