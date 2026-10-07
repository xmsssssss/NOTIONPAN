import { test } from "node:test";
import assert from "node:assert/strict";
import { consumeBatchResponse, readNdjson, runBatchChunked } from "../src/lib/batch.ts";

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

/** 模拟服务端：逐项成功（id 以 "bad" 开头的失败），完整回报 start/item/done */
function fakeServer(calls) {
  return async (ids) => {
    calls.push(ids);
    const evs = [{ type: "start", total: ids.length }];
    const succeeded = [];
    const failed = [];
    ids.forEach((id, i) => {
      const ok = !id.startsWith("bad");
      if (ok) succeeded.push(id);
      else failed.push({ id, error: "x" });
      evs.push({ type: "item", done: i + 1, total: ids.length, id, ok, ...(ok ? {} : { error: "x" }) });
    });
    evs.push({ type: "done", succeeded, failed, files: [] });
    return new Response(streamOf([ndjson(...evs)]));
  };
}

test("runBatchChunked：按 chunkSize 分组，进度按总数累加", async () => {
  const calls = [];
  const ids = ["a", "b", "bad1", "c", "d"];
  const progress = [];
  const r = await runBatchChunked(fakeServer(calls), ids, { chunkSize: 2, onProgress: (p) => progress.push(p) });
  assert.deepEqual(calls, [["a", "b"], ["bad1", "c"], ["d"]]);
  assert.deepEqual(r.succeeded, ["a", "b", "c", "d"]);
  assert.deepEqual(r.failed, [{ id: "bad1", error: "x" }]);
  assert.equal(r.interrupted, false);
  assert.deepEqual(progress.at(-1), { done: 5, total: 5 });
  // 进度单调不减
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i].done >= progress[i - 1].done);
});

test("runBatchChunked：停止后不再发送后续组，且不带 error", async () => {
  const calls = [];
  const ac = new AbortController();
  const server = fakeServer(calls);
  const r = await runBatchChunked(
    async (ids, signal) => {
      const res = await server(ids, signal);
      ac.abort();
      return res;
    },
    ["a", "b", "c", "d"],
    { chunkSize: 2, signal: ac.signal },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(r.succeeded, ["a", "b"]);
  assert.equal(r.interrupted, true);
  assert.equal(r.error, undefined);
});

test("runBatchChunked：后续组请求失败返回部分结果并带 error；首组失败直接抛出", async () => {
  const calls = [];
  const server = fakeServer(calls);
  let n = 0;
  const r = await runBatchChunked(
    async (ids) => {
      if (n++ === 1) return new Response(JSON.stringify({ error: "服务挂了" }), { status: 500 });
      return server(ids);
    },
    ["a", "b", "c"],
    { chunkSize: 2 },
  );
  assert.deepEqual(r.succeeded, ["a", "b"]);
  assert.equal(r.interrupted, true);
  assert.equal(r.error, "服务挂了");

  await assert.rejects(
    () => runBatchChunked(async () => new Response(JSON.stringify({ error: "需要 ids" }), { status: 400 }), ["a"]),
    /需要 ids/,
  );
});

test("consumeBatchResponse：流意外结束（非用户停止）带 error", async () => {
  const body = ndjson({ type: "start", total: 2 }, { type: "item", done: 1, total: 2, id: "a", ok: true });
  const r = await consumeBatchResponse(new Response(streamOf([body])));
  assert.equal(r.interrupted, true);
  assert.ok(r.error);
});

test("consumeBatchResponse：4xx 抛出服务端错误信息；流内 error 事件抛出", async () => {
  const bad = new Response(JSON.stringify({ error: "需要 ids" }), { status: 400 });
  await assert.rejects(() => consumeBatchResponse(bad), /需要 ids/);
  const errStream = new Response(streamOf([ndjson({ type: "error", error: "炸了" })]));
  await assert.rejects(() => consumeBatchResponse(errStream), /炸了/);
});
