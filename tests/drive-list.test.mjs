import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCrumbs,
  isSortDir,
  isSortKey,
  nextSort,
  pageSlice,
  pruneSelection,
  selectionState,
  sortFiles,
  sortFolders,
  toggleSelection,
} from "../src/lib/drive-list.ts";

const f = (name, size, kind, createdTime) => ({ name, size, kind, createdTime });
const names = (list) => list.map((x) => x.name);

const files = [
  f("b10.txt", 5, "file", "2024-01-03"),
  f("b2.txt", 50, "file", "2024-01-01"),
  f("a.png", 5, "image", "2024-01-02"),
  f("c.mp3", 0, "audio", "2024-01-02"),
];

test("sortFiles：名称自然排序", () => {
  assert.deepEqual(names(sortFiles(files, "name", "asc")), ["a.png", "b2.txt", "b10.txt", "c.mp3"]);
  assert.deepEqual(names(sortFiles(files, "name", "desc")), ["c.mp3", "b10.txt", "b2.txt", "a.png"]);
});

test("sortFiles：大小相同按名称兜底", () => {
  assert.deepEqual(names(sortFiles(files, "size", "asc")), ["c.mp3", "a.png", "b10.txt", "b2.txt"]);
});

test("sortFiles：类型顺序 image < audio < file", () => {
  assert.deepEqual(names(sortFiles(files, "kind", "asc")), ["a.png", "c.mp3", "b2.txt", "b10.txt"]);
});

test("sortFiles：时间降序且不修改原数组", () => {
  const before = names(files);
  assert.deepEqual(names(sortFiles(files, "createdTime", "desc")), [
    "b10.txt",
    "c.mp3",
    "a.png",
    "b2.txt",
  ]);
  assert.deepEqual(names(files), before);
});

test("sortFolders：仅名称排序跟随方向", () => {
  const list = ["b", "a10", "a2"];
  assert.deepEqual(sortFolders(list, "name", "asc"), ["a2", "a10", "b"]);
  assert.deepEqual(sortFolders(list, "name", "desc"), ["b", "a10", "a2"]);
  assert.deepEqual(sortFolders(list, "size", "desc"), ["a2", "a10", "b"]);
});

test("nextSort：同列切换、换列默认方向", () => {
  assert.deepEqual(nextSort({ key: "name", dir: "asc" }, "name"), { key: "name", dir: "desc" });
  assert.deepEqual(nextSort({ key: "name", dir: "asc" }, "size"), { key: "size", dir: "desc" });
  assert.deepEqual(nextSort({ key: "size", dir: "desc" }, "kind"), { key: "kind", dir: "asc" });
});

test("isSortKey / isSortDir", () => {
  assert.ok(isSortKey("createdTime"));
  assert.ok(!isSortKey("evil"));
  assert.ok(!isSortKey(null));
  assert.ok(isSortDir("asc"));
  assert.ok(!isSortDir("up"));
});

const ids = ["a", "b", "c", "d", "e"];
const sorted = (s) => [...s].sort();

test("toggleSelection：普通点击切换", () => {
  let s = toggleSelection(new Set(), ids, "b");
  assert.deepEqual(sorted(s), ["b"]);
  s = toggleSelection(s, ids, "b");
  assert.deepEqual(sorted(s), []);
});

test("toggleSelection：Shift 区间勾选（正反方向）", () => {
  const s1 = toggleSelection(new Set(["b"]), ids, "d", { shift: true, anchor: "b" });
  assert.deepEqual(sorted(s1), ["b", "c", "d"]);
  const s2 = toggleSelection(new Set(["d"]), ids, "a", { shift: true, anchor: "d" });
  assert.deepEqual(sorted(s2), ["a", "b", "c", "d"]);
});

test("toggleSelection：Shift 点击已选项则整段取消", () => {
  const s = toggleSelection(new Set(["a", "b", "c", "d"]), ids, "c", { shift: true, anchor: "a" });
  assert.deepEqual(sorted(s), ["d"]);
});

test("toggleSelection：锚点失效时退化为普通切换，且不改原集合", () => {
  const orig = new Set(["a"]);
  const s = toggleSelection(orig, ids, "c", { shift: true, anchor: "zzz" });
  assert.deepEqual(sorted(s), ["a", "c"]);
  assert.deepEqual(sorted(orig), ["a"]);
});

