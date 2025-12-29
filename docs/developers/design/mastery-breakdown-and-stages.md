# Mastery Breakdown & Stages Design

## Goals

- 用统一的数据结构表达单词在不同技能维度上的掌握度（听、读、拼写、发音）。
- 提供一个可排序、可统计的整体掌握分数（overall），但不丢失维度信息。
- 为客户端提供简单易懂的 3 档粗略级别：未知 / 学习中 / 已知。
- 能区分被动掌握（能看懂/听懂）和主动掌握（能说/能写），为后续学习计划和提示打基础。

## Data Model Overview

### MasteryBreakdown 结构

每个单词维护一个 `MasteryBreakdown`，包含四个技能维度和一个整体得分：

- `listening`：听力理解掌握度，0–5。
- `reading`：阅读理解掌握度，0–5。
- `spelling`：拼写掌握度，0–5。
- `speaking`：发音/口头输出掌握度，0–5。
- `overall`：整体掌握度，0–500，表示 0–5 分乘以 100（方便避免浮点数）。

约定：

- 四个维度都是**整数** 0–5，对用户和调参都更直观。
- `overall` 不直接存“平均值”，而是来自一个明确的计算公式（见后文），以便一致使用和调整。

## Receptive / Productive 两个中间指标

为了更好地区分「被动掌握」和「主动掌握」，引入两个中间指标：

- 被动掌握（Receptive Mastery）：
  - 主要关注“能看懂/听懂”。
  - 定义：

    ```pseudo
    rec = (reading + listening) / 2.0  # 范围 0–5
    ```

- 主动掌握（Productive Mastery）：
  - 主要关注“能写/能说”，其中口语比写作更重要。
  - 定义（口语权重大于写作）：

    ```pseudo
    # 示例权重：speaking 70%，spelling 30%
    prod = 0.3 * spelling + 0.7 * speaking  # 范围约 0–5
    ```

这两个值本身不会直接暴露在 proto 中，但会用于：

- 计算整体分数 `overall`。
- 判定粗略级别（未知 / 学习中 / 已知）。
- 后续可能用于区分「被动已知」和「主动已知」。

## Overall 计算方案

### 设计原则

- overall 作为一个标量，主要用于排序、统计和快速展示，不试图完整表达 vector 形态。
- 被动理解（阅读、听力）略微更重要一些，但不能完全忽略主动输出（拼写、口语）。
- 计算规则应当**全局统一**，不随着词频或词类变化，以避免用户心智混乱。

### 推荐公式

用一个固定权重，将 `rec` 和 `prod` 合并为 0–5 分，再乘以 100 存储到 `overall`：

```pseudo
rec  = (reading + listening) / 2.0
prod = (spelling + speaking) / 2.0

# 被动略高于主动的默认权重
w_active = 0.4        # 主动权重
w_passive = 1 - w_active  # = 0.6

overall_raw = w_passive * rec + w_active * prod   # 0–5

# 存储为 0–500 的整数
overall = round(overall_raw * 100)
```

注意：

- 这里的权重是全局常量；未来如果需要可以通过配置调整，但不建议按单词动态修改。
- `overall` 始终代表“综合掌握度”的**统一刻度**，不因词频/词类改变含义。

## 粗略级别（Unknown / Learning / Known）

客户端需要展示简单的 3 档级别：

- 未知（Unknown）
- 学习中（Learning）
- 已知（Known）

我们不建议仅仅依赖 `overall` 来划分，而是结合四个维度和 `rec`/`prod`，用一套简单的规则判定。

### 直觉目标

- 未知：几乎没有接触或成功回忆的证据。
- 学习中：已经有一定接触/掌握，但未达到“稳定理解”的水平。
- 已知：至少在被动理解上已经比较稳定，主动能力可以根据维度再细分（例如“发音弱”“拼写弱”）。

### 规则定义（伪代码）

设四项均为 0–5，先计算：

```pseudo
rec  = (reading + listening) / 2.0
prod = (spelling + speaking) / 2.0
max_dim = max(reading, listening, spelling, speaking)
```

推荐的判定逻辑：

```pseudo
if max_dim <= 0:
    stage = UNKNOWN

elif rec >= 4 and max_dim >= 3:
    # 至少在被动理解（看/听）上很强，且其他维度不至于全部太差
    stage = KNOWN

else:
    stage = LEARNING
```

解释：

- `max_dim <= 0`：四个维度都在 0 → 视为“未知词”。
- `rec >= 4`：阅读/听力平均分达到 4 以上 → 基本能稳定理解。
- `max_dim >= 3`：至少某一维度不低于 3，避免极端情况如所有维度都是 2–3 的“浅层接触”。
- 其他情况一律归为“学习中”。

