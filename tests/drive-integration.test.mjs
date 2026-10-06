// 集成测试：真实 @notionhq/client + 真实 drive.ts / notion.ts，只替换 globalThis.fetch。
// 覆盖：PAT 上传上限、跳过预览块、503 已提交读回、免费块上限 403 提示。
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "notionpan-test-"));
const DS_ID = "11111111-1111-1111-1111-111111111111";

// 必须在导入源码前设置：runtime-env 在加载时快照环境变量
process.env.DATA_DIR = TMP;
process.env.ENV_FILE = path.join(TMP, "env.local"); // 不读取开发者本机的 .env.local
process.env.NOTION_API_KEY = "test-token";
process.env.NOTION_DATABASE_ID = "22222222222222222222222222222222";
process.env.NOTION_DATA_SOURCE_ID = DS_ID;
process.env.NOTION_RATE_LIMIT_PER_SECOND = "1000";
delete process.env.NOTION_MAX_UPLOAD_BYTES;
delete process.env.NOTION_SKIP_PREVIEW_BLOCK;

/** 记录所有发往 Notion 的请求 */
let calls = [];
/** 可按用例覆盖的路由：返回 { status, body } 或 undefined 走默认 */
let overrides = {};
let usersMe = { object: "user", id: "u1", type: "person", person: { email: "user@example.com" } };
let pageSeq = 0;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function pageObject(id, name = "file.txt") {
  return {
    object: "page",
    id,
    created_time: "2026-10-07T00:00:00.000Z",
    last_edited_time: "2026-10-07T00:00:00.000Z",
    url: `https://app.notion.com/p/${id.replace(/-/g, "")}`,
    in_trash: false,
    parent: { type: "data_source_id", data_source_id: DS_ID },
    properties: {
      Name: { type: "title", title: [{ plain_text: name }] },
      Folder: { type: "rich_text", rich_text: [{ plain_text: "/" }] },
      Size: { type: "number", number: 10 },
      MIME: { type: "rich_text", rich_text: [{ plain_text: "text/plain" }] },
      Type: { type: "select", select: { name: "file" } },
      File: {
        type: "files",
        files: [
          {
            name,
            type: "file",
            file: { url: "https://files.example.com/x", expiry_time: "2026-10-07T01:00:00.000Z" },
          },
        ],
      },
    },
  };
}

function route(method, pathname) {
  if (method === "GET" && pathname === "/v1/users/me") return "users.me";
  if (method === "POST" && pathname === "/v1/file_uploads") return "fileUploads.create";
  if (method === "POST" && /^\/v1\/file_uploads\/[^/]+\/send$/.test(pathname)) return "fileUploads.send";
  if (method === "POST" && pathname === "/v1/pages") return "pages.create";
  if (method === "GET" && /^\/v1\/pages\/[^/]+$/.test(pathname)) return "pages.retrieve";
  if (method === "PATCH" && /^\/v1\/blocks\/[^/]+\/children$/.test(pathname)) return "blocks.append";
  return `${method} ${pathname}`;
}

async function fakeFetch(input, init = {}) {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  const name = route(method, url.pathname);
  calls.push({ name, method, pathname: url.pathname });

  const o = overrides[name];
  if (o) {
    const r = typeof o === "function" ? o() : o;
    if (r) return json(r.status, r.body);
  }

  switch (name) {
    case "users.me":
      return json(200, usersMe);
    case "fileUploads.create":
      return json(200, { object: "file_upload", id: "fu-1", status: "pending" });
    case "fileUploads.send":
      return json(200, { object: "file_upload", id: "fu-1", status: "uploaded" });
    case "pages.create":
      pageSeq += 1;
      return json(200, pageObject(`aaaaaaaa-0000-0000-0000-${String(pageSeq).padStart(12, "0")}`));
    case "pages.retrieve":
      return json(200, pageObject(url.pathname.split("/").pop()));
    case "blocks.append":
      return json(200, { object: "list", results: [] });
    default:
      return json(404, { object: "error", status: 404, code: "object_not_found", message: name });
  }
}

