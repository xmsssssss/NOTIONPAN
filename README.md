# NotionPan

用 Notion 当网盘：上传、下载、预览、文件夹、分享，带登录和后台。

适合 **自托管 / 单人使用**。

技术：Next.js · Notion API · 本地索引 · Docker

---

## 目录

1. [快速开始](#快速开始)
2. [Notion 配置](#notion-配置)
3. [日常使用](#日常使用)
4. [部署](#部署)
5. [数据与安全](#数据与安全)
6. [限制说明](#限制说明)

---

## 快速开始

### 方式一：Docker（推荐）

```bash
cp .env.example .env
# 编辑 .env，至少改掉 SESSION_SECRET

docker compose up -d --build
```

浏览器打开：`http://服务器IP:3000`

```bash
docker compose logs -f   # 日志
docker compose down      # 停止
```

### 方式二：源码

```bash
npm install
cp .env.example .env.local   # Windows: copy .env.example .env.local
npm run dev                  # 开发 http://localhost:3000
```

生产：

```bash
npm run build
# 设置 SESSION_SECRET、COOKIE_SECURE 后
npm start
```

### 第一次打开网页

1. 设置管理员账号 / 密码  
2. 登录  
3. 按引导填写 Notion 的 API Key 和 Database ID（也可写在 `.env` 里）  
4. 进入网盘  

---

## Notion 配置

### 1. API Key

1. 打开 https://app.notion.com/developers  
2. 左侧 **连接** → 右侧 **+ 新连接**  
3. 填名称、选工作空间 → 创建  
4. 复制访问令牌（`ntn_` 开头）→ `NOTION_API_KEY`

### 2. 数据库

新建数据库，属性名必须如下：

| 属性名 | 类型 |
|--------|------|
| Name | Title |
| Folder | Text |
| Size | Number |
| MIME | Text |
| Type | Select：`image` / `video` / `audio` / `pdf` / `file` |
| File | Files & media |

数据库页 **··· → 集成**，把上面的连接 **添加到页面**。

### 3. Database ID

地址栏示例：

```text
https://app.notion.com/p/【这里约32位】?v=后面不要
```

中间那串 → `NOTION_DATABASE_ID`。

### 4. 环境变量

| 变量 | 说明 |
|------|------|
| `NOTION_API_KEY` | 访问令牌 |
| `NOTION_DATABASE_ID` | 数据库 ID |
| `NOTION_DATA_SOURCE_ID` | 可选，一般留空 |
| `SESSION_SECRET` | **生产必改**，≥32 位随机串 |
| `COOKIE_SECURE` | 纯 HTTP 用 `0`；HTTPS 用 `1` |
| `PORT` | Docker 映射端口，默认 `3000` |

可写在 `.env` / `.env.local`，或登录后在 **后台 → 环境变量** 里改。

---

## 日常使用

### 网盘

- **列表 / 画廊** 切换  
- **桌面**：右键文件  
- **手机**：长按文件，或点 **⋯**  
- **右下角 +**：新建、上传、刷新、后台、退出  
- 上传后右下角可看进度  

### 分享

右键/长按文件 → **分享** → 可选密码、有效期 → 得到链接：

```text
http://你的地址/s/xxxx
```

访客不用登录。分享下载走服务器反代。

### 后台

| 页 | 做什么 |
|----|--------|
| 网站信息 | 标题、描述 |
| 账号密码 | 改登录账号 |
| 环境变量 | Notion / Session |
| 索引同步 | 看状态、全量同步 |
| 备份恢复 | 导入导出 |

手机端点顶部 **「‹ 网盘」** 回主页。

### 上传 / 下载（简要）

- **上传**：浏览器 → 本服务 → Notion（密钥只在服务器）  
- **自己下载**：默认跳转到 Notion 临时链接  
- **分享下载**：服务器代下，不暴露 Notion 链接  

---

## 部署

### Docker（推荐）

```bash
cp .env.example .env
# 改 SESSION_SECRET

docker compose up -d --build
```

数据卷 `notionpan-data` 挂在容器 `/app/data`，包含账号、索引、分享、缩略图。

挂到当前目录也可以，改 `docker-compose.yml`：

```yaml
volumes:
  - ./data:/app/data
```

不用 Compose：

```bash
docker build -t notionpan .
docker run -d --name notionpan -p 3000:3000 \
  -e SESSION_SECRET='至少32位随机串' \
  -e COOKIE_SECURE=0 \
  -e DOCKER=1 \
  -e DATA_DIR=/app/data \
  -v notionpan-data:/app/data \
  --restart unless-stopped \
  notionpan
```

### 源码生产

```bash
npm run build
export SESSION_SECRET='至少32位随机串'   # Windows 用 set
export COOKIE_SECURE=0
npm start
```

### HTTPS 反代（可选）

Nginx 把域名转到 `127.0.0.1:3000` 后，设 `COOKIE_SECURE=1` 并重启。

---

## 数据与安全

### 本地文件（勿提交 Git）

| 路径 | 内容 |
|------|------|
| `data/app-config.json` | 账号 |
| `data/index.sqlite` 或 `index.json` | 文件索引 |
| `data/shares.json` | 分享 |
| `data/thumbs/` | 缩略图 |
| `.env` / `.env.local` | 密钥 |

### 务必注意

1. **生产必须设置强 `SESSION_SECRET`**  
2. **备份 JSON 含密钥**，不要外传  
3. 分享密码强度有限，敏感文件慎用  
4. 公网建议 HTTPS  
5. 完成首次注册前，别把端口裸奔到公网  

---

## 限制说明

- Notion 免费单文件约 5MB，付费更大  
- 删除是归档，不是物理抹掉  
- 文件夹是 `Folder` 字段路径，不是 Notion 原生目录  
- 列表优先读本地索引；Notion 里手改后需点 **刷新索引**  
- 单机单容器最合适，多实例索引不会自动同步  

---

## 相关文件

```text
Dockerfile
docker-compose.yml
.env.example
src/          源码
data/         运行数据（自动生成）
```

---

## License

Private / 按需使用。