这样可以自然区分：

- “认识但是不会拼写”：reading / listening 高，但 spelling/speaking 较低 → 仍被视为已知词（Known），但可在 UI 上提示“拼写弱/发音弱”。
- “知道大概意思但不太稳定”：reading / listening 只有 2–3 → 归类为学习中（Learning）。

### 对 overall 的使用

- 阶段划分主要基于维度和 `rec`/`prod`，`overall` 不直接参与阈值判断。
- `overall` 主要用于：
  - 排序（例如词表按掌握度从低到高）；
  - 统计（例如整体词汇掌握分布）；
  - 为客户端提供一个数值型进度条（0–100% ≈ overall/500）。

## 被动/主动标签（可选）

在 3 档粗略级别之外，我们希望进一步区分“被动已知”和“主动已知”。

### MasteryLevel（Unknown / Learning / Known / Mastered）

在服务端使用一个枚举 `MasteryLevel` 同时表达阶段和被动/主动形态：

```pseudo
if max_dim <= 0:
  level = MASTERY_LEVEL_UNKNOWN

elif rec >= 4 and prod >= 3:
  level = MASTERY_LEVEL_MASTERED   # 完全掌握：理解到位且能较好输出

elif rec >= 4:
  level = MASTERY_LEVEL_KNOWN      # 已知（被动）：理解不错，但输出较弱

else:
  level = MASTERY_LEVEL_LEARNING   # 已有一定掌握，但未达到“已知”标准
```

客户端可基于此：

- 仅看大类：
  - UNKNOWN → 未知
  - LEARNING → 学习中
  - KNOWN / MASTERED → 已知
- 再看细类：
  - KNOWN vs MASTERED 渲染不同图标或标签（例如“被动掌握”“完全掌握”）。

### 维度弱点标签

进一步，针对每个技能维度，可以用简单阈值打出弱点标签：

```pseudo
if spelling < 3:
    tag += ["拼写弱"]
if speaking < 3:
    tag += ["发音弱"]
if listening < 3:
    tag += ["听力弱"]
```

这些标签仅做提示，不影响 `stage` 的 Unknown/Learning/Known 判定。

## 词频与词类的影响（未来扩展）

### 设计理念

从学习设计角度看，确实存在：

- 高频/核心词：更希望用户达到“主动掌握”（能说/能写）。
- 低频/专业词：被动认识即可，不一定要强求拼写和口语。

但如果直接让“已知”的阈值随词频、词类变化，会带来几个问题：

- 不同词的“已知”标准不同，用户心智难以建立统一预期。
- 调整词频或分类逻辑会导致大量单词的阶段标签变化，影响体验和调试。

### 折中方案

建议：

1. **保持 Unknown/Learning/Known 判定规则全局统一**（如前文伪代码）。
2. 将词频/词类用于“目标掌握度”和“复习计划”，而不是改变已知阈值：

   - 对高频核心词，可以在复习计划中设定更高的目标：

     ```pseudo
     # 示例：高频词的目标
     target_rec  = 4.5
     target_prod = 3.5
     ```

   - 对低频/专业词，目标可以偏向被动：

     ```pseudo
     # 示例：低频/专业词的目标
     target_rec  = 4.0
     target_prod = 2.0
     ```

   - 这些目标用于：
     - 决定是否“退休”某些卡片（不再频繁复习）。
     - 决定是否继续推送拼写/发音卡片以提高主动能力。

3. 对用户展示时，可以通过额外提示说明：

   - “这是高频词，建议掌握到主动使用。”
   - “这是低频专业词，被动掌握即可。”

这样既保留了教学设计上的精细度，又保证了粗略级别的统一性和简洁性。

## 总结

- `MasteryBreakdown` 四个维度保持 0–5 的简单离散刻度。
- 引入 `rec` 和 `prod` 两个中间指标，统一用固定权重计算 `overall`，保持 0–500 的刻度。
- Unknown/Learning/Known 的阶段判定基于维度 + rec/prod 的全局统一规则，不因词频/词类变化。
- 通过 `MasteryLevel` 以及维度弱点标签表达“被动/主动”的差异和具体短板。
- 词频/词类更多用于设定目标掌握度和调整复习计划，而不是直接改变“已知”阈值。

后续如果需要调整阈值或权重，可以在保持上述结构不变的前提下微调常量，同时通过实验数据和用户反馈进行迭代。
