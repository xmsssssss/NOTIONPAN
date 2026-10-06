import { test } from "node:test";
import assert from "node:assert/strict";
import { nextTrapIndex } from "../src/lib/focus-trap.ts";

test("nextTrapIndex：无可聚焦元素交给调用方", () => {
  assert.equal(nextTrapIndex(0, -1, false), null);
});

test("nextTrapIndex：首尾循环", () => {
  assert.equal(nextTrapIndex(3, 2, false), 0, "末尾 Tab 回到首个");
  assert.equal(nextTrapIndex(3, 0, true), 2, "首个 Shift+Tab 到末尾");
});

test("nextTrapIndex：中间元素走浏览器默认", () => {
  assert.equal(nextTrapIndex(3, 1, false), null);
  assert.equal(nextTrapIndex(3, 1, true), null);
  assert.equal(nextTrapIndex(3, 0, false), null);
});

test("nextTrapIndex：焦点逃出面板时拉回", () => {
  assert.equal(nextTrapIndex(3, -1, false), 0);
  assert.equal(nextTrapIndex(3, -1, true), 2);
});

test("nextTrapIndex：单元素始终停留", () => {
  assert.equal(nextTrapIndex(1, 0, false), 0);
  assert.equal(nextTrapIndex(1, 0, true), 0);
});
