# Vocnet 词典架构重构计划

## 📋 重构目标

将当前架构改为三层架构：**Lexeme（语义层）→ Lemma（词典形层）→ Form（屈折层）**

### 当前架构问题
- Lemma作为顶层，以`{language}:{lemma}`为聚合key，不符合语言学直觉
- 无法支持一个语义概念的多种书写形式（简繁体、拼写变体）
- 查询路径不自然

### 目标架构
```
Lexeme（顶层 - 语义/词项）
  ↓ 1:N
Lemma（中层 - 词典形/正字）
  ↓ 1:N
Form（底层 - 屈折形式）
```

**优势**：
- 语言学直觉清晰：语义 → 正字 → 屈折
- 原生支持多语言翻译（Lexeme间通过relations关联）
- 支持多书写体系（一个Lexeme可有多个Lemma：简繁体、color/colour）
- 查询路径自然：Form → Lemma → Lexeme

---

## ✅ 已完成

### Phase 1: Schema设计 ✅

- [x] Lexeme表设计（顶层）
- [x] Lemma表设计（中层）
- [x] Form表设计（底层，基于原LexemeForm）

---

## 🚧 进行中

### Phase 2: Schema代码实现

**任务列表**：
- [ ] 修改 `internal/infrastructure/database/entschema/lexeme.go`
  - [ ] 删除 `word_id` 字段
  - [ ] 添加 `language_code` 字段
  - [ ] 添加 `sense_gloss` 字段（TEXT，简单释义）
  - [ ] 移入 `categories` 字段（从旧Lemma）
  - [ ] 移入 `completeness` 字段（从旧Lemma）
  - [ ] 修改Edge：指向Lemma而非Form
  - [ ] 更新索引

- [ ] 创建 `internal/infrastructure/database/entschema/lemma.go`（新文件）
  - [ ] 定义字段：id, lexeme_id, text, text_lower, variant, is_primary
  - [ ] 定义Edge：指向Lexeme（多对一）、指向Form（一对多）
  - [ ] 定义索引：lexeme_id, text_lower, (lexeme_id, text) UNIQUE

- [ ] 重命名 `internal/infrastructure/database/entschema/lexeme_form.go`
  - [ ] 修改字段：lemma_id（原为lexeme_id）
  - [ ] 修改Edge：指向Lemma而非Lexeme
  - [ ] 更新索引：lemma_id

- [ ] 运行 `make ent-generate`
- [ ] 验证生成的代码无错误
