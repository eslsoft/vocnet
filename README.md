<div align="center">

<h1>Vocnet</h1>

<p><strong>开源的词汇网络管理平台</strong></p>
<p><em>以用户为中心的全生命周期的词汇数据中心</em></p>

<p>
<a href="https://github.com/eslsoft/vocnet/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license"/></a>
<a href="https://github.com/eslsoft/vocnet/issues"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="prs"/></a>
<a href="docs/roadmap.md"><img src="https://img.shields.io/badge/roadmap-active-success" alt="roadmap"/></a>
<a href="#"><img src="https://img.shields.io/badge/status-alpha-orange" alt="status"/></a>
</p>

<p>
<sub>ConnectRPC · 全平台 SDK · FSRS Algorithm · SQLite / PostgreSQL
</p>

</div>

---

## 💡 为什么选择 vocnet

市面上有太多的英语学习 APP，我们在学习英语的过程中往往会使用到 N 个 APP，但是每个 APP 都是数据孤岛，各自并不知道你的真实水平，各平台只能估算你的词汇量。因为对词汇的掌握情况不清晰，导致系统会安排很多不合适的学习内容，浪费时间和精力。

Vocnet 致力于打造一个开放的词汇网络管理平台，帮助用户集中管理自己的词汇数据，并通过科学的记忆算法（FSRS）帮助用户高效复习单词。开发者可以通过 Vocnet 的开放 API 快速集成词汇管理功能，无需重复造轮子。

---

## 📚 核心功能

| 功能              | 说明                           |
| ----------------- | ------------------------------ |
| 🗂️ **词汇管理**   | 收藏、分类、标签、词本         |
| 📊 **掌握度跟踪** | 听说读写分项管理（0-5 级）     |
| 🧠 **FSRS 复习**  | 科学的间隔重复算法             |
| 🎴 **Flashcards** | 智能生成复习卡片               |
| 🔗 **词汇网络**   | 同义词、派生词、助记联想       |
| 🌐 **开放 API**   | ConnectRPC，自动生成全平台 SDK |
| 📱 **跨设备同步** | Web / 移动端（计划中）         |

---

## 🎯 两种使用方式

### 语言学习者

使用 vocnet 学习和复习单词，享受科学的记忆管理系统。

📖 [技术文档](docs/README.md) | [掌握度系统](docs/design/mastery-breakdown-and-stages.md)

### 语言 APP 开发者

接入 vocnet SDK，为你的应用快速集成词汇管理功能。

🛠️ [技术架构](docs/README.md) | [API文档](CLAUDE.md#api-connectrpc)

**示例场景**：

- 开发英文阅读 APP → 文中单词高亮，点击生词存到 vocnet
- 开发视频学习工具 → 字幕生词高亮，点击存到 vocnet
- 开发浏览器扩展 → 网页生词高亮，网页划词存到 vocnet

**价值**：无需自己实现词汇存储、掌握度管理、FSRS 算法，专注于差异化体验。

---

## 🛠️ 技术栈

- **后端**：Go 1.23+ · Clean Architecture
- **API**：ConnectRPC (自动生成全平台 SDK)
- **数据库**：SQLite (默认) / PostgreSQL
- **ORM**：Ent
- **算法**：FSRS (Free Spaced Repetition Scheduler)
- **认证**：JWT · OAuth2 (计划)

---

## 📊 项目状态

当前版本：**v0.x (Alpha)**

- ✅ **Phase 1**：核心词汇管理
- ✅ **Phase 2**：FSRS 复习系统
- 🔜 **Phase 3**：OAuth2 生态 · Web 控制台

查看 [完整技术文档](docs/README.md)

---

## 🤝 参与贡献

欢迎所有形式的贡献：

- 🐛 [报告 Bug](https://github.com/eslsoft/vocnet/issues/new?template=bug_report.md)
- 💡 [提出功能建议](https://github.com/eslsoft/vocnet/issues/new?template=feature_request.md)
- 🔧 [贡献代码](docs/contributing/code.md)
- 📖 [改进文档](docs/contributing/documentation.md)

详见 [贡献指南](CONTRIBUTING.md)

---

## 📜 许可证

本项目基于 [AGPL-3.0 License](LICENSE) 开源。

- 你可以自由自托管、修改和内部使用 vocnet；
- 如果你基于 vocnet 提供网络服务（SaaS），需要按 AGPL-3.0 开源你对 vocnet 的修改；
- 官方认证服务将以单独的商业条款提供，并不在本仓库开源范围内。

---

## 🔗 链接

- **官网**：https://vocnet.apps.tftt.cc （计划中）
- **技术文档**：[docs/README.md](docs/README.md)
- **开发指南**：[CLAUDE.md](CLAUDE.md)
- **Discussions**：[GitHub Discussions](https://github.com/eslsoft/vocnet/discussions)（计划）

---

## 🙋 FAQ

常见问题请查看 [技术文档](docs/README.md)

**快速链接**：

- [vocnet 是什么？](#-为什么选择-vocnet)
- [技术架构？](docs/README.md)
- [如何开发？](CLAUDE.md)
- [如何自建？](CLAUDE.md#configuration)

---

<div align="center">

**一起把"词汇网络管理"做成开放的基础设施** 🚀

[⭐ Star](https://github.com/eslsoft/vocnet) · [📖 技术文档](docs/README.md) · [💬 讨论](https://github.com/eslsoft/vocnet/discussions)

</div>
