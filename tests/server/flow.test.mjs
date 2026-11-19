import assert from "node:assert/strict";
import test from "node:test";
import { createFlowServer } from "../../modules/flow/server/index.mjs";
import { emptyState, makeStore } from "../helpers.mjs";

test("旧版节点运行日志会被清理，lastRunId 保留", () => {
  const state = emptyState();
  state.flows.push({
    id: "flow-a",
    name: "流程 A",
    nodes: [
      {
        id: "stale",
        status: "running",
        logs: ["旧日志"],
        artifacts: ["a.txt"],
        lastRunId: "run-old",
        lastSessionId: "sess-old",
      },
    ],
    edges: [],
  });
  const module = createFlowServer({ store: makeStore(state) });
  assert.equal(module.recovered, true);
  const node = module.api.get("flow-a").nodes[0];
  assert.equal(node.id, "stale");
  assert.equal(node.status, undefined);
  assert.equal(node.logs, undefined);
  assert.equal(node.artifacts, undefined);
  /* lastRunId 现在是"恢复产物"用的，必须保留。 */
  assert.equal(node.lastRunId, "run-old");
  assert.equal(node.lastSessionId, undefined);
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

  module.api.save(created.id, {
    nodes: [{ id: "n", status: "running", logs: ["旧日志"], artifacts: [] }],
    edges: [],
  });
  assert.equal(module.api.get(created.id).nodes[0].id, "n");
  assert.equal(module.api.get(created.id).nodes[0].status, undefined);
  assert.equal(module.api.get(created.id).nodes[0].logs, undefined);
  assert.equal(module.api.list()[0].nodeCount, 1);
  assert.throws(() => module.api.save("missing", { nodes: [] }), /流程不存在/);

  const removed = await module.api.remove(created.id);
  assert.equal(removed.id, created.id);
  assert.deepEqual(deleted, [created.id]);
  assert.equal(module.api.get(created.id), null);
  await assert.rejects(() => module.api.remove("missing"), /流程不存在/);
});

test("保存流程时会丢掉两端节点不存在的连线", () => {
  const store = makeStore(emptyState());
  const module = createFlowServer({ store });
  const flow = module.api.create({ name: "流程" });

  module.api.save(flow.id, {
    nodes: [{ id: "n1", agentId: "a1" }, { id: "n2", agentId: "a2" }],
    edges: [
      { id: "keep", from: "n1", to: "n2" },
      { id: "drop", from: "n1", to: "gone" },
    ],
  });

  assert.deepEqual(module.api.get(flow.id).edges.map((edge) => edge.id), ["keep"]);
});

test("prune 会清掉所有流程里属于被删 Agent 的节点和连线", () => {
  const state = emptyState();
  state.flows.push(
    {
      id: "flow-a",
      name: "流程 A",
      nodes: [
        { id: "n1", agentId: "a1" },
        { id: "n2", agentId: "a2" },
        { id: "n3", agentId: "gone" },
      ],
      edges: [
        { id: "e1", from: "n1", to: "n2" },
        { id: "e2", from: "n2", to: "n3" },
        { id: "e3", from: "n3", to: "n1" },
        { id: "e4", from: "n1", to: "missing-node" },
      ],
    },
    {
      id: "flow-b",
      name: "流程 B",
      nodes: [{ id: "n4", agentId: "gone" }],
      edges: [{ id: "e5", from: "n4", to: "n4" }],
    },
  );
  const module = createFlowServer({ store: makeStore(state) });

  assert.equal(module.api.prune("gone"), true);
  assert.deepEqual(module.api.get("flow-a").nodes.map((node) => node.id), ["n1", "n2"]);
  /* e2 / e3 连着被删节点，e4 连着不存在的节点，都要一起删。 */
  assert.deepEqual(module.api.get("flow-a").edges.map((edge) => edge.id), ["e1"]);
  assert.deepEqual(module.api.get("flow-b").nodes, []);
  assert.deepEqual(module.api.get("flow-b").edges, []);

  /* 再跑一次没有可删的，返回 false，调用方就不用白写一遍 state。 */
  assert.equal(module.api.prune("gone"), false);
});
