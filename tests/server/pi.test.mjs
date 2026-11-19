import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/fake-pi.mjs");
process.env.PI_BIN = fixture;

test("Pi 适配器解析 RPC、日志、回复和会话 ID", async () => {
  const { createPiServer } = await import("../../modules/pi/server/index.mjs");
  const module = createPiServer();
  assert.equal(module.api.health().pi.available, true);

  const logs = [];
  const activities = [];
  let sessionId = null;
  let sessionInfo = null;
  const controller = module.api.start({
    cwd: process.cwd(),
    prompt: "测试",
    onLog: (line) => logs.push(line),
    onActivity: (activity) => activities.push(activity),
    onSessionId: (id) => {
      sessionId = id;
    },
    onSessionInfo: (info) => {
      sessionInfo = info;
    },
  });
  const result = await controller.promise;

  assert.equal(result.text, "完成（最终）");
  assert.equal(sessionId, "pi-test-session");
  assert.equal(sessionInfo.sessionId, "pi-test-session");
  assert.ok(sessionInfo.sessionFile.endsWith("fake-session.jsonl"));
  assert.ok(logs.some((line) => line.includes("write")));
  assert.deepEqual(
    activities.map((activity) => activity.kind),
    ["tool_start", "tool_end", "thinking", "text"],
  );
  assert.equal(activities[3].delta, "完成");
});

test("健康检查会汇总工具层目录", async () => {
  const { createPiServer } = await import("../../modules/pi/server/index.mjs");
  const module = createPiServer({
    tools: {
      catalog: () => ({ tools: { screen: "extensions/screen.ts" }, profiles: { full: ["screen"] } }),
    },
  });
  const health = module.api.health();
  assert.deepEqual(health.tools, { tools: ["screen"], profiles: ["full"] });
  assert.equal(health.pi.available, true);
  assert.equal(health.pi.protocol, 1);
});

test("abort 先走 RPC 命令，进程停下来后 promise 中止", async () => {
  const { createPiServer } = await import("../../modules/pi/server/index.mjs");
  const module = createPiServer();
  process.env.FAKE_PI_HOLD = "1";
  try {
    const controller = module.api.start({ cwd: process.cwd(), prompt: "长任务" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    controller.abort();
    await assert.rejects(() => controller.promise, /运行已中止/);
  } finally {
    delete process.env.FAKE_PI_HOLD;
  }
});

test("隔离启动参数包含 --no-extensions 与显式扩展", async () => {
  const { buildPiArgs } = await import("../../modules/pi/server/rpc.mjs");
  const args = buildPiArgs({ sessionId: "s1", noExtensions: true, extensions: ["a.ts", "b.ts"] });
  assert.deepEqual(args.slice(1), [
    "--mode",
    "rpc",
    "--approve",
    "--no-extensions",
    "--extension",
    "a.ts",
    "--extension",
    "b.ts",
    "--session-id",
    "s1",
  ]);
});
