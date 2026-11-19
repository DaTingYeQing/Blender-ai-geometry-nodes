import assert from "node:assert/strict";
import test from "node:test";
import { createKernel } from "../../server/kernel/index.mjs";

function makeBlock(id, extra = {}) {
  return {
    id,
    provides: {},
    requires: {},
    create: () => ({ api: {} }),
    ...extra,
  };
}

test("按依赖顺序启动，并把依赖 api 注入 create", async () => {
  const calls = [];
  const a = makeBlock("a", {
    provides: { value: "function" },
    create: () => ({ api: { value: () => "A" } }),
  });
  const b = makeBlock("b", {
    requires: { a: ["value"] },
    provides: { read: "function" },
    create: ({ api }) => {
      calls.push(api.a.value());
      return { api: { read: () => api.a.value() } };
    },
  });

  const kernel = createKernel();
  kernel.defineAll([b, a]);
  const { apis } = await kernel.boot();

  assert.equal(apis.b.read(), "A");
  assert.deepEqual(calls, ["A"]);
  assert.equal(kernel.api("a").value(), "A");
});

test("重复 id 直接报错", () => {
  const kernel = createKernel();
  kernel.define(makeBlock("a"));
  assert.throws(() => kernel.define(makeBlock("a")), /id 重复：a/);
});

test("依赖未登记的块时启动失败", async () => {
  const kernel = createKernel().define(
    makeBlock("a", {
      requires: { missing: ["run"] },
    }),
  );
  await assert.rejects(() => kernel.boot(), /依赖未登记的块：missing/);
});

test("依赖的方法不存在时启动失败", async () => {
  const a = makeBlock("a", {
    provides: { run: "function" },
    create: () => ({ api: { run: () => true } }),
  });
  const b = makeBlock("b", {
    requires: { a: ["missing"] },
  });

  const kernel = createKernel().defineAll([a, b]);
  await assert.rejects(() => kernel.boot(), /需要 a\.missing/);
});

test("声明提供但 api 没实现时启动失败", async () => {
  const block = makeBlock("a", {
    provides: { start: "function" },
  });

  const kernel = createKernel().define(block);
  await assert.rejects(() => kernel.boot(), /声明提供 start/);
});

test("provides 的类型会校验", async () => {
  const block = makeBlock("a", {
    provides: { state: "object" },
    create: () => ({ api: { state: () => ({}) } }),
  });

  const kernel = createKernel().define(block);
  await assert.rejects(() => kernel.boot(), /a\.state 应为对象/);
});

test("循环依赖报出完整路径", async () => {
  const a = makeBlock("a", { requires: { b: ["go"] } });
  const b = makeBlock("b", { requires: { a: ["go"] } });

  const kernel = createKernel().defineAll([a, b]);
  await assert.rejects(() => kernel.boot(), /循环依赖：a -> b -> a/);
});

test("收集 routes，并校验形状", async () => {
  const a = makeBlock("a", {
    create: () => ({
      api: {},
      routes: [{ method: "GET", path: "/a", handler: () => ({}) }],
    }),
  });
  const b = makeBlock("b", {
    create: () => ({
      api: {},
      routes: [{ method: "POST", pattern: /^\/b\/(.+)$/, handler: () => ({}) }],
    }),
  });

  const kernel = createKernel().defineAll([a, b]);
  const { routes } = await kernel.boot();

  assert.deepEqual(
    routes.map((route) => route.method),
    ["GET", "POST"],
  );
});

test("路由缺 path / pattern 时启动失败", async () => {
  const block = makeBlock("a", {
    create: () => ({ api: {}, routes: [{ method: "GET", handler: () => ({}) }] }),
  });

  const kernel = createKernel().define(block);
  await assert.rejects(() => kernel.boot(), /path 与 pattern 只能有一个/);
});

test("支持异步 create", async () => {
  const block = makeBlock("a", {
    provides: { run: "function" },
    async create() {
      await Promise.resolve();
      return { api: { run: () => "ok" } };
    },
  });

  const kernel = createKernel().define(block);
  await kernel.boot();
  assert.equal(kernel.api("a").run(), "ok");
});

test("create 抛错时带上块名", async () => {
  const block = makeBlock("a", {
    create() {
      throw new Error("boom");
    },
  });

  const kernel = createKernel().define(block);
  await assert.rejects(() => kernel.boot(), /块 a 启动失败：boom/);
});

test("catalog 从定义和启动结果现算", async () => {
  const a = makeBlock("a", {
    provides: { run: "function" },
    create: () => ({
      api: { run: () => true },
      routes: [{ method: "GET", path: "/a", handler: () => ({}) }],
    }),
  });

  const kernel = createKernel().define(a);
  assert.deepEqual(kernel.catalog(), [
    {
      id: "a",
      version: 1,
      provides: ["run"],
      requires: {},
      routes: 0,
      booted: false,
    },
  ]);

  await kernel.boot();
  assert.deepEqual(kernel.catalog(), [
    {
      id: "a",
      version: 1,
      provides: ["run"],
      requires: {},
      routes: 1,
      booted: true,
    },
  ]);
});

test("启动后不能再登记，也不能重复启动", async () => {
  const kernel = createKernel().define(makeBlock("a"));
  await kernel.boot();

  assert.throws(() => kernel.define(makeBlock("b")), /启动后不能再登记/);
  await assert.rejects(() => kernel.boot(), /已经启动过/);
});

test("context 原样传给每个块", async () => {
  const block = makeBlock("a", {
    provides: { answer: "function" },
    create: ({ context }) => ({ api: { answer: () => context.answer } }),
  });

  const kernel = createKernel({ context: { answer: 42 } }).define(block);
  await kernel.boot();
  assert.equal(kernel.api("a").answer(), 42);
});
