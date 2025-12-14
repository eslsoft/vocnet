# Vocnet - 开源词汇网络管理平台

> 以用户为中心的全生命周期词汇数据中心

---

## 什么是 Vocnet

**Vocnet** 是一个开源的词汇网络管理平台，致力于解决英语学习者的核心痛点：**词汇数据分散，无法统一管理**。

### 核心问题

市面上有很多优秀的英语学习应用（阅读类、视频类、游戏化学习等），但用户的词汇数据分散在各个平台：

- 在扇贝学了 500 个词
- 在百词斩学了 300 个词
- 在 Anki 导入了 200 个词
- 在阅读 APP 收藏了 150 个生词

**结果是**：换应用需要重新测试水平，没有一个地方能看到完整的学习数据，词汇掌握度无法跨应用追踪。

### Vocnet 的解决方案

!!! success "核心价值" - 成为用户全生命周期的词汇数据中心 - 无论在哪个应用学习，数据都统一存储在 Vocnet - 基于 FSRS 算法提供科学的复习系统 - 开放 API，让第三方应用轻松接入 - 开源代码，数据自主权，支持自建

---

## 🎓 我是语言学习者

### Vocnet 能帮你做什么

Vocnet 是一个**词汇学习和复习平台**，让你的词汇学习更科学、更高效：

| 功能       | 说明                                   |
| ---------- | -------------------------------------- |
| 词汇管理   | 管理你在所有应用中学习的词汇，统一视图 |
| 科学复习   | 基于 FSRS 算法生成个性化复习计划       |
| 掌握度跟踪 | 听说读写分项跟踪（0-5 级），精细化管理 |
| 词汇网络   | 同义词、派生词、助记联想，建立知识网络 |
| 跨设备同步 | Web / 移动端随时随地复习               |

### 快速开始

!!! tip "开始使用 Vocnet"

- **[5 分钟上手指南](getting-started/quickstart-users.md)** - 创建账号、添加单词、开始复习
- **[完整用户手册](guides/user-guide.md)** - 深入了解所有功能
- **[自建部署指南](self-hosting/installation.md)** - 部署自己的 Vocnet 实例

### 为什么选择 Vocnet

!!! info "相比传统背单词应用"

- **数据自主权** - 开源代码，支持导出，可自建服务器
- **跨应用生态** - 不再被单一应用锁定，数据跟随你
- **科学算法** - 统一的 FSRS 间隔重复算法，而非各家参差不齐的实现
- **专注本质** - 专注词汇管理，而非大而全但不专精

---

## 💻 我是开发者

### Vocnet 能为你做什么

Vocnet 是一个**词汇数据管理基础设施**，让你专注于打造差异化的学习体验：

| 优势       | 说明                                            |
| ---------- | ----------------------------------------------- |
| 开箱即用   | 词汇存储、掌握度管理、FSRS 算法，无需重复造轮子 |
| 标准 API   | ConnectRPC 协议，自动生成全平台 SDK             |
| 多语言支持 | Go / TypeScript / Swift / Kotlin 官方 SDK       |
| 专注差异化 | 把词汇管理交给 Vocnet，你专注内容和体验         |
| 开放生态   | 不竞争，而是赋能第三方开发者                    |

### 典型集成场景

!!! example "使用场景"

- **阅读应用** - 用户标记生词存到 Vocnet → Vocnet 负责复习调度
- **视频应用** - 字幕生词存到 Vocnet → 掌握度跨应用同步
- **浏览器扩展** - 划词收藏到 Vocnet → 统一复习入口
- **学习工具** - 集成 Vocnet API，获得完整的词汇管理能力

### 快速集成

!!! tip "开始集成 Vocnet API"

- **[15 分钟集成指南](getting-started/quickstart-developers.md)** - OAuth2 授权、API 调用、SDK 使用
- **[API 参考文档](api/overview.md)** - 完整的 API 接口说明
- **[集成最佳实践](developers/integration-guide.md)** - 架构设计、错误处理、性能优化

### API 能力概览

```bash
# 收藏单词
POST /api/v1/learning/collect-word

# 查询已学词汇
GET /api/v1/learning/learned-words

# 获取复习卡片
POST /api/v1/review-plans/{plan_id}/flashcards

# 提交复习结果
POST /api/v1/review-plans/{plan_id}/submit-answer
```

查看完整 API 文档：[API 概览](api/overview.md)

---

## 为什么选择 Vocnet

### 与传统背单词应用的区别

