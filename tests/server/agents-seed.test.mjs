import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { reconcileAgents } from "../../server/registry/agents.mjs";

const templates = [
  { project: "GEO_Scout", name: "侦察者", projectPath: "C:/data/agents/GEO_Scout" },
  { project: "GEO_Execute", name: "执行者", projectPath: "C:/data/agents/GEO_Execute" },
];

function makeStore() {
  let seq = 0;
  return { rid: (prefix) => `${prefix}-${++seq}`, now: () => "now" };
}

const store = makeStore();

test("首次写入 agent，后续不重复，删除后不复活", () => {
  const state = { agents: [] };
  assert.equal(reconcileAgents(state, templates, store).changed, true);
  assert.equal(state.agents.length, 2);
  assert.deepEqual(state.meta.seededAgents, ["GEO_Scout", "GEO_Execute"]);

  assert.equal(reconcileAgents(state, templates, store).changed, false);
  assert.equal(state.agents.length, 2);

  state.agents.splice(0, 1);
  assert.equal(reconcileAgents(state, templates, store).changed, false);
  assert.equal(state.agents.length, 1);
});

test("已有同路径 agent 时补登记，不重复添加，也不改用户名字", () => {
  const state = {
    agents: [
      {
        id: "existing",
        name: "已有",
        projectPath: "C:/data/agents/GEO_Scout",
        createdAt: "old",
        sessions: [],
      },
    ],
  };

  const result = reconcileAgents(state, templates, store);
  assert.equal(result.changed, true);
  assert.equal(state.agents.length, 2);
  assert.equal(state.agents[0].name, "已有");
  assert.equal(state.agents[0].templateKey, "GEO_Scout");
  assert.deepEqual(state.meta.seededAgents, ["GEO_Scout", "GEO_Execute"]);
});

test("清单路径变化时更新已登记的 Agent", () => {
  const state = { agents: [] };
  reconcileAgents(state, templates, store);

  const moved = [
    { project: "GEO_Scout", name: "侦察者", projectPath: "D:/moved/GEO_Scout" },
    templates[1],
  ];
  const result = reconcileAgents(state, moved, store);

  assert.equal(result.changed, true);
  assert.equal(
    state.agents.find((agent) => agent.templateKey === "GEO_Scout").projectPath,
    path.resolve("D:/moved/GEO_Scout"),
  );
  assert.ok(result.report.updated.some((item) => item.reason === "路径更新"));
});

test("模板改名只更新没被用户改名的 Agent", () => {
  const state = { agents: [] };
  reconcileAgents(state, templates, store);

  const renamed = [
    { project: "GEO_Scout", name: "侦察者·新", projectPath: templates[0].projectPath },
    templates[1],
  ];
  assert.equal(reconcileAgents(state, renamed, store).changed, true);
  assert.equal(state.agents.find((agent) => agent.templateKey === "GEO_Scout").name, "侦察者·新");

  const userNamed = state.agents.find((agent) => agent.templateKey === "GEO_Scout");
  userNamed.name = "我的侦察者";
  const renamedAgain = [
    { project: "GEO_Scout", name: "侦察者·再改", projectPath: templates[0].projectPath },
    templates[1],
  ];
  reconcileAgents(state, renamedAgain, store);
  assert.equal(userNamed.name, "我的侦察者");
});

const withSingle = [
  { project: "GEO_Single", name: "单人", projectPath: "C:/data/agents/GEO_Single", register: false },
  ...templates,
];

test("单人模式默认不注册", () => {
  const state = { agents: [] };
  assert.equal(reconcileAgents(state, withSingle, store).changed, true);
  assert.deepEqual(
    state.agents.map((agent) => agent.name),
    ["侦察者", "执行者"],
  );
  assert.deepEqual(state.meta.seededAgents, ["GEO_Scout", "GEO_Execute"]);
});

test("旧版本误注册的单人会在没有被流程引用时清理", () => {
  const state = {
    agents: [
      { id: "single", name: "单人", projectPath: "C:/data/agents/GEO_Single", sessions: [] },
      { id: "scout", name: "侦察者", projectPath: "C:/data/agents/GEO_Scout", sessions: [] },
    ],
    flows: [{ id: "flow", nodes: [{ id: "n1", agentId: "scout" }] }],
    meta: { seededAgents: ["GEO_Single", "GEO_Scout", "GEO_Execute"] },
  };
  assert.equal(reconcileAgents(state, withSingle, store).changed, true);
  assert.deepEqual(
    state.agents.map((agent) => agent.id),
    ["scout"],
  );
});

test("单人已被流程引用时保留，避免破坏已有流程", () => {
  const state = {
    agents: [{ id: "single", name: "单人", projectPath: "C:/data/agents/GEO_Single", sessions: [] }],
    flows: [{ id: "flow", nodes: [{ id: "n1", agentId: "single" }] }],
    meta: { seededAgents: ["GEO_Single", "GEO_Scout", "GEO_Execute"] },
  };
  assert.equal(reconcileAgents(state, withSingle, store).changed, false);
  assert.equal(state.agents.length, 1);
});
