import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeBatchResponse, readNdjson } from "../src/lib/batch.ts";

/** 按给定 chunk 切分构造流，模拟网络分片（含跨行切断） */
function streamOf(chunks) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

const ndjson = (...evs) => evs.map((e) => JSON.stringify(e)).join("\n") + "\n";

test("readNdjson：跨 chunk 拼行、忽略空行与坏行、末行无换行", async () => {
  const out = [];
  for await (const v of readNdjson(streamOf(['{"a":1}\n{"a"', ':2}\n\nnot json\n{"a":3}']))) out.push(v);
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }, { a: 3 }]);
});

test("consumeBatchResponse：逐项进度 + 以 done 为准", async () => {
  const body = ndjson(
    { type: "start", total: 2 },
    { type: "item", done: 1, total: 2, id: "a", ok: true },
    { type: "item", done: 2, total: 2, id: "b", ok: false, error: "x" },
    { type: "done", succeeded: ["a"], failed: [{ id: "b", error: "x" }], files: [] },
  );
  const progress = [];
  const r = await consumeBatchResponse(new Response(streamOf([body])), (p) => progress.push(p));
  assert.deepEqual(progress, [
    { done: 0, total: 2 },
    { done: 1, total: 2 },
    { done: 2, total: 2 },
  ]);
  assert.deepEqual(r.succeeded, ["a"]);
  assert.deepEqual(r.failed, [{ id: "b", error: "x" }]);
  assert.equal(r.interrupted, false);
});

test("consumeBatchResponse：流中断时返回已完成部分", async () => {
  const body = ndjson(
    { type: "start", total: 3 },
    { type: "item", done: 1, total: 3, id: "a", ok: true },
  );
  const r = await consumeBatchResponse(new Response(streamOf([body])));
  assert.deepEqual(r.succeeded, ["a"]);
  assert.equal(r.interrupted, true);
});

test("consumeBatchResponse：读取中途出错（如用户中止）返回部分结果", async () => {
  const enc = new TextEncoder();
  // 先交付一块数据，下一次读取时才报错（start 里直接 error 会丢弃已排队的数据）
  let step = 0;
  const body = new ReadableStream({
    pull(c) {
      if (step++ === 0) {
        c.enqueue(enc.encode(ndjson({ type: "start", total: 3 }, { type: "item", done: 1, total: 3, id: "a", ok: true })));
      } else {
        c.error(new DOMException("aborted", "AbortError"));
      }
    },
  });
  const r = await consumeBatchResponse(new Response(body));
  assert.deepEqual(r.succeeded, ["a"]);
  assert.equal(r.interrupted, true);
});

test("consumeBatchResponse：4xx 抛出服务端错误信息；流内 error 事件抛出", async () => {
  const bad = new Response(JSON.stringify({ error: "需要 ids" }), { status: 400 });
  await assert.rejects(() => consumeBatchResponse(bad), /需要 ids/);
  const errStream = new Response(streamOf([ndjson({ type: "error", error: "炸了" })]));
  await assert.rejects(() => consumeBatchResponse(errStream), /炸了/);
});
