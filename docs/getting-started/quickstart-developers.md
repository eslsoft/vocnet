# 快速开始 - 开发者集成指南

> 15 分钟将 Vocnet 集成到你的应用

本指南面向**应用开发者**，帮助你快速集成 Vocnet API，为你的用户提供统一的词汇管理能力。

---

## 前置条件

开始集成前，你需要：

- **开发者账号** - 在 Vocnet 实例注册开发者账号
- **OAuth2 凭证** - client_id 和 client_secret
- **HTTP/REST API 基础知识**
- **Go 1.21+** 或其他支持 HTTP 请求的开发环境

!!! tip "获取开发者凭证"
目前需要通过 GitHub Issue 申请开发者账号。未来将提供自助申请流程。

    提交申请：[https://github.com/eslsoft/vocnet/issues/new](https://github.com/eslsoft/vocnet/issues/new)

---

## 第一步：注册开发者应用

### 创建应用

1. 登录 Vocnet 开发者控制台
2. 点击「创建应用」
3. 填写应用信息：
   - **应用名称** - 例如「MyReadingApp」
   - **应用描述** - 简短介绍你的应用
   - **回调 URL** - OAuth2 授权回调地址（例如：`https://yourapp.com/oauth/callback`）
   - **权限范围** - 选择需要的 API 权限
4. 提交后获得：
   - **Client ID** - 应用唯一标识
   - **Client Secret** - 应用密钥（请妥善保管）

### 权限范围

根据你的应用需求，申请相应的权限：

| 权限              | 说明                |
| ----------------- | ------------------- |
| `words:read`      | 读取用户的词汇数据  |
| `words:write`     | 添加/更新用户的词汇 |
| `review:read`     | 查看复习计划和记录  |
| `review:write`    | 提交复习结果        |
| `wordbooks:read`  | 读取词本信息        |
| `wordbooks:write` | 创建/管理词本       |

!!! warning "最小权限原则"
只申请你的应用实际需要的权限，避免过度授权。

---

## 第二步：实现 OAuth2 授权流程

Vocnet 使用标准的 OAuth 2.0 授权码模式。

### 2.1 引导用户授权

在你的应用中添加「连接 Vocnet」按钮，跳转到授权页面：

```
https://vocnet.com/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=https://yourapp.com/oauth/callback&
  response_type=code&
  scope=words:read words:write&
  state=RANDOM_STATE_STRING
```

参数说明：

- `client_id` - 你的应用 Client ID
- `redirect_uri` - 授权后的回调地址（需与注册时一致）
- `response_type` - 固定为 `code`
- `scope` - 请求的权限，空格分隔
- `state` - 随机字符串，用于防止 CSRF 攻击

### 2.2 处理回调

用户同意授权后，Vocnet 会重定向到你的回调地址，并携带授权码：

```
https://yourapp.com/oauth/callback?code=AUTHORIZATION_CODE&state=RANDOM_STATE_STRING
```

验证 `state` 参数，确保与发起请求时一致。

### 2.3 交换 Access Token

使用授权码换取 Access Token：

```bash
curl -X POST https://vocnet.com/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code' \
  -d 'code=AUTHORIZATION_CODE' \
  -d 'client_id=YOUR_CLIENT_ID' \
  -d 'client_secret=YOUR_CLIENT_SECRET' \
  -d 'redirect_uri=https://yourapp.com/oauth/callback'
```

响应示例：

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "def50200...",
  "scope": "words:read words:write"
}
```

!!! tip "Token 管理" - **Access Token** 用于调用 API，有效期通常为 1 小时 - **Refresh Token** 用于刷新 Access Token，有效期较长 - 记得处理 Token 过期和刷新逻辑

详细的 OAuth2 集成指南：[OAuth2 集成](../guides/oauth2-integration.md)

---

## 第三步：调用 API

拿到 Access Token 后，就可以调用 Vocnet API 了。

### 3.1 收藏单词

为用户添加新词汇到 Vocnet：

```bash
curl -X POST http://localhost:8080/api/v1/learning/collect-word \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -d '{
    "spec": {
      "term": "apple",
      "language": "LANGUAGE_ENGLISH",
      "mastery_level": 0,
      "tags": ["fruit", "food"],
      "notes": ["常见水果", "red or green"]
    }
  }'
```

响应示例：

```json
{
  "learned_word": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "term": "apple",
    "language": "LANGUAGE_ENGLISH",
    "mastery_level": 0,
    "created_at": "2024-12-13T10:00:00Z"
  }
}
```

### 3.2 查询已学词汇

获取用户的词汇列表：

```bash
curl http://localhost:8080/api/v1/learning/learned-words \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -G \
  --data-urlencode 'page_size=20' \
  --data-urlencode 'page_token=' \
  --data-urlencode 'filter=language == "LANGUAGE_ENGLISH"'
