import assert from "node:assert/strict";
import test from "node:test";
import { createFlowState } from "../modules/flow/web/state.mjs";
import { createFlowServer } from "../modules/flow/server/index.mjs";
import { emptyState, makeStore } from "./helpers.mjs";

test("流程状态会规范化数据并去重输入", () => {
  const state = createFlowState({
    id: "default",
    nodes: [
      { id: "a" },
      { id: "b", artifacts: [], logs: [], sessionMode: "new", status: "idle" },
      { id: "c", artifacts: [], logs: [], sessionMode: "new", status: "idle" },
    ],
    edges: [
      { id: "ab", from: "a", to: "b", files: [{ name: "same", path: "/tmp/same" }] },
      { id: "ac", from: "a", to: "c", files: [{ name: "other", path: "/tmp/other" }] },
      { id: "cb", from: "c", to: "b", files: [{ name: "duplicate", path: "/tmp/same" }] },
    ],
  });

  assert.equal(state.flow.nodes[0].status, "idle");
  assert.deepEqual(state.collectInputs(state.nodeOf("b")).map((file) => file.path), ["/tmp/same"]);
});

test("连线选择按文件名对齐到最新一轮产物", () => {
  const state = createFlowState({
    nodes: [
      {
        id: "a",
        artifacts: [
          { name: "call.md", path: "/runs/2/output/call.md", size: 20 },
          { name: "other.md", path: "/runs/2/output/other.md", size: 5 },
        ],
      },
      { id: "b" },
    ],
    edges: [
      {
        from: "a",
        to: "b",
        files: [
          { name: "call.md", path: "/runs/1/output/call.md", size: 10 },
          { name: "gone.md", path: "/runs/1/output/gone.md", size: 7 },
        ],
      },
    ],
  });

  state.pruneEdges(state.nodeOf("a"));
  assert.deepEqual(state.flow.edges[0].files, [
    { name: "call.md", path: "/runs/2/output/call.md", size: 20 },
  ]);
});

test("重启后流程节点不会永久停留在运行中", () => {
  const state = emptyState();
  state.flows.push({
    id: "flow-a",
    name: "流程 A",
    nodes: [{ id: "stale", status: "running", logs: [] }],
    edges: [],
  });
  const module = createFlowServer({ store: makeStore(state) });
  assert.equal(module.recovered, true);
  assert.equal(module.api.get("flow-a").nodes[0].status, "error");
  assert.match(module.api.get("flow-a").nodes[0].logs[0], /运行已中断/);
});

test("旧版单流程状态会迁移为流程列表", () => {
  const state = emptyState();
  state.flow = { id: "default", nodes: [{ id: "n" }], edges: [] };
  const store = makeStore(state);
  const module = createFlowServer({ store });
  assert.equal(module.recovered, true);
  assert.equal(state.flow, undefined);
  assert.equal(state.flows[0].id, "default");
  assert.equal(state.flows[0].name, "默认流程");
  assert.equal(module.api.get("default").nodes[0].id, "n");
});

test("流程服务端支持创建、列出、保存和删除多个流程", async () => {
  const store = makeStore(emptyState());
  const deleted = [];
  const module = createFlowServer({ store, onDelete: async (id) => deleted.push(id) });
  assert.deepEqual(module.api.list(), []);

  const created = module.api.create({ name: "流程 A" });
  assert.equal(created.name, "流程 A");
  assert.deepEqual(module.api.list().map((flow) => flow.id), [created.id]);

  module.api.save(created.id, { nodes: [{ id: "n" }], edges: [] });
  assert.equal(module.api.get(created.id).nodes[0].id, "n");
  assert.equal(module.api.list()[0].nodeCount, 1);
  assert.throws(() => module.api.save("missing", { nodes: [] }), /流程不存在/);

  const removed = await module.api.remove(created.id);
  assert.equal(removed.id, created.id);
  assert.deepEqual(deleted, [created.id]);
  assert.equal(module.api.get(created.id), null);
  await assert.rejects(() => module.api.remove("missing"), /流程不存在/);
});
