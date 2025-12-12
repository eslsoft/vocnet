# Buf 工具链快速开始指南

## 安装和设置

### 1. 安装工具

```bash
# 安装所有必要的开发工具 (包括 buf)
make install-tools
```

### 2. 初始化项目

```bash
# 更新 protobuf 依赖
make buf-deps

# 检查代码规范
make buf-lint

# 生成所有代码
make generate
```

## 日常开发工作流

### 修改 Protobuf 文件后

```bash
# 1. 格式化代码
make buf-format

# 2. 检查代码规范
make buf-lint

# 3. 检查破坏性变更 (可选)
make buf-breaking

# 4. 重新生成代码
make generate
```

### 添加新依赖

如果需要添加新的 protobuf 依赖，编辑 `api/proto/buf.yaml` 文件：

```yaml
deps:
  - buf.build/googleapis/googleapis
  - buf.build/bufbuild/protovalidate
  - buf.build/envoyproxy/protoc-gen-validate
  - buf.build/your-org/your-repo # 添加新依赖
```

然后运行：

```bash
make buf-deps
```

## Buf 配置文件说明

### `buf.gen.yaml` (项目根目录)

- 代码生成配置
- 定义使用哪些插件和输出选项

### `buf.work.yaml` (项目根目录)

- 工作空间配置
- 管理多模块项目，指向 `api/proto` 目录

### `api/proto/buf.yaml`

- 模块级别的配置
- 定义模块名称、依赖、linting 和 breaking change 规则

### `api/proto/buf.lock` (自动生成)

- 依赖锁定文件
- 确保构建的可重现性

## 常用命令

```bash
# 生成代码
make generate

# 更新依赖
make buf-deps

# 代码检查
make buf-lint

# 格式化代码
make buf-format

# 检查破坏性变更
make buf-breaking

# 查看所有可用命令
make help
```

## 故障排除

### 依赖解析问题

如果遇到依赖解析问题：

```bash
# 清理并重新生成
make clean
make buf-deps
make generate
```

### Linting 错误

常见的 linting 问题：

1. **RPC 命名**: 确保 RPC 方法使用 PascalCase
2. **字段命名**: 确保字段使用 snake_case
3. **包结构**: 确保包名遵循规范

### 破坏性变更检查失败

如果破坏性变更检查失败但变更是有意的：

```bash
# 跳过破坏性变更检查 (谨慎使用)
buf breaking --against '.git#branch=main' --config '{"version":"v1","breaking":{"use":["FILE"]},"lint":{"use":["DEFAULT"]}}'
```

## 最佳实践

1. **提交前检查**: 始终在提交前运行 `make buf-lint` 和 `make generate`
2. **依赖管理**: 定期运行 `make buf-deps` 更新依赖
3. **代码格式**: 使用 `make buf-format` 保持代码格式一致
4. **版本控制**: 将 `buf.lock` 文件提交到版本控制系统
5. **CI/CD**: 在 CI/CD 流水线中包含 buf 检查步骤
