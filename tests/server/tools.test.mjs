import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createToolGateway } from "../../server/tools/index.mjs";

test("项目扩展只对 isolate 项目返回显式清单", async (t) => {
  const project = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-ext-"));
  t.after(() => fsp.rm(project, { recursive: true, force: true }));
  const piDir = path.join(project, ".pi");
  await fsp.mkdir(piDir, { recursive: true });
  const gateway = createToolGateway();

  assert.deepEqual(gateway.resolve(project), { noExtensions: false, extensions: [] });

  const extension = path.join(piDir, "ext.ts");
  await fsp.writeFile(extension, "", "utf8");
  await fsp.writeFile(
    path.join(piDir, "settings.json"),
    JSON.stringify({ extensions: ["./ext.ts", "missing.ts", "-skip.ts", "builtin:read"] }),
    "utf8",
  );
  await fsp.writeFile(path.join(piDir, "pi-flow.json"), JSON.stringify({ isolate: true }), "utf8");

  assert.deepEqual(gateway.resolve(project), { noExtensions: true, extensions: [extension] });
});

test("网关只依赖 adapter 契约，可以整体替换工具实现", () => {
  const calls = [];
  const gateway = createToolGateway({
    adapter: {
      resolve(projectPath) {
        calls.push(projectPath);
        return { noExtensions: true, extensions: ["C:/tools/other.ts"] };
      },
      catalog() {
        return { tools: { screen: "other" }, profiles: { full: ["screen"] } };
      },
    },
  });

  assert.deepEqual(gateway.resolve("C:/project"), {
    noExtensions: true,
    extensions: ["C:/tools/other.ts"],
  });
  assert.deepEqual(calls, ["C:/project"]);
  assert.deepEqual(gateway.catalog(), { tools: { screen: "other" }, profiles: { full: ["screen"] } });
});

test("catalog 只读 shard/agents.json 的公开工具表", async (t) => {
  const shard = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-tools-"));
  t.after(() => fsp.rm(shard, { recursive: true, force: true }));
  await fsp.writeFile(
    path.join(shard, "agents.json"),
    JSON.stringify({ tools: { screen: "extensions/screen.ts" }, profiles: { full: ["screen"] } }),
    "utf8",
  );

  const gateway = createToolGateway({ shardDir: shard });
  assert.deepEqual(gateway.catalog(), {
    tools: { screen: "extensions/screen.ts" },
    profiles: { full: ["screen"] },
  });
});
