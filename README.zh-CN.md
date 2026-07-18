# NotionPan

自托管网盘：文件存在 **Notion**，界面在浏览器。

[English](./README.md) · [中文](./README.zh-CN.md)

```
浏览器界面  ──►  NotionPan  ──►  Notion 数据库
 （网盘）         （自托管）       （你的文件）
```

单人使用 · Docker 一键部署 · 除 Notion 外无需第三方云存储

---

## 目录

- [功能](#功能)
- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [Notion 配置](#notion-配置)
- [环境变量](#环境变量)
- [日常使用](#日常使用)
- [Webhook](#webhook可选)
- [部署](#部署)
- [目录结构](#目录结构)
- [使用规范](#使用规范)
- [限制](#限制)
- [License](#license)

---

## 功能

| 模块 | 能力 |
|:---|:---|
| **网盘** | 文件夹 · 列表 / 画廊 · 搜索 · 重命名 · 移动 · 删除 |
| **上传** | 拖拽 · 多文件队列 · 进度 · 同名同大小跳过 |
| **导入** | 从公网 HTTPS 链接拉取文件 |
| **预览** | 图片 · 视频 · 音频 · PDF · 文本 · 字幕 · 歌词 |
| **分享** | 密码 · 有效期 · 预览 / 下载开关 · 访客免登录（`/s/<token>`） |
| **后台** | 站点设置 · 账号 · 环境变量 · 索引同步 · Schema 修复 · 备份 |
| **索引** | 本地 SQLite（Node 22）/ JSON 回退 · 可选 Notion Webhook |
| **部署** | Docker Compose 一键 · 数据卷持久化 |

**技术栈** — Next.js 16 · React 19 · Tailwind CSS 4 · Notion API · Sharp · iron-session · Node 22

---

## 工作原理

1. 文件上传到 Notion 数据库（Files & media 属性）。
2. NotionPan 维护**本地索引**（SQLite / JSON），用于快速列表与搜索。
3. 账号、分享、站点配置、运行时环境变量保存在 `DATA_DIR`（默认 `./data`）。
4. 登录用户下载会 302 到 Notion 临时链接；分享下载由本服务反代，不暴露 Notion 地址。

---

## 快速开始

<details open>
<summary><b>Docker</b> — 推荐</summary>

```bash
cp .env.example .env
# 上线前请修改 SESSION_SECRET

docker compose up -d --build
```

| | |
|:---|:---|
| 访问 | `http://localhost:3000` 或 `http://服务器IP:3000` |
| 日志 | `docker compose logs -f` |
| 停止 | `docker compose down` |

</details>

<details>
<summary><b>源码运行</b> — Node.js 22+</summary>

```bash
npm install
cp .env.example .env.local
npm run dev          # → http://localhost:3000
```

生产环境：

```bash
npm run build
SESSION_SECRET='你的长随机密钥' COOKIE_SECURE=0 npm start
```

</details>

### 首次打开

```
1  设置管理员账号
2  登录
3  连接 Notion（API Key · 数据库可自动创建）
4  开始使用
```

也可稍后在 **后台 → 环境变量** 中配置 Notion。

---

## Notion 配置

官方文档：[Notion Developers — 入门概览](https://developers.notion.com/guides/get-started/overview)

### 1. 集成令牌

1. 打开 [Notion 集成](https://www.notion.so/my-integrations)
2. 创建新集成
3. 复制密钥（`ntn_…`）→ `NOTION_API_KEY`

### 2. 数据库

| 方式 | 步骤 |
|:---|:---|
| **A · 自动创建** | 后台 → **索引同步** → 创建数据库 |
| **B · 手动创建** | 按下方 Schema 建库，再将集成加入连接（**⋯ → 连接**） |

**手动 Schema**

| 属性 | 类型 |
|:---|:---|
| `Name` | Title |
| `Folder` | Text |
| `Size` | Number |
| `MIME` | Text |
| `Type` | Select — `image` / `video` / `audio` / `pdf` / `file` |
| `File` | Files & media |

缺属性 → 后台 → **修复 Schema**。

### 3. Database ID

```
https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
                     └──────────── Database ID ────────────┘
```

---

## 环境变量

| 变量 | 必填 | 说明 |
|:---|:---:|:---|
| `SESSION_SECRET` | **生产** | 会话加密密钥 · ≥32 字符 |
| `COOKIE_SECURE` | | `0` = 允许 HTTP · `1` = 仅 HTTPS Cookie |
| `PORT` | | Compose 映射端口 · 默认 `3000` |
| `NOTION_API_KEY` | * | 集成令牌 · 也可网页配置 |
| `NOTION_DATABASE_ID` | * | 数据库 ID · 也可网页配置 / 自动创建 |
| `NOTION_DATA_SOURCE_ID` | | 一般留空 |
| `NOTION_WEBHOOK_TOKEN` | | Webhook 校验后自动写入 |
| `DATA_DIR` | | 数据目录 · 默认 `./data` · Docker `/app/data` |

\* 登录后在网页配置则可省略。

完整模板：[`.env.example`](.env.example)

后台保存的运行时环境变量会写入数据目录（便于 Docker 卷持久化）。

---

## 日常使用

| 操作 | 说明 |
|:---|:---|
| 右键菜单 | 右键 · 长按 · ⋯ |
| 右下角 `+` | 新建文件夹 · 上传 · 链接导入 · 刷新 · 后台 · 退出 |
| 分享 | 菜单 → 分享 → 密码 / 有效期 → `/s/<token>` |
| 后台 | `+` → 后台 |

**下载方式**

| 对象 | 行为 |
|:---|:---|
| 登录用户 | `302` → Notion 临时链接 |
| 分享访客 | 本服务反代 · 不暴露 Notion 地址 |

---

## Webhook（可选）

用于索引增量更新，并让链接导入更快完成。

需要公网 **HTTPS** 地址：

```
https://你的域名/api/webhooks/notion
```

**建议订阅**

```
file_upload.completed | upload_failed | expired
page.created | deleted | undeleted | properties_updated
```

首次校验会将 token 写入 `NOTION_WEBHOOK_TOKEN`。

未配置时，在 Notion 内手改文件后请点 **刷新索引**。

---

## 部署

| 项 | 说明 |
|:---|:---|
| 镜像 | 多阶段构建 · Next.js `standalone` · Node 22 |
| 数据卷 | `/app/data` · 命名卷 `notionpan-data` |
| 绑定目录 | 可选：`./data:/app/data` |
| HTTPS 反代 | 设置 `COOKIE_SECURE=1` 后重启 |
| 健康检查 | `GET /api/auth/status` · `GET /api/health` |

```yaml
# 可选：用本机目录替代命名卷
volumes:
  - ./data:/app/data
```

数据目录会持久化：管理员账号、站点配置、本地索引、分享记录、缩略图、运行时环境变量。

---

## 目录结构

```
src/
  app/           # App Router 页面与 API
  components/    # 网盘界面、后台、预览、分享
  lib/           # Notion、索引、鉴权、分享、备份
data/            # 运行时数据（已 gitignore）
Dockerfile
docker-compose.yml
.env.example
```

---

## 使用规范

面向 **个人 / 自托管**，请使用 **你自己的** Notion 工作区。

| 应当 | 禁止 |
|:---|:---|
| 遵守 [Notion 条款](https://www.notion.com/terms) 与 [API 说明](https://developers.notion.com/guides/get-started/overview) | 当作免费 CDN / 大规模网盘 / 商用存储滥用 |
| 妥善保管集成密钥 | 将密钥提交到公开仓库或外传 |
| 控制请求频率 | 批量爬取、刷上传、滥用 API |
| 仅存储有权托管的内容 | 托管恶意软件或违法内容 |
| | 绕过套餐限额、速率限制或安全机制 |
| | 转售 / 对外开放导致 Notion 或本服务过载 |

滥用可能导致 Notion 停用你的集成。部署与运营责任由使用者自行承担。

---

## 限制

| | |
|:---|:---|
| 文件大小 | 受 Notion 套餐限制 · 免费约 5 MB |
| 删除 | 归档到回收站 · 非物理删除 |
| 文件夹 | `Folder` 字段路径 · 非 Notion 原生目录 |
| 规模 | 单管理员 · 建议单实例 |
| 链接导入 | 仅公网 HTTPS · 且需 Notion 可访问 |

---

## License

MIT
