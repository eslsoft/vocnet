# Lexeme 数据初始化 / 导入方案（阶段 2）

> 范围：在阶段 1 的 schema/proto 就绪后，负责将 Wikidata + ECDICT 数据写入新结构，提供可靠的初始化/更新流程。

---

## 1. 数据来源

| 来源 | 说明 |
|------|------|
| Wikidata Lexeme dump | `https://dumps.wikimedia.org/wikidatawiki/entities/latest-lexemes.json.gz`，包含全量 lexeme/forms/senses/relations；脚本 `scripts/lexeme_import` 的 Wikidata stage 负责导入。 |
| ECDICT | 同一脚本在导入前预加载 SQLite 数据，按 lemma 将音标/中文释义/标签合并进 Wikidata payload（仅 enrich，不再独立建词条）。 |
| Manual / Admin | 后台或运维工具手动补充的词条。 |

---

## 2. 处理流程

### 2.1 Wikidata Importer
1. **下载与缓存**：支持从远程 URL 或本地文件读取，缓存于用户 Cache 目录。
2. **解析**：流式读取 JSON（支持 gzip），按 lexeme → forms → senses → relations 顺序解析。
3. **映射**：
   - 语言（QID → ISO 代码）、词性/语法特征映射到内部枚举。
   - form 的 `grammaticalFeatures` 用于设置 `form_type` 和 `is_irregular`。
   - sense 的 `glosses` 转换为 `LexemeSense`，保留多语言释义。
4. **落库**：写入 `lexemes`、`lexeme_forms`、`lexeme_senses`、`lexeme_relations`。需要 Upsert 逻辑（按 `lexeme_id`）。
5. **日志与指纹**：记录导入批次、schema 版本、行数，便于增量更新或回滚。

### 2.2 ECDICT Enricher
1. **预加载**：启动时解压/缓存 ECDICT SQLite，构建 `lemma -> enrichment` 的内存索引。
2. **合并**：Wikidata lexeme 转换完成后，在创建前直接注入音标、中文释义、示例、标签；若原词条已有英文释义，则只补中文。
3. **缺失记录**：未被 Wikidata 覆盖的 ECDICT lemma 写入报告，便于后续补源或扩展过滤规则。

### 2.3 Manual / Admin
1. 提供 CLI 或后台接口创建/编辑 lexeme。
2. 支持导出/再导入（NDJSON / SQL）以备份人工数据。
3. 后续可把人工数据回写到 Wikidata（若需要）。

---

## 3. 实现纲要

- **导入命令**：新增 `vocnet lexeme-import`（或扩展现有 `make import`），接受参数：`--source=wikidata|ecdict`、`--input`、`--cache-dir`、`--language-filter` 等。
- **管道抽象**：
  - `lexemeimport.Source` 接口：`NextLexeme() (*LexemePayload, error)`；
  - `lexemeimport.Sink`：负责写入数据库或生成 SQL/JSON；
  - 支持链式组合（Wikidata payload 先进入 mapper，再进入 sink）。
- **并发与批处理**：按 `lexeme_id` 批量 upsert（例如每 1k 写一次），减少事务开销。
- **监控**：输出进度条、统计信息（总 lexeme、form、sense 数），记录错误。
- **校验**：可选地对 Wikidata 与本地 schema 做一致性校验（例如 `entry_type` 必须匹配 `lexical_category`）。

---

## 4. 与阶段 1 的衔接

- 阶段 1 实现完成后，数据库已具备 `lexemes*`、`learned_lexemes` 新结构；阶段 2 在此基础上执行批量导入。
- 导入前可清空词典表或使用 Upsert 模式覆盖旧数据。
- LearnedLexeme 相关逻辑无需修改：只要词典初始化完毕，学习功能即可使用。

---

## 5. Prompt / 注意事项

- 导入逻辑严格写入阶段 1 定义的表字段，不得复活旧 `words` 结构。
- Wikidata 解析需流式处理，避免一次性加载整份 dump。
- `is_irregular`、`entry_type`、`form_type` 等字段需在导入时确定，保证客户端可用。
- 允许配置语言白名单（例如仅导入英语/中文），以减少初期数据量。
- 导入命令必须支持断点重跑（利用缓存 + Upsert）。
- 若未来要支持增量更新，可通过记录 `last_modified`/`dump hash` 等指纹实现。

---

阶段 2 完成后，即可用真实数据填充新的 Lexeme 体系；后续实现可以在此基础上继续扩展（例如 form 级掌握度、Web 后台等）。***
