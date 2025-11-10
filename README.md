<div align="center">

<h1>vocnet</h1>

<p><strong>Vocabulary Knowledge Graph & Progress Store — 社区共建的“词汇 / 例句 / 关系 / 掌握度 / 复习状态”统一数据底座。</strong></p>

<p>
<em>Focus on data & state, not on UX or content delivery.</em><br/>
<sub>gRPC + HTTP/JSON · SQLite (默认) / PostgreSQL · Clean Architecture</sub>
</p>

<p>
<!-- Badges (placeholder, replace when available) -->
<a href="#"> <img src="https://img.shields.io/badge/status-alpha-orange" alt="status"/> </a>
<a href="LICENSE"> <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/> </a>
<a href="#contributing"> <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="prs"/> </a>
<a href="#roadmap"> <img src="https://img.shields.io/badge/roadmap-active-success" alt="roadmap"/> </a>
</p>

</div>

> 定位：只做“学习结果与复习状态”的**结构化存储 + 查询接口**，不做课程编排、练习交互、题目生成、AI 教学对话。你可以在 vocnet 之上自由构建：学习计划、SRS 算法、智能对话、可视化统计、AI 例句生成等上层体验。

## TL;DR

vocnet = “词汇图谱 + 掌握进度 + 例句关联 + 关系网络 + 复习状态” 的协作式数据底座。既可作为你的 App/服务的内部核心数据层，也可与社区共建一套通用模型，避免重复发明轮子。

为什么强调“社区数据模型”？—— 我们**不聚集你的私有用户数据**，而是希望共同进化一套开放的、实践验证的**结构设计与演化策略**；你可安全地复用模型设计，而不必担心“做嫁衣”。

## 核心接口能力 (What It Provides)

### Phase 1: 核心词汇管理 ✅ (设计完成)

- **词汇收藏与掌握度管理**: `CollectWord`, `UpdateLearnedWordMastery`
- **词汇关系网络**: 同义词、反义词、助记关联等
- **例句关联与语料管理**: 支持来源标注和个人化标记
- **学习统计与分析**: 掌握度分布、困难词汇识别
- **RESTful + gRPC 双协议**: 通过 grpc-gateway 自动生成 HTTP API

📖 **API 设计文档**: [docs/api-design-phase1.md](docs/api-design-phase1.md)
�️ **Buf 工具链指南**: [docs/buf-quickstart.md](docs/buf-quickstart.md)
�🗺️ **完整路线图**: [docs/roadmap.md](docs/roadmap.md)

专注“数据 + 状态”层，核心接口聚焦以下领域：

| 能力 | 说明 |
|------|------|
| 词汇收藏与掌握度 | 用户收藏 / 更新掌握程度 (0–5)，支持备注、时间戳、后续复习增强字段 |
| 例句管理 | 录入例句及其来源（人工 / AI / 语料），可与多个词汇关联，杜绝重复存储 |
| 词汇关系图谱 | 同义 / 反义 / 派生 / 助记 / 自定义标签化关系建模与查询，支持扩展类型 |
| 复习状态基元 | 为闪卡 / SRS 调度算法提供掌握度、最近复习、统计基础字段（保留扩展位） |
| 接入协议 | gRPC 一等公民，自动生成 HTTP/JSON 网关 &（后续）OpenAPI/SDK |
| 可演化模型 | 模型版本化 / 可添加新关系 & 属性，不破坏既有使用方 |

> 更多技术与分层说明：`docs/technical-overview.md`

## 边界与非目标 (Scope & Non‑Goals)

| 非目标 | 说明 |
|--------|------|
| 课程 / 训练计划生成 | 由上层学习引擎或 AI 系统负责 |
| 高级 SRS 算法 | 初期仅提供可扩展基础字段；复杂调度在外部实现或后续迭代 |
| 全量权威词典内容 | 不做大而全的释义聚合，只存储用户所需字段与引用 |
| 交互式教学能力 | 不包含对话、语音评测、作文批改等 |
| 学习路径引擎 | 不内置路径规划逻辑；外部可基于数据自行决策 |
| 媒体文件存储 | 仅引用外部资源（URL / 标识），不做二进制托管 |

### 典型上层用法
| 场景 | 使用方式 |
|------|----------|
| 闪卡 / 复习 App | 获取待复习词 + 掌握度，生成卡片并回写结果 |
| AI 教学 Bot | 拉取低掌握或新近添加词汇生成对话、句子练习 |
| 自适应学习引擎 | 聚合掌握度 + 关系网络 + 例句来源制定计划 |
| BI / 统计 | 聚合掌握度分布、增长趋势、错误高频词 |

如果需要“完整学习应用”，vocnet 仅作为**后端数据底座**；你仍需自行实现：学习任务调度、交互体验、AI 生成策略等。

## 数据模型哲学 (Community Data Model Philosophy)

为什么不直接 fork 别人的结构？因为语言学习场景里：

