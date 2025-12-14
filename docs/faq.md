# 常见问题 (FAQ)

## 基础问题

### vocnet 是什么？

vocnet 是一个开源的词汇网络管理平台，帮助用户管理全生命周期的词汇数据，并提供基于 FSRS 算法的科学复习系统。

详见：[项目介绍](concepts/introduction.md)

---

### vocnet 是纯数据底座还是完整应用？

**两者兼有**。

- **对用户**：提供完整的词汇学习和复习应用（Web / 移动端）
- **对开发者**：提供 API 基础设施，让第三方 APP 集成词汇管理功能

---

### 与扇贝、百词斩等 APP 的区别？ {#与扇贝百词斩等-app-的区别}

| 维度     | 传统 APP                 | vocnet                 |
| -------- | ------------------------ | ---------------------- |
| 数据归属 | 锁定在单一 APP           | 跨 APP 的数据中心      |
| 开源     | 闭源                     | 开源（Apache 2.0）     |
| 生态     | 封闭                     | 开放 API，第三方可接入 |
| 专注度   | 大而全（阅读+视频+复习） | 专注词汇管理           |

**核心差异**：vocnet 强调**数据自主权**和**跨 APP 生态**。

---

## 数据与隐私

### 我的数据安全吗？

安全。你的词汇数据：

- ✅ 完全隔离（其他用户无法访问）
- ✅ 支持导出（JSON / CSV）
- ✅ 可以自建服务器（代码开源）
- ✅ OAuth2 授权可随时撤销

---

### "开源"意味着我的数据会被共享吗？

**不会**。

- **开源**指的是：代码和数据模型设计开源
- **你的数据**：完全私有，不会被共享
- 类比：MySQL 是开源的，但你的数据库内容是私有的

---

### 第三方 APP 接入后会拿走我的数据吗？

不会完全拿走，但会有限访问：

- ✅ 第三方 APP 通过 OAuth2 授权访问
- ✅ 你可以随时撤销授权
- ✅ API 限制批量导出（防止恶意复制）
- ✅ 第三方只能增量获取，无法一次性复制全量数据

---

### 如何导出我的数据？

```bash
# API 导出（需要 access_token）
curl http://localhost:8080/api/v1/learning/export \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  > my-words.json
```

或在 Web 控制台（计划）点击"导出数据"。

---

## 功能相关

### 支持哪些语言？

当前支持：

- ✅ 英语
- 🔜 多语言支持（西班牙语、法语、日语等）

---

### FSRS 算法是什么？

**Free Spaced Repetition Scheduler**（自由间隔重复调度器）：

- 基于最新记忆科学研究
- 比传统 SM-2 算法更准确
- 动态调整复习间隔
- 开源实现：https://github.com/open-spaced-repetition/fsrs4anki

详见：[FSRS 算法说明](concepts/fsrs-algorithm.md)

---

### 如何复习单词？

**方式 1**：使用 vocnet 官方 APP / 网站

- 访问 vocnet.com（计划）
- 点击"今日复习"
- 完成 flashcards

**方式 2**：在第三方 APP 内复习

- 第三方 APP 调用 `GetFlashCards` API
- 在自己 APP 内展示复习卡片
- 提交结果到 vocnet

---

### 支持离线复习吗？

计划支持。

- 移动端 APP 会缓存今日复习词汇
- 离线完成后，联网时同步结果

---

## 开发者相关

### 如何接入 vocnet？

1. 注册 vocnet 账号
2. 申请开发者资格（GitHub Issue）
3. 获得 `client_id` 和 `client_secret`
4. 实现 OAuth2 授权流程
5. 调用 API

详见：[开发者指南](developers/integration-guide.md)

---

### 有 SDK 吗？

计划提供：

- 🔜 Go SDK
- 🔜 TypeScript SDK
- 🔜 Swift SDK（iOS）
- 🔜 Kotlin SDK（Android）

当前可以直接调用 ConnectRPC API（基于 HTTP）。未来会提供自动生成的多平台 SDK。

---

### API 调用有限制吗？

官方服务（计划）：

- 🆓 免费：10,000 次/月
- 💼 付费：100,000+ 次/月

自建服务：无限制。

---

### 需要付费吗？

**个人用户**：

- 基础功能免费
- 高级功能（AI 例句、高级统计）付费

**开发者**：

- 免费额度：10,000 API 调用/月
- 超量付费或升级套餐

**企业**：

- 私有化部署需付费授权

---

## 自建部署

### 如何自建 vocnet？

```bash
git clone https://github.com/eslsoft/vocnet.git
cd vocnet
make setup
make migrate
make run
```

详见：[安装指南](self-hosting/installation.md)

---

### 自建需要什么配置？

**最低配置**：

- 1 核 CPU
- 1GB 内存
- 10GB 磁盘

**推荐配置**（1000+ 用户）：

- 2 核 CPU
- 4GB 内存
- 50GB 磁盘
- PostgreSQL（而非 SQLite）

---

### 自建后如何升级？

```bash
git pull origin main
make migrate  # 数据库迁移
make build
./bin/vocnet
```

详见：[数据迁移指南](self-hosting/migration.md)

---

## 商业模式

### 开源项目如何盈利？

计划的商业模式：

1. **官方托管服务**：

   - 免费基础版
   - 付费高级版（AI 功能、高级统计）

2. **企业私有化部署**：

   - 付费授权
   - 技术支持
   - SLA 保障

3. **开发者 API**：
   - 免费额度
   - 超量付费

**开源不影响**：代码永远开源，你可以自建免费使用。

---

### 会不会跑路？

不会。

- ✅ 代码开源（AGPL-3.0）
- ✅ 你可以 fork 并自己维护
- ✅ 数据格式公开，易于迁移
- ✅ 社区治理，不由单一公司控制

---

## 其他

### 如何参与贡献？

详见：[贡献指南](contributing/code.md)

方式：

- 🐛 提交 Bug 报告
- 💡 提出功能建议
- 🔧 贡献代码
- 📖 改进文档
- 🌍 翻译

---

### 有社区吗？

- GitHub Discussions（计划）
- Discord / Telegram（计划）
- 微信群（计划）

当前可以通过 [GitHub Issues](https://github.com/eslsoft/vocnet/issues) 交流。

---

### 项目由谁维护？

- 创始人：[@saltbo](https://github.com/saltbo)
- 贡献者：欢迎加入！

查看：[治理模型](contributing/governance.md)

---

## 没找到答案？

- 📖 查看[完整文档](index.md)
- 💬 加入 [Discussions](https://github.com/eslsoft/vocnet/discussions)
- 🐛 提交 [Issue](https://github.com/eslsoft/vocnet/issues/new)
