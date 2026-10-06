// 运行：npm test（Node 22.18+ 原生剥离 TS 类型）
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_LIMIT_MESSAGE,
  committedResourceId,
  createWithCommitRecovery,
  isBlockLimitError,
  parseUploadLimitOverride,
  parseUsersMe,
} from "../src/lib/notion-errors.ts";

/** 模拟 @notionhq/client 的 APIResponseError 形状 */
function apiError(status, code, additional_data) {
  return Object.assign(new Error(`${code}`), { status, code, additional_data });
}

test("isBlockLimitError：识别免费块上限 403", () => {
  assert.equal(
    isBlockLimitError(apiError(403, "restricted_resource", { block_limit: "block_creation" })),
    true,
  );
  assert.equal(
    isBlockLimitError(apiError(403, "restricted_resource", { block_limit: ["block_creation"] })),
    true,
  );
});

test("isBlockLimitError：其他权限错误 / 非 403 不误判", () => {
  assert.equal(isBlockLimitError(apiError(403, "restricted_resource", {})), false);
  assert.equal(isBlockLimitError(apiError(403, "restricted_resource", undefined)), false);
  assert.equal(isBlockLimitError(apiError(400, "validation_error", { block_limit: "x" })), false);
  assert.equal(isBlockLimitError(new Error("fetch failed")), false);
  assert.equal(isBlockLimitError(null), false);
  assert.match(BLOCK_LIMIT_MESSAGE, /1000/);
});

test("committedResourceId：仅 503 且带 ID 时返回", () => {
  assert.equal(
    committedResourceId(apiError(503, "service_unavailable", { committed_resource_id: "abc" })),
    "abc",
  );
  assert.equal(
    committedResourceId(apiError(503, "service_unavailable", { committed_resource_id: ["abc"] })),
    "abc",
  );
  assert.equal(committedResourceId(apiError(503, "service_unavailable", {})), null);
  assert.equal(
    committedResourceId(apiError(500, "internal_server_error", { committed_resource_id: "abc" })),
    null,
  );
  assert.equal(committedResourceId(undefined), null);
});

test("createWithCommitRecovery：成功时不读回", async () => {
  let retrieved = 0;
  const r = await createWithCommitRecovery(
    async () => ({ id: "new" }),
    async () => {
      retrieved++;
      return { id: "x" };
    },
  );
  assert.deepEqual(r, { id: "new" });
  assert.equal(retrieved, 0);
});

test("createWithCommitRecovery：503 已提交 → 按 ID 读回，不重复创建", async () => {
  let creates = 0;
  const seen = [];
  const r = await createWithCommitRecovery(
    async () => {
      creates++;
      throw apiError(503, "service_unavailable", { committed_resource_id: "page-1" });
    },
    async (id) => {
      seen.push(id);
      return { id };
    },
  );
  assert.deepEqual(r, { id: "page-1" });
  assert.equal(creates, 1);
  assert.deepEqual(seen, ["page-1"]);
});

test("createWithCommitRecovery：读回失败时抛出原始 503", async () => {
  const original = apiError(503, "service_unavailable", { committed_resource_id: "page-1" });
  await assert.rejects(
    createWithCommitRecovery(
      async () => {
        throw original;
      },
      async () => {
        throw new Error("retrieve failed");
      },
    ),
    (err) => err === original,
  );
});

test("createWithCommitRecovery：其他错误原样抛出且不读回", async () => {
  const original = apiError(403, "restricted_resource", { block_limit: "block_creation" });
  let retrieved = 0;
  await assert.rejects(
    createWithCommitRecovery(
      async () => {
        throw original;
      },
      async () => {
        retrieved++;
        return {};
      },
    ),
    (err) => err === original,
  );
  assert.equal(retrieved, 0);
});

test("parseUsersMe：内部集成（owner=workspace）读到 workspace_limits", () => {
  const r = parseUsersMe({
    object: "user",
    type: "bot",
    bot: {
      owner: { type: "workspace", workspace: true },
      workspace_name: "My WS",
      workspace_limits: { max_file_upload_size_in_bytes: 5368709120 },
    },
  });
  assert.deepEqual(r, {
    tokenType: "bot",
    maxFileUploadSizeInBytes: 5368709120,
    workspaceName: "My WS",
  });
});

test("parseUsersMe：PAT 实际返回 bot + owner=user → person，且保留上限", () => {
  // 与真实 PAT 的 users.me 结构一致（2026-10 实测）
  const r = parseUsersMe({
    object: "user",
    type: "bot",
    name: "test",
    bot: {
      owner: { type: "user", user: { object: "user", id: "u1", type: "person" } },
      workspace_id: "w1",
      workspace_name: "My WS",
      workspace_limits: { max_file_upload_size_in_bytes: 5368709120 },
    },
  });
  assert.deepEqual(r, {
    tokenType: "person",
    maxFileUploadSizeInBytes: 5368709120,
    workspaceName: "My WS",
  });
});

test("parseUsersMe：直接返回 type=person 时也识别为 PAT", () => {
  const r = parseUsersMe({
    object: "user",
    type: "person",
    person: { email: "user@example.com" },
  });
  assert.deepEqual(r, { tokenType: "person", maxFileUploadSizeInBytes: null, workspaceName: null });
});

test("parseUsersMe：异常输入不抛错", () => {
  assert.deepEqual(parseUsersMe(null), {
    tokenType: null,
    maxFileUploadSizeInBytes: null,
    workspaceName: null,
  });
  assert.equal(
    parseUsersMe({ type: "bot", bot: { workspace_limits: { max_file_upload_size_in_bytes: 0 } } })
      .maxFileUploadSizeInBytes,
    null,
  );
  assert.equal(parseUsersMe({ type: "bot", bot: {} }).maxFileUploadSizeInBytes, null);
});

test("parseUploadLimitOverride", () => {
  assert.equal(parseUploadLimitOverride("5368709120"), 5368709120);
  assert.equal(parseUploadLimitOverride(" 1048576 "), 1048576);
  assert.equal(parseUploadLimitOverride("1.5"), 1);
  assert.equal(parseUploadLimitOverride(""), null);
  assert.equal(parseUploadLimitOverride(undefined), null);
  assert.equal(parseUploadLimitOverride("abc"), null);
  assert.equal(parseUploadLimitOverride("-1"), null);
  assert.equal(parseUploadLimitOverride("0"), null);
});
