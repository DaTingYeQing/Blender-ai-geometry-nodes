import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { seedPresetFlow } from "../electron/preset-seed.mjs";

const preset = JSON.parse(fs.readFileSync(new URL("../presets/default-flow.json", import.meta.url), "utf8"));
const manifest = JSON.parse(fs.readFileSync(new URL("../shard/agents.json", import.meta.url), "utf8"));

const projects = [...new Set(preset.nodes.map((node) => node.agent))];
const templates = projects.map((project) => ({ project, projectPath: `C:/data/agents/${project}` }));

function makeState() {
  return {
    agents: projects.map((project, index) => ({
      id: `agent-${index}`,
      name: project,
      projectPath: `C:/data/agents/${project}`,
    })),
    flows: [],
  };
}

function makeStore() {
  let count = 0;
  return { rid: (prefix) => `${prefix}-${++count}`, now: () => "now" };
}

test("预设引用的项目都在 agents.json 里", () => {
  for (const node of preset.nodes) {
    assert.ok(manifest.projects[node.agent], `agents.json 缺少项目：${node.agent}`);
  }
});

test("默认预设解析成实际的 agentId", () => {
  const state = makeState();
  const store = makeStore();
  assert.equal(seedPresetFlow(state, preset, templates, store), true);

  assert.equal(state.flows.length, 1);
  const flow = state.flows[0];
  assert.equal(flow.name, "默认预设");
  assert.equal(flow.nodes.length, 5);
  assert.equal(flow.edges.length, 8);

  const agentIds = new Set(state.agents.map((agent) => agent.id));
  for (const node of flow.nodes) {
    assert.ok(agentIds.has(node.agentId));
    assert.equal(node.status, "idle");
    assert.deepEqual(node.artifacts, []);
  }
  const plan = flow.nodes.find((node) => node.title === "规划者");
  assert.match(plan.task, /折纸/);
  assert.equal(plan.handoffEnabled, false);

  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  for (const edge of flow.edges) {
    assert.ok(nodeIds.has(edge.from));
    assert.ok(nodeIds.has(edge.to));
    assert.deepEqual(edge.files, []);
  }
});

test("只播种一次，删除后不复活", () => {
  const state = makeState();
  const store = makeStore();
  seedPresetFlow(state, preset, templates, store);
  assert.equal(seedPresetFlow(state, preset, templates, store), false);
  assert.equal(state.flows.length, 1);

  state.flows.length = 0;
  assert.equal(seedPresetFlow(state, preset, templates, store), false);
  assert.equal(state.flows.length, 0);
});

test("缺少 agent 时跳过对应节点和连线", () => {
  const state = makeState();
  state.agents = state.agents.filter((agent) => agent.name !== "GEO_Translate");
  const store = makeStore();
  assert.equal(seedPresetFlow(state, preset, templates, store), true);

  const flow = state.flows[0];
  assert.equal(flow.nodes.length, 4);
  assert.equal(flow.nodes.some((node) => node.title === "翻译者"), false);
  assert.equal(flow.edges.length, 6);
});
