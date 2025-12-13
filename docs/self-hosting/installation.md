# 自建部署指南

本指南帮助你在自己的服务器上部署 Vocnet 实例，适用于个人、团队或企业私有化部署。

---

## 前置要求

在开始之前，确保你的系统满足以下要求：

### 硬件要求

| 配置项 | 最低要求 | 推荐配置 |
|--------|---------|---------|
| CPU | 1 核 | 2 核+ |
| 内存 | 512 MB | 2 GB+ |
| 硬盘 | 1 GB | 10 GB+ |
| 网络 | 1 Mbps | 100 Mbps+ |

### 软件要求

- **操作系统** - Linux (Ubuntu 20.04+, CentOS 7+) / macOS
- **Go** - 1.23 或更高版本
- **数据库** - SQLite 3（默认）或 PostgreSQL 13+
- **Protocol Buffers** - protoc 编译器（用于生成代码）
- **Make** - 构建工具

!!! tip "推荐环境"
    - **开发/测试**: SQLite（零配置，开箱即用）
    - **生产部署**: PostgreSQL（性能更好，支持并发）

---

## 快速安装（开发/测试）

### 1. 克隆仓库

```bash
git clone https://github.com/eslsoft/vocnet.git
cd vocnet
```

### 2. 安装依赖

使用 Make 一键安装所有依赖：

```bash
make setup
```

这个命令会自动：

- 安装 buf（Protocol Buffers 工具）
- 安装 mockgen（生成测试 mock）
- 下载 Go 模块依赖
- 生成 protobuf 和 ent 代码

!!! note "手动安装依赖"
    如果 `make setup` 失败，可以手动安装：

    ```bash
    # 安装 buf
    go install github.com/bufbuild/buf/cmd/buf@latest

    # 安装 mockgen
    go install github.com/golang/mock/mockgen@latest

    # 下载 Go 依赖
    go mod download

    # 生成代码
    make generate
    ```

### 3. 初始化数据库

#### 使用 SQLite（默认）

零配置，直接运行迁移：

```bash
make migrate
```

这会在当前目录生成 `vocnet.db` 文件。

#### 使用 PostgreSQL（可选）

如果你想使用 PostgreSQL，需要先启动数据库：

```bash
# 使用 Docker 快速启动 PostgreSQL
make db-up
```

然后指定数据库连接字符串并运行迁移：

```bash
DB_DSN="postgres://postgres:postgres@localhost:5432/vocnet?sslmode=disable" make migrate
```

!!! warning "连接字符串格式"
    PostgreSQL 连接字符串格式：

    ```
    postgres://用户名:密码@主机:端口/数据库名?sslmode=disable
    ```

### 4. 启动服务

```bash
make run
```

服务将启动在：

- **HTTP/gRPC**: `localhost:8080`
- **gRPC-Web**: `localhost:8080` (同一端口，ConnectRPC 协议)

!!! success "测试服务"
    访问 http://localhost:8080 查看服务状态。

### 5. 验证安装

测试 API 是否正常工作：

```bash
# 健康检查
curl http://localhost:8080/health

# 调用 API（需要认证 Token）
curl http://localhost:8080/api/v1/learning/learned-words \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

---

## 生产部署

### 方式一：Docker 部署（推荐）

#### 1. 构建 Docker 镜像

```bash
docker build -t vocnet:latest .
```

#### 2. 使用 Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: vocnet
      POSTGRES_USER: vocnet
      POSTGRES_PASSWORD: your_secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  vocnet:
    image: vocnet:latest
    ports:
      - "8080:8080"
    environment:
      DB_DSN: "postgres://vocnet:your_secure_password@postgres:5432/vocnet?sslmode=disable"
      JWKS_URL: "https://your-auth-provider.com/jwks"
      LOG_LEVEL: "info"
    depends_on:
      - postgres
    restart: unless-stopped

volumes:
  postgres_data:
```

#### 3. 启动服务

```bash
docker-compose up -d
```

#### 4. 查看日志

```bash
docker-compose logs -f vocnet
```

### 方式二：systemd 服务

#### 1. 编译二进制文件

```bash
make build
```

这会在 `bin/` 目录生成 `vocnet` 可执行文件。

#### 2. 创建 systemd 服务文件

创建 `/etc/systemd/system/vocnet.service`：

```ini
[Unit]
Description=Vocnet Vocabulary Management Platform
After=network.target postgresql.service

[Service]
Type=simple
User=vocnet
Group=vocnet
WorkingDirectory=/opt/vocnet
ExecStart=/opt/vocnet/bin/vocnet serve
Environment="DB_DSN=postgres://vocnet:password@localhost:5432/vocnet?sslmode=disable"
Environment="LOG_LEVEL=info"
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 3. 启动服务

```bash
# 创建用户
sudo useradd -r -s /bin/false vocnet

