# NotionPan

把 **Notion 数据库** 当成个人网盘：上传、下载、预览、虚拟文件夹、对外分享，带登录与后台。

**技术栈**：Next.js · Notion API（File Upload + Database）· 本地索引（`node:sqlite` / JSON 回退）· iron-session · Tailwind CSS

> 定位：**自托管 / 单管理员**。内网或可信环境使用最合适；公网部署请务必阅读 [安全提示](#安全提示)。

---

## 功能一览

| 能力 | 说明 |
|------|------|
| 登录 | 首次自行设置账号密码；Cookie 会话 |
| 上传 | **服务端上传**到 Notion（`NOTION_API_KEY` 不离开服务器）；大文件自动分片 |
| 下载 | 登录态默认 **302** 到 Notion 签名 URL；分享链路 **全程反代** |
| 列表 / 搜索 / 虚拟文件夹 | `Folder` 文本路径 |
| 预览 | 图片、视频、音频、PDF、文本 |
| 画廊 | 仅加载缩略图，点开再拉原图 |
| 右键 / 长按菜单 | 预览、下载、分享、重命名、移动、删除 |
| 对外分享 | 公开链接 `/s/:token`，可选密码 / 过期，可撤销 |
| 右下角 FAB | 新建 / 上传 / 刷新索引 / 后台 / 退出 |
| 上传列表 | 多文件进度与状态 |
| 本地索引 | sqlite 优先，否则 JSON；加速列表 |
| 后台 | 网站信息、账号、env 软加载、索引同步、备份导入导出 |
| 移动端 | 固定视口 + 列表内滚动、底部操作表、后台 Tab 适配 |

---

## 快速开始

### 1. 环境要求

- **Node.js**：建议 20+；若要用内置 SQLite 索引，建议 **≥ 22.5**（支持 `node:sqlite`）
- npm

### 2. 安装与开发

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)  
（默认监听 `0.0.0.0:3000`，局域网可用 `http://你的内网IP:3000`）

### 3. 首次使用流程

1. **设置管理员账号**（用户名、密码、网站标题）→ 写入 `data/app-config.json`
2. **登录**
3. 若没有 Notion 配置 → **引导页**填写 API Key 与 Database ID（也可在后台「环境变量」配置）
4. 进入网盘；首次列表会从 Notion 同步到本地索引

也可预先写好 `.env.local`（参考 `.env.example`）：

```bash
# Windows
copy .env.example .env.local

# macOS / Linux
cp .env.example .env.local
```

---

## Notion 配置

### A. 获取 `NOTION_API_KEY`