```

响应示例：

```json
{
  "learned_words": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "term": "apple",
      "mastery_level": 2,
      "last_reviewed_at": "2024-12-12T15:30:00Z"
    },
    {
      "id": "223e4567-e89b-12d3-a456-426614174001",
      "term": "banana",
      "mastery_level": 3,
      "last_reviewed_at": "2024-12-11T09:20:00Z"
    }
  ],
  "next_page_token": "eyJvZmZzZXQiOjIwfQ=="
}
```

### 3.3 获取复习卡片

为用户生成今日复习任务：

```bash
curl -X POST http://localhost:8080/api/v1/review-plans/{plan_id}/flashcards \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "limit": 20
  }'
```

响应包含复习卡片列表，包括题目类型、选项、正确答案等。

### 3.4 提交复习结果

用户完成复习后，提交结果以更新掌握度：

```bash
curl -X POST http://localhost:8080/api/v1/review-plans/{plan_id}/submit-answer \
  -H 'Authorization: Bearer YOUR_ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "flashcard_id": "flashcard-id-here",
    "user_answer": "apple",
    "is_correct": true,
    "time_spent_ms": 5000
  }'
```

Vocnet 会根据答题情况自动调整下次复习时间。

---

## 第四步：使用 SDK（推荐）

手动构造 HTTP 请求比较繁琐，推荐使用官方 SDK。

### Go SDK

```go
import (
    "context"
    "github.com/eslsoft/vocnet-go-sdk/client"
)

// 初始化客户端
vocnetClient := client.New(
    client.WithBaseURL("https://vocnet.com"),
    client.WithAccessToken(accessToken),
)

// 收藏单词
resp, err := vocnetClient.Learning.CollectWord(context.Background(), &learning.CollectWordRequest{
    Spec: &learning.LearnedWordSpec{
        Term:         "apple",
        Language:     learning.Language_LANGUAGE_ENGLISH,
        MasteryLevel: 0,
        Tags:         []string{"fruit"},
    },
})
```

### TypeScript SDK

```typescript
import { VocnetClient } from "@vocnet/sdk";

const client = new VocnetClient({
  baseURL: "https://vocnet.com",
  accessToken: accessToken,
});

// 收藏单词
const response = await client.learning.collectWord({
  spec: {
    term: "apple",
    language: "LANGUAGE_ENGLISH",
    masteryLevel: 0,
    tags: ["fruit"],
  },
});
```

!!! note "SDK 文档"
详细的 SDK 使用指南：[SDK 使用](../developers/sdk-usage.md)

---

## 常见问题

### 如何测试 API？

你可以在本地运行 Vocnet 实例进行开发测试：

```bash
git clone https://github.com/eslsoft/vocnet.git
cd vocnet
make setup
make run
```

服务会启动在 `localhost:8080`。详见：[自建部署指南](../self-hosting/installation.md)

### Token 过期了怎么办？

使用 Refresh Token 刷新 Access Token：

```bash
curl -X POST https://vocnet.com/oauth/token \
  -d 'grant_type=refresh_token' \
  -d 'refresh_token=YOUR_REFRESH_TOKEN' \
  -d 'client_id=YOUR_CLIENT_ID' \
  -d 'client_secret=YOUR_CLIENT_SECRET'
```

### 如何处理 API 错误？

Vocnet API 使用标准的 HTTP 状态码：

- `200` - 成功
- `400` - 请求参数错误
- `401` - 未授权（Token 无效或过期）
- `403` - 禁止访问（权限不足）
- `404` - 资源不存在
- `429` - 请求过于频繁
- `500` - 服务器错误

错误响应示例：

```json
{
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "Invalid language code",
    "details": []
  }
}
```

### 有 API 调用限制吗？

是的，为保证服务质量，Vocnet 对 API 调用有频率限制：

- 默认：**1000 请求/小时**
- 超出后返回 `429 Too Many Requests`
- 响应头会包含限流信息：`X-RateLimit-Limit`, `X-RateLimit-Remaining`

如需更高额度，请联系我们。

---

## 下一步

恭喜你已经完成了基本的 API 集成！接下来你可以：

!!! tip "深入学习" - **[完整 API 参考](../api/overview.md)** - 查看所有可用的 API 接口 - **[集成最佳实践](../developers/integration-guide.md)** - 架构设计、错误处理、性能优化 - **[示例代码](../developers/examples.md)** - 各种场景的完整示例代码

!!! info "技术资源" - **[技术架构](../developers/technical-overview.md)** - 了解 Vocnet 的设计架构 - **[数据模型](../concepts/data-model.md)** - 理解核心数据结构 - **[FSRS 算法](../concepts/fsrs-algorithm.md)** - 复习算法原理

!!! question "需要帮助？" - [常见问题 (FAQ)](../faq.md) - [GitHub Issues](https://github.com/eslsoft/vocnet/issues) - [开发者社区](https://github.com/eslsoft/vocnet/discussions)

---

**祝你集成顺利！** 🚀
