# FlashCard 智能学习系统设计（MVP版）

## 文档目标

重新梳理FlashCard系统设计，聚焦MVP目标：**跑通完整的学习流程**。算法优化、策略配置等留待后续迭代。

## 一、系统概述

### 1.1 核心定位

基于间隔重复（Spaced Repetition）的智能卡片学习系统，通过多维度能力评估帮助用户高效掌握词汇。

### 1.2 MVP核心特性

- ✅ **动态卡片生成**：根据用户学习状态实时生成卡片
- ✅ **多题型支持**：先实现3种核心题型（CHOICE, SPELLING, SELECT_WORDS）
- ✅ **多维度追踪**：分别追踪听、读、拼、说四项能力
- ✅ **间隔重复调度**：根据答题表现自动调整复习时间
- ✅ **客户端判题**：答案随卡片下发，客户端即时反馈，服务端批量评分

### 1.3 MVP不包含的功能

- ❌ 可配置的学习策略（ReviewPlanConfig）
- ❌ 智能干扰项生成（MVP使用完全随机选择）
- ❌ 复杂的算法优化（如FSRS）
- ❌ 语音评分（SPEAKING题型）
- ❌ 复杂题型（ARRANGE、MATCHING，先实现3种核心题型）

---

## 二、核心概念

### 2.1 多维度掌握度（MasteryBreakdown）

proto定义：`learning/v1/learning.proto`

```protobuf
message MasteryBreakdown {
  int32 listening = 1; // Listening mastery (0-5)
  int32 reading = 2; // Reading mastery (0-5)
  int32 spelling = 3; // Spelling mastery (0-5)
  int32 speaking = 4; // Pronunciation mastery (0-5)
  int32 overall = 5; // Overall mastery score (0-500, stored as *100)
}
```

**Overall 计算公式**（MVP固定权重）：
```
overall = (listen + read + spell + pronounce) / 4 * 100
```

### 2.2 题型与能力映射

proto定义：`learning/v1/flashcard.proto`（已完整定义6种CardType）

| 题型 | 主训练能力 | 次要能力 | MVP实现状态 |
|------|-----------|---------|------------|
| CHOICE | Read | - | ✅ MVP实现 |
| SPELLING | Listen, Spell | - | ✅ MVP实现 |
| SELECT_WORDS | Read, Spell | - | ✅ MVP实现 |
| ARRANGE | Read | - | ⏳ 后续实现 |
| MATCHING | Read | - | ⏳ 后续实现 |
| SPEAKING | Pronounce, Listen | - | ❌ 暂不实现 |

### 2.3 间隔重复核心参数（MVP固定值）

```
InitialInterval  = 1 天    // 首次复习间隔
PassingScore     = 0.6     // 及格线（60%）
EasyBonus        = 1.5     // 简单题奖励因子
HardPenalty      = 0.5     // 困难题惩罚因子
MaxInterval      = 180 天  // 最大间隔
```

---

## 三、MVP核心流程

### 3.1 完整学习流程（时序图）

```
用户                    客户端                      服务端
 |                       |                           |
 |--[1. 开始学习]-------->|                           |
 |                       |--GetFlashCards(planId)--->|
 |                       |                           | 查询待复习单词
 |                       |                           | 生成卡片+答案
 |                       |<--FlashCardSet------------|
 |                       |                           |
 |<--[2. 展示题目]--------|                           |
 |--[3. 答题]----------->|                           |
 |<--[4. 即时反馈]--------|                           |
 |                       | (本地存储答题记录)          |
 |                       |                           |
 |--[5. 完成/退出]------->|                           |
 |                       |--SubmitAnswer(批量结果)-->|
 |                       |                           | 1. 接收 AnswerResult (lword_id, type, correct)
 |                       |                           | 2. 根据 CardType 查找评分策略
 |                       |                           | 3. 更新对应维度的 Mastery
 |                       |                           | 4. 计算下次复习时间
 |                       |<--ACK---------------------|
 |<--[6. 查看报告]--------|                           |
```