test("pruneSelection：去掉不存在项，无变化返回原对象", () => {
  const s = new Set(["a", "x"]);
  assert.deepEqual(sorted(pruneSelection(s, ids)), ["a"]);
  const same = new Set(["a", "b"]);
  assert.equal(pruneSelection(same, ids), same);
});

test("selectionState", () => {
  assert.equal(selectionState(new Set(), ids), "none");
  assert.equal(selectionState(new Set(["a"]), ids), "some");
  assert.equal(selectionState(new Set(ids), ids), "all");
  assert.equal(selectionState(new Set(["a"]), []), "none");
});

test("pageSlice：文件夹优先占用名额", () => {
  const r = pageSlice(["f1", "f2", "f3"], ["a", "b", "c"], 2);
  assert.deepEqual(r.folders, ["f1", "f2"]);
  assert.deepEqual(r.files, []);
  assert.equal(r.shown, 2);
  assert.equal(r.total, 6);
  assert.equal(r.hasMore, true);
});

test("pageSlice：跨越文件夹与文件边界", () => {
  const r = pageSlice(["f1"], ["a", "b", "c"], 3);
  assert.deepEqual(r.folders, ["f1"]);
  assert.deepEqual(r.files, ["a", "b"]);
  assert.equal(r.hasMore, true);
});

test("pageSlice：limit 超出总数 / 非法值", () => {
  const all = pageSlice(["f1"], ["a"], 100);
  assert.equal(all.shown, 2);
  assert.equal(all.hasMore, false);
  const none = pageSlice(["f1"], ["a"], -5);
  assert.equal(none.shown, 0);
  assert.equal(none.hasMore, true);
  const empty = pageSlice([], [], 10);
  assert.equal(empty.hasMore, false);
});

test("buildCrumbs", () => {
  assert.deepEqual(buildCrumbs("/"), [{ label: "根目录", path: "/" }]);
  assert.deepEqual(buildCrumbs("/照片/2024/"), [
    { label: "根目录", path: "/" },
    { label: "照片", path: "/照片" },
    { label: "2024", path: "/照片/2024" },
  ]);
});

test("collapseCrumbs：层级 <= maxVisible 时全部显示", async () => {
  const { collapseCrumbs } = await import("../src/lib/drive-list.ts");
  const short = [
    { label: "根目录", path: "/" },
    { label: "照片", path: "/照片" },
    { label: "2024", path: "/照片/2024" },
  ];
  assert.deepEqual(collapseCrumbs(short, 4), short);
  assert.deepEqual(collapseCrumbs(short, 3), short);
});

test("collapseCrumbs：层级 > maxVisible 时折叠中间部分", async () => {
  const { collapseCrumbs } = await import("../src/lib/drive-list.ts");
  const deep = [
    { label: "根目录", path: "/" },
    { label: "a", path: "/a" },
    { label: "b", path: "/a/b" },
    { label: "c", path: "/a/b/c" },
    { label: "d", path: "/a/b/c/d" },
    { label: "e", path: "/a/b/c/d/e" },
  ];
  // maxVisible=4：保留根 + ... + 最后2层
  const result = collapseCrumbs(deep, 4);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { label: "根目录", path: "/" });
  assert.equal(result[1].label, "...");
  assert.deepEqual(result[1].collapsed, [
    { label: "a", path: "/a" },
    { label: "b", path: "/a/b" },
    { label: "c", path: "/a/b/c" },
  ]);
  assert.deepEqual(result[2], { label: "d", path: "/a/b/c/d" });
  assert.deepEqual(result[3], { label: "e", path: "/a/b/c/d/e" });
});

test("collapseCrumbs：maxVisible=3 时保留根 + ... + 最后1层", async () => {
  const { collapseCrumbs } = await import("../src/lib/drive-list.ts");
  const deep = [
    { label: "根目录", path: "/" },
    { label: "a", path: "/a" },
    { label: "b", path: "/a/b" },
    { label: "c", path: "/a/b/c" },
  ];
  const result = collapseCrumbs(deep, 3);
  assert.equal(result.length, 3);
  assert.deepEqual(result[0], { label: "根目录", path: "/" });
  assert.equal(result[1].label, "...");
  assert.deepEqual(result[1].collapsed, [
    { label: "a", path: "/a" },
    { label: "b", path: "/a/b" },
  ]);
  assert.deepEqual(result[2], { label: "c", path: "/a/b/c" });
});
