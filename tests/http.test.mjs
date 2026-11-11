import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { browserAssetPaths } from "./asset-utils.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

test("HTTP API 保持兼容并完成注册、运行和产物读取", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-http-"));
  const projectPath = path.join(root, "project");
  await fsp.mkdir(projectPath);
  process.env.PI_FLOW_DATA_DIR = path.join(root, "data");
  process.env.PI_BIN = path.join(testDir, "fixtures/fake-pi.mjs");

  const { loadState } = await import("../electron/server/store.mjs");
  const { createServer } = await import("../electron/server/http.mjs");
  await loadState();
  const { server, url } = await createServer({ port: 0 });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fsp.rm(root, { recursive: true, force: true });
  });

  for (const asset of await browserAssetPaths()) {
    const response = await fetch(`${url}${asset}`);
    assert.equal(response.status, 200, `静态资源不可访问：${asset}`);
  }

  const html = await (await fetch(`${url}/`)).text();
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
    const response = await fetch(`${url}${asset}`);
    assert.equal(response.status, 200, `页面引用的资源不可访问：${asset}`);
  }
  assert.equal((await request(`${url}/api/health`)).payload.pi.available, true);

  const created = await request(`${url}/api/agents`, {
    method: "POST",
    body: JSON.stringify({ name: "HTTP Agent", projectPath }),
  });
  assert.equal(created.response.status, 200);
  const agent = created.payload.agent;

  const createdFlow = await request(`${url}/api/flows`, {
    method: "POST",
    body: JSON.stringify({ name: "HTTP 流程" }),
  });
  assert.equal(createdFlow.response.status, 200);
  const flowId = createdFlow.payload.flow.id;

  const node = { id: "node-http", agentId: agent.id, title: "HTTP 节点", task: "生成产物", sessionMode: "new" };
  const saved = await request(`${url}/api/flows/${flowId}`, {
    method: "PUT",
    body: JSON.stringify({ nodes: [node], edges: [] }),
  });
  assert.deepEqual(saved.payload, { ok: true });

  const flowList = await request(`${url}/api/flows`);
  assert.equal(flowList.payload.flows[0].id, flowId);
  const loaded = await request(`${url}/api/flows/${flowId}`);
  assert.equal(loaded.payload.flow.nodes[0].id, node.id);

  const started = await request(`${url}/api/run`, {
    method: "POST",
    body: JSON.stringify({ node, flowId, inputFiles: [] }),
  });
  assert.equal(started.response.status, 200);

  let run;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await request(`${url}/api/runs/${started.payload.runId}`);
    run = result.payload;
    if (run.status === "done") break;
    if (run.status === "error") throw new Error(run.error);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal(run.status, "done");
  assert.equal(run.sessionId, "pi-test-session");
  assert.equal(run.artifacts[0].name, "result.txt");

  const artifact = await request(`${url}/api/file?path=${encodeURIComponent(run.artifacts[0].path)}`);
  assert.equal(artifact.payload.content, "fake pi artifact");
  const forbidden = await request(`${url}/api/file?path=${encodeURIComponent(path.join(root, "outside.txt"))}`);
  assert.equal(forbidden.response.status, 403);

  const state = await request(`${url}/api/state`);
  assert.equal(state.payload.agents[0].sessions[0].messageCount, 1);
  assert.equal(state.payload.flows[0].id, flowId);
  assert.equal(state.payload.flows[0].nodeCount, 1);

  const agentsOnly = await request(`${url}/api/agents`);
  assert.equal(agentsOnly.response.status, 200);
  assert.equal(agentsOnly.payload.agents[0].sessions[0].messageCount, 1);
  assert.equal(agentsOnly.payload.flow, undefined);

  const removed = await request(`${url}/api/flows/${flowId}`, { method: "DELETE" });
  assert.deepEqual(removed.payload, { ok: true });
  assert.equal((await request(`${url}/api/flows/${flowId}`)).response.status, 404);
  await assert.rejects(() => fsp.access(run.artifacts[0].path));

  const removedAgent = await request(`${url}/api/agents/${agent.id}`, { method: "DELETE" });
  assert.deepEqual(removedAgent.payload, { ok: true });
  assert.equal((await request(`${url}/api/agents`)).payload.agents.length, 0);
});