const realFetch = globalThis.fetch;
let drive;
let notion;

before(async () => {
  // SDK 在构造 Client 时绑定 fetch，必须在任何 getNotionClient() 之前替换
  globalThis.fetch = fakeFetch;
  notion = await import("../src/lib/notion.ts");
  drive = await import("../src/lib/drive.ts");
});

after(() => {
  globalThis.fetch = realFetch;
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    // Windows 上 SQLite 句柄可能未释放，忽略
  }
});

beforeEach(() => {
  calls = [];
  overrides = {};
  delete process.env.NOTION_SKIP_PREVIEW_BLOCK;
  delete process.env.NOTION_MAX_UPLOAD_BYTES;
});

const names = () => calls.map((c) => c.name);
let fileSeq = 0;
/** 每个用例用不同文件名，避免「同名同大小」去重跳过上传 */
function smallFile() {
  fileSeq += 1;
  return { file: new Blob(["0123456789"], { type: "text/plain" }), filename: `t${fileSeq}.txt` };
}

// ---------- 上传上限（PAT / 集成令牌） ----------

test("集成令牌：上限取自 users.me 的 workspace_limits", async () => {
  usersMe = {
    object: "user",
    id: "b1",
    type: "bot",
    bot: {
      owner: { type: "workspace", workspace: true },
      workspace_name: "WS",
      workspace_limits: { max_file_upload_size_in_bytes: 5368709120 },
    },
  };
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.maxFileUploadSizeInBytes, 5368709120);
  assert.equal(lim.tokenType, "bot");
  assert.equal(lim.source, "notion");
  assert.equal(lim.workspaceName, "WS");
});

test("集成令牌：NOTION_MAX_UPLOAD_BYTES 不会放宽 Notion 给出的上限", async () => {
  usersMe = {
    object: "user",
    id: "b1",
    type: "bot",
    bot: { workspace_name: "WS", workspace_limits: { max_file_upload_size_in_bytes: 5242880 } },
  };
  process.env.NOTION_MAX_UPLOAD_BYTES = "999999999";
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.maxFileUploadSizeInBytes, 5242880);
  assert.equal(lim.source, "notion");
});

test("PAT（真实结构 bot + owner=user）：tokenType=person，上限取自 Notion", async () => {
  usersMe = {
    object: "user",
    id: "b2",
    type: "bot",
    name: "test",
    bot: {
      owner: { type: "user", user: { object: "user", id: "u1", type: "person" } },
      workspace_name: "WS",
      workspace_limits: { max_file_upload_size_in_bytes: 5368709120 },
    },
  };
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.tokenType, "person");
  assert.equal(lim.source, "notion");
  assert.equal(lim.maxFileUploadSizeInBytes, 5368709120);
});

test("PAT：没有 workspace_limits 时默认 5MB", async () => {
  usersMe = { object: "user", id: "u1", type: "person", person: { email: "user@example.com" } };
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.maxFileUploadSizeInBytes, 5 * 1024 * 1024);
  assert.equal(lim.tokenType, "person");
  assert.equal(lim.source, "default");
});

test("PAT：使用 NOTION_MAX_UPLOAD_BYTES", async () => {
  usersMe = { object: "user", id: "u1", type: "person", person: { email: "user@example.com" } };
  process.env.NOTION_MAX_UPLOAD_BYTES = "104857600";
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.maxFileUploadSizeInBytes, 104857600);
  assert.equal(lim.source, "override");
});

test("配置变化后不复用旧缓存（不传 force）", async () => {
  usersMe = { object: "user", id: "u1", type: "person", person: { email: "user@example.com" } };
  await notion.getWorkspaceUploadLimit(true);
  process.env.NOTION_MAX_UPLOAD_BYTES = "2097152";
  const lim = await notion.getWorkspaceUploadLimit();
  assert.equal(lim.maxFileUploadSizeInBytes, 2097152);
});

