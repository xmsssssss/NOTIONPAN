import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrlSearch, parseUrlState } from "../src/lib/url-state.ts";

test("parseUrlState：空查询串回退默认", () => {
  assert.deepEqual(parseUrlState(""), { folder: "/", view: "app" });
  assert.deepEqual(parseUrlState("?"), { folder: "/", view: "app" });
});

test("parseUrlState：解析 path 与 view", () => {
  assert.deepEqual(parseUrlState("?path=/照片/2024&view=admin"), {
    folder: "/照片/2024",
    view: "admin",
  });
  assert.deepEqual(parseUrlState("path=%2Fa%2Fb"), { folder: "/a/b", view: "app" });
});

test("parseUrlState：非法值被净化", () => {
  assert.equal(parseUrlState("?path=../../etc").folder, "/etc");
  assert.equal(parseUrlState("?path=a//b/./c/").folder, "/a/b/c");
  assert.equal(parseUrlState("?view=evil").view, "app");
});

test("buildUrlSearch：根目录与网盘视图不写入", () => {
  assert.equal(buildUrlSearch("", { folder: "/", view: "app" }), "");
  assert.equal(buildUrlSearch("?path=/a&view=admin", { folder: "/", view: "app" }), "");
});

test("buildUrlSearch：写入路径并保留斜杠", () => {
  assert.equal(buildUrlSearch("", { folder: "/a/b" }), "?path=/a/b");
  assert.equal(buildUrlSearch("", { view: "admin" }), "?view=admin");
});

test("buildUrlSearch：中文与特殊字符可往返", () => {
  for (const folder of ["/照片/2024", "/a b/c&d", "/x?y=1", "/100%", "/#tag"]) {
    const s = buildUrlSearch("", { folder });
    assert.equal(parseUrlState(s).folder, folder, `往返失败: ${folder} -> ${s}`);
  }
});

test("buildUrlSearch：只改指定字段，保留其它参数", () => {
  const s = buildUrlSearch("?path=/a&foo=1", { view: "admin" });
  const p = new URLSearchParams(s.slice(1));
  assert.equal(p.get("path"), "/a");
  assert.equal(p.get("foo"), "1");
  assert.equal(p.get("view"), "admin");
});