| 维度           | 传统应用           | Vocnet                         |
| -------------- | ------------------ | ------------------------------ |
| **数据归属**   | 锁定在单一应用     | 跨应用的数据中心               |
| **换应用成本** | 需要重新测试水平   | 掌握度数据跟随用户             |
| **复习算法**   | 各家实现，质量参差 | 统一的 FSRS 科学算法           |
| **开源透明**   | 闭源，数据不透明   | 开源（AGPL-3.0），数据自主权   |
| **生态模式**   | 封闭               | 开放 API，第三方可接入         |
| **专注度**     | 大而全但不专精     | 专注词汇管理                   |

!!! abstract "核心差异化"

1. **全生命周期词汇管理** - 从首次收藏到完全掌握，持续追踪
2. **跨应用数据中心** - 无论在哪学习，数据统一管理
3. **开放 API 生态** - 赋能开发者，而非竞争
4. **数据自主权** - 开源、可导出、可自建

详细对比：[FAQ - 与传统应用的区别](faq.md#与扇贝百词斩等-app-的区别)

---

## 核心概念

深入了解 Vocnet 的设计理念和技术实现：

### 项目理念

- **[项目介绍](concepts/introduction.md)** - 了解 Vocnet 的定位和设计哲学
- **[词汇网络](concepts/vocabulary-network.md)** - 什么是词汇网络，如何构建知识关联

### 技术特性

- **[FSRS 算法](concepts/fsrs-algorithm.md)** - 科学的间隔重复算法原理
- **[掌握度跟踪](concepts/mastery-tracking.md)** - 听说读写分项管理机制
- **[数据模型](concepts/data-model.md)** - 数据结构设计哲学

---

## 生态系统

### Vocnet 的生态定位

Vocnet 不是一个封闭的产品，而是一个**开放的词汇数据基础设施**：

!!! note "生态角色"

- **用户** - 获得统一的词汇数据管理和科学复习系统
- **内容提供者** - 阅读/视频应用专注内容，词汇管理交给 Vocnet
- **工具开发者** - 浏览器扩展、学习工具集成 Vocnet API
- **平台运营者** - 企业/机构可自建私有 Vocnet 实例

### 了解更多

- **[生态概览](ecosystem/overview.md)** - Vocnet 生态全景
- **[使用案例](ecosystem/use-cases.md)** - 典型集成场景
- **[第三方集成](ecosystem/third-party.md)** - 如何成为合作伙伴

---

## 项目状态与路线图

### 当前状态

Vocnet 目前处于 **Alpha 阶段**，核心功能已可用：

!!! success "已完成"

**Phase 1**: 核心词汇管理系统

**Phase 2**: FSRS 复习系统与 Flashcards

!!! info "进行中"

**Phase 3**: OAuth2 生态建设、Web 控制台

查看完整路线图：[Roadmap](roadmap.md)

### 技术栈

- **后端**: Go 1.23+ with Clean Architecture
- **API**: ConnectRPC (gRPC-compatible)
- **数据库**: PostgreSQL / SQLite
- **算法**: SM2 (FSRS v5 规划中)
- **开源协议**: AGPL-3.0

技术详情：[架构概览](developers/technical-overview.md)

---

## 社区与支持

### 获取帮助

!!! question "需要帮助？"

- **[常见问题 (FAQ)](faq.md)** - 快速找到常见问题的答案
- **[GitHub Discussions](https://github.com/eslsoft/vocnet/discussions)** - 社区讨论、功能建议
- **[GitHub Issues](https://github.com/eslsoft/vocnet/issues)** - 报告 Bug、提交问题

### 参与贡献

Vocnet 是一个开源项目，欢迎你的贡献：

- **[代码贡献](contributing/code.md)** - 如何贡献代码
- **[文档贡献](contributing/documentation.md)** - 如何改进文档
- **[治理模型](contributing/governance.md)** - 项目治理规则

### 快速链接

- [GitHub 仓库](https://github.com/eslsoft/vocnet)
- [路线图](roadmap.md)
- [API 文档](api/overview.md)

---

## 立即开始

根据你的身份，选择合适的起点：

| 我是...           | 推荐路径                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------- |
| 🎓 **语言学习者** | [用户快速开始](getting-started/quickstart-users.md) → [用户手册](guides/user-guide.md)   |
| 💻 **应用开发者** | [开发者快速开始](getting-started/quickstart-developers.md) → [API 文档](api/overview.md) |
| 🏠 **自建部署**   | [安装指南](self-hosting/installation.md) → [配置说明](self-hosting/configuration.md)     |
| 🤝 **开源贡献者** | [贡献指南](contributing/code.md) → [架构概览](developers/technical-overview.md)          |

---

<p align="center">
  <strong>Vocnet - 让词汇学习回归本质</strong><br>
  <em>开源 | 开放 | 以用户为中心</em>
</p>