test("users.me 失败：兜底 5MB，不抛错", async () => {
  overrides["users.me"] = {
    status: 401,
    body: { object: "error", status: 401, code: "unauthorized", message: "API token is invalid." },
  };
  const lim = await notion.getWorkspaceUploadLimit(true);
  assert.equal(lim.maxFileUploadSizeInBytes, 5 * 1024 * 1024);
  assert.equal(lim.source, "default");
  assert.equal(lim.tokenType, null);
});

// ---------- 上传流程 ----------

test("上传：默认追加预览块", async () => {
  usersMe = { object: "user", id: "u1", type: "person", person: { email: "user@example.com" } };
  await notion.getWorkspaceUploadLimit(true);
  calls = [];
  const r = await drive.uploadFile(smallFile());
  assert.equal(r.skipped, false);
  assert.deepEqual(names(), [
    "fileUploads.create",
    "fileUploads.send",
    "pages.create",
    "blocks.append",
    "pages.retrieve",
  ]);
});

test("上传：NOTION_SKIP_PREVIEW_BLOCK=1 时不追加预览块", async () => {
  process.env.NOTION_SKIP_PREVIEW_BLOCK = "1";
  const r = await drive.uploadFile(smallFile());
  assert.equal(r.skipped, false);
  assert.ok(!names().includes("blocks.append"), names().join(","));
  assert.equal(names().filter((n) => n === "pages.create").length, 1);
});

test("上传：pages.create 返回 503 + committed_resource_id → 读回，不重复创建", async () => {
  const committed = "bbbbbbbb-0000-0000-0000-000000000001";
  overrides["pages.create"] = {
    status: 503,
    body: {
      object: "error",
      status: 503,
      code: "service_unavailable",
      message: "The change was saved, but the response could not be built in time.",
      additional_data: {
        committed_resource_id: committed,
        retry_guidance: ["Read the object again to confirm the saved change.", "Do not repeat the write."],
      },
    },
  };
  const r = await drive.uploadFile(smallFile());
  assert.equal(r.skipped, false);
  assert.equal(r.file.id, committed);
  assert.equal(names().filter((n) => n === "pages.create").length, 1, "不得重复创建");
  const retrieves = calls.filter((c) => c.name === "pages.retrieve");
  assert.ok(retrieves.length >= 1);
  assert.equal(retrieves[0].pathname, `/v1/pages/${committed}`);
});

test("上传：503 但没有 committed_resource_id → 报错，不读回", async () => {
  overrides["pages.create"] = {
    status: 503,
    body: { object: "error", status: 503, code: "service_unavailable", message: "unavailable" },
  };
  await assert.rejects(drive.uploadFile(smallFile()), /写入网盘失败/);
  assert.equal(names().filter((n) => n === "pages.create").length, 1);
  assert.ok(!names().includes("pages.retrieve"));
});

test("上传：免费块上限 403 → 明确提示", async () => {
  overrides["pages.create"] = {
    status: 403,
    body: {
      object: "error",
      status: 403,
      code: "restricted_resource",
      message: "This workspace has used all of its free blocks.",
      additional_data: { block_limit: "block_creation" },
    },
  };
  await assert.rejects(drive.uploadFile(smallFile()), (err) => {
    assert.match(err.message, /免费块额度已用完/);
    assert.match(err.message, /NOTION_SKIP_PREVIEW_BLOCK/);
    return true;
  });
  assert.equal(names().filter((n) => n === "pages.create").length, 1, "块上限不应重试");
});

test("上传：普通 403（无 block_limit）不显示块上限提示", async () => {
  overrides["pages.create"] = {
    status: 403,
    body: {
      object: "error",
      status: 403,
      code: "restricted_resource",
      message: "Insufficient permissions for this endpoint.",
    },
  };
  await assert.rejects(drive.uploadFile(smallFile()), (err) => {
    assert.doesNotMatch(err.message, /免费块额度/);
    assert.match(err.message, /Insufficient permissions/);
    return true;
  });
});