1. 打开 [https://app.notion.com/developers](https://app.notion.com/developers)
2. 左侧 **「连接」**（Connections）
3. 右侧 **「+ 新连接」**（New connection）
4. 填写连接名称，选择访问令牌与工作空间
5. 创建连接
6. 打开该连接，复制 **访问令牌**（`ntn_` 开头）

### B. 创建数据库并授权

1. 新建私人页面 → 添加 **数据库**
2. 属性（名称必须一致）：

| 属性名 | 类型 |
|--------|------|
| **Name** | Title |
| **Folder** | Text |
| **Size** | Number |
| **MIME** | Text |
| **Type** | Select：`image` / `video` / `audio` / `pdf` / `file` |
| **File** | Files & media |

> 可在 Notion 用 AI，把上表发给它生成结构。

3. 数据库页右上角 **···** → **集成 / Integrations**
4. 添加你创建的连接 → **添加到页面**

### C. 获取 `NOTION_DATABASE_ID`

数据库页地址示例：

```text
https://app.notion.com/p/xxxxxxxxxxxxxxxxxxxx?v=39d72c34808b844f00
                         ↑
              约 32 位 = NOTION_DATABASE_ID
```

**不要**使用 `?v=` 后面的视图 ID。

### D. 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `NOTION_API_KEY` | 是 | 访问令牌 |
| `NOTION_DATABASE_ID` | 是 | 数据库 ID |
| `NOTION_DATA_SOURCE_ID` | 否 | 新版 data source，可留空自动探测 |
| `SESSION_SECRET` | **强烈建议** | ≥32 字符，会话加密；生产务必设置 |
| `COOKIE_SECURE` | 视部署 | 默认按 HTTP 可用；有 HTTPS 时设 `1` |

可写在 `.env.local`，或登录后在 **后台 → 环境变量** 保存（**软加载**，一般无需重启进程；多进程部署见下文）。

---

## 使用说明

### 网盘页

- **列表 / 画廊** 切换（偏好保存在 localStorage）
- **桌面**：右键菜单
- **手机**：长按或点 **⋯** 打开底部操作表；列表区域内部滚动
- **右下角 +**：新建文件夹、上传、刷新索引、后台、退出
- **上传列表**：右下角面板显示多文件进度

### 分享

1. 右键 / 长按文件 → **分享**
2. 可选：访问密码、有效期
3. 生成链接：`http(s)://你的域名或IP/s/<token>`
4. 可复制、撤销；可查看访问次数

访客打开链接无需登录；分享下载/预览经服务器反代，不暴露 Notion 原始签名 URL。

### 后台

| 分页 | 功能 |
|------|------|
| 网站信息 | 标题、描述 |
| 账号密码 | 改用户名/密码（需当前密码） |
| 环境变量 | Notion / Session，保存即软加载 |
| 索引同步 | 查看后端（sqlite/json）、全量同步 |
| 备份恢复 | 导出/导入 JSON |

移动端：顶部 **「‹ 网盘」** 返回主页。

---

## 上传 / 下载链路

### 上传（仅服务端）

```text
浏览器 ──POST /api/files（需登录）──► 本服务
                                      │
                                      ├─ Notion file_uploads create/send/complete
                                      └─ 创建数据库页 + 写本地索引
```

- **`NOTION_API_KEY` 不会下发到浏览器**
- 进度条：浏览器 → 本服务
- 大文件：服务端 multi-part 分片

### 下载

| 场景 | 方式 |
|------|------|
| 登录后下载 / 预览媒体 | 默认 **302** 到 Notion 签名 URL（省本机带宽） |
| 登录后文本预览 | `?proxy=1` 反代读正文（避免跨域） |
| 分享页下载 / 预览 | **全程反代**（校验 token / 密码后由服务器拉流） |

---

## 本地数据目录

| 路径 | 内容 |
|------|------|
| `data/app-config.json` | 账号哈希、站点标题 |
| `data/index.sqlite` | 文件索引（有 `node:sqlite` 时） |
| `data/index.json` | 回退索引（无内置 sqlite 时） |
| `data/shares.json` | 对外分享记录 |
| `data/thumbs/` | 图片缩略图缓存 |
| `.env.local` | 密钥与 Notion 配置 |

均已在 `.gitignore` 中忽略，**不要提交到 Git**。

### 本地索引策略

| 时机 | 行为 |
|------|------|
| 本地已有索引 | 直接读缓存（进程重启也一样） |
| 索引为空 | 从 Notion 全量同步 |
| 刷新索引 / `POST /api/sync` | 强制全量同步 |
| 上传 / 建夹 / 重命名 / 移动 / 删除 | 增量更新索引 |

后台可查看当前后端是 `sqlite` 还是 `json`。

**备份与索引：** 导出时索引以 JSON 形式写入备份文件；导入后按当前环境写回 sqlite 或 json。旧版 sqlite 二进制备份仅落盘为 `index.sqlite.legacy`，不会自动当作当前索引。导入后建议再点一次 **全量同步**。

---

## 开发与生产

### 源码部署

```bash
# 开发（0.0.0.0:3000）
npm run dev

# 构建
npm run build

# 生产（0.0.0.0:3000）
npm start
```

```bash
# Windows 示例（纯 HTTP / 公网 IP）
set SESSION_SECRET=请换成至少32位的随机字符串
set COOKIE_SECURE=0
npm start

# Linux 示例
export SESSION_SECRET='请换成至少32位的随机字符串'
export COOKIE_SECURE=0
npm start
```

### Docker 部署（推荐）

项目提供 `Dockerfile` + `docker-compose.yml`（Next.js `standalone` + Node 22）。

#### 1. 准备环境变量

```bash
cp .env.example .env
# 编辑 .env，至少修改 SESSION_SECRET
# Notion 可先不填，启动后在网页引导/后台配置
```

`.env` 示例（Compose 会读取）：

```env
SESSION_SECRET=请换成至少32位的随机字符串
COOKIE_SECURE=0
PORT=3000
# 可选：
# NOTION_API_KEY=ntn_xxx
# NOTION_DATABASE_ID=xxx
```

#### 2. 构建并启动

```bash
docker compose up -d --build
```

浏览器访问：`http://服务器IP:3000`

#### 3. 常用命令

```bash
# 查看日志
docker compose logs -f

# 停止
docker compose down

# 停止并删除数据卷（会清空账号/索引/分享，慎用）
docker compose down -v

# 仅重建镜像
docker compose build --no-cache
docker compose up -d
```

#### 4. 数据持久化

| 容器路径 | Compose 卷 | 内容 |
|----------|------------|------|
| `/app/data` | `notionpan-data` | 账号、索引、分享、缩略图、后台保存的 `data/.env.local` |

容器内 `DOCKER=1`、`DATA_DIR=/app/data`：网页后台保存的环境变量写入 **volume**，重建容器不丢。

也可挂载到宿主机目录：

```yaml
# docker-compose.yml 中 volumes 改为：
volumes:
  - ./data:/app/data
```

#### 5. 仅用 Docker 命令（不用 Compose）

```bash
docker build -t notionpan:latest .
docker run -d --name notionpan \
  -p 3000:3000 \
  -e SESSION_SECRET='至少32位随机串' \
  -e COOKIE_SECURE=0 \
  -e DOCKER=1 \
  -e DATA_DIR=/app/data \
  -v notionpan-data:/app/data \
  --restart unless-stopped \
  notionpan:latest
```

#### 6. 反向代理（可选）

Nginx 反代 HTTPS 时示例：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 100m;
}
```

反代启用 HTTPS 后，将环境变量改为 `COOKIE_SECURE=1` 并重建/重启容器。

| 项 | 说明 |
|----|------|
| 不要用 `npm run dev` 对外 | 公网请用 `build` + `start` 或 Docker |
| 防火墙 | 放行 3000（或 `PORT`） |
| `SESSION_SECRET` | **生产务必设置** |
| `COOKIE_SECURE=0` | 无 HTTPS、用 `http://IP` 时 |
| 多进程 / 多机 | 索引与 shares 为单实例文件模型；Compose 默认单容器即可 |
| 镜像 Node | 22（支持 `node:sqlite`） |