### 3.2 服务端：生成卡片 (GetFlashCards)

**输入**：
- `review_plan_id`: 复习计划ID
- `limit`: 本次需要的卡片数量（如20张）

**核心逻辑**：
1. 加载ReviewPlan关联的所有Wordbook
2. 查询用户的LearnedWords
3. 分类单词：
   - **到期复习词**：`next_review_at <= now` 且 `overall > 0`
   - **新词**：`overall == 0`
4. 优先级排序（到期词）：
   - 优先级1: `fail_count` 降序（失败越多越优先）
   - 优先级2: `overall` 升序（掌握度越低越优先）
   - 优先级3: `next_review_at` 升序（逾期越久越优先）
5. 选择单词：
   - 优先填充到期词
   - 不足时补充新词（随机打乱）
   - 限制总数为 `limit`
6. 为每个单词生成卡片：
   - **选题型**：根据最弱能力选择
     - `listen` 最弱 → SPELLING（听写）
     - `read` 最弱 → CHOICE（选择）
     - `spell` 最弱 → SELECT_WORDS（填空）
     - `pronounce` 最弱 → CHOICE（MVP阶段降级为选择题）
   - **生成内容**：题目、选项、答案
   - **干扰项**：从同Wordbook完全随机选择其他单词（不做任何过滤）
7. 打乱卡片顺序
8. 返回 FlashCardSet

**输出**（proto定义见 `review_service.proto`）：
```protobuf
message FlashCardSet {
  repeated FlashCard flash_cards = 2;
  // 需要新增统计信息（见下方proto改进建议）
}
```

**卡片选择算法（MVP版本）**：
```
1. 到期词按优先级排序后直接取前N个
2. 新词随机选择（避免按字母序学习）
3. 题型选择：找出4项能力中最低的，映射到对应题型
4. 干扰项：从同Wordbook中随机选3个其他单词
```

### 3.3 客户端：答题与本地存储

**职责**：
- ✅ 渲染题目UI
- ✅ 收集用户答案
- ✅ 基于下发的answer即时反馈对错
- ✅ 本地存储答题进度（localStorage/IndexedDB）
- ✅ 批量提交答题记录

**本地数据结构**（参考）：
```javascript
{
  reviewPlanId: 123,
  startedAt: "2025-01-04T10:00:00Z",
  cards: [...],        // 完整卡片数据
  answers: [           // 已答题记录
    {
      cardId: "xxx",
      term: "apple",
      userAnswer: {...},
      timeSpent: 5,
      answeredAt: "...",
      clientIsCorrect: true  // 客户端判断（仅供参考）
    }
  ],
  currentIndex: 1,
  status: "in_progress"
}
```

**中途退出处理**：
- 监听 `beforeunload` 事件自动提交已答题目
- 下次打开时提示"继续上次的练习？"

### 3.4 服务端：接收分数与更新 (SubmitAnswer，单题异步)

**输入**（proto定义见 `learning/v1/review_service.proto`）：
- `SubmitAnswerRequest`: 包含 `review_plan_id`、`AnswerRecord`
- `AnswerRecord`: 单条答题记录，包含 `lword_id`、`AnswerScore`（客户端计算的分数，0-10 刻度）、`time_spent_seconds`、`answered_at`
- `AnswerScore`: listening/speaking/reading/writing 四项能力分数，范围 0-10

**核心逻辑**：
1. 依赖客户端判题，直接接收分数（0-10）；建议配合 `client_answer_id` 做幂等以避免重试重复累计。
2. 分数归一化与能力映射（示例，可在实现时调整权重）：
   - `normalized = score / 10.0`
   - 针对不同能力，计算 `mastery_delta = normalized * weight`，并限制最终 mastery 在 [0,5]
   - `overall = avg(listen, read, spell, pronounce) * 100`
3. 更新 LearnedWord：
   - 更新 mastery / overall
   - 依据 normalized 分数更新 review_timing（见 3.5）
