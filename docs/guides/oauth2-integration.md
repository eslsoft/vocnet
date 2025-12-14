# OAuth2 集成指南

本文档说明第三方应用如何通过 OAuth2 接入 vocnet。

## 概述

vocnet 使用标准的 **OAuth 2.0 Authorization Code Flow**，确保：

- ✅ 用户数据安全（第三方不接触密码）
- ✅ 授权可控（用户可随时撤销）
- ✅ 标准化流程（易于实现）

---

## 准备工作

### 1. 注册应用

向 vocnet 申请 OAuth 应用（当前为人工审核）：

**申请方式**：

- 提交 GitHub Issue（模板：OAuth Application）
- 填写信息：
  - 应用名称（如"英文阅读助手"）
  - 应用描述
  - 回调 URL（如 `https://your-app.com/callback`）
  - 申请权限（scopes）

**审核通过后，你会获得**：

- `client_id`：应用唯一标识
- `client_secret`：应用密钥（请妥善保管）

---

### 2. 选择权限范围 (Scopes)

| Scope              | 说明                      |
| ------------------ | ------------------------- |
| `read:words`       | 读取用户词汇数据          |
| `write:words`      | 添加/更新词汇             |
| `read:flashcards`  | 读取复习计划和 flashcards |
| `write:flashcards` | 提交复习结果              |
| `read:profile`     | 读取用户基本信息          |

**推荐组合**：

- 阅读 APP：`read:words`, `write:words`
- 复习工具：`read:flashcards`, `write:flashcards`

---

## OAuth2 流程

### 流程图

```
┌─────────┐                                  ┌─────────┐
│  用户   │                                  │第三方APP│
└────┬────┘                                  └────┬────┘
     │  1. 点击"连接 vocnet"                      │
     ├──────────────────────────────────────────►│
     │                                            │
     │  2. 跳转到 vocnet 授权页                   │
     │◄───────────────────────────────────────────┤
     │  (带上 client_id, redirect_uri, scope)    │
     │                                            │
┌────▼────┐                                      │
│ vocnet  │                                      │
│授权页面 │                                      │
└────┬────┘                                      │
     │  3. 用户登录并授权                         │
     │                                            │
     │  4. 跳转回第三方 APP                       │
     │     (带上 authorization_code)             │
     ├───────────────────────────────────────────►│
     │                                            │
     │                                       ┌────▼────┐
     │                                       │第三方APP│
     │                                       │ 后端    │
     │                                       └────┬────┘
     │                                            │
     │  5. 用 code 换取 access_token              │
     │◄───────────────────────────────────────────┤
     │     (POST /oauth/token)                    │
     │                                            │
     │  6. 返回 access_token                      │
     ├───────────────────────────────────────────►│
     │                                            │
     │  7. 调用 API (带 token)                    │
     │◄───────────────────────────────────────────┤
     │                                            │
     │  8. 返回用户数据                           │
     ├───────────────────────────────────────────►│
```

---

## 详细步骤

### Step 1: 引导用户授权

在你的应用中添加"连接 vocnet"按钮，跳转到：

```
GET https://vocnet.apps.tftt.cc/oauth/authorize?
  client_id=YOUR_CLIENT_ID&
  redirect_uri=https://your-app.com/callback&
  scope=read:words,write:words&
  state=RANDOM_STRING&
  response_type=code
```

**参数说明**：

- `client_id`：你的应用 ID
- `redirect_uri`：授权后跳转的 URL（必须与注册时一致）
- `scope`：申请的权限，用逗号分隔
- `state`：随机字符串，防止 CSRF 攻击
- `response_type`：固定为 `code`

---

### Step 2: 用户授权

用户在 vocnet 授权页面：

1. 登录 vocnet 账号（如果未登录）
2. 查看你的应用申请的权限
3. 点击"授权"或"拒绝"

---

### Step 3: 接收授权码

用户授权后，vocnet 跳转到你的 `redirect_uri`：

```
https://your-app.com/callback?
  code=AUTHORIZATION_CODE&
  state=RANDOM_STRING
```

**你需要**：

1. 验证 `state` 与发起时一致（防 CSRF）
2. 提取 `code`（授权码，有效期 10 分钟）

---

### Step 4: 换取 Access Token

在你的**后端**调用：

```bash
POST https://vocnet.apps.tftt.cc/oauth/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "AUTHORIZATION_CODE",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET",
  "redirect_uri": "https://your-app.com/callback"
}
```

**响应**：

```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "refresh_xxx",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "read:words,write:words"
}
```

**存储 Token**：