局域网开发若 HMR WebSocket 报错，可在 `next.config.ts` 的 `allowedDevOrigins` 中加入你的 IP（仅影响开发热更新）。

---

## API 摘要

### 公开

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 登录 / 配置状态 |
| POST | `/api/auth/setup` | 首次设账号 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET/POST | `/api/s/:token` | 分享信息 / 密码解锁 |
| GET | `/api/s/:token/download` | 分享下载/预览（反代） |

公开页面：`/s/:token`

### 需登录（Cookie）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/files` | 列表 / 上传 |
| GET/PATCH/DELETE | `/api/files/:id` | 详情 / 重命名·移动 / 删除 |
| GET | `/api/files/:id/download` | 下载（默认 302） |
| GET | `/api/files/:id/thumb` | 缩略图 |
| GET/POST | `/api/folders` | 文件夹列表 / 创建 |
| GET/POST | `/api/sync` | 索引状态 / 全量同步 |
| GET | `/api/health` | 健康检查 |
| GET/PUT | `/api/admin/settings` | 后台设置 |
| POST | `/api/admin/env/reload` | 软加载 env |
| GET | `/api/admin/backup/export` | 导出备份 |
| POST | `/api/admin/backup/import` | 导入备份 |
| GET/POST | `/api/share` | 列出/创建分享 |
| DELETE | `/api/share/:token` | 撤销分享 |

---

## Notion 侧限制

- 免费空间单文件约 **5 MiB**；付费最高约 **5 GiB**
- API：≤20MB single-part，更大 multi-part
- 上传后约 1 小时内需挂到页面，否则 file_upload 可能过期
- 删除为 **归档** 页面，并非物理抹除文件二进制
- 「文件夹」是 `Folder` 文本路径，不是 Notion 原生目录

---

## 安全提示

适用于自托管场景，请务必注意：

1. **`SESSION_SECRET`**：生产环境必须设成长随机串（≥32）。未设置时代码有开发用默认值，存在伪造登录 Cookie 的风险。
2. **备份文件**：导出 JSON 可能含 `NOTION_API_KEY`、`SESSION_SECRET`、密码哈希，**等同于整站密钥**，勿外传、勿入库。
3. **分享密码**：当前解锁 Cookie 为简单标记实现，**不能当作高强度访问控制**；敏感文件请勿仅依赖分享密码。
4. **HTTPS**：公网建议上证书；HTTP 下 Cookie 可被中间人窃听。
5. **首次初始化**：完成 setup 前若端口已对公网开放，他人可能抢先注册管理员。
6. **勿提交**：`.env.local`、`data/`、备份 JSON。

更稳妥的公网实践：内网使用 + 反代 HTTPS + 强 `SESSION_SECRET` + 限制来源 IP。

---

## 项目结构（简要）

```text
src/
  app/                 # Next.js App Router 页面与 API
  components/          # 网盘 UI、登录、后台、预览、分享页
  lib/                 # Notion、索引、会话、分享、备份、env
data/                  # 运行时数据（gitignore）
.env.example           # 环境变量模板
Dockerfile             # 多阶段构建（standalone）
docker-compose.yml     # 一键部署
.dockerignore
```

---

## License

Private / 按需使用。