1. “词汇 + 掌握度”不是一张孤立的表，而是一个动态知识状态网络。
2. 例句往往是复用素材，反复引用与溯源需要“引用型”设计，不是简单复制。
3. 关系（同义/派生/助记）是强化记忆与推荐的关键，但常被粗略设计。
4. 复习调度算法演化（Leitner → SM-2 → FSRS）需要存量数据结构兼容。
5. 大多数团队都在重复试错——vocnet 目标是沉淀“被验证的结构与演化策略”而非占有数据。

因此：
- 我们聚焦“结构设计”与“可扩展字段预留”
- 你的业务私有数据仍在你的数据库中（或通过私有部署）；**我们不会收集用户隐私**
- 社区共同改进的 schema 迁移策略与字段语义文档化，可复用、可审计、可长期演进。

> 贡献不仅是代码：提出模型优化讨论 / 字段语义澄清 / 迁移兼容策略，都是一等公民。

## 为什么使用 vocnet

面向“英语 / 多语言学习类 App / AI 学习代理 / 研究项目”开发者，vocnet 让你避免重复造轮子，把时间投入到真正差异化的学习体验上。

| 开发痛点 / 典型自研成本 | vocnet 现成能力 | 直接收益 |
|---------------------------|------------------|-----------|
| 设计词汇、例句、关系、掌握度等一套数据模型 | 已内置规范化结构（词汇/例句/关系/掌握度/复习状态基元） | 减少前期模型摸索与返工 |
| 处理收藏、掌握度变更、去重、事务一致性 | 提供原子接口（收藏 + 状态更新） | 降低逻辑 Bug 率，加快迭代 |
| 规划例句与来源存储、复用策略 | 统一例句与来源抽象，可多词复用 | 复用数据提升覆盖率 |
| 设计词汇关系（同义 / 派生 / 自定义标签） | 通用关系实体 + 类型枚举 | 秒级引入记忆联想功能 |
| 为复习算法准备必要字段与扩展位 | 预留掌握度 / 时间戳 / 统计字段 | 可直接实现闪卡或接入 SRS 引擎 |
| 多端统一接口（Web / 移动 / 服务端） | gRPC + HTTP/JSON 自动映射 | 降低客户端适配工作量 |

### 你可以把精力放在
- 个性化学习路径 / 智能推荐 / AI 教学代理
- UI / 可视化 / 动画与交互
- 高级调度 & 记忆曲线优化 (FSRS / 混合模型)
- AI 例句生成 / 语义检索 / 语音评测
- 运营增长与商业模式验证

把“词汇底座 + 状态存储”交给 vocnet，专注创造差异化价值。

## 快速开始 (Quick Start)

### 前置要求

- Go 1.23+
- SQLite 3（默认使用，常见平台随 go-sqlite3 一同提供）
- 可选：PostgreSQL 13+（如需外部数据库或兼容既有部署）
- protoc (Protocol Buffers 编译器)
- 可选：Docker / Docker Compose

### 1. 获取代码
```bash
git clone https://github.com/eslsoft/vocnet.git
cd vocnet
make setup
```

### 2. 初始化数据库
默认使用本地 SQLite（自动生成 `vocnet.db`）：
```bash
make migrate   # 使用 ent 应用最新 schema
```

如需 PostgreSQL，可启动容器并显式指定驱动：
```bash
make db-up
DB_DSN="postgres://postgres:postgres@localhost:5432/rockd?sslmode=disable" make migrate
```

亦可连接自建 PostgreSQL，仅需提供完整 `DB_DSN` 后执行 `make migrate`。

### 3. 生成代码（如需要）
```bash
make generate mocks
```

### 4. 启动服务
```bash
make run                # 开发模式（源码运行）
# 或构建二进制
make build && ./bin/rockd-server
# 或使用 docker 镜像 （构建后）
make docker-build && docker run --rm -p 8080:8080 -p 9090:9090 rockd:latest
```

默认端口：
- gRPC: 9090
- HTTP: 8080

### 5. 基础 API 调用示例
```bash
curl -X POST http://localhost:8080/api/v1/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"John Doe","email":"john@example.com"}'

curl http://localhost:8080/api/v1/users/1
```

## 配置 (Environment)

在运行前可通过环境变量覆盖默认配置，详见示例：
```env
SERVER_HOST=localhost
GRPC_PORT=9090
HTTP_PORT=8080
DB_DSN=file:./data/vocnet.db
# 示例：改用 PostgreSQL
# DB_DSN=postgres://postgres:postgres@localhost:5432/vocnet?sslmode=disable
LOG_LEVEL=info
```

## 开发常用命令 (Developer Tasks)
```bash
make help            # 显示所有可用命令
make run             # 启动服务
make test            # 运行测试
make generate        # 生成 protobuf, ent, mocks, wire
make mock-generate   # 仅生成 mocks
make migrate         # ent schema 迁移
make lint            # 代码检查
make fmt             # 格式化代码
```

