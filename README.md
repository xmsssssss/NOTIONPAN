# NotionPan

Self-hosted file drive with storage on **Notion** and a browser-based UI.

[English](./README.md) · [中文](./README.zh-CN.md)

```
Browser UI  ──►  NotionPan  ──►  Notion Database
  (drive)        (self-host)      (your files)
```

Single-user · Docker-ready · No extra cloud beyond your Notion workspace

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Notion Setup](#notion-setup)
- [Configuration](#configuration)
- [Usage](#usage)
- [Webhooks](#webhooks-optional)
- [Deployment](#deployment)
- [Project Layout](#project-layout)
- [Acceptable Use](#acceptable-use)
- [Limitations](#limitations)
- [License](#license)

---

## Features

| Area | Capabilities |
|:---|:---|
| **Drive** | Folders, list / gallery views, search, rename, move, delete |
| **Upload** | Drag & drop, multi-file queue, progress, skip same-name + same-size |
| **Import** | Pull files from public HTTPS URLs |
| **Preview** | Image, video, audio, PDF, text, subtitles, lyrics |
| **Share** | Password, expiry, preview / download flags, guest access at `/s/<token>` |
| **Admin** | Site settings, credentials, env, index sync, schema repair, backup |
| **Index** | Local SQLite (Node 22) with JSON fallback · optional Notion webhooks |
| **Deploy** | Docker Compose one-command · persistent data volume |

**Stack** — Next.js 16 · React 19 · Tailwind CSS 4 · Notion API · Sharp · iron-session · Node 22

---

## How It Works

1. Files are uploaded to a Notion database (Files & media property).
2. NotionPan keeps a **local index** (SQLite / JSON) for fast listing and search.
3. Auth, shares, site config, and runtime env live under `DATA_DIR` (default `./data`).
4. Logged-in downloads redirect to Notion temporary URLs; share downloads are proxied so Notion URLs stay private.

---

## Quick Start

<details open>
<summary><b>Docker</b> — recommended</summary>

```bash
git clone https://github.com/xmsssssss/NOTIONPAN.git
cd NOTIONPAN
cp .env.example .env
# change SESSION_SECRET before exposing the service

docker compose up -d --build
```

| | |
|:---|:---|
| Open | `http://localhost:3000` or `http://<server-ip>:3000` |
| Logs | `docker compose logs -f` |
| Stop | `docker compose down` |

</details>

<details>
<summary><b>From source</b> — Node.js 22+</summary>

```bash
git clone https://github.com/xmsssssss/NOTIONPAN.git
cd NOTIONPAN
npm install
cp .env.example .env.local
npm run dev          # → http://localhost:3000
```

Production:

```bash
npm run build
SESSION_SECRET='your-long-random-secret' COOKIE_SECURE=0 npm start
```

</details>

### First visit

```
1  Create admin account
2  Sign in
3  Connect Notion (API key · database can be auto-created)
4  Use the drive
```

Notion credentials can also be set later under **Admin → Environment**.

---

## Notion Setup

Official docs: [Notion Developers — Get started](https://developers.notion.com/guides/get-started/overview)

### 1. Integration token

1. Open [Notion Integrations](https://www.notion.so/my-integrations)
2. Create a new integration
3. Copy the secret (`ntn_…`) → `NOTION_API_KEY`

### 2. Database

| Path | Steps |
|:---|:---|
| **A · Auto-create** | Admin → **Index Sync** → create database |
| **B · Manual** | Create a database with the schema below, then share it with the integration (**⋯ → Connections**) |

**Manual schema**

| Property | Type |
|:---|:---|
| `Name` | Title |
| `Folder` | Text |
| `Size` | Number |
| `MIME` | Text |
| `Type` | Select — `image` / `video` / `audio` / `pdf` / `file` |
| `File` | Files & media |

Missing columns → Admin → **Repair Schema**.

### 3. Database ID

```
https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
                     └──────────── Database ID ────────────┘
```

---

## Configuration

| Variable | Required | Description |
|:---|:---:|:---|
| `SESSION_SECRET` | **prod** | Cookie encryption secret · ≥32 characters |
| `COOKIE_SECURE` | | `0` = allow HTTP · `1` = HTTPS-only cookies |
| `PORT` | | Host port for Compose · default `3000` |
| `NOTION_API_KEY` | * | Integration token · or set in the UI |
| `NOTION_DATABASE_ID` | * | Target database · or set / auto-create in the UI |
| `NOTION_DATA_SOURCE_ID` | | Usually leave empty |
| `NOTION_WEBHOOK_TOKEN` | | Stored automatically after webhook verification |
| `DATA_DIR` | | Data root · default `./data` · Docker `/app/data` |

\* Optional if configured in the web UI after login.

Full template: [`.env.example`](.env.example)

Runtime env saved from the admin UI is persisted under the data directory (Docker volume-friendly).

---

## Usage

| Action | How |
|:---|:---|
| Context menu | Right-click · long-press · ⋯ |
| FAB `+` | New folder · upload · URL import · refresh · admin · logout |
| Share | Menu → Share → password / expiry → `/s/<token>` |
| Admin | FAB → Admin |

**Downloads**

| Who | Behavior |
|:---|:---|
| Logged-in user | `302` → Notion temporary URL |
| Share visitor | Proxied by this server · Notion URL never exposed |

---

## Webhooks (optional)

Enables incremental index updates and faster URL-import completion.

Requires a public **HTTPS** endpoint:

```
https://your-domain/api/webhooks/notion
```

**Subscribe to**

```
file_upload.completed | upload_failed | expired
page.created | deleted | undeleted | properties_updated
```

On first verification the token is stored as `NOTION_WEBHOOK_TOKEN`.

Without webhooks, use **Refresh index** after editing files directly in Notion.

---

## Deployment

| Topic | Detail |
|:---|:---|
| Image | Multi-stage build · Next.js `standalone` · Node 22 |
| Data volume | `/app/data` · named volume `notionpan-data` |
| Bind mount | Optional: `./data:/app/data` |
| HTTPS reverse proxy | Set `COOKIE_SECURE=1` and restart |
| Health checks | `GET /api/auth/status` · `GET /api/health` |

```yaml
# optional bind-mount instead of named volume
volumes:
  - ./data:/app/data
```

Persisted under the data directory: admin account, site config, local index, shares, thumbnails, and runtime env.

---

## Project Layout

```
src/
  app/           # Next.js App Router · pages & API routes
  components/    # Drive UI, admin, preview, share
  lib/           # Notion, index, auth, share, backup
data/            # Runtime data (gitignored)
Dockerfile
docker-compose.yml
.env.example
```

---

## Acceptable Use

Intended for **personal / self-hosted** use with **your own** Notion workspace.

| Do | Don't |
|:---|:---|
| Follow [Notion Terms](https://www.notion.com/terms) & [API guidelines](https://developers.notion.com/guides/get-started/overview) | Use as free CDN / mass file-host / commercial storage at scale |
| Keep integration secrets private | Commit tokens or share them publicly |
| Keep request rates reasonable | Scrape, spam-upload, or automate API abuse |
| Host only content you have rights to | Host malware or illegal material |
| | Bypass plan limits, rate limits, or security controls |
| | Resell / open proxy access that overloads Notion or this service |

Abuse may result in Notion revoking your integration. You are solely responsible for deployment and operation.

---

## Limitations

| | |
|:---|:---|
| File size | Limited by Notion plan · free ≈ 5 MB |
| Delete | Archives to Notion trash · not hard-delete |
| Folders | Path string in `Folder` · not native Notion hierarchy |
| Scale | Single admin · single instance recommended |
| URL import | Public HTTPS only · must be reachable by Notion |

---

## License

MIT
