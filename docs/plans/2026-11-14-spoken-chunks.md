# 口语语块（方案，2026-11-14）

## 1. 背景

语块（chunks，也叫词块）出自 Michael Lewis 的词汇法：母语者说话大量调用整块记住的现成组合，学习者也应成块地学。我们已有的资源覆盖了语块的一部分：

| 语块类型 | 例子 | 现状 |
|---|---|---|
| 多词词汇、习语 | by the way、give up、a piece of cake | 已有：短语词条 |
| 搭配 | heavy rain、make a decision | 已有：挂在义项下的搭配 |
| 谚语 | Look before you leap. | 已有：句子（谚语） |
| 社交套话 | Nice to meet you、Sorry to bother you | 缺 |
| 句子框架（带空位） | Would you mind ___ing?、It's worth ___ing | 缺 |
| 回应与反应 | Sounds good、Fair enough、Tell me about it | 缺 |
| 话语标记与缓冲 | to be honest、I mean、kind of、the thing is | 零散 |

本方案只做**口语**语块：口头交流中整块使用、可以直接说出口的话语单位。

## 2. 目标

- 新增与词条、句子并列的资源 **Chunk（语块）**。
- 以**交际功能**为主线组织（请求、道歉、同意、拒绝、表达观点……），同时链接到相关词条，词条页面也能看到。
- 每条语块带：功能、语气、中文翻译、使用说明、示范对话、等级。
- 和短语、搭配、谚语不重复。

## 3. 收录边界

| 归属 | 判断 | 例子 |
|---|---|---|
| 语块 | 口语中整块说出的话语单位：整句、半句或带空位的句子框架，承担一个交际功能 | Fair enough；Would you mind ___ing?；To be honest, ___ |
| 短语 | 词汇单位，意思不透明或形式固定，作为句子成分使用 | by the way、in front of、give up |
| 搭配 | 意思透明、用词约定俗成的组合，挂在义项下 | heavy rain |
| 谚语 | 成型的格言、俗语 | Look before you leap. |

- 一个表达只归一处。已经是短语词条、搭配或谚语的，不再收成语块。
- 语块文本里的空位统一写成 `___`，形式提示放在空位后（`___ing`）。

## 4. 数据模型

### 4.1 Chunk 节点

| 字段 | 说明 |
|---|---|
| `id` | 节点 ID |
| `text` | 语块文本，如 `Would you mind ___ing?` |
| `text_key` | 规范化文本，唯一 |
| `created_by`、`created_at` | 创建者与时间 |

节点只承载身份，所有判断都是事实。

### 4.2 功能分类（参考数据）

- 新参考表 `functions`：交际功能的分类树，如“社交 > 问候”“请求 > 礼貌请求”“观点 > 表达同意”。
- 分类骨架取自 British Council 与 EAQUALS 的 *Core Inventory for General English*（按 CEFR 等级列出交际功能与典型说法）；只取功能名称与层级，作为参考数据导入，与 `topics` 同理。

### 4.3 语块列表：功能下的收录

与短语列表同一思路：

- 新事实类型 `chunks`，挂在**功能**上，每个功能一条，内容是语块列表 `{ chunks: [{ text }] }`。
- 提交时按文本找到或新建 Chunk 节点；列表发布后，其中的语块进入生产。
- 一条语块可以出现在多个功能的列表里，如 “Sorry to bother you” 既是“道歉”，也是“引起注意”。

### 4.4 挂在语块上的事实

| 类型 | 数量 | 内容 | 审核 |
|---|---|---|---|
| `chunk_register` | 一 | `{ register }`：`casual`、`neutral`、`polite` | Jev，不定再交模型 |
| `chunk_level` | 一 | `{ level }`：A1–C2 | Jev，不定再交模型 |
| `translation` | 每种语言一 | 沿用现有翻译，`of: chunk` | 模型 |
| `chunk_note` | 一 | `{ note }`：什么场合、对谁说、注意什么 | 模型 |
| `chunk_dialogue` | 多（≤ 2） | `{ lines: [{ speaker, text }] }`：两三轮示范对话，其中一句用到这个语块 | 模型 |
| `chunk_link` | 多（≤ 3） | `{ entry_id }`：语块里的关键词，用于在词条页展示 | Jev |

### 4.5 审核要点

- **常用**：母语者在日常口语中确实常这么说，不是书面语，也不是生造的。
- **功能**：确实承担所列的交际功能。
- **语气**：随意、中性、礼貌标得对。
- **不重复**：不是已有的短语、搭配或谚语。
- **形式**：空位写法规范；整句时标点正确。

## 5. 工作项

| 工作类型 | 主体 | 内容 |
|---|---|---|
| `chunks` | 功能 | 为该功能产出语块列表（按功能所在等级由低到高排队） |
| `chunk_facts` | 语块 | 语气、等级、使用说明、示范对话、关联词 |
| `translations` | 语块 | 沿用现有翻译工作，增加 `of: chunk` 目标 |

规模预估：功能约 150–250 个，语块约 1,500–3,000 条。

## 6. 公开接口

- `GET /v1/functions`：功能分类树。
- `GET /v1/functions/{id}`：某功能下的语块，可按等级筛选。
- `GET /v1/chunks/{id}`：语块全文，含功能、语气、等级、翻译、使用说明、示范对话、关联词。
- 词条接口增加 `chunks`：通过 `chunk_link` 关联到该词条的语块（文本、功能、等级）。

## 7. 实现范围

1. 服务端：Chunk 节点与 `functions` 参考表（含迁移）；`shared/facts.ts` 增加各事实的数据格式；`server/domain/fact-kinds.ts` 登记 `chunks`、`chunk_register`、`chunk_level`、`chunk_note`、`chunk_dialogue`、`chunk_link`，翻译增加 `of: chunk`；工作项规则与排队；公开视图与接口；同步 `docs/design.md`、`spec/*.feature` 与测试，`pnpm verify` 通过。
2. 参考数据：整理 Core Inventory 的功能分类，导入 `functions`。
3. 生产端：新增 `chunks`、`chunk_facts` 工作模板，判断标准与审核一致；翻译模板支持语块。
4. 上线后先跑 A1–A2 的功能，抽样审核，稳定后放量。

## 8. 待确认

1. **功能分类来源**：用 Core Inventory 作骨架是否可以？（实施前先核实其使用许可。）
2. **语气分档**：随意 / 中性 / 礼貌三档是否够用？
3. **示范对话**：存成语块的事实（本方案），还是对话里的每句话也做成 Sentence 节点（可复用、可单独翻译，但更重）？
4. **排期**：本方案排在主动/被动词汇之后、配图之前，是否可以？

## 9. 不在本次范围

- 书面语块（如学术写作框架 “It can be argued that ___”）。
- 语块的音频与配图。
- 语法事实（仍暂停）。
