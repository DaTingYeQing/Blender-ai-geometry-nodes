import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTemplates } from "../../server/registry/index.mjs";

test("loadTemplates 按 manifest 读名字/register，并返回跳过诊断", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-agents-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  await fsp.mkdir(path.join(root, "agents", "GEO_Scout"), { recursive: true });
  await fsp.mkdir(path.join(root, "agents", "GEO_Execute"), { recursive: true });

  const manifestPath = path.join(root, "agents.json");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify({
      projects: {
        GEO_Scout: { path: "agents/GEO_Scout", displayName: "侦察者" },
        GEO_Execute: { path: "agents/GEO_Execute" },
        GEO_Blank: { path: "agents/GEO_Blank" },
        GEO_Off: { path: "agents/GEO_Scout", enabled: false },
        GEO_Single: { path: "agents/GEO_Scout", displayName: "单人", register: false },
      },
    }),
    "utf8",
  );

  const { agents, diagnostics } = await loadTemplates({
    manifestPath,
    resolveProjectPath: (project, entry) => path.resolve(root, entry?.path || project),
  });

  assert.deepEqual(
    agents.map((agent) => [agent.project, agent.name, agent.register]),
    [
      ["GEO_Scout", "侦察者", true],
      ["GEO_Execute", "GEO_Execute", true],
      ["GEO_Single", "单人", false],
    ],
  );
  assert.deepEqual(
    diagnostics.skipped.map((item) => [item.project, item.reason]),
    [
      ["GEO_Blank", "目录不存在"],
      ["GEO_Off", "enabled: false"],
    ],
  );
});

test("projectsBase 作为相对路径的基准", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-base-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  await fsp.mkdir(path.join(root, "agents", "GEO_Scout"), { recursive: true });
  const manifestPath = path.join(root, "agents.json");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify({
      projectsBase: "agents",
      projects: { GEO_Scout: { path: "GEO_Scout" } },
    }),
    "utf8",
  );

  const { agents } = await loadTemplates({ manifestPath });
  assert.deepEqual(agents.map((agent) => agent.projectPath), [path.join(root, "agents", "GEO_Scout")]);
});

test("未知 profile / 工具直接拒绝清单", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "pi-flow-invalid-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));

  const manifestPath = path.join(root, "agents.json");
  await fsp.writeFile(
    manifestPath,
    JSON.stringify({
      tools: { screen: "extensions/screen.ts" },
      profiles: { bad: ["missing"] },
      projects: { A: { profile: "nope" } },
    }),
    "utf8",
  );

  await assert.rejects(() => loadTemplates({ manifestPath }), /不存在的工具：missing/);
});
