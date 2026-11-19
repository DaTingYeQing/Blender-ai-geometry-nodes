import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createAgentsServer } from "../../modules/agents/server/index.mjs";
import { emptyState, makeStore, makeTempDir } from "../helpers.mjs";

test("会话接口同时接受内部 id 和 pi 会话 id", async (t) => {
  const projectPath = await makeTempDir(t);
  const sessionFile = path.join(projectPath, "pi-1.jsonl");
  await fsp.writeFile(
    sessionFile,
    [
      JSON.stringify({ type: "session", version: 3, id: "pi-1", cwd: projectPath }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        message: { role: "user", content: "你好" },
      }),
    ].join("\n"),
    "utf8",
  );

  const store = makeStore(emptyState());
  const module = createAgentsServer({ store });
  const agent = await module.api.create({ name: "Agent", projectPath });
  const begun = module.api.beginSession(agent.id, { title: "节点", sessionMode: "new" });
  module.api.bindSession(agent.id, begun.internalId, "pi-1", sessionFile);

  const route = module.routes.find((item) => item.method === "GET" && item.pattern);
  for (const id of [begun.internalId, "pi-1"]) {
    const result = await route.handler({ params: ["", agent.id, id] });
    assert.equal(result.missing, false, id);
    assert.equal(result.session.id, "pi-1", id);
    assert.equal(result.entries[0].text, "你好", id);
  }

  module.api.renameSession(agent.id, "pi-1", "用 pi id 改名");
  assert.equal(module.api.get(agent.id).sessions[0].title, "用 pi id 改名");
  module.api.renameSession(agent.id, begun.internalId, "用内部 id 改名");
  assert.equal(module.api.get(agent.id).sessions[0].title, "用内部 id 改名");

  module.api.removeSession(agent.id, "pi-1");
  assert.deepEqual(module.api.get(agent.id).sessions, []);
});