4. 更新 DailyStats（本日学习统计，单题累加）
5. 当前 RPC 返回 `google.protobuf.Empty`；如需前端同步掌握度，可在后续扩展反馈结构

### 3.5 间隔重复算法（MVP简化版）

**输入**：
- 当前 `interval_days`（首次为0）
- 本次 `score_normalized`（0-1，客户端 0-10 分数 / 10 得到）

**算法**：
```
1. 确定当前间隔：
   currentInterval = interval_days > 0 ? interval_days : InitialInterval(1天)

2. 根据得分选择因子：
   - score_normalized >= 0.9  → easeFactor = 2.0  (非常熟练，大幅延长)
   - score_normalized >= 0.6  → easeFactor = 1.5  (及格，正常延长)
   - score_normalized < 0.6   → easeFactor = 0.5  (不及格，缩短)

3. 计算新间隔：
   newInterval = ceil(currentInterval * easeFactor)
   newInterval = clamp(newInterval, 1, 180)

4. 更新失败计数：
   - score_normalized >= 0.6 → fail_count = 0
   - score_normalized < 0.6  → fail_count++

5. 失败惩罚：
   if fail_count >= 3:
     newInterval = InitialInterval
     所有能力值 -= 1.0（最低为0）

6. 计算下次复习时间：
   next_review_at = now + newInterval * 24小时
```

**关键点**：
- MVP使用简化的SM-2算法
- 固定的得分-因子映射关系
- 连续失败3次触发降级

---

## 四、API定义

### 4.1 Proto定义

所有API定义已实现在 `api/proto/learning/v1/review_service.proto`，包括：

**核心RPC**：
- `GetFlashCards`: 获取复习卡片
- `SubmitAnswer`: 单题提交答题记录（客户端判题，0-10 刻度上报）

**关键Message**：
- `FlashCardSet`: 卡片集合，包含flash_cards和stats统计信息
- `FlashCardStats`: 卡片统计（新词数、复习词数、总待复习数、预估时长）
- `SubmitAnswerRequest`: 提交答题请求（单条）
- `AnswerRecord`: 单条答题记录，含 `AnswerScore`（0-10）与 `time_spent_seconds`

详细定义请参考proto文件。

---

## 五、数据库设计

### 5.1 核心表（已有）

**learned_words**（对应 `LearnedWord` entity）：
- `id`, `user_id`, `term`, `language`
- `mastery_listen`, `mastery_read`, `mastery_spell`, `mastery_pronounce`, `mastery_overall`
- `last_review_at`, `next_review_at`, `interval_days`, `fail_count`
- `queried_count`, `created_at`, `updated_at`

**review_plans**（对应 `ReviewPlan` entity）：
- `id`, `user_id`, `name`, `description`
- `pending_words`, `mastered_words`, `learning_words`, `unknown_words`
- `created_at`, `updated_at`

**review_plan_wordbooks**（关联表）：
- `review_plan_id`, `wordbook_id`

### 5.2 需要新增的表

**daily_stats**（每日学习统计）：
```sql
CREATE TABLE daily_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  cards_reviewed INT DEFAULT 0,
  new_words INT DEFAULT 0,
  time_spent_seconds INT DEFAULT 0,
  average_score FLOAT DEFAULT 0,
  words_mastered INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, date)
);
```

**用途**：
- 学习日历
- 连续学习天数统计
- 学习曲线图表

---

## 六、关键设计决策（ADR）

### 6.1 客户端判题 + 单题异步提交
- **决策**：答案随卡片下发，客户端即时反馈并计算 0-10 分，逐题异步上报；服务端不再判题，只做掌握度/调度更新
- **理由**：减轻服务端压力，降低网络重试的影响（可配合幂等键），保持离线/弱网体验
- **权衡**：完全信任客户端分数；需在服务端定义分数到掌握度/间隔的映射以确保行为一致

### 6.2 无Session机制
- **决策**：GetFlashCards不返回sessionID，SubmitAnswer不验证session
- **理由**：进度在客户端管理，服务端无状态更简单
- **多设备重复问题**：通过立即更新`next_review_at`自然解决（设备B不会获取设备A已做的词）