- `access_token`：用于调用 API（有效期 1 小时）
- `refresh_token`：用于刷新 token（有效期 30 天）

---

### Step 5: 调用 API

在请求头中携带 `access_token`：

```bash
GET https://api.vocnet.com/v1/learning/learned-words
Authorization: Bearer eyJhbGc...
```

vocnet 会：

1. 验证 token 有效性
2. 提取 `user_id`
3. 返回该用户的数据

---

### Step 6: 刷新 Token

`access_token` 过期后（1 小时），用 `refresh_token` 刷新：

```bash
POST https://vocnet.apps.tftt.cc/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "refresh_xxx",
  "client_id": "YOUR_CLIENT_ID",
  "client_secret": "YOUR_CLIENT_SECRET"
}
```

**响应**：新的 `access_token` 和 `refresh_token`。

---

## 代码示例

### JavaScript (Node.js)

```javascript
const express = require("express");
const axios = require("axios");

const app = express();

const CLIENT_ID = "your_client_id";
const CLIENT_SECRET = "your_client_secret";
const REDIRECT_URI = "http://localhost:3000/callback";

// Step 1: 引导用户授权
app.get("/login", (req, res) => {
  const state = Math.random().toString(36);
  const authUrl =
    `https://vocnet.apps.tftt.cc/oauth/authorize?` +
    `client_id=${CLIENT_ID}&` +
    `redirect_uri=${REDIRECT_URI}&` +
    `scope=read:words,write:words&` +
    `state=${state}&` +
    `response_type=code`;

  res.redirect(authUrl);
});

// Step 3 & 4: 接收授权码并换取 token
app.get("/callback", async (req, res) => {
  const { code, state } = req.query;

  // 验证 state（实际应用中需要存储并验证）

  try {
    // 换取 access_token
    const response = await axios.post("https://vocnet.apps.tftt.cc/oauth/token", {
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    const { access_token, refresh_token } = response.data;

    // 存储 token（实际应用中应存到数据库）
    req.session.access_token = access_token;
    req.session.refresh_token = refresh_token;

    res.send("授权成功！");
  } catch (error) {
    res.status(500).send("授权失败");
  }
});

// Step 5: 调用 API
app.get("/my-words", async (req, res) => {
  const { access_token } = req.session;

  try {
    const response = await axios.get(
      "https://api.vocnet.com/v1/learning/learned-words",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    res.json(response.data);
  } catch (error) {
    res.status(500).send("获取数据失败");
  }
});

app.listen(3000);
```

---

## 最佳实践

### 安全性

1. **保护 client_secret**：

   - ✅ 只在后端使用
   - ❌ 不要暴露在前端代码或 Git 中

2. **验证 state 参数**：

   - 防止 CSRF 攻击
   - 使用随机字符串并验证一致性

3. **HTTPS only**：

   - 生产环境必须使用 HTTPS
   - redirect_uri 必须是 HTTPS

4. **Token 存储**：
   - 后端：存数据库（加密）
   - 前端：存 httpOnly cookie（不要用 localStorage）

---

### 用户体验

1. **授权说明**：

   - 在跳转前告知用户"为什么需要连接 vocnet"
   - 示例："连接 vocnet 以同步你的学习进度"

2. **撤销授权**：

   - 提供"断开 vocnet"功能
   - 调用 `/oauth/revoke` API

3. **Token 过期处理**：
   - 自动刷新 token
   - 失败时提示用户重新授权

---

## 常见问题

### Q: 如何测试 OAuth 流程？

A: 在本地开发时：

- 使用 `http://localhost:3000/callback` 作为 redirect_uri
- vocnet 会允许 localhost（仅开发环境）

### Q: Token 过期了怎么办？

A: 使用 `refresh_token` 刷新（见 Step 6）

### Q: 用户如何撤销授权？

A: 用户可以在 vocnet 账号设置中撤销授权，或你的应用调用：

```bash
POST https://vocnet.apps.tftt.cc/oauth/revoke
Authorization: Bearer ACCESS_TOKEN
```

### Q: 支持 PKCE 吗？

A: 计划支持（用于移动端和 SPA）。

---

## 下一步

- [API 参考](../api/overview.md) — 查看可用 API
- [使用案例](../ecosystem/use-cases.md) — 集成示例
- [开发者指南](../developers/integration-guide.md) — 完整开发文档

---

## 需要帮助？

- 技术问题：[GitHub Issues](https://github.com/eslsoft/vocnet/issues)
- 申请应用：[GitHub Issue (OAuth Application)](https://github.com/eslsoft/vocnet/issues/new?template=oauth-app.md)
