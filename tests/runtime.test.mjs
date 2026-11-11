import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAgentsServer } from "../modules/agents/server/index.mjs";
import { resolveProjectExtensions } from "../modules/pi/server/index.mjs";
import { createRuntimeServer } from "../modules/runtime/server/index.mjs";
import { emptyState, makeStore, makeTempDir, waitFor } from "./helpers.mjs";

async function setup(t, startPi) {
  const projectPath = await makeTempDir(t);
  const state = emptyState();
  const store = makeStore(state);
  const agentsModule = createAgentsServer({ store });
  const agent = await agentsModule.api.create({ name: "Agent", projectPath });
  const artifacts = {
    async prepare({ flowId, runId }) {
      const runDir = path.join(projectPath, ".pi", "flow", flowId || "default", "runs", runId || "run");
      const inputDir = path.join(runDir, "inputs");
      const outDir = path.join(runDir, "output");
      await fsp.mkdir(inputDir, { recursive: true });
      await fsp.mkdir(outDir, { recursive: true });
      return { runDir, inputDir, outDir, inputs: [] };
    },
    async collect(outDir) {
      return [{ name: "result.txt", path: path.join(outDir, "result.txt"), size: 1 }];
    },
  };
  const runtime = createRuntimeServer({
    store,
    agents: agentsModule.api,
    artifacts,
    pi: { start: startPi, resolveProjectExtensions },
  });
  return { runtime, agentsModule, agent, state, store, node: { ...node, agentId: agent.id } };
}

const node = { id: "node-1", title: "节点", task: "测试", sessionMode: "new" };

test("重启后遗留 Run 会标记为中断", () => {
  const state = emptyState();
  state.runs.stale = { id: "stale", status: "running", logs: [], finishedAt: null };
  const module = createRuntimeServer({
    store: makeStore(state),
    agents: {},
    artifacts: {},
    pi: {},
  });
  assert.equal(module.recovered, true);
  assert.equal(module.api.get("stale").status, "error");
  assert.match(module.api.get("stale").error, /运行已中断/);
  assert.ok(module.api.get("stale").finishedAt);
});

test("运行引擎通过公开接口完成一次运行并写回会话", async (t) => {
  let promptText = "";
  let flowEnv = null;
  const { runtime, agentsModule, agent, state, node } = await setup(t, (options) => {
    promptText = options.prompt;
    flowEnv = options.env;
    options.onSessionId("pi-success");
    options.onActivity?.({ kind: "thinking", delta: "想一想" });
    options.onActivity?.({ kind: "text", delta: "开始" });
    options.onActivity?.({ kind: "tool_start", toolCallId: "t1", toolName: "read", args: { path: "a.txt" } });
    options.onActivity?.({ kind: "tool_end", toolCallId: "t1", toolName: "read", isError: false, durationMs: 4 });
    return { promise: Promise.resolve({ text: "完成" }), abort() {} };
  });
  const { runId, sessionInternalId } = await runtime.api.start({ node, flowId: "flow-test" });
  await waitFor(() => runtime.api.get(runId)?.status === "done");

  assert.equal(runtime.api.get(runId).sessionId, "pi-success");
  assert.equal(runtime.api.get(runId).artifacts.length, 1);
  assert.match(promptText, /测试/);
  assert.match(promptText, /上游产物目录/);
  assert.doesNotMatch(promptText, /成果输出目录/);
  assert.equal(flowEnv.PI_FLOW_FLOW_ID, "flow-test");
  assert.equal(flowEnv.PI_FLOW_RUN_ID, runId);
  assert.equal(flowEnv.PI_FLOW_OUTPUT_DIR, path.join(agent.projectPath, ".pi", "flow", "flow-test", "runs", runId, "output"));
  const transcript = runtime.api.get(runId).transcript;
  assert.deepEqual(
    transcript.map((entry) => entry.type),
    ["thinking", "text", "tool"],
  );
  assert.equal(transcript[2].toolName, "read");
  assert.equal(transcript[2].status, "done");
  assert.equal(agentsModule.api.get(agent.id).sessions[0].id, sessionInternalId);
  assert.equal(agentsModule.api.get(agent.id).sessions[0].messageCount, 1);
  assert.ok(state.runs[runId].finishedAt);
});

test("关闭交接提示词时只发送任务原文", async (t) => {
  let promptText = "";
  const { runtime, node } = await setup(t, (options) => {
    promptText = options.prompt;
    return { promise: Promise.resolve({ text: "" }), abort() {} };
  });
  const { runId } = await runtime.api.start({
    node: { ...node, handoffEnabled: false },
    flowId: "flow-test",
  });
  await waitFor(() => runtime.api.get(runId)?.status === "done");
  assert.equal(promptText, "测试");
});

test("隔离标记只加载项目扩展", async (t) => {
  let captured = null;
  const { runtime, agent, node } = await setup(t, (options) => {
    captured = options;
    return { promise: Promise.resolve({ text: "" }), abort() {} };
  });
  const piDir = path.join(agent.projectPath, ".pi");
  await fsp.mkdir(piDir, { recursive: true });
  const extension = path.join(piDir, "ext.js");
  await fsp.writeFile(extension, "", "utf8");
  await fsp.writeFile(
    path.join(piDir, "settings.json"),
    JSON.stringify({ extensions: ["ext.js", "missing.js"] }),
    "utf8",
  );
  await fsp.writeFile(path.join(piDir, "pi-flow.json"), JSON.stringify({ isolate: true }), "utf8");

  const { runId } = await runtime.api.start({ node, flowId: "flow-test" });
  await waitFor(() => runtime.api.get(runId)?.status === "done");
  assert.equal(captured.noExtensions, true);
  assert.deepEqual(captured.extensions, [extension]);
});

test("Pi 失败会进入 error 状态", async (t) => {
  const { runtime, node } = await setup(t, () => ({
    promise: Promise.reject(new Error("fake failure")),
    abort() {},
  }));
  const { runId } = await runtime.api.start({ node, flowId: "flow-test" });
  await waitFor(() => runtime.api.get(runId)?.status === "error");
  assert.equal(runtime.api.get(runId).error, "fake failure");
});

test("中止只由运行引擎管理", async (t) => {
  let rejectRun;
  const { runtime, node } = await setup(t, () => ({
    promise: new Promise((_, reject) => {
      rejectRun = reject;
    }),
    abort() {
      rejectRun(new Error("运行已中止"));
    },
  }));
  const { runId } = await runtime.api.start({ node, flowId: "flow-test" });
  runtime.api.abort(runId);
  await waitFor(() => runtime.api.get(runId)?.status === "error");
  assert.equal(runtime.api.get(runId).error, "运行已中止");
});