### 6.3 新词定义
- **决策**：`mastery.overall == 0` 即为新词
- **说明**：系统评判的掌握度，非用户主观声明
- **初始状态**：新收藏的词 `overall=0`, `next_review_at=now`

### 6.4 干扰项生成（MVP）
- **决策**：从同Wordbook完全随机选择，不做任何过滤
- **理由**：最简单实现，快速验证产品流程
- **权衡**：可能出现明显错误的选项（如同义词同时出现），但不影响流程验证
- **后续优化**：基于词频、词性、排除同义词、用户错误历史等

### 6.5 例句来源（MVP）
- **决策**：优先使用 `LearnedWord.contexts`（用户收藏时的上下文）
- **降级方案**：如果contexts为空，从 `Lexeme` 表获取
- **后续扩展**：AI生成个性化例句

### 6.6 SPEAKING题型暂不实现
- **决策**：MVP阶段跳过语音评分
- **理由**：需要对接语音识别API，复杂度高
- **后续实现**：可对接Google/Azure语音服务

---

## 七、MVP实现检查清单

### 7.1 Proto定义
- [x] 在 `review_service.proto` 新增 `SubmitAnswerRequest`
- [x] 在 `review_service.proto` 新增 `AnswerRecord`, `AnswerScore`
- [x] 在 `review_service.proto` 新增 `FlashCardStats`
- [x] 在 `ReviewPlanService` 新增 `SubmitAnswer` RPC

### 7.2 Entity层
- [ ] 新增 `DailyStats` entity（ent schema）
- [ ] `LearnedWord` 确保包含 mastery和review相关字段

### 7.3 Repository层
- [ ] `LearnedWordRepository.GetByReviewPlan(planID, dueOnly)` - 查询待复习词
- [ ] `LearnedWordRepository.UpdateMasteryAndReview(id, mastery, review)` - 更新掌握度和复习时间
- [ ] `DailyStatsRepository.GetOrCreate(userID, date)` - 获取或创建本日统计
- [ ] `DailyStatsRepository.Update(stats)` - 更新统计

### 7.4 Usecase层
- [ ] `ReviewPlanUsecase.GetFlashCards()`
  - [ ] 实现单词选择逻辑
  - [ ] 实现题型选择逻辑（根据最弱能力，只支持CHOICE/SPELLING/SELECT_WORDS）
  - [ ] 实现卡片生成逻辑：
    - [ ] CHOICE题型生成器
    - [ ] SPELLING题型生成器
    - [ ] SELECT_WORDS题型生成器
  - [ ] 实现干扰项生成（完全随机选择）
- [ ] `ReviewPlanUsecase.SubmitAnswer()`
  - [ ] 将 0-10 分数映射到 mastery/overall
  - [ ] 实现间隔重复算法
  - [ ] 实现DailyStats更新

### 7.5 Adapter层
- [ ] gRPC handler: `GetFlashCards`
- [ ] gRPC handler: `SubmitAnswer`

### 7.6 测试验证
- [ ] 单词选择优先级测试（到期词优先）
- [ ] 题型选择测试（最弱能力映射）
- [ ] 分数映射测试（0-10 → mastery/overall）
- [ ] 间隔重复算法测试（得分-间隔映射）
- [ ] 掌握度更新测试（增减逻辑）
- [ ] 多设备场景测试（不重复获取）

---

## 八、后续迭代方向（非MVP）

### 8.1 算法优化
- 使用FSRS替代简化SM-2
- 智能干扰项生成（基于词性、词频、错误历史）
- 难度自适应调整

### 8.2 题型扩展
- 实现ARRANGE题型（排序组句）
- 实现MATCHING题型（配对匹配）
- 实现SPEAKING题型（语音评分）

### 8.3 策略配置
- ReviewPlanConfig（卡片分布、难度策略、每日学习量）
- 用户可自定义学习偏好

### 8.4 功能扩展
- 多语言差异化策略
- 成就系统
- 学习统计可视化
