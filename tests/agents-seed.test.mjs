import assert from "node:assert/strict";
import test from "node:test";
import { seedAgents } from "../electron/agents-seed.mjs";

const templates = [
  { project: "GEO_Scout", name: "侦察者", projectPath: "C:/data/agents/GEO_Scout" },
  { project: "GEO_Execute", name: "执行者", projectPath: "C:/data/agents/GEO_Execute" },
];
const store = { rid: (prefix) => `${prefix}-1`, now: () => "now" };

test("首次写入 agent，后续不重复，删除后不复活", () => {
  const state = { agents: [] };
  assert.equal(seedAgents(state, templates, store), true);
  assert.equal(state.agents.length, 2);
  assert.deepEqual(state.meta.seededAgents, ["GEO_Scout", "GEO_Execute"]);

  assert.equal(seedAgents(state, templates, store), false);
  assert.equal(state.agents.length, 2);

  state.agents.splice(0, 1);
  assert.equal(seedAgents(state, templates, store), false);
  assert.equal(state.agents.length, 1);
});

test("已有同路径 agent 时只记标记，不重复添加", () => {
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

  assert.equal(seedAgents(state, templates, store), true);
  assert.equal(state.agents.length, 2);
  assert.equal(state.agents[0].name, "已有");
  assert.deepEqual(state.meta.seededAgents, ["GEO_Scout", "GEO_Execute"]);
});

const withSingle = [
  { project: "GEO_Single", name: "单人", projectPath: "C:/data/agents/GEO_Single", register: false },
  ...templates,
];

test("单人模式默认不注册", () => {
  const state = { agents: [] };
  assert.equal(seedAgents(state, withSingle, store), true);
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
  assert.equal(seedAgents(state, withSingle, store), true);
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
  assert.equal(seedAgents(state, withSingle, store), false);
  assert.equal(state.agents.length, 1);
});
