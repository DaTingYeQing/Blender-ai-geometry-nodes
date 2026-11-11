import assert from "node:assert/strict";
import test from "node:test";
import { createAgentsServer } from "../modules/agents/server/index.mjs";
import { emptyState, makeStore, makeTempDir } from "./helpers.mjs";

test("Agent 模块注册项目并独立管理会话生命周期", async (t) => {
  const projectPath = await makeTempDir(t);
  const store = makeStore(emptyState());
  const module = createAgentsServer({ store });
  const agent = await module.api.create({ name: "测试 Agent", projectPath });

  assert.equal(module.api.list().length, 1);
  assert.equal(module.api.get(agent.id).name, "测试 Agent");
  await assert.rejects(() => module.api.create({ name: "bad", projectPath: "relative/path" }), /绝对路径/);

  const node = { title: "节点", sessionMode: "new" };
  const started = module.api.beginSession(agent.id, node);
  assert.equal(started.reused, false);
  module.api.bindSession(agent.id, started.internalId, "pi-123");
  module.api.finishSession(agent.id, started.internalId, 2);

  const reused = module.api.beginSession(agent.id, {
    ...node,
    sessionMode: "reuse",
    sessionId: started.internalId,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.piSessionId, "pi-123");
  assert.equal(module.api.get(agent.id).sessions[0].messageCount, 1);
  assert.equal(module.api.get(agent.id).sessions[0].artifactCount, 2);
});

test("Agent 可以直接删除注册记录", async (t) => {
  const projectPath = await makeTempDir(t);
  const module = createAgentsServer({ store: makeStore(emptyState()) });
  const agent = await module.api.create({ name: "待删除", projectPath });

  const removed = await module.api.remove(agent.id);
  assert.equal(removed.id, agent.id);
  assert.equal(module.api.get(agent.id), null);
  assert.deepEqual(module.api.list(), []);
  await assert.rejects(() => module.api.remove(agent.id), /Agent 不存在/);
});
