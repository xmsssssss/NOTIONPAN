import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VIEW_PREFS, readViewPrefs } from "../src/lib/use-view-prefs.ts";

const store = (obj) => ({ getItem: (k) => (k in obj ? obj[k] : null) });

test("readViewPrefs：读取合法值", () => {
  assert.deepEqual(
    readViewPrefs(store({ "notionpan-view": "gallery", "notionpan-sort-key": "name", "notionpan-sort-dir": "asc" })),
    { viewMode: "gallery", sortKey: "name", sortDir: "asc" },
  );
});

test("readViewPrefs：非法值逐项回退默认", () => {
  assert.deepEqual(
    readViewPrefs(store({ "notionpan-view": "grid", "notionpan-sort-key": "name", "notionpan-sort-dir": "up" })),
    { ...DEFAULT_VIEW_PREFS, sortKey: "name" },
  );
});

test("readViewPrefs：storage 缺失或抛错时用默认", () => {
  assert.deepEqual(readViewPrefs(null), DEFAULT_VIEW_PREFS);
  const throwing = {
    getItem() {
      throw new Error("SecurityError");
    },
  };
  assert.deepEqual(readViewPrefs(throwing), DEFAULT_VIEW_PREFS);
});
