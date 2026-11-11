import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-pi.mjs");
process.env.PI_BIN = fixture;

test("Pi 适配器解析 RPC、日志、回复和会话 ID", async () => {
  const { createPiServer } = await import("../modules/pi/server/index.mjs");
  const module = createPiServer();
  assert.equal(module.api.health().pi.available, true);

  const logs = [];
  const activities = [];
  let sessionId = null;
  const controller = module.api.start({
    cwd: process.cwd(),
    prompt: "测试",
    onLog: (line) => logs.push(line),
    onActivity: (activity) => activities.push(activity),
    onSessionId: (id) => {
      sessionId = id;
    },
  });
  const result = await controller.promise;

  assert.equal(result.text, "完成");
  assert.equal(sessionId, "pi-test-session");
  assert.ok(logs.some((line) => line.includes("write")));
  assert.deepEqual(
    activities.map((activity) => activity.kind),
    ["tool_start", "tool_end", "thinking", "text"],
  );
  assert.equal(activities[3].delta, "完成");
});

test("隔离启动参数包含 --no-extensions 与显式扩展", async () => {
  const { buildPiArgs } = await import("../modules/pi/server/rpc.mjs");
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

test("项目扩展解析只对 isolate 项目返回显式扩展", async (t) => {
  const { resolveProjectExtensions } = await import("../modules/pi/server/index.mjs");
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-ext-"));
  t.after(() => fsp.rm(project, { recursive: true, force: true }));
  const piDir = path.join(project, ".pi");
  await fsp.mkdir(piDir, { recursive: true });

  assert.deepEqual(resolveProjectExtensions(project), { noExtensions: false, extensions: [] });

  const extension = path.join(piDir, "ext.ts");
  await fsp.writeFile(extension, "", "utf8");
  await fsp.writeFile(
    path.join(piDir, "settings.json"),
    JSON.stringify({ extensions: ["./ext.ts", "missing.ts", "-skip.ts", "builtin:read"] }),
    "utf8",
  );
  await fsp.writeFile(path.join(piDir, "pi-flow.json"), JSON.stringify({ isolate: true }), "utf8");

  assert.deepEqual(resolveProjectExtensions(project), { noExtensions: true, extensions: [extension] });
});