**代码生成说明**：
- `make generate` - 生成所有代码（protobuf、ent、mocks、wire）
- `make mock-generate` - 仅重新生成 mock 文件
- Mock 文件使用 [gomock](https://github.com/golang/mock) 自动生成
- 修改接口定义后需要重新生成 mocks


## 相关文档 (Docs)

- 技术架构：`docs/technical-overview.md`
- 贡献指南：`CONTRIBUTING.md`
- OpenAPI 文档：`api/openapi/` (生成后)

## 测试 (Testing)
```bash
make test
make test-coverage
```

## 路线图 (Roadmap 摘要)

完整路线图请查看: `docs/roadmap.md`

Phase 1 (当前进行/优先): 核心词汇与素材管理 —— 收藏单词、掌握程度(0-5)、例句管理、词与词连接、基础统计。

Phase 2: 闪卡复习 MVP —— 简单调度算法(基于掌握度+时间)、批次获取与结果提交、支持识别/听力/拼写/用法卡片类型。

Phase 3: 深化与可视化 —— 间隔重复优化(SM-2/FSRS 简化)、词网图谱、统计分析报表、来源维度回放。

Phase 4: 智能与个性化 —— 语义推荐、自动例句生成、个性化调度、AI 辅助 (TTS/ASR)。

后续规划（示例）：
- 鉴权与多用户隔离
- OpenTelemetry / 可观测性
- 高级安全与多租户

欢迎通过 Issue / PR 参与！

## 贡献 (Contributing)

欢迎所有形式的贡献：模型设计讨论 / Issue / PR / 文档改进 / 迁移策略建议。

1. 阅读 `CONTRIBUTING.md`
2. Fork & 创建特性分支 (`feat/...` / `fix/...`)
3. 保持提交原子化，附带简洁描述（中英文均可）
4. 为公共行为添加/更新测试
5. 确认 `make test` 通过 & 无 lint 问题
6. 提交 PR 并在描述中：
  - 说明动机 / 解决的问题
  - 标记是否涉及 schema 变更（若有，附迁移策略）

> 模型演化提案：推荐使用 “RFC” 形式（在 `docs/rfcs/` 下新增文件）。

### 治理 (Lightweight Governance)

- Maintainers：负责合并、版本发布、迁移审查
- Schema 变更：需要最少 2 位维护者 + 1 位社区评论通过
- 发布节奏：初期不定期（0.x），稳定后按月或特性驱动
- 版本语义：遵循 SemVer，模型破坏性变更在 major bump

欢迎报名成为维护者：在 Discussions 发帖说明你的使用场景与意愿。

### 社区共建的价值

| 社区共建为什么重要 | 你的收益 |
|--------------------|----------|
| 沉淀“被验证的”数据模型 | 减少重复试错成本 |
| 共同改进字段语义 / 迁移策略 | 降低升级风险 |
| 多场景反馈驱动设计更通用 | 增强你的上层创新空间 |
| Schema 稳定后更易写 SDK / 工具 | 获得更丰富生态 |
| 开放治理，避免厂商绑定 | 长期可持续演进 |

## 常见问题 (FAQ)

**Q: 我会不会把自己的用户数据“贡献”出去？**
A: 不会。vocnet 只提供结构与代码。你的部署只存你自己的业务数据。我们讨论与共建的是“模型与接口设计”。

**Q: 可以直接用于生产吗？**
A: 当前阶段为 Alpha（核心数据路径稳定性逐步提高）。建议先在内部或低风险环境验证，再逐步扩大。

**Q: 是否会支持高级调度算法（FSRS / 自适应建模）？**
A: 会，以插件式或扩展字段方式，不强绑定单一策略。

**Q: 是否提供 Web 控制台？**
A: 会提供。社区版将包含基础内容管理（查看 + 基础编辑：词汇 / 例句 / 关系）与简单统计；高级功能（批量导入、冲突合并、关系图可视化、质量审核流）计划进入商业版或后续扩展。初期会用最小可用版本验证体验，欢迎反馈。

**Q: 会不会提供“管理后台”（站点配置 / 开发者 / API Key / 配额）？**
A: 是的。社区版可能仅包含最小必要能力（查看系统版本信息、手动创建/吊销少量 API Key）；完整功能（应用审核、配额/限流配置、调用细粒度统计、审计日志、运营看板、多环境配置）属于规划中的商业版特性。管理后台不处理具体词/例句内容，那属于 Web 控制台。

**Q: 社区版与商业版的基本区别？**
A: 简化说明：社区版 = 核心数据模型 + API + 基础 Web 控制台（有限功能）+ 最小管理后台；商业版 = 全量控制台能力（批量/审核/可视化）、高级治理（配额/统计/审计）、更完善的权限与集成支持。定价与获取方式会在功能临近发布时公布。

**Q: 计划提供 SDK 吗？**
A: 预计在 schema 稳定后提供（Go / TypeScript 首批）。欢迎提出需求。

**Q: 如何讨论模型改进？**
A: 发起 Issue（`type:proposal`）、或在将来开启 Discussions 专区，复杂变更走 RFC。

## 许可证 (License)

本项目基于 Apache 2.0 License 发布，详见 `LICENSE`。

---

如果你在使用中发现改进点，欢迎提交 Issue / PR / 模型提案。🙌
一起把“语言学习数据底座”这件重复造轮子的事做成一个公共基础设施。
