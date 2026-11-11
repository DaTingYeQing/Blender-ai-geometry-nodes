import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createArtifactsServer } from "../modules/artifacts/server/index.mjs";
import { emptyState, makeStore, makeTempDir } from "./helpers.mjs";

test("产物模块独占运行目录、输入复制、扫描和受限读取", async (t) => {
  const root = await makeTempDir(t);
  const first = { id: "a", projectPath: path.join(root, "a") };
  const second = { id: "b", projectPath: path.join(root, "b") };
  const state = emptyState();
  state.agents.push(first, second);
  const store = makeStore(state);
  const agents = { list: () => state.agents };
  const module = await createArtifactsServer({ store, agents });

  const upstream = await module.api.prepare({ agent: first, flowId: "flow-a", runId: "run-a" });
  assert.equal(upstream.outDir, path.join(root, "a", ".pi", "flow", "flow-a", "runs", "run-a", "output"));
  const source = path.join(upstream.outDir, "source.txt");
  await fsp.writeFile(source, "source content", "utf8");

  const downstream = await module.api.prepare({
    agent: second,
    flowId: "flow-b",
    runId: "run-b",
    inputFiles: [{ name: "input.txt", path: source }],
  });
  assert.equal(downstream.inputs.length, 1);
  assert.equal(await fsp.readFile(downstream.inputs[0].path, "utf8"), "source content");

  await fsp.mkdir(path.join(downstream.outDir, "nested"));
  await fsp.writeFile(path.join(downstream.outDir, "nested", "result.txt"), "result", "utf8");
  const artifacts = await module.api.collect(downstream.outDir);
  assert.deepEqual(artifacts.map((file) => file.name), ["nested/result.txt"]);

  const read = await module.api.read(artifacts[0].path);
  assert.equal(read.content, "result");
  await assert.rejects(() => module.api.read(path.join(root, "outside.txt")), /路径不允许/);
});

test("删除流程会清理所有 Agent 下的工作区", async (t) => {
  const root = await makeTempDir(t);
  const first = { id: "a", projectPath: path.join(root, "a") };
  const second = { id: "b", projectPath: path.join(root, "b") };
  const state = emptyState();
  state.agents.push(first, second);
  const module = await createArtifactsServer({
    store: makeStore(state),
    agents: { list: () => state.agents },
  });

  const firstWork = await module.api.prepare({ agent: first, flowId: "flow-x", runId: "run-1" });
  const secondWork = await module.api.prepare({ agent: second, flowId: "flow-x", runId: "run-1" });
  await module.api.removeWorkspaces("flow-x");

  await assert.rejects(() => fsp.stat(firstWork.outDir));
  await assert.rejects(() => fsp.stat(secondWork.outDir));
});
