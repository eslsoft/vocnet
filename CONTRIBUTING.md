# 贡献指南 (Contributing Guide)

感谢你考虑为 `vocnet` 做出贡献！本项目遵循 Clean Architecture，欢迎提交改进、Bug 修复与新特性提案。

## 快速开始

1. Fork 仓库并克隆：
   ```bash
   git clone https://github.com/<yourname>/vocnet.git
   cd vocnet
   git remote add upstream https://github.com/eslsoft/vocnet.git
   ```
2. 创建分支：
   ```bash
   git checkout -b feat/<short-feature-name>
   ```
3. 安装开发依赖：
   ```bash
   make setup
   ```
4. 启动数据库与迁移：
   ```bash
   make db-up
   make migrate
   ```
5. 运行：
   ```bash
   make run
   ```

## 分支与提交规范

| 类型前缀 | 说明 | 示例 |
|----------|------|------|
| feat | 新功能 | feat: support user tags |
| fix | Bug 修复 | fix: nil pointer in user repo |
| refactor | 重构但无行为改变 | refactor: simplify query builder |
| docs | 文档调整 | docs: update technical overview |
| test | 测试新增或改进 | test: add repository tx tests |
| chore | 构建/杂项 | chore: bump dependency versions |
| perf | 性能优化 | perf: add index to word lookup |

提交格式示例：
```
feat: add sentence similarity ranking usecase

详细说明改动动机、技术实现、兼容性与后续工作。
```

## 代码组织要求

- 不允许从内层 (entity/usecase) 依赖外层 (adapter/infrastructure)
- 业务逻辑集中在 usecase；gRPC 层仅做参数验证及调用
- 数据访问通过 ent Schema 定义在 `internal/infrastructure/database/entschema/`，避免在代码中拼接长 SQL
- 避免循环依赖，接口放在调用方向的上层

## 测试要求

- 新增功能必须包含：
  - UseCase 单元测试（Mock Repository）
  - Repository 关键查询集成测试（需数据库）
- 覆盖典型成功路径与至少一个失败路径
- 使用表驱动测试（table-driven tests）
- 运行：
  ```bash
  make test
  make test-coverage
  ```

## 代码生成

修改以下内容后需重新生成：

| 变更 | 需要命令 |
|------|----------|
| `.proto` | `make generate` |
| `internal/infrastructure/database/entschema/*.go` | `make ent-generate` |
| 接口定义 (需 mock) | `make mock-generate` |

可合并执行：
```bash
make generate
```

注意：`make generate` 会自动生成 protobuf、ent schema、mocks 和 wire 绑定。

## Mock 生成

项目使用 [gomock](https://github.com/golang/mock) 自动生成测试 mocks。

- Mock 文件位于 `internal/mocks/`
- 通过 `go:generate` 指令自动生成
- 修改接口后运行 `make mock-generate` 重新生成
- 详见 `internal/mocks/README.md`


## 风格与静态检查

- 使用 `go fmt`（`make fmt`）
- 使用 `golangci-lint`（若后续添加，可扩展到 `make lint`）
- 避免滥用全局变量，使用依赖注入
- 错误处理：`fmt.Errorf("context: %w", err)`

## 提交 Pull Request 流程

1. Rebase 保持分支最新：
   ```bash
   git fetch upstream
   git rebase upstream/master
   ```
2. 确保：构建通过、测试通过、文档（若受影响）已更新
3. 填写 PR 模板（若存在），描述：
   - 动机 / 背景
   - 主要改动点
   - 兼容性或迁移注意
   - 测试说明
4. 等待 Review，按建议修改
5. Reviewer 合并或你进行 squash & merge（视仓库策略）

## 数据库迁移规范

- 数据库结构由 ent schema 维护，运行 `make migrate`
- 若涉及数据修复，按需要在应用层编写一次性脚本
- 大批量写操作需评估锁与性能影响

## 性能与安全

提交前请考虑：
- 查询是否需要索引
- 是否存在 N+1 问题
- 是否正确使用 context 控制超时
- 外部输入是否已验证（proto + usecase）

## 行为兼容性与版本

- 暂未发布稳定版本，Breaking Change 请在 PR 标题前加前缀：`BREAKING:` 并在描述中明确迁移步骤

## 问题反馈 (Issues)

提交 Issue 时建议包含：
- 环境信息 (Go 版本, OS, DB 版本)
- 复现步骤与期望结果
- 实际结果与日志（如有）
- 可能的解决建议

## 联系与讨论

- Issue / PR 留言
- 可提议引入 Discussions 版块（视仓库策略）

欢迎你的贡献，一起完善 vocnet！
