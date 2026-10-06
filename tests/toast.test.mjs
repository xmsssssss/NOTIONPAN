import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TOASTS, createToastStore, errorMessage } from "../src/lib/toast.ts";

/** 可手动推进的假计时器 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map();
  return {
    timers: {
      setTimeout: (fn, ms) => {
        const id = ++seq;
        pending.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => pending.delete(id),
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

test("push / 自动消失 / 快照不可变", () => {
  const ft = fakeTimers();
  const s = createToastStore(ft.timers);
  const before = s.getSnapshot();
  s.push("ok", "success", 1000);
  const after = s.getSnapshot();
  assert.notEqual(before, after, "变更后应返回新数组");
  assert.equal(after.length, 1);
  assert.equal(after[0].kind, "success");
  ft.advance(999);
  assert.equal(s.getSnapshot().length, 1);
  ft.advance(1);
  assert.equal(s.getSnapshot().length, 0);
});

test("空消息忽略；duration 0 常驻", () => {
  const ft = fakeTimers();
  const s = createToastStore(ft.timers);
  assert.equal(s.push("   "), 0);
  assert.equal(s.getSnapshot().length, 0);
  s.push("sticky", "info", 0);
  ft.advance(1e9);
  assert.equal(s.getSnapshot().length, 1);
  assert.equal(ft.pendingCount, 0);
});

test("相同消息去重并重置计时", () => {
  const ft = fakeTimers();
  const s = createToastStore(ft.timers);
  const a = s.push("失败", "error", 1000);
  ft.advance(800);
  const b = s.push("失败", "error", 1000);
  assert.equal(a, b);
  assert.equal(s.getSnapshot().length, 1);
  ft.advance(800);
  assert.equal(s.getSnapshot().length, 1, "计时已重置，不应消失");
  ft.advance(200);
  assert.equal(s.getSnapshot().length, 0);
  // 内容相同但类型不同不去重
  s.push("x", "error");
  s.push("x", "success");
  assert.equal(s.getSnapshot().length, 2);
});

test("超出上限丢弃最早的并清理其计时器", () => {
  const ft = fakeTimers();
  const s = createToastStore(ft.timers);
  for (let i = 0; i < MAX_TOASTS + 2; i++) s.push(`m${i}`, "info", 1000);
  const items = s.getSnapshot();
  assert.equal(items.length, MAX_TOASTS);
  assert.equal(items[0].message, "m2");
  assert.equal(ft.pendingCount, MAX_TOASTS);
});

test("dismiss / clear / 订阅通知", () => {
  const ft = fakeTimers();
  const s = createToastStore(ft.timers);
  let calls = 0;
  const unsub = s.subscribe(() => calls++);
  const id = s.push("a");
  s.push("b");
  assert.equal(calls, 2);
  s.dismiss(id);
  assert.equal(calls, 3);
  s.dismiss(id); // 已不存在：不通知
  assert.equal(calls, 3);
  s.clear();
  assert.equal(calls, 4);
  assert.equal(s.getSnapshot().length, 0);
  assert.equal(ft.pendingCount, 0);
  unsub();
  s.push("c");
  assert.equal(calls, 4);
});

test("errorMessage", () => {
  assert.equal(errorMessage(new Error("boom"), "fb"), "boom");
  assert.equal(errorMessage("str", "fb"), "str");
  assert.equal(errorMessage(null, "fb"), "fb");
  assert.equal(errorMessage(new Error(""), "fb"), "fb");
});
