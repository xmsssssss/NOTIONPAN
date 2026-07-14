# NotionPan

把 **Notion 数据库** 当成个人网盘：上传、下载、预览、虚拟文件夹，带登录与后台。

**技术栈**：Next.js · Notion API（File Upload + Database）· SQLite 本地索引 · iron-session

---

## 功能一览

| 能力 | 说明 |
|------|------|
| 登录 | 首次自行设置账号密码；Cookie 会话 |
| 上传 / 下载 | 小文件直传，大文件自动分片 |
| 列表 / 搜索 / 虚拟文件夹 | `Folder` 文本路径 |
| 预览 | 图片、视频、音频、PDF、文本 |
| 画廊 | 仅加载缩略图，点开再拉原图 |
| 右键菜单 | 上传、新建夹、重命名、移动、删除 |
| 右下角 FAB | 新建 / 上传 / 刷新 / 后台 / 退出 |
| 本地索引 | SQLite 加速列表，变更时增量更新 |
| 后台 | 标题、账号、env 软加载、备份导入导出 |

---

## 快速开始

### 1. 安装与启动

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)

### 2. 首次使用流程

1. **设置管理员账号**（用户名、密码、网站标题）→ 存 `data/app-config.json`
2. **登录**
3. 若没有 Notion 配置 → 进入**引导页**填写 `API Key` 与 `Database ID`（也可在后台「环境变量」配置）
4. 进入网盘

也可预先创建 `.env.local`（参考 `.env.example`），则跳过引导直接用。

```bash
# Windows
copy .env.example .env.local

# macOS / Linux
cp .env.example .env.local
```

---

## Notion 配置详解

### A. 获取 `NOTION_API_KEY`（访问令牌）

1. 打开 [https://app.notion.com/developers](https://app.notion.com/developers)
2. 左侧点 **「连接」**（Connections）
3. 右侧点 **「+ 新连接」**（New connection）
4. 输入连接名称，选择访问令牌，选择工作空间
5. 创建连接
6. 打开该连接，复制 **访问令牌**（`ntn_` 开头）

### B. 创建数据库并为连接授权

1. 新建**私人页面** → 使用 **数据库**
2. 配置属性（名称必须一致）：

| 属性名 | 类型 |
|--------|------|
| **Name** | Title |
| **Folder** | Text |
| **Size** | Number |
| **MIME** | Text |
| **Type** | Select：`image` / `video` / `audio` / `pdf` / `file` |
| **File** | Files & media |

> 可在 Notion 里用 AI，把上表丢给它直接生成结构。

3. 数据库页右上角 **···** → **集成 / Integrations**  
4. 输入上面创建的**连接名称** → **添加到页面**

### C. 获取 `NOTION_DATABASE_ID`

打开数据库页，看地址栏，例如：

```text
https://app.notion.com/p/xxxxxxxxxxxxxxxxxxxx?v=39d72c34808b844f00
                         ↑
              这一段（约 32 位）= NOTION_DATABASE_ID
```

**不要**使用 `?v=` 后面的视图 ID。

### D. 环境变量一览

| 变量 | 必填 | 说明 |
|------|------|------|
| `NOTION_API_KEY` | 是 | 访问令牌 |
| `NOTION_DATABASE_ID` | 是 | 数据库 ID |
| `NOTION_DATA_SOURCE_ID` | 否 | 新版 API data source，可留空 |
| `SESSION_SECRET` | 建议生产配置 | ≥32 字符，会话加密 |

配置可写在 `.env.local`，或登录后在 **后台 → 环境变量** 保存（**软加载**，一般无需重启）。

---

## 使用说明

### 网盘页

- **列表 / 画廊** 切换（偏好记在浏览器 localStorage）
- **右键空白处**：上传、新建文件夹、刷新
- **右键文件**：预览、下载、重命名、移动、删除
- **右下角 + 菜单**：新建、上传、刷新索引、后台、退出

### 后台（左侧导航）

| 分页 | 功能 |
|------|------|
| 网站信息 | 标题、描述 |
| 账号密码 | 改用户名/密码（需当前密码） |
| 环境变量 | Notion / Session，保存即软加载 |
| 索引同步 | SQLite 状态、全量同步 Notion |
| 备份恢复 | 导出/导入 JSON（可含索引） |

---

## 本地数据目录

| 路径 | 内容 |
|------|------|
| `data/app-config.json` | 账号哈希、站点标题 |
| `data/index.sqlite` | 文件索引 |
| `data/thumbs/` | 图片缩略图缓存 |
| `.env.local` | 密钥与 Notion 配置 |

以上均已在 `.gitignore` 中忽略，**请勿提交到 Git**。

---

## 开发与生产

```bash
# 开发（本项目默认 webpack，兼容部分环境）
npm run dev

# 构建
npm run build

# 生产启动
npm start
```

建议生产环境设置足够长的 `SESSION_SECRET`，并用 HTTPS。

---

## API 摘要

公开：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/status` | 登录/配置状态 |
| POST | `/api/auth/setup` | 首次设账号 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |

需登录（Cookie）：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/files` | 列表 / 上传 |
| GET/PATCH/DELETE | `/api/files/:id` | 详情 / 重命名·移动 / 删除 |
| GET | `/api/files/:id/download` | 下载 |
| GET | `/api/files/:id/thumb` | 缩略图 |
| GET/POST | `/api/folders` | 文件夹列表 / 创建 |
| GET/POST | `/api/sync` | 索引状态 / 全量同步 |
| GET/PUT | `/api/admin/settings` | 后台设置 |
| POST | `/api/admin/env/reload` | 软加载 env |
| GET | `/api/admin/backup/export` | 导出备份 |
| POST | `/api/admin/backup/import` | 导入备份 |

---

## SQLite 索引策略

| 时机 | 行为 |
|------|------|
| 首次列表 / 索引为空 | 全量同步 Notion → SQLite |
| 上传、建夹、重命名、移动、删除 | 增量更新 |
| 刷新索引 / `?refresh=1` / `POST /api/sync` | 强制全量同步 |

下载与预览仍向 Notion 取签名 URL（约 1 小时过期）。

---

## Notion 侧限制

- 免费空间单文件约 **5 MiB**；付费最高约 **5 GiB**
- API：≤20MB single-part，更大 multi-part
- 上传后约 1 小时内需挂到页面，否则 file_upload 过期
- 删除为 **归档** 页面，并非物理抹除文件二进制
- 「文件夹」是 `Folder` 文本路径，不是 Notion 原生目录树

---

## 安全提示

- 不要把 `.env.local`、`data/`、备份 JSON 提交到公开仓库
- 备份文件可能含密钥与密码哈希，妥善保管
- 生产务必配置 `SESSION_SECRET` 并使用 HTTPS

---

## License

Private / 按需使用。