# 复制文件到生产目录
sudo cp -r bin /opt/vocnet/
sudo chown -R vocnet:vocnet /opt/vocnet

# 重载 systemd 配置
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start vocnet

# 开机自启
sudo systemctl enable vocnet

# 查看状态
sudo systemctl status vocnet
```

### 方式三：Nginx 反向代理

#### 1. 安装 Nginx

```bash
sudo apt install nginx  # Ubuntu/Debian
sudo yum install nginx  # CentOS/RHEL
```

#### 2. 配置 Nginx

创建 `/etc/nginx/sites-available/vocnet`：

```nginx
upstream vocnet_backend {
    server 127.0.0.1:8080;
}

server {
    listen 80;
    server_name vocnet.yourdomain.com;

    # HTTPS 重定向
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vocnet.yourdomain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/vocnet.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vocnet.yourdomain.com/privkey.pem;

    # SSL 配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # gRPC/HTTP2 支持
    location / {
        grpc_pass grpc://vocnet_backend;

        # 如果使用 HTTP/1.1
        # proxy_pass http://vocnet_backend;
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 日志
    access_log /var/log/nginx/vocnet-access.log;
    error_log /var/log/nginx/vocnet-error.log;
}
```

#### 3. 启用配置并重启

```bash
sudo ln -s /etc/nginx/sites-available/vocnet /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 4. 申请 SSL 证书（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d vocnet.yourdomain.com
```

---

## 配置说明

Vocnet 通过环境变量进行配置。你可以：

1. 创建 `.env` 文件
2. 在 Docker Compose 中设置
3. 在 systemd 服务文件中设置

### 核心配置

| 环境变量 | 说明 | 默认值 | 示例 |
|---------|------|--------|------|
| `DB_DSN` | 数据库连接字符串 | `vocnet.db`（SQLite） | `postgres://...` |
| `JWKS_URL` | JWT 密钥集 URL（Supabase 等） | - | `https://xxx.supabase.co/auth/v1/jwks` |
| `LOG_LEVEL` | 日志级别 | `info` | `debug`, `info`, `warn`, `error` |
| `PORT` | 服务端口 | `8080` | `8080` |

详细配置选项：[配置说明](configuration.md)

---

## 数据备份

### SQLite 备份

```bash
# 备份数据库文件
cp vocnet.db vocnet.db.backup

# 或使用 SQLite 命令
sqlite3 vocnet.db ".backup vocnet.db.backup"
```

### PostgreSQL 备份

```bash
# 导出数据
pg_dump -U vocnet vocnet > vocnet_backup.sql

# 恢复数据
psql -U vocnet vocnet < vocnet_backup.sql
```

!!! tip "自动备份"
    建议设置定时任务（cron）每天自动备份：

    ```bash
    # 添加到 crontab
    0 2 * * * /opt/vocnet/scripts/backup.sh
    ```

---

## 升级指南

### 1. 备份数据

在升级前务必备份数据库！

### 2. 拉取最新代码

```bash
git pull origin main
```

### 3. 更新依赖

```bash
make setup
```

### 4. 运行数据库迁移

```bash
make migrate
```

### 5. 重启服务

```bash
# Docker
docker-compose restart vocnet

# systemd
sudo systemctl restart vocnet
```

详细迁移指南：[数据迁移](migration.md)

---

## 常见问题

### 端口被占用

如果 8080 端口被占用，可以修改：

```bash
# 使用环境变量
PORT=9090 make run

# 或修改 .env 文件
echo "PORT=9090" >> .env
```

### 数据库连接失败

检查连接字符串是否正确：

```bash
# 测试 PostgreSQL 连接
psql "postgres://vocnet:password@localhost:5432/vocnet"
```

### 性能优化

生产环境建议：

- 使用 PostgreSQL 而非 SQLite
- 启用数据库连接池
- 配置适当的日志级别（`info` 或 `warn`）
- 使用 CDN 加速静态资源

---

## 下一步

!!! tip "配置和管理"
    - [配置说明](configuration.md) - 了解所有配置选项
    - [数据迁移](migration.md) - 版本升级和数据迁移
    - [监控和日志](../developers/technical-overview.md) - 生产环境监控

!!! question "需要帮助？"
    - [常见问题 (FAQ)](../faq.md)
    - [GitHub Issues](https://github.com/eslsoft/vocnet/issues)
    - [社区讨论](https://github.com/eslsoft/vocnet/discussions)

---

**祝你部署顺利！** 🚀
